// @vitest-environment jsdom
import {afterEach, expect, test, vi} from 'vitest'

import type {UserApp} from '@/trpc/trpc'

import {appToUrlWithAppPath} from './misc'

const app = {
	port: 3000,
	path: '/settings?tab=general',
	hiddenService: 'app.onion',
	externalAccess: {enabled: true, panelOrigin: 'https://panel.example.com', origin: 'https://app.example.com'},
} as UserApp
const locationAt = (origin: string) => {
	const url = new URL(origin)
	vi.stubGlobal('location', url)
}
afterEach(() => vi.unstubAllGlobals())
test('launches an external app on its registered HTTPS origin without the container port', () => {
	locationAt('https://panel.example.com')
	expect(appToUrlWithAppPath(app)).toBe('https://app.example.com/settings?tab=general')
	expect(appToUrlWithAppPath(app, 'http:')).toBe('https://app.example.com/settings?tab=general')
	expect(appToUrlWithAppPath({...app, externalAccess: {...app.externalAccess!, origin: null}})).toBe('')
})
test('does not let an application path replace the external authority', () => {
	locationAt('https://panel.example.com')
	for (const path of ['https://other.example.com/', '//other.example.com/', 'javascript:alert(1)']) {
		expect(appToUrlWithAppPath(app, 'https:', path)).toBe('https://app.example.com/')
	}
})
test('keeps LAN and Tor launch addresses when outside the external panel', () => {
	locationAt('http://umbrel.local')
	expect(appToUrlWithAppPath(app)).toBe('http://umbrel.local:3000/settings?tab=general')
	expect(appToUrlWithAppPath(app, 'http:', 'javascript:alert(1)')).toBe('http://umbrel.local:3000/')
	locationAt('http://panel.onion')
	expect(appToUrlWithAppPath(app)).toBe('http://app.onion/settings?tab=general')
})
