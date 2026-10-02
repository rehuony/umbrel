import fse from 'fs-extra'
import yaml from 'js-yaml'
import {$} from 'execa'
import pRetry from 'p-retry'
import {afterAll, beforeAll, expect, test} from 'vitest'
import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let host: Awaited<ReturnType<typeof createTestUmbreld>>
beforeAll(async () => {
	host = await createTestUmbreld({autoLogin: true})
})
afterAll(async () => {
	await host?.cleanup()
})

test('imports, updates and uninstalls a custom app using original store files and deletes app data', async () => {
	const metadata = {
		id: 'personal-test',
		name: 'Personal Test',
		icon: 'https://example.com/icon.svg',
		description: 'Custom service',
		version: '1.0.0',
		category: 'Utilities',
		service: 'web',
		port: 38888,
		containerPort: 8080,
	}
	const definition = yaml.dump({
		services: {
			web: {
				image: 'busybox:1.37.0',
				command: ['sh', '-c', 'mkdir -p /www; echo ready > /www/index.html; httpd -f -p 8080 -h /www'],
				volumes: ['./data:/data'],
			},
		},
	})
	await expect(host.unauthenticatedClient.apps.importCompose.mutate({definition, metadata})).rejects.toThrow()
	const preview = await host.client.apps.prepareImport.mutate({definition, metadata})
	expect(preview.app).toMatchObject({name: metadata.name, icon: metadata.icon, description: metadata.description})
	await expect(host.client.apps.importCompose.mutate({definition, metadata})).resolves.toBe(true)
	const expectRunningWebService = () =>
		pRetry(
			async () => {
				const {stdout} = await $`docker exec personal-test_web_1 wget -qO- http://127.0.0.1:8080`
				expect(stdout.trim()).toBe('ready')
			},
			{retries: 10, minTimeout: 250, maxTimeout: 1000},
		)
	await expectRunningWebService()
	const directory = `${host.instance.dataDirectory}/app-data/${metadata.id}`
	expect(yaml.load(await fse.readFile(`${directory}/umbrel-app.yml`, 'utf8'))).toMatchObject({
		manifestVersion: '1.1.0',
		id: metadata.id,
	})
	expect(yaml.load(await fse.readFile(`${directory}/docker-compose.yml`, 'utf8'))).toHaveProperty('services.app_proxy')
	await fse.outputFile(`${directory}/data/persistent.txt`, 'application data')
	await host.client.apps.stop.mutate({appId: metadata.id})
	expect(await fse.readFile(`${directory}/data/persistent.txt`, 'utf8')).toBe('application data')
	await host.client.apps.importCompose.mutate({definition, metadata: {...metadata, version: '2.0.0'}})
	await expectRunningWebService()
	expect(await fse.readFile(`${directory}/data/persistent.txt`, 'utf8')).toBe('application data')
	expect((await host.client.apps.list.query()).find((app) => app.id === metadata.id)).toMatchObject({version: '2.0.0'})
	await host.client.apps.uninstall.mutate({appId: metadata.id})
	expect(await fse.pathExists(directory)).toBe(false)
	expect(await fse.pathExists(`${host.instance.dataDirectory}/custom-apps/${metadata.id}`)).toBe(false)
	expect(
		(await host.client.appStore.registry.query()).flatMap((store) => store.apps).some((app) => app.id === metadata.id),
	).toBe(false)
})
