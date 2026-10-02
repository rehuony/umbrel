import {createHash} from 'node:crypto'
import {beforeEach, afterEach, expect, test, vi} from 'vitest'
import {checkBoot, install} from './worker.js'
import {getRelease, readBuild, type Build} from './release.js'
import {saveState, systemInfo, type UpdateState} from './state.js'
import {removeDurably, writeFileDurably} from '../../utilities/durable-filesystem.js'

const context = vi.hoisted(() => ({
	state: null as UpdateState | null,
	boot: 'boot-old',
	clock: 0,
	commands: [] as string[],
	commandError: '',
	free: 4 * 1024 ** 3,
}))
vi.mock('node:fs/promises', () => ({
	open: vi.fn(async () => ({writeFile: vi.fn(), sync: vi.fn(), close: vi.fn()})),
	statfs: vi.fn(async () => ({bavail: context.free, bsize: 1})),
}))
vi.mock('fs-extra', () => ({default: {ensureDir: vi.fn()}}))
vi.mock('node:timers/promises', () => ({
	setTimeout: async () => {
		context.clock += 5000
	},
}))
vi.mock('execa', () => {
	const command = async (strings: TemplateStringsArray, ...values: unknown[]) => {
		const text = strings.reduce((result, part, i) => result + part + (values[i] ?? ''), '')
		context.commands.push(text)
		if (context.commandError && text.includes(context.commandError)) throw new Error('Command failed')
		return {stdout: ''}
	}
	return {
		$: (...args: unknown[]) =>
			Array.isArray(args[0]) ? command(args[0] as unknown as TemplateStringsArray, ...args.slice(1)) : command,
	}
})
vi.mock('./release.js', () => ({getRelease: vi.fn(), readBuild: vi.fn(), isNewer: () => true}))
vi.mock('./state.js', () => ({
	directory: '/test-update-state',
	readState: async () => context.state,
	saveState: vi.fn(async (state: UpdateState) => {
		context.state = state
	}),
	bootId: async () => context.boot,
	systemInfo: vi.fn(),
}))
vi.mock('../../utilities/durable-filesystem.js', () => ({removeDurably: vi.fn(), writeFileDurably: vi.fn()}))
const build: Build = {name: 'umbrelos-arm64', release: {id: 'old', version: '1.0.0'}}
const bytes = Buffer.from('a real streamed bundle fixture')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const info = (active = 'a', defaultGroup = 'a') => ({
	boot: {bootFlow: 'grub' as const, activeGroup: active, defaultGroup, groups: {a: {}, b: {}}},
	state: {status: 'Active'},
})
beforeEach(() => {
	vi.clearAllMocks()
	context.clock = 0
	context.boot = 'boot-old'
	context.commands = []
	context.commandError = ''
	context.free = 4 * 1024 ** 3
	context.state = {
		phase: 'queued',
		operation: 'update',
		from: build,
		toVersion: '1.1.0',
		releaseId: 1,
		bundleSha256: sha256,
		fromGroup: 'a',
		toGroup: 'b',
		bootId: context.boot,
		progress: 0,
	}
	vi.mocked(readBuild).mockResolvedValue(build)
	vi.mocked(systemInfo).mockResolvedValue(info())
	vi.mocked(getRelease).mockResolvedValue({
		releaseId: 1,
		version: '1.1.0',
		tag: 'v1.1.0',
		name: 'New system',
		notes: '',
		url: '',
		assetUrl: 'https://github.com/rehuony/umbrel/releases/download/v1.1.0/umbrelos-arm64.rugixb',
		artifact: {file: 'umbrelos-arm64.rugixb', size: bytes.length, sha256, bundleHash: `sha512-256:${'b'.repeat(64)}`},
	})
	vi.spyOn(Date, 'now').mockImplementation(() => context.clock)
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(bytes)),
	)
})
afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})
test('verifies the complete download and requires Rugix header verification before trial reboot', async () => {
	await install()
	expect(context.commands).toEqual([
		expect.stringContaining('update install --reboot no --bundle-hash sha512-256:'),
		'rugix-ctrl system reboot --spare',
	])
	expect(context.commands.join(' ')).not.toContain('insecure')
	expect(removeDurably).toHaveBeenCalledWith('/test-update-state/previous.json')
	expect(context.state?.phase).toBe('rebooting')
})
test('corrupt download never touches a system slot or its previous-release record', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(Buffer.alloc(bytes.length))),
	)
	await expect(install()).rejects.toThrow('checksum')
	expect(context.commands).toEqual([])
	expect(removeDurably).not.toHaveBeenCalledWith('/test-update-state/previous.json')
	expect(context.state?.phase).toBe('failed')
})
test('insufficient disk space fails before download and slot writes', async () => {
	context.free = 0
	await expect(install()).rejects.toThrow('free space')
	expect(fetch).not.toHaveBeenCalled()
	expect(context.commands).toEqual([])
})
test('a failed Rugix install is not reported as success and does not reboot', async () => {
	context.commandError = 'update install'
	await expect(install()).rejects.toThrow('Command failed')
	expect(context.state?.phase).toBe('failed')
	expect(context.commands).toHaveLength(1)
})
test('rejects a job created on another boot before mutation', async () => {
	context.boot = 'unrelated-boot'
	await expect(install()).rejects.toThrow('System state changed')
	expect(fetch).not.toHaveBeenCalled()
	expect(context.commands).toEqual([])
})
function candidate(ready = true) {
	context.state!.phase = 'rebooting'
	context.boot = 'boot-new'
	vi.mocked(readBuild).mockResolvedValue({...build, release: {id: 'new', version: '1.1.0'}})
	vi.mocked(systemInfo).mockResolvedValue(info('b'))
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) =>
			url.includes('/trpc/') ? Response.json({result: {data: {ready, version: '1.1.0'}}}) : new Response('dashboard'),
		),
	)
}
test('commits only after sustained core health, then records the previous verified release', async () => {
	candidate()
	await checkBoot()
	expect(context.clock).toBe(10_000)
	expect(context.commands.at(-1)).toBe('rugix-ctrl system commit')
	expect(context.state?.phase).toBe('succeeded')
	expect(writeFileDurably).toHaveBeenCalledWith(
		'/test-update-state/previous.json',
		expect.any(String),
		expect.stringContaining('"phase":"succeeded"'),
		0o600,
	)
})
test('unhealthy trial reboots without committing and is marked rolled back on the old slot', async () => {
	candidate(false)
	await checkBoot()
	expect(context.commands).not.toContain('rugix-ctrl system commit')
	expect(context.commands.at(-1)).toBe('reboot')
	expect(context.state?.phase).toBe('checking')
	context.boot = 'boot-returned'
	vi.mocked(readBuild).mockResolvedValue(build)
	vi.mocked(systemInfo).mockResolvedValue(info())
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) =>
			url.includes('/trpc/')
				? Response.json({result: {data: {ready: true, version: '1.0.0'}}})
				: new Response('dashboard'),
		),
	)
	await checkBoot()
	expect(context.state?.phase).toBe('rolled-back')
})
test('does not commit or boot-loop a broken default system', async () => {
	context.state = null
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => {
			throw new Error('not ready')
		}),
	)
	await expect(checkBoot()).rejects.toThrow('health check failed')
	expect(context.commands).not.toContain('reboot')
	expect(context.commands).not.toContain('rugix-ctrl system commit')
})
test('a mismatched trial version returns to the previous system without commit', async () => {
	candidate()
	context.state!.toVersion = '9.0.0'
	await checkBoot()
	expect(context.commands).toEqual(['reboot'])
})
test('marks an interrupted download as failed after reboot, preserving user data', async () => {
	context.state!.phase = 'downloading'
	context.boot = 'boot-interrupted'
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) =>
			url.includes('/trpc/')
				? Response.json({result: {data: {ready: true, version: '1.0.0'}}})
				: new Response('dashboard'),
		),
	)
	await checkBoot()
	expect(context.state?.phase).toBe('failed')
	expect(removeDurably).toHaveBeenCalledTimes(1)
	expect(removeDurably).toHaveBeenCalledWith('/test-update-state/bundle.part')
})
