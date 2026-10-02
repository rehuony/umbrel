import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {AppIcon} from '@/components/app-icon'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {toast} from '@/components/ui/toast'
import {trpcReact, type RouterOutput} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'

export function ComposeImportDialog() {
	const {t} = useTranslation()
	const dialog = useDialogOpenProps('import-compose')
	const utils = trpcReact.useUtils()
	const [definition, setDefinition] = useState('')
	const [metadata, setMetadata] = useState({
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
	})
	const [review, setReview] = useState<RouterOutput['apps']['prepareImport'] | null>(null)
	const [error, setError] = useState('')
	const prepare = trpcReact.apps.prepareImport.useMutation()
	const install = trpcReact.apps.importCompose.useMutation({
		onSuccess: () => {
			utils.apps.invalidate()
			utils.appStore.invalidate()
			utils.user.invalidate()
			setDefinition('')
			setReview(null)
			dialog.onOpenChange(false)
			toast.success(t('panel-catalog.import-success'), {area: 'app-store'})
		},
		onError: (error) => setError(error.message),
	})
	const busy = prepare.isPending || install.isPending
	const inspect = async () => {
		setError('')
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
	const field = (name: keyof typeof metadata, label: string, required = false, type = 'text') => (
		<label className='block space-y-1 text-13' key={name}>
			<span>{label}</span>
			<Input
				value={metadata[name]}
				type={type}
				required={required}
				disabled={busy}
				onChange={(event) => setMetadata((previous) => ({...previous, [name]: event.target.value}))}
			/>
		</label>
	)
	return (
		<Dialog
			open={dialog.open}
			onOpenChange={(open) => {
				if (busy) return
				dialog.onOpenChange(open)
				if (!open) {
					setReview(null)
					setError('')
				}
			}}
		>
			<DialogContent className='max-h-[85dvh] overflow-y-auto'>
				<DialogTitle>{t('panel-catalog.import-title')}</DialogTitle>
				<DialogDescription>{t('panel-catalog.import-description')}</DialogDescription>
				{review ? (
					<div className='space-y-4'>
						<div className='flex items-center gap-3'>
							<AppIcon src={review.app.icon} size={48} />
							<div className='text-18 font-semibold'>{review.app.name}</div>
						</div>
						<p className='text-13 whitespace-pre-wrap text-white/70'>{review.app.description}</p>
						{review.hostNetwork && (
							<p className='text-13 text-amber-200'>{t('panel-catalog.host-network-description')}</p>
						)}
						<p className='text-13 text-white/70'>{t('panel-catalog.uninstall-warning')}</p>
						<div className='flex gap-2'>
							<Button
								disabled={busy}
								onClick={() => {
									setReview(null)
									setError('')
								}}
							>
								{t('back')}
							</Button>
							<Button
								variant='primary'
								disabled={busy}
								onClick={() => install.mutate({definition: review.definition, metadata: review.metadata})}
							>
								{busy ? t('loading') : t('install-review.install-now')}
							</Button>
						</div>
					</div>
				) : (
					<form
						className='space-y-4'
						onSubmit={(event) => {
							event.preventDefault()
							void inspect()
						}}
					>
						<div className='grid gap-3 md:grid-cols-2'>
							{field('id', t('panel-catalog.app-id'), true)}
							{field('name', t('name'), true)}
							{field('icon', t('panel-catalog.icon-url'), true, 'url')}
							{field('description', t('panel-catalog.description'), true)}
							{field('version', t('panel-catalog.version'), true)}
							{field('category', t('panel-catalog.category'), true)}
							{field('tagline', t('panel-catalog.tagline'))}
							{field('website', t('panel-catalog.website'), false, 'url')}
							{field('service', t('panel-catalog.web-service'))}
							{field('containerPort', t('panel-catalog.container-port'), !!metadata.service, 'number')}
							{field('port', t('panel-catalog.entry-port'), !!metadata.service, 'number')}
							{field('path', t('panel-catalog.web-path'))}
						</div>
						<label className='block space-y-2 text-13'>
							<span>{t('panel-catalog.compose-file')}</span>
							<input
								type='file'
								accept='.yaml,.yml,text/yaml,application/yaml'
								disabled={busy}
								onChange={async (event) => {
									const file = event.target.files?.[0]
									if (!file) return
									if (file.size > 1024 * 1024) return setError(t('panel-catalog.file-too-large'))
									try {
										setDefinition(await file.text())
										setError('')
									} catch (error) {
										setError((error as Error).message)
									}
								}}
							/>
							<textarea
								aria-label={t('panel-catalog.compose-file')}
								required
								rows={10}
								value={definition}
								disabled={busy}
								className='w-full rounded-12 bg-white/5 p-3 font-mono text-12'
								onChange={(event) => setDefinition(event.target.value)}
							/>
						</label>
						<Button type='submit' variant='primary' disabled={busy || !definition.trim()}>
							{busy ? t('loading') : t('continue')}
						</Button>
					</form>
				)}
				{error && (
					<p role='alert' className='text-13 text-red-300'>
						{error}
					</p>
				)}
			</DialogContent>
		</Dialog>
	)
}
