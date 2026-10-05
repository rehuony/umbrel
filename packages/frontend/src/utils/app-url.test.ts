// @vitest-environment jsdom
import {afterEach, expect, test, vi} from 'vitest'

import type {UserApp} from '@/trpc/trpc'

import {appToUrlWithAppPath, isLocalPanelHost} from './misc'

const app = {
	port: 3000,
	path: '/settings?tab=general',
	hiddenService: 'app.onion',
	externalUrl: 'https://app.example.com',
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
	expect(appToUrlWithAppPath({...app, externalUrl: ''})).toBe('')
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

test.each([
	'192.168.1.2',
	'10.2.3.4',
	'172.20.0.1',
	'[fd00::1]',
	'[::1]',
	'umbrel.local',
	'umbrel.home.arpa',
	'device.tailnet.ts.net',
	'localhost',
	'100.90.0.1',
])('uses local service ports for %s', (host) => {
	expect(isLocalPanelHost(host)).toBe(true)
})
test.each(['panel.example.com', '203.0.113.4', '172.32.0.1', '[2001:db8::1]'])(
	'uses external launch URLs for %s',
	(host) => {
		expect(isLocalPanelHost(host)).toBe(false)
	},
)
test('preserves an explicit external subpath, query and fragment', () => {
	locationAt('https://panel.example.com')
	expect(appToUrlWithAppPath({...app, externalUrl: 'https://apps.example.com/agent/?view=chat#top'})).toBe(
		'https://apps.example.com/agent/?view=chat#top',
	)
})

test('uses the native service protocol independently of the local panel protocol', () => {
	locationAt('https://umbrel.local')
	expect(appToUrlWithAppPath({...app, portProtocol: 'http'})).toBe('http://umbrel.local:3000/settings?tab=general')
	locationAt('http://umbrel.local')
	expect(appToUrlWithAppPath({...app, portProtocol: 'https'})).toBe('https://umbrel.local:3000/settings?tab=general')
	locationAt('https://panel.example.com')
	expect(appToUrlWithAppPath({...app, portProtocol: 'http'})).toBe('https://app.example.com/settings?tab=general')
})

test('does not construct a broken Tor URL for direct applications without a hidden service', () => {
	locationAt('http://panel.onion')
	expect(appToUrlWithAppPath({...app, hiddenService: ''})).toBe('')
})

test('does not treat a public domain containing an onion label as a Tor panel', () => {
	locationAt('https://panel.onion.example.com')
	expect(appToUrlWithAppPath(app)).toBe('https://app.example.com/settings?tab=general')
})
