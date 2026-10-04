import assert from 'node:assert/strict'
import {mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
import {execFile} from 'node:child_process'
import {test} from 'node:test'

const exec = promisify(execFile)
const script = fileURLToPath(new URL('./build.sh', import.meta.url))
const remoteScript = fileURLToPath(new URL('../../../scripts/remote-builder.sh', import.meta.url))

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
const {execFileSync} = require('node:child_process')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.DOCKER_TEST_LOG, JSON.stringify(args) + '\\n')
if (process.env.FAIL_ARCH && args.includes('linux/' + process.env.FAIL_ARCH)) process.exit(1)
if (args[0] === 'buildx') {
  const output = args[args.indexOf('--output') + 1].replace('type=tar,dest=', '')
  fs.mkdirSync(path.dirname(output), {recursive: true})
  fs.writeFileSync(output, 'root filesystem fixture')
}
if (args.includes('bundler')) console.log('sha512-256:' + 'a'.repeat(64))
if (args.includes('bake')) {
  const project = args.find(arg => arg.endsWith(':/project')).slice(0, -9)
  const system = args.at(-1)
  if (process.env.FAIL_SYSTEM === system) process.exit(1)
  const destination = path.join(project, 'build', system)
  fs.mkdirSync(destination, {recursive: true})
  fs.writeFileSync(path.join(destination, 'system.img'), system, {mode: 0o600})
  fs.writeFileSync(path.join(destination, 'system.rugixb'), system + '-bundle', {mode: 0o600})
  if (process.env.ROOT_OWNED_ARTIFACTS === 'true') {
    execFileSync('sudo', ['-n', 'chown', 'root:root', destination,
      path.join(destination, 'system.img'), path.join(destination, 'system.rugixb')])
  }
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
		'umbrelos-pi.rugixb',
		'umbrelos-pi.rugixb.sha256',
		'umbrelos-pi.update.json',
		'umbrelos-pi4.img',
		'umbrelos-pi4.img.sha256',
		'umbrelos-pi4.rugixb',
		'umbrelos-pi4.rugixb.sha256',
		'umbrelos-pi4.update.json',
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

test('CI exports root-owned artifacts for checksumming and compression by the runner', async (t) => {
	if (process.platform !== 'linux' || process.getuid() === 0) {
		assert.notEqual(process.env.GITHUB_ACTIONS, 'true', 'CI must test permissions as an unprivileged Linux user')
		t.skip('Requires an unprivileged Linux user')
		return
	}
	try {
		await exec('sudo', ['-n', 'true'])
	} catch (error) {
		if (process.env.GITHUB_ACTIONS === 'true') throw error
		t.skip('Requires passwordless sudo, as on GitHub-hosted runners')
		return
	}
	const context = await fixture(t)
	await context.run([], {GITHUB_ACTIONS: 'true', ROOT_OWNED_ARTIFACTS: 'true'})
	const images = path.join(context.build, 'images')
	for (const name of ['umbrelos-pi4', 'umbrelos-pi', 'umbrelos-arm64', 'umbrelos-amd64']) {
		for (const extension of ['img', 'rugixb']) {
			const file = `${name}.${extension}`
			const info = await stat(path.join(images, file))
			assert.equal(info.uid, process.getuid())
			assert.equal(info.gid, process.getgid())
			await exec('shasum', ['-a', '256', '-c', `${file}.sha256`], {cwd: images})
		}
		await exec('xz', ['--keep', `${name}.img`], {cwd: images})
		const unpacked = await exec('xz', ['--decompress', '--stdout', `${name}.img.xz`], {cwd: images})
		assert.equal(unpacked.stdout, await readFile(path.join(images, `${name}.img`), 'utf8'))
	}
	assert.deepEqual(await readdir(context.build), ['images'])
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

async function remoteFixture(t) {
	const directory = await mkdtemp(path.join(tmpdir(), 'panel-remote-builder-'))
	t.after(() => rm(directory, {recursive: true, force: true}))
	const bin = path.join(directory, 'bin')
	await mkdir(bin)
	const log = path.join(directory, 'calls.jsonl')
	const env = {...process.env, PATH: `${bin}:${process.env.PATH}`, PANEL_CALL_LOG: log}
	const capture = `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.PANEL_CALL_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')\n`
	return {directory, bin, log, env, capture}
}

test('remote test arguments survive SSH shell parsing without expansion', async (t) => {
	const {bin, log, env, capture} = await remoteFixture(t)
	await writeFile(path.join(bin, 'ssh'), capture, {mode: 0o755})
	await writeFile(path.join(bin, 'rsync'), '#!/bin/sh\nexit 0\n', {mode: 0o755})
	const args = ['unit.test', '-t', "owner's file has spaces", 'literal; $HOME $(id) `id`', '']
	await exec('bash', [remoteScript, 'test', 'test-builder', ...args], {env})
	const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse)
	const command = calls.at(-1).at(-1)
	const suffix = command.slice(command.indexOf("'", command.indexOf('--test-on-host')))
	const parsed = await exec('bash', ['-c', `set -- ${suffix}; shift; printf '%s\\0' "$@"`])
	assert.deepEqual(parsed.stdout.split('\0').slice(0, -1), args)
})

test('the remote runner invokes pnpm and preserves test arguments', async (t) => {
	const {directory, bin, log, env, capture} = await remoteFixture(t)
	await mkdir(path.join(directory, 'checkout'), {recursive: true})
	await writeFile(path.join(bin, 'pnpm'), capture, {mode: 0o755})
	await writeFile(
		path.join(bin, 'getent'),
		'#!/bin/sh\nprintf "tester:x:1000:1000::%s:/bin/bash\\n" "$PANEL_TEST_HOME"\n',
		{mode: 0o755},
	)
	const args = ['unit.test', '-t', "owner's file has spaces"]
	const options = {env: {...env, SUDO_USER: 'tester', PANEL_TEST_HOME: directory}}
	await exec('bash', [remoteScript, '--test-on-host', 'checkout', ...args], options)
	await exec('bash', [remoteScript, '--test-on-host', 'checkout'], options)
	const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse)
	assert.deepEqual(calls, [
		['--filter', 'backend', 'run', 'test', ...args],
		['--filter', 'backend', 'run', 'test:vm'],
	])
})
