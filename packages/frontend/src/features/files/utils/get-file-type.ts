import {FILE_TYPE_MAP, type FileType} from '@/features/files/constants'
import type {FileSystemItem} from '@/features/files/types'

// Match previews, icons, and type labels without reading file contents.
// Ambiguous .ts filenames default to TypeScript; the text viewer validates
// UTF-8 and rejects binary data before allowing edits.
const textExtensions = new Set([
	'txt',
	'md',
	'markdown',
	'csv',
	'tsv',
	'log',
	'json',
	'jsonc',
	'jsonl',
	'ndjson',
	'yaml',
	'yml',
	'toml',
	'ini',
	'conf',
	'cfg',
	'env',
	'xml',
	'html',
	'htm',
	'css',
	'js',
	'jsx',
	'mjs',
	'cjs',
	'ts',
	'tsx',
	'sh',
	'bash',
	'zsh',
	'py',
	'sql',
])

export function getFileType(item: Pick<FileSystemItem, 'name' | 'type'>) {
	const mimeType = item.type.split(';')[0].trim().toLowerCase()
	const definition = FILE_TYPE_MAP[mimeType as FileType]
	if (!mimeType.includes('/') || definition?.viewer) return definition

	const extension = item.name.slice(item.name.lastIndexOf('.') + 1).toLowerCase()
	if (mimeType === 'application/octet-stream' && extension === 'webp') return FILE_TYPE_MAP['image/webp']
	if (
		mimeType.startsWith('text/') ||
		/^application\/[\w.+-]+\+(?:json|xml)$/.test(mimeType) ||
		textExtensions.has(extension)
	)
		return FILE_TYPE_MAP['text/plain']
	return definition
}
