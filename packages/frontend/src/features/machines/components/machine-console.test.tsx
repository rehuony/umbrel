// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {MachineConsole} from './machine-console'

const mocks = vi.hoisted(() => ({ticket: vi.fn(), initialize: vi.fn()}))
const clients: Array<EventTarget & {focus: ReturnType<typeof vi.fn>}> = []

vi.mock('@/trpc/trpc', () => ({trpcClient: {user: {createWebSocketTicket: {mutate: mocks.ticket}}}}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('@/features/machines/hooks/use-machine-audio-preference', () => ({
	useMachineAudioPreference: () => ({muted: true}),
}))
vi.mock('@/features/machines/hooks/use-machines', () => ({useMachineAgentControls: () => ({})}))
vi.mock('@/features/machines/components/machine-agent-overlay', () => ({MachineAgentOverlay: () => null}))
vi.mock('./console-agent-ownership', () => ({setConsoleAgentOwnership: vi.fn()}))
vi.mock('@/features/machines/novnc', () => ({
	RFB: class extends EventTarget {
		focus = vi.fn()
		constructor() {
			super()
			mocks.initialize()
			clients.push(this)
		}
		disconnect() {
			this.dispatchEvent(new CustomEvent('disconnect', {detail: {clean: true}}))
		}
	},
}))

class TestSocket extends EventTarget {
	static instances: TestSocket[] = []
	close = vi.fn()
	constructor() {
		super()
		TestSocket.instances.push(this)
	}
}

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let host: HTMLDivElement

beforeEach(() => {
	vi.useFakeTimers()
	vi.clearAllMocks()
	mocks.ticket.mockReset().mockResolvedValue('ticket')
	mocks.initialize.mockReset()
	clients.length = 0
	TestSocket.instances = []
	vi.stubGlobal('WebSocket', TestSocket)
	host = document.createElement('div')
	document.body.appendChild(host)
	root = createRoot(host)
})

afterEach(() => {
	act(() => root?.unmount())
	root = undefined
	vi.useRealTimers()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	document.body.replaceChildren()
})

async function renderConsole() {
	await act(async () => root!.render(<MachineConsole machineId='debian-server' resizeSession={false} />))
}

it('logs initialization failures and closes the failed socket before retrying', async () => {
	const error = new TypeError('RFB is not a constructor')
	mocks.initialize.mockImplementationOnce(function () {
		throw error
	})
	const log = vi.spyOn(console, 'error').mockImplementation(() => {})
	await renderConsole()
	expect(host.textContent).toContain('machines.console-disconnected')
	expect(log).toHaveBeenCalledWith('Failed to initialize machine console', error)
	expect(TestSocket.instances[0].close).toHaveBeenCalledOnce()

	await act(async () => vi.advanceTimersByTimeAsync(1_000))
	expect(mocks.ticket).toHaveBeenCalledTimes(2)
	expect(clients).toHaveLength(1)
	act(() => clients[0].dispatchEvent(new Event('connect')))
	expect(host.textContent).not.toContain('machines.console-disconnected')
	expect(clients[0].focus).toHaveBeenCalledOnce()
})

it.each([true, false])('reconnects after a remote disconnect with clean=%s', async (clean) => {
	await renderConsole()
	act(() => {
		clients[0].dispatchEvent(new Event('connect'))
		TestSocket.instances[0].dispatchEvent(new CloseEvent('close', {code: 1000}))
		clients[0].dispatchEvent(new CustomEvent('disconnect', {detail: {clean}}))
	})
	expect(host.textContent).toContain('machines.console-disconnected')
	expect(TestSocket.instances[0].close).toHaveBeenCalledOnce()
	await act(async () => vi.advanceTimersByTimeAsync(1_000))
	expect(mocks.ticket).toHaveBeenCalledTimes(2)
	expect(clients).toHaveLength(2)
})

it('does not reconnect and steal control from another viewer', async () => {
	await renderConsole()
	act(() => {
		TestSocket.instances[0].dispatchEvent(new CloseEvent('close', {code: 4001}))
		clients[0].dispatchEvent(new CustomEvent('disconnect', {detail: {clean: false}}))
	})
	expect(host.textContent).toContain('machines.console-controlled-elsewhere')
	await act(async () => vi.advanceTimersByTimeAsync(5_000))
	expect(mocks.ticket).toHaveBeenCalledOnce()
})

it('does not retry when a pending ticket request fails after the viewer unmounts', async () => {
	let rejectTicket!: (error: Error) => void
	mocks.ticket.mockReturnValue(new Promise((_resolve, reject) => (rejectTicket = reject)))
	const log = vi.spyOn(console, 'error').mockImplementation(() => {})
	await renderConsole()
	act(() => root!.unmount())
	root = undefined
	await act(async () => rejectTicket(new Error('Session ended')))
	expect(log).not.toHaveBeenCalled()
	expect(vi.getTimerCount()).toBe(0)
	expect(TestSocket.instances).toHaveLength(0)
})
