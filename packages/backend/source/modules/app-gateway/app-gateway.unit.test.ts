import {once} from 'node:events'
import {afterEach, describe, expect, test, vi} from 'vitest'
import fse from 'fs-extra'
import {WebSocket} from 'ws'

import temporaryDirectory from '../utilities/temporary-directory.js'
import AppGateway, {readAppGatewayConfig} from './app-gateway.js'
import {appGatewayErrorPage} from './error-page.js'

describe('app gateway configuration', () => {
	const directories: Array<ReturnType<typeof temporaryDirectory>> = []

	afterEach(async () => {
		await Promise.all(directories.splice(0).map((directory) => directory.destroyRoot()))
	})

	test('reads existing app_proxy settings without adding the service to umbreld', async () => {
		const config = await readAppGatewayConfig(
			'files',
			'/does-not-exist',
			{
				services: {
					app_proxy: {
						environment: {
							APP_HOST: 'files_web_1',
							APP_PORT: 8080,
						},
					},
				},
			},
			{name: 'Files', icon: 'https://example.com/files.svg'},
		)

		expect(config).toMatchObject({
			appId: 'files',
			appName: 'Files',
			appIcon: 'https://example.com/files.svg',
			targetProtocol: 'http',
			targetHost: 'files_web_1',
			targetPort: 8080,
		})
	})

	test('rejects app_proxy settings without an upstream', async () => {
		await expect(readAppGatewayConfig('files', '/does-not-exist', {services: {app_proxy: {}}})).resolves.toBeNull()
	})

	test('prefers Compose-rendered settings and reads upstream overrides from the app root', async () => {
		const directory = temporaryDirectory()
		directories.push(directory)
		await directory.createRoot()
		const appDirectory = await directory.create()
		await fse.writeJson(`${appDirectory}/app-gateway.json`, {
			APP_HOST: '10.21.21.2',
			APP_PORT: '3000',
		})

		await fse.writeFile(`${appDirectory}/.env.app_proxy`, 'APP_PORT=4000\n')
		const config = await readAppGatewayConfig('files', appDirectory, {
			services: {app_proxy: {environment: {APP_HOST: '$APP_FILES_IP', APP_PORT: '$APP_FILES_PORT'}}},
		})

		expect(config).toMatchObject({targetHost: '10.21.21.2', targetPort: 4000})
	})
})

describe('app gateway upstream recovery', () => {
	function unreachableGateway(onUpstreamUnavailable = vi.fn()) {
		const logger = {error: vi.fn()}
		return {
			gateway: new AppGateway(
				{logger} as never,
				{
					appId: 'files',
					appName: 'Files',
					appIcon: 'https://example.com/files.svg',
					targetProtocol: 'http',
					targetHost: 'files_web_1',
					targetAddress: '127.0.0.1',
					targetPort: 1,
					trustUpstream: false,
					timeout: 100,
				},
				{onUpstreamUnavailable},
			),
			logger,
			onUpstreamUnavailable,
		}
	}

	test('returns the branded app error page and notifies LAN ingress when the upstream is unreachable', async () => {
		const {gateway, onUpstreamUnavailable} = unreachableGateway()
		await new Promise<void>((resolve) => gateway.server.listen(0, '127.0.0.1', resolve))
		try {
			const address = gateway.server.address()
			if (!address || typeof address === 'string') throw new Error('Gateway did not listen on TCP')
			const response = await fetch(`http://127.0.0.1:${address.port}/`)
			expect(response.status).toBe(502)
			expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
			expect(response.headers.get('cache-control')).toBe('no-store')
			const body = await response.text()
			expect(body).toContain('Oops, there was an error')
			expect(body).toContain('There was an error connecting to Files.')
			expect(body).toContain('Error code: ECONNREFUSED')
			expect(body).toContain('src="https://example.com/files.svg"')
			expect(onUpstreamUnavailable).toHaveBeenCalledTimes(1)
		} finally {
			await new Promise<void>((resolve) => gateway.server.close(() => resolve()))
		}
	})

	test('closes a failed upstream WebSocket without crashing the gateway', async () => {
		const {gateway, onUpstreamUnavailable} = unreachableGateway()
		await new Promise<void>((resolve) => gateway.server.listen(0, '127.0.0.1', resolve))
		try {
			const address = gateway.server.address()
			if (!address || typeof address === 'string') throw new Error('Gateway did not listen on TCP')

			await new Promise<void>((resolve, reject) => {
				const socket = new WebSocket(`ws://127.0.0.1:${address.port}/socket`)
				const timeout = setTimeout(() => {
					socket.terminate()
					reject(new Error('Failed upstream WebSocket did not close'))
				}, 2_000)
				socket.once('open', () => reject(new Error('WebSocket unexpectedly connected to unreachable upstream')))
				socket.once('error', () => {})
				socket.once('close', () => {
					clearTimeout(timeout)
					resolve()
				})
			})

			expect(onUpstreamUnavailable).toHaveBeenCalledTimes(1)
			// A subsequent request proves the asynchronous WebSocket failure did not
			// terminate or wedge the gateway.
			const response = await fetch(`http://127.0.0.1:${address.port}/`)
			expect(response.status).toBe(502)
			expect(onUpstreamUnavailable).toHaveBeenCalledTimes(2)
		} finally {
			await new Promise<void>((resolve) => gateway.server.close(() => resolve()))
		}
	})
})

