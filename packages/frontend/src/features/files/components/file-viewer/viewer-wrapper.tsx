import {useEffect, useRef} from 'react'
import {useTranslation} from 'react-i18next'
import {RiCloseCircleFill} from 'react-icons/ri'

import {useFilesStore} from '@/features/files/store/use-files-store'
import {dialogHeaderCircleButtonClass} from '@/utils/element-classes'
import {isBeneathModal} from '@/utils/is-beneath-modal'

interface ViewerWrapperProps {
	children: React.ReactNode
	enabled?: boolean
	showCloseButton?: boolean
	dontCloseOnSpacebar?: boolean // used for video viewer, spacebar is used to play/pause
	dontCloseOnEscape?: boolean // used for text editor, escape handled by editor
	dontCloseOnClickOutside?: boolean // used for text editor, click-outside disabled during editing
	className?: string // additional classes on the overlay container
}

export const ViewerWrapper: React.FC<ViewerWrapperProps> = ({
	children,
	enabled = true,
	showCloseButton = false,
	dontCloseOnSpacebar,
	dontCloseOnEscape,
	dontCloseOnClickOutside,
	className,
}) => {
	const {t} = useTranslation()
	const setViewerItem = useFilesStore((s) => s.setViewerItem)

	const wrapperRef = useRef<HTMLDivElement>(null)

	const handleClose = () => {
		setViewerItem(null)
	}

	// Handle click outside and escape key
	useEffect(() => {
		if (!enabled) return
		// TODO: ignore clicks inside floatingislands
		const handleClickOutside = (e: MouseEvent) => {
			if (dontCloseOnClickOutside) return

			const isClickInViewer = wrapperRef.current?.contains(e.target as Node)

			if (!isClickInViewer) {
				handleClose()
			}
		}

		const handleEscape = (e: KeyboardEvent) => {
			// Keys pressed in a dialog open over the viewer are the dialog's: its
			// Escape closes the dialog, and leaves the viewer up
			if (isBeneathModal(wrapperRef.current, e)) return
			if (e.key === 'Escape' && !dontCloseOnEscape) {
				e.preventDefault()
				handleClose()
			}
			if (e.key === ' ' && !dontCloseOnSpacebar) {
				e.preventDefault()
				handleClose()
			}
		}

		document.addEventListener('mousedown', handleClickOutside)
		window.addEventListener('keydown', handleEscape)

		return () => {
			document.removeEventListener('mousedown', handleClickOutside)
			window.removeEventListener('keydown', handleEscape)
		}
	}, [enabled, dontCloseOnClickOutside, dontCloseOnEscape, dontCloseOnSpacebar])

	return (
		<div
			className={`absolute top-0 left-1/2 z-10 flex h-full w-full -translate-x-1/2 items-center justify-center bg-black/80 ${className ?? ''}`}
		>
			{showCloseButton && (
				<button
					type='button'
					className={`${dialogHeaderCircleButtonClass} absolute top-3 left-3 z-20 sm:top-5 sm:left-5`}
					onClick={handleClose}
					aria-label={t('close')}
				>
					<RiCloseCircleFill className='h-5 w-5 lg:h-6 lg:w-6' />
				</button>
			)}
			<div ref={wrapperRef} className='max-w-full min-w-0 p-2 md:px-10'>
				{children}
			</div>
		</div>
	)
}
