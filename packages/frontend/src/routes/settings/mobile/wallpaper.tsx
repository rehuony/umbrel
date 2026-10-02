import {useTranslation} from 'react-i18next'

import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerScroller,
	DrawerTitle,
} from '@/components/ui/drawer'
import {WallpaperGrid} from '@/components/wallpaper-grid'
import {useSettingsDialogProps} from '@/routes/settings/_components/shared'

export function WallpaperDrawer() {
	const {t} = useTranslation()
	const title = t('wallpaper')
	const dialogProps = useSettingsDialogProps()

	return (
		<Drawer {...dialogProps}>
			<DrawerContent fullHeight>
				<DrawerHeader>
					<DrawerTitle>{title}</DrawerTitle>
					<DrawerDescription>{t('wallpaper-description')}</DrawerDescription>
				</DrawerHeader>
				<DrawerScroller>
					<WallpaperGrid scrollToActive />
				</DrawerScroller>
			</DrawerContent>
		</Drawer>
	)
}
