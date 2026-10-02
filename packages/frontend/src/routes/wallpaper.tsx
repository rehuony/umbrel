import {useReducedMotion} from 'motion/react'
import {useCallback, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {ScrollArea} from '@/components/ui/sheet-scroll-area'
import {WallpaperGrid} from '@/components/wallpaper-grid'
import {DockSpacer} from '@/modules/desktop/dock'
import {EXIT_DURATION_MS, useAfterDelayedClose} from '@/utils/dialog'

export default function WallpaperPage() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const [open, setOpen] = useState(true)
	const reduceMotion = useReducedMotion()
	const returnToDesktop = useCallback(() => navigate('/'), [navigate])
	useAfterDelayedClose(open, returnToDesktop, reduceMotion ? 0 : EXIT_DURATION_MS)

	return (
		<Sheet open={open} onOpenChange={setOpen} modal={false}>
			<SheetContent
				aria-describedby={undefined}
				className='mx-auto h-[calc(100dvh-var(--sheet-top))] max-w-[1040px] md:h-[calc(100dvh-150px-8vh)]'
				onInteractOutside={(event) => event.preventDefault()}
				backdrop={<div className='fixed inset-0 z-30' onClick={() => setOpen(false)} />}
				closeButton={<DialogCloseButton className='absolute top-3 right-3 z-[60] sm:top-5 sm:right-5' />}
			>
				<ScrollArea className='umbrel-window-surface-top h-full'>
					<div className='flex flex-col gap-5 px-4 pt-6 md:gap-8 md:px-[80px] md:pt-12'>
						<SheetHeader>
							<SheetTitle>{t('wallpaper')}</SheetTitle>
						</SheetHeader>
						<WallpaperGrid className='sm:grid-cols-3 sm:gap-4' />
						<DockSpacer />
					</div>
				</ScrollArea>
			</SheetContent>
		</Sheet>
	)
}
