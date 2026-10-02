import {describe, expect, test} from 'vitest'
import {prepareCustomApp, CustomAppMetadataSchema} from './custom-apps.js'

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
	test('generates the same app_proxy declaration used by store applications', () => {
		const result = prepareCustomApp(definition, {...metadata, service: 'web', port: 38888, containerPort: 8080})
		expect(result.manifest.port).toBe(38888)
		expect(result.compose.services).toMatchObject({
			app_proxy: {environment: {APP_HOST: 'personal-app_web_1', APP_PORT: 8080}},
		})
	})
	test.each(['name', 'icon', 'description'])('requires %s', (field) => {
		expect(() => prepareCustomApp(definition, {...metadata, [field]: ''})).toThrow()
	})
	test.each(['../outside', 'a/b', 'a;touch'])('rejects unsafe app ID %s', (id) => {
		expect(() => prepareCustomApp(definition, {...metadata, id})).toThrow()
	})
	test('rejects a missing entry service before writing application files', () => {
		expect(() =>
			prepareCustomApp(definition, {...metadata, service: 'missing', port: 8080, containerPort: 80}),
		).toThrow('Unknown web service')
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
