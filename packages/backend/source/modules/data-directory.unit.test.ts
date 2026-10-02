import os from 'node:os'
import path from 'node:path'
import fse from 'fs-extra'
import {afterEach, expect, test, vi} from 'vitest'
import {DATA_FORMAT_FILE, initializeDataDirectory, prepareDataDirectory} from './data-directory.js'
const directories: string[] = []
const create = async () => {
	const dir = await fse.mkdtemp(path.join(os.tmpdir(), 'panel-data-'))
	directories.push(dir)
	return dir
}
afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => fse.remove(dir)))
})
test('initializes an empty directory and accepts its version on restart', async () => {
	const dir = await create()
	await initializeDataDirectory(dir)
	await fse.writeFile(`${dir}/user-data`, 'preserve')
	await initializeDataDirectory(dir)
	expect(await fse.readFile(`${dir}/user-data`, 'utf8')).toBe('preserve')
})
test('rejects old system data without altering it', async () => {
	const dir = await create()
	await fse.writeFile(`${dir}/umbrel.yaml`, 'user: existing')
	await expect(initializeDataDirectory(dir)).rejects.toThrow('no files were removed')
	expect(await fse.readFile(`${dir}/umbrel.yaml`, 'utf8')).toBe('user: existing')
	expect(await fse.pathExists(`${dir}/${DATA_FORMAT_FILE}`)).toBe(false)
})
test('rejects an unsupported future data format without resetting it', async () => {
	const dir = await create()
	await fse.writeJson(`${dir}/${DATA_FORMAT_FILE}`, {system: 'personal-panel', version: 2})
	await expect(initializeDataDirectory(dir)).rejects.toThrow('Unsupported')
	expect((await fse.readJson(`${dir}/${DATA_FORMAT_FILE}`)).version).toBe(2)
})

test('does not initialize a new system after an interrupted restore', async () => {
	const base = await create()
	const dir = `${base}/system`
	await fse.ensureDir(`${dir}-restore-pending`)
	await fse.writeFile(`${dir}-restore-pending/user-data`, 'preserve')
	await expect(prepareDataDirectory({dataDirectory: dir} as never)).rejects.toThrow('unfinished restore')
	expect(await fse.pathExists(dir)).toBe(false)
	expect(await fse.readFile(`${dir}-restore-pending/user-data`, 'utf8')).toBe('preserve')
})

test('activates a supported restore and keeps its user data', async () => {
	const base = await create()
	const dir = `${base}/system`
	await initializeDataDirectory(dir)
	await fse.writeFile(`${dir}/previous-user-data`, 'old')
	await initializeDataDirectory(`${dir}/import`)
	await fse.writeFile(`${dir}/import/restored-user-data`, 'restored')
	await prepareDataDirectory({dataDirectory: dir, version: '1', store: {get: async () => '1', set: vi.fn()}} as never)
	expect(await fse.readFile(`${dir}/restored-user-data`, 'utf8')).toBe('restored')
	expect(await fse.pathExists(`${dir}-before-restore`)).toBe(false)
	expect(await fse.pathExists(`${dir}-restore-pending`)).toBe(false)
})

test('refuses an unsupported imported backup before moving current data', async () => {
	const dir = await create()
	await initializeDataDirectory(dir)
	await fse.writeFile(`${dir}/user-data`, 'current')
	await fse.outputFile(`${dir}/import/umbrel.yaml`, 'legacy backup')
	await expect(prepareDataDirectory({dataDirectory: dir} as never)).rejects.toThrow('Unsupported')
	expect(await fse.readFile(`${dir}/user-data`, 'utf8')).toBe('current')
	expect(await fse.readFile(`${dir}/import/umbrel.yaml`, 'utf8')).toBe('legacy backup')
})
