// @vitest-environment jsdom

import {act, type ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {WidgetSelector} from './widget-selector'

const state = vi.hoisted(() => ({checked: false, toggle: vi.fn()}))
vi.mock('@/hooks/use-widgets', () => ({
	useWidgets: () => ({
		availableWidgets: [{appId: 'system', name: 'System', widgets: [{id: 'memory', type: 'text-with-progress'}]}],
		selected: state.checked ? [{id: 'memory', app: {id: 'system'}}] : [],
		toggleSelected: state.toggle,
		isLoading: false,
		isSaving: false,
	}),
}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/components/app-icon', () => ({AppIcon: () => null}))
vi.mock('@/components/ui/dialog-close-button', () => ({DialogCloseButton: () => null}))
vi.mock('@/components/ui/sheet', () => {
	const Container = ({children}: {children: ReactNode}) => <div>{children}</div>
	return {Sheet: Container, SheetContent: Container, SheetHeader: Container, SheetTitle: Container}
})
vi.mock('@/components/ui/sheet-scroll-area', () => ({
	ScrollArea: ({children}: {children: ReactNode}) => <div>{children}</div>,
}))
vi.mock('@/modules/desktop/app-grid/paginator', () => ({ArrowButton: () => null, PaginatorPills: () => null}))
vi.mock('@/modules/desktop/dock', () => ({DockSpacer: () => null}))
vi.mock('@/modules/widgets', () => ({
	ExampleWidget: () => <button>Memory</button>,
	Widget: () => <div>Selected memory</div>,
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot>
let container: HTMLDivElement

beforeEach(() => {
	vi.useFakeTimers()
	state.checked = false
	state.toggle.mockReset()
	document.documentElement.style.cssText = '--page-w: 1040px; --widget-w: 270px; --app-x-gap: 20px;'
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
})
afterEach(() => {
	act(() => root.unmount())
	container.remove()
	document.documentElement.style.cssText = ''
	vi.useRealTimers()
})

test.each([false, true])('corner and card activate the same toggle exactly once (selected: %s)', async (checked) => {
	state.checked = checked
	await act(async () => root.render(<WidgetSelector open onOpenChange={() => {}} />))
	const button = container.querySelector<HTMLButtonElement>('button[aria-pressed]')!
	expect(button.getAttribute('aria-pressed')).toBe(String(checked))
	expect(document.getElementById(button.getAttribute('aria-labelledby')!)?.textContent).toBe('Memory')

	// Click the actual corner icon, not the card underneath it.
	const icon = button.querySelector(checked ? '.lucide-minus' : '.lucide-plus')!
	act(() => icon.dispatchEvent(new MouseEvent('click', {bubbles: true})))
	expect(state.toggle.mock.calls).toEqual([['memory']])
	state.toggle.mockClear()
	act(() => button.click())
	expect(state.toggle.mock.calls).toEqual([['memory']])
})
