import fse from 'fs-extra'
import path from 'node:path'
import {z} from 'zod'
import type Umbreld from '../index.js'
import {writeFileDurably} from './utilities/durable-filesystem.js'

export const DATA_FORMAT_FILE = '.panel-data.json'
const DataFormat = z.object({system: z.literal('personal-panel'), version: z.literal(1)}).strict()

export async function assertDataDirectoryFormat(directory: string) {
	try {
		DataFormat.parse(await fse.readJson(path.join(directory, DATA_FORMAT_FILE)))
	} catch {
		throw new Error(
			`Unsupported system data in ${directory}. Use a fresh installation; existing data has been left untouched.`,
		)
	}
}

export async function initializeDataDirectory(directory: string) {
	await fse.ensureDir(directory)
	if (await fse.pathExists(path.join(directory, DATA_FORMAT_FILE))) return assertDataDirectoryFormat(directory)
	const entries = await fse.readdir(directory)
	if (entries.length > 0)
		throw new Error(
			`Unsupported system data in ${directory}. A new empty data directory is required; no files were removed.`,
		)
	const file = path.join(directory, DATA_FORMAT_FILE)
	await writeFileDurably(file, `${file}.tmp`, JSON.stringify({system: 'personal-panel', version: 1}))
}

export async function prepareDataDirectory(umbreld: Umbreld) {
	const directory = umbreld.dataDirectory
	const pending = `${directory}-restore-pending`
	const previousDirectory = `${directory}-before-restore`
	// Fail before creating a fresh directory when a previous activation was
	// interrupted. Both the original data and the staged restore remain recoverable.
	if ((await fse.pathExists(pending)) || (await fse.pathExists(previousDirectory)))
		throw new Error('An unfinished restore requires operator recovery; existing data has been left untouched')
	await initializeDataDirectory(directory)
	const restored = path.join(directory, 'import')
	if (await fse.pathExists(restored)) {
		await assertDataDirectoryFormat(restored)
		await fse.rename(restored, pending)
		await fse.rename(directory, previousDirectory)
		try {
			await fse.rename(pending, directory)
		} catch (error) {
			await fse.rename(previousDirectory, directory)
			throw error
		}
		// Activation is complete. The user's restore replaced the previous state.
		await fse.remove(previousDirectory)
	}
	const previous = await umbreld.store.get('version')
	if (previous && previous !== umbreld.version) await umbreld.store.set('previousVersion', previous)
	await umbreld.store.set('version', umbreld.version)
}
