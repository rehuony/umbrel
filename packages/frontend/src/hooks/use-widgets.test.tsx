// @vitest-environment jsdom

import {notifyManager, QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TRPCClientError} from '@trpc/client'
import {getQueryKey} from '@trpc/react-query'
import {observable} from '@trpc/server/observable'
import {act, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {toast} from '@/components/ui/toast'
import {trpcReact} from '@/trpc/trpc'

import {useWidgets} from './use-widgets'

vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn(), info: vi.fn()}}))
vi.mock('@/features/files/widgets', () => ({
	filesWidgets: [{id: 'umbrel:files-favorites'}],
	filesWidgetTypes: [],
}))
vi.mock('@/providers/apps', () => ({
	useApps: () => ({isLoading: false}),
	systemAppsKeyed: {
		'UMBREL_live-usage': {name: 'Live Usage', icon: ''},
		UMBREL_files: {name: 'Files', icon: ''},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const initial = ['umbrel:storage', 'umbrel:system-stats', 'umbrel:files-favorites']
const memory = 'umbrel:memory'
type Write = {checked: boolean; widgetId: string; resolve: () => void; reject: (applied?: boolean) => void}
let server: string[]
let writes: Write[]
let client: QueryClient
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
let editor: ReturnType<typeof useWidgets>
let closeEditor: () => void
const widgetKey = getQueryKey(trpcReact.widget.enabled, undefined, 'query')
const selected = () => editor.selected.map((widget) => widget.id)

function Controls() {
	editor = useWidgets()
	return null
}

function Harness() {
	const [open, setOpen] = useState(true)
	closeEditor = () => setOpen(false)
	const desktop = useWidgets()
	return (
		<>
			{open && <Controls />}
			<output>{desktop.selected.map((widget) => widget.id).join(',')}</output>
		</>
	)
}

beforeEach(async () => {
	vi.clearAllMocks()
	notifyManager.setScheduler(queueMicrotask)
	server = [...initial]
	writes = []
	client = new QueryClient({defaultOptions: {queries: {staleTime: Infinity, retry: false}}})
	client.setQueryData(widgetKey, [...server])
	const rpc = trpcReact.createClient({
		links: [
			() =>
				({op}) =>
					observable((observer) => {
						const respond = (data: unknown) => {
							observer.next({result: {data}})
							observer.complete()
						}
						if (op.path === 'widget.enabled') respond([...server])
						else if (op.path === 'widget.enable' || op.path === 'widget.disable') {
							const {widgetId} = op.input as {widgetId: string}
							const checked = op.path === 'widget.enable'
							const apply = () => {
								if (server.includes(widgetId) === checked) throw new Error('Duplicate write')
								if (checked && server.length >= 3) throw new Error('Widget limit')
								server = checked ? [...server, widgetId] : server.filter((id) => id !== widgetId)
							}
							writes.push({
								widgetId,
								checked,
								resolve: () => {
									try {
										apply()
										respond(true)
									} catch (error) {
										observer.error(TRPCClientError.from(error as Error))
									}
								},
								reject: (applied = false) => {
									if (applied) apply()
									observer.error(TRPCClientError.from(new Error('Write failed')))
								},
							})
						} else throw new Error(`Unexpected procedure: ${op.path}`)
						return () => {}
					}),
		],
	})
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	await act(async () => {
		root.render(
			<trpcReact.Provider client={rpc} queryClient={client}>
				<QueryClientProvider client={client}>
					<Harness />
				</QueryClientProvider>
			</trpcReact.Provider>,
		)
	})
})

afterEach(async () => {
	await act(async () => root.unmount())
	client.clear()
	container.remove()
	notifyManager.setScheduler((callback) => setTimeout(callback, 0))
})

test.each([memory, 'umbrel:cpu'])(
	'immediately replaces a full selection with %s and saves in order',
	async (widgetId) => {
		await act(async () => {
			editor.toggleSelected(initial[0])
			editor.toggleSelected(widgetId)
		})
		expect(selected()).toEqual([...initial.slice(1), widgetId])
		expect(container.textContent).toBe(selected().join(','))
		expect(editor.isLoading).toBe(false)
		expect(editor.isSaving).toBe(true)
		expect(writes).toHaveLength(1)
		expect(writes[0]).toMatchObject({widgetId: initial[0], checked: false})

		await act(async () => client.invalidateQueries({queryKey: widgetKey}))
		expect(selected()).toEqual([...initial.slice(1), widgetId])
		await act(async () => writes[0].resolve())
		expect(writes).toHaveLength(2)
		expect(writes[1]).toMatchObject({widgetId, checked: true})
		await act(async () => writes[1].resolve())
		expect(server).toEqual(selected())
		expect(editor.isSaving).toBe(false)
	},
)

test('interprets rapid repeated clicks against pending intent instead of stale renders', async () => {
	await act(async () => {
		editor.toggleSelected(initial[0])
		editor.toggleSelected(initial[0])
		editor.toggleSelected(initial[0])
	})
	expect(selected()).toEqual(initial.slice(1))
	await act(async () => writes[0].resolve())
	await act(async () => writes[1].resolve())
	await act(async () => writes[2].resolve())
	expect(writes.map((write) => write.checked)).toEqual([false, true, false])
	expect(server).toEqual(initial.slice(1))
	expect(selected()).toEqual(server)
})

test('rolls back a failed removal without losing a later independent change', async () => {
	await act(async () => {
		editor.toggleSelected(initial[0])
		editor.toggleSelected(initial[1])
	})
	await act(async () => writes[0].reject())
	expect(selected()).toEqual([initial[0], initial[2]])
	expect(toast.error).toHaveBeenCalledOnce()
	await act(async () => writes[1].resolve())
	expect(selected()).toEqual(server)
	expect(server).toEqual([initial[0], initial[2]])
})

test('reconciles a lost response before processing the next click on that widget', async () => {
	await act(async () => {
		editor.toggleSelected(initial[0])
		editor.toggleSelected(initial[0])
	})
	await act(async () => writes[0].reject(true))
	expect(writes).toHaveLength(2)
	expect(writes[1]).toMatchObject({widgetId: initial[0], checked: true})
	await act(async () => writes[1].resolve())
	expect(selected()).toEqual(server)
	expect(server).toEqual([...initial.slice(1), initial[0]])
})

test('does not send an already satisfied intent after an earlier write failed', async () => {
	await act(async () => {
		editor.toggleSelected(initial[0])
		editor.toggleSelected(initial[0])
	})
	await act(async () => writes[0].reject())
	expect(writes).toHaveLength(1)
	expect(selected()).toEqual(initial)
	expect(editor.isSaving).toBe(false)
})

test('keeps the selection within the limit when a prerequisite removal fails', async () => {
	await act(async () => {
		editor.toggleSelected(initial[0])
		editor.toggleSelected(memory)
	})
	await act(async () => writes[0].reject())
	expect(selected()).toEqual(initial)
	await act(async () => writes[1].resolve())
	expect(selected()).toEqual(initial)
	expect(server).toEqual(initial)
	expect(editor.isSaving).toBe(false)
	expect(toast.error).toHaveBeenCalledTimes(2)
})

test('continues saving and shares optimistic state after closing the editor', async () => {
	await act(async () => {
		editor.toggleSelected(initial[0])
		editor.toggleSelected(memory)
		closeEditor()
	})
	expect(container.textContent).toBe([...initial.slice(1), memory].join(','))
	await act(async () => writes[0].resolve())
	await act(async () => writes[1].resolve())
	expect(container.textContent).toBe(server.join(','))
	expect(server).toEqual([...initial.slice(1), memory])
})

test('explains the three-widget limit without sending a rejected addition', async () => {
	await act(async () => editor.toggleSelected(memory))
	expect(writes).toHaveLength(0)
	expect(selected()).toEqual(initial)
	expect(toast.info).toHaveBeenCalledWith('widgets.edit.select-up-to-3-widgets', {
		id: 'widget-limit',
		area: 'widgets',
	})
})
