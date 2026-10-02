import type BetterSqlite3 from 'better-sqlite3'
import {createDirectorySizes} from './directory-sizes.js'

import {photosIndexingSchema} from '../../photos/indexing-schema.js'

import {
	photosReadModelSchema,
	photosReadModelDirtySchema,
	photosReadModelIndexTriggers,
} from '../../photos/read-model-schema.js'

import {PHOTO_EXTENSIONS, VIDEO_EXTENSIONS} from '../../photos/types.js'

export type FileIndexMigration = {
	version: number
	up: (database: BetterSqlite3.Database) => void
}

export function foldSearchName(value: string) {
	return value.normalize('NFC').toLowerCase()
}

export function filenameStemSql(nameSql: string, extensions: string[]) {
	const extensionsByLength = new Map<number, string[]>()
	for (const extension of new Set(extensions)) {
		extensionsByLength.set(extension.length, [...(extensionsByLength.get(extension.length) ?? []), extension])
	}
	const branches = [...extensionsByLength]
		.toSorted(([left], [right]) => right - left)
		.map(
			([length, values]) =>
				`WHEN substr(lower(${nameSql}), -${length}) IN (${values.map((value) => `'${value}'`).join(', ')}) ` +
				`THEN substr(lower(${nameSql}), 1, length(${nameSql}) - ${length})`,
		)
		.join('\n\t\t\t')
	return `CASE ${branches} ELSE lower(${nameSql}) END`
}

