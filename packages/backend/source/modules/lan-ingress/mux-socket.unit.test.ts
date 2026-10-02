import {once} from 'node:events'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fse from 'fs-extra'
import {execa} from 'execa'
import {WebSocket, WebSocketServer} from 'ws'
import {afterAll, afterEach, beforeAll, expect, test, vi} from 'vitest'
import LanIngress from './lan-ingress.js'

let directory: string
let certificate: string
let ingress: any
const servers: net.Server[] = []
const sockets = new Set<net.Socket>()
beforeAll(async () => {
	directory = await fse.mkdtemp(path.join(os.tmpdir(), 'panel-mux-'))
	await execa('openssl', [
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-days',
		'1',
		'-subj',
		'/CN=panel.example',
		'-addext',
		'subjectAltName=DNS:panel.example',
		'-keyout',
		`${directory}/key.pem`,
		'-out',
		`${directory}/cert.pem`,
	])
	certificate = await fse.readFile(`${directory}/cert.pem`, 'utf8')
	const logger = {createChildLogger: () => ({log: vi.fn(), error: vi.fn(), verbose: vi.fn()})}
	ingress = new LanIngress({dataDirectory: directory, logger} as never)
	ingress.serverCertificatePath = `${directory}/cert.pem`
	ingress.serverKeyPath = `${directory}/key.pem`
})
afterEach(async () => {
	for (const socket of sockets) socket.destroy()
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})
afterAll(async () => {
	if (directory) await fse.remove(directory)
})

async function listen(server: net.Server) {
	servers.push(server)
	server.on('connection', (socket) => {
		sockets.add(socket)
		socket.on('error', () => {})
		socket.once('close', () => sockets.delete(socket))
	})
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	return (server.address() as net.AddressInfo).port
}
async function setup() {
	const backend = http.createServer(async (request, response) => {
		const chunks = []
		for await (const chunk of request) chunks.push(chunk)
		response.end(Buffer.concat(chunks))
	})
	const ws = new WebSocketServer({noServer: true})
	ws.on('connection', (socket) => socket.on('message', (message) => socket.send(message)))
	backend.on('upgrade', (request, socket, head) =>
		ws.handleUpgrade(request, socket, head, (peer) => ws.emit('connection', peer)),
	)
	const upstreamPort = await listen(backend)
	const proxy = await ingress.createHttpsProxyServer(upstreamPort, {includeForwardedFor: false})
	await listen(proxy)
	return listen(ingress.createMuxServer({listenPort: 0, httpPort: upstreamPort, getHttpsProxyServer: () => proxy}))
}

test.each([false, true])('preserves large request bodies through the browser mux with TLS: %s', async (secure) => {
	const port = await setup()
	const body = 'request body'.repeat(65536)
	const result = await new Promise<string>((resolve, reject) => {
		const request = (secure ? https : http).request(
			{hostname: '127.0.0.1', port, method: 'POST', ca: certificate, servername: 'panel.example', agent: false},
			(response) => {
				let result = ''
				response.on('data', (chunk) => (result += chunk))
				response.once('end', () => resolve(result))
				response.once('error', reject)
			},
		)
		request.once('error', reject)
		request.end(body)
	})
	expect(result).toBe(body)
})

test.each([false, true])('forwards bidirectional browser WebSockets with TLS: %s', async (secure) => {
	const port = await setup()
	const socket = new WebSocket(`${secure ? 'wss' : 'ws'}://127.0.0.1:${port}/`, {
		...{ca: certificate, servername: 'panel.example'},
		handshakeTimeout: 5000,
	})
	try {
		await once(socket, 'open')
		const message = once(socket, 'message')
		socket.send('browser websocket')
		expect(String((await message)[0])).toBe('browser websocket')
	} finally {
		socket.terminate()
	}
})

test('closes incomplete protocol prefixes without blocking ordinary requests', async () => {
	const port = await setup()
	const socket = net.connect({host: '127.0.0.1', port})
	await once(socket, 'connect')
	socket.write(Buffer.from([0x16, 0x03]))
	const closed = once(socket, 'close')
	expect(await (await fetch(`http://127.0.0.1:${port}/`, {method: 'POST', body: 'ok'})).text()).toBe('ok')
	await closed
}, 10000)
