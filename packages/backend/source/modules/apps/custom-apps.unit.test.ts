import {describe, expect, test, vi} from 'vitest'
import fse from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import CustomApps, {prepareCustomApp, CustomAppMetadataSchema} from './custom-apps.js'

const metadata = CustomAppMetadataSchema.parse({
	id: 'personal-app',
	name: 'Personal App',
	icon: 'https://example.com/icon.svg',
	description: 'My service',
	version: '1.0.0',
	category: 'Utilities',
})
const definition = 'services:\n  web:\n    image: alpine:3.21\n    command: [sleep, infinity]\n'

describe('custom applications use the app-store contract', () => {
	test('produces ordinary manifest fields and preserves a background Compose service', () => {
		const result = prepareCustomApp(definition, metadata)
		expect(result.manifest).toMatchObject({
			manifestVersion: '1.1.0',
			id: 'personal-app',
			name: 'Personal App',
			icon: metadata.icon,
			description: 'My service',
			port: 0,
		})
		expect(result.compose).not.toHaveProperty('x-panel')
		expect(result.compose.services).not.toHaveProperty('app_proxy')
	})
	test('preserves every service binding and uses the selected host port as its launch endpoint', () => {
		const source = `${definition}    ports:\n      - "38888:8080"\n      - "38889:8081"\n`
		const result = prepareCustomApp(source, {
			...metadata,
			port: 38888,
			protocol: 'https',
			externalUrl: 'https://agent.example.com/ui/',
		})
		expect(result.manifest).toMatchObject({port: 38888, portProtocol: 'https'})
		expect(result.definition).toBe(source)
		expect(result.compose.services).toEqual({
			web: {image: 'alpine:3.21', command: ['sleep', 'infinity'], ports: ['38888:8080', '38889:8081']},
		})
		expect(result.ports).toHaveLength(2)
	})
	test('keeps HTTP as the default native protocol for a published web entry', () => {
		const result = prepareCustomApp(`${definition}    ports: ["38888:8080"]\n`, {...metadata, port: 38888})
		expect(result.manifest).toMatchObject({port: 38888, portProtocol: 'http'})
	})
	test.each(['8080', '38888:8080/udp', '38888-38890:8080-8082'])(
		'rejects a non-fixed TCP launch binding %s',
		(binding) => {
			expect(() => prepareCustomApp(`${definition}    ports: ["${binding}"]\n`, {...metadata, port: 38888})).toThrow(
				'fixed TCP host port',
			)
		},
	)
	test('supports host networking with an explicit launch port', () => {
		expect(prepareCustomApp(`${definition}    network_mode: host\n`, {...metadata, port: 8080}).manifest.port).toBe(
			8080,
		)
	})
	test('requires a web entry for an external launch URL', () => {
		expect(() => prepareCustomApp(definition, {...metadata, externalUrl: 'https://app.example.com'})).toThrow(
			'requires a web entry',
		)
	})
	test.each(['javascript:alert(1)', 'https://user:secret@example.com', 'ftp://example.com'])(
		'rejects unsafe external launch URL %s',
		(externalUrl) => {
			expect(() => prepareCustomApp(definition, {...metadata, externalUrl})).toThrow()
		},
	)
	test.each(['name', 'icon', 'description'])('requires %s', (field) => {
		expect(() => prepareCustomApp(definition, {...metadata, [field]: ''})).toThrow()
	})
	test.each(['../outside', 'a/b', 'a;touch'])('rejects unsafe app ID %s', (id) => {
		expect(() => prepareCustomApp(definition, {...metadata, id})).toThrow()
	})
	test('rejects a primary port that is not published', () => {
		expect(() => prepareCustomApp(definition, {...metadata, port: 8080})).toThrow('fixed TCP host port')
	})
	test.each(['include: other.yaml', 'x-panel: {}'])('rejects unsupported standalone configuration %s', (extension) => {
		expect(() => prepareCustomApp(`${definition}\n${extension}`, metadata)).toThrow()
	})
	test('rejects a build or external env file in a single-file import', () => {
		for (const extra of ['build: .', 'env_file: ../secret.env']) {
			expect(() => prepareCustomApp(`${definition}    ${extra}\n`, metadata)).toThrow('prebuilt image')
		}
	})
})

test.each(['success', 'install-failure', 'settings-failure'])(
	'keeps import source consistent after %s',
	async (scenario) => {
		const dataDirectory = await fse.mkdtemp(path.join(os.tmpdir(), 'custom-app-import-'))
		const source = `${definition}    ports: ["38888:8080", "38889:8081"]\n`
		const setSettings = vi.fn(async () => {
			if (scenario === 'settings-failure') throw new Error('Cannot save launch URL')
			return true
		})
		const host = {
			dataDirectory,
			machines: {assertAppPortAvailable: vi.fn(async (_port: number) => {})},
			appStore: {resolvedApps: async () => new Map()},
			apps: {
				isInstalled: async () => false,
				install: async () => {
					if (scenario === 'install-failure') throw new Error('Install failed')
					return true
				},
				getApp: () => ({setSettings}),
			},
		}
		const imports = new CustomApps(host as never)
		try {
			const result = imports.install(source, {...metadata, port: 38888, externalUrl: 'https://app.example.com/'})
			if (scenario === 'success') await expect(result).resolves.toBe(true)
			else
				await expect(result).rejects.toThrow(
					scenario === 'install-failure' ? 'Install failed' : 'Cannot save launch URL',
				)
			expect(host.machines.assertAppPortAvailable.mock.calls.map(([port]) => port)).toEqual([38888, 38889])
			if (scenario === 'install-failure') {
				expect(await imports.has(metadata.id)).toBe(false)
				expect(setSettings).not.toHaveBeenCalled()
			} else {
				expect(await fse.readFile(path.join(imports.directory(metadata.id), 'docker-compose.yml'), 'utf8')).toBe(source)
				expect(setSettings).toHaveBeenCalledWith({externalUrl: 'https://app.example.com/'})
			}
		} finally {
			await fse.remove(dataDirectory)
		}
	},
)