export const fileIndexMigrations: FileIndexMigration[] = [
	{
		version: 1,
		up: (database) => {
			database.exec(`
				CREATE TABLE index_roots (
					id INTEGER PRIMARY KEY,
					virtual_path TEXT NOT NULL UNIQUE,
					system_path TEXT NOT NULL UNIQUE,
					owner_id TEXT NOT NULL,
					kind TEXT NOT NULL CHECK (kind IN ('home', 'trash', 'apps', 'machines')),
					search_enabled INTEGER NOT NULL CHECK (search_enabled IN (0, 1)),
					state TEXT NOT NULL DEFAULT 'warming' CHECK (state IN ('warming', 'ready', 'degraded')),
					scan_generation INTEGER NOT NULL DEFAULT 0,
					last_successful_scan_at INTEGER,
					last_error TEXT,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL
				);

				CREATE TABLE entries (
					id INTEGER PRIMARY KEY,
					root_id INTEGER NOT NULL REFERENCES index_roots(id) ON DELETE CASCADE,
					relative_path TEXT NOT NULL,
					name TEXT NOT NULL,
					type TEXT NOT NULL CHECK (type IN (
						'directory',
						'symbolic-link',
						'socket',
						'block-device',
						'character-device',
						'fifo',
						'file'
					)),
					size INTEGER NOT NULL,
					modified_ms INTEGER NOT NULL,
					hidden INTEGER NOT NULL CHECK (hidden IN (0, 1)),
					search_name TEXT NOT NULL DEFAULT '',
					search_name_folded TEXT NOT NULL DEFAULT '',
					device TEXT NOT NULL DEFAULT '',
					inode TEXT NOT NULL DEFAULT '',
					modified_ns TEXT NOT NULL DEFAULT '',
					ctime_ns TEXT NOT NULL DEFAULT '',
					thumbnail_identity_kind TEXT
					CHECK (thumbnail_identity_kind IN ('content', 'transient')),
					content_id INTEGER REFERENCES contents(id),
					hash_failure_count INTEGER NOT NULL DEFAULT 0,
					hash_retry_at INTEGER,
					hash_error TEXT,
					observed_at INTEGER,
					birthtime_ms INTEGER,
					UNIQUE(root_id, relative_path)
				);

				CREATE VIRTUAL TABLE entry_names_fts USING fts5(
					search_name,
					content = 'entries',
					content_rowid = 'id',
					tokenize = 'trigram',
					detail = 'none'
				);

				CREATE VIRTUAL TABLE entry_names_fts_vocab USING fts5vocab(entry_names_fts, 'row');

				CREATE TABLE contents (
					id INTEGER PRIMARY KEY,
					blake3 BLOB NOT NULL UNIQUE CHECK (length(blake3) = 32),
					size INTEGER NOT NULL,
					created_at INTEGER NOT NULL
				);

				CREATE TABLE thumbnail_variants (
					content_id INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
					variant TEXT NOT NULL,
					state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'failed')),
					failure_count INTEGER NOT NULL DEFAULT 0,
					retry_at INTEGER,
					last_error TEXT,
					created_at INTEGER,
					updated_at INTEGER NOT NULL,
					PRIMARY KEY(content_id, variant)
				) WITHOUT ROWID;

				CREATE TABLE transient_thumbnail_variants (
					entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
					variant TEXT NOT NULL,
					artifact_key TEXT NOT NULL CHECK (
						length(artifact_key) = 64 AND artifact_key = lower(artifact_key)
					),
					state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'failed')),
					failure_count INTEGER NOT NULL DEFAULT 0,
					last_error TEXT,
					created_at INTEGER,
					updated_at INTEGER NOT NULL,
					PRIMARY KEY(entry_id, variant)
				) WITHOUT ROWID;

				CREATE TABLE media_metadata (
					content_id INTEGER PRIMARY KEY REFERENCES contents(id) ON DELETE CASCADE,
					state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'failed')),
					kind TEXT CHECK (kind IN ('photo', 'video')),
					sub_kind TEXT CHECK (sub_kind IN ('live', 'panorama', 'screenshot', 'spherical')),
					taken_at INTEGER,
					taken_at_offset_minutes INTEGER,
					created_at INTEGER,
					width INTEGER,
					height INTEGER,
					duration_ms INTEGER,
					tint INTEGER,
					camera_make TEXT,
					camera_model TEXT,
					lens TEXT,
					focal_length TEXT,
					aperture TEXT,
					exposure TEXT,
					iso INTEGER,
					latitude REAL,
					longitude REAL,
					live_identifier TEXT,
					search_text TEXT NOT NULL DEFAULT '',
					failure_count INTEGER NOT NULL DEFAULT 0,
					retry_at INTEGER,
					last_error TEXT,
					updated_at INTEGER NOT NULL,
					altitude REAL,
					user_comment TEXT
				);

				CREATE VIRTUAL TABLE media_metadata_fts USING fts5(
					search_text,
					content = 'media_metadata',
					content_rowid = 'content_id',
					tokenize = 'trigram',
					detail = 'none'
				);

				CREATE TABLE photos_projection_state (
					id INTEGER PRIMARY KEY CHECK (id = 1),
					generation INTEGER NOT NULL
				);

				CREATE INDEX entries_by_root_visibility ON entries(root_id, hidden, id);

				CREATE INDEX entries_by_folded_search_name ON entries(root_id, search_name_folded);

				CREATE INDEX entries_by_content ON entries(content_id);

				CREATE INDEX thumbnail_variants_pending_work
					ON thumbnail_variants(variant, content_id)
					WHERE state = 'pending';

				CREATE INDEX thumbnail_variants_failed_work
					ON thumbnail_variants(variant, retry_at, content_id)
					WHERE state = 'failed';

				CREATE INDEX transient_thumbnail_variants_by_artifact
					ON transient_thumbnail_variants(variant, artifact_key);

				CREATE INDEX media_metadata_pending_work
					ON media_metadata(content_id) WHERE state = 'pending';

				CREATE INDEX media_metadata_failed_work
					ON media_metadata(retry_at, content_id) WHERE state = 'failed';

				CREATE INDEX media_metadata_by_live_identifier
					ON media_metadata(live_identifier, kind) WHERE live_identifier IS NOT NULL;

				CREATE INDEX entries_pending_content_hash
					ON entries(root_id, hash_retry_at, id)
					WHERE thumbnail_identity_kind = 'content' AND content_id IS NULL;

				CREATE INDEX entries_by_recent_modification
					ON entries(root_id, modified_ms DESC, id DESC)
					WHERE type = 'file' AND hidden = 0;

				CREATE TRIGGER entries_fts_insert AFTER INSERT ON entries BEGIN
					INSERT INTO entry_names_fts(rowid, search_name) VALUES (new.id, new.search_name);
				END;

				CREATE TRIGGER entries_fts_delete AFTER DELETE ON entries BEGIN
					INSERT INTO entry_names_fts(entry_names_fts, rowid, search_name)
					VALUES ('delete', old.id, old.search_name);
				END;

				CREATE TRIGGER entries_fts_update AFTER UPDATE OF search_name ON entries
				WHEN old.search_name IS NOT new.search_name BEGIN
					INSERT INTO entry_names_fts(entry_names_fts, rowid, search_name)
					VALUES ('delete', old.id, old.search_name);
					INSERT INTO entry_names_fts(rowid, search_name) VALUES (new.id, new.search_name);
				END;

				CREATE TRIGGER entries_transient_thumbnail_revision_update
				AFTER UPDATE OF thumbnail_identity_kind, device, inode, size, modified_ns ON entries
				WHEN old.thumbnail_identity_kind = 'transient' AND (
					new.thumbnail_identity_kind IS NOT old.thumbnail_identity_kind
					OR new.device IS NOT old.device
					OR new.inode IS NOT old.inode
					OR new.size IS NOT old.size
					OR new.modified_ns IS NOT old.modified_ns
				) BEGIN
					DELETE FROM transient_thumbnail_variants
					WHERE entry_id = new.id;
				END;

				CREATE TRIGGER media_metadata_fts_insert AFTER INSERT ON media_metadata BEGIN
					INSERT INTO media_metadata_fts(rowid, search_text) VALUES (new.content_id, new.search_text);
				END;

				CREATE TRIGGER media_metadata_fts_delete AFTER DELETE ON media_metadata BEGIN
					INSERT INTO media_metadata_fts(media_metadata_fts, rowid, search_text)
					VALUES ('delete', old.content_id, old.search_text);
				END;

				CREATE TRIGGER media_metadata_fts_update AFTER UPDATE OF search_text ON media_metadata
				WHEN old.search_text IS NOT new.search_text BEGIN
					INSERT INTO media_metadata_fts(media_metadata_fts, rowid, search_text)
					VALUES ('delete', old.content_id, old.search_text);
					INSERT INTO media_metadata_fts(rowid, search_text) VALUES (new.content_id, new.search_text);
				END;
				INSERT INTO photos_projection_state(id, generation) VALUES (1, 0);
			`)
			// Keep this expression aligned with the Live Photo resolver. Changing
			// the supported extensions requires a migration to rebuild the index.
			const fallbackStem = filenameStemSql('name', [...PHOTO_EXTENSIONS, ...VIDEO_EXTENSIONS])
			database.exec(`
				CREATE INDEX entries_by_photos_live_fallback ON entries(
					root_id,
					substr(relative_path, 1, length(relative_path) - length(name)),
					${fallbackStem}
				) WHERE type = 'file' AND hidden = 0 AND thumbnail_identity_kind = 'content';
			`)
			database.exec(photosReadModelSchema + photosReadModelDirtySchema + photosReadModelIndexTriggers())
			database.exec(photosIndexingSchema())
			createDirectorySizes(database)
		},
	},
]

