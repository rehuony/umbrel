import {createHash} from 'node:crypto'
import {open, statfs} from 'node:fs/promises'
import {setTimeout} from 'node:timers/promises'
import fse from 'fs-extra'
import {$} from 'execa'

import {getRelease, isNewer, readBuild} from './release.js'
import {bootId, directory, readState, saveState, systemInfo, type UpdateState} from './state.js'
import {removeDurably, writeFileDurably} from '../../utilities/durable-filesystem.js'

async function download(state: UpdateState) {
	const update = await getRelease(state.from, state.releaseId)
	if (
		!update ||
		!isNewer(state.from, update) ||
		update.version !== state.toVersion ||
		update.artifact.sha256 !== state.bundleSha256
	)
		throw new Error('The selected release changed; check for updates again')
	const space = await statfs(directory)
	if (space.bavail * space.bsize < update.artifact.size + 512 * 1024 ** 2)
		throw new Error('Not enough free space to download the update')
	const response = await fetch(update.assetUrl, {signal: AbortSignal.timeout(60 * 60_000)})
	if (!response.ok || !response.body) throw new Error(`Bundle download failed: HTTP ${response.status}`)
	const handle = await open(`${directory}/bundle.part`, 'w', 0o600)
	const hash = createHash('sha256')
	let size = 0
	let lastProgress = -1
	try {
		for await (const chunk of response.body) {
			size += chunk.length
			if (size > update.artifact.size) throw new Error('Bundle exceeds its declared size')
			hash.update(chunk)
			await handle.writeFile(chunk)
			const progress = Math.floor((size / update.artifact.size) * 80)
			if (progress !== lastProgress) {
				await saveState({...state, phase: 'downloading', progress})
				lastProgress = progress
			}
		}
		await handle.sync()
	} finally {
		await handle.close()
	}
	await saveState({...state, phase: 'verifying', progress: 80})
	if (size !== update.artifact.size || hash.digest('hex') !== update.artifact.sha256)
		throw new Error('Bundle checksum or size mismatch')
	return update
}

export async function install() {
	let state = await readState()
	if (!state || state.phase !== 'queued') throw new Error('No queued system update')
	try {
		const build = await readBuild()
		const info = await systemInfo()
		if (
			!build ||
			build.release.id !== state.from.release.id ||
			state.bootId !== (await bootId()) ||
			info.boot.activeGroup !== state.fromGroup ||
			info.boot.defaultGroup !== state.fromGroup
		)
			throw new Error('System state changed before the update started')
		if (state.operation === 'update') {
			const update = await download(state)
			// The inactive slot is about to be overwritten. It can no longer be
			// offered as the previous verified release, even if installation fails.
			await removeDurably(`${directory}/previous.json`)
			await saveState({...state, phase: 'installing', progress: 85})
			await $({
				stdio: 'inherit',
			})`rugix-ctrl update install --reboot no --bundle-hash ${update.artifact.bundleHash} ${directory}/bundle.part`
		}
		state = {...state, phase: 'rebooting', progress: 95}
		await saveState(state)
		await removeDurably(`${directory}/bundle.part`)
		// Rugix selects a trial boot; systemd performs the normal service shutdown.
		await $`rugix-ctrl system reboot --spare`
	} catch (error) {
		await saveState({...state, phase: 'failed', error: error instanceof Error ? error.message : String(error)})
		await removeDurably(`${directory}/bundle.part`)
		throw error
	}
}

async function healthy(version: string) {
	try {
		await systemInfo() // Reject in-memory recovery after a data mount failure.
		await $`docker info --format {{.ServerVersion}}`
		const response = await fetch('http://127.0.0.1:22080/trpc/system.ready', {signal: AbortSignal.timeout(3000)})
		const result = (await response.json()) as {result?: {data?: {ready: boolean; version: string}}}
		if (!response.ok || result.result?.data?.ready !== true || result.result.data.version !== version) return false
		const page = await fetch('http://127.0.0.1/login', {signal: AbortSignal.timeout(3000), redirect: 'manual'})
		if (![200, 301, 302, 307, 308].includes(page.status)) return false
		await writeFileDurably(`${directory}/health`, `${directory}/health.tmp`, version, 0o600)
		return true
	} catch {
		return false
	}
}

export async function checkBoot() {
	const build = await readBuild()
	if (!build) return
	const info = await systemInfo(false)
	await fse.ensureDir(directory, {mode: 0o700})
	const state = await readState()
	const changedBoot = state !== null && state.bootId !== (await bootId())
	const pending =
		changedBoot && ['queued', 'downloading', 'verifying', 'installing', 'rebooting', 'checking'].includes(state.phase)
	const trial = info.boot.activeGroup !== info.boot.defaultGroup

	if (pending && info.boot.activeGroup === state.fromGroup) {
		await saveState({
			...state,
			phase: ['rebooting', 'checking'].includes(state.phase) ? 'rolled-back' : 'failed',
			error: 'The update was interrupted or the trial system returned to the previous slot',
		})
		await removeDurably(`${directory}/bundle.part`)
	}
	if (pending && trial && (info.boot.activeGroup !== state.toGroup || build.release.version !== state.toVersion)) {
		await saveState({...state, phase: 'checking', error: 'The trial system does not match the selected release'})
		await $`reboot`
		return
	}
	if (pending && trial) await saveState({...state, phase: 'checking', progress: 98})
	// Require sustained core readiness, not just an open TCP port. Third-party
	// app health is deliberately not a reason to roll back the whole OS.
	let consecutive = 0
	const deadline = Date.now() + 5 * 60_000
	while (Date.now() < deadline) {
		consecutive = (await healthy(build.release.version)) ? consecutive + 1 : 0
		if (consecutive >= 3) {
			await $`rugix-ctrl system commit`
			if (pending && info.boot.activeGroup === state.toGroup && build.release.version === state.toVersion) {
				const done: UpdateState = {...state, phase: 'succeeded', progress: 100, error: undefined}
				await writeFileDurably(`${directory}/previous.json`, `${directory}/previous.tmp`, JSON.stringify(done), 0o600)
				await saveState(done)
			}
			return
		}
		await setTimeout(5000)
	}
	if (trial) {
		if (pending)
			await saveState({...state, phase: 'checking', error: 'The new system did not pass its startup health check'})
		await $`reboot` // Uncommitted trial returns to the known-good boot group.
	} else throw new Error('System health check failed; the current default slot was left unchanged')
}
