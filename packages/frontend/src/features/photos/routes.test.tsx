// @vitest-environment jsdom

import {act, Suspense, use} from 'react'
import {createRoot} from 'react-dom/client'
import {createMemoryRouter, Outlet, RouterProvider} from 'react-router-dom'
import {expect, test, vi} from 'vitest'

import {SheetTitle} from '@/components/ui/sheet'
import {SheetLayout} from '@/layouts/sheet'

import {photosRoutes} from './routes'

const moduleReady = vi.hoisted(() => {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return {promise, resolve}
})

vi.mock('@/features/photos', async () => {
	await moduleReady.promise
	return {
		default: () => (
			<main aria-label='Photos'>
				<Outlet />
			</main>
		),
	}
})
vi.mock('@/features/photos/components/listing', () => ({PhotosListing: () => <div>Photo library</div>}))
vi.mock('@/features/photos/components/sources/sources-overview', () => ({SourcesOverview: () => null}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/hooks/use-scroll-restoration', () => ({useScrollRestoration: () => {}}))
vi.mock('@/modules/desktop/dock', () => ({DockSpacer: () => null}))
vi.mock('@/providers/wallpaper', () => ({
	useWallpaper: () => ({wallpaper: {url: '/wallpaper.jpg'}}),
	WallpaperAvifSource: () => null,
	usePauseWallpaperVideo: () => {},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

test('keeps the desktop visible until Photos can open with its contents', async () => {
	const container = document.createElement('div')
	const root = createRoot(container)
	const router = createMemoryRouter([
		{path: '/', element: <div>Desktop</div>},
		{
			element: (
				<div role='dialog'>
					<Suspense fallback={null}>
						<Outlet />
					</Suspense>
				</div>
			),
			children: photosRoutes,
		},
	])
	let navigation: Promise<void> | undefined
	try {
		await act(async () => root.render(<RouterProvider router={router} />))
		await act(async () => {
			navigation = router.navigate('/photos')
		})
		expect(container.textContent).toBe('Desktop')
		expect(container.querySelector('[role="dialog"]')).toBeNull()

		await act(async () => {
			moduleReady.resolve()
			await navigation
		})
		expect(container.querySelector('[role="dialog"]')?.textContent).toBe('Photo library')

		await act(async () => {
			await router.navigate('/')
		})
		await act(async () => {
			await router.navigate('/photos')
		})
		expect(container.querySelector('[role="dialog"]')?.textContent).toBe('Photo library')
	} finally {
		moduleReady.resolve()
		await act(async () => root.unmount())
		router.dispose()
	}
})

test('keeps the real window and background mounted while Photos content loads', async () => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	)
	const container = document.createElement('div')
	document.body.appendChild(container)
	const root = createRoot(container)
	let resolve!: (value: string) => void
	const response = new Promise<string>((done) => {
		resolve = done
	})
	function LoadingPhotos() {
		const result = use(response)
		return (
			<>
				<SheetTitle>Photos</SheetTitle>
				<p>{result}</p>
			</>
		)
	}
	const router = createMemoryRouter(
		[{element: <SheetLayout />, children: [{path: '/photos', element: <LoadingPhotos />}]}],
		{initialEntries: ['/photos']},
	)
	try {
		await act(async () => root.render(<RouterProvider router={router} />))
		const sheet = container.querySelector('[role="dialog"]') as HTMLElement
		const material = sheet.querySelector('.umbrel-window-wallpaper')
		expect(sheet).not.toBeNull()
		expect(material).not.toBeNull()
		expect(sheet.style.display).not.toBe('none')
		expect(sheet.textContent).toContain('loading')

		await act(async () => resolve('No photos yet'))
		expect(container.querySelector('[role="dialog"]')).toBe(sheet)
		expect(sheet.querySelector('.umbrel-window-wallpaper')).toBe(material)
		expect(sheet.style.display).not.toBe('none')
		expect(sheet.textContent).toContain('No photos yet')
	} finally {
		await act(async () => root.unmount())
		router.dispose()
		container.remove()
		vi.unstubAllGlobals()
	}
})
