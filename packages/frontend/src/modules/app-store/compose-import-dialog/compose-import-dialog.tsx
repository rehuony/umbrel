import {lazy, Suspense, useRef, useState, type InputHTMLAttributes} from 'react'
import {useTranslation} from 'react-i18next'
import {TbAlertCircle, TbCheck, TbChevronDown, TbCode, TbFileUpload, TbWorld} from 'react-icons/tb'

import {AppIcon} from '@/components/app-icon'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {toast} from '@/components/ui/toast'
import {cn} from '@/lib/utils'
import {trpcReact, type RouterOutput} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'

const ComposeEditor = lazy(() => import('./compose-editor'))
const initialMetadata = {
	id: '',
	name: '',
	version: '1.0.0',
	description: '',
	icon: '',
	category: 'Utilities',
	tagline: '',
	website: '',
	service: '',
	port: '',
	containerPort: '',
	path: '/',
}
const fileSizeLimit = 1024 * 1024
const textareaClass =
	'w-full resize-y rounded-8 border border-white/10 bg-white/4 px-3 py-2 text-13 text-white/80 outline-hidden placeholder:text-white/30 focus-visible:border-white/50 focus-visible:bg-white/10 disabled:opacity-40'

export function ComposeImportDialog() {
	const {t} = useTranslation()
	const dialog = useDialogOpenProps('import-compose')
	const utils = trpcReact.useUtils()
	const fileInput = useRef<HTMLInputElement>(null)
	const [definition, setDefinition] = useState('')
	const [metadata, setMetadata] = useState(initialMetadata)
	const [readingFile, setReadingFile] = useState(false)
	const [review, setReview] = useState<RouterOutput['apps']['prepareImport'] | null>(null)
	const [error, setError] = useState('')
	const prepare = trpcReact.apps.prepareImport.useMutation()
	const install = trpcReact.apps.importCompose.useMutation({
		onSuccess: () => {
			utils.apps.invalidate()
			utils.appStore.invalidate()
			utils.user.invalidate()
			setDefinition('')
			setMetadata(initialMetadata)
			setReview(null)
			setError('')
			dialog.onOpenChange(false)
			toast.success(t('panel-catalog.import-success'), {area: 'app-store'})
		},
		onError: (error) => setError(error.message),
	})
	const busy = readingFile || prepare.isPending || install.isPending
	const close = () => {
		if (busy) return
		dialog.onOpenChange(false)
		setReview(null)
		setError('')
	}
	const inspect = async () => {
		if (busy || !definition.trim()) return
		setError('')
		if (new Blob([definition]).size > fileSizeLimit) {
			setError(t('panel-catalog.file-too-large'))
			return
		}
		try {
			setReview(
				await prepare.mutateAsync({
					definition,
					metadata: {...metadata, port: Number(metadata.port), containerPort: Number(metadata.containerPort)},
				}),
			)
		} catch (error) {
			setError((error as Error).message)
		}
	}
	const readFile = async (file: File) => {
		if (file.size > fileSizeLimit) {
			setError(t('panel-catalog.file-too-large'))
			return
		}
		setReadingFile(true)
		setError('')
		try {
			setDefinition(await file.text())
		} catch (error) {
			setError((error as Error).message)
		} finally {
			setReadingFile(false)
		}
	}
	const field = (name: keyof typeof metadata, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
		<label className='block min-w-0 space-y-1.5 text-12 text-white/60'>
			<span>{label}</span>
			<Input
				{...props}
				sizeVariant='short-square'
				className='text-13 text-white/85'
				name={name}
				value={metadata[name]}
				disabled={busy}
				onChange={(event) => setMetadata((previous) => ({...previous, [name]: event.target.value}))}
			/>
		</label>
	)
	const preview = review?.metadata ?? metadata
	const editorValue = review?.definition ?? definition
	return (
		<Dialog
			open={dialog.open}
			onOpenChange={(open) => {
				if (!open) close()
			}}
		>
			<DialogContent
				className='h-[min(780px,calc(100dvh-40px))] max-h-[calc(100dvh-24px)] max-w-[calc(100%-24px)] gap-0 overflow-hidden p-0 sm:max-w-[1040px]'
				onPointerDownOutside={(event) => event.preventDefault()}
			>
				<div className='flex shrink-0 items-center gap-3 border-b border-white/7 px-5 py-4 md:px-6 md:py-5'>
					<div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-12 bg-white/5 text-white/70'>
						<TbCode className='h-5 w-5' aria-hidden />
					</div>
					<div className='min-w-0 space-y-1'>
						<DialogTitle className='text-18'>{t('panel-catalog.import-title')}</DialogTitle>
						<DialogDescription className='leading-relaxed'>{t('panel-catalog.import-description')}</DialogDescription>
					</div>
				</div>
				<form
					className='flex min-h-0 flex-1 flex-col'
					onInvalidCapture={(event) => {
						const details = (event.target as HTMLElement).closest('details')
						if (details) details.open = true
					}}
					onSubmit={(event) => {
						event.preventDefault()
						if (busy) return
						if (review) {
							setError('')
							install.mutate({definition: review.definition, metadata: review.metadata})
						} else void inspect()
					}}
				>
					<div className='grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:overflow-hidden'>
						<section className='flex min-h-[320px] min-w-0 flex-col border-b border-white/7 bg-black/15 md:min-h-0 md:border-r md:border-b-0'>
							<div className='flex shrink-0 items-center justify-between gap-2 px-5 py-4'>
								<div className='min-w-0'>
									<h3 className='text-13 font-medium'>{t('panel-catalog.compose-file')}</h3>
								</div>
								{!review && (
									<>
										<input
											ref={fileInput}
											type='file'
											className='hidden'
											accept='.yaml,.yml,text/yaml,application/yaml'
											disabled={busy}
											onChange={(event) => {
												const file = event.target.files?.[0]
												event.target.value = ''
												if (file) void readFile(file)
											}}
										/>
										<Button
											type='button'
											size='sm'
											className='w-auto shrink-0 gap-1.5'
											disabled={busy}
											onClick={() => fileInput.current?.click()}
										>
											<TbFileUpload className='h-4 w-4' aria-hidden />
											{t('files-action.upload')}
										</Button>
									</>
								)}
							</div>
							<div className='h-[280px] min-h-0 overflow-hidden border-t border-white/5 md:h-auto md:flex-1'>
								<Suspense
									fallback={
										<textarea
											aria-label={t('panel-catalog.compose-file')}
											className='h-full w-full resize-none bg-transparent p-4 font-mono text-13 outline-hidden'
											value={editorValue}
											readOnly={busy || !!review}
											onChange={(event) => setDefinition(event.target.value)}
										/>
									}
								>
									<ComposeEditor
										value={editorValue}
										onChange={setDefinition}
										readOnly={busy || !!review}
										label={t('panel-catalog.compose-file')}
										placeholder={t('panel-catalog.compose-placeholder')}
									/>
								</Suspense>
							</div>
						</section>
						<div className='min-w-0 p-5 md:overflow-y-auto md:p-6'>
							<div className='mb-6 flex items-center gap-3 border-b border-white/7 pb-5'>
								<AppIcon src={preview.icon} size={56} className='shrink-0 rounded-12' />
								<div className='min-w-0'>
									<p className='truncate text-17 font-semibold'>{preview.name || t('name')}</p>
									<p className='mt-1 truncate text-12 text-white/45'>{preview.tagline || t('panel-catalog.tagline')}</p>
									<p className='mt-2 truncate text-11 text-white/40'>
										{preview.category} <span className='px-1'>·</span> {preview.version}
									</p>
								</div>
							</div>
							{review ? (
								<section className='space-y-5'>
									<h3 className='flex items-center gap-2 text-14 font-medium'>
										<TbCheck className='h-4 w-4 text-brand' aria-hidden />
										{t('panel-catalog.review-title')}
									</h3>
									<p className='text-13 leading-relaxed whitespace-pre-wrap text-white/70'>{review.app.description}</p>
									<dl className='space-y-3 text-12'>
										<div className='flex justify-between gap-4'>
											<dt className='text-white/45'>{t('panel-catalog.app-id')}</dt>
											<dd className='break-all'>{review.metadata.id}</dd>
										</div>
										{review.metadata.service && (
											<div className='flex justify-between gap-4'>
												<dt className='text-white/45'>{t('panel-catalog.web-entry')}</dt>
												<dd className='text-right break-all'>
													{review.metadata.service}:{review.metadata.containerPort}
													{review.metadata.path}
												</dd>
											</div>
										)}
										{!!review.metadata.port && (
											<div className='flex justify-between gap-4'>
												<dt className='text-white/45'>{t('panel-catalog.entry-port')}</dt>
												<dd>{review.metadata.port}</dd>
											</div>
										)}
									</dl>
									{!review.metadata.port && (
										<p className='text-12 leading-relaxed text-white/50'>{t('panel-catalog.background-app')}</p>
									)}
									{review.hostNetwork && (
										<p className='rounded-12 bg-amber-400/10 p-3 text-13 leading-relaxed text-amber-200'>
											{t('panel-catalog.host-network-description')}
										</p>
									)}
									<p className='border-t border-white/7 pt-4 text-12 leading-relaxed text-white/50'>
										{t('panel-catalog.uninstall-warning')}
									</p>
								</section>
							) : (
								<div className='space-y-5'>
									<section className='space-y-3'>
										<h3 className='text-14 font-medium'>{t('panel-catalog.app-details')}</h3>
										<div className='grid grid-cols-2 gap-3'>
											{field('name', t('name'), {required: true, maxLength: 100, autoComplete: 'off'})}
											{field('id', t('panel-catalog.app-id'), {
												required: true,
												maxLength: 64,
												pattern: '[a-z][a-z0-9\\-]*',
												placeholder: 'my-app',
												autoCapitalize: 'none',
												autoComplete: 'off',
												spellCheck: false,
											})}
										</div>
										{field('icon', t('panel-catalog.icon-url'), {
											required: true,
											type: 'url',
											pattern: 'https?://.*',
											placeholder: 'https://',
											spellCheck: false,
										})}
										<label className='block space-y-1.5 text-12 text-white/60'>
											<span>{t('panel-catalog.description')}</span>
											<textarea
												name='description'
												required
												rows={3}
												maxLength={10000}
												className={textareaClass}
												value={metadata.description}
												disabled={busy}
												onChange={(event) =>
													setMetadata((previous) => ({...previous, description: event.target.value}))
												}
											/>
										</label>
										<div className='grid grid-cols-2 gap-3'>
											{field('version', t('panel-catalog.version'), {required: true, maxLength: 100})}
											{field('category', t('panel-catalog.category'), {required: true, maxLength: 100})}
										</div>
										{field('tagline', t('panel-catalog.tagline'), {maxLength: 200})}
										{field('website', t('panel-catalog.website'), {
											type: 'url',
											pattern: 'https?://.*',
											placeholder: 'https://',
											spellCheck: false,
										})}
									</section>
									<details className='group border-t border-white/7 pt-4'>
										<summary className='flex cursor-pointer list-none items-center gap-2 text-14 font-medium outline-hidden focus-visible:text-brand [&::-webkit-details-marker]:hidden'>
											<TbWorld className='h-4 w-4 text-white/50' aria-hidden />
											{t('panel-catalog.web-entry')}
											<TbChevronDown
												className='ml-auto h-4 w-4 text-white/40 transition-transform group-open:rotate-180'
												aria-hidden
											/>
										</summary>
										<div className='space-y-3 pt-4'>
											{field('service', t('panel-catalog.web-service'), {spellCheck: false})}
											<div className='grid grid-cols-2 gap-3'>
												{field('containerPort', t('panel-catalog.container-port'), {
													required: !!metadata.service,
													type: 'number',
													min: 1,
													max: 65535,
												})}
												{field('port', t('panel-catalog.entry-port'), {
													required: !!metadata.service,
													type: 'number',
													min: 1,
													max: 65535,
												})}
											</div>
											{field('path', t('panel-catalog.web-path'), {pattern: '/.*', spellCheck: false})}
										</div>
									</details>
								</div>
							)}
						</div>
					</div>
					<div className='shrink-0 border-t border-white/7 px-5 py-4 md:px-6'>
						{error && (
							<p
								role='alert'
								className='mb-3 flex max-h-24 items-start gap-2 overflow-y-auto text-13 break-words text-red-300'
							>
								<TbAlertCircle className='mt-0.5 h-4 w-4 shrink-0' aria-hidden />
								<span className='min-w-0'>{error}</span>
							</p>
						)}
						<div className='flex items-center justify-end gap-4'>
							<p className='mr-auto hidden text-12 text-white/40 sm:block'>
								{t('install-review.step-count', {current: review ? 2 : 1, total: 2})}
							</p>
							<DialogFooter className='flex-row justify-end'>
								<Button
									type='button'
									size='dialog'
									disabled={busy}
									className='w-auto'
									onClick={
										review
											? () => {
													setReview(null)
													setError('')
												}
											: close
									}
								>
									{review ? t('back') : t('cancel')}
								</Button>
								<Button
									type='submit'
									size='dialog'
									variant='primary'
									className={cn('w-auto', busy && 'cursor-wait')}
									disabled={busy || !editorValue.trim()}
								>
									{busy ? t('loading') : review ? t('install-review.install-now') : t('continue')}
								</Button>
							</DialogFooter>
						</div>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	)
}
