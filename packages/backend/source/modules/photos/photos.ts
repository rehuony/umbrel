import type {PublishedFileRevision} from '../files/file-index-enrichment.js'
import {randomBytes} from 'node:crypto'
import type Umbreld from '../../index.js'
import type {PhotoFilter, PhotoScopeMode} from './types.js'

export default class Photos {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	#downloadTickets = new Map<string, {accountId: string; ids: string[]; expiresAt: number}>()

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.logger = umbreld.logger.createChildLogger('photos')
	}

	async createDownloadTicket(accountId: string, ids: string[]) {
		const uniqueIds = [...new Set(ids)]
		const resolved = await this.#umbreld.files.fileIndex.photosResolveItems(accountId, uniqueIds)
		if (resolved.length !== uniqueIds.length) throw new Error('[photos-item-not-found]')
		const now = Date.now()
		for (const [ticket, value] of this.#downloadTickets) {
			if (value.expiresAt <= now) this.#downloadTickets.delete(ticket)
		}
		const ticket = randomBytes(24).toString('base64url')
		this.#downloadTickets.set(ticket, {accountId, ids: uniqueIds, expiresAt: now + 60_000})
		return ticket
	}

	consumeDownloadTicket(accountId: string, ticket: string) {
		const value = this.#downloadTickets.get(ticket)
		if (!value || value.accountId !== accountId) return
		this.#downloadTickets.delete(ticket)
		if (value.expiresAt <= Date.now()) return
		return value.ids
	}

	summary(accountId: string) {
		return this.#umbreld.files.fileIndex.photosSummary(accountId)
	}

	indexingState(accountId: string) {
		return this.#umbreld.files.fileIndex.photosIndexingState(accountId)
	}

	listItems(accountId: string, filter: PhotoFilter, cursor: string | undefined, limit: number) {
		return this.#umbreld.files.fileIndex.photosListItems(accountId, filter, cursor, limit)
	}

	getItem(accountId: string, id: string, deleted = false) {
		return this.#umbreld.files.fileIndex.photosGetItem(accountId, id, deleted)
	}

	neighbors(accountId: string, id: string, filter: PhotoFilter) {
		return this.#umbreld.files.fileIndex.photosNeighbors(accountId, id, filter)
	}

	async setFavorite(accountId: string, ids: string[], favorite: boolean) {
		const changes = await this.#umbreld.files.fileIndex.photosSetFavorite(accountId, ids, favorite)
		if (changes) this.#changed(accountId)
		return changes
	}

	async deleteItems(accountId: string, ids: string[]) {
		const items = await this.#umbreld.files.fileIndex.photosResolveItemFiles(accountId, ids, 'home')
		for (const item of items) await this.#umbreld.files.trash(item.path, accountId, item.revision)
		if (items.length) this.#changed(accountId)
		return items.length
	}

	async restoreItems(accountId: string, ids: string[]) {
		const items = await this.#umbreld.files.fileIndex.photosResolveItemFiles(accountId, ids, 'trash')
		for (const item of items) await this.#umbreld.files.restore(item.path, {userId: accountId, waitForIndex: true})
		if (items.length) this.#changed(accountId)
		return items.length
	}

	async deletePermanently(accountId: string, ids?: string[]) {
		const items = await this.#umbreld.files.fileIndex.photosResolveItemFiles(accountId, ids, 'trash')
		if (items.length === 0) return 0
		const paths = [...new Set(items.map(({path}) => path))]
		const expectedRevisions = new Map(items.map(({path, revision}) => [path, revision]))
		const results = await this.#umbreld.files.deleteMany(paths, accountId, {waitForIndex: true, expectedRevisions})
		if (results.some((deleted) => !deleted)) throw new Error('[photos-delete-failed]')
		this.#changed(accountId)
		return results.length
	}

	listAlbums(accountId: string) {
		return this.#umbreld.files.fileIndex.photosListAlbums(accountId)
	}

	async createAlbum(accountId: string, name: string, ids?: string[]) {
		const album = await this.#umbreld.files.fileIndex.photosCreateAlbum(accountId, name, ids)
		this.#changed(accountId)
		return album
	}

	async renameAlbum(accountId: string, id: string, name: string) {
		const changes = await this.#umbreld.files.fileIndex.photosRenameAlbum(accountId, id, name)
		if (changes) this.#changed(accountId)
		return changes
	}

	async setAlbumCover(accountId: string, id: string, itemId?: string) {
		const changes = await this.#umbreld.files.fileIndex.photosSetAlbumCover(accountId, id, itemId)
		if (changes) this.#changed(accountId)
		return changes
	}

	async deleteAlbum(accountId: string, id: string) {
		const changes = await this.#umbreld.files.fileIndex.photosDeleteAlbum(accountId, id)
		if (changes) this.#changed(accountId)
		return changes
	}

	async addAlbumItems(accountId: string, id: string, ids: string[]) {
		const changes = await this.#umbreld.files.fileIndex.photosAddAlbumItems(accountId, id, ids)
		if (changes) this.#changed(accountId)
		return changes
	}

	async removeAlbumItems(accountId: string, id: string, ids: string[]) {
		const changes = await this.#umbreld.files.fileIndex.photosRemoveAlbumItems(accountId, id, ids)
		if (changes) this.#changed(accountId)
		return changes
	}

	listSources(accountId: string) {
		return this.#umbreld.files.fileIndex.photosListSources(accountId)
	}

	async updateSource(accountId: string, id: string, scope?: {mode: PhotoScopeMode; paths: string[]}) {
		const source = await this.#umbreld.files.fileIndex.photosUpdateSource(accountId, id, scope)
		if (source) {
			this.#changed(accountId)
			await this.#indexingProgress(accountId)
		}
		return source
	}

	async resolveItem(accountId: string, id: string) {
		return (await this.#umbreld.files.fileIndex.photosResolveItems(accountId, [id]))[0]
	}

	#changed(accountId: string) {
		this.#umbreld.eventBus.emit('photos:change', {accountIds: [accountId]})
	}

	async #indexingProgress(accountId: string) {
		try {
			const state = await this.indexingState(accountId)
			await this.#umbreld.eventBus.emit('photos:indexing-progress', {accountId, state})
		} catch (error) {
			// A progress notification is best-effort and must not turn a completed
			// source mutation into an API failure during file-index startup/recovery.
			this.logger.error('Failed to report Photos indexing progress', error)
		}
	}

	resolveLiveCompanion(accountId: string, id: string) {
		return this.#umbreld.files.fileIndex.photosResolveLiveCompanion(accountId, id)
	}

	async prepareUpload(accountId: string, hash: Buffer, albumId?: string) {
		const result = await this.#umbreld.files.fileIndex.photosPrepareUpload(accountId, hash, albumId)
		if (result.status === 'duplicate') this.#changed(accountId)
		return result.status
	}

	async registerUpload(
		accountId: string,
		systemPath: string,
		hash: Buffer,
		revision: PublishedFileRevision,
		albumId?: string,
	) {
		const result = await this.#umbreld.files.fileIndex.photosRegisterUpload(
			accountId,
			systemPath,
			hash,
			revision,
			albumId,
		)
		this.#changed(accountId)
		return result.status
	}
	async deleteAccount(accountId: string) {
		for (const [ticket, entry] of this.#downloadTickets) {
			if (entry.accountId === accountId) this.#downloadTickets.delete(ticket)
		}
	}

	async start() {
		await this.#umbreld.files.fileIndex.initializePhotos()
	}
	async stop() {}
}
