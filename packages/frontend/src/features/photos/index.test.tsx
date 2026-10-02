// @vitest-environment jsdom

import {act, type ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
import {createMemoryRouter, RouterProvider} from 'react-router-dom'
import {expect, test, vi} from 'vitest'

import PhotosLayout from './index'

const loaded = vi.hoisted(() => [] as string[])
function Wrapper({children}: {children: ReactNode}) {
	return <div>{children}</div>
}
vi.mock('@/components/ui/sheet', () => ({SheetHeader: Wrapper, SheetTitle: Wrapper}))
vi.mock('@/features/files/components/sidebar/mobile-sidebar-wrapper', () => ({MobileSidebarWrapper: Wrapper}))
vi.mock('@/features/photos/components/actions-bar', () => ({ActionsBar: () => null}))
vi.mock('@/features/photos/components/actions-bar/mobile-actions', () => ({MobileActions: () => null}))
vi.mock('@/features/photos/components/listing/surface', () => ({useBarDrop: () => 0}))
vi.mock('@/features/photos/components/search', () => ({useSearchEngaged: () => false, MobileSearch: () => null}))
vi.mock('@/features/photos/components/selection-context', () => ({PhotosSelectionProvider: Wrapper}))
vi.mock('@/features/photos/components/view-context', () => ({PhotosViewProvider: Wrapper}))
vi.mock('@/features/photos/components/sidebar', () => ({Sidebar: () => null}))
vi.mock('@/features/photos/components/upload-drop-zone', () => ({UploadDropZone: Wrapper}))
vi.mock('@/features/photos/hooks/use-photos-events', () => ({usePhotosEvents: () => {}}))
vi.mock('@/hooks/use-is-mobile', () => ({useIsMobile: () => false}))
vi.mock('@/modules/auth/http-url-authorizer', () => ({HttpUrlAuthorizerProvider: Wrapper}))
vi.mock('@/features/photos/components/sources/source-details-dialog', () => {
	loaded.push('source')
	return {SourceDetailsDialog: () => <div>Source details</div>}
})
vi.mock('@/features/photos/components/sources/add-source-dialog', () => {
	loaded.push('add-source')
	return {AddSourceDialog: () => <div>Add source</div>}
})
vi.mock('@/features/photos/components/albums/rename-album-dialog', () => {
	loaded.push('rename')
	return {RenameAlbumDialog: () => <div>Rename album</div>}
})
vi.mock('@/features/photos/components/viewer/item-viewer', () => {
	loaded.push('viewer')
	return {ItemViewer: () => <div>Photo viewer</div>}
})
vi.mock('@/features/photos/components/albums/create-album-dialog', async () => {
	loaded.push('create')
	const {useDialogOpenProps} = await import('@/utils/dialog')
	return {
		CreateAlbumDialog: () => {
			const {open, onOpenChange} = useDialogOpenProps('photos-create-album')
			return <button onClick={() => onOpenChange(false)}>{open ? 'Create album' : 'Closing album'}</button>
		},
	}
})
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

test('opens Photos without loading closed dialogs and keeps an active dialog through its exit', async () => {
	const container = document.createElement('div')
	const root = createRoot(container)
	const router = createMemoryRouter(
		[{path: '/photos', element: <PhotosLayout />, children: [{index: true, element: <p>Library contents</p>}]}],
		{initialEntries: ['/photos']},
	)
	try {
		await act(async () => root.render(<RouterProvider router={router} />))
		expect(container.textContent).toContain('Library contents')
		expect(loaded).toEqual([])

		await act(async () => {
			await router.navigate('/photos?dialog=photos-create-album')
			await import('./components/albums/create-album-dialog')
		})
		expect(loaded).toEqual(['create'])
		expect(container.textContent).toContain('Library contents')
		expect(container.querySelector('button')?.textContent).toBe('Create album')

		vi.useFakeTimers()
		await act(async () => container.querySelector('button')!.click())
		expect(container.querySelector('button')?.textContent).toBe('Closing album')
		await act(async () => vi.advanceTimersByTimeAsync(100))
		expect(container.querySelector('button')).toBeNull()
		expect(container.textContent).toContain('Library contents')
		vi.useRealTimers()

		await act(async () => {
			await router.navigate('/photos?dialog=photos-item&photos-item-id=photo')
			await import('./components/viewer/item-viewer')
		})
		expect(loaded).toEqual(['create', 'viewer'])
		expect(container.textContent).toContain('Photo viewer')
	} finally {
		await act(async () => root.unmount())
		router.dispose()
		vi.useRealTimers()
	}
})
