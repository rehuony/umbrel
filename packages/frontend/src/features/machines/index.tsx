import {Outlet, useMatch, useParams} from 'react-router-dom'

import {SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {MachineRail} from '@/features/machines/components/machine-rail'
import {MachinesTabBar} from '@/features/machines/components/machines-tab-bar'
import {MACHINES_PATH} from '@/features/machines/constants'
import {useMachines} from '@/features/machines/hooks/use-machines'
import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'

import {MachineViewerActionsProvider} from './components/machine-viewer-actions'

export default function MachinesLayout() {
	return (
		<MachineViewerActionsProvider>
			<MachinesLayoutContent />
		</MachineViewerActionsProvider>
	)
}

function MachinesLayoutContent() {
	const {machines, isLoading} = useMachines()
	const {machineId} = useParams<{machineId: string}>()
	const isSettingsView = !!useMatch(`${MACHINES_PATH}/:machineId/settings`)
	const isMachineView = !!machineId && machineId !== 'new' && !isSettingsView
	const machine = isMachineView ? machines.find((machine) => machine.id === machineId) : undefined

	return (
		<div className='flex min-w-0 flex-col gap-5'>
			<SheetHeader>
				<SheetTitle>{t('machines')}</SheetTitle>
			</SheetHeader>
			{!isLoading && machines.length > 0 && <MachinesTabBar machines={machines} />}
			<div
				className={cn(
					'flex min-w-0 flex-col gap-3',
					isMachineView && 'items-center xl:flex-row xl:items-start xl:justify-center',
				)}
			>
				{machine && <div aria-hidden className='hidden w-12 shrink-0 xl:block' />}
				<div
					className={cn(
						'w-full min-w-0',
						// Reserve space for the shared window header, tabs, controls and dock.
						// Short viewports can scroll instead of collapsing the console to zero.
						isMachineView &&
							'relative shrink overflow-hidden rounded-12 border border-white/20 bg-black [--console-height:max(240px,calc(100dvh-420px))] xl:[--console-height:max(240px,calc(100dvh-360px))]',
						isMachineView &&
							(machine?.osId === 'android'
								? 'aspect-6/13 max-w-[calc(var(--console-height)*0.4615)]'
								: 'aspect-16/10 max-w-[calc(var(--console-height)*1.6)]'),
					)}
				>
					<div className={cn('w-full', isMachineView && 'h-full')}>
						<Outlet />
					</div>
				</div>
				{machine && <MachineRail machine={machine} />}
			</div>
		</div>
	)
}
