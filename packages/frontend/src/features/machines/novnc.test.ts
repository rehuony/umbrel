// @vitest-environment jsdom

import path from 'node:path'
import {build} from 'vite'
import {afterEach, expect, it, vi} from 'vitest'

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	document.body.replaceChildren()
})

it('initializes the production noVNC bundle and starts a VNC handshake over HTTP', async () => {
	// An ordinary Vitest import uses different CommonJS interop from the deployed
	// dashboard. Exercise the real Vite config and installed noVNC in a browser bundle.
	const result = await build({
		root: path.resolve(import.meta.dirname, '../../..'),
		logLevel: 'silent',
		build: {
			write: false,
			lib: {
				entry: path.resolve(import.meta.dirname, 'novnc.ts'),
				name: 'MachineVnc',
				formats: ['iife'],
			},
			rolldownOptions: {output: {codeSplitting: false}},
		},
	})
	const output = Array.isArray(result) ? result[0] : result
	if (!('output' in output)) throw new Error('Expected a generated browser bundle')
	const chunk = output.output.find((chunk) => chunk.type === 'chunk' && chunk.isEntry)
	if (!chunk || chunk.type !== 'chunk') throw new Error('Missing noVNC entry chunk')

	vi.stubGlobal('isSecureContext', false)
	// noVNC warns about HTTP, but the QEMU console uses neither encrypted VNC
	// authentication nor browser clipboard APIs that require a secure context.
	vi.spyOn(console, 'error').mockImplementation(() => {})
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
		clearRect: vi.fn(),
	} as unknown as CanvasRenderingContext2D)
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			disconnect() {}
		},
	)
	const {RFB} = new Function(`${chunk.code}; return MachineVnc;`)() as typeof import('./novnc')
	const target = document.createElement('div')
	document.body.appendChild(target)
	const socket = {
		binaryType: 'arraybuffer',
		protocol: 'binary',
		readyState: WebSocket.CONNECTING as number,
		onopen: undefined as ((event: Event) => void) | undefined,
		onmessage: undefined as ((event: MessageEvent) => void) | undefined,
		onclose: undefined as ((event: CloseEvent) => void) | undefined,
		onerror: undefined,
		send: vi.fn(),
		close: vi.fn(() => {
			socket.readyState = WebSocket.CLOSED
			socket.onclose?.(new CloseEvent('close', {code: 1000}))
		}),
	}
	const client = new RFB(target, socket as unknown as WebSocket, {shared: true})
	try {
		expect(target.querySelector('canvas')).not.toBeNull()
		socket.readyState = WebSocket.OPEN
		socket.onopen?.(new Event('open'))
		socket.onmessage?.(new MessageEvent('message', {data: new TextEncoder().encode('RFB 003.008\n').buffer}))
		expect(socket.send).toHaveBeenCalledOnce()
		expect(new TextDecoder().decode(socket.send.mock.calls[0][0])).toBe('RFB 003.008\n')
	} finally {
		client.disconnect()
	}
	expect(socket.close).toHaveBeenCalled()
}, 20_000)
