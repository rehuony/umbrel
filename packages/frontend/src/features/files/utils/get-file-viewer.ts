import {FILE_TYPE_MAP} from '@/features/files/constants'
import type {FileSystemItem} from '@/features/files/types'
import {getFileType} from '@/features/files/utils/get-file-type'

export function getFileViewer(item: Pick<FileSystemItem, 'name' | 'type'>) {
	const mimeType = item.type.split(';')[0].trim().toLowerCase()
	return (
		getFileType(item)?.viewer ??
		(mimeType === 'application/octet-stream' ? FILE_TYPE_MAP['text/plain'].viewer : undefined)
	)
}
