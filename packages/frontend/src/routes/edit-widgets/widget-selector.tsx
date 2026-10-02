import {Minus, Plus} from 'lucide-react'
import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {ReactNode, useId} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'

import {AppIcon} from '@/components/app-icon'
import {DialogCloseButton} from '@/components/ui/dialog-close-button'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {Sheet, SheetContent, SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {ScrollArea} from '@/components/ui/sheet-scroll-area'
import {WidgetCheckIcon} from '@/components/widget-check-icon'
import {useWidgets} from '@/hooks/use-widgets'
import {cn} from '@/lib/utils'
import {DockSpacer} from '@/modules/desktop/dock'
import {ExampleWidget, Widget} from '@/modules/widgets'
import {BackdropBlurVariantContext} from '@/modules/widgets/shared/backdrop-blur-context'

export function WidgetSelector({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void}) {
	const {availableWidgets, toggleSelected, selected, selectedTooMany, isLoading, isSaving} = useWidgets()
	const reduceMotion = useReducedMotion()
	// The desktop sets these dimensions in a layout effect. Fallbacks also
	// allow direct navigation without holding the entire editor behind a timer.
	const selectedH = selected.length === 0 ? 'var(--sheet-top)' : 'calc(var(--widget-h, 150px) + 8vh)'

	return (
		<>
			<AnimatePresence>
				{open && (
					<motion.div
						className='pointer-events-none absolute inset-x-0 top-0 z-50 flex flex-col items-center overflow-x-clip'
						inert
						initial={reduceMotion ? false : {opacity: 0, y: 20}}
						animate={{opacity: 1, y: 0}}
						exit={{opacity: 0, y: reduceMotion ? 0 : -10, transition: {duration: reduceMotion ? 0 : 0.1}}}
						transition={{duration: reduceMotion ? 0 : 0.2, ease: 'easeOut'}}
					>
						<div
							className={cn('flex flex-col items-center justify-center gap-5', selectedTooMany && 'animate-shake')}
							style={{height: selectedH}}
						>
							{/* The three-widget limit keeps the preview on one row without
						    carousel measurement or animation-frame polling. */}
							<div className='flex h-[var(--widget-h,150px)] w-screen max-w-[1040px] items-center justify-center gap-[var(--app-x-gap,30px)]'>
								{/* The row enters once; only subsequent additions bounce. */}
								<AnimatePresence initial={false}>
									{selected.map((widget) => (
										<motion.div
											key={widget.id}
											layout={reduceMotion ? false : 'position'}
											initial={reduceMotion ? false : {opacity: 1, y: -20}}
											animate={{opacity: 1, y: 0}}
											exit={{opacity: 0, y: reduceMotion ? 0 : 20}}
											transition={reduceMotion ? {duration: 0} : {type: 'spring', stiffness: 500, damping: 30}}
										>
											<Widget appId={widget.app.id} config={widget} />
										</motion.div>
									))}
								</AnimatePresence>
							</div>
						</div>
					</motion.div>
				)}
			</AnimatePresence>
			<WidgetSheet open={open} onOpenChange={onOpenChange} selectedCssHeight={selectedH}>
				<div className='flex flex-col items-start gap-5 md:gap-8' aria-busy={isSaving}>
					{availableWidgets.map(({appId, icon, name, widgets}) => (
						<WidgetSection key={appId} iconSrc={icon} title={name}>
							{widgets?.map((widget) => (
								<ErrorBoundary key={widget.id} fallback={null}>
									<WidgetChecker
										checked={selected.some((selectedWidget) => selectedWidget.id === widget.id)}
										disabled={isLoading}
										onToggle={() => toggleSelected(widget.id)}
									>
										<ExampleWidget type={widget.type} example={widget.example} />
									</WidgetChecker>
								</ErrorBoundary>
							))}
						</WidgetSection>
					))}
				</div>
			</WidgetSheet>
		</>
	)
}

function WidgetSheet({
	open,
	onOpenChange,
	children,
	selectedCssHeight,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	children: ReactNode
	selectedCssHeight: string
}) {
	const {t} = useTranslation()
	return (
		<BackdropBlurVariantContext value='default'>
			<Sheet open={open} onOpenChange={onOpenChange} modal={false}>
				<SheetContent
					className='mx-auto max-w-[1040px] transition-[height] motion-reduce:transition-none'
					aria-describedby={undefined}
					onInteractOutside={(e) => e.preventDefault()}
					style={{
						height: `calc(100dvh - ${selectedCssHeight})`,
					}}
					backdrop={<div className='fixed inset-0 z-30' onClick={() => onOpenChange(false)} />}
					closeButton={<DialogCloseButton className='absolute top-3 right-3 z-[60] sm:top-5 sm:right-5' />}
				>
					<ScrollArea className='umbrel-window-surface-top h-full'>
						<div className='flex h-full flex-col items-start gap-5 px-4 pt-6 md:gap-8 md:px-[80px] md:pt-12'>
							<SheetHeader>
								<SheetTitle>{t('widgets.edit.select-up-to-3-widgets')}</SheetTitle>
							</SheetHeader>
							<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>{children}</ErrorBoundary>
							<DockSpacer />
						</div>
					</ScrollArea>
				</SheetContent>
			</Sheet>
		</BackdropBlurVariantContext>
	)
}

function WidgetSection({iconSrc, title, children}: {iconSrc: string; title: string; children: ReactNode}) {
	return (
		<>
			<div className='flex items-center gap-3'>
				<AppIcon src={iconSrc} size={36} className='rounded-8' />
				<h3 className='text-20 leading-tight font-semibold'>{title}</h3>
			</div>
			<div className='flex flex-row flex-wrap gap-[20px]'>{children}</div>
			<div className='h-1'></div>
		</>
	)
}

function PlusIcon({className}: {className?: string}) {
	return (
		<span className={cn('flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white/80', className)}>
			<Plus className='h-4 w-4 text-black' strokeWidth={2.5} />
		</span>
	)
}

function MinusIcon({className}: {className?: string}) {
	return (
		<span className={cn('flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white/80', className)}>
			<Minus className='h-4 w-4 text-black' strokeWidth={2.5} />
		</span>
	)
}

function WidgetChecker({
	children,
	checked = false,
	disabled,
	onToggle,
}: {
	children: ReactNode
	checked?: boolean
	disabled: boolean
	onToggle: () => void
}) {
	const previewId = useId()
	return (
		<div className='group relative'>
			{/* Example widgets may contain controls; only the selection button is interactive. */}
			<div id={previewId} inert aria-hidden='true' className='pointer-events-none'>
				{children}
			</div>
			{/* The corner control belongs to the same button, including its overhang. */}
			<button
				type='button'
				aria-labelledby={previewId}
				aria-pressed={checked}
				disabled={disabled}
				className='absolute top-0 left-0 h-full w-full rounded-12 outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:rounded-20'
				onClick={onToggle}
			>
				<span aria-hidden='true' className='absolute top-0 right-0 translate-x-1/3 -translate-y-1/3'>
					{checked ? (
						<>
							<span className='text-brand group-hover:hidden'>
								<WidgetCheckIcon className='max-sm:scale-75' />
							</span>
							<span className='hidden group-hover:block'>
								<MinusIcon className='max-sm:scale-75' />
							</span>
						</>
					) : (
						<span className='opacity-0 transition-opacity group-hover:opacity-100'>
							<PlusIcon className='max-sm:scale-75' />
						</span>
					)}
				</span>
			</button>
		</div>
	)
}
