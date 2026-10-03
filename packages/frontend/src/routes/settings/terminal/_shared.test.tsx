// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {XTermTerminal} from './_shared'

const state = vi.hoisted(() => ({
	getTicket: vi.fn(),
	sockets: [] as Array<{readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>}>,
	terminals: [] as Array<{
		cols: number
		rows: number
		resize: (cols: number, rows: number) => void
		dispose: ReturnType<typeof vi.fn>
	}>,
	observers: [] as Array<{callback: () => void; disconnect: ReturnType<typeof vi.fn>}>,
}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/hooks/use-is-mobile', () => ({useIsMobile: () => false}))
vi.mock('@/features/files/hooks/use-is-touch-device', () => ({useIsTouchDevice: () => false}))
vi.mock('@/trpc/trpc', () => ({trpcClient: {user: {createWebSocketTicket: {mutate: state.getTicket}}}}))
vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit() {}
	},
}))
vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		cols = 80
		rows = 24
		options = {}
		buffer = {active: {cursorX: 0}}
		dispose = vi.fn()
		onResizeListener = () => {}
		constructor() {
			state.terminals.push(this)
		}
		loadAddon() {}
		open() {}
		focus() {}
		onData() {}
		onResize(callback: () => void) {
			this.onResizeListener = callback
		}
		resize(cols: number, rows: number) {
			this.cols = cols
			this.rows = rows
			this.onResizeListener()
		}
	},
}))
Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement

beforeEach(() => {
	state.getTicket.mockReset().mockResolvedValue('test-ticket')
	state.sockets.length = 0
	state.terminals.length = 0
	state.observers.length = 0
	vi.stubGlobal(
		'ResizeObserver',
		class {
			disconnect = vi.fn()
			constructor(public callback: () => void) {
				state.observers.push(this)
			}
			observe() {}
		},
	)
	vi.stubGlobal(
		'WebSocket',
		class {
			static OPEN = 1
			readyState = 1
			send = vi.fn()
			close = vi.fn(() => {
				this.readyState = 3
			})
			constructor() {
				state.sockets.push(this)
			}
			addEventListener() {}
		},
	)
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})
afterEach(() => {
	act(() => root.unmount())
	container.remove()
	vi.unstubAllGlobals()
})

test('retains the authenticated shell on resize and tears it down only on target change or close', async () => {
	await act(async () => root.render(<XTermTerminal />))
	const shell = state.terminals[0]
	const socket = state.sockets[0]
	act(() => {
		state.observers[0].callback()
		shell.resize(120, 40)
	})
	expect(state.getTicket).toHaveBeenCalledTimes(1)
	expect(state.terminals).toHaveLength(1)
	expect(socket.close).not.toHaveBeenCalled()
	const message = socket.send.mock.calls[0][0] as Uint8Array
	expect(JSON.parse(new TextDecoder().decode(message))).toEqual({type: 'resize', cols: 120, rows: 40})

	await act(async () => root.render(<XTermTerminal appId='tailscale' />))
	expect(socket.close).toHaveBeenCalledTimes(1)
	expect(shell.dispose).toHaveBeenCalledTimes(1)
	expect(state.observers[0].disconnect).toHaveBeenCalledTimes(1)
	expect(state.getTicket).toHaveBeenCalledTimes(2)
	expect(state.sockets).toHaveLength(2)
})
