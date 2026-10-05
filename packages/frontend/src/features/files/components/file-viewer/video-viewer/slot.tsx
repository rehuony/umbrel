import {useLayoutEffect, useRef} from 'react'

import {BASE_ROUTE_PATH} from '@/features/files/constants'
import {encodePathSegments} from '@/features/files/hooks/use-navigate'
import {useFilesStore} from '@/features/files/store/use-files-store'
import type {FileSystemItem} from '@/features/files/types'

import {useFileVideoSession} from './video-session'

export default function VideoViewerSlot({item}: {item: FileSystemItem}) {
	const {attach} = useFileVideoSession()
	const viewerMode = useFilesStore((s) => s.viewerMode)
	const target = useRef<HTMLDivElement>(null)

	useLayoutEffect(() => {
		const parent = item.path.slice(0, item.path.lastIndexOf('/'))
		const folderUrl = `${BASE_ROUTE_PATH}${encodePathSegments(parent)}`
		if (target.current) return attach({item, mode: viewerMode, folderUrl}, target.current)
	}, [attach, item, viewerMode])

	return <div ref={target} />
}
