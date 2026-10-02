// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {createMemoryRouter, RouterProvider} from 'react-router-dom'
import {afterEach, expect, test, vi} from 'vitest'

import {CommunityAppStoreDialog} from './community-app-store-dialog'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('@/providers/apps', () => ({systemAppsKeyed: {}}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		appStore: {
			repositories: {useQuery: () => ({data: [], refetch: vi.fn()})},
			registry: {useQuery: () => ({data: []})},
			addRepository: {useMutation: () => ({})},
			removeRepository: {useMutation: () => ({})},
		},
		useUtils: () => ({appStore: {registry: {invalidate: vi.fn()}}}),
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: ReturnType<typeof createRoot>
let router: ReturnType<typeof createMemoryRouter>
const container = document.createElement('div')

afterEach(async () => {
	await act(async () => root?.unmount())
	router?.dispose()
	container.remove()
	localStorage.clear()
	vi.unstubAllGlobals()
})

test('shows the notice for the first opening, not a store visit or subsequent openings', async () => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	)
	localStorage.clear()
	document.body.appendChild(container)
	router = createMemoryRouter([{path: '/app-store', element: <CommunityAppStoreDialog />}], {
		initialEntries: ['/app-store'],
	})
	root = createRoot(container)
	await act(async () => root.render(<RouterProvider router={router} />))
	expect(localStorage.getItem('UMBREL_community-store-warning-seen')).toBeNull()

	await act(async () => router.navigate('/app-store?dialog=add-community-store'))
	expect(document.body.textContent).toContain('community-app-stores.warning')

	await act(async () => router.navigate('/app-store'))
	await act(async () => router.navigate('/app-store?dialog=add-community-store'))
	expect(document.body.textContent).not.toContain('community-app-stores.warning')
	expect(document.body.textContent).toContain('community-app-stores.add-button')

	// A new page lifetime still uses the same browser preference.
	await act(async () => root.unmount())
	root = createRoot(container)
	await act(async () => root.render(<RouterProvider router={router} />))
	expect(document.body.textContent).not.toContain('community-app-stores.warning')
})
