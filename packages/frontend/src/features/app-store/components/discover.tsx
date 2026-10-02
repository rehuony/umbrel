import {ErrorBoundary} from 'react-error-boundary'
import {useTranslation} from 'react-i18next'

import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {SectionHeading} from '@/features/app-store/components/section-heading'
import {SortControl, useSortParam} from '@/features/app-store/components/sort-control'
import {StorefrontSectionView} from '@/features/app-store/components/storefront-sections'
import {VirtualAppGrid} from '@/features/app-store/components/virtual-app-grid'
import {storeRevealClass, storeRevealDelay} from '@/features/app-store/constants'
import {getAvailableSorts, sortApps} from '@/features/app-store/data/catalog'
import {useAppStatusMap} from '@/features/app-store/hooks/use-app-status'
import {useStorefront} from '@/features/app-store/hooks/use-storefront'
import {useAvailableApps} from '@/providers/available-apps'

// Project-owned editorial sections above the complete local catalog.
export default function Discover() {
	return (
		<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
			<DiscoverContent />
		</ErrorBoundary>
	)
}

function DiscoverContent() {
	const {t} = useTranslation()
	const availableApps = useAvailableApps()
	const storefront = useStorefront()
	const statuses = useAppStatusMap()
	const availableSorts = getAvailableSorts(storefront.dates)
	const sort = useSortParam(availableSorts)

	if (availableApps.isLoading || storefront.isLoading) return null

	const allApps = sortApps(availableApps.apps ?? [], sort, storefront.dates)

	// Sections compose in top to bottom, each a beat behind the one before
	const sectionDelay = (index: number) => storeRevealDelay(Math.min(90 + index * 70, 440))

	return (
		<>
			{storefront.sections.map((section, index) => (
				<div key={section.id} className={storeRevealClass} style={sectionDelay(index)}>
					<StorefrontSectionView section={section} statuses={statuses} />
				</div>
			))}
			{/* The complete catalog sits directly on the sheet, not in a card */}
			<section className='flex flex-col gap-4'>
				<div className={storeRevealClass} style={storeRevealDelay(90)}>
					<SectionHeading
						title={t('app-store.section.all-apps')}
						rightChildren={<SortControl availableSorts={availableSorts} />}
					/>
				</div>
				<VirtualAppGrid apps={allApps} statuses={statuses} revealDelayStart={130} />
			</section>
		</>
	)
}
