// @vitest-environment jsdom
import {act, StrictMode, type PropsWithChildren} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import AppAccess from './app-access'

const mocks = vi.hoisted(() => ({authorize: vi.fn(), t: (key: string) => key}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: mocks.t})}))
vi.mock('@/modules/auth/ensure-logged-in', () => ({EnsureLoggedIn: ({children}: PropsWithChildren) => children}))
vi.mock('@/components/ui/cover-message', () => ({
	BareCoverMessage: ({children}: PropsWithChildren) => <div>{children}</div>,
}))
vi.mock('@/trpc/trpc', () => ({trpcClient: {apps: {authorizeAccess: {mutate: mocks.authorize}}}}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
const replace = vi.fn()
beforeEach(() => {
	vi.clearAllMocks()
	vi.stubGlobal('location', {replace})
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})
afterEach(() => {
	act(() => root.unmount())
	container.remove()
	vi.unstubAllGlobals()
})
const render = async () =>
	act(async () =>
		root.render(
			<StrictMode>
				<MemoryRouter initialEntries={['/app-access?request=pending']}>
					<AppAccess />
				</MemoryRouter>
			</StrictMode>,
		),
	)
test('authorizes once and replaces the login URL with the server-owned callback', async () => {
	mocks.authorize.mockResolvedValue({
		url: 'https://app.example.com/umbrel_/api/v1/auth/handoff',
		params: {request: 'pending', handoff: 'ticket'},
	})
	await render()
	expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith({request: 'pending'})
	expect(replace).toHaveBeenCalledExactlyOnceWith(
		'https://app.example.com/umbrel_/api/v1/auth/handoff?request=pending&handoff=ticket',
	)
})
test('keeps denied users on an error screen instead of redirecting them through login again', async () => {
	mocks.authorize.mockRejectedValue(new Error('App not shared with this account'))
	await render()
	expect(container.querySelector('[role=alert]')?.textContent).toContain('not shared')
	expect(replace).not.toHaveBeenCalled()
})
test('does not navigate after the user has left the handoff page', async () => {
	let complete!: (result: {url: string; params: Record<string, string>}) => void
	mocks.authorize.mockImplementation(
		() =>
			new Promise((resolve) => {
				complete = resolve
			}),
	)
	await render()
	act(() => root.render(null))
	await act(async () => complete({url: 'https://app.example.com', params: {handoff: 'ticket'}}))
	expect(replace).not.toHaveBeenCalled()
})
