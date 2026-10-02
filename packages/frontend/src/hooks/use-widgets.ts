import {useMutation, useMutationState, useQueryClient} from '@tanstack/react-query'
import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {toast} from '@/components/ui/toast'
import {filesWidgets} from '@/features/files/widgets'
import {liveUsageWidgets, MAX_WIDGETS} from '@/modules/widgets/shared/constants'
import {systemAppsKeyed, useApps} from '@/providers/apps'
import {AppState, trpcReact} from '@/trpc/trpc'

export function useWidgets() {
	const apps = useApps()

	const {selected, toggleSelected, selectedTooMany, isSaving, isLoading: isSelectedLoading} = useWidgetSelection()
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
		isSaving,
		isLoading,
	}
}

type WidgetSelection = {widgetId: string; checked: boolean}
const selectionKey = ['widget-selection'] as const
const pendingSelections = {mutationKey: selectionKey, status: 'pending' as const}

// Replay pending intents over confirmed server state. A failed operation drops
// out of the mutation cache without rolling back unrelated, later selections.
function applySelection(selected: string[], {widgetId, checked}: WidgetSelection) {
	if (!checked) return selected.filter((id) => id !== widgetId)
	if (selected.includes(widgetId) || selected.length >= MAX_WIDGETS) return selected
	return [...selected, widgetId]
}

function useWidgetSelection() {
	const {t} = useTranslation()
	const utils = trpcReact.useUtils()
	const queryClient = useQueryClient()
	const widgetQ = trpcReact.widget.enabled.useQuery()
	const pending = useMutationState({
		filters: pendingSelections,
		select: (mutation) => mutation.state.variables as WidgetSelection,
	})
	const [selectedTooMany, setSelectedTooMany] = useState(false)
	useEffect(() => {
		if (!selectedTooMany) return
		const timeout = setTimeout(() => setSelectedTooMany(false), 500)
		return () => clearTimeout(timeout)
	}, [selectedTooMany])

	const selection = useMutation({
		mutationKey: selectionKey,
		// Removing a widget must finish before an addition can consume its slot.
		scope: {id: 'widget-selection'},
		retry: false,
		mutationFn: async ({widgetId, checked}: WidgetSelection) => {
			await utils.widget.enabled.cancel()
			const confirmed = utils.widget.enabled.getData() ?? (await utils.widget.enabled.fetch())
			// An earlier request may have failed, or another browser may already
			// have applied this intent. Do not send duplicate enable/disable calls.
			if (confirmed.includes(widgetId) === checked) return
			if (checked) await utils.client.widget.enable.mutate({widgetId})
			else await utils.client.widget.disable.mutate({widgetId})
		},
		onSuccess: async (_, change) => {
			await utils.widget.enabled.cancel()
			utils.widget.enabled.setData(undefined, (confirmed) => applySelection(confirmed ?? [], change))
		},
		onError: async () => {
			toast.error(t('something-went-wrong'), {area: 'widgets', description: t('try-again')})
			// A lost response does not prove the server rejected the write. Read
			// the authoritative state before processing any queued intent.
			await utils.widget.enabled.cancel()
			await utils.widget.enabled.fetch(undefined, {staleTime: 0}).catch(() => undefined)
		},
		onSettled: () => {
			if (queryClient.isMutating({mutationKey: selectionKey}) === 1) {
				return utils.widget.enabled.invalidate()
			}
		},
	})

	return {
		isLoading: widgetQ.isLoading,
		isSaving: pending.length > 0,
		selected: pending.reduce(applySelection, widgetQ.data ?? []),
		selectedTooMany,
		toggleSelected: (widgetId: string) => {
			const confirmed = utils.widget.enabled.getData()
			if (!confirmed) return
			// Read the cache synchronously so two clicks in the same render see
			// each other's intent, rather than both toggling the same stale value.
			const selected = queryClient
				.getMutationCache()
				.findAll(pendingSelections)
				.reduce((current, mutation) => applySelection(current, mutation.state.variables as WidgetSelection), confirmed)
			const checked = !selected.includes(widgetId)
			if (checked && selected.length >= MAX_WIDGETS) {
				setSelectedTooMany(true)
				toast.info(t('widgets.edit.select-up-to-3-widgets'), {id: 'widget-limit', area: 'widgets'})
				return
			}
			setSelectedTooMany(false)
			selection.mutate({widgetId, checked})
		},
	}
}
