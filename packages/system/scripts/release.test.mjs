import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {artifact, manifest} from './release.mjs'

test('release manifest binds all four target bundles to one version and rejects changed artifacts', async (t) => {
	const buildDirectory = await mkdtemp(path.join(os.tmpdir(), 'panel release '))
	t.after(() => rm(buildDirectory, {recursive: true, force: true}))
	const directory = path.join(buildDirectory, 'images')
	await mkdir(directory)
	for (const [target, name] of Object.entries({pi4: 'pi4', pi5: 'pi', arm64: 'arm64', amd64: 'amd64'})) {
		await writeFile(path.join(directory, `umbrelos-${name}.rugixb`), target)
		await artifact(directory, target, '1.0.0', `sha512-256:${'a'.repeat(64)}`)
	}
	// Exercise the public entry point with a custom output path containing spaces.
	await promisify(execFile)('make', ['release-manifest', 'VERSION=1.0.0', `SYSTEM_BUILD_DIR=${buildDirectory}`], {
		cwd: fileURLToPath(new URL('../../../', import.meta.url)),
	})
	const release = JSON.parse(await readFile(path.join(directory, 'system-release.json'), 'utf8'))
	assert.equal(release.repository, 'rehuony/umbrel')
	assert.equal(Object.keys(release.artifacts).length, 4)
	await assert.rejects(manifest(directory, '1.1.0'), /Mismatched/)
	await assert.rejects(manifest(directory, 'nightly'), /semantic version/)
	await writeFile(path.join(directory, 'umbrelos-pi4.rugixb'), 'corrupt')
	await assert.rejects(manifest(directory, '1.0.0'), /Corrupt/)
})
