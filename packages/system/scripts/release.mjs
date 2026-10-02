import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {readFile, writeFile, stat} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const source = JSON.parse(
	await readFile(new URL('../../backend/source/modules/system/updates/source.json', import.meta.url), 'utf8'),
)
const names = {pi4: 'umbrelos-pi4', pi5: 'umbrelos-pi', arm64: 'umbrelos-arm64', amd64: 'umbrelos-amd64'}
export async function hashFile(file) {
	const hash = createHash('sha256')
	for await (const chunk of createReadStream(file)) hash.update(chunk)
	return hash.digest('hex')
}
export async function artifact(directory, target, version, bundleHash) {
	const name = names[target]
	if (!name || !/^sha512-256:[a-f0-9]{64}$/.test(bundleHash)) throw new Error('Invalid target or Rugix bundle hash')
	const file = `${name}.rugixb`
	const entry = {
		file,
		size: (await stat(path.join(directory, file))).size,
		sha256: await hashFile(path.join(directory, file)),
		bundleHash,
	}
	await writeFile(path.join(directory, `${file}.sha256`), `${entry.sha256}  ${file}\n`)
	await writeFile(
		path.join(directory, `${name}.update.json`),
		JSON.stringify({version, target, ...entry}, null, 2) + '\n',
	)
	return entry
}
export async function manifest(directory, version) {
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
		throw new Error('Published releases require a stable semantic version')
	const artifacts = {}
	for (const [target, name] of Object.entries(names)) {
		const entry = JSON.parse(await readFile(path.join(directory, `${name}.update.json`), 'utf8'))
		const {version: builtVersion, target: builtTarget, ...item} = entry
		if (builtVersion !== version || builtTarget !== target || item.file !== `${name}.rugixb`)
			throw new Error(`Mismatched release artifact: ${target}`)
		if (!/^sha512-256:[a-f0-9]{64}$/.test(item.bundleHash)) throw new Error(`Invalid bundle hash: ${target}`)
		if (
			item.sha256 !== (await hashFile(path.join(directory, item.file))) ||
			item.size !== (await stat(path.join(directory, item.file))).size
		)
			throw new Error(`Corrupt release artifact: ${target}`)
		artifacts[target] = item
	}
	const result = {
		format: 1,
		repository: source.repository,
		version,
		protocol: source.protocol,
		dataVersion: source.dataVersion,
		artifacts,
	}
	await writeFile(path.join(directory, 'system-release.json'), JSON.stringify(result, null, 2) + '\n')
	return result
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [command, directory, ...args] = process.argv.slice(2)
	if (command === 'artifact') await artifact(directory, ...args)
	else if (command === 'manifest') await manifest(directory, ...args)
	else throw new Error('Expected artifact or manifest')
}
