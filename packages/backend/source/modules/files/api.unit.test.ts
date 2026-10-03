import {once} from 'node:events'
import {readFile, writeFile} from 'node:fs/promises'
import type {AddressInfo} from 'node:net'
import nodePath from 'node:path'
import {Readable} from 'node:stream'

import cookieParser from 'cookie-parser'
import express from 'express'
import got from 'got'
import {afterAll, beforeAll, describe, expect, test} from 'vitest'

import type Umbreld from '../../index.js'
import {OWNER_ACCOUNT_ID} from '../auth/auth.js'
import UploadDiskPreflight from '../server/upload-disk-preflight.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import fileApi, {publishUploadWithoutReplacing} from './api.js'

describe('file API authentication boundaries', () => {
	const directory = temporaryDirectory()
	let server: ReturnType<express.Express['listen']>
	let origin: string
	let uploadDirectory: string

	beforeAll(async () => {
		await directory.createRoot()
		const thumbnailDirectory = await directory.create()
		uploadDirectory = await directory.create()
		const systemPrincipal = {sessionId: 'system', accountId: OWNER_ACCOUNT_ID, actor: 'system'} as const
		const umbreld = {
			auth: {
				authenticateDashboardCredentials: async (token: string) => {
					if (token !== 'system-token') throw new Error('Invalid credential')
					return systemPrincipal
				},
				authenticate: async (token: string, audience: string) => {
					if (token !== 'system-token' || audience !== 'dashboard') throw new Error('Invalid credential')
					return systemPrincipal
				},
				authorizeHttpApi: async () => systemPrincipal,
			},
			files: {
				thumbnails: {thumbnailDirectory},
				virtualToSystemPath: async (path: string) => `${uploadDirectory}/${nodePath.basename(path)}`,
				authorizeWritableDestinationSystemPath: async (path: string) => {
					if (path.endsWith('/blocked.txt')) throw new Error('[cloud-read-only]')
					return path
				},
				systemToVirtualPath: (path: string) => `/Home/${nodePath.basename(path)}`,
				isInternalStorageVirtualPath: () => true,
				chownSystemPath: async () => {},
				fileIndex: {movePath: async () => {}},
				logger: {error: () => {}},
			},
		} as unknown as Umbreld

		const app = express()
		app.use(cookieParser())
		app.use(
			'/api/files',
			fileApi(
				umbreld,
				new UploadDiskPreflight({getAvailableBytes: async () => Number.MAX_SAFE_INTEGER, reserveBytes: 0}),
			),
		)
		server = app.listen(0, '127.0.0.1')
		await once(server, 'listening')
		origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	})

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
		await directory.destroyRoot()
	})

	test.each([
		['GET', '/api/files/thumbnail/missing'],
		['GET', '/api/files/download'],
		['GET', '/api/files/view'],
		['POST', '/api/files/upload'],
		['GET', '/api/files/future-route-without-an-auth-policy'],
	] as const)('%s %s is denied before its file handler runs', async (method, path) => {
		const response = await got(`${origin}${path}`, {method, throwHttpErrors: false})
		expect(response.statusCode).toBe(401)
	})

	test('even a valid credential cannot reach a route without an explicit auth policy', async () => {
		const response = await got(`${origin}/api/files/future-route-without-an-auth-policy`, {
			headers: {Authorization: 'Bearer system-token'},
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(401)
	})

	test.each([
		['GET', '/api/files/thumbnail/missing', 404],
		['GET', '/api/files/download', 400],
		['GET', '/api/files/view', 400],
		['POST', '/api/files/upload', 400],
	] as const)('the local system credential can reach %s %s', async (method, path, statusCode) => {
		const response = await got(`${origin}${path}`, {
			method,
			headers: {Authorization: 'Bearer system-token'},
			throwHttpErrors: false,
		})
		expect(response.statusCode).toBe(statusCode)
	})

	test('upload preserves the Cloud read-only policy error', async () => {
		const response = await got(`${origin}/api/files/upload?path=${encodeURIComponent('/Home/Cloud/blocked.txt')}`, {
			method: 'POST',
			headers: {Authorization: 'Bearer system-token'},
			body: 'blocked',
			throwHttpErrors: false,
		})

		expect(response.statusCode).toBe(400)
		expect(JSON.parse(response.body)).toEqual({error: '[cloud-read-only]'})
	})

	test('streams uploads larger than the write buffer and preserves download ranges', async () => {
		const block = Buffer.from(Array.from({length: 65536}, (_, index) => index % 251))
		const body = Buffer.concat(Array.from({length: 64}, () => block))
		const headers = {Authorization: 'Bearer system-token'}
		const response = await got
			.post(`${origin}/api/files/upload?path=/Home/stream.bin`, {
				headers: {...headers, 'content-length': String(body.length)},
				body: Readable.from(Array.from({length: 64}, () => block)),
			})
			.json()
		expect(response).toEqual({path: '/Home/stream.bin'})
		expect((await readFile(`${uploadDirectory}/stream.bin`)).equals(body)).toBe(true)
		const download = await got(`${origin}/api/files/download?path=/Home/stream.bin`, {headers}).buffer()
		expect(download.equals(body)).toBe(true)
		const partial = await got(`${origin}/api/files/download?path=/Home/stream.bin`, {
			headers: {...headers, Range: 'bytes=262100-262300'},
			responseType: 'buffer',
		})
		expect(partial.statusCode).toBe(206)
		expect(partial.body).toEqual(body.subarray(262100, 262301))
		expect(partial.headers['content-range']).toBe(`bytes 262100-262300/${body.length}`)
	})

	test('publishes without clobbering when the destination filesystem has no hard links', async () => {
		const testDirectory = await directory.create()
		const temporaryPath = `${testDirectory}/upload.tmp`
		const destinationPath = `${testDirectory}/photo.jpg`
		await writeFile(temporaryPath, 'photo bytes')
		const unsupportedLink = async () => {
			throw Object.assign(new Error('hard links unsupported'), {code: 'EOPNOTSUPP'})
		}

		await publishUploadWithoutReplacing(temporaryPath, destinationPath, {createLink: unsupportedLink})

		await expect(readFile(destinationPath, 'utf8')).resolves.toBe('photo bytes')
		await expect(readFile(temporaryPath)).rejects.toMatchObject({code: 'ENOENT'})
	})

	test('the hard-link fallback never replaces an existing destination', async () => {
		const testDirectory = await directory.create()
		const temporaryPath = `${testDirectory}/upload.tmp`
		const destinationPath = `${testDirectory}/photo.jpg`
		await Promise.all([writeFile(temporaryPath, 'new bytes'), writeFile(destinationPath, 'existing bytes')])
		const unsupportedLink = async () => {
			throw Object.assign(new Error('hard links unsupported'), {code: 'EOPNOTSUPP'})
		}

		await expect(
			publishUploadWithoutReplacing(temporaryPath, destinationPath, {createLink: unsupportedLink}),
		).rejects.toMatchObject({code: 'EEXIST'})
		await expect(readFile(destinationPath, 'utf8')).resolves.toBe('existing bytes')
		await expect(readFile(temporaryPath, 'utf8')).resolves.toBe('new bytes')
	})
})
