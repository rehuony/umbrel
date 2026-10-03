// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {useCloudOAuth} from '@/features/files/hooks/use-cloud'

const mocks = vi.hoisted(() => ({
	begin: vi.fn(),
	complete: vi.fn(),
	cancel: vi.fn(async () => true),
	invalidateAccounts: vi.fn(),
	invalidateSyncs: vi.fn(),
	onComplete: vi.fn(),
	onFailure: vi.fn(),
}))

vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn()}}))
vi.mock('@/features/files/utils/error-messages', () => ({getFilesErrorMessage: (message: string) => message}))
vi.mock('@/trpc/trpc', () => {
	const mutation = (mutateAsync: ReturnType<typeof vi.fn>) => ({
		useMutation: () => ({mutateAsync, isPending: false}),
	})
	return {
		trpcReact: {
			useUtils: () => ({
				files: {
					cloud: {
						accounts: {invalidate: mocks.invalidateAccounts},
						syncs: {invalidate: mocks.invalidateSyncs},
					},
				},
			}),
			files: {
				cloud: {
					oauthBegin: mutation(mocks.begin),
					oauthComplete: mutation(mocks.complete),
					oauthCancel: mutation(mocks.cancel),
				},
			},
		},
	}
})
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container!: HTMLDivElement
let root: Root | undefined
let oauth!: ReturnType<typeof useCloudOAuth>
let consentTab!: {opener?: unknown; location: {href: string}; close: ReturnType<typeof vi.fn>}

function Harness() {
	oauth = useCloudOAuth({onComplete: mocks.onComplete, onFailure: mocks.onFailure})
	return (
		<output>
			{String(oauth.isWaiting)}:{String(oauth.isPopupBlocked)}:{oauth.authorizationUrl ?? ''}
		</output>
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.useFakeTimers()
	vi.setSystemTime(new Date('2099-01-01T00:00:00Z'))
	mocks.begin.mockResolvedValue({
		accountId: '11111111-1111-4111-8111-111111111111',
		sessionId: '22222222-2222-4222-8222-222222222222',
		authorizationUrl: 'https://provider.example/authorize',
		expiresInMs: 10 * 60 * 1000,
	})
	consentTab = {location: {href: ''}, close: vi.fn()}
	vi.spyOn(window, 'open').mockReturnValue(consentTab as unknown as Window)
	container = document.createElement('div')
	document.body.appendChild(container)
	const nextRoot = createRoot(container)
	root = nextRoot
	act(() => nextRoot.render(<Harness />))
})

afterEach(() => {
	if (root) act(() => root?.unmount())
	document.body.replaceChildren()
	root = undefined
	vi.restoreAllMocks()
	vi.useRealTimers()
})

describe('Cloud OAuth expiry', () => {
	it('uses the relative server TTL instead of either wall clock', async () => {
		await act(async () => oauth.begin({provider: 'onedrive'}))
		expect(container.textContent).toBe('true:false:https://provider.example/authorize')
		expect(consentTab.location.href).toBe('https://provider.example/authorize')

		// A wall-clock correction after receipt must not expire the local UX
		// early; only elapsed monotonic time counts.
		vi.setSystemTime(new Date('2000-01-01T00:00:00Z'))
		await act(async () => vi.advanceTimersByTime(10 * 60 * 1000 - 1))
		expect(mocks.onFailure).not.toHaveBeenCalled()
		expect(container.textContent).toBe('true:false:https://provider.example/authorize')

		await act(async () => vi.advanceTimersByTime(1))
		expect(mocks.onFailure).toHaveBeenCalledWith('expired')
		expect(mocks.cancel).toHaveBeenCalledWith({
			accountId: '11111111-1111-4111-8111-111111111111',
			sessionId: '22222222-2222-4222-8222-222222222222',
		})
		expect(container.textContent).toBe('false:false:')
	})

	it('retains the authorization URL when the initial popup is blocked', async () => {
		vi.mocked(window.open).mockReturnValue(null)

		await act(async () => oauth.begin({provider: 'onedrive'}))

		expect(window.open).toHaveBeenCalledTimes(1)
		expect(window.open).toHaveBeenCalledWith('', '_blank')
		expect(container.textContent).toBe('true:true:https://provider.example/authorize')
		expect(mocks.cancel).not.toHaveBeenCalled()
		expect(mocks.onFailure).not.toHaveBeenCalled()
	})

	it('cancels a retained blocked-popup session when the flow is abandoned', async () => {
		vi.mocked(window.open).mockReturnValue(null)
		await act(async () => oauth.begin({provider: 'onedrive'}))

		act(() => root?.unmount())
		root = undefined

		expect(mocks.cancel).toHaveBeenCalledWith({
			accountId: '11111111-1111-4111-8111-111111111111',
			sessionId: '22222222-2222-4222-8222-222222222222',
		})
	})

	it('shares one completion across synchronous duplicate submissions', async () => {
		let resolveCompletion!: (result: {
			account: {id: string}
			locations: {locations: never[]; truncated: boolean}
		}) => void
		mocks.complete.mockReturnValue(
			new Promise((resolve) => {
				resolveCompletion = resolve
			}),
		)
		await act(async () => oauth.begin({provider: 'onedrive'}))

		let first!: Promise<void>
		let duplicate!: Promise<void>
		act(() => {
			first = oauth.complete('copy-code')
			duplicate = oauth.complete('copy-code')
		})

		expect(first).toBe(duplicate)
		expect(mocks.complete).toHaveBeenCalledOnce()
		expect(oauth.isCompleting).toBe(true)

		resolveCompletion({
			account: {id: '11111111-1111-4111-8111-111111111111'},
			locations: {locations: [], truncated: false},
		})
		await act(() => first)

		expect(mocks.onComplete).toHaveBeenCalledOnce()
		expect(oauth.isCompleting).toBe(false)
	})
})

