import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {ButtonLink} from '@/components/ui/button-link'
import {Dialog, DialogHeader, DialogScrollableContent, DialogTitle} from '@/components/ui/dialog'
import {Drawer, DrawerContent, DrawerHeader, DrawerTitle} from '@/components/ui/drawer'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {trpcReact} from '@/trpc/trpc'
import {IS_ANDROID} from '@/utils/misc'

import {useSettingsDialogProps} from './_components/shared'

export default function SoftwareUpdate() {
	const {t} = useTranslation()
	const isMobile = useIsMobile() && !IS_ANDROID
	const dialogProps = useSettingsDialogProps()
	const [confirmation, setConfirmation] = useState<'update' | 'rollback' | null>(null)
	const utils = trpcReact.useUtils()
	const check = trpcReact.system.checkUpdate.useQuery(undefined, {retry: false, refetchOnWindowFocus: false})
	const status = trpcReact.system.updateStatus.useQuery(undefined, {retry: false, refetchInterval: 2000})
	const installed = trpcReact.system.version.useQuery()
	const onSuccess = () => {
		setConfirmation(null)
		void utils.system.updateStatus.invalidate()
	}
	const update = trpcReact.system.update.useMutation({onSuccess})
	const rollback = trpcReact.system.rollback.useMutation({onSuccess})
	const state = status.data?.state
	useEffect(() => {
		if (state && ['succeeded', 'rolled-back'].includes(state.phase)) {
			void utils.system.checkUpdate.invalidate()
			void utils.system.version.invalidate()
		}
	}, [state?.phase, utils])
	const busy = state !== null && state !== undefined && !['succeeded', 'failed', 'rolled-back'].includes(state.phase)
	const pending = update.isPending || rollback.isPending
	const reconnecting = busy && status.isError && ['rebooting', 'checking'].includes(state.phase)
	const error = update.error || rollback.error || (!reconnecting && status.error) || check.error
	const canInstall = status.isSuccess && check.data?.available && !busy && !pending
	const Container = isMobile ? Drawer : Dialog
	const Content = isMobile ? DrawerContent : DialogScrollableContent
	const Header = isMobile ? DrawerHeader : DialogHeader
	const Title = isMobile ? DrawerTitle : DialogTitle

	return (
		<Container {...dialogProps}>
			<Content>
				<div className='space-y-5 px-5 py-6 text-14'>
					<Header>
						<Title>{t('system-update.title')}</Title>
					</Header>
					<p className='text-white/60'>{t('system-update.description')}</p>
					<p>{t('system-update.current', {version: installed.data?.version ?? '—'})}</p>
					{check.data && (
						<ButtonLink to={check.data.releasesUrl} target='_blank' rel='noopener noreferrer'>
							{check.data.repository}
						</ButtonLink>
					)}
					{check.data && !check.data.supported && <p>{t('system-update.unsupported')}</p>}
					{check.data?.supported && !check.data.release && <p>{t('system-update.no-release')}</p>}
					{check.data?.release && (
						<div className='space-y-3'>
							<p>
								{check.data.available
									? t('system-update.available', {version: check.data.release.version})
									: t('system-update.current-release')}
							</p>
							<p className='max-h-48 overflow-auto whitespace-pre-wrap text-white/60'>{check.data.release.notes}</p>
							<ButtonLink to={check.data.release.url} target='_blank' rel='noopener noreferrer'>
								{t('system-update.release-notes')}
							</ButtonLink>
						</div>
					)}
					{state && (
						<div role='status' className='space-y-2'>
							<p>
								{t(`system-update.phase.${state.phase}`)}
								{busy ? ` (${state.progress}%)` : ''}
							</p>
							{reconnecting && <p>{t('system-update.reconnecting')}</p>}
							{state.error && <p className='break-words text-destructive2-lightest'>{state.error}</p>}
						</div>
					)}
					{error && (
						<p role='alert' className='break-words text-destructive2-lightest'>
							{t('system-update.check-failed')} {error.message}
						</p>
					)}
					{confirmation ? (
						<div className='space-y-3 rounded-12 bg-white/5 p-4'>
							<p>{t(confirmation === 'update' ? 'system-update.confirm' : 'system-update.rollback-confirm')}</p>
							<div className='flex gap-2'>
								<Button disabled={pending} onClick={() => setConfirmation(null)}>
									{t('cancel')}
								</Button>
								<Button
									variant='primary'
									disabled={
										pending || busy || (confirmation === 'update' ? !canInstall : !status.data?.rollbackAvailable)
									}
									onClick={() =>
										confirmation === 'update' && check.data?.release
											? update.mutate({version: check.data.release.version})
											: rollback.mutate()
									}
								>
									{t('confirm')}
								</Button>
							</div>
						</div>
					) : (
						<div className='flex flex-wrap gap-2'>
							<Button
								disabled={check.isFetching || busy || pending}
								onClick={() => {
									void check.refetch()
									void status.refetch()
									void installed.refetch()
								}}
							>
								{t(check.isFetching ? 'system-update.checking' : 'system-update.check')}
							</Button>
							{canInstall && (
								<Button variant='primary' onClick={() => setConfirmation('update')}>
									{t('system-update.install')}
								</Button>
							)}
							{status.data?.rollbackAvailable && !busy && (
								<Button disabled={pending} onClick={() => setConfirmation('rollback')}>
									{t('system-update.rollback')}
								</Button>
							)}
						</div>
					)}
				</div>
			</Content>
		</Container>
	)
}
