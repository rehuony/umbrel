import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import type http from 'node:http'
import {isIP, type Socket} from 'node:net'

import express from 'express'
import {z} from 'zod'
import PQueue from 'p-queue'

import type Umbreld from '../../index.js'
import type {Principal} from '../auth/auth.js'
import {AppAccessDeniedError, SESSION_DURATION} from '../auth/auth.js'
import {appGatewayTokenFromRequest, setAppGatewayCookie} from '../auth/app-gateway-cookie.js'
import randomToken from '../utilities/random-token.js'
import AppGateway, {type AppGatewayConfig} from './app-gateway.js'

const CALLBACK_PATH = '/umbrel_/api/v1/auth/handoff'
const LOGIN_DURATION = 5 * 60_000
const MAX_PENDING_LOGINS = 1024
const MAX_APP_SESSIONS = 4096
const EXTERNAL_SESSION_COOKIE = '__Host-UMBREL_EXTERNAL_APP_SESSION'
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const normalizeIp = (value = '') => value.replace(/^::ffff:/, '')

const originSchema = z.string().transform((value, ctx) => {
	try {
		const url = new URL(value)
		if (
			url.protocol !== 'https:' ||
			url.port ||
			url.username ||
			url.password ||
			url.pathname !== '/' ||
			url.search ||
			url.hash ||
			isIP(url.hostname) ||
			!url.hostname.includes('.') ||
			url.hostname.length > 253 ||
			!url.hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
		)
			throw new Error()
		return url.origin
	} catch {
		ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Enter an HTTPS domain without a path or port'})
		return z.NEVER
	}
})

export const ExternalAccessPanelSchema = z
	.object({
		enabled: z.boolean(),
		panelOrigin: z.union([z.literal(''), originSchema]),
		trustedProxies: z
			.array(
				z
					.string()
					.transform(normalizeIp)
					.refine((ip) => Boolean(isIP(ip)), 'Enter an exact proxy IP address'),
			)
			.max(32),
	})
	.strict()

export const ExternalAccessSettingsSchema = ExternalAccessPanelSchema.extend({
	apps: z.record(z.string().regex(/^[a-zA-Z0-9-]+$/), originSchema),
}).superRefine((value, ctx) => {
	if (value.enabled && (!value.panelOrigin || !value.trustedProxies.length)) {
		ctx.addIssue({code: z.ZodIssueCode.custom, message: 'A panel domain and trusted proxy IP are required'})
	}
	const origins = [value.panelOrigin, ...Object.values(value.apps)].filter(Boolean)
	if (new Set(origins).size !== origins.length) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: 'Each application and the panel must have a different domain',
		})
	}
	if (Object.keys(value.apps).length > 256)
		ctx.addIssue({code: z.ZodIssueCode.custom, message: 'Too many application domains'})
})

export type ExternalAccessSettings = z.infer<typeof ExternalAccessSettingsSchema>
type LoginAttempt = {
	appId: string
	appOrigin: string
	panelOrigin: string
	path: string
	browserHash: string
	external: boolean
	expiresAt: number
	issued?: boolean
	handoffHash?: string
}
type AppSession = {appId: string; origin: string; token: string; expiresAt: number}

function cookie(request: http.IncomingMessage, name: string) {
	return request.headers.cookie
		?.split(';')
		.map((pair) => pair.trim())
		.find((pair) => pair.startsWith(`${name}=`))
		?.slice(name.length + 1)
}

function browserCookie(secure: boolean) {
	return secure ? '__Host-UMBREL_APP_LOGIN' : 'UMBREL_APP_LOGIN'
}

