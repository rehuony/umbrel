import {beforeEach, expect, test, vi} from 'vitest'
import fse from 'fs-extra'
import {assertIdle, directory, queueUpdate, State, systemInfo, updateStatus, type UpdateState} from './state.js'
import {readBuild, type Build, type Update} from './release.js'

const context = vi.hoisted(() => ({
	files: new Map<string, unknown>(),
	commands: [] as string[],
	active: 'a',
	defaultGroup: 'a',
	persistent: 'Active',
	serviceFailure: false,
}))
vi.mock('fs-extra', () => ({
	default: {
		ensureDir: vi.fn(),
		readFile: vi.fn(async () => 'boot-id'),
		readJson: vi.fn(async (file: string) => {
			if (!context.files.has(file)) throw Object.assign(new Error('Missing'), {code: 'ENOENT'})
			return context.files.get(file)
		}),
	},
}))
vi.mock('../../utilities/durable-filesystem.js', () => ({
	writeFileDurably: vi.fn(async (file: string, _temporary: string, content: string) => {
		context.files.set(file, JSON.parse(content))
	}),
}))
vi.mock('./release.js', async (original) => ({
	...(await original<typeof import('./release.js')>()),
	readBuild: vi.fn(),
}))
vi.mock('execa', () => ({
	$: async (strings: TemplateStringsArray, ...values: unknown[]) => {
		const command = strings.reduce((result, part, index) => result + part + (values[index] ?? ''), '')
		context.commands.push(command)
		if (context.serviceFailure && command.startsWith('systemctl')) throw new Error('Cannot start worker')
		return {
			stdout: JSON.stringify({
				boot: {
					bootFlow: 'grub',
					activeGroup: context.active,
					defaultGroup: context.defaultGroup,
					groups: {a: {}, b: {}},
				},
				state: {status: context.persistent},
			}),
		}
	},
}))
const build: Build = {name: 'umbrelos-arm64', release: {id: 'old', version: '1.0.0'}}
const update: Update = {
	releaseId: 1,
	version: '1.1.0',
	tag: 'v1.1.0',
	name: '',
	notes: '',
	url: '',
	assetUrl: '',
	artifact: {
		file: 'umbrelos-arm64.rugixb',
		size: 1,
		sha256: 'a'.repeat(64),
		bundleHash: `sha512-256:${'b'.repeat(64)}`,
	},
}
const status = () => State.parse(context.files.get(`${directory}/status.json`))
beforeEach(() => {
	vi.clearAllMocks()
	context.files.clear()
	context.commands = []
	context.active = 'a'
	context.defaultGroup = 'a'
	context.persistent = 'Active'
	context.serviceFailure = false
	vi.mocked(readBuild).mockResolvedValue(build)
})
test('durably queues a selected release and refuses a duplicate operation', async () => {
	await queueUpdate(build, update)
	expect(status()).toMatchObject({
		phase: 'queued',
		fromGroup: 'a',
		toGroup: 'b',
		toVersion: '1.1.0',
		bundleSha256: update.artifact.sha256,
	})
	await expect(queueUpdate(build, update)).rejects.toThrow('already in progress')
	expect(context.commands.filter((command) => command.startsWith('systemctl'))).toHaveLength(1)
})
test('refuses installation on a trial or unavailable persistent state', async () => {
	context.active = 'b'
	await expect(queueUpdate(build, update)).rejects.toThrow('health check')
	context.active = 'a'
	context.persistent = 'Disabled'
	await expect(systemInfo()).rejects.toThrow('storage is unavailable')
	expect(context.files.size).toBe(0)
})
test('records failure if the independent worker cannot start', async () => {
	context.serviceFailure = true
	await expect(queueUpdate(build, update)).rejects.toThrow('Cannot start worker')
	expect(status().phase).toBe('failed')
	await expect(assertIdle()).resolves.toBeUndefined()
})
test('only offers the previous verified group of this exact current version', async () => {
	const previous: UpdateState = {
		phase: 'succeeded',
		operation: 'update',
		from: {...build, release: {id: 'older', version: '0.9.0'}},
		toVersion: '1.0.0',
		fromGroup: 'b',
		toGroup: 'a',
		bootId: 'old-boot',
		progress: 100,
	}
	context.files.set(`${directory}/previous.json`, previous)
	expect((await updateStatus()).rollbackAvailable).toBe(true)
	await queueUpdate(build, null)
	expect(status()).toMatchObject({operation: 'rollback', toVersion: '0.9.0', toGroup: 'b'})
	expect((await updateStatus()).rollbackAvailable).toBe(false)
	context.files.delete(`${directory}/status.json`)
	context.files.set(`${directory}/previous.json`, {...previous, toVersion: 'unrelated'})
	expect((await updateStatus()).rollbackAvailable).toBe(false)
	await expect(queueUpdate(build, null)).rejects.toThrow('No verified previous system')
})
test('corrupt status is not overwritten or treated as idle', async () => {
	context.files.set(`${directory}/status.json`, {phase: 'unknown'})
	await expect(queueUpdate(build, update)).rejects.toThrow()
	expect(context.files.get(`${directory}/status.json`)).toEqual({phase: 'unknown'})
	expect(context.commands).toEqual([])
	expect(fse.ensureDir).not.toHaveBeenCalled()
})
