import React from 'react'
import {RouteObject} from 'react-router-dom'

import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {ErrorBoundaryPageFallback} from '@/components/ui/error-boundary-page-fallback'
import {EnsureLoggedIn} from '@/modules/auth/ensure-logged-in'

const FullscreenConsole = React.lazy(() => import('@/features/machines/components/fullscreen-console'))

// Resolve page chunks before entering the shared window, including direct console links.
export const machinesRoutes: RouteObject[] = [
	{
		path: 'machines',
		lazy: async () => ({Component: (await import('@/features/machines')).default}),
		ErrorBoundary: ErrorBoundaryCardFallback,
		children: [
			{
				index: true,
				lazy: async () => ({Component: (await import('@/features/machines/components/machines-index')).default}),
			},
			{
				path: 'new',
				lazy: async () => ({Component: (await import('@/features/machines/components/os-catalog')).default}),
			},
			{
				path: 'new/configure',
				lazy: async () => ({Component: (await import('@/features/machines/components/create-machine')).default}),
			},
			{
				path: ':machineId',
				lazy: async () => ({Component: (await import('@/features/machines/components/machine-window')).default}),
			},
			{
				path: ':machineId/settings',
				lazy: async () => ({Component: (await import('@/features/machines/components/machine-settings')).default}),
			},
		],
	},
]

// Top-level route (no desktop/dock chrome), opened in a new browser tab
export const machinesConsoleRoutes: RouteObject[] = [
	{
		path: 'machines/:machineId/fullscreen',
		element: (
			<EnsureLoggedIn>
				<FullscreenConsole />
			</EnsureLoggedIn>
		),
		ErrorBoundary: ErrorBoundaryPageFallback,
	},
]
