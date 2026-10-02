import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {Input, Labeled} from '@/components/ui/input'
import {Loading} from '@/components/ui/loading'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/components/ui/toast'
import {BackButton} from '@/routes/settings/_components/shared'
import {trpcReact, type RouterOutput} from '@/trpc/trpc'

type Settings = RouterOutput['system']['externalAccess']

export function ExternalAccessPanel({onBack}: {onBack: () => void}) {
	const {t} = useTranslation()
	const settings = trpcReact.system.externalAccess.useQuery()
	if (settings.isError) return <p role='alert'>{t('external-access.load-error')}</p>
	if (!settings.data) return <Loading />
	return <ExternalAccessForm initial={settings.data} onBack={onBack} />
}

function ExternalAccessForm({initial, onBack}: {initial: Settings; onBack: () => void}) {
	const {t} = useTranslation()
	const [draft, setDraft] = useState(initial)
	const [proxies, setProxies] = useState(initial.trustedProxies.join(', '))
	const utils = trpcReact.useUtils()
	const save = trpcReact.system.setExternalAccess.useMutation({
		onSuccess: () => {
			void utils.system.externalAccess.invalidate()
			void utils.apps.list.invalidate()
			toast.success(t('external-access.saved'))
		},
	})
	return (
		<form
			className='flex flex-col gap-5'
			onSubmit={(event) => {
				event.preventDefault()
				save.mutate({
					...draft,
					panelOrigin: draft.panelOrigin.trim(),
					trustedProxies: proxies.split(/[\s,]+/).filter(Boolean),
				})
			}}
		>
			<BackButton onClick={onBack}>{t('advanced-settings')}</BackButton>
			<label className='flex items-center justify-between gap-3'>
				<div>
					<div className='text-15 font-medium'>{t('external-access.title')}</div>
					<p className='mt-1 text-12 text-white/50'>{t('external-access.description')}</p>
				</div>
				<Switch
					checked={draft.enabled}
					onCheckedChange={(enabled) => setDraft({...draft, enabled})}
					disabled={save.isPending}
				/>
			</label>
			<Labeled label={t('external-access.panel-domain')}>
				<Input
					value={draft.panelOrigin}
					onValueChange={(panelOrigin) => setDraft({...draft, panelOrigin})}
					placeholder='https://panel.example.com'
					disabled={save.isPending}
				/>
			</Labeled>
			<Labeled label={t('external-access.proxy-addresses')}>
				<Input value={proxies} onValueChange={setProxies} placeholder='100.64.0.10' disabled={save.isPending} />
			</Labeled>
			<details className='text-12 text-white/50'>
				<summary className='cursor-pointer transition-colors hover:text-white/70'>
					{t('external-access.proxy-help')}
				</summary>
				<p className='mt-2'>{t('external-access.proxy-note')}</p>
			</details>
			{save.error && (
				<p role='alert' className='text-13 text-destructive2-lightest'>
					{save.error.message}
				</p>
			)}
			<div className='flex justify-end gap-2'>
				<Button type='button' onClick={onBack} disabled={save.isPending}>
					{t('cancel')}
				</Button>
				<Button type='submit' variant='primary' disabled={save.isPending}>
					{save.isPending ? t('external-access.saving') : t('external-access.save')}
				</Button>
			</div>
		</form>
	)
}