describe('Cloud OAuth lifecycle', () => {
	it.each(['open', 'detach'] as const)('allows retry when the browser fails to %s the consent tab', async (step) => {
		if (step === 'open')
			vi.mocked(window.open).mockImplementationOnce(() => {
				throw new Error('Popup unavailable')
			})
		else
			Object.defineProperty(consentTab, 'opener', {
				configurable: true,
				set() {
					throw new Error('Opener unavailable')
				},
			})
		await act(() => oauth.begin({provider: 'onedrive'}))
		expect(oauth.isStarting).toBe(false)
		expect(oauth.isWaiting).toBe(false)
		expect(mocks.begin).not.toHaveBeenCalled()
		if (step === 'detach') expect(consentTab.close).toHaveBeenCalledOnce()
		consentTab = {location: {href: ''}, close: vi.fn()}
		vi.mocked(window.open).mockReturnValue(consentTab as unknown as Window)
		await act(() => oauth.begin({provider: 'onedrive'}))
		expect(mocks.begin).toHaveBeenCalledOnce()
		expect(oauth.isWaiting).toBe(true)
		expect(consentTab.opener).toBeNull()
	})

	it('opens one detached consent tab for duplicate clicks', async () => {
		await act(async () => {
			await Promise.all([oauth.begin({provider: 'onedrive'}), oauth.begin({provider: 'onedrive'})])
		})
		expect(mocks.begin).toHaveBeenCalledOnce()
		expect(window.open).toHaveBeenCalledOnce()
		expect(consentTab.opener).toBeNull()
	})

	it.each(['cancel', 'unmount'] as const)('discards a begin result arriving after %s', async (action) => {
		let resolve!: (value: unknown) => void
		mocks.begin.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done
			}),
		)
		let opening!: Promise<void>
		act(() => {
			opening = oauth.begin({provider: 'onedrive'})
		})
		act(() => {
			if (action === 'cancel') oauth.cancel()
			else {
				root?.unmount()
				root = undefined
			}
		})
		resolve({
			accountId: 'account',
			sessionId: 'abandoned',
			authorizationUrl: 'https://provider.example/authorize',
			expiresInMs: 600_000,
		})
		await act(() => opening)
		expect(consentTab.location.href).toBe('')
		expect(consentTab.close).toHaveBeenCalled()
		expect(mocks.cancel).toHaveBeenCalledWith({accountId: 'account', sessionId: 'abandoned'})
		expect(mocks.onComplete).not.toHaveBeenCalled()
		if (action === 'cancel') expect(oauth.isWaiting).toBe(false)
	})

	it('keeps a new session when an earlier cancelled begin completes late', async () => {
		let resolve!: (value: unknown) => void
		mocks.begin.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done
			}),
		)
		let abandoned!: Promise<void>
		act(() => {
			abandoned = oauth.begin({provider: 'onedrive'})
		})
		const oldTab = consentTab
		act(() => oauth.cancel())
		consentTab = {location: {href: ''}, close: vi.fn()}
		vi.mocked(window.open).mockReturnValue(consentTab as unknown as Window)
		await act(() => oauth.begin({provider: 'dropbox'}))
		resolve({
			accountId: 'old-account',
			sessionId: 'old-session',
			authorizationUrl: 'https://old.example/authorize',
			expiresInMs: 600_000,
		})
		await act(() => abandoned)
		expect(oauth.authorizationUrl).toBe('https://provider.example/authorize')
		expect(consentTab.close).not.toHaveBeenCalled()
		expect(oldTab.close).toHaveBeenCalled()
		expect(mocks.cancel).toHaveBeenCalledWith({accountId: 'old-account', sessionId: 'old-session'})
	})

	it('ignores completion after cancellation and preserves a later session', async () => {
		let resolve!: (value: unknown) => void
		mocks.complete.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done
			}),
		)
		await act(() => oauth.begin({provider: 'onedrive'}))
		let completion!: Promise<void>
		act(() => {
			completion = oauth.complete('copied-result')
		})
		act(() => oauth.cancel())
		mocks.begin.mockResolvedValueOnce({
			accountId: 'new-account',
			sessionId: 'new-session',
			authorizationUrl: 'https://new.example/authorize',
			expiresInMs: 600_000,
		})
		await act(() => oauth.begin({provider: 'dropbox'}))
		resolve({account: {id: 'old-account'}, locations: {locations: [], truncated: false}})
		await act(() => completion)
		expect(mocks.onComplete).not.toHaveBeenCalled()
		expect(oauth.authorizationUrl).toBe('https://new.example/authorize')
		expect(oauth.isCompleting).toBe(false)
	})
})
