// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {createMemoryRouter, RouterProvider} from 'react-router-dom'
import {afterEach, expect, test, vi} from 'vitest'

import Category from './components/category'
import Discover from './components/discover'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('@/providers/available-apps', () => ({
	useAvailableApps: () => ({apps: [], appsGroupedByCategory: {}, isLoading: false}),
}))
vi.mock('./hooks/use-storefront', () => ({
	useStorefront: () => ({isLoading: false, isUnavailable: true, dates: new Map(), featuredByCategory: new Map()}),
}))
vi.mock('./hooks/use-app-status', () => ({useAppStatusMap: () => new Map(), useAppCardStateMap: () => new Map()}))
vi.mock('@/hooks/use-is-mobile', () => ({useIsSmallMobile: () => false}))
vi.mock('./components/virtual-app-grid', () => ({
	VirtualAppGrid: ({apps}: {apps: unknown[]}) => <div role='grid' data-count={apps.length} />,
}))
vi.mock('./components/app-card', () => ({AppCardAction: () => null}))
vi.mock('./components/storefront-sections', () => ({StorefrontSectionView: () => null}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const container = document.createElement('div')
let root: ReturnType<typeof createRoot>
let router: ReturnType<typeof createMemoryRouter>
afterEach(async () => {
	await act(async () => root?.unmount())
	router?.dispose()
})

test('the complete catalog stays on an empty grid instead of redirecting back to Discover', async () => {
	router = createMemoryRouter(
		[
			{path: '/app-store/category/:categoryId', element: <Category />},
			{path: '/app-store', element: <div>Discover</div>},
		],
		{initialEntries: ['/app-store/category/all?dialog=import-compose']},
	)
	root = createRoot(container)
	await act(async () => root.render(<RouterProvider router={router} />))
	expect(router.state.location.pathname).toBe('/app-store/category/all')
	expect(router.state.location.search).toBe('?dialog=import-compose')
	expect(container.querySelector('[role="grid"]')?.getAttribute('data-count')).toBe('0')
})

test('the offline Discover fallback retains an open dialog and sorting parameters', async () => {
	router = createMemoryRouter(
		[
			{path: '/app-store', element: <Discover />},
			{path: '/app-store/category/all', element: <div>All apps</div>},
		],
		{initialEntries: ['/app-store?dialog=import-compose&sort=newest']},
	)
	root = createRoot(container)
	await act(async () => root.render(<RouterProvider router={router} />))
	expect(router.state.location.pathname).toBe('/app-store/category/all')
	expect(router.state.location.search).toBe('?dialog=import-compose&sort=newest')
})
