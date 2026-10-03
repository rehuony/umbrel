// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import TerminalDialog from './index'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/providers/wallpaper', () => ({useWallpaper: () => ({wallpaper: {url: ''}})}))
vi.mock('@/features/files/hooks/use-is-touch-device', () => ({useIsTouchDevice: () => false}))
vi.mock('@/components/ui/immersive-dialog', async () => {
	const {Root, Overlay} = await import('@radix-ui/react-dialog')
	return {ImmersiveDialog: Root, ImmersiveDialogOverlay: Overlay}
})
vi.mock('@/modules/immersive-picker', () => ({
	AppDropdown: ({appId, setAppId}: {appId: string; setAppId: (id: string) => void}) => (
		<select aria-label='Application' value={appId} onChange={(event) => setAppId(event.target.value)}>
			<option value='tailscale'>Tailscale</option>
			<option value='immich'>Immich</option>
		</select>
	),
}))
vi.mock('./_shared', () => ({
	XTermTerminal: ({appId}: {appId?: string}) => <output data-terminal-target={appId ?? 'system'} />,
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})

afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

async function renderAt(url: string) {
	await act(async () =>
		root.render(
			<MemoryRouter initialEntries={[url]}>
				<TerminalDialog />
			</MemoryRouter>,
		),
	)
}

test('opens the system shell directly without a target picker', async () => {
	await renderAt('/?dialog=terminal')

	expect(document.querySelector('[data-terminal-target]')?.getAttribute('data-terminal-target')).toBe('system')
	expect(document.querySelector('select')).toBeNull()
	expect(document.querySelector('[role="dialog"] a')).toBeNull()
})

test('preserves application targeting while switching between application shells', async () => {
	await renderAt('/app-store?dialog=terminal&app=tailscale')

	expect(document.querySelector('[data-terminal-target]')?.getAttribute('data-terminal-target')).toBe('tailscale')
	const picker = document.querySelector('select')!
	await act(async () => {
		picker.value = 'immich'
		picker.dispatchEvent(new Event('change', {bubbles: true}))
	})
	expect(document.querySelector('[data-terminal-target]')?.getAttribute('data-terminal-target')).toBe('immich')
})
