import {
	createContext,
	lazy,
	Suspense,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type ReactNode,
} from 'react'
import {createPortal} from 'react-dom'
import {useNavigate} from 'react-router-dom'

import type {ViewerMode} from '@/features/files/store/slices/file-viewer-slice'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'

const VideoPlayer = lazy(() => import('./index'))

type VideoSession = {item: FileSystemItem; mode: ViewerMode; folderUrl: string}
type VideoSessionContextValue = {
	attach: (session: VideoSession, target: HTMLElement) => () => void
	restoreViewer: (locationKey: string) => boolean
}

const VideoSessionContext = createContext<VideoSessionContextValue | null>(null)

// The authenticated desktop owns playback; Files only owns its presentation slot.
// Keep the portal target unchanged when parking a PiP player so React never
// replaces the video element (or its current time, buffering and playback state).
export function FileVideoSessionProvider({children}: {children: ReactNode}) {
	const navigate = useNavigate()
	const [container] = useState(() => document.createElement('div'))
	const parking = useRef<HTMLDivElement>(null)
	const target = useRef<HTMLElement | null>(null)
	const sessionRef = useRef<VideoSession | null>(null)
	const restoring = useRef(false)
	const restoredLocation = useRef<string | null>(null)
	const [session, setSession] = useState<VideoSession | null>(null)
	const [visible, setVisible] = useState(false)

	const attach = useCallback(
		(next: VideoSession, element: HTMLElement) => {
			sessionRef.current = next
			target.current = element
			element.append(container)
			setSession(next)
			setVisible(true)
			return () => {
				if (target.current !== element) return
				target.current = null
				parking.current?.append(container)
				setVisible(false)
			}
		},
		[container],
	)

	useEffect(() => {
		// Wait until slot effects have settled: StrictMode may detach and reattach
		// the same slot in one commit, without actually closing the preview.
		if (session && !target.current && !restoring.current && !container.contains(document.pictureInPictureElement)) {
			sessionRef.current = null
			setSession(null)
		}
	}, [container, session, visible])

	const restoreViewer = useCallback((locationKey: string) => {
		const current = sessionRef.current
		if (restoredLocation.current === locationKey) return true
		if (!restoring.current || !current) {
			restoredLocation.current = null
			return false
		}
		restoredLocation.current = locationKey
		restoring.current = false
		useFilesStore.getState().setViewerItem(current.item, current.mode)
		return true
	}, [])

	const leavePictureInPicture = useCallback(() => {
		const current = sessionRef.current
		if (target.current || !current) return
		// Respect a dirty editor's existing navigation guard before changing the
		// route. A rejected restore must stop playback instead of hiding audio.
		if (!useFilesStore.getState().setViewerItem(current.item, current.mode)) {
			sessionRef.current = null
			setSession(null)
			return
		}
		restoring.current = true
		navigate(current.folderUrl)
		// FilesLayout consumes the pending restore after navigation, including
		// when returning to the same directory with its preview closed.
	}, [navigate])

	return (
		<VideoSessionContext value={{attach, restoreViewer}}>
			{children}
			<div ref={parking} hidden />
			{session &&
				createPortal(
					<Suspense>
						<VideoPlayer
							key={session.item.path}
							item={session.item}
							viewerMode={session.mode}
							visible={visible}
							onLeavePictureInPicture={leavePictureInPicture}
						/>
					</Suspense>,
					container,
				)}
		</VideoSessionContext>
	)
}

export function useFileVideoSession() {
	const session = useContext(VideoSessionContext)
	if (!session) throw new Error('File video previews require FileVideoSessionProvider')
	return session
}
