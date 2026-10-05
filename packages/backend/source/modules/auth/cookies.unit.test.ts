import {describe, expect, test, vi} from 'vitest'
import type express from 'express'
import {
	BROWSER_SESSION_HTTP_COOKIE_NAME,
	BROWSER_SESSION_HTTPS_COOKIE_NAME,
	browserSessionTokenFromRequest,
	clearBrowserSessionCookies,
	setBrowserSessionCookie,
	stripBrowserSessionCookies,
} from './browser-session-cookie.js'

const request = (secure: boolean, cookies: Record<string, string> = {}) => ({secure, cookies}) as express.Request
const response = () => ({cookie: vi.fn(), clearCookie: vi.fn()}) as unknown as express.Response

describe('panel session cookies', () => {
	test.each([
		{secure: false, name: BROWSER_SESSION_HTTP_COOKIE_NAME},
		{secure: true, name: BROWSER_SESSION_HTTPS_COOKIE_NAME},
	])('sets the host-only cookie for the current transport', ({secure, name}) => {
		const expires = new Date('2026-01-08T00:00:00Z')
		const result = response()
		setBrowserSessionCookie(result, request(secure), 'browser-token', expires)
		expect(result.cookie).toHaveBeenCalledExactlyOnceWith(name, 'browser-token', {
			httpOnly: true,
			expires,
			path: '/',
			sameSite: 'lax',
			secure,
		})
	})
	test('selects only the cookie for the current HTTP or HTTPS context', () => {
		const cookies = {[BROWSER_SESSION_HTTP_COOKIE_NAME]: 'http', [BROWSER_SESSION_HTTPS_COOKIE_NAME]: 'https'}
		expect(browserSessionTokenFromRequest(request(false, cookies))).toBe('http')
		expect(browserSessionTokenFromRequest(request(true, cookies))).toBe('https')
	})
	test('strips panel cookies from upstream headers and preserves application cookies', () => {
		const header = `app-cookie=keep;\t${BROWSER_SESSION_HTTP_COOKIE_NAME} = http; ${BROWSER_SESSION_HTTPS_COOKIE_NAME}=https; UMBREL_BROWSER_SESSION_EXTRA=keep-too`
		expect(stripBrowserSessionCookies(header)).toBe('app-cookie=keep; UMBREL_BROWSER_SESSION_EXTRA=keep-too')
		expect(stripBrowserSessionCookies()).toBe('')
	})
	test('clears both transport variants on logout', () => {
		const result = response()
		clearBrowserSessionCookies(result)
		expect(result.clearCookie).toHaveBeenCalledTimes(2)
		expect(result.clearCookie).toHaveBeenCalledWith(BROWSER_SESSION_HTTPS_COOKIE_NAME, {path: '/', secure: true})
		expect(result.clearCookie).toHaveBeenCalledWith(BROWSER_SESSION_HTTP_COOKIE_NAME, {path: '/'})
	})
})
