// @vitest-environment jsdom

import {describe, expect, test} from 'vitest'

import type {UserApp} from '@/trpc/trpc'

import {getActiveAppsUsingStoragePaths} from './storage-in-use'

function appInState(state: UserApp['state']) {
	return {
		id: 'test-app',
		name: 'Test App',
		state,
		storage: {
			dataRoot: null,
			folderAccess: [],
			customMounts: [
				{
					serviceName: 'app',
					targetPath: '/media',
					sourcePath: '/External/Drive/Media',
					readOnly: false,
				},
			],
		},
	} as unknown as UserApp
}

describe('storage in-use display', () => {
	test('only treats an explicitly stopped app as inactive', () => {
		expect(getActiveAppsUsingStoragePaths([appInState('unknown')], ['/External/Drive'])).toHaveLength(1)
		expect(getActiveAppsUsingStoragePaths([appInState('stopped')], ['/External/Drive'])).toHaveLength(0)
	})

	test('includes the app whose own persistent data is on the selected drive', () => {
		const app = {
			...appInState('ready'),
			storage: {
				...appInState('ready').storage,
				customMounts: [],
				dataRoot: {location: '/External/Drive/Apps/test-app', canMoveExternally: true, status: 'available'},
			},
		} as UserApp
		expect(getActiveAppsUsingStoragePaths([app], ['/External/Drive']).map(({id}) => id)).toEqual(['test-app'])
		expect(getActiveAppsUsingStoragePaths([app], ['/External/Other'])).toEqual([])
	})
})
