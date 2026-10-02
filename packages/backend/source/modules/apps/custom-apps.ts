import path from 'node:path'
import fse from 'fs-extra'
import yaml from 'js-yaml'
import {z} from 'zod'

import type Umbreld from '../../index.js'
import {type AppManifest, validateManifest} from './schema.js'

const appId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
const httpUrl = z
	.string()
	.url()
	.refine((value) => /^https?:\/\//i.test(value), {message: 'Use an HTTP or HTTPS URL'})
export const CustomAppMetadataSchema = z.object({
	id: appId,
	name: z.string().trim().min(1).max(100),
	icon: httpUrl,
	description: z.string().trim().min(1).max(10000),
	version: z.string().trim().min(1).max(100),
	category: z.string().trim().min(1).max(100),
	tagline: z.string().trim().max(200).default(''),
	website: z.union([httpUrl, z.literal('')]).default(''),
	service: z.string().default(''),
	port: z.number().int().min(0).max(65535).default(0),
	containerPort: z.number().int().min(0).max(65535).default(0),
	path: z.string().startsWith('/').default('/'),
	backupIgnore: z.array(z.string()).optional(),
})
export type CustomAppMetadata = z.infer<typeof CustomAppMetadataSchema>
export const CustomAppInputSchema = z.object({
	definition: z
		.string()
		.min(1)
		.max(1024 * 1024),
	metadata: CustomAppMetadataSchema,
})

const object = z.record(z.unknown())

/** Produces the same pair of files that an app-store repository supplies. */
export function prepareCustomApp(definition: string, input: CustomAppMetadata) {
	const metadata = CustomAppMetadataSchema.parse(input)
	const compose = object.parse(yaml.load(definition))
	if (['include', 'name', 'x-panel'].some((key) => key in compose))
		throw new Error('Use a standalone Docker Compose file without include, name or x-panel')
	const services = z.record(object).parse(compose.services)
	const runnable = Object.entries(services).filter(([name]) => name !== 'app_proxy')
	if (!runnable.length) throw new Error('At least one application service is required')
	for (const [name, service] of runnable) {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) throw new Error(`Invalid service name: ${name}`)
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
	if (metadata.service) {
		if (!services[metadata.service] || metadata.service === 'app_proxy') throw new Error('Unknown web service')
		if (!metadata.port || !metadata.containerPort) throw new Error('Web entry and container ports are required')
		services.app_proxy = {
			environment: {
				APP_HOST: `${metadata.id}_${metadata.service}_1`,
				APP_PORT: metadata.containerPort,
			},
		}
	} else if (services.app_proxy && !metadata.port) {
		throw new Error('An app_proxy entry requires a web entry port')
	}
	compose.services = services
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
		path: metadata.path,
		support: '',
		gallery: [],
		dependencies: [],
		backupIgnore: metadata.backupIgnore,
		storage: {dataRoot: 'data'},
	}
	return {manifest, compose, definition: yaml.dump(compose), metadata}
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
		if (this.#pending.has(id)) throw new Error('This application is already being imported')
		this.#pending.add(id)
		const directory = this.directory(id)
		const manifestPath = path.join(directory, 'umbrel-app.yml')
		const composePath = path.join(directory, 'docker-compose.yml')
		let previous: {manifest: string; compose: string} | undefined
		let written = false
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
			if (await this.host.apps.isInstalled(id)) return await this.host.apps.update(id)
			return await this.host.apps.install(id)
		} catch (error) {
			if (written) {
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
