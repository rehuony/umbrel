import http from 'node:http'
import {Readable} from 'node:stream'
import {once} from 'node:events'
import type {AddressInfo} from 'node:net'

import express from 'express'
import cookieParser from 'cookie-parser'
import {WebSocket, WebSocketServer} from 'ws'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import Umbreld from '../../index.js'
import {trpcExpressHandler} from '../server/trpc/index.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import {ExternalAccessSettingsSchema, safeAppPath} from './external-access.js'
import AppGateway, {type AppGatewayConfig} from './app-gateway.js'

const settings = {
	enabled: true,
	panelOrigin: 'https://panel.example.com',
	trustedProxies: ['127.0.0.1'],
	apps: {files: 'https://files.example.com', photos: 'https://photos.example.com'},
}

const {apps: initialApps, ...panelSettings} = settings

describe('external access validation', () => {
	test.each([
		'http://app.example.com',
		'https://user@app.example.com',
		'https://app.example.com/path',
		'https://app.example.com?x=1',
		'https://app.example.com:8080',
		'https://127.0.0.1',
		'https://*.example.com',
	])('rejects %s as an application origin', (origin) => {
		expect(ExternalAccessSettingsSchema.safeParse({...settings, apps: {files: origin}}).success).toBe(false)
	})
	test('rejects shared origins and proxy ranges, and normalizes HTTPS names', () => {
		expect(ExternalAccessSettingsSchema.safeParse({...settings, apps: {files: settings.panelOrigin}}).success).toBe(
			false,
		)
		expect(ExternalAccessSettingsSchema.safeParse({...settings, trustedProxies: ['0.0.0.0/0']}).success).toBe(false)
		expect(
			ExternalAccessSettingsSchema.parse({...settings, panelOrigin: 'https://PANEL.example.com/'}).panelOrigin,
		).toBe(settings.panelOrigin)
	})
	test.each(['//attacker.example', '/\\attacker.example', 'https://attacker.example', '/\nLocation: elsewhere'])(
		'rejects unsafe return path %s',
		(path) => expect(safeAppPath(path)).toBe('/'),
	)
})

