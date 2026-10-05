import path from 'node:path'
import fse from 'fs-extra'
import yaml from 'js-yaml'
import {z} from 'zod'

import type Umbreld from '../../index.js'
import {AppExternalUrlSchema, type AppManifest, validateManifest} from './schema.js'
import {fixedPublishedPort, getPublishedPorts, publishedHostPorts} from './compose-ports.js'

const appId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const httpUrl = z
	.string()
	.url()
	.refine((value) => /^https?:\/\//i.test(value), {message: 'Use an HTTP or HTTPS URL'})
export const CustomAppMetadataSchema = z
	.object({
		id: appId,
		name: z.string().trim().min(1).max(100),
		icon: httpUrl,
		description: z.string().trim().min(1).max(10000),
		version: z.string().trim().min(1).max(100),
		category: z.string().trim().min(1).max(100),
		tagline: z.string().trim().max(200).default(''),
		website: z.union([httpUrl, z.literal('')]).default(''),
		port: z.number().int().min(0).max(65535).default(0),
		protocol: z.enum(['http', 'https']).default('http'),
		externalUrl: AppExternalUrlSchema.optional(),
		path: z.string().startsWith('/').default('/'),
		backupIgnore: z.array(z.string()).optional(),
	})
	.strict()
export type CustomAppMetadata = z.infer<typeof CustomAppMetadataSchema>
export const CustomAppInputSchema = z.object({
	definition: z
		.string()
		.min(1)
		.max(1024 * 1024),
	metadata: CustomAppMetadataSchema,
})

const object = z.record(z.unknown())

/** Validate a standalone Compose definition without adding transport services. */
export function inspectCustomCompose(definition: string) {
	const compose = object.parse(yaml.load(definition))
	if (['include', 'name', 'x-panel'].some((key) => key in compose))
		throw new Error('Use a standalone Docker Compose file without include, name or x-panel')
	const services = z.record(object).parse(compose.services)
	if (!Object.keys(services).length) throw new Error('At least one application service is required')
	for (const [name, service] of Object.entries(services)) {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) throw new Error(`Invalid service name: ${name}`)
		if (name === 'app_proxy') throw new Error('Declare service ports directly in Compose instead of app_proxy')
		if (typeof service.image !== 'string' || !service.image.trim()) throw new Error(`${name} requires an image`)
		if (['build', 'extends', 'env_file', 'profiles'].some((key) => key in service))
			throw new Error(`${name} must use a prebuilt image and inline configuration`)
	}
	for (const kind of ['configs', 'secrets', 'volumes', 'networks']) {
		for (const value of Object.values(object.parse(compose[kind] ?? {}))) {
			if (value === null) continue
			const resource = object.parse(value)
			if (resource.external || resource.name || resource.file || resource.environment)
				throw new Error(`${kind} must be self-contained and scoped to this application`)
		}
	}
	const ports = getPublishedPorts({services})
	const hostNetwork = Object.values(services).some((service) => service.network_mode === 'host')
	return {compose, ports, hostNetwork}
}

/** Application metadata chooses a launch endpoint; Compose owns all service bindings. */
export function prepareCustomApp(definition: string, input: CustomAppMetadata) {
	const metadata = CustomAppMetadataSchema.parse(input)
	const {compose, ports, hostNetwork} = inspectCustomCompose(definition)
	if (
		metadata.port &&
		!hostNetwork &&
		!ports.some((binding) => binding.protocol === 'tcp' && fixedPublishedPort(binding) === metadata.port)
	)
		throw new Error('Choose a fixed TCP host port published in Compose for the web entry')
	if (metadata.externalUrl && !metadata.port) throw new Error('An external URL requires a web entry')
	const manifest: AppManifest = {
		manifestVersion: '1.1.0',
		id: metadata.id,
		name: metadata.name,
		icon: metadata.icon,
		description: metadata.description,
		version: metadata.version,
		category: metadata.category,
		tagline: metadata.tagline,
		website: metadata.website,
		port: metadata.port,
		portProtocol: metadata.protocol,
		path: metadata.path,
		support: '',
		gallery: [],
		dependencies: [],
		backupIgnore: metadata.backupIgnore,
		storage: {dataRoot: 'data'},
	}
	return {manifest, compose, definition, metadata, ports, hostNetwork}
}

export default class CustomApps {
	#pending = new Set<string>()
	constructor(private readonly host: Umbreld) {}
	get root() {
		return path.join(this.host.dataDirectory, 'custom-apps')
	}
	directory(id: string) {
		return path.join(this.root, appId.parse(id))
	}
	async has(id: string) {
		return appId.safeParse(id).success && fse.pathExists(path.join(this.directory(id), 'umbrel-app.yml'))
	}
	async registry() {
		const entries = await fse.readdir(this.root).catch((error) => {
			if (error.code === 'ENOENT') return []
			throw error
		})
		const apps: Array<AppManifest & {appStoreId: string; icon: string}> = []
		for (const id of entries) {
			if (!appId.safeParse(id).success) continue
			const manifest = validateManifest(
				yaml.load(await fse.readFile(path.join(this.directory(id), 'umbrel-app.yml'), 'utf8')),
			)
			apps.push({...manifest, appStoreId: 'custom-apps', icon: manifest.icon!})
		}
		return {url: '', meta: {id: 'custom-apps', name: 'Custom apps'}, apps}
	}
	async install(definition: string, metadata: CustomAppMetadata) {
		const prepared = prepareCustomApp(definition, metadata)
		const id = prepared.manifest.id
		for (const port of new Set([prepared.manifest.port, ...publishedHostPorts(prepared.ports)])) {
			await this.host.machines.assertAppPortAvailable(port)
		}
		if (this.#pending.has(id)) throw new Error('This application is already being imported')
		this.#pending.add(id)
		const directory = this.directory(id)
		const manifestPath = path.join(directory, 'umbrel-app.yml')
		const composePath = path.join(directory, 'docker-compose.yml')
		let previous: {manifest: string; compose: string} | undefined
		let written = false
		let lifecycleCompleted = false
		try {
			if (await this.has(id)) {
				previous = {
					manifest: await fse.readFile(manifestPath, 'utf8'),
					compose: await fse.readFile(composePath, 'utf8'),
				}
			} else if ((await this.host.appStore.resolvedApps()).has(id) || (await this.host.apps.isInstalled(id))) {
				throw new Error('This application ID is already used by an app-store application')
			}
			await fse.ensureDir(directory)
			written = true
			await fse.writeFile(manifestPath, yaml.dump(prepared.manifest))
			await fse.writeFile(composePath, prepared.definition, {mode: 0o600})
			const result = (await this.host.apps.isInstalled(id))
				? await this.host.apps.update(id)
				: await this.host.apps.install(id)
			lifecycleCompleted = true
			if (metadata.externalUrl !== undefined) {
				await this.host.apps.getApp(id).setSettings({externalUrl: metadata.externalUrl})
			}
			return result
		} catch (error) {
			// Once installed, keep the source consistent with the running application,
			// even if saving its launch metadata fails.
			if (written && !lifecycleCompleted) {
				if (previous) {
					await fse.writeFile(manifestPath, previous.manifest)
					await fse.writeFile(composePath, previous.compose)
				} else await fse.remove(directory)
			}
			throw error
		} finally {
			this.#pending.delete(id)
		}
	}
	async remove(id: string) {
		if (await this.has(id)) await fse.remove(this.directory(id))
	}
}
