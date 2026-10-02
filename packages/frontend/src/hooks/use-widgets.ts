// TODO: move to widgets module
import {useState} from 'react'

import {filesWidgets} from '@/features/files/widgets'
import {liveUsageWidgets, MAX_WIDGETS} from '@/modules/widgets/shared/constants'
import {systemAppsKeyed, useApps} from '@/providers/apps'
import {AppState, trpcReact} from '@/trpc/trpc'

export function useWidgets() {
	// Consider having `selectedTooMany` outside this hook
	const [selectedTooMany, setSelectedTooMany] = useState(false)
	const apps = useApps()

	const {selected, enable, disable, isLoading: isSelectedLoading} = useEnableWidgets()
	const isLoading = apps.isLoading || isSelectedLoading

	const availableSystemWidgets = [
		{
			appId: 'live-usage',
			icon: systemAppsKeyed['UMBREL_live-usage'].icon,
			name: systemAppsKeyed['UMBREL_live-usage'].name,
			state: 'ready' as const satisfies AppState,
			widgets: liveUsageWidgets,
		},

		// features/files widgets
		{
			appId: 'files',
			icon: systemAppsKeyed['UMBREL_files'].icon,
			name: systemAppsKeyed['UMBREL_files'].name,
			state: 'ready' as const satisfies AppState,
			widgets: filesWidgets,
		},
	]

	const availableWidgets = availableSystemWidgets

	// No need to specify app id because widget endpoints are unique
	// TODO: don't call it `toggle` because it's not a toggle
	const toggleSelected = (widgetId: string, checked: boolean) => {
		if (selected.length >= MAX_WIDGETS && checked) {
			setSelectedTooMany(true)
			setTimeout(() => setSelectedTooMany(false), 500)
			return
		}
		setSelectedTooMany(false)
		if (selected.includes(widgetId)) {
			disable(widgetId)
		} else {
			enable(widgetId)
		}
	}

	const appFromWidgetId = (id: string) => {
		return availableWidgets.find((app) => app.widgets?.find((widget) => widget.id === id))
	}

	const selectedWithAppInfo = selected
		.filter((id) => {
			const app = appFromWidgetId(id)
			return !!app
		})
		.map((id) => {
			// Expect app to be found because we filtered out widgets without apps
			const app = appFromWidgetId(id)!

			// Assume we'll always find a widget
			const widget = app.widgets.find((w) => w.id === id)!

			return {
				...widget,
				app: {
					id: app.appId,
					icon: app.icon,
					name: app.name,
					state: app.state,
				},
			}
		})

	return {
		availableWidgets,
		selected: selectedWithAppInfo,
		toggleSelected,
		selectedTooMany,
		isLoading,
	}
}

function useEnableWidgets() {
	const utils = trpcReact.useUtils()
	const widgetQ = trpcReact.widget.enabled.useQuery()

	const enableMut = trpcReact.widget.enable.useMutation({
		onSuccess: () => {
			utils.user.invalidate()
			utils.widget.enabled.invalidate()
		},
	})

	const disableMut = trpcReact.widget.disable.useMutation({
		onSuccess: () => {
			utils.user.invalidate()
			utils.widget.enabled.invalidate()
		},
	})

	const selected = widgetQ.data ?? []
	// const setSelected = (widgets: WidgetT[]) => enableMut.mutate({widgets})

	const isLoading = widgetQ.isLoading || enableMut.isPending

	return {
		isLoading,
		selected,
		enable: (widgetId: string) => enableMut.mutate({widgetId}),
		disable: (widgetId: string) => disableMut.mutate({widgetId}),
	}
}