export const FILE_INDEX_SCHEMA_VERSION = fileIndexMigrations.at(-1)?.version ?? 0

export async function migrateFileIndex(
	database: BetterSqlite3.Database,
	migrations: FileIndexMigration[] = fileIndexMigrations,
): Promise<number> {
	const tables = database
		.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
		.all() as Array<{name: string}>
	if (tables.length && !tables.some(({name}) => name === 'panel_schema_migrations')) {
		throw new Error('Unsupported legacy file index; use a new data directory. Existing data has not been removed.')
	}
	const ordered = [...migrations].sort((a, b) => a.version - b.version)
	const appliedRows = tables.length
		? (database.prepare('SELECT version FROM panel_schema_migrations ORDER BY version').all() as Array<{
				version: number
			}>)
		: []
	if (appliedRows.some(({version}, index) => version !== ordered[index]?.version)) {
		throw new Error('Unsupported file index schema version; existing data has not been removed.')
	}
	database.exec(`
		CREATE TABLE IF NOT EXISTS panel_schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at INTEGER NOT NULL
		)
	`)
	for (const migration of ordered.slice(appliedRows.length)) {
		database
			.transaction(() => {
				migration.up(database)
				database
					.prepare('INSERT INTO panel_schema_migrations(version, applied_at) VALUES (?, ?)')
					.run(migration.version, Date.now())
			})
			.immediate()
	}
	return ordered.at(-1)?.version ?? 0
}
