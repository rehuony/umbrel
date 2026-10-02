import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import path from 'node:path'
import {afterEach, expect, test} from 'vitest'
import pWaitFor from 'p-wait-for'
import {createTestVm} from '../../test-utilities/create-test-umbreld.js'
import {runInTerminal} from '../../test-utilities/web-terminal.js'

let host: Awaited<ReturnType<typeof createTestVm>> | undefined
let server: ReturnType<typeof createServer> | undefined
afterEach(async () => {
	await host?.cleanup()
	host = undefined
	server?.closeAllConnections()
	await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
	server = undefined
})

// Build two different releases first. This test replaces only the release HTTP
// transport in a disposable VM; real bundles, checksums, Rugix slot writes,
// health checks and guest reboots are exercised without publishing a release.
test.skipIf(!process.env.UPDATE_TEST_IMAGE || !process.env.UPDATE_TEST_ARTIFACT)(
	'updates, manually restores, and automatically rejects a mismatched trial while retaining user and application data',
	async () => {
		const image = path.resolve(process.env.UPDATE_TEST_IMAGE!)
		const artifactFile = path.resolve(process.env.UPDATE_TEST_ARTIFACT!)
		const {version, target, ...artifact} = JSON.parse(await readFile(artifactFile, 'utf8'))
		const bundle = path.join(path.dirname(artifactFile), artifact.file)
		const repository = 'rehuony/umbrel'
		let manifest = JSON.stringify({
			format: 1,
			repository,
			version,
			protocol: 1,
			dataVersion: 1,
			artifacts: {[target]: artifact},
		})
		const prefix = `https://github.com/${repository}/releases/download/v${version}`
		const release = {
			id: 1,
			tag_name: `v${version}`,
			name: 'VM update fixture',
			body: 'Local VM fixture',
			draft: false,
			prerelease: false,
			assets: [
				{
					name: 'system-release.json',
					state: 'uploaded',
					size: manifest.length,
					digest: `sha256:${createHash('sha256').update(manifest).digest('hex')}`,
					browser_download_url: `${prefix}/system-release.json`,
				},
				{
					name: artifact.file,
					state: 'uploaded',
					size: artifact.size,
					digest: `sha256:${artifact.sha256}`,
					browser_download_url: `${prefix}/${artifact.file}`,
				},
			],
		}
		server = createServer((request, response) => {
			if (request.url === '/bundle') {
				response.setHeader('Content-Length', artifact.size)
				createReadStream(bundle).pipe(response)
				return
			}
			response.setHeader('Content-Type', 'application/json')
			response.end(
				request.url === '/manifest'
					? manifest
					: request.url === '/releases/1'
						? JSON.stringify(release)
						: JSON.stringify([release]),
			)
		})
		await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
		const port = (server.address() as {port: number}).port
		host = await createTestVm({device: 'umbrel-home', image, forwardPorts: [{guestPort: 4088}]})
		const system = host
		await system.vm.powerOn()
		await system.registerAndLogin()
		const oldVersion = (await system.client.system.version.query()).version
		expect(oldVersion).not.toBe(version)
		await expect(system.unauthenticatedClient.system.checkUpdate.query()).rejects.toThrow()
		await system.api.post('files/upload?path=/Home/update-preserved.txt', {body: 'user data survives system updates'})
		await system.client.apps.importCompose.mutate({
			metadata: {
				id: 'update-fixture',
				name: 'Update fixture',
				icon: 'https://example.com/icon.svg',
				description: 'System update persistence fixture',
				version: '1.0.0',
				category: 'Utilities',
			},
			definition: JSON.stringify({
				services: {
					server: {
						image: 'busybox:1.37.0',
						command: [
							'sh',
							'-c',
							'test -f /data/index.html || cat /proc/sys/kernel/random/uuid > /data/index.html; exec httpd -f -p 4088 -h /data',
						],
						ports: ['4088:4088'],
						volumes: ['./data:/data'],
						restart: 'unless-stopped',
					},
				},
			}),
		})
		const appUrl = `http://127.0.0.1:${system.vm.getHostPort(4088)}`
		await pWaitFor(
			async () => {
				try {
					return (await fetch(appUrl, {signal: AbortSignal.timeout(2000)})).ok
				} catch {
					return false
				}
			},
			{interval: 1000, timeout: 60_000},
		)
		const appData = await (await fetch(appUrl)).text()
		const expectApp = async () => {
			await pWaitFor(
				async () => {
					try {
						return (await (await fetch(appUrl, {signal: AbortSignal.timeout(2000)})).text()) === appData
					} catch {
						return false
					}
				},
				{interval: 1000, timeout: 60_000},
			)
		}
		const root = (command: string) => runInTerminal(system, command, true)
		const shim = `const original = globalThis.fetch; globalThis.fetch = (input, options) => { const url = String(input); if (url.startsWith('https://api.github.com/repos/${repository}/releases')) return original(url.replace('https://api.github.com/repos/${repository}', 'http://10.0.2.2:${port}'), options); if (url.startsWith('https://github.com/${repository}/releases/download/') && url.endsWith('/system-release.json')) return original('http://10.0.2.2:${port}/manifest', options); if (url.startsWith('https://github.com/${repository}/releases/download/') && url.endsWith('/${artifact.file}')) return original('http://10.0.2.2:${port}/bundle', options); return original(input, options); };`
		const configureNetwork = async () => {
			await root(`set -eu
printf %s ${Buffer.from(shim).toString('base64')} | base64 -d > /data/update-test-network.mjs
for service in umbrel panel-update; do
 mkdir -p /etc/systemd/system/$service.service.d
 printf '[Service]\\nEnvironment="NODE_OPTIONS=--import=/data/update-test-network.mjs"\\n' > /etc/systemd/system/$service.service.d/update-test.conf
done
systemctl daemon-reload
systemd-run --unit=update-test-restart --on-active=1s systemctl restart umbrel
`)
			await pWaitFor(
				async () => {
					try {
						await system.login()
						return (await system.client.system.checkUpdate.query()).release?.version === release.tag_name.slice(1)
					} catch {
						return false
					}
				},
				{interval: 2000, timeout: 120_000},
			)
		}
		await configureNetwork()
		await expect(system.client.system.update.mutate({version})).resolves.toBe(true)
		await pWaitFor(
			async () => {
				let status
				try {
					await system.login()
					status = await system.client.system.updateStatus.query()
				} catch {
					return false
				}
				if (status.state?.phase === 'failed' || status.state?.phase === 'rolled-back')
					throw new Error(status.state.error)
				return status.state?.phase === 'succeeded' && (await system.client.system.version.query()).version === version
			},
			{interval: 3000, timeout: 600_000},
		)
		expect((await system.client.files.list.query({path: '/Home'})).files.map((file) => file.name)).toContain(
			'update-preserved.txt',
		)
		await expectApp()
		expect((await system.client.system.updateStatus.query()).rollbackAvailable).toBe(true)
		await expect(system.client.system.rollback.mutate()).resolves.toBe(true)
		await pWaitFor(
			async () => {
				try {
					await system.login()
					return (
						(await system.client.system.version.query()).version === oldVersion &&
						(await system.client.system.updateStatus.query()).state?.phase === 'succeeded'
					)
				} catch {
					return false
				}
			},
			{interval: 3000, timeout: 300_000},
		)
		expect((await system.client.files.list.query({path: '/Home'})).files.map((file) => file.name)).toContain(
			'update-preserved.txt',
		)
		await expectApp()
		expect(await root('rugix-ctrl system info')).toContain('"activeGroup"')
		// A correctly checksummed bundle whose embedded version disagrees with
		// the release must fail its real trial boot and return automatically.
		const mismatchedVersion = version
			.split('.')
			.map((part: string, index: number) => (index === 2 ? Number(part) + 1 : part))
			.join('.')
		manifest = JSON.stringify({...JSON.parse(manifest), version: mismatchedVersion})
		release.tag_name = `v${mismatchedVersion}`
		release.assets[0].size = manifest.length
		release.assets[0].digest = `sha256:${createHash('sha256').update(manifest).digest('hex')}`
		for (const asset of release.assets)
			asset.browser_download_url = `https://github.com/${repository}/releases/download/${release.tag_name}/${asset.name}`
		await configureNetwork()
		await system.client.system.update.mutate({version: mismatchedVersion})
		await pWaitFor(
			async () => {
				let status
				try {
					await system.login()
					status = await system.client.system.updateStatus.query()
				} catch {
					return false
				}
				if (status.state?.phase === 'failed') throw new Error(status.state.error)
				return (
					status.state?.phase === 'rolled-back' && (await system.client.system.version.query()).version === oldVersion
				)
			},
			{interval: 3000, timeout: 600_000},
		)
		await expectApp()
		expect((await system.client.files.list.query({path: '/Home'})).files.map((file) => file.name)).toContain(
			'update-preserved.txt',
		)
	},
	1_200_000,
)
