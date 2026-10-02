import nodePath from 'node:path'

import BetterSqlite3 from 'better-sqlite3'
import {expect, test} from 'vitest'

import {migrateFileIndex} from '../files/file-index/migrations.js'
import temporaryDirectory from '../utilities/temporary-directory.js'
import {photoLibraryCte} from './library-sql.js'
import {migratePhotos} from './migrations.js'
import PhotosRepository from './repository.js'

const hash = (value: number) => Buffer.from(value.toString(16).padStart(64, '0'), 'hex')
const id = (value: number) => hash(value).toString('hex')

async function fixture() {
	const temporary = temporaryDirectory()
	const directory = await temporary.create()
	const indexPath = nodePath.join(directory, 'index.db')
	const durablePath = nodePath.join(directory, 'umbrel.db')
	const durable = new BetterSqlite3(durablePath)
	migratePhotos(durable)
	durable.close()
	const open = () => {
		const database = new BetterSqlite3(indexPath)
		database.pragma('journal_mode = WAL')
		database.pragma('foreign_keys = ON')
		database.prepare('ATTACH DATABASE ? AS umbrel').run(durablePath)
		return database
	}
	let database = open()
	await migrateFileIndex(database)
	database.exec(`INSERT INTO index_roots(id,virtual_path,system_path,owner_id,kind,search_enabled,created_at,updated_at) VALUES
		(1,'/Home','/home','owner','home',1,1,1), (2,'/Trash','/trash','owner','trash',1,1,1),
		(3,'/Other/Home','/other','member','home',1,1,1), (4,'/Apps','/apps','owner','apps',1,1,1);`)
	let repository = new PhotosRepository()
	const add = (value: number, name: string, kind = 'photo', identifier: string | null = null, root = 1) => {
		database.prepare('INSERT INTO contents(id,blake3,size,created_at) VALUES (?,?,100,1)').run(value, hash(value))
		database
			.prepare(
				`INSERT INTO entries(root_id,relative_path,name,type,size,modified_ms,hidden,thumbnail_identity_kind,content_id,search_name,search_name_folded)
			VALUES (?,?,?,'file',100,1,0,'content',?,?,?)`,
			)
			.run(root, name, name, value, name, name.toLowerCase())
		database
			.prepare(
				`INSERT INTO media_metadata(content_id,state,kind,taken_at,width,height,duration_ms,live_identifier,updated_at)
			VALUES (?,'ready',?,1000,100,50,?,?,1)`,
			)
			.run(value, kind, kind === 'video' ? 3000 : null, identifier)
	}
	const assertProjection = () => {
		for (const account of ['owner', 'member']) {
			repository.summary(database, account)
			for (const [table, cte, order] of [
				['items', 'logical_items', 'content_hash,root_kind'],
				['locations', 'authorized_locations', 'content_hash,root_kind,entry_id,source_id'],
				['pairs', 'derived_live_pairs', 'still_hash'],
				['active_pairs', 'active_live_pairs', 'still_hash,root_kind'],
			]) {
				const columns = (database.prepare(`PRAGMA table_info(photos_library_${table})`).all() as Array<{name: string}>)
					.map(({name}) => name)
					.join(',')
				const expected = database
					.prepare(`${photoLibraryCte()} SELECT ${columns} FROM ${cte} ORDER BY ${order}`)
					.all(account)
				const actual = database
					.prepare(`SELECT ${columns} FROM photos_library_${table} WHERE account_id = ? ORDER BY ${order}`)
					.all(account)
				expect(actual, `${account}: ${table}`).toEqual(expected)
			}
			expect(
				database
					.prepare(
						`SELECT content_hash,effective_taken_at FROM umbrel.photos_content_state WHERE account_id = ? AND effective_taken_at IS NOT NULL ORDER BY content_hash`,
					)
					.all(account),
			).toEqual(
				database
					.prepare(
						`${photoLibraryCte()} SELECT content_hash,logical_taken_at AS effective_taken_at FROM logical_items WHERE root_kind = 'home' ORDER BY content_hash`,
					)
					.all(account),
			)
		}
		for (const schema of ['main', 'umbrel']) {
			for (const kind of ['contents', 'accounts'])
				expect(database.prepare(`SELECT * FROM ${schema}.photos_read_model_dirty_${kind}`).all()).toEqual([])
		}
	}
	return {
		get database() {
			return database
		},
		get repository() {
			return repository
		},
		add,
		assertProjection,
		reopen() {
			database.close()
			database = open()
			repository = new PhotosRepository()
		},
		async close() {
			database.close()
			await temporary.destroyRoot()
		},
	}
}

