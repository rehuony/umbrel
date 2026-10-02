import {useTranslation} from 'react-i18next'
import {RiArrowUpCircleFill, RiCheckboxCircleFill} from 'react-icons/ri'

import {Button} from '@/components/ui/button'
import {ButtonLink} from '@/components/ui/button-link'
import {trpcReact} from '@/trpc/trpc'

import {ListRow, ListRowMobile} from './list-row'
import {type SettingsItemIcon} from './settings-catalog'

export function SoftwareUpdateListRow({
	icon,
	isActive = false,
	mobile = false,
}: {
	icon: SettingsItemIcon
	isActive?: boolean
	mobile?: boolean
}) {
	const {t} = useTranslation()
	const installed = trpcReact.system.version.useQuery()
	const check = trpcReact.system.checkUpdate.useQuery(undefined, {
		retry: false,
		refetchOnReconnect: false,
		refetchOnWindowFocus: false,
	})
	const result = check.data
	const available = !check.isError && result?.available === true
	const upToDate = !check.isError && result?.supported && result.release && !result.available
	let description = t('check-for-latest-version')
	if (check.isError) description = t('system-update.check-error')
	else if (result?.supported === false) description = t('system-update.no-update')
	else if (available) description = t('system-update.available', {version: result?.release?.version})
	else if (upToDate) description = t('system-update.up-to-date')
	else if (result?.supported && !result.release) description = t('system-update.no-release')
	const StatusIcon = available ? RiArrowUpCircleFill : upToDate ? RiCheckboxCircleFill : null
	const Row = mobile ? ListRowMobile : ListRow

	return (
		<Row
			icon={icon}
			isActive={isActive}
			title={installed.data?.name ?? `umbrelOS ${installed.data?.version ?? '—'}`}
			description={
				<span className='flex items-center gap-1' role={check.isError ? 'alert' : 'status'}>
					{StatusIcon && (
						<StatusIcon className={available ? 'shrink-0 text-brand' : 'shrink-0 text-success'} aria-hidden />
					)}
					<span className='whitespace-normal'>{description}</span>
				</span>
			}
		>
			{available && !check.isFetching ? (
				<ButtonLink to='/settings/software-update' variant='primary' className='shrink-0'>
					{t('system-update.view')}
				</ButtonLink>
			) : (
				<Button className='shrink-0' disabled={check.isFetching} onClick={() => void check.refetch()}>
					{t(check.isFetching ? 'system-update.checking' : 'system-update.check')}
				</Button>
			)}
		</Row>
	)
}
