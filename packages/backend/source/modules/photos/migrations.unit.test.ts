import BetterSqlite3 from 'better-sqlite3'
import {expect, test} from 'vitest'
import {
	migratePhotos,
	PHOTOS_MIGRATION_MODULE,
	PHOTOS_SCHEMA_VERSION,
	UnsupportedPhotosSchemaError,
} from './migrations.js'

test('initializes a web photo library and keeps existing content on repeated startup', () => {
	const db = new BetterSqlite3(':memory:')
	try {
		migratePhotos(db)
		db.prepare(
			"INSERT INTO photos_sources(id, account_id, type, name, created_at) VALUES ('home', 'owner', 'umbrel', 'Home', 1)",
		).run()
		migratePhotos(db)
		expect(db.prepare('SELECT name FROM photos_sources').all()).toEqual([{name: 'Home'}])
		expect(db.prepare('SELECT version FROM schema_migrations WHERE module = ?').get(PHOTOS_MIGRATION_MODULE)).toEqual({
			version: PHOTOS_SCHEMA_VERSION,
		})
		expect(db.prepare("SELECT name FROM sqlite_schema WHERE name = 'photos_source_resources'").get()).toBeUndefined()
		expect(() =>
			db
				.prepare(
					"INSERT INTO photos_sources(id, account_id, type, name, created_at) VALUES ('phone', 'owner', 'iphone', 'Phone', 1)",
				)
				.run(),
		).toThrow()
	} finally {
		db.close()
	}
})

test('rejects an upstream photo database without modifying its data', () => {
	const db = new BetterSqlite3(':memory:')
	try {
		db.exec(
			"CREATE TABLE schema_migrations(module TEXT, version INTEGER, applied_at INTEGER); INSERT INTO schema_migrations VALUES ('photos', 9, 1); CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES ('keep');",
		)
		expect(() => migratePhotos(db)).toThrow(UnsupportedPhotosSchemaError)
		expect(db.prepare('SELECT value FROM marker').get()).toEqual({value: 'keep'})
		expect(db.prepare('SELECT module FROM schema_migrations').all()).toEqual([{module: 'photos'}])
	} finally {
		db.close()
	}
})