test('incremental Photos maintenance spans batches and rolls back with the authoritative mutation', async () => {
	const f = await fixture()
	try {
		f.database
			.transaction(() => {
				for (let value = 1; value <= 260; value++)
					f.add(
						value,
						`${value}.${value === 260 ? 'mov' : 'jpg'}`,
						value === 260 ? 'video' : 'photo',
						'large-component',
					)
			})
			.immediate()
		f.assertProjection()
		// All 259 stills depended on the removed motion. This exceeds a batch.
		f.database.exec('DELETE FROM entries WHERE content_id=260; DELETE FROM contents WHERE id=260;')
		let projected = 0
		f.database.function('hex', {deterministic: true}, (value: Buffer) => {
			projected++
			return value.toString('hex').toUpperCase()
		})
		f.repository.syncPendingChanges(f.database)
		// Count materialized rows rather than imposing a host-dependent time
		// limit. Each seed batch must not project the whole component again.
		expect(projected).toBeLessThanOrEqual(259 * 2)
		f.assertProjection()
		const before = f.repository.summary(f.database, 'owner')
		expect(() =>
			f.database
				.transaction(() => {
					f.database.exec('DELETE FROM entries WHERE content_id < 100')
					f.repository.summary(f.database, 'owner')
					throw new Error('abort')
				})
				.immediate(),
		).toThrow('abort')
		expect(f.repository.summary(f.database, 'owner')).toEqual(before)
		f.assertProjection()
	} finally {
		await f.close()
	}
})

test('Photos recovers split commits and pending changes across restart for every account', async () => {
	const f = await fixture()
	try {
		f.add(1, 'owner.jpg')
		f.add(2, 'member.jpg', 'photo', null, 3)
		f.assertProjection()
		f.repository.setFavorite(f.database, 'owner', [id(1)], true)
		f.database.exec('UPDATE media_metadata SET taken_at=3000,tint=77 WHERE content_id=2')
		f.reopen()
		f.assertProjection()
		for (const schema of ['main', 'umbrel']) {
			f.database.exec(
				`DELETE FROM photos_library_items; UPDATE ${schema}.photos_projection_state SET generation=generation+1`,
			)
			f.reopen()
			// Even an account-scoped synchronization must repair both sides.
			f.repository.syncAll(f.database, 'owner')
			f.assertProjection()
			expect(f.repository.getItem(f.database, 'owner', id(1))?.isFavorite).toBe(true)
		}
		// A new schema/index starts with initialized=0 even when both database
		// generation counters happen to match (including two zero counters).
		f.database.exec('DELETE FROM photos_library_items; UPDATE photos_read_model_state SET initialized=0')
		f.reopen()
		f.assertProjection()
	} finally {
		await f.close()
	}
})

test('startup refreshes 129 pending hashes without replacing unrelated library rows', async () => {
	const f = await fixture()
	try {
		f.database.transaction(() => {
			for (let value = 1; value <= 260; value++) f.add(value, `${value}.jpg`)
		})()
		f.assertProjection()
		f.database.exec('UPDATE media_metadata SET taken_at=2000 WHERE content_id <= 129')
		f.reopen()
		// A whole-account rebuild would touch these unaffected rows.
		f.database.exec(`CREATE TEMP TRIGGER forbid_unrelated_refresh BEFORE DELETE ON main.photos_library_items
			WHEN old.content_id > 129 BEGIN SELECT RAISE(ABORT, 'unrelated item refreshed'); END;`)
		f.repository.syncAll(f.database)
		expect(f.repository.getItem(f.database, 'owner', id(1))?.takenAt).toBe(2000)
		expect(f.repository.getItem(f.database, 'owner', id(260))?.takenAt).toBe(1000)
		f.assertProjection()
	} finally {
		await f.close()
	}
})

