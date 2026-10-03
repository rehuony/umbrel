import {execFile} from 'node:child_process'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {createServer, type Server} from 'node:http'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {promisify} from 'node:util'

import {expect, test} from 'vitest'

const CLIENT_ID = 'test-public-client'

const exec = promisify(execFile)
const binary = process.env.RCLONE_BINARY
const listen = async (server: Server) => {
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	return `http://127.0.0.1:${(server.address() as {port: number}).port}`
}
const close = (server: Server) =>
	new Promise<void>((resolve) => {
		server.closeAllConnections()
		server.close(() => resolve())
	})

// Explicitly opt in with the verified system binary. Cloud API requests are denied
// by a local proxy; this proves token renewal/persistence, not real cloud access.
test.skipIf(!binary).each(['dropbox', 'onedrive'])(
	'%s renews device tokens without a local secret and persists refreshed credentials',
	async (type) => {
		expect((await exec(binary!, ['version'])).stdout).toContain('rclone v1.75.1')
		const directory = await mkdtemp(join(tmpdir(), 'cloud-rclone-auth-'))
		const requests: {body: URLSearchParams; authorization?: string}[] = []
		const provider = createServer(async (req, res) => {
			let body = ''
			for await (const chunk of req) body += chunk
			requests.push({body: new URLSearchParams(body), authorization: req.headers.authorization})
			res.writeHead(200, {'content-type': 'application/json'})
			res.end(
				JSON.stringify({
					access_token: 'synthetic-access',
					token_type: 'Bearer',
					expires_in: 3600,
					refresh_token: `rotated-${requests.length}`,
				}),
			)
		})
		const proxy = createServer((_req, res) => res.writeHead(502).end())
		proxy.on('connect', (_req, socket) => socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'))
		try {
			const tokenUrl = `${await listen(provider)}/v1/token`
			const proxyUrl = await listen(proxy)
			const config = join(directory, 'rclone.conf')
			let refreshToken = 'initial-synthetic-refresh-token'
			for (let round = 1; round <= 2; round++) {
				const token = {
					access_token: 'expired',
					token_type: 'Bearer',
					refresh_token: refreshToken,
					expiry: '2000-01-01T00:00:00Z',
				}
				await writeFile(
					config,
					`[cloud]\ntype = ${type}\nclient_id = ${CLIENT_ID}\nclient_secret =\ntoken_url = ${tokenUrl}\ntoken = ${JSON.stringify(token)}\ndrive_id = synthetic-drive\ndrive_type = personal\nroot_folder_id = root\n`,
					{mode: 0o600},
				)
				await expect(
					exec(
						binary!,
						[
							'about',
							'cloud:',
							'--config',
							config,
							'--json',
							'--retries',
							'1',
							'--low-level-retries',
							'1',
							'--timeout',
							'2s',
							'--contimeout',
							'2s',
							'--log-level',
							'OFF',
						],
						{
							timeout: 15000,
							env: {PATH: process.env.PATH, HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl, NO_PROXY: '127.0.0.1'},
						},
					),
				).rejects.toThrow()
				expect(requests).toHaveLength(round)
				const request = requests.at(-1)!
				expect(request.body.get('refresh_token')).toBe(refreshToken)
				expect(request.body.get('client_secret') || '').toBe('')
				if (request.authorization) {
					expect(request.authorization).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:`).toString('base64')}`)
				} else expect(request.body.get('client_id')).toBe(CLIENT_ID)
				const saved = (await readFile(config, 'utf8')).match(/^token = (.+)$/m)![1]
				refreshToken = JSON.parse(saved).refresh_token
				expect(refreshToken).toBe(`rotated-${round}`)
			}
		} finally {
			await Promise.all([close(provider), close(proxy)])
			await rm(directory, {recursive: true, force: true})
		}
	},
)
