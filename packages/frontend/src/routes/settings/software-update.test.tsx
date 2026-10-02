// @vitest-environment jsdom
import {act, type PropsWithChildren} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import SoftwareUpdate from './software-update'

const mocks = vi.hoisted(() => ({
	check: {} as any,
	status: {} as any,
	update: vi.fn(),
	rollback: vi.fn(),
	invalidateCheck: vi.fn(),
	invalidateVersion: vi.fn(),
}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/hooks/use-is-mobile', () => ({useIsMobile: () => false}))
vi.mock('@/utils/misc', () => ({IS_ANDROID: false}))
vi.mock('./_components/shared', () => ({useSettingsDialogProps: () => ({open: true})}))
vi.mock('@/components/ui/dialog', () => {
	const Wrapper = ({children}: PropsWithChildren) => <div>{children}</div>
	return {Dialog: Wrapper, DialogHeader: Wrapper, DialogScrollableContent: Wrapper, DialogTitle: Wrapper}
})
vi.mock('@/components/ui/drawer', () => ({
	Drawer: 'div',
	DrawerContent: 'div',
	DrawerHeader: 'div',
	DrawerTitle: 'div',
}))
vi.mock('@/components/ui/button-link', () => ({ButtonLink: ({children}: PropsWithChildren) => <a>{children}</a>}))
vi.mock('@/trpc/trpc', () => {
	const utils = {
		system: {
			checkUpdate: {invalidate: mocks.invalidateCheck},
			version: {invalidate: mocks.invalidateVersion},
			updateStatus: {invalidate: vi.fn()},
		},
	}
	return {
		trpcReact: {
			useUtils: () => utils,
			system: {
				checkUpdate: {useQuery: () => mocks.check},
				updateStatus: {useQuery: () => mocks.status},
				version: {useQuery: () => ({data: {version: '1.0.0'}})},
				update: {useMutation: () => ({mutate: mocks.update, isPending: false})},
				rollback: {useMutation: () => ({mutate: mocks.rollback, isPending: false})},
			},
		},
	}
})
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const button = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent === text)
beforeEach(() => {
	vi.clearAllMocks()
	mocks.check = {
		data: {supported: true, available: true, release: {version: '1.1.0', notes: '<script>untrusted</script>'}},
		refetch: vi.fn(),
	}
	mocks.status = {data: {state: null, rollbackAvailable: false}, isSuccess: true}
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})
afterEach(() => {
	act(() => root.unmount())
	container.remove()
})
const render = () => act(() => root.render(<SoftwareUpdate />))
test('requires confirmation before installing the reviewed version and renders notes as text', () => {
	render()
	expect(container.querySelector('script')).toBeNull()
	act(() => button('system-update.install')!.click())
	expect(mocks.update).not.toHaveBeenCalled()
	expect(container.textContent).toContain('system-update.confirm')
	act(() => button('confirm')!.click())
	expect(mocks.update).toHaveBeenCalledWith({version: '1.1.0'})
})
test('does not label an unavailable repository up to date or allow installation', () => {
	mocks.check = {error: new Error('Update source returned HTTP 429')}
	render()
	expect(container.querySelector('[role=alert]')?.textContent).toContain('HTTP 429')
	expect(container.textContent).not.toContain('system-update.current-release')
	expect(button('system-update.install')).toBeUndefined()
})
test('blocks conflicting actions during download and reconnects during reboot', () => {
	mocks.status.data.state = {phase: 'downloading', progress: 40}
	render()
	expect(button('system-update.check')?.disabled).toBe(true)
	expect(button('system-update.install')).toBeUndefined()
	mocks.status = {
		...mocks.status,
		isError: true,
		error: new Error('Disconnected'),
		data: {state: {phase: 'rebooting', progress: 95}},
	}
	render()
	expect(container.textContent).toContain('system-update.reconnecting')
	expect(container.querySelector('[role=alert]')).toBeNull()
})
test('offers only verified rollback and confirms it separately', () => {
	mocks.status.data.rollbackAvailable = true
	render()
	act(() => button('system-update.rollback')!.click())
	expect(mocks.rollback).not.toHaveBeenCalled()
	act(() => button('confirm')!.click())
	expect(mocks.rollback).toHaveBeenCalledOnce()
})
test('refreshes installed and available versions after a completed boot', () => {
	mocks.status.data.state = {phase: 'succeeded', progress: 100}
	render()
	expect(mocks.invalidateCheck).toHaveBeenCalledOnce()
	expect(mocks.invalidateVersion).toHaveBeenCalledOnce()
})
