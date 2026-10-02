import http from 'node:http'
import {once} from 'node:events'
import {afterAll, beforeAll, expect, test, vi} from 'vitest'
import {WebSocket, WebSocketServer} from 'ws'
import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let host: Awaited<ReturnType<typeof createTestUmbreld>>
const ui = http.createServer((_request, response) => response.end('development UI'))
const uiSockets = new WebSocketServer({server: ui})
const upgradedPaths: string[] = []
uiSockets.on('connection', (socket, request) => {
	upgradedPaths.push(request.url ?? '')
	socket.send('hmr')
})

beforeAll(async () => {
	ui.listen(0, '127.0.0.1')
	await once(ui, 'listening')
	vi.stubEnv('NODE_ENV', 'development')
	vi.stubEnv('UMBREL_UI_PROXY', `http://127.0.0.1:${(ui.address() as import('node:net').AddressInfo).port}`)
	host = await createTestUmbreld({autoLogin: true})
})

afterAll(async () => {
	await host?.cleanup()
	for (const socket of uiSockets.clients) socket.terminate()
	uiSockets.close()
	await new Promise<void>((resolve) => ui.close(() => resolve()))
	vi.unstubAllEnvs()
})

test('development UI and app-auth proxies leave authenticated tRPC sockets to the server', async () => {
	const origin = `http://127.0.0.1:${host.instance.server.port}`
	const document = await fetch(origin)
	expect(await document.text()).toBe('development UI')
	expect(
		document.headers
			.get('content-security-policy')
			?.split(';')
			.find((rule) => rule.startsWith('connect-src')),
	).toBe("connect-src 'self'")
	await fetch(`${origin}/app-auth/`)
	const ticket = await host.client.user.createWebSocketTicket.mutate({target: 'trpc'})
	const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/trpc?ticket=${ticket}`)
	try {
		await once(socket, 'open', {signal: AbortSignal.timeout(5000)})
		const reply = once(socket, 'message', {signal: AbortSignal.timeout(5000)})
		socket.send(JSON.stringify({id: 1, method: 'query', params: {path: 'user.get'}}))
		const [data] = await reply
		expect(JSON.parse(data.toString())).toMatchObject({id: 1, result: {data: {name: 'satoshi'}}})
		expect(upgradedPaths).toEqual([])
	} finally {
		socket.terminate()
	}
	const hmr = new WebSocket(`${origin.replace('http:', 'ws:')}/`)
	try {
		const [data] = await once(hmr, 'message', {signal: AbortSignal.timeout(5000)})
		expect(data.toString()).toBe('hmr')
		expect(upgradedPaths).toEqual(['/'])
	} finally {
		hmr.terminate()
	}
})
