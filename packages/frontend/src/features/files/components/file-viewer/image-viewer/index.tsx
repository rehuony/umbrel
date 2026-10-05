import {AuthorizedUrlState} from '@/features/files/components/file-viewer/authorized-url-state'
import {ViewerWrapper} from '@/features/files/components/file-viewer/viewer-wrapper'
import {FileSystemItem} from '@/features/files/types'
import {useAuthorizedHttpUrlQuery} from '@/modules/auth/http-auth'

interface ImageViewerProps {
	item: FileSystemItem
}

export default function ImageViewer({item}: ImageViewerProps) {
	const previewUrl = useAuthorizedHttpUrlQuery(`/api/files/view?path=${encodeURIComponent(item.path)}`)

	return (
		<AuthorizedUrlState query={previewUrl} showCloseButton>
			{(url) => (
				<ViewerWrapper showCloseButton>
					<img
						src={url}
						alt={item.name}
						className='absolute top-1/2 left-1/2 max-h-[80%] max-w-[90%] -translate-x-1/2 -translate-y-1/2 rounded-lg object-contain'
					/>
				</ViewerWrapper>
			)}
		</AuthorizedUrlState>
	)
}
