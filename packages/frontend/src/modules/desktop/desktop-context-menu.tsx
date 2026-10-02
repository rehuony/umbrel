import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Link} from 'react-router-dom'

import {ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger} from '@/components/ui/context-menu'
import {contextMenuClasses} from '@/components/ui/shared/menu'
import {useQueryParams} from '@/hooks/use-query-params'

import {ShortcutPopover} from './shortcut-dialog'

export function DesktopContextMenu({children}: {children: React.ReactNode}) {
	const {t} = useTranslation()
	const [showShortcut, setShowShortcut] = useState(false)
	const contentRef = useRef<HTMLDivElement>(null)
	const shortcutAnchorRef = useRef<HTMLDivElement>(null)
	const {params, addLinkSearchParams, remove} = useQueryParams()
	const isShowingDialog = params.get('dialog') !== null

	// Open the shortcut popover when triggered via URL (e.g., from Cmd+K)
	useEffect(() => {
		if (params.get('dialog') === 'add-shortcut') {
			if (shortcutAnchorRef.current) {
				shortcutAnchorRef.current.style.top = `${window.innerHeight / 2}px`
				shortcutAnchorRef.current.style.left = `${window.innerWidth / 2}px`
			}
			setShowShortcut(true)
			remove('dialog')
		}
	}, [params])

	return (
		<>
			<ContextMenu
				modal={false}
				onOpenChange={(open) => {
					if (open) {
						void import('@/routes/edit-widgets')
						void import('@/routes/wallpaper')
					}
				}}
			>
				<ContextMenuTrigger disabled={isShowingDialog}>{children}</ContextMenuTrigger>
				<ContextMenuContent ref={contentRef}>
					<ContextMenuItem
						onSelect={() => {
							const {top, left} = contentRef.current!.getBoundingClientRect()
							shortcutAnchorRef.current!.style.top = `${top - 28}px`
							shortcutAnchorRef.current!.style.left = `${left - 60}px`
							setTimeout(() => setShowShortcut(true), 200)
						}}
					>
						{t('desktop.context-menu.add-shortcut')}
					</ContextMenuItem>
					<ContextMenuItem asChild>
						<Link to='/edit-widgets'>{t('desktop.context-menu.edit-widgets')}</Link>
					</ContextMenuItem>
					<ContextMenuItem asChild>
						<Link to='/wallpaper'>{t('desktop.context-menu.change-wallpaper')}</Link>
					</ContextMenuItem>
					<ContextMenuItem asChild className={contextMenuClasses.item.rootDestructive}>
						<Link to={{search: addLinkSearchParams({dialog: 'logout'})}}>{t('desktop.context-menu.logout')}</Link>
					</ContextMenuItem>
				</ContextMenuContent>
			</ContextMenu>

			<ShortcutPopover open={showShortcut} onOpenChange={setShowShortcut} anchorRef={shortcutAnchorRef} />
		</>
	)
}
