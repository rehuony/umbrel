import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, writeFile, rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {artifact, manifest} from './release.mjs'

test('release manifest binds all four target bundles to one version and rejects changed artifacts', async (t) => {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'panel-release-'))
	t.after(() => rm(directory, {recursive: true, force: true}))
	for (const [target, name] of Object.entries({pi4: 'pi4', pi5: 'pi', arm64: 'arm64', amd64: 'amd64'})) {
		await writeFile(path.join(directory, `umbrelos-${name}.rugixb`), target)
		await artifact(directory, target, '1.0.0', `sha512-256:${'a'.repeat(64)}`)
	}
	const release = await manifest(directory, '1.0.0')
	assert.equal(release.repository, 'rehuony/umbrel')
	assert.equal(Object.keys(release.artifacts).length, 4)
	await assert.rejects(manifest(directory, '1.1.0'), /Mismatched/)
	await assert.rejects(manifest(directory, 'nightly'), /semantic version/)
	await writeFile(path.join(directory, 'umbrelos-pi4.rugixb'), 'corrupt')
	await assert.rejects(manifest(directory, '1.0.0'), /Corrupt/)
})
