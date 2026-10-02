import {useTranslation} from 'react-i18next'

import {SidebarItem} from '@/features/files/components/sidebar/sidebar-item'
import {useTrashPath} from '@/features/files/hooks/use-home-path'
import {useNavigate} from '@/features/files/hooks/use-navigate'

export function SidebarTrash() {
	const {t} = useTranslation()
	const {navigateToDirectory, currentPath} = useNavigate()
	const trashPath = useTrashPath()
	const isTrash = currentPath === trashPath

	return (
		<div className='mr-4'>
			<SidebarItem
				item={{name: t('files-sidebar.trash'), path: trashPath, type: 'directory'}}
				isActive={isTrash}
				onClick={() => navigateToDirectory(trashPath)}
				disableDrop={isTrash}
				navigateToPath={false}
			/>
		</div>
	)
}
