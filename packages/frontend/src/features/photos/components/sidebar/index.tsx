// Placeholder icons: swapped for the real Photos icon set later
import {
	Album,
	GalleryHorizontalEnd,
	Globe,
	Heart,
	Image,
	RectangleHorizontal,
	ScanLine,
	Trash2,
	Video,
	type LucideIcon,
} from 'lucide-react'
import {type ComponentProps} from 'react'
import {useTranslation} from 'react-i18next'
import {useLocation, useNavigate} from 'react-router-dom'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {ScrollArea} from '@/components/ui/scroll-area'
import {LivePhotoIcon} from '@/features/photos/components/live-photo-icon'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {EnrichmentIndicator} from '@/features/photos/components/sidebar/enrichment-indicator'
import {SidebarItem} from '@/features/photos/components/sidebar/sidebar-item'
import {SourceItem} from '@/features/photos/components/sidebar/source-item'
import {SourcesRootItem} from '@/features/photos/components/sidebar/sources-root-item'
import {SourceIcon} from '@/features/photos/components/sources/source-icon'
import {sectionPath, sourcePath, type PhotosSection} from '@/features/photos/constants'
import {usePhotoSources, type PhotoSource} from '@/features/photos/hooks/use-photo-sources'
import {cn} from '@/lib/utils'
import {useLinkToDialog} from '@/utils/dialog'

type Item = {section: PhotosSection; label: string; icon: LucideIcon | typeof LivePhotoIcon}

export function Sidebar({className}: {className?: string}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const {pathname} = useLocation()
	const {sources} = usePhotoSources()
	const linkToDialog = useLinkToDialog()
	const openDetails = (source: PhotoSource) => navigate(linkToDialog('photos-source', {id: source.id}))

	const libraryItems: Item[] = [
		{section: 'all', label: t('photos-sidebar.all'), icon: GalleryHorizontalEnd},
		{section: 'albums', label: t('photos-sidebar.albums'), icon: Album},
		{section: 'favorites', label: t('photos-sidebar.favorites'), icon: Heart},
		{section: 'photos', label: t('photos-sidebar.photos'), icon: Image},
		{section: 'videos', label: t('photos-sidebar.videos'), icon: Video},
		{section: 'deleted', label: t('photos-sidebar.deleted'), icon: Trash2},
	]

	// Smart collections, grouped under their own label like Files' Favorites.
	// People and Locations stay cut from v1 (no face/geo clustering yet) —
	// restore those two rows and their icons (Users, MapPin) when they return.
	const utilityItems: Item[] = [
		// {section: 'people', label: t('photos-sidebar.people'), icon: Users},
		// {section: 'locations', label: t('photos-sidebar.locations'), icon: MapPin},
		{section: 'live-photos', label: t('photos-sidebar.live-photos'), icon: LivePhotoIcon},
		{section: 'panoramas', label: t('photos-sidebar.panoramas'), icon: RectangleHorizontal},
		{section: 'screenshots', label: t('photos-sidebar.screenshots'), icon: ScanLine},
		{section: '360', label: t('photos-sidebar.spherical'), icon: Globe},
	]

	const renderItem = ({section, label, icon: Icon}: Item) => {
		const Component = section === 'deleted' ? DeletedItem : SidebarItem
		return (
			<Component
				key={section}
				label={label}
				icon={<Icon className='h-4 w-4' strokeWidth={1.75} />}
				isActive={pathname === sectionPath(section)}
				onClick={() => navigate(sectionPath(section))}
				// While media is still being prepared, the Library row carries the
				// progress ring — the whole library is what enrichment is filling
				trailing={section === 'all' ? <EnrichmentIndicator /> : undefined}
			/>
		)
	}

	return (
		<nav className={cn('flex min-h-0 flex-col', className)} aria-label={t('photos-sidebar.navigation')}>
			<ScrollArea className='h-full'>
				<SidebarSection>{libraryItems.map(renderItem)}</SidebarSection>

				<SidebarDivider />
				{/* Sources root row (with "+" to add one), then this Umbrel itself and every device feeding the library */}
				<SidebarSection>
					<SourcesRootItem onAdd={() => navigate(linkToDialog('photos-add-source'))} />
					{sources.map((source) => (
						<ContextMenu key={source.id}>
							<ContextMenuTrigger asChild>
								<div>
									<SourceItem
										label={source.name}
										icon={<SourceIcon type={source.type} />}
										isActive={pathname === sourcePath(source.id)}
										onClick={() => navigate(sourcePath(source.id))}
										onOptions={() => openDetails(source)}
									/>
								</div>
							</ContextMenuTrigger>
							<ContextMenuContent>
								<ContextMenuItem onClick={() => openDetails(source)}>{t('photos-source.manage')}</ContextMenuItem>
								{null}
							</ContextMenuContent>
						</ContextMenu>
					))}
				</SidebarSection>

				<SidebarDivider />
				<SidebarSection label={t('photos-sidebar.utilities')}>{utilityItems.map(renderItem)}</SidebarSection>

				{/* Spacer */}
				<div className='h-6' />
			</ScrollArea>
		</nav>
	)
}

const SidebarSection = ({children, label = ''}: {children: React.ReactNode; label?: string}) => {
	return (
		<section className='flex flex-col pr-4' aria-label={label}>
			{label && <div className='px-2 py-1 text-[11px] font-medium text-white/40'>{label}</div>}
			{children}
		</section>
	)
}

const SidebarDivider = () => {
	return (
		<div
			className='my-2.5 h-px w-full bg-[radial-gradient(35%_35%_at_35%_35%,rgba(255,255,255,0.35)_0%,transparent_70%)]'
			role='separator'
		/>
	)
}

// Deleted items can't go into an album, so the bin is out of reach while
// picking for one. Its own component, so only it — not the whole sidebar —
// re-renders as the selection changes.
function DeletedItem(props: Omit<ComponentProps<typeof SidebarItem>, 'disabled'>) {
	const picking = usePhotosSelection().pickingFor !== undefined
	return <SidebarItem {...props} disabled={picking} />
}
