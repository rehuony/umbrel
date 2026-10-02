import type BetterSqlite3 from 'better-sqlite3'

export const PHOTOS_SCHEMA_VERSION = 1
export const PHOTOS_MIGRATION_MODULE = 'panel-photos'
export class UnsupportedPhotosSchemaError extends Error {}

export function migratePhotos(database: BetterSqlite3.Database) {
	database.pragma('journal_mode = WAL')
	database.pragma('foreign_keys = ON')
	const initialize = database.transaction(() => {
		database.exec(
			`CREATE TABLE IF NOT EXISTS schema_migrations (module TEXT NOT NULL, version INTEGER NOT NULL, applied_at INTEGER NOT NULL, PRIMARY KEY(module, version));`,
		)
		const legacy = database.prepare("SELECT 1 FROM schema_migrations WHERE module = 'photos'").get()
		if (legacy)
			throw new UnsupportedPhotosSchemaError(
				'Existing Umbrel photo libraries are unsupported; use a new data directory',
			)
		const current = database
			.prepare('SELECT MAX(version) AS version FROM schema_migrations WHERE module = ?')
			.get(PHOTOS_MIGRATION_MODULE) as {version: number | null}
		if (current.version === PHOTOS_SCHEMA_VERSION) return
		if (current.version !== null) throw new UnsupportedPhotosSchemaError('Unsupported photo library version')
		database.exec(`CREATE TABLE photos_sources (
				id TEXT PRIMARY KEY,
				account_id TEXT NOT NULL,
				type TEXT NOT NULL CHECK (type IN ('umbrel')),
				name TEXT NOT NULL,
				scope_mode TEXT CHECK (scope_mode IN ('everything', 'everything-except', 'only')),
				scope_paths TEXT,
				last_import_at INTEGER,
				created_at INTEGER NOT NULL
			);

CREATE UNIQUE INDEX photos_sources_one_umbrel_per_account
				ON photos_sources(account_id) WHERE type = 'umbrel';

CREATE TABLE photos_content_state (
				account_id TEXT NOT NULL,
				content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
				source_id TEXT NOT NULL REFERENCES photos_sources(id) ON DELETE RESTRICT,
				is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
				imported_at INTEGER NOT NULL,
				source_created_at INTEGER, effective_taken_at INTEGER,
				PRIMARY KEY(account_id, content_hash)
			) WITHOUT ROWID;

CREATE INDEX photos_content_state_by_account
				ON photos_content_state(account_id, is_favorite, content_hash);

CREATE TABLE photos_albums (
				id TEXT PRIMARY KEY,
				account_id TEXT NOT NULL,
				name TEXT NOT NULL,
				cover_content_hash BLOB CHECK (cover_content_hash IS NULL OR length(cover_content_hash) = 32),
				created_at INTEGER NOT NULL
			);

CREATE INDEX photos_albums_by_account ON photos_albums(account_id, created_at, id);

CREATE TABLE photos_album_items (
				album_id TEXT NOT NULL REFERENCES photos_albums(id) ON DELETE CASCADE,
				content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
				added_at INTEGER NOT NULL,
				PRIMARY KEY(album_id, content_hash)
			) WITHOUT ROWID;

CREATE INDEX photos_content_state_by_effective_taken_at
					ON photos_content_state(account_id, effective_taken_at DESC, content_hash)
					WHERE effective_taken_at IS NOT NULL;

CREATE TABLE photos_projection_state (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					generation INTEGER NOT NULL
				);

CREATE TABLE photos_read_model_dirty_contents (
 account_id TEXT NOT NULL, content_hash BLOB NOT NULL,
 PRIMARY KEY(account_id, content_hash)
) WITHOUT ROWID;

CREATE TABLE photos_read_model_dirty_accounts (
 account_id TEXT PRIMARY KEY NOT NULL
) WITHOUT ROWID;

CREATE TRIGGER photos_read_model_photos_content_state_insert
			AFTER INSERT ON photos_content_state

			BEGIN
				INSERT INTO photos_read_model_dirty_contents VALUES (new.account_id , new.content_hash) ON CONFLICT DO NOTHING;
			END;

CREATE TRIGGER photos_read_model_photos_content_state_update
			AFTER UPDATE OF account_id, content_hash, is_favorite, imported_at, source_created_at, source_id ON photos_content_state
			WHEN old.account_id IS NOT new.account_id OR old.content_hash IS NOT new.content_hash OR old.is_favorite IS NOT new.is_favorite OR old.imported_at IS NOT new.imported_at OR old.source_created_at IS NOT new.source_created_at OR old.source_id IS NOT new.source_id
			BEGIN
				INSERT INTO photos_read_model_dirty_contents VALUES (old.account_id , old.content_hash) ON CONFLICT DO NOTHING;

				INSERT INTO photos_read_model_dirty_contents VALUES (new.account_id , new.content_hash) ON CONFLICT DO NOTHING;
			END;

CREATE TRIGGER photos_read_model_photos_content_state_delete
			AFTER DELETE ON photos_content_state

			BEGIN
				INSERT INTO photos_read_model_dirty_contents VALUES (old.account_id , old.content_hash) ON CONFLICT DO NOTHING;
			END;

CREATE TRIGGER photos_read_model_photos_sources_insert
			AFTER INSERT ON photos_sources

			BEGIN
				INSERT INTO photos_read_model_dirty_accounts VALUES (new.account_id ) ON CONFLICT DO NOTHING;
			END;

CREATE TRIGGER photos_read_model_photos_sources_delete
			AFTER DELETE ON photos_sources

			BEGIN
				INSERT INTO photos_read_model_dirty_accounts VALUES (old.account_id ) ON CONFLICT DO NOTHING;
			END;

CREATE TRIGGER photos_read_model_photos_sources_update
			AFTER UPDATE OF account_id, type, scope_mode, scope_paths ON photos_sources
			WHEN old.account_id IS NOT new.account_id OR old.type IS NOT new.type OR old.scope_mode IS NOT new.scope_mode OR old.scope_paths IS NOT new.scope_paths
			BEGIN
				INSERT INTO photos_read_model_dirty_accounts VALUES (old.account_id ) ON CONFLICT DO NOTHING;

				INSERT INTO photos_read_model_dirty_accounts VALUES (new.account_id ) ON CONFLICT DO NOTHING;
			END;`)
		database.exec('INSERT INTO photos_projection_state(id, generation) VALUES (1, 0)')
		database
			.prepare('INSERT INTO schema_migrations(module, version, applied_at) VALUES (?, ?, ?)')
			.run(PHOTOS_MIGRATION_MODULE, PHOTOS_SCHEMA_VERSION, Date.now())
	})
	initialize.immediate()
	return PHOTOS_SCHEMA_VERSION
}
