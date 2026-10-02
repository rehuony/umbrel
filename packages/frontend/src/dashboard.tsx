import {RouterProvider} from 'react-router-dom'

import {PendingRaidOperationProvider} from '@/features/storage/providers/pending-operation-context'
import {init} from '@/init'
import {initTokenRenewal} from '@/modules/auth/shared'
import {ConfirmationProvider} from '@/providers/confirmation'
import {GlobalSystemStateProvider} from '@/providers/global-system-state/index'
import {ImmersiveDialogProvider} from '@/providers/immersive-dialog'

import {AuthBootstrap} from './providers/auth-bootstrap'
import {RemoteLanguageInjector} from './providers/language'
import {Prefetcher} from './providers/prefetch'
import {RemoteWallpaperInjector, WallpaperProviderConnected} from './providers/wallpaper'
import {router} from './router'
import {TrpcProvider} from './trpc/trpc-provider'

initTokenRenewal()

init(
	<TrpcProvider>
		<AuthBootstrap />
		<RemoteLanguageInjector />
		{/* Wallpaper inside trpc because it requires backend call */}
		<WallpaperProviderConnected>
			<RemoteWallpaperInjector />
			<ConfirmationProvider>
				<GlobalSystemStateProvider>
					<PendingRaidOperationProvider>
						<ImmersiveDialogProvider>
							{/* Router navigations use React.startTransition(), which keeps the old page
								visible while lazy components load. Without this, view transitions snapshot the Suspense
								fallback instead of the actual destination page. */}
							<RouterProvider router={router} />
						</ImmersiveDialogProvider>
					</PendingRaidOperationProvider>
				</GlobalSystemStateProvider>
			</ConfirmationProvider>
		</WallpaperProviderConnected>
		<Prefetcher />
	</TrpcProvider>,
)
