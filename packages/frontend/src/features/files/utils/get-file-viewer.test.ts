// @vitest-environment jsdom
import {describe, expect, test, vi} from 'vitest'

import {FILE_TYPE_MAP} from '@/features/files/constants'

import {getFileType} from './get-file-type'
import {getFileViewer} from './get-file-viewer'

vi.mock('@/features/files/components/file-viewer/audio-viewer', () => ({AudioViewer: () => null}))

describe('file preview selection', () => {
	test.each([
		['notes.txt', 'text/plain'],
		['README.MD', 'text/markdown'],
		['table.csv', 'text/csv'],
		['table.tsv', 'text/tab-separated-values'],
		['settings.yaml', 'application/yaml'],
		['settings.ini', 'application/x-ini'],
		['query.sql', 'application/sql'],
		['component.tsx', 'application/octet-stream'],
		['module.ts', 'video/mp2t'],
		['module.d.ts', 'video/mp2t'],
		['response', 'application/problem+json'],
		['README', 'application/octet-stream'],
		['.env', 'application/octet-stream'],
		['notes.TXT', 'TEXT/PLAIN; charset=utf-8'],
		['page.html', 'text/html'],
	])('previews %s as text rather than downloading or executing it', (name, type) => {
		expect(getFileViewer({name, type})).toBe(FILE_TYPE_MAP['text/plain'].viewer)
	})

	test.each(['image/webp', 'IMAGE/WEBP; charset=binary', 'application/octet-stream'])('previews WebP with %s', (type) =>
		expect(getFileViewer({name: 'photo.WEBP', type})).toBe(FILE_TYPE_MAP['image/webp'].viewer),
	)

	test('preserves a supported MIME type instead of guessing from a conflicting filename', () => {
		expect(getFileViewer({name: 'document.txt', type: 'application/pdf'})).toBe(FILE_TYPE_MAP['application/pdf'].viewer)
	})

	test.each([
		['document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
		['archive.zip', 'application/zip'],
		['video.mts', 'video/mp2t'],
		['folder.md', 'directory'],
		['link.txt', 'symbolic-link'],
	])('does not treat %s as a text file', (name, type) => {
		expect(getFileViewer({name, type})).toBeUndefined()
	})
})

test.each(['module.ts', 'module.d.ts', 'MODULE.D.TS'])('uses the text icon and label for %s', (name) => {
	expect(getFileType({name, type: 'video/mp2t'})).toBe(FILE_TYPE_MAP['text/plain'])
})

test('retains media icons and unknown binary file icons', () => {
	expect(getFileType({name: 'video.mts', type: 'video/mp2t'})).toBe(FILE_TYPE_MAP['video/mp2t'])
	expect(getFileType({name: 'unknown.bin', type: 'application/octet-stream'})).toBeUndefined()
})