describe('app gateway error page', () => {
	test('escapes app metadata and error codes before rendering them as HTML', () => {
		const body = appGatewayErrorPage({
			appName: '<script>alert(1)</script>',
			appIcon: 'https://example.com/icon.svg" onerror="alert(1)',
			errorCode: '<BAD>',
		})

		expect(body).not.toContain('<script>')
		expect(body).not.toContain('onerror="alert(1)')
		expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
		expect(body).toContain('icon.svg&quot; onerror=&quot;alert(1)')
		expect(body).toContain('Error code: &lt;BAD&gt;')
	})
})

describe('transparent application transport', () => {
	test('preserves native HTTP authentication and WebSockets without a panel session', async () => {
		const {createServer} = await import('node:http')
		const {WebSocketServer} = await import('ws')
		const upstream = createServer((request, response) => {
			if (request.url === '/native-login') {
				response.writeHead(401, {'www-authenticate': 'Basic realm="App"'})
				response.end('Sign in to this app')
			} else response.end(JSON.stringify({url: request.url, headers: request.headers}))
		})
		const ws = new WebSocketServer({server: upstream})
		ws.on('connection', (socket, request) => socket.send(JSON.stringify(request.headers)))
		upstream.listen(0, '127.0.0.1')
		await once(upstream, 'listening')
		const port = (upstream.address() as import('node:net').AddressInfo).port
		const gateway = new AppGateway({logger: {error: vi.fn()}} as never, {
			appId: 'service',
			appName: 'Service',
			appIcon: '',
			targetProtocol: 'http',
			targetHost: '127.0.0.1',
			targetPort: port,
			trustUpstream: false,
			timeout: 0,
		})
		gateway.server.listen(0, '127.0.0.1')
		await once(gateway.server, 'listening')
		const origin = `http://127.0.0.1:${(gateway.server.address() as import('node:net').AddressInfo).port}`
		let socket: WebSocket | undefined
		try {
			const denied = await fetch(`${origin}/native-login`)
			expect(denied.status).toBe(401)
			expect(denied.headers.get('www-authenticate')).toBe('Basic realm="App"')
			expect(await denied.text()).toBe('Sign in to this app')
			const headers = {
				authorization: 'Bearer native-token',
				cookie: 'app_session=native; UMBREL_BROWSER_SESSION=panel; __Host-UMBREL_BROWSER_SESSION_HTTPS=panel',
			}
			const result = await (await fetch(`${origin}/api/v1?key=value`, {headers})).json()
			expect(result).toMatchObject({
				url: '/api/v1?key=value',
				headers: {authorization: 'Bearer native-token', cookie: 'app_session=native'},
			})
			socket = new WebSocket(`${origin.replace('http:', 'ws:')}/events`, {headers})
			const [message] = await once(socket, 'message', {signal: AbortSignal.timeout(5000)})
			expect(JSON.parse(message.toString())).toMatchObject({
				authorization: 'Bearer native-token',
				cookie: 'app_session=native',
			})
		} finally {
			socket?.terminate()
			for (const client of ws.clients) client.terminate()
			ws.close()
			await Promise.all(
				[gateway.server, upstream].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
			)
		}
	})
})
