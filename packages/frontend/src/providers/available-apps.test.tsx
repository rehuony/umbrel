// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type {RegistryApp} from '@/trpc/trpc'

import {AvailableAppsProvider, useAllAvailableApps, useAvailableApps} from './available-apps'

const fixtures = vi.hoisted(() => {
	const app = (appStoreId: string, id: string) => ({appStoreId, id, category: 'files'}) as RegistryApp
	return {
		firstOnly: app('first-store', 'first-only'),
		firstConflict: app('first-store', 'conflict'),
		communityConflict: app('community-store', 'conflict'),
	}
})

vi.mock('@/trpc/trpc', async (importOriginal) => {
	const original = await importOriginal<typeof import('@/trpc/trpc')>()
	return {
		...original,
		trpcReact: {
			appStore: {
				registry: {
					useQuery: () => ({
						data: [
							{
								meta: {id: 'first-store'},
								apps: [fixtures.firstOnly, fixtures.firstConflict],
							},
							{meta: {id: 'community-store'}, apps: [fixtures.communityConflict]},
						],
						isLoading: false,
						isError: false,
					}),
				},
			},
		},
	}
})

const observe = vi.fn()

function Probe() {
	const allApps = useAllAvailableApps()
	const defaultApps = useAvailableApps()
	const communityApps = useAvailableApps('community-store')
	observe({allApps, defaultApps, communityApps})
	return null
}

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('AvailableAppsProvider', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		vi.clearAllMocks()
	})

	test('quarantines global collisions while keeping registry-qualified browsing available', () => {
		act(() =>
			root.render(
				<AvailableAppsProvider>
					<Probe />
				</AvailableAppsProvider>,
			),
		)

		const value = observe.mock.calls.at(-1)?.[0]
		expect(value.allApps.apps).toEqual([fixtures.firstOnly])
		expect(value.allApps.appsKeyed).toEqual({'first-only': fixtures.firstOnly})
		expect(value.allApps.ambiguousAppIds).toEqual(new Set(['conflict']))
		expect(value.defaultApps.appsKeyed.conflict).toBeUndefined()
		expect(value.communityApps.appsKeyed.conflict).toBe(fixtures.communityConflict)
	})
})
