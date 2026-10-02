import {useEffect} from 'react'
import {useTranslation} from 'react-i18next'

import {EmptyFolderIcon} from '@/features/files/assets/empty-folder-icon'
import {Listing} from '@/features/files/components/listing'
import {useSetActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {useListRecents} from '@/features/files/hooks/use-list-recents'

export function RecentsListing() {
	const {listing, isLoading, error} = useListRecents()
	const items = listing || []
	const setActionsBarConfig = useSetActionsBarConfig()

	useEffect(() => {
		setActionsBarConfig({
			hidePath: !!error,
		})
	}, [error])

	return (
		<Listing
			items={items}
			totalItems={items.length} // Since there's no pagination for recents, as it's capped at 50
			selectableItems={items}
			isLoading={isLoading}
			error={error}
			hasMore={false} // we only track 50 max recents, which is less than the initial batch size
			onLoadMore={async () => false} // no-op since we don't need to load more
			enableFileDrop={false}
			CustomEmptyView={EmptyStateRecents}
		/>
	)
}

function EmptyStateRecents() {
	const {t} = useTranslation()

	return (
		<div className='flex h-full flex-col items-center justify-center gap-3 p-4 pt-0 text-center'>
			<EmptyFolderIcon />
			<div className='text-12 text-white/40'>{t('files-empty.recents')}</div>
		</div>
	)
}
