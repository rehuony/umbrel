// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {createMemoryRouter, RouterProvider} from 'react-router-dom'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {ComposeImportDialog} from '@/modules/app-store/compose-import-dialog'
import {EXIT_DURATION_MS} from '@/utils/dialog'

const api = vi.hoisted(() => ({prepare: vi.fn(), install: vi.fn(), invalidate: vi.fn(), toast: vi.fn()}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('@/providers/apps', () => ({systemAppsKeyed: {}}))
vi.mock('@/components/ui/toast', () => ({toast: {success: api.toast}}))
vi.mock('@/modules/app-store/compose-import-dialog/compose-editor', () => ({
	default: ({
		value,
		onChange,
		readOnly,
		label,
	}: {
		value: string
		onChange: (value: string) => void
		readOnly: boolean
		label: string
	}) => (
		<textarea aria-label={label} value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} />
	),
}))
vi.mock('@/trpc/trpc', async () => {
	const {useState} = await import('react')
	return {
		trpcReact: {
			useUtils: () => ({
				apps: {invalidate: api.invalidate},
				appStore: {invalidate: api.invalidate},
				user: {invalidate: api.invalidate},
			}),
			apps: {
				prepareImport: {
					useMutation: () => {
						const [isPending, setPending] = useState(false)
						return {
							isPending,
							mutateAsync: async (input: unknown) => {
								setPending(true)
								try {
									return await api.prepare(input)
								} finally {
									setPending(false)
								}
							},
						}
					},
				},
				importCompose: {
					useMutation: (options: {onSuccess: () => void; onError: (error: Error) => void}) => {
						const [isPending, setPending] = useState(false)
						return {
							isPending,
							mutate: (input: unknown) => {
								setPending(true)
								void api
									.install(input)
									.then(options.onSuccess, options.onError)
									.finally(() => setPending(false))
							},
						}
					},
				},
			},
		},
	}
})
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
let root: ReturnType<typeof createRoot>
let router: ReturnType<typeof createMemoryRouter>
let container: HTMLDivElement
const definition = 'services:\n  worker:\n    image: alpine:3.22\n'
const button = (text: string) =>
	Array.from(document.querySelectorAll('button')).find((element) => element.textContent === text)!
const editor = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="panel-catalog.compose-file"]')!
const input = (name: string) => document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!
async function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
	await act(async () => {
		const prototype =
			element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
		Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
		element.dispatchEvent(new Event('input', {bubbles: true}))
	})
}
async function click(text: string) {
	await act(async () => button(text).click())
}
async function fillDraft() {
	await fill(editor(), definition)
	await fill(input('name'), 'Example worker')
	await fill(input('id'), 'example-worker')
	await fill(input('icon'), 'https://example.com/icon.png')
	await fill(input('description'), 'A background worker')
}
async function selectFile(file: File) {
	const chooser = document.querySelector<HTMLInputElement>('input[type=file]')!
	await act(async () => {
		Object.defineProperty(chooser, 'files', {configurable: true, value: [file]})
		chooser.dispatchEvent(new Event('change', {bubbles: true}))
	})
	return chooser
}

beforeEach(async () => {
	vi.clearAllMocks()
	api.prepare.mockImplementation(async ({definition, metadata}) => ({
		definition,
		metadata,
		app: {...metadata},
		hostNetwork: false,
	}))
	api.install.mockResolvedValue(true)
	container = document.createElement('div')
	document.body.appendChild(container)
	router = createMemoryRouter([{path: '/app-store', element: <ComposeImportDialog />}], {
		initialEntries: ['/app-store?dialog=import-compose'],
	})
	root = createRoot(container)
	await act(async () => root.render(<RouterProvider router={router} />))
})
afterEach(async () => {
	await act(async () => root.unmount())
	router.dispose()
	container.remove()
})

