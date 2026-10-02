import fse from 'fs-extra'
import semver from 'semver'
import {z} from 'zod'

import source from './source.json'

export const repository = source.repository
export const releasesUrl = `https://github.com/${repository}/releases`
export const targets = {
	'umbrelos-pi4': 'pi4',
	'umbrelos-pi-tryboot': 'pi5',
	'umbrelos-arm64': 'arm64',
	'umbrelos-amd64': 'amd64',
} as const

export const BuildInfo = z.object({
	name: z.enum(['umbrelos-pi4', 'umbrelos-pi-tryboot', 'umbrelos-arm64', 'umbrelos-amd64']),
	release: z.object({id: z.string().min(1), version: z.string().min(1)}),
})
export type Build = z.infer<typeof BuildInfo>
export async function readBuild(): Promise<Build | null> {
	try {
		return BuildInfo.parse(await fse.readJson('/etc/rugix/system-build-info.json'))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
		throw new Error('Invalid system build information', {cause: error})
	}
}

const Asset = z.object({
	name: z.string(),
	size: z.number().int().positive(),
	state: z.literal('uploaded'),
	browser_download_url: z.string().url(),
	digest: z.string().nullable().optional(),
})
const Release = z.object({
	id: z.number().int().positive(),
	tag_name: z.string(),
	name: z.string().nullable(),
	body: z.string().nullable(),
	draft: z.boolean(),
	prerelease: z.boolean(),
	assets: z.array(Asset),
})
const Artifact = z
	.object({
		file: z.string().regex(/^umbrelos-(pi4|pi|arm64|amd64)\.rugixb$/),
		size: z
			.number()
			.int()
			.positive()
			.max(32 * 1024 ** 3),
		sha256: z.string().regex(/^[a-f0-9]{64}$/),
		bundleHash: z.string().regex(/^sha512-256:[a-f0-9]{64}$/),
	})
	.strict()
export const Manifest = z
	.object({
		format: z.literal(1),
		repository: z.literal(repository),
		version: z.string().refine((value) => semver.valid(value) === value && semver.prerelease(value) === null),
		protocol: z.literal(source.protocol),
		dataVersion: z.literal(source.dataVersion),
		artifacts: z
			.object({
				pi4: Artifact.optional(),
				pi5: Artifact.optional(),
				arm64: Artifact.optional(),
				amd64: Artifact.optional(),
			})
			.strict(),
	})
	.strict()
export type Update = {
	releaseId: number
	version: string
	tag: string
	name: string
	notes: string
	url: string
	artifact: z.infer<typeof Artifact>
	assetUrl: string
}

const headers = {
	Accept: 'application/vnd.github+json',
	'X-GitHub-Api-Version': '2022-11-28',
	'User-Agent': 'personal-panel-updater',
}

export async function fetchLimited(url: string, limit = 1024 * 1024) {
	const response = await fetch(url, {headers, signal: AbortSignal.timeout(20_000)})
	if (!response.ok) throw new Error(`Update source returned HTTP ${response.status}`)
	if (!response.body) throw new Error('Empty update response')
	const chunks: Uint8Array[] = []
	let size = 0
	const reader = response.body.getReader()
	try {
		while (true) {
			const {done, value} = await reader.read()
			if (done) break
			size += value.length
			if (size > limit) throw new Error('Update metadata exceeds its size limit')
			chunks.push(value)
		}
	} finally {
		await reader.cancel()
		reader.releaseLock()
	}
	return Buffer.concat(chunks)
}

function assetUrl(asset: z.infer<typeof Asset>, tag: string) {
	const expected = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${asset.name}`
	if (asset.browser_download_url !== expected) throw new Error('Release asset is outside the configured repository')
	return expected
}

export async function getRelease(build: Build, releaseId?: number): Promise<Update | null> {
	// Listing instead of /latest distinguishes an empty public repository from an
	// inaccessible repository. A 404, timeout or rate limit is never "up to date".
	const endpoint = `https://api.github.com/repos/${repository}/releases`
	let release: z.infer<typeof Release>
	if (releaseId) {
		release = Release.parse(JSON.parse((await fetchLimited(`${endpoint}/${releaseId}`)).toString()))
	} else {
		const releases = z.array(Release).parse(JSON.parse((await fetchLimited(`${endpoint}?per_page=100`)).toString()))
		const stable = releases.filter(
			(item) =>
				!item.draft && !item.prerelease && /^v\d+\.\d+\.\d+$/.test(item.tag_name) && semver.valid(item.tag_name),
		)
		stable.sort((a, b) => semver.rcompare(a.tag_name, b.tag_name))
		if (!stable[0]) return null
		release = stable[0]
	}
	if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name))
		throw new Error('Only stable versioned releases are supported')
	const metadata = release.assets.find((item) => item.name === 'system-release.json')
	if (!metadata) throw new Error('This release has no system update manifest')
	const bytes = await fetchLimited(assetUrl(metadata, release.tag_name))
	// GitHub is the release authority. Require its authenticated HTTPS API digest
	// so a separately replaced asset cannot silently change an approved manifest.
	const {createHash} = await import('node:crypto')
	if (metadata.digest !== `sha256:${createHash('sha256').update(bytes).digest('hex')}`)
		throw new Error('Release manifest digest is missing or incorrect')
	const manifest = Manifest.parse(JSON.parse(bytes.toString()))
	if (`v${manifest.version}` !== release.tag_name) throw new Error('Release version does not match its manifest')
	const artifact = manifest.artifacts[targets[build.name]]
	if (!artifact) throw new Error('This release does not support this device target')
	const file = `${build.name === 'umbrelos-pi-tryboot' ? 'umbrelos-pi' : build.name}.rugixb`
	if (artifact.file !== file) throw new Error('Update bundle does not match the device target')
	const asset = release.assets.find((item) => item.name === artifact.file)
	if (!asset || asset.size !== artifact.size || asset.digest !== `sha256:${artifact.sha256}`)
		throw new Error('Update bundle metadata is missing or inconsistent')
	return {
		releaseId: release.id,
		version: manifest.version,
		tag: release.tag_name,
		name: release.name || release.tag_name,
		notes: release.body || '',
		url: `${releasesUrl}/tag/${release.tag_name}`,
		artifact,
		assetUrl: assetUrl(asset, release.tag_name),
	}
}

export function isNewer(build: Build, update: Update) {
	const current = semver.valid(build.release.version)
	return current ? semver.gt(update.version, current) : update.version !== build.release.version
}

export async function checkUpdate() {
	const current = await readBuild()
	if (!current) return {current, repository, releasesUrl, available: false, release: null, supported: false}
	const release = await getRelease(current)
	return {
		current,
		repository,
		releasesUrl,
		available: release !== null && isNewer(current, release),
		release,
		supported: true,
	}
}
