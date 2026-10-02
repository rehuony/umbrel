import {createHash} from 'node:crypto'
import fse from 'fs-extra'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {checkUpdate, getRelease, isNewer, readBuild, repository, type Build} from './release.js'

vi.mock('fs-extra')
const build: Build = {name: 'umbrelos-pi4', release: {id: 'pi4@1.0.0', version: '1.0.0'}}
const hash = 'a'.repeat(64)
const artifact = {file: 'umbrelos-pi4.rugixb', size: 12, sha256: hash, bundleHash: `sha512-256:${hash}`}
function fixture({version = '1.1.0', artifacts = {pi4: artifact}, dataVersion = 1} = {}) {
	const manifest = JSON.stringify({format: 1, repository, version, protocol: 1, dataVersion, artifacts})
	const url = `https://github.com/${repository}/releases/download/v${version}`
	const release = {
		id: 1,
		tag_name: `v${version}`,
		name: 'System release',
		body: 'Release notes',
		draft: false,
		prerelease: false,
		assets: [
			{
				name: 'system-release.json',
				size: manifest.length,
				state: 'uploaded',
				browser_download_url: `${url}/system-release.json`,
				digest: `sha256:${createHash('sha256').update(manifest).digest('hex')}`,
			},
			{
				name: artifact.file,
				size: artifact.size,
				state: 'uploaded',
				browser_download_url: `${url}/${artifact.file}`,
				digest: `sha256:${hash}`,
			},
		],
	}
	return {manifest, release}
}
let network: ReturnType<typeof vi.fn>
beforeEach(() => {
	network = vi.fn()
	vi.stubGlobal('fetch', network)
	vi.mocked(fse.readJson).mockResolvedValue(build)
})
afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})
function respond(f = fixture()) {
	network.mockResolvedValueOnce(Response.json([f.release])).mockResolvedValueOnce(new Response(f.manifest))
	return f
}

describe('repository system releases', () => {
	test('uses the configured fork, exact target and authenticated asset digests', async () => {
		respond()
		expect(await checkUpdate()).toMatchObject({
			available: true,
			supported: true,
			current: build,
			release: {version: '1.1.0', artifact},
		})
		expect(network.mock.calls[0][0]).toBe(`https://api.github.com/repos/${repository}/releases?per_page=100`)
	})
	test('reports an empty repository distinctly from an inaccessible one', async () => {
		network.mockResolvedValueOnce(Response.json([]))
		expect(await checkUpdate()).toMatchObject({available: false, release: null, supported: true})
		network.mockResolvedValueOnce(new Response('', {status: 404}))
		await expect(checkUpdate()).rejects.toThrow('HTTP 404')
	})
	test.each([403, 429, 500])('does not call HTTP %i up to date', async (status) => {
		network.mockResolvedValueOnce(new Response('', {status}))
		await expect(checkUpdate()).rejects.toThrow(`HTTP ${status}`)
	})
	test('does not offer a downgrade or repeat the installed release', async () => {
		respond(fixture({version: '1.0.0'}))
		expect((await checkUpdate()).available).toBe(false)
		respond(fixture({version: '0.9.0'}))
		expect((await checkUpdate()).available).toBe(false)
	})
	test('ignores draft, prerelease and unversioned releases and chooses semantic version order', async () => {
		const current = fixture({version: '1.10.0'})
		network
			.mockResolvedValueOnce(
				Response.json([
					{...current.release, tag_name: 'v99.0.0', draft: true},
					{...current.release, tag_name: 'v2.0.0-beta.1', prerelease: true},
					{...current.release, tag_name: 'v1.9.0'},
					current.release,
					{...current.release, tag_name: 'nightly'},
				]),
			)
			.mockResolvedValueOnce(new Response(current.manifest))
		expect((await getRelease(build))?.version).toBe('1.10.0')
	})
	test('rejects corrupt metadata before reading a bundle', async () => {
		const f = fixture()
		f.release.assets[0].digest = `sha256:${hash}`
		respond(f)
		await expect(getRelease(build)).rejects.toThrow('manifest digest')
	})
	test('rejects releases without an update manifest', async () => {
		const f = fixture()
		f.release.assets = []
		respond(f)
		await expect(getRelease(build)).rejects.toThrow('manifest')
	})
	test('does not treat a generic ARM64 bundle as a Pi update', async () => {
		respond(fixture({artifacts: {} as {pi4: typeof artifact}}))
		await expect(getRelease(build)).rejects.toThrow('device target')
	})
	test('rejects a bundle mislabeled as another target', async () => {
		respond(fixture({artifacts: {pi4: {...artifact, file: 'umbrelos-arm64.rugixb'}}}))
		await expect(getRelease(build)).rejects.toThrow('device target')
	})
	test('rejects incompatible data formats', async () => {
		respond(fixture({dataVersion: 2}))
		await expect(getRelease(build)).rejects.toThrow()
	})
	test('rejects links outside the configured release', async () => {
		const f = fixture()
		f.release.assets[0].browser_download_url = 'https://example.com/script'
		respond(f)
		await expect(getRelease(build)).rejects.toThrow('outside the configured repository')
	})
	test('rejects inconsistent bundle checksums', async () => {
		const f = fixture()
		f.release.assets[1].digest = null as unknown as string
		respond(f)
		await expect(getRelease(build)).rejects.toThrow('inconsistent')
	})
	test('does not guess the installed version from package.json in development', async () => {
		vi.mocked(fse.readJson).mockRejectedValue(Object.assign(new Error('missing'), {code: 'ENOENT'}))
		expect(await checkUpdate()).toMatchObject({current: null, supported: false, available: false})
		expect(network).not.toHaveBeenCalled()
	})
	test('fails on corrupt build metadata rather than pretending this is development', async () => {
		vi.mocked(fse.readJson).mockResolvedValue({})
		await expect(readBuild()).rejects.toThrow('Invalid system build')
	})
	test('allows an explicitly selected stable release over a local development build', async () => {
		respond()
		const release = (await getRelease(build))!
		expect(isNewer({...build, release: {id: 'dev', version: 'commit-dirty-20261002'}}, release)).toBe(true)
	})
})
