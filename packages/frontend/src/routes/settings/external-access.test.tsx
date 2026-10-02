// @vitest-environment jsdom
import {act, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {Dialog} from '@/components/ui/dialog'
import {ExternalAccessSettingsView, ExternalAccessSetupRow} from '@/modules/app-store/app-page/app-settings-advanced'
import type {UserApp} from '@/trpc/trpc'

import {ExternalAccessPanel} from './external-access'

const mocks = vi.hoisted(() => ({
	mutate: vi.fn(),
	query: {} as any,
	apps: {} as any,
	pending: false,
	error: undefined as Error | undefined,
}))
vi.mock('@/modules/global-dialogs', () => ({prefetchGlobalDialog: vi.fn()}))
vi.mock('@/providers/wallpaper', () => ({useWallpaper: () => ({wallpaper: {brandColorHsl: '200 80% 50%'}})}))
vi.mock('react-i18next', async (importOriginal) => ({
	...(await importOriginal<typeof import('react-i18next')>()),
	useTranslation: () => ({t: (key: string) => key}),
}))
vi.mock('@/components/ui/toast', () => ({toast: {success: vi.fn()}}))
vi.mock('./_components/shared', () => ({
	Divider: () => <hr />,
	BackButton: ({children, onClick}: any) => (
		<button type='button' onClick={onClick}>
			{children}
		</button>
	),
}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => ({system: {externalAccess: {invalidate: vi.fn()}}, apps: {list: {invalidate: vi.fn()}}}),
		system: {
			externalAccess: {useQuery: () => mocks.query},
			setExternalAccess: {useMutation: () => ({mutate: mocks.mutate, isPending: mocks.pending, error: mocks.error})},
		},
		apps: {list: {useQuery: () => mocks.apps}},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const back = vi.fn()
beforeEach(() => {
	vi.clearAllMocks()
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	)
	mocks.query = {data: {enabled: false, panelOrigin: '', trustedProxies: []}}
	mocks.apps = {
		data: [
			{id: 'files', name: 'Files', port: 3000},
			{id: 'worker', name: 'Worker', port: 0},
		],
	}
	mocks.pending = false
	mocks.error = undefined
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})
afterEach(() => {
	act(() => root.unmount())
	container.remove()
	vi.unstubAllGlobals()
})
const render = () => {
	if (mocks.query.data) mocks.query = {...mocks.query, data: {...mocks.query.data}}
	act(() => root.render(<ExternalAccessPanel onBack={back} />))
}
const input = (placeholder: string) => container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!
const fill = (element: HTMLInputElement, value: string) =>
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
		element.dispatchEvent(new Event('input', {bubbles: true}))
	})
test('saves only panel and proxy settings without sending application URLs', () => {
	render()
	expect(input('https://worker.example.com')).toBeNull()
	fill(input('https://panel.example.com'), ' https://panel.example.com ')
	fill(input('100.64.0.10'), '100.64.0.10, 100.64.0.11')
	expect(input('https://files.example.com')).toBeNull()
	act(() => container.querySelector<HTMLButtonElement>('[type=submit]')!.click())
	expect(mocks.mutate).toHaveBeenCalledWith({
		enabled: false,
		panelOrigin: 'https://panel.example.com',
		trustedProxies: ['100.64.0.10', '100.64.0.11'],
	})
	expect(back).not.toHaveBeenCalled()
})
test('retains input after a save error and blocks duplicate submissions while saving', () => {
	render()
	fill(input('https://panel.example.com'), 'https://panel.example.com')
	mocks.error = new Error('Proxy settings could not be applied')
	render()
	expect(container.querySelector('[role=alert]')?.textContent).toContain('could not be applied')
	expect(input('https://panel.example.com').value).toBe('https://panel.example.com')
	mocks.pending = true
	render()
	expect(container.querySelector<HTMLButtonElement>('[type=submit]')!.disabled).toBe(true)
	expect(input('https://panel.example.com').disabled).toBe(true)
})
test('does not render an editable default configuration when the saved settings cannot be read', () => {
	mocks.query = {isError: true}
	render()
	expect(container.querySelector('[role=alert]')?.textContent).toBe('external-access.load-error')
	expect(container.querySelector('form')).toBeNull()
})

test('offers global setup without making the disabled application row navigable', () => {
	const configure = vi.fn()
	act(() => root.render(<ExternalAccessSetupRow onConfigure={configure} />))
	const buttons = container.querySelectorAll('button')
	expect(buttons).toHaveLength(1)
	expect(buttons[0].textContent).toBe('external-access.configure')
	expect(container.textContent).toContain('external-access.setup-required')
	act(() => buttons[0].click())
	expect(configure).toHaveBeenCalledTimes(1)
})

test('locks the URL editor when global access turns off and retains its draft when re-enabled', () => {
	const configure = vi.fn()
	function Editor({enabled}: {enabled: boolean}) {
		const [origin, setOrigin] = useState('')
		return (
			<ExternalAccessSettingsView
				app={{id: 'files', externalAccess: {enabled}} as UserApp}
				origin={origin}
				onOriginChange={setOrigin}
				onBack={back}
				onConfigure={configure}
			/>
		)
	}
	act(() =>
		root.render(
			<Dialog open>
				<Editor enabled />
			</Dialog>,
		),
	)
	fill(input('https://files.example.com'), 'https://files.example.com')
	act(() =>
		root.render(
			<Dialog open>
				<Editor enabled={false} />
			</Dialog>,
		),
	)
	expect(container.querySelector('input')).toBeNull()
	const button = [...container.querySelectorAll('button')].find(
		(button) => button.textContent === 'external-access.configure',
	)!
	act(() => button.click())
	expect(configure).toHaveBeenCalledTimes(1)
	act(() =>
		root.render(
			<Dialog open>
				<Editor enabled />
			</Dialog>,
		),
	)
	expect(input('https://files.example.com').value).toBe('https://files.example.com')
})
