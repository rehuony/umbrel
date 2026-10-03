import {DialogPortal} from '@radix-ui/react-dialog'
import {useEffect, useState, type CSSProperties} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate, useSearchParams} from 'react-router-dom'

import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {ImmersiveDialog, ImmersiveDialogOverlay} from '@/components/ui/immersive-dialog'
import {preventDialogDismissForToasts} from '@/components/ui/shared/dialog'
import {SHEET_EXIT_DURATION_MS, SheetContent, SheetTitle} from '@/components/ui/sheet'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {AppDropdown} from '@/modules/immersive-picker'
import {getDialogParamKey, useDialogOpenProps, useLinkToDialog} from '@/utils/dialog'

import {XTermTerminal} from './_shared'

export default function TerminalDialog() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const [searchParams] = useSearchParams()
	const appId = searchParams.get(getDialogParamKey('terminal', 'for')) || undefined
	const dialogProps = useDialogOpenProps('terminal', SHEET_EXIT_DURATION_MS)
	const linkToDialog = useLinkToDialog()
	const isTouchDevice = useIsTouchDevice()
	const [keyboardInset, setKeyboardInset] = useState(0)

	useEffect(() => {
		const viewport = window.visualViewport
		if (!isTouchDevice || !viewport) return
		const update = () =>
			setKeyboardInset(
				viewport.scale === 1 ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0,
			)
		update()
		viewport.addEventListener('resize', update)
		viewport.addEventListener('scroll', update)
		return () => {
			viewport.removeEventListener('resize', update)
			viewport.removeEventListener('scroll', update)
		}
	}, [isTouchDevice])

	return (
		<ImmersiveDialog {...dialogProps}>
			<DialogPortal>
				<SheetContent
					side='bottom-zoom'
					style={{'--terminal-keyboard-inset': `${keyboardInset}px`} as CSSProperties}
					aria-describedby={undefined}
					className='z-50 mx-auto flex h-[calc(100dvh-var(--sheet-top))] max-w-[1320px] flex-col gap-4 px-3 pt-6 pb-[calc(12px+var(--terminal-keyboard-inset))] md:w-[calc(100vw-50px)] md:px-5 md:pt-8 md:pb-[calc(20px+var(--terminal-keyboard-inset))] lg:h-[calc(100dvh-60px)] lg:w-[calc(100vw-120px)]'
					backdrop={<ImmersiveDialogOverlay />}
					closeButton={<DialogCloseButton className='absolute top-3 right-3 z-[60] sm:top-5 sm:right-5' />}
					onOpenAutoFocus={(event) => event.preventDefault()}
					onPointerDownOutside={preventDialogDismissForToasts}
				>
					<div className='flex w-full shrink-0 flex-wrap items-center justify-between gap-2 pr-12'>
						<SheetTitle variant='window'>{t('terminal')}</SheetTitle>
						{appId && <AppDropdown appId={appId} setAppId={(id) => navigate(linkToDialog('terminal', {for: id}))} />}
					</div>
					<XTermTerminal appId={appId} />
				</SheetContent>
			</DialogPortal>
		</ImmersiveDialog>
	)
}