export function safeAppPath(value: string) {
	if (!value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/'
	return value
}

/** Shared login handoffs and external host routing; no additional process or public listener. */
export default class ExternalAccess {
	#umbreld: Umbreld
	#settings: ExternalAccessSettings = {enabled: false, panelOrigin: '', trustedProxies: [], apps: {}}
	#gateways = new Map<string, {config: string; gateway: AppGateway}>()
	#attempts = new Map<string, LoginAttempt>()
	#sessions = new Map<string, AppSession>()
	#externalRequests = new WeakSet<http.IncomingMessage>()
	#sockets = new Map<Socket, Set<string>>()
	#configurationQueue = new PQueue({concurrency: 1})
	#revision = 0
	#origins = new Map<string, string>()

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
	}

	async start() {
		const settings = await this.#umbreld.store.get('externalAccess')
		if (settings) this.#setSettings(ExternalAccessSettingsSchema.parse(settings))
	}

	get settings() {
		return structuredClone(this.#settings)
	}

	get panelSettings() {
		const {apps: _apps, ...panel} = this.#settings
		return structuredClone(panel)
	}

	launchSettings(appId: string): {enabled: boolean; panelOrigin: string; origin: string | null} {
		return {
			enabled: this.#settings.enabled,
			panelOrigin: this.#settings.panelOrigin,
			origin: this.#settings.apps[appId] ?? null,
		}
	}

	configure(input: z.infer<typeof ExternalAccessPanelSchema>) {
		return this.#configurationQueue.add(async () => {
			await this.#configure({...ExternalAccessPanelSchema.parse(input), apps: this.#settings.apps})
			return this.panelSettings
		})
	}

	setAppOrigin(appId: string, origin: string) {
		return this.#configurationQueue.add(async () => {
			if (origin && !this.#settings.enabled) throw new Error('Enable external access in Advanced Settings first')
			const app = this.#umbreld.apps.getApp(appId)
			if (origin && (!(await app.readManifest()).port || ['installing', 'uninstalling'].includes(app.state)))
				throw new Error('This application has no available web entry')
			const settings = this.settings
			if (origin) settings.apps[appId] = originSchema.parse(origin)
			else delete settings.apps[appId]
			if (settings.apps[appId] !== this.#settings.apps[appId]) await this.#configure(settings)
			return this.launchSettings(appId)
		})
	}

	async removeApp(appId: string) {
		await this.#configurationQueue.add(async () => {
			if (!this.#settings.apps[appId]) return
			const settings = this.settings
			delete settings.apps[appId]
			await this.#configure(settings)
		})
	}

	#setSettings(settings: ExternalAccessSettings) {
		this.#settings = settings
		this.#origins = new Map(Object.entries(settings.apps).map(([id, origin]) => [origin, id]))
	}

	async #configure(input: ExternalAccessSettings) {
		const settings = ExternalAccessSettingsSchema.parse(input)
		for (const appId of Object.keys(settings.apps)) this.#umbreld.apps.getApp(appId)
		const previous = this.#settings
		await this.#umbreld.store.set('externalAccess', settings)
		this.reset()
		this.#setSettings(settings)
		try {
			await this.#umbreld.lanIngress.refresh()
		} catch (error) {
			this.reset()
			this.#setSettings(previous)
			await this.#umbreld.store.set('externalAccess', previous)
			await this.#umbreld.lanIngress.refresh().catch((rollbackError) => {
				this.#umbreld.logger.error('Failed to restore external ingress configuration', rollbackError)
			})
			throw error
		}
		return this.settings
	}

	reset() {
		this.#revision++
		for (const socket of this.#sockets.keys()) socket.destroy()
		for (const {gateway} of this.#gateways.values()) gateway.server.close()
		this.#sockets.clear()
		this.#gateways.clear()
		this.#attempts.clear()
		this.#sessions.clear()
	}

	/** Called only on configuration/app lifecycle changes, never while forwarding a request. */
	reconcile(routes: {id: string; publicPort?: number; gateway?: AppGatewayConfig}[]) {
		const next = new Map<string, {config: string; gateway: AppGateway}>()
		if (this.#settings.enabled)
			for (const route of routes) {
				const origin = this.#settings.apps[route.id]
				if (!origin) continue
				// Directly published HTTP apps already own their loopback port.
				const upstream =
					route.gateway ??
					(route.publicPort
						? {
								appId: route.id,
								appName: route.id,
								appIcon: '',
								targetHost: '127.0.0.1',
								targetPort: route.publicPort,
								targetProtocol: 'http' as const,
								timeout: 0,
							}
						: undefined)
				if (!upstream) continue
				const config = {...upstream, auth: true, authWhitelist: [], authBlacklist: [], trustUpstream: false}
				const key = JSON.stringify(config)
				const previous = this.#gateways.get(route.id)
				next.set(
					route.id,
					previous?.config === key
						? previous
						: {
								config: key,
								gateway: new AppGateway(this.#umbreld, config, {externalOrigin: origin}),
							},
				)
			}
		for (const [id, previous] of this.#gateways) {
			if (next.get(id) === previous) continue
			for (const [socket, apps] of this.#sockets) if (apps.has(id)) socket.destroy()
			previous.gateway.server.close()
			for (const [key, attempt] of this.#attempts) if (attempt.appId === id) this.#attempts.delete(key)
		}
		this.#gateways = next
	}

	/** Returns undefined for the panel/LAN, an app id for an external app, or rejects invalid forwarding. */
	#route(request: http.IncomingMessage): string | undefined {
		const authority = request.headers.host?.toLowerCase().replace(/:443$/, '')
		const origin = `https://${authority}`
		const appId = this.#origins.get(origin)
		const known = origin === this.#settings.panelOrigin || appId !== undefined
		const trusted = this.#settings.trustedProxies.includes(normalizeIp(request.socket.remoteAddress))
		if (!known && !trusted) return
		if (!this.#settings.enabled || !trusted || !known || request.headers['x-forwarded-proto'] !== 'https')
			throw new Error('Untrusted external request')
		// Only the original TCP peer establishes trust. Never use X-Forwarded-For to establish it.
		delete request.headers.forwarded
		delete request.headers['x-forwarded-for']
		request.headers.host = authority
		request.headers['x-forwarded-host'] = authority
		request.headers['x-forwarded-proto'] = 'https'
		this.#externalRequests.add(request)
		return appId
	}

	isExternalRequest(request: http.IncomingMessage) {
		return this.#externalRequests.has(request)
	}

	handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
		try {
			const appId = this.#route(request)
			if (!appId) return false
			const gateway = this.#gateways.get(appId)?.gateway
			if (!gateway) {
				response.writeHead(503)
				response.end('Application gateway is unavailable')
				return true
			}
			this.#track(request.socket, appId)
			gateway.server.emit('request', request, response)
		} catch {
			response.writeHead(403, {'cache-control': 'no-store'})
			response.end('External access denied')
		}
		return true
	}

	handleUpgrade(request: http.IncomingMessage, socket: Socket, head: Buffer) {
		try {
			const appId = this.#route(request)
			if (!appId) return false
			const gateway = this.#gateways.get(appId)?.gateway
			if (!gateway) throw new Error('Application unavailable')
			this.#track(socket, appId)
			gateway.server.emit('upgrade', request, socket, head)
		} catch {
			socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
		}
		return true
	}

	#track(socket: Socket, appId: string) {
		const apps = this.#sockets.get(socket)
		if (apps) {
			apps.add(appId)
			return
		}
		this.#sockets.set(socket, new Set([appId]))
		socket.once('close', () => this.#sockets.delete(socket))
	}

	async authenticate(request: http.IncomingMessage, appId: string, origin: string) {
		// Sibling subdomains are same-site, so SameSite cookies alone do not stop
		// another app from issuing credentialed cross-origin requests.
		if (request.headers.origin && request.headers.origin !== origin) throw new AppAccessDeniedError()
		if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? '') && request.headers.origin !== origin)
			throw new AppAccessDeniedError()
		const id = cookie(request, EXTERNAL_SESSION_COOKIE)
		const session = id && this.#sessions.get(digest(id))
		if (!session || session.appId !== appId || session.origin !== origin || session.expiresAt <= Date.now()) {
			throw new Error('Invalid credential')
		}
		return this.#umbreld.auth.authenticateApp(session.token, appId)
	}

	async beginLogin(request: express.Request, response: express.Response, appId: string, externalOrigin?: string) {
		response.set({'cache-control': 'no-store', 'referrer-policy': 'no-referrer'})
		if (request.method !== 'GET' || !request.get('accept')?.toLowerCase().includes('text/html')) {
			response.status(401).json({error: 'Authentication required'})
			return
		}
		const revision = this.#revision
		const app = this.#umbreld.apps.getApp(appId)
		const manifest = externalOrigin ? undefined : await app.readManifest()
		let appOrigin = externalOrigin ?? `${request.protocol}://${request.get('host')}`
		let panelOrigin = externalOrigin ? this.#settings.panelOrigin : `${request.protocol}://${request.hostname}`
		if (!externalOrigin && request.hostname.endsWith('.onion')) {
			const hiddenService = (await readFile(`${this.#umbreld.dataDirectory}/tor/data/web/hostname`, 'utf8')).trim()
			panelOrigin = `http://${hiddenService}`
		}
		if (!externalOrigin && !request.hostname.endsWith('.onion')) {
			const url = new URL(panelOrigin)
			url.port = String(manifest!.port)
			appOrigin = url.origin
		}
		if (revision !== this.#revision) throw new Error('Gateway configuration changed')
		const secure = appOrigin.startsWith('https:')
		let browser = cookie(request, browserCookie(secure))
		if (!browser || !/^[0-9a-f]{64}$/.test(browser)) browser = randomToken(256)
		response.cookie(browserCookie(secure), browser, {
			httpOnly: true,
			secure,
			sameSite: 'lax',
			path: '/',
			maxAge: LOGIN_DURATION,
		})
		this.#prune()
		if (this.#attempts.size >= MAX_PENDING_LOGINS) {
			response.status(429).send('Too many pending logins')
			return
		}
		const id = randomToken(256)
		this.#attempts.set(digest(id), {
			appId,
			appOrigin,
			panelOrigin,
			path: safeAppPath(request.originalUrl),
			browserHash: digest(browser),
			external: Boolean(externalOrigin),
			expiresAt: Date.now() + LOGIN_DURATION,
		})
		response.redirect(`${panelOrigin}/app-access?request=${id}`)
	}

	async authorize(id: string, principal: Principal, request: express.Request) {
		const attempt = this.#attempts.get(digest(id))
		if (!attempt || attempt.expiresAt <= Date.now())
			throw new Error('Application login expired; open the application again')
		if (`${request.protocol}://${request.get('host')}` !== attempt.panelOrigin) throw new Error('Invalid login origin')
		if (attempt.external && this.#settings.apps[attempt.appId] !== attempt.appOrigin)
			throw new Error('Application domain changed')
		if (attempt.issued) throw new Error('Application login already authorized; open the application again')
		// Claim before asynchronous validation so parallel requests cannot mint multiple tickets.
		attempt.issued = true
		const token = appGatewayTokenFromRequest(request)
		const authenticated = await this.#umbreld.auth.authenticateApp(token, attempt.appId)
		if (authenticated.sessionId !== principal.sessionId) throw new Error('Session mismatch')
		const handoff = await this.#umbreld.auth.issueAppHandoff(attempt.appId, token)
		if (this.#attempts.get(digest(id)) !== attempt) throw new Error('Application login expired')
		attempt.handoffHash = digest(handoff)
		return {url: `${attempt.appOrigin}${CALLBACK_PATH}`, params: {request: id, handoff}}
	}

	async acceptHandoff(request: express.Request, response: express.Response, appId: string, externalOrigin?: string) {
		const id = typeof request.query.request === 'string' ? request.query.request : ''
		const ticket = typeof request.query.handoff === 'string' ? request.query.handoff : ''
		const key = digest(id)
		const attempt = this.#attempts.get(key)
		const origin = externalOrigin ?? `${request.protocol}://${request.get('host')}`
		const browser = cookie(request, browserCookie(origin.startsWith('https:')))
		if (
			!attempt ||
			!browser ||
			attempt.expiresAt <= Date.now() ||
			attempt.appId !== appId ||
			attempt.appOrigin !== origin ||
			attempt.external !== Boolean(externalOrigin) ||
			attempt.browserHash !== digest(browser) ||
			attempt.handoffHash !== digest(ticket)
		) {
			throw new Error('Invalid application login')
		}
		// Claim the pending request before awaiting central credential validation.
		this.#attempts.delete(key)
		const revision = this.#revision
		const {appGatewayToken} = await this.#umbreld.auth.consumeAppHandoff(appId, ticket)
		if (revision !== this.#revision) throw new Error('Gateway configuration changed')
		if (externalOrigin) {
			this.#prune()
			if (this.#sessions.size >= MAX_APP_SESSIONS) throw new Error('Too many application sessions')
			const session = randomToken(256)
			this.#sessions.set(digest(session), {
				appId,
				origin,
				token: appGatewayToken,
				expiresAt: Date.now() + SESSION_DURATION,
			})
			response.cookie(EXTERNAL_SESSION_COOKIE, session, {
				httpOnly: true,
				secure: true,
				sameSite: 'lax',
				path: '/',
				maxAge: SESSION_DURATION,
			})
		} else setAppGatewayCookie(response, request, appGatewayToken, new Date(Date.now() + SESSION_DURATION))
		response.set({'cache-control': 'no-store', 'referrer-policy': 'no-referrer'})
		response.redirect(
			303,
			attempt.path === CALLBACK_PATH || attempt.path.startsWith(`${CALLBACK_PATH}?`) ? '/' : attempt.path,
		)
	}

	#prune() {
		for (const [key, entry] of this.#attempts) if (entry.expiresAt <= Date.now()) this.#attempts.delete(key)
		for (const [key, entry] of this.#sessions) if (entry.expiresAt <= Date.now()) this.#sessions.delete(key)
	}
}
