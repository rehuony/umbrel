// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, type ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
import {expect, test, vi} from 'vitest'

import type {FileSystemItem} from '@/features/files/types'

import {MiniBrowser} from './index'

vi.mock('@/features/files/hooks/use-list-directory', () => ({
	useListDirectory: () => ({listing: undefined, isLoading: false, fetchMoreItems: vi.fn()}),
}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => ({files: {list: {invalidate: vi.fn()}}}),
		files: {createDirectory: {useMutation: () => ({mutate: vi.fn()})}},
	},
}))
vi.mock('@/features/files/components/shared/file-item-icon', () => ({FileItemIcon: () => null}))
vi.mock('@/hooks/use-is-mobile', () => ({useIsMobile: () => false, useIsSmallMobile: () => false}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/components/ui/dialog', () => {
	const Container = ({children}: {children: ReactNode}) => <div>{children}</div>
	return Object.fromEntries(
		['Dialog', 'DialogContent', 'DialogFooter', 'DialogHeader', 'DialogTitle'].map((name) => [name, Container]),
	)
})
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

test('custom sources at the same path cannot share an in-flight directory listing', async () => {
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
	const container = document.createElement('div')
	const root = createRoot(container)
	const item = (name: string): FileSystemItem => ({
		name,
		path: `/remote/${name}`,
		type: 'directory',
		size: 0,
		modified: 0,
		operations: [],
	})
	let resolveFirst!: (items: FileSystemItem[]) => void
	const first = vi.fn(() => new Promise<FileSystemItem[]>((resolve) => (resolveFirst = resolve)))
	const second = vi.fn(async () => [item('Second account')])
	try {
		await act(async () => {
			root.render(
				<QueryClientProvider client={client}>
					<MiniBrowser open onOpenChange={() => {}} rootPath='/remote' listDirectory={first} />
					<MiniBrowser open onOpenChange={() => {}} rootPath='/remote' listDirectory={second} />
				</QueryClientProvider>,
			)
		})
		expect(first).toHaveBeenCalledOnce()
		expect(second).toHaveBeenCalledOnce()
		await act(async () => {
			resolveFirst([item('First account')])
			await new Promise((resolve) => setTimeout(resolve, 10))
		})
		expect(container.textContent).toContain('First account')
		expect(container.textContent).toContain('Second account')
	} finally {
		await act(async () => root.unmount())
		client.clear()
	}
})
