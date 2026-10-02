import {X509Certificate} from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import os from 'node:os'
import path from 'node:path'
import {execa} from 'execa'
import fse from 'fs-extra'
import yaml from 'js-yaml'
import pRetry from 'p-retry'
import {afterAll, beforeAll, expect, test} from 'vitest'
import {createTestVm} from '../test-utilities/create-test-umbreld.js'

type Connection = {port: number; ca?: string; servername?: string; expectedIdentity?: string; timeout?: number}
let umbreld: Awaited<ReturnType<typeof createTestVm>>
let directory: string
beforeAll(async () => {
	directory = await fse.mkdtemp(path.join(os.tmpdir(), 'panel-app-tls-'))
	umbreld = await createTestVm({device: 'umbrel-home', forwardPorts: [{guestPort: 4002}, {guestPort: 443}]})
})
afterAll(async () => {
	try {
		await umbreld?.cleanup()
	} finally {
		if (directory) await fse.remove(directory)
	}
})

test('preserves application-owned TLS on a Compose-published port across restart and reboot', async () => {
	await execa('openssl', [
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-nodes',
		'-sha256',
		'-days',
		'2',
		'-subj',
		'/CN=app.example',
		'-addext',
		'subjectAltName=DNS:app.example',
		'-keyout',
		`${directory}/key.pem`,
		'-out',
		`${directory}/cert.pem`,
	])
	const certificate = await fse.readFile(`${directory}/cert.pem`, 'utf8')
	const key = await fse.readFile(`${directory}/key.pem`, 'utf8')
	const server = `
const fs = require('node:fs')
require('node:https').createServer({cert: fs.readFileSync('/cert.pem'), key: fs.readFileSync('/key.pem')},
  (request, response) => response.end('Application TLS')).listen(4002, '0.0.0.0')
`
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
	await umbreld.client.apps.importCompose.mutate({
		metadata: {
			id: 'application-tls',
			name: 'Application TLS',
			icon: 'https://example.com/icon.svg',
			description: 'VM fixture',
			version: '1',
			category: 'Utilities',
		},
		definition: yaml.dump({
			services: {
				server: {
					image: 'node:22-alpine',
					command: ['node', '-e', server],
					ports: ['4002:4002'],
					configs: ['cert.pem', 'key.pem'],
					restart: 'unless-stopped',
				},
			},
			configs: {'cert.pem': {content: certificate}, 'key.pem': {content: key}},
		}),
	})
	const expectTls = async () => {
		await pRetry(
			async () => {
				const response = await request({port: umbreld.vm.getHostPort(4002), ca: certificate, servername: 'app.example'})
				expect(response.status).toBe(200)
				expect(response.body).toBe('Application TLS')
				expect(response.fingerprint).toBe(new X509Certificate(certificate).fingerprint256)
			},
			{retries: 30, minTimeout: 500, maxTimeout: 1000},
		)
	}
	await expectTls()
	const panelCa = (await umbreld.client.lanIngress.getCertificateStatus.query()).caCertificate
	const dashboard = await request({port: umbreld.vm.getHostPort(443), ca: panelCa, servername: 'umbrel.local'})
	expect(dashboard.status).toBe(200)
	expect(dashboard.fingerprint).not.toBe(new X509Certificate(certificate).fingerprint256)
	await umbreld.client.apps.restart.mutate({appId: 'application-tls'})
	await expectTls()
	await umbreld.vm.powerOff()
	await umbreld.vm.powerOn()
	await umbreld.login()
	await expectTls()
	await umbreld.client.apps.uninstall.mutate({appId: 'application-tls'})
	await expect(
		request({port: umbreld.vm.getHostPort(4002), ca: certificate, servername: 'app.example', timeout: 1500}),
	).rejects.toThrow()
})

function tlsOptions({ca, servername, expectedIdentity}: Connection): tls.ConnectionOptions {
	return {
		ca,
		servername,
		...(expectedIdentity
			? {checkServerIdentity: (_name, certificate) => tls.checkServerIdentity(expectedIdentity, certificate)}
			: {}),
	}
}

function request(connection: Connection) {
	return new Promise<{status: number; body: string; fingerprint?: string}>((resolve, reject) => {
		const get = connection.ca ? https.get : http.get
		const request = get(
			{host: '127.0.0.1', port: connection.port, path: '/', agent: false, ...tlsOptions(connection)},
			(response) => {
				const fingerprint = connection.ca
					? (response.socket as tls.TLSSocket).getPeerCertificate().fingerprint256
					: undefined
				let body = ''
				response.setEncoding('utf8')
				response.on('data', (chunk) => (body += chunk))
				response.once('error', reject)
				response.once('end', () => resolve({status: response.statusCode!, body, fingerprint}))
			},
		)
		const timeout = setTimeout(() => request.destroy(new Error('App request timed out')), connection.timeout ?? 5000)
		request.once('close', () => clearTimeout(timeout))
		request.once('error', reject)
	})
}
