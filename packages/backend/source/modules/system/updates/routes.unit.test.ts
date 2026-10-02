import {beforeEach, expect, test, vi} from 'vitest'
import type {Context} from '../../server/trpc/context.js'
import routes from '../routes.js'
import {checkUpdate, readBuild, type Build} from './release.js'
import {assertIdle, queueUpdate, updateStatus} from './state.js'

vi.mock('./release.js', () => ({checkUpdate: vi.fn(), readBuild: vi.fn()}))
vi.mock('./state.js', () => ({assertIdle: vi.fn(), queueUpdate: vi.fn(), updateStatus: vi.fn()}))
const build: Build = {name: 'umbrelos-arm64', release: {id: 'old', version: '1.0.0'}}
function caller(accountId?: string) {
	return routes.createCaller({
		transport: 'ws',
		principal: accountId ? {sessionId: 'test-session', accountId, actor: 'account'} : undefined,
		umbreld: {auth: {validatePrincipal: vi.fn(async () => {})}},
		user: {exists: vi.fn(async () => true)},
		logger: {verbose: vi.fn(), error: vi.fn()},
	} as unknown as Context)
}
beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(readBuild).mockResolvedValue(build)
	vi.mocked(updateStatus).mockResolvedValue({state: null, rollbackAvailable: false})
})
test.each([undefined, 'member'])('rejects system update operations for %s', async (account) => {
	const client = caller(account)
	await expect(client.checkUpdate()).rejects.toMatchObject({code: account ? 'FORBIDDEN' : 'UNAUTHORIZED'})
	await expect(client.updateStatus()).rejects.toMatchObject({code: account ? 'FORBIDDEN' : 'UNAUTHORIZED'})
	await expect(client.update({version: '1.1.0'})).rejects.toMatchObject({code: account ? 'FORBIDDEN' : 'UNAUTHORIZED'})
	await expect(client.rollback()).rejects.toMatchObject({code: account ? 'FORBIDDEN' : 'UNAUTHORIZED'})
	expect(checkUpdate).not.toHaveBeenCalled()
	expect(queueUpdate).not.toHaveBeenCalled()
})
test('owner cannot install a version that changed since review', async () => {
	vi.mocked(checkUpdate).mockResolvedValue({
		current: build,
		supported: true,
		repository: 'rehuony/umbrel',
		releasesUrl: '',
		available: false,
		release: null,
	})
	await expect(caller('0').update({version: '1.1.0'})).rejects.toThrow('no longer available')
	expect(queueUpdate).not.toHaveBeenCalled()
})
test('owner can request the previous verified system through the common queue', async () => {
	await expect(caller('0').rollback()).resolves.toBe(true)
	expect(queueUpdate).toHaveBeenCalledWith(build, null)
})
test('system power actions reject while an update owns the system', async () => {
	vi.mocked(assertIdle).mockRejectedValueOnce(new Error('A system update is already in progress'))
	await expect(caller('0').restart()).rejects.toThrow('already in progress')
})