test('preserves the draft after cancel, review and back, and installs the newly reviewed payload', async () => {
	await fillDraft()
	await click('cancel')
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, EXIT_DURATION_MS + 10))
	})
	await act(async () => router.navigate('/app-store?dialog=import-compose'))
	expect(editor().value).toBe(definition)
	expect(input('name').value).toBe('Example worker')
	await click('continue')
	expect(api.install).not.toHaveBeenCalled()
	expect(editor().readOnly).toBe(true)
	await click('back')
	await fill(input('name'), 'Updated worker')
	await click('continue')
	await click('install-review.install-now')
	expect(api.install).toHaveBeenCalledWith({
		definition,
		metadata: expect.objectContaining({name: 'Updated worker', port: 0, containerPort: 0}),
	})
	expect(api.invalidate).toHaveBeenCalledTimes(3)
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, EXIT_DURATION_MS + 10))
	})
	await act(async () => router.navigate('/app-store?dialog=import-compose'))
	expect(input('name').value).toBe('')
	expect(input('id').value).toBe('')
	expect(editor().value).toBe('')
})

test('keeps the editable draft on validation failure and the reviewed definition on install failure', async () => {
	await fillDraft()
	api.prepare.mockRejectedValueOnce(new Error('Invalid Compose service'))
	await click('continue')
	expect(document.querySelector('[role=alert]')?.textContent).toContain('Invalid Compose service')
	expect(editor().value).toBe(definition)
	expect(input('name').value).toBe('Example worker')
	await click('continue')
	api.install.mockRejectedValueOnce(new Error('Port already in use'))
	await click('install-review.install-now')
	expect(document.querySelector('[role=alert]')?.textContent).toContain('Port already in use')
	expect(editor().value).toBe(definition)
	expect(button('install-review.install-now').disabled).toBe(false)
	expect(api.toast).not.toHaveBeenCalled()
	await click('back')
	expect(input('name').value).toBe('Example worker')
	expect(document.querySelector('[role=alert]')).toBeNull()
})

test('waits for uploaded content before review and preserves existing text on oversized or unreadable files', async () => {
	await fillDraft()
	let finishRead!: (value: string) => void
	const file = new File(['new content'], 'compose.yaml')
	Object.defineProperty(file, 'text', {
		value: () =>
			new Promise<string>((resolve) => {
				finishRead = resolve
			}),
	})
	const chooser = await selectFile(file)
	expect(button('cancel').disabled).toBe(true)
	expect(button('loading').disabled).toBe(true)
	expect(editor().readOnly).toBe(true)
	expect(api.prepare).not.toHaveBeenCalled()
	await act(async () => finishRead('services:\n  replacement:\n    image: alpine:3.22'))
	expect(chooser.value).toBe('')
	expect(editor().value).toContain('replacement')
	expect(button('continue').disabled).toBe(false)
	await selectFile(new File(['x'.repeat(1024 * 1024 + 1)], 'large.yaml'))
	expect(document.querySelector('[role=alert]')?.textContent).toContain('panel-catalog.file-too-large')
	expect(editor().value).toContain('replacement')
	const unreadable = new File([''], 'unreadable.yaml')
	Object.defineProperty(unreadable, 'text', {value: () => Promise.reject(new Error('Cannot read file'))})
	await selectFile(unreadable)
	expect(document.querySelector('[role=alert]')?.textContent).toContain('Cannot read file')
	expect(editor().value).toContain('replacement')
})

test('reveals invalid web fields and preserves gateway metadata for an existing app_proxy service', async () => {
	await fillDraft()
	await fill(input('id'), 'Invalid_ID')
	await click('continue')
	expect(input('id').validity.patternMismatch).toBe(true)
	expect(api.prepare).not.toHaveBeenCalled()
	await fill(input('id'), 'example-worker')
	await fill(input('service'), 'worker')
	await act(async () => {
		input('containerPort').checkValidity()
	})
	expect(document.querySelector('details')?.open).toBe(true)
	await fill(input('service'), '')
	await fill(input('port'), '8080')
	await click('continue')
	expect(api.prepare).toHaveBeenCalledWith({definition, metadata: expect.objectContaining({service: '', port: 8080})})
	expect(document.body.textContent).not.toContain('panel-catalog.background-app')
})