test('unrelated app entry changes do not dirty the Photos library', async () => {
	const f = await fixture()
	try {
		f.add(1, 'owner.jpg')
		f.assertProjection()
		f.add(2, 'app.jpg', 'photo', null, 4)
		f.database.exec('UPDATE entries SET modified_ms=2 WHERE root_id=4; DELETE FROM entries WHERE root_id=4')
		expect(f.database.prepare('SELECT * FROM photos_read_model_dirty_contents').all()).toEqual([])
		expect(f.database.prepare('SELECT * FROM photos_read_model_dirty_accounts').all()).toEqual([])
	} finally {
		await f.close()
	}
})

test('mixed Live Photo graph changes always match a fresh authoritative projection', async () => {
	const f = await fixture()
	try {
		for (let value = 1; value <= 16; value++)
			f.add(
				value,
				`group${Math.floor((value - 1) / 2)}.${value % 2 ? 'jpg' : 'mov'}`,
				value % 2 ? 'photo' : 'video',
				`id${value % 3}`,
			)
		f.assertProjection()
		let seed = 719
		const random = (max: number) => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
			return seed % max
		}
		for (let step = 0; step < 100; step++) {
			const value = random(16) + 1
			switch (random(6)) {
				case 0:
					f.database
						.prepare('UPDATE media_metadata SET live_identifier = ? WHERE content_id = ?')
						.run(random(2) ? `id${random(4)}` : null, value)
					break
				case 1:
					f.database.prepare('UPDATE entries SET hidden = ? WHERE content_id = ?').run(random(2), value)
					break
				case 2:
					f.database
						.prepare('UPDATE media_metadata SET state = ? WHERE content_id = ?')
						.run(random(2) ? 'ready' : 'failed', value)
					break
				case 3:
					f.database.prepare('UPDATE entries SET root_id = ? WHERE content_id = ?').run(random(3) + 1, value)
					break
				case 4:
					f.database
						.prepare('UPDATE media_metadata SET duration_ms = ? WHERE content_id = ?')
						.run(random(2) ? 3000 : 15000, value)
					break
				case 5:
					f.database
						.prepare('UPDATE media_metadata SET kind = ? WHERE content_id = ?')
						.run(random(2) ? 'photo' : 'video', value)
					break
			}
			f.assertProjection()
		}
	} finally {
		await f.close()
	}
})

test('an aborted first build can recreate its temporary staging tables', async () => {
	const f = await fixture()
	try {
		f.add(1, 'owner.jpg')
		expect(() =>
			f.database
				.transaction(() => {
					f.repository.syncPendingChanges(f.database)
					throw new Error('abort initialization')
				})
				.immediate(),
		).toThrow('abort initialization')
		expect(f.database.prepare('SELECT initialized FROM photos_read_model_state').get()).toEqual({initialized: 0})
		f.assertProjection()
	} finally {
		await f.close()
	}
})

test('changing root ownership backfills the new account before any stored reads', async () => {
	const f = await fixture()
	try {
		f.add(1, 'owner.jpg')
		f.add(2, 'member.jpg', 'photo', null, 3)
		f.assertProjection()
		f.database.exec("UPDATE index_roots SET owner_id='member' WHERE id=1")
		f.repository.syncPendingChanges(f.database)
		f.assertProjection()
		expect(f.repository.getItem(f.database, 'owner', id(1))).toBeUndefined()
		expect(f.repository.getItem(f.database, 'member', id(1))?.path).toBe('/Home/owner.jpg')
	} finally {
		await f.close()
	}
})
