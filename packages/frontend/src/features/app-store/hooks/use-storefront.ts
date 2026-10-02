import {parseStorefront, resolveStorefront} from '@/features/app-store/data/storefront'
import storefrontData from '@/features/app-store/data/storefront.json'
import {useAvailableApps} from '@/providers/available-apps'

const storefront = parseStorefront(storefrontData)

// Editorial content ships with the dashboard. Only the local repository catalog is queried.
export function useStorefront() {
	const availableApps = useAvailableApps()
	return {
		...resolveStorefront(storefront, availableApps.appsKeyed ?? {}, availableApps.appsGroupedByCategory ?? {}),
		isLoading: availableApps.isLoading,
	}
}
