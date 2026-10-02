import fse from 'fs-extra'
import {z} from 'zod'
import {$} from 'execa'
import {writeFileDurably} from '../../utilities/durable-filesystem.js'
import {BuildInfo, readBuild, type Build, type Update} from './release.js'

export const directory = '/data/system-updates'
export const State = z.object({
	phase: z.enum([
		'queued',
		'downloading',
		'verifying',
		'installing',
		'rebooting',
		'checking',
		'succeeded',
		'failed',
		'rolled-back',
	]),
	operation: z.enum(['update', 'rollback']),
	from: BuildInfo,
	toVersion: z.string(),
	releaseId: z.number().int().positive().optional(),
	bundleSha256: z.string().optional(),
	fromGroup: z.string(),
	toGroup: z.string(),
	bootId: z.string(),
	progress: z.number().min(0).max(100),
	error: z.string().optional(),
})
export type UpdateState = z.infer<typeof State>
export const busyPhases = ['queued', 'downloading', 'verifying', 'installing', 'rebooting', 'checking']
export async function readState(): Promise<UpdateState | null> {
	try {
		return State.parse(await fse.readJson(`${directory}/status.json`))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
		throw error
	}
}
export async function saveState(state: UpdateState) {
	await fse.ensureDir(directory, {mode: 0o700})
	await writeFileDurably(
		`${directory}/status.json`,
		`${directory}/status.tmp`,
		JSON.stringify(State.parse(state)),
		0o600,
	)
}
export async function bootId() {
	return (await fse.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
}
export async function systemInfo(requirePersistentState = true) {
	const {stdout} = await $`rugix-ctrl system info`
	const info = z
		.object({
			boot: z.object({
				bootFlow: z.enum(['grub', 'rpi-tryboot']),
				activeGroup: z.string(),
				defaultGroup: z.string(),
				groups: z.record(z.unknown()),
			}),
			state: z.object({status: z.string()}),
		})
		.parse(JSON.parse(stdout))
	if (requirePersistentState && info.state.status !== 'Active')
		throw new Error('Persistent system storage is unavailable')
	const groups = Object.keys(info.boot.groups)
	if (groups.length !== 2 || !groups.includes(info.boot.activeGroup) || !groups.includes(info.boot.defaultGroup))
		throw new Error('Unsupported A/B system layout')
	return info
}
export async function assertIdle() {
	const state = await readState()
	if (state && busyPhases.includes(state.phase)) throw new Error('A system update is already in progress')
}
export async function queueUpdate(build: Build, update: Update | null) {
	await assertIdle()
	const info = await systemInfo()
	if (info.boot.activeGroup !== info.boot.defaultGroup)
		throw new Error('The current system has not passed its boot health check')
	let toVersion: string
	if (update) toVersion = update.version
	else {
		const previous = State.parse(await fse.readJson(`${directory}/previous.json`))
		if (
			previous.toVersion !== build.release.version ||
			previous.toGroup !== info.boot.activeGroup ||
			previous.phase !== 'succeeded'
		)
			throw new Error('No verified previous system is available')
		toVersion = previous.from.release.version
	}
	await saveState({
		phase: 'queued',
		operation: update ? 'update' : 'rollback',
		from: build,
		toVersion,
		releaseId: update?.releaseId,
		bundleSha256: update?.artifact.sha256,
		fromGroup: info.boot.activeGroup,
		toGroup: Object.keys(info.boot.groups).find((group) => group !== info.boot.activeGroup)!,
		bootId: await bootId(),
		progress: 0,
	})
	try {
		await $`systemctl start --no-block panel-update.service`
	} catch (error) {
		const state = (await readState())!
		await saveState({...state, phase: 'failed', error: String(error)})
		throw error
	}
}

export async function updateStatus() {
	const state = await readState()
	let rollbackAvailable = false
	try {
		const previous = State.parse(await fse.readJson(`${directory}/previous.json`))
		const build = await readBuild()
		const info = await systemInfo()
		rollbackAvailable =
			previous.phase === 'succeeded' &&
			previous.toVersion === build?.release.version &&
			previous.toGroup === info.boot.activeGroup &&
			info.boot.activeGroup === info.boot.defaultGroup &&
			!busyPhases.includes(state?.phase || '')
	} catch {
		/* An unavailable or unverified old slot is never offered for rollback. */
	}
	return {state, rollbackAvailable}
}
