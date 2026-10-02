import {readFile} from 'node:fs/promises'
import {afterAll, beforeAll, expect, test} from 'vitest'
import pRetry from 'p-retry'
import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

// Runs against the complete server in an isolated Linux development container.
let host: Awaited<ReturnType<typeof createTestUmbreld>>

beforeAll(async () => {
	host = await createTestUmbreld({autoLogin: true})
})

afterAll(async () => {
	await host?.cleanup()
})

test('browser uploads and indexed photos remain private to each account', async () => {
	const image = await readFile(new URL('../files/fixtures/thumbnails/master-lossless-image.png', import.meta.url))
	await expect(host.api.post('photos/upload?name=owner-photo.png', {body: image})).resolves.toMatchObject({
		body: {status: 'imported'},
	})
	const ownerItem = await pRetry(
		async () => {
			const page = await host.client.photos.items.list.query({filter: {query: 'owner-photo'}, limit: 10})
			expect(page.total).toBe(1)
			return page.items[0]!
		},
		{retries: 60, minTimeout: 250, maxTimeout: 250},
	)
	await host.api.post('files/upload?path=/Home/owner-only.txt', {body: 'owner data'})
	const password = 'member-test-password'
	const {userId} = await host.client.user.createUser.mutate({name: 'Photo Member', password})
	const login = await host.unauthenticatedApi.post<{result: {data: string}}>('../trpc/user.login', {
		json: {userId, password},
		responseType: 'json',
	})
	const token = login.body.result.data
	await host.setBrowserSession(token, login.headers['set-cookie'] ?? [])

	await expect(host.client.files.list.query({path: '/Home'})).rejects.toThrow('forbidden')
	await expect(host.client.photos.items.get.query({id: ownerItem.id})).rejects.toThrow()
	await expect(host.client.photos.items.list.query({filter: {query: 'owner-photo'}})).resolves.toMatchObject({total: 0})
	await expect(
		host.client.apps.importCompose.mutate({
			definition: 'services: {}',
			metadata: {
				id: 'forbidden',
				name: 'Forbidden',
				icon: 'https://example.com/icon.svg',
				description: 'Permission fixture',
				version: '1',
				category: 'Utilities',
			},
		}),
	).rejects.toThrow()
	await expect(host.client.appStore.addRepository.mutate({url: 'https://example.com/catalog.git'})).rejects.toThrow()

	await expect(host.api.post('photos/upload?name=member-photo.png', {body: image})).resolves.toMatchObject({
		body: {status: 'imported'},
	})
	await pRetry(
		async () => {
			const page = await host.client.photos.items.list.query({filter: {query: 'member-photo'}, limit: 10})
			expect(page.total).toBe(1)
		},
		{retries: 60, minTimeout: 250, maxTimeout: 250},
	)
	const memberHome = await host.client.files.list.query({path: `/Users/${userId}`})
	expect(memberHome.files.map((file) => file.name)).not.toContain('owner-only.txt')
	await host.login()
	await expect(host.client.photos.items.list.query({filter: {query: 'member-photo'}})).resolves.toMatchObject({
		total: 0,
	})
	await expect(host.client.photos.items.get.query({id: ownerItem.id})).resolves.toMatchObject({id: ownerItem.id})
})
