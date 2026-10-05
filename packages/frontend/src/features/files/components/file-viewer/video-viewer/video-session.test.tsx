// @vitest-environment jsdom

import {act, StrictMode, useEffect} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {MemoryRouter, useLocation, useNavigate} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import ImageViewer from '@/features/files/components/file-viewer/image-viewer'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'

import VideoViewerSlot from './slot'
import {FileVideoSessionProvider, useFileVideoSession} from './video-session'

import './index'

vi.mock('@/modules/auth/http-auth', () => ({
	useAuthorizedHttpUrlQuery: (url: string) => ({status: 'ready', url}),
}))
vi.mock('react-i18next', () => ({
	useTranslation: () => ({t: (key: string) => key}),
	initReactI18next: {type: '3rdParty', init: vi.fn()},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const movie: FileSystemItem = {
	name: 'movie.mp4',
	path: '/Home/movie.mp4',
	type: 'video/mp4',
	size: 100,
	modified: 0,
	operations: [],
}
const picture: FileSystemItem = {...movie, name: 'picture.jpg', path: '/Home/picture.jpg', type: 'image/jpeg'}

function FilesSurface() {
	const {key} = useLocation()
	const navigate = useNavigate()
	const {restoreViewer} = useFileVideoSession()
	const item = useFilesStore((s) => s.viewerItem)
	useEffect(() => {
		if (!restoreViewer(key)) useFilesStore.getState().setViewerItem(null)
	}, [key, restoreViewer])
	return (
		<section aria-label='Files'>
			<button onClick={() => navigate('/')}>Close Files</button>
			<button onClick={() => useFilesStore.getState().setViewerItem(movie)}>Open video</button>
			<button onClick={() => useFilesStore.getState().setViewerItem(picture)}>Open image</button>
			{item?.type.startsWith('video/') ? <VideoViewerSlot item={item} /> : item && <ImageViewer item={item} />}
		</section>
	)
}

function Desktop() {
	const {pathname} = useLocation()
	return (
		<>
			<output>{pathname}</output>
			{pathname.startsWith('/files') ? <FilesSurface /> : <div>Desktop</div>}
		</>
	)
}

let root: Root
let container: HTMLDivElement
let pause: ReturnType<typeof vi.spyOn>
let load: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
	useFilesStore.setState(useFilesStore.getInitialState())
	Object.defineProperty(document, 'pictureInPictureElement', {configurable: true, value: null})
	pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
	load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
	vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
	await act(async () => {
		root.render(
			<StrictMode>
				<MemoryRouter initialEntries={['/files/Recents']}>
					<FileVideoSessionProvider>
						<Desktop />
					</FileVideoSessionProvider>
				</MemoryRouter>
			</StrictMode>,
		)
	})
})

afterEach(async () => {
	await act(async () => root.unmount())
	container.remove()
	vi.restoreAllMocks()
})

async function click(label: string) {
	const button = [...container.querySelectorAll('button')].find(
		(element) => element.textContent === label || element.getAttribute('aria-label') === label,
	)
	expect(button).toBeDefined()
	await act(async () => button!.click())
}

async function openVideo() {
	await click('Open video')
	await vi.waitFor(() => expect(container.querySelector('video')).not.toBeNull())
	const video = container.querySelector('video')!
	await act(async () => video.dispatchEvent(new Event('loadedmetadata')))
	return video
}

async function enterPip(video: HTMLVideoElement) {
	Object.defineProperty(document, 'pictureInPictureElement', {configurable: true, value: video})
	await act(async () => video.dispatchEvent(new Event('enterpictureinpicture')))
}

async function leavePip(video: HTMLVideoElement) {
	Object.defineProperty(document, 'pictureInPictureElement', {configurable: true, value: null})
	await act(async () => video.dispatchEvent(new Event('leavepictureinpicture')))
}

describe('Files video lifetime', () => {
	it.each([false, true])('restores the same player and playhead after closing Files (paused=%s)', async (paused) => {
		const video = await openVideo()
		video.currentTime = 42
		Object.defineProperty(video, 'paused', {configurable: true, value: paused})
		await enterPip(video)
		pause.mockClear()
		vi.mocked(HTMLMediaElement.prototype.play).mockClear()
		await click('Close Files')
		expect(container.textContent).toContain('Desktop')
		expect(video.isConnected).toBe(true)
		expect(video.closest('[hidden]')).not.toBeNull()
		expect(pause).not.toHaveBeenCalled()

		await leavePip(video)
		expect(container.querySelector('output')?.textContent).toBe('/files/Home')
		expect(container.querySelector('section[aria-label="Files"] video')).toBe(video)
		expect(video.closest('[hidden]')).toBeNull()
		expect(video.currentTime).toBe(42)
		expect(video.paused).toBe(paused)
		// In particular, never restart a video the browser paused when closing PiP.
		expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
		expect(pause).not.toHaveBeenCalled()
		await click('close')
		expect(video.isConnected).toBe(false)
		expect(pause).toHaveBeenCalledOnce()
		expect(video.querySelector('source')?.hasAttribute('src')).toBe(false)
	})

	it('closes an ordinary preview and releases all media sources so other files can open', async () => {
		const video = await openVideo()
		pause.mockClear()
		load.mockClear()
		await click('close')
		expect(video.isConnected).toBe(false)
		expect(pause).toHaveBeenCalledOnce()
		expect(load).toHaveBeenCalledOnce()
		expect(video.querySelector('source')?.getAttribute('src')).toBeNull()
		await click('Open image')
		expect(container.querySelector('img[alt="picture.jpg"]')).not.toBeNull()
		await click('close')
		expect(container.querySelector('img')).toBeNull()
	})

	it('parks a closed preview in PiP while browsing other files and restores within Files', async () => {
		const video = await openVideo()
		await enterPip(video)
		await click('close')
		await click('Open image')
		expect(video.closest('[hidden]')).not.toBeNull()
		expect(container.querySelector('img')).not.toBeNull()
		await click('close')
		await leavePip(video)
		expect(container.querySelector('section video')).toBe(video)
	})

	it('stops a parked video when the authenticated desktop unmounts', async () => {
		const video = await openVideo()
		await enterPip(video)
		await click('Close Files')
		pause.mockClear()
		await act(async () => root.render(null))
		expect(video.isConnected).toBe(false)
		expect(pause).toHaveBeenCalledOnce()
		expect(video.querySelector('source')?.getAttribute('src')).toBeNull()
	})

	it('stops playback when Files closes without PiP', async () => {
		const video = await openVideo()
		pause.mockClear()
		await click('Close Files')
		expect(video.isConnected).toBe(false)
		expect(pause).toHaveBeenCalledOnce()
	})

	it('releases the old PiP player when another video is opened', async () => {
		const video = await openVideo()
		await enterPip(video)
		await click('close')
		pause.mockClear()
		await act(async () => {
			useFilesStore.getState().setViewerItem({...movie, name: 'next.mp4', path: '/Home/next.mp4'})
		})
		expect(container.querySelectorAll('video')).toHaveLength(1)
		expect(container.querySelector('video')).not.toBe(video)
		expect(video.isConnected).toBe(false)
		expect(pause).toHaveBeenCalledOnce()
		expect(video.querySelector('source')?.hasAttribute('src')).toBe(false)
	})

	it('does not leave background audio when another preview blocks the restore', async () => {
		const video = await openVideo()
		await enterPip(video)
		await click('close')
		await click('Open image')
		const guard = vi.fn(() => false)
		useFilesStore.getState().setViewerNavigationGuard(guard)
		pause.mockClear()
		await leavePip(video)
		expect(guard).toHaveBeenCalledOnce()
		expect(container.querySelector('img[alt="picture.jpg"]')).not.toBeNull()
		expect(container.querySelector('output')?.textContent).toBe('/files/Recents')
		expect(video.isConnected).toBe(false)
		expect(pause).toHaveBeenCalledOnce()
	})
})
