import assert from 'node:assert/strict'
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
import {execFile} from 'node:child_process'
import {test} from 'node:test'

const exec = promisify(execFile)
const script = fileURLToPath(new URL('./build.sh', import.meta.url))

async function fixture(t) {
	const directory = await mkdtemp(path.join(tmpdir(), 'system-build-test-'))
	t.after(() => rm(directory, {recursive: true, force: true}))
	const bin = path.join(directory, 'bin')
	const build = path.join(directory, 'build output')
	const log = path.join(directory, 'docker.jsonl')
	await mkdir(bin)
	await writeFile(
		path.join(bin, 'docker'),
		`#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.DOCKER_TEST_LOG, JSON.stringify(args) + '\\n')
if (process.env.FAIL_ARCH && args.includes('linux/' + process.env.FAIL_ARCH)) process.exit(1)
if (args[0] === 'buildx') {
  const output = args[args.indexOf('--output') + 1].replace('type=tar,dest=', '')
  fs.mkdirSync(path.dirname(output), {recursive: true})
  fs.writeFileSync(output, 'root filesystem fixture')
}
if (args.includes('bake')) {
  const project = args.find(arg => arg.endsWith(':/project')).slice(0, -9)
  const system = args.at(-1)
  if (process.env.FAIL_SYSTEM === system) process.exit(1)
  const destination = path.join(project, 'build', system)
  fs.mkdirSync(destination, {recursive: true})
  fs.writeFileSync(path.join(destination, 'system.img'), system)
}
`,
		{mode: 0o755},
	)
	return {
		build,
		run: (args, env = {}) =>
			exec('bash', [script, '--version', 'test-release', ...args], {
				env: {
					...process.env,
					PATH: `${bin}:${process.env.PATH}`,
					SYSTEM_BUILD_DIR: build,
					DOCKER_TEST_LOG: log,
					GITHUB_ACTIONS: 'false',
					KEEP_BUILD_WORK: 'false',
					...env,
				},
			}),
		calls: async () =>
			(await readFile(log, 'utf8').catch(() => ''))
				.trim()
				.split('\n')
				.filter(Boolean)
				.map((line) => JSON.parse(line)),
	}
}

test('Pi targets share one root build and publish only their own verified artifacts', async (t) => {
	const context = await fixture(t)
	await mkdir(path.join(context.build, 'images'), {recursive: true})
	await writeFile(path.join(context.build, 'images/unrelated.img'), 'previous build')
	await context.run(['pi4', 'pi5', 'pi4'])
	const calls = await context.calls()
	assert.equal(calls.filter((args) => args[0] === 'buildx').length, 1)
	assert.equal(calls.filter((args) => args.includes('bake')).length, 2)
	assert.ok(!calls.some((args) => args.includes('linux/amd64') || args.includes('--install')))
	assert.deepEqual((await readdir(context.build)).sort(), ['images'])
	assert.deepEqual((await readdir(path.join(context.build, 'images'))).sort(), [
		'umbrelos-pi.img',
		'umbrelos-pi.img.sha256',
		'umbrelos-pi4.img',
		'umbrelos-pi4.img.sha256',
		'unrelated.img',
	])
	for (const name of ['umbrelos-pi4', 'umbrelos-pi']) {
		await exec('shasum', ['-a', '256', '-c', `${name}.img.sha256`], {cwd: path.join(context.build, 'images')})
	}
})

test('default build covers all four platforms', async (t) => {
	const context = await fixture(t)
	await context.run([])
	const calls = await context.calls()
	assert.equal(calls.filter((args) => args[0] === 'buildx').length, 3)
	assert.deepEqual(
		calls.filter((args) => args.includes('bake')).map((args) => args.at(-1)),
		['umbrelos-pi4', 'umbrelos-pi-tryboot', 'umbrelos-arm64', 'umbrelos-amd64'],
	)
})

test('invalid targets fail before Docker is invoked', async (t) => {
	const context = await fixture(t)
	await assert.rejects(context.run(['unknown']), /Unknown target/)
	assert.deepEqual(await context.calls(), [])
})

test('unsupported execution fails without changing host emulators or starting builds', async (t) => {
	const context = await fixture(t)
	await assert.rejects(context.run(['amd64'], {FAIL_ARCH: 'amd64'}), /cannot execute linux\/amd64/)
	const calls = await context.calls()
	assert.equal(calls.length, 1)
	assert.ok(!calls[0].includes('--privileged'))
})

test('a failed image build preserves the previous image and checksum and releases its lock', async (t) => {
	const context = await fixture(t)
	const images = path.join(context.build, 'images')
	await mkdir(images, {recursive: true})
	await writeFile(path.join(images, 'umbrelos-arm64.img'), 'known-good-image')
	await writeFile(path.join(images, 'umbrelos-arm64.img.sha256'), 'known-good-checksum')
	await assert.rejects(context.run(['arm64'], {FAIL_SYSTEM: 'umbrelos-arm64'}))
	assert.equal(await readFile(path.join(images, 'umbrelos-arm64.img'), 'utf8'), 'known-good-image')
	assert.equal(await readFile(path.join(images, 'umbrelos-arm64.img.sha256'), 'utf8'), 'known-good-checksum')
	assert.deepEqual(await readdir(context.build), ['images'])
})

test('concurrent builds cannot share an output directory', async (t) => {
	const context = await fixture(t)
	await mkdir(path.join(context.build, '.build-lock'), {recursive: true})
	await assert.rejects(context.run(['arm64']), /Another image build/)
	assert.ok(!(await context.calls()).some((args) => args[0] === 'buildx'))
	assert.ok((await readdir(context.build)).includes('.build-lock'))
})
