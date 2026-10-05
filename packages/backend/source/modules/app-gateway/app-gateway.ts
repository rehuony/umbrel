import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

import dotenv from 'dotenv'
import fse from 'fs-extra'
import type {Compose} from 'compose-spec-schema'
import httpProxy from 'http-proxy'

import type Umbreld from '../../index.js'
import {stripBrowserSessionCookies} from '../auth/browser-session-cookie.js'
import {appGatewayErrorPage} from './error-page.js'

export type AppGatewayConfig = {
	appId: string
	appName: string
	appIcon: string
	targetProtocol: 'http' | 'https'
	targetHost: string
	targetAddress?: string
	targetPort: number
	trustUpstream: boolean
	timeout: number
}

type AppGatewayOptions = {
	onUpstreamUnavailable?: () => void
}

function environmentRecord(environment: unknown) {
	if (Array.isArray(environment)) {
		return Object.fromEntries(
			environment.flatMap((entry) => {
				if (typeof entry !== 'string') return []
				const separator = entry.indexOf('=')
				return separator < 0 ? [[entry, '']] : [[entry.slice(0, separator), entry.slice(separator + 1)]]
			}),
		)
	}
	if (!environment || typeof environment !== 'object') return {}
	return Object.fromEntries(
		Object.entries(environment).map(([name, value]) => [name, value === null ? '' : String(value)]),
	)
}

export async function readAppGatewayConfig(
	appId: string,
	dataDirectory: string,
	compose: Compose,
	appMetadata: {name?: string; icon?: string} = {},
) {
	const appProxy = compose.services?.app_proxy
	if (!appProxy) return null

	const renderedEnvironment = await fse.readJson(`${dataDirectory}/app-gateway.json`).catch(() => null)
	const environment = environmentRecord(renderedEnvironment ?? appProxy.environment)
	const customEnvironment = await fse
		.readFile(`${dataDirectory}/.env.app_proxy`, 'utf8')
		.then((contents) => dotenv.parse(contents))
		.catch(() => ({}))
	const config = {...environment, ...customEnvironment}
	const targetHost = config.APP_HOST?.trim()
	const targetPort = Number(config.APP_PORT)
	if (!targetHost || !Number.isInteger(targetPort) || targetPort <= 0 || targetPort > 65_535) return null

	return {
		appId,
		appName: appMetadata.name?.trim() || appId,
		appIcon:
			appMetadata.icon?.trim() ||
			`https://getumbrel.github.io/umbrel-apps-gallery/${encodeURIComponent(appId)}/icon.svg`,
		targetProtocol: config.APP_PROTOCOL === 'https' ? 'https' : 'http',
		targetHost,
		targetPort,
		trustUpstream: config.PROXY_TRUST_UPSTREAM === 'true',
		timeout: Math.max(0, Number(config.PROXY_TIMEOUT) || 0),
	} satisfies AppGatewayConfig
}

function hostWithPort(hostname: string, port: number) {
	const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
	return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

export default class AppGateway {
	#umbreld: Umbreld
	#config: AppGatewayConfig
	#onUpstreamUnavailable?: () => void
	#proxy: httpProxy
	#agent: http.Agent
	server: http.Server

	constructor(umbreld: Umbreld, config: AppGatewayConfig, options: AppGatewayOptions = {}) {
		this.#umbreld = umbreld
		this.#config = config
		this.#onUpstreamUnavailable = options.onUpstreamUnavailable
		this.#agent =
			config.targetProtocol === 'https'
				? new https.Agent({keepAlive: true, servername: config.targetHost})
				: new http.Agent({keepAlive: true})
		this.#proxy = this.createProxy()

		this.server = http.createServer((request, response) => {
			this.#proxy.web(request, response, {}, (error) => {
				if (error) this.handleUpstreamError(response, error)
			})
		})
		this.server.once('close', () => {
			this.#proxy.close()
			this.#agent.destroy()
		})
		// Let upstream apps enforce their own upload deadlines, as LAN ingress does.
		// Keep the separate timeout for receiving request headers.
		this.server.requestTimeout = 0
		this.server.on('upgrade', (request, socket, head) => {
			this.#proxy.ws(request, socket, head)
		})
	}

	private createProxy() {
		const targetHost = hostWithPort(this.#config.targetAddress ?? this.#config.targetHost, this.#config.targetPort)
		// Use the existing proxy engine directly: each gateway owns its lifecycle,
		// and HTTP and WebSocket traffic share the same transparent transport.
		const proxy = httpProxy.createProxyServer({
			target: `${this.#config.targetProtocol}://${targetHost}`,
			agent: this.#agent,
			changeOrigin: false,
			xfwd: false,
			proxyTimeout: this.#config.timeout,
			followRedirects: false,
		})
		const prepare = (proxyRequest: http.ClientRequest, request: http.IncomingMessage) => {
			if (!this.#config.trustUpstream) {
				const protocol =
					request.headers['x-forwarded-proto'] === 'https' && request.socket.remoteAddress === '127.0.0.1'
						? 'https'
						: 'http'
				proxyRequest.removeHeader('forwarded')
				proxyRequest.setHeader('x-forwarded-proto', protocol)
				if (request.headers.host) proxyRequest.setHeader('x-forwarded-host', request.headers.host)
				proxyRequest.setHeader('x-forwarded-for', request.socket.remoteAddress ?? '')
			}
			this.stripCookies(proxyRequest, request)
		}
		proxy.on('proxyReq', prepare)
		proxy.on('proxyReqWs', prepare)
		proxy.on('error', (error, _request, response) => this.handleUpstreamError(response, error))
		return proxy
	}

	private handleUpstreamError(response: http.ServerResponse | net.Socket, error?: unknown) {
		try {
			this.#umbreld.logger.error(`App gateway upstream error for ${this.#config.appId}`, error)
			this.#onUpstreamUnavailable?.()
			this.sendUpstreamError(response, error)
		} catch (handlerError) {
			// Proxy errors are emitted asynchronously. Never let an error while
			// reporting one escape the event handler and terminate umbreld.
			try {
				this.#umbreld.logger.error(`Failed to handle app gateway error for ${this.#config.appId}`, handlerError)
			} catch {}
			this.destroyProxyResponse(response)
		}
	}

	private sendUpstreamError(response: http.ServerResponse | net.Socket, error?: unknown) {
		// http-proxy passes a raw socket here for WebSocket failures even though
		// http-proxy-middleware types it as an HTTP response.
		if (typeof (response as http.ServerResponse).writeHead !== 'function') {
			this.destroyProxyResponse(response)
			return
		}

		const httpResponse = response as http.ServerResponse
		if (httpResponse.headersSent) {
			this.destroyProxyResponse(httpResponse)
			return
		}
		const errorCode =
			error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined
		const body = appGatewayErrorPage({...this.#config, errorCode})
		httpResponse.writeHead(502, {
			'cache-control': 'no-store',
			'content-length': Buffer.byteLength(body),
			'content-security-policy':
				"default-src 'none'; img-src 'self' https: http: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
			'content-type': 'text/html; charset=utf-8',
			'referrer-policy': 'no-referrer',
		})
		httpResponse.end(body)
	}

	private destroyProxyResponse(response: http.ServerResponse | net.Socket) {
		try {
			response.destroy()
		} catch {}
	}

	private stripCookies(proxyRequest: http.ClientRequest, request: http.IncomingMessage) {
		const cookies = stripBrowserSessionCookies(request.headers.cookie)
		if (cookies) proxyRequest.setHeader('cookie', cookies)
		else proxyRequest.removeHeader('cookie')
	}
}
