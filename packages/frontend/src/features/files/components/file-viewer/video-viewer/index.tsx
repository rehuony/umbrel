// TODO: Investigate pre-existing issue where large video files fail to play in Safari.
import {useEffect, useLayoutEffect} from 'react'
import {useVideoContext, Video} from 'react-video-kit'

import {AuthorizedUrlState} from '@/features/files/components/file-viewer/authorized-url-state'
import {ViewerWrapper} from '@/features/files/components/file-viewer/viewer-wrapper'
import type {ViewerMode} from '@/features/files/store/slices/file-viewer-slice'
import {FileSystemItem} from '@/features/files/types'
import {useAuthorizedHttpUrlQuery} from '@/modules/auth/http-auth'

interface VideoViewerProps {
	item: FileSystemItem
	viewerMode: ViewerMode
	visible: boolean
	onLeavePictureInPicture: () => void
}

export default function VideoViewer({item, viewerMode, visible, onLeavePictureInPicture}: VideoViewerProps) {
	const previewUrl = useAuthorizedHttpUrlQuery(`/api/files/view?path=${encodeURIComponent(item.path)}`)

	return (
		<AuthorizedUrlState query={previewUrl} showCloseButton>
			{(url) => (
				<ViewerWrapper enabled={visible} showCloseButton dontCloseOnSpacebar={viewerMode !== 'preview'}>
					<div className='w-[min(960px,calc(100vw-40px))] max-w-full bg-black'>
						<Video.Root
							key={item.path}
							src={url}
							title={item.name}
							autoPlay
							hotkeys={{scope: 'global', enabled: visible && viewerMode !== 'preview'}}
						>
							<Video.Media />
							<VideoLifecycle onLeavePictureInPicture={onLeavePictureInPicture} />
							<Video.Backdrop />
							<Video.Header>
								<div className='rv-w-full rv-flex'>
									<Video.FullscreenToggle />
									<Video.PipToggle />
								</div>
								<div className='rv-w-full rv-flex rv-justify-end rv-items-center rv-h-fit'>
									<Video.Volume.Button />
									<Video.Volume.Slider />
								</div>
							</Video.Header>
							<Video.Center>
								<Video.SeekBack seconds={10} />
								<Video.PlayPause />
								<Video.SeekForward seconds={10} />
								<Video.Loading />
							</Video.Center>
							<Video.Footer>
								<Video.Title />
								<Video.Timeline />
								<div className='rv-flex rv-justify-between rv-w-full'>
									<Video.Time.Current />
									<Video.Time.Remaining negative />
								</div>
							</Video.Footer>
						</Video.Root>
					</div>
				</ViewerWrapper>
			)}
		</AuthorizedUrlState>
	)
}

function VideoLifecycle({onLeavePictureInPicture}: {onLeavePictureInPicture: () => void}) {
	const {videoRef} = useVideoContext()
	useLayoutEffect(() => {
		const video = videoRef.current
		if (!video) return
		// PiP events do not bubble; listen on this media element, not document.
		video.addEventListener('leavepictureinpicture', onLeavePictureInPicture)
		return () => video.removeEventListener('leavepictureinpicture', onLeavePictureInPicture)
	}, [videoRef, onLeavePictureInPicture])
	useEffect(() => {
		const video = videoRef.current
		if (!video) return
		return () => {
			// StrictMode replays effects on a connected element. Only release an
			// actually unmounted player, using the element captured before refs clear.
			if (video.isConnected) return
			video.pause()
			video.removeAttribute('src')
			// Video.Media uses child <source> elements. Clear those as well before
			// load(), otherwise cleanup can restart a detached media request.
			video.querySelectorAll('source').forEach((source) => source.removeAttribute('src'))
			video.load()
		}
	}, [videoRef])
	return null
}
