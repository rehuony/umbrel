import {useTranslation} from 'react-i18next'

import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import nasIcon from '@/features/files/assets/nas-icon-active.png'
import type {SourceType} from '@/features/photos/hooks/use-photo-sources'
import {cn} from '@/lib/utils'

// Storage sources share their artwork with the Files sidebar.
type IconType = SourceType | 'external-drive' | 'network-share'

// Same device artwork the Files sidebar uses for drives, NAS and phones; the
// umbrelOS mark for this device. `size` is the box in px.
export function SourceIcon({type, size = 20, className}: {type: IconType; size?: number; className?: string}) {
	const {t} = useTranslation()
	const box = {width: size, height: size}
	switch (type) {
		case 'umbrel':
			return (
				<img
					src='/assets/panel-icon.png'
					alt='umbrelOS'
					style={{...box, borderRadius: Math.round(size * 0.23)}}
					className={cn('shrink-0', className)}
					draggable={false}
				/>
			)
		case 'external-drive':
			return (
				<img
					src={externalStorageIcon}
					alt={t('external-drive')}
					style={box}
					className={cn('shrink-0', className)}
					draggable={false}
				/>
			)
		case 'network-share':
			return <img src={nasIcon} alt='NAS' style={box} className={cn('shrink-0', className)} draggable={false} />
	}
}
