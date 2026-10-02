import {useTranslation} from 'react-i18next'

import {trpcReact} from '@/trpc/trpc'

export function useHomeDirectoryName() {
	const {t} = useTranslation()
	const userQuery = trpcReact.user.get.useQuery()
	const userName = userQuery.data?.name
	return userName || t('files-sidebar.home')
}
