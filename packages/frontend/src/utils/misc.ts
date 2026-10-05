import {indexBy} from 'remeda'

import {UserApp} from '@/trpc/trpc'

export function firstNameFromFullName(name: string) {
	return name.split(' ')[0]
}

export function sleep(milliseconds: number) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function isNormalNumber(value: number | null | undefined): value is number {
	if (value === undefined || value === null) return false
	return value !== Infinity && value !== -Infinity && !isNaN(value)
}

// https://stackoverflow.com/a/39419171
export function assertUnreachable(x: never): never {
	throw new Error("Didn't expect to get here, got " + x)
}

/**
 * Does what lodash's keyBy does, but returns with better types
 */
export function keyBy<T, U extends keyof T>(array: ReadonlyArray<T>, key: U): Record<T[U] & string, T> {
	return indexBy(array, (el) => el[key])
}

// Not using `url-join` or others because they remove desired slashes after joining. `new URL('?bla=1', 'http://localhost:3001/a/').href` preserves trailing slash to return 'http://localhost:3001/a/?bla=1'
// The `transmission` app depends on this behavior because the app's full path is `http://localhost:9091/transmission/web/` but when joining a query string, we want it to be `http://localhost:9091/transmission/web/?bla=1`
export function urlJoin(base: string, path: string) {
	return new URL(path, base).href
}

/** `urlJoin` doesn't work when used like so: `urlJoin('foo', 'bar')`, and sometimes we just want basic behavior */
export function pathJoin(base: string, path: string) {
	// Remove trailing slash from base and leading slash from path
	return base.replace(/\/$/, '') + '/' + path.replace(/^\//, '')
}

// Launch selection follows the panel address the browser is using. A public
// hostname uses the app's external URL; local addresses keep direct service ports.
export function isLocalPanelHost(hostname = location.hostname) {
	const host = hostname
		.toLowerCase()
		.replace(/^\[|\]$/g, '')
		.replace(/\.$/, '')
	if (
		host === 'localhost' ||
		host.endsWith('.local') ||
		host.endsWith('.localhost') ||
		host.endsWith('.home.arpa') ||
		host.endsWith('.ts.net')
	)
		return true
	if (host.includes(':')) return /^(::1$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/.test(host)
	if (!host.includes('.')) return true
	if (!/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false
	const parts = host.split('.').map(Number)
	if (parts.length !== 4 || !parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return false
	const [a, b] = parts
	return (
		a === 10 ||
		a === 127 ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 169 && b === 254) ||
		(a === 100 && b >= 64 && b <= 127)
	)
}

export function appToUrl(app: UserApp, protocol = location.protocol) {
	if (isOnionPage()) return app.hiddenService ? `${location.protocol}//${app.hiddenService}` : ''
	if (!isLocalPanelHost()) return app.externalUrl || ''
	return `${app.portProtocol ? `${app.portProtocol}:` : protocol}//${location.hostname}:${app.port}`
}

export function appToUrlWithAppPath(app: UserApp, protocol = location.protocol, path?: string) {
	const base = appToUrl(app, protocol)
	if (!base) return ''
	const launch = new URL(base)
	// An explicit external path is the primary launch destination. A bare origin
	// retains the application's manifest path, just like the local launch URL.
	const targetPath =
		path ??
		(!isOnionPage() && !isLocalPanelHost() && (launch.pathname !== '/' || launch.search || launch.hash)
			? ''
			: (app.path ?? ''))
	const url = targetPath ? new URL(targetPath, launch) : launch
	if (url.origin !== launch.origin) return `${launch.origin}/`
	return url.href
}

const ALWAYS_OPEN_HTTPS_REQUIRED_APPS_KEY = 'UMBREL_ALWAYS_OPEN_HTTPS_REQUIRED_APPS'

export function getAlwaysOpenHttpsRequiredApps() {
	return localStorage.getItem(ALWAYS_OPEN_HTTPS_REQUIRED_APPS_KEY) === 'true'
}

export function setAlwaysOpenHttpsRequiredApps(value: boolean) {
	if (value) {
		localStorage.setItem(ALWAYS_OPEN_HTTPS_REQUIRED_APPS_KEY, 'true')
	} else {
		localStorage.removeItem(ALWAYS_OPEN_HTTPS_REQUIRED_APPS_KEY)
	}
}

export function isOnionPage() {
	return location.hostname.toLowerCase().replace(/\.$/, '').endsWith('.onion')
}

export function preloadImage(url: string): Promise<void> {
	return new Promise((resolve) => {
		const img = new Image()
		const handleLoad = () => {
			img.removeEventListener('load', handleLoad)
			resolve()
		}
		img.addEventListener('load', handleLoad)
		img.src = url
	})
}

// ---

export function isWindows() {
	return /Win/i.test(navigator.userAgent)
}

export function isLinux() {
	return /Linux/i.test(navigator.userAgent)
}

export function isMac() {
	return /Mac/i.test(navigator.userAgent)
}

export function platform() {
	if (isWindows()) return 'windows'
	if (isLinux()) return 'linux'
	if (isMac()) return 'mac'
	return 'other'
}

// NOTE: in Chrome, this can be `true` when emulating a touch device
export const IS_ANDROID = /Android/i.test(navigator.userAgent)

export const IS_DEV = localStorage.getItem('debug') === 'true'

export function cmdOrCtrl() {
	return isMac() ? '⌘' : 'Ctrl+'
}