describe('external application gateway', () => {
	let directory: ReturnType<typeof temporaryDirectory>
	let umbreld: Umbreld
	let bridge: http.Server
	let panelServer: http.Server
	let upstream: http.Server
	let wsServer: WebSocketServer
	let origin: string
	let session: Awaited<ReturnType<Umbreld['auth']['createSession']>>
	let routes: {id: string; gateway: AppGatewayConfig}[]

	beforeEach(async () => {
		directory = temporaryDirectory()
		await directory.createRoot()
		umbreld = new Umbreld({dataDirectory: await directory.create(), port: 0, logLevel: 'silent'})
		await umbreld.store.set('user', {name: 'Owner', hashedPassword: 'unused'})
		await umbreld.store.set('members', [{id: 'alice', name: 'Alice', language: 'en', hashedPassword: 'unused'}])
		await umbreld.auth.start()
		session = await umbreld.auth.createSession()
		vi.spyOn(umbreld.apps, 'getApp').mockImplementation(
			(id) => ({readManifest: async () => ({id, port: 3000})}) as never,
		)
		upstream = http
			.createServer((request, response) => {
				if (request.url === '/stream') {
					response.writeHead(200)
					response.write('first chunk')
					return
				}
				let length = 0
				request.on('data', (chunk: Buffer) => {
					length += chunk.length
				})
				request.on('end', () =>
					response.end(
						JSON.stringify({
							path: request.url,
							cookie: request.headers.cookie,
							host: request.headers.host,
							protocol: request.headers['x-forwarded-proto'],
							length,
						}),
					),
				)
			})
			.listen(0, '127.0.0.1')
		await once(upstream, 'listening')
		wsServer = new WebSocketServer({server: upstream})
		wsServer.on('connection', (socket) => socket.on('message', (message) => socket.send(message)))
		routes = ['files', 'photos'].map((id) => ({
			id,
			gateway: {
				appId: id,
				appName: id,
				appIcon: '',
				targetHost: '127.0.0.1',
				targetPort: (upstream.address() as AddressInfo).port,
				targetProtocol: 'http',
				auth: false,
				authWhitelist: ['*'],
				authBlacklist: [],
				trustUpstream: false,
				timeout: 10_000,
			},
		}))
		vi.spyOn(umbreld.lanIngress, 'refresh').mockImplementation(async () => {
			umbreld.externalAccess.reconcile(routes)
		})
		await umbreld.store.set('externalAccess', settings)
		await umbreld.externalAccess.start()
		await umbreld.lanIngress.refresh()
		const panel = express()
		panel.set('trust proxy', 'loopback')
		panel.set('umbreld', umbreld)
		panel.set('logger', umbreld.logger)
		panel.use(cookieParser())
		panel.use('/trpc', trpcExpressHandler)
		panel.get('/app-access', (_req, res) => res.send('panel login callback'))
		panelServer = http.createServer(panel).listen(0, '127.0.0.1')
		await once(panelServer, 'listening')
		umbreld.port = (panelServer.address() as AddressInfo).port
		const ingress = umbreld.lanIngress as unknown as {
			createHttpProxyServer(port: number, protocol: 'http'): http.Server
		}
		bridge = ingress.createHttpProxyServer(umbreld.port, 'http').listen(0, '127.0.0.1')

		await once(bridge, 'listening')
		origin = `http://127.0.0.1:${(bridge.address() as AddressInfo).port}`
	})

	afterEach(async () => {
		vi.useRealTimers()
		umbreld.externalAccess.reset()
		await umbreld.auth.stop()
		for (const client of wsServer.clients) client.terminate()
		for (const server of [bridge, panelServer, upstream]) {
			server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
		vi.restoreAllMocks()
		await directory.destroyRoot()
	})

	const request = (host: string, path = '/', options: RequestInit = {}, target = origin) =>
		new Promise<Response>((resolve, reject) => {
			const req = http.request(
				`${target}${path}`,
				{
					agent: false,
					method: options.method ?? 'GET',
					signal: options.signal ?? undefined,
					headers: {host, 'x-forwarded-proto': 'https', ...(options.headers as Record<string, string>)},
				},
				(res) => {
					const headers = new Headers()
					for (let index = 0; index < res.rawHeaders.length; index += 2)
						headers.append(res.rawHeaders[index], res.rawHeaders[index + 1])
					resolve(new Response(Readable.toWeb(res) as ReadableStream, {status: res.statusCode!, headers}))
				},
			)
			req.on('error', reject)
			req.end(options.body)
		})

	function panelHeaders(account = session) {
		return {
			authorization: `Bearer ${account.dashboardToken}`,
			cookie: `__Host-UMBREL_BROWSER_SESSION_HTTPS=${account.browserSessionToken}; __Host-UMBREL_APP_SESSION_HTTPS=${account.appGatewayToken}`,
		}
	}
	async function begin() {
		const response = await request('files.example.com', '/settings?tab=network', {headers: {accept: 'text/html'}})
		expect(response.status).toBe(302)
		const location = new URL(response.headers.get('location')!)
		expect(location.origin).toBe(settings.panelOrigin)
		expect(location.pathname).toBe('/app-access')
		return {id: location.searchParams.get('request')!, cookie: response.headers.getSetCookie()[0].split(';')[0]}
	}
	async function authorize(id: string, account = session) {
		return request('panel.example.com', '/trpc/apps.authorizeAccess', {
			method: 'POST',
			headers: {...panelHeaders(account), 'content-type': 'application/json'},
			body: JSON.stringify({request: id}),
		})
	}
	async function login(account = session) {
		const attempt = await begin()
		const response = await authorize(attempt.id, account)
		expect(response.status).toBe(200)
		const {
			result: {data},
		} = (await response.json()) as {result: {data: {url: string; params: Record<string, string>}}}
		const callback = `${new URL(data.url).pathname}?${new URLSearchParams(data.params)}`
		const completed = await request('files.example.com', callback, {headers: {cookie: attempt.cookie}})
		expect(completed.status).toBe(303)
		expect(completed.headers.get('location')).toBe('/settings?tab=network')
		const cookie = completed.headers
			.getSetCookie()
			.find((value) => value.startsWith('__Host-UMBREL_EXTERNAL_APP_SESSION='))!
		expect(cookie).toContain('HttpOnly')
		expect(cookie).toContain('Secure')
		expect(cookie).not.toContain('Domain=')
		return {cookie: cookie.split(';')[0], callback, browserCookie: attempt.cookie}
	}

	test('requires external authentication despite disabled LAN auth and strips credentials from upstream', async () => {
		expect((await request('files.example.com')).status).toBe(401)
		const {cookie, callback, browserCookie} = await login()
		const response = await request('files.example.com', '/private', {
			headers: {cookie: `${cookie}; ${browserCookie}; application=kept`},
		})
		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			path: '/private',
			cookie: 'application=kept',
			host: 'files.example.com',
			protocol: 'https',
		})
		expect((await request('files.example.com', callback, {headers: {cookie: browserCookie}})).status).toBe(401)
		expect((await request('photos.example.com', '/', {headers: {cookie}})).status).toBe(401)
	})

	test('binds callbacks to the initiating browser and application', async () => {
		const attempt = await begin()
		const response = await authorize(attempt.id)
		const {
			result: {data},
		} = (await response.json()) as {result: {data: {url: string; params: Record<string, string>}}}
		const path = `${new URL(data.url).pathname}?${new URLSearchParams(data.params)}`
		expect((await request('files.example.com', path)).status).toBe(401)
		expect((await request('photos.example.com', path, {headers: {cookie: attempt.cookie}})).status).toBe(401)
		expect((await request('files.example.com', path, {headers: {cookie: attempt.cookie}})).status).toBe(303)
	})

	test('uses normal panel login and a browser-bound callback for LAN apps without port 2000', async () => {
		await umbreld.externalAccess.configure({...panelSettings, trustedProxies: ['100.64.0.5']})
		const gateway = new AppGateway(umbreld, {...routes[0].gateway, auth: true, authWhitelist: []})
		gateway.server.listen(0, '127.0.0.1')
		await once(gateway.server, 'listening')
		const port = (gateway.server.address() as AddressInfo).port
		vi.mocked(umbreld.apps.getApp).mockReturnValue({readManifest: async () => ({port})} as never)
		const appRequest = (path: string, cookie = '') =>
			request(
				`umbrel.local:${port}`,
				path,
				{headers: {accept: 'text/html', 'x-forwarded-proto': 'http', cookie}},
				`http://127.0.0.1:${port}`,
			)
		try {
			const first = await appRequest('/details?mode=all')
			const location = new URL(first.headers.get('location')!)
			expect(location.origin).toBe('http://umbrel.local')
			expect(location.pathname).toBe('/app-access')
			const authorization = await request('umbrel.local', '/trpc/apps.authorizeAccess', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${session.dashboardToken}`,
					cookie: `UMBREL_BROWSER_SESSION=${session.browserSessionToken}; UMBREL_APP_SESSION=${session.appGatewayToken}`,
				},
				body: JSON.stringify({request: location.searchParams.get('request')}),
			})
			expect(authorization.status).toBe(200)
			const {
				result: {data},
			} = (await authorization.json()) as {result: {data: {url: string; params: Record<string, string>}}}
			const callback = await appRequest(
				`${new URL(data.url).pathname}?${new URLSearchParams(data.params)}`,
				first.headers.getSetCookie()[0].split(';')[0],
			)
			expect(callback.status).toBe(303)
			expect(callback.headers.get('location')).toBe('/details?mode=all')
			const appCookie = callback.headers.getSetCookie()[0].split(';')[0]
			expect((await appRequest('/details', appCookie)).status).toBe(200)
		} finally {
			gateway.server.closeAllConnections()
			await new Promise<void>((resolve) => gateway.server.close(() => resolve()))
		}
	})

	test('does not accept an issued ticket with another browser-bound login request', async () => {
		const first = await begin()
		const second = await begin()
		const {
			result: {data},
		} = (await (await authorize(first.id)).json()) as {result: {data: {url: string; params: Record<string, string>}}}
		const stolen = {...data.params, request: second.id}
		expect(
			(
				await request('files.example.com', `${new URL(data.url).pathname}?${new URLSearchParams(stolen)}`, {
					headers: {cookie: second.cookie},
				})
			).status,
		).toBe(401)
		expect(
			(
				await request('files.example.com', `${new URL(data.url).pathname}?${new URLSearchParams(data.params)}`, {
					headers: {cookie: first.cookie},
				})
			).status,
		).toBe(303)
	})

	test('rejects unknown hosts, spoofed proxy addresses and unencrypted external origins', async () => {
		expect((await request('unknown.example.com')).status).toBe(403)
		expect((await request('files.example.com', '/', {headers: {'x-forwarded-proto': 'http'}})).status).toBe(403)
		await umbreld.externalAccess.configure({...panelSettings, trustedProxies: ['100.64.0.5']})
		expect((await request('files.example.com', '/', {headers: {'x-forwarded-for': '100.64.0.5'}})).status).toBe(403)
	})

	test('requires paired panel credentials and denies member configuration changes', async () => {
		const attempt = await begin()
		const noCredentials = await request('panel.example.com', '/trpc/apps.authorizeAccess', {
			method: 'POST',
			headers: {'content-type': 'application/json'},
			body: JSON.stringify({request: attempt.id}),
		})
		expect(noCredentials.status).toBe(401)
		const alice = await umbreld.auth.createSession({accountId: 'alice'})
		expect((await authorize(attempt.id, alice)).status).toBe(403)
		const deniedSettings = await request('panel.example.com', '/trpc/system.setExternalAccess', {
			method: 'POST',
			headers: {...panelHeaders(alice), 'content-type': 'application/json'},
			body: JSON.stringify(settings),
		})
		expect(deniedSettings.status).toBe(403)
	})

	test('isolates app URLs from panel settings and preserves concurrent updates', async () => {
		await Promise.all([
			umbreld.externalAccess.setAppOrigin('files', 'https://new.example.com'),
			umbreld.externalAccess.configure(panelSettings),
			umbreld.externalAccess.setAppOrigin('photos', 'https://images.example.com'),
		])
		expect(umbreld.externalAccess.settings.apps).toEqual({
			files: 'https://new.example.com',
			photos: 'https://images.example.com',
		})
		expect(umbreld.externalAccess.panelSettings).toEqual(panelSettings)
		await expect(umbreld.externalAccess.setAppOrigin('files', 'https://images.example.com')).rejects.toThrow(
			'different domain',
		)
		vi.mocked(umbreld.lanIngress.refresh).mockRejectedValueOnce(new Error('Firewall unavailable'))
		await expect(umbreld.externalAccess.setAppOrigin('files', 'https://failed.example.com')).rejects.toThrow(
			'Firewall unavailable',
		)
		expect(umbreld.externalAccess.settings.apps.files).toBe('https://new.example.com')
		await umbreld.externalAccess.configure({...panelSettings, enabled: false})
		expect(umbreld.externalAccess.launchSettings('files')).toMatchObject({
			enabled: false,
			origin: 'https://new.example.com',
		})
		await expect(umbreld.externalAccess.setAppOrigin('files', 'https://disabled.example.com')).rejects.toThrow(
			'Enable external access',
		)
		expect(umbreld.externalAccess.settings.apps.files).toBe('https://new.example.com')
		await umbreld.externalAccess.setAppOrigin('files', '')
		expect(umbreld.externalAccess.settings.apps).toEqual({photos: 'https://images.example.com'})
	})

	test('only owners may change an app URL and global saves cannot replace app URLs', async () => {
		const alice = await umbreld.auth.createSession({accountId: 'alice'})
		const change = (credentials: typeof session, path: string, input: unknown) =>
			request('panel.example.com', path, {
				method: 'POST',
				headers: {...panelHeaders(credentials), 'content-type': 'application/json'},
				body: JSON.stringify(input),
			})
		expect(
			(await change(alice, '/trpc/apps.setExternalOrigin', {appId: 'files', origin: 'https://new.example.com'})).status,
		).toBe(403)
		expect((await change(session, '/trpc/system.setExternalAccess', settings)).status).toBe(400)
		expect(umbreld.externalAccess.settings.apps).toEqual(initialApps)
		expect(
			(await change(session, '/trpc/apps.setExternalOrigin', {appId: 'files', origin: ' https://new.example.com '}))
				.status,
		).toBe(200)
		expect((await change(session, '/trpc/system.setExternalAccess', panelSettings)).status).toBe(200)
		expect(umbreld.externalAccess.settings.apps).toEqual({...initialApps, files: 'https://new.example.com'})
	})

	test('rejects sibling-origin requests and revoked sessions without bypassing authentication', async () => {
		const {cookie} = await login()
		expect(
			(await request('files.example.com', '/', {headers: {cookie, origin: 'https://photos.example.com'}})).status,
		).toBe(403)
		expect((await request('files.example.com', '/', {method: 'POST', headers: {cookie}})).status).toBe(403)
		const post = await request('files.example.com', '/upload', {
			method: 'POST',
			headers: {cookie, origin: 'https://files.example.com'},
			body: 'payload',
		})
		expect(await post.json()).toMatchObject({length: 7})
		await umbreld.auth.revokeSession(session.principal.sessionId)
		expect((await request('files.example.com', '/', {headers: {cookie}})).status).toBe(401)
	})

	test('rechecks member grants after login and does not redirect denied members', async () => {
		await umbreld.store.set('appMemberShares', [{appId: 'files', sharedWith: ['alice']}])
		const alice = await umbreld.auth.createSession({accountId: 'alice'})
		const {cookie} = await login(alice)
		expect((await request('files.example.com', '/', {headers: {cookie}})).status).toBe(200)
		await umbreld.store.set('appMemberShares', [])
		const denied = await request('files.example.com', '/', {headers: {cookie, accept: 'text/html'}})
		expect(denied.status).toBe(403)
		expect(denied.headers.get('location')).toBeNull()
	})

	test('streams without waiting for the complete response and closes WebSockets on revocation', async () => {
		const {cookie} = await login()
		const controller = new AbortController()
		const streaming = await request('files.example.com', '/stream', {headers: {cookie}, signal: controller.signal})
		const reader = streaming.body!.getReader()
		expect(new TextDecoder().decode((await reader.read()).value)).toBe('first chunk')
		controller.abort()
		const socket = new WebSocket(origin.replace('http:', 'ws:') + '/socket', {
			headers: {host: 'files.example.com', 'x-forwarded-proto': 'https', origin: 'https://files.example.com', cookie},
		})
		await once(socket, 'open')
		const echoed = once(socket, 'message')
		socket.send('hello')
		expect((await echoed)[0].toString()).toBe('hello')
		const closed = once(socket, 'close')
		await umbreld.auth.revokeSession(session.principal.sessionId)
		await closed
	})

	test('never upgrades an unauthenticated or different-app socket after an authorized HTTP request', async () => {
		const {cookie} = await login()
		await (await request('files.example.com', '/', {headers: {cookie}})).text()
		for (const host of ['files.example.com', 'unknown.example.com', 'photos.example.com']) {
			const socket = new WebSocket(origin.replace('http:', 'ws:') + '/socket', {
				headers: {host, 'x-forwarded-proto': 'https'},
			})
			const [response] = await once(socket, 'unexpected-response')
			expect(response).toBeDefined()
			socket.on('error', () => {})
			socket.terminate()
		}
	})

	test('issues only one handoff per attempt and rejects concurrent callback replays', async () => {
		const attempt = await begin()
		const authorizations = await Promise.all([authorize(attempt.id), authorize(attempt.id)])
		expect(authorizations.map((response) => response.status).sort()).toEqual([200, 403])
		const {
			result: {data},
		} = (await authorizations.find((response) => response.status === 200)!.json()) as {
			result: {data: {url: string; params: Record<string, string>}}
		}
		const path = `${new URL(data.url).pathname}?${new URLSearchParams(data.params)}`
		const callbacks = await Promise.all([
			request('files.example.com', path, {headers: {cookie: attempt.cookie}}),
			request('files.example.com', path, {headers: {cookie: attempt.cookie}}),
		])
		expect(callbacks.map((response) => response.status).sort()).toEqual([303, 401])
	})

	test('invalidates pending callbacks during a configuration change and closes app sockets on stop', async () => {
		const {cookie} = await login()
		const socket = new WebSocket(origin.replace('http:', 'ws:') + '/socket', {
			headers: {host: 'files.example.com', 'x-forwarded-proto': 'https', cookie},
		})
		await once(socket, 'open')
		const closed = once(socket, 'close')
		umbreld.externalAccess.reconcile([])
		await closed
		expect((await request('files.example.com', '/', {headers: {cookie}})).status).toBe(503)
		umbreld.externalAccess.reconcile(routes)
		const attempt = await begin()
		const response = await authorize(attempt.id)
		const {
			result: {data},
		} = (await response.json()) as {result: {data: {url: string; params: Record<string, string>}}}
		const consume = umbreld.auth.consumeAppHandoff.bind(umbreld.auth)
		vi.spyOn(umbreld.auth, 'consumeAppHandoff').mockImplementation(async (...args) => {
			const result = await consume(...args)
			await umbreld.externalAccess.setAppOrigin('files', 'https://new.example.com')
			return result
		})
		// The in-flight connection is terminated when configuration is replaced.
		await expect(
			request('files.example.com', `${new URL(data.url).pathname}?${new URLSearchParams(data.params)}`, {
				headers: {cookie: attempt.cookie},
			}),
		).rejects.toThrow()
	})

	test('fails closed when disabled, retains LAN access and restores settings after an apply failure', async () => {
		await umbreld.externalAccess.configure({...panelSettings, enabled: false})
		expect((await request('files.example.com')).status).toBe(403)
		expect((await request('panel.example.com')).status).toBe(403)
		await umbreld.externalAccess.configure({...panelSettings, trustedProxies: ['100.64.0.5']})
		expect((await request('umbrel.local', '/app-access')).status).toBe(200)
		await umbreld.externalAccess.configure(panelSettings)
		vi.mocked(umbreld.lanIngress.refresh).mockRejectedValueOnce(new Error('Firewall unavailable'))
		await expect(
			umbreld.externalAccess.configure({...panelSettings, panelOrigin: 'https://new.example.com'}),
		).rejects.toThrow('Firewall unavailable')
		expect(umbreld.externalAccess.settings).toEqual(settings)
		expect(await umbreld.store.get('externalAccess')).toEqual(settings)
		await login()
	})

	test('authenticates directly published HTTP apps and forgets exposure on uninstall', async () => {
		umbreld.externalAccess.reconcile([{id: 'files', publicPort: (upstream.address() as AddressInfo).port}])
		expect((await request('files.example.com')).status).toBe(401)
		const {cookie} = await login()
		expect((await request('files.example.com', '/', {headers: {cookie}})).status).toBe(200)
		await umbreld.externalAccess.removeApp('files')
		expect(umbreld.externalAccess.settings.apps).toEqual({photos: settings.apps.photos})
		expect((await request('files.example.com', '/', {headers: {cookie}})).status).toBe(403)
	})

	test('rejects expired issued tickets and mismatched panel session credentials', async () => {
		const attempt = await begin()
		const response = await authorize(attempt.id)
		const {
			result: {data},
		} = (await response.json()) as {result: {data: {url: string; params: Record<string, string>}}}
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000)
		const expired = await request(
			'files.example.com',
			`${new URL(data.url).pathname}?${new URLSearchParams(data.params)}`,
			{headers: {cookie: attempt.cookie}},
		)
		expect(expired.status).toBe(401)
		expect(expired.headers.getSetCookie()).toEqual([])
		vi.spyOn(Date, 'now').mockRestore()
		const other = await umbreld.auth.createSession()
		const next = await begin()
		const mismatched = await request('panel.example.com', '/trpc/apps.authorizeAccess', {
			method: 'POST',
			headers: {
				...panelHeaders(other),
				authorization: `Bearer ${session.dashboardToken}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({request: next.id}),
		})
		expect(mismatched.status).toBe(401)
	})

	test('expires pending logins and invalidates sessions when domains change', async () => {
		const {cookie} = await login()
		const attempt = await begin()
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60_000)
		expect((await authorize(attempt.id)).status).toBe(403)
		vi.spyOn(Date, 'now').mockRestore()
		await umbreld.externalAccess.setAppOrigin('files', 'https://new.example.com')
		expect((await request('files.example.com', '/', {headers: {cookie}})).status).toBe(403)
		expect((await request('new.example.com', '/', {headers: {cookie}})).status).not.toBe(200)
	})
})
