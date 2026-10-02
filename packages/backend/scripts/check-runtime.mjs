import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import path from 'node:path'

// Run from the deployed package after its temporary build workspace is removed.
const require = createRequire(import.meta.url)
const executable = path.resolve(import.meta.dirname, '../umbreld')
assert.match(execFileSync(executable, ['--help'], {encoding: 'utf8', timeout: 15_000}), /Usage/)

const Database = require('better-sqlite3')
const database = new Database(':memory:')
try {
	assert.equal(database.prepare('SELECT 1 AS value').get().value, 1)
} finally {
	database.close()
}

const {spawn} = require('node-pty')
const terminal = spawn('/bin/sh', ['-c', 'printf panel-runtime-ready'], {name: 'xterm', cols: 80, rows: 24})
let output = ''
terminal.onData((data) => (output += data))
await new Promise((resolve, reject) => {
	const timeout = setTimeout(() => {
		terminal.kill()
		reject(new Error('Production terminal did not exit'))
	}, 10_000)
	terminal.onExit(({exitCode}) => {
		clearTimeout(timeout)
		try {
			assert.equal(exitCode, 0)
			assert.match(output, /panel-runtime-ready/)
			resolve()
		} catch (error) {
			reject(error)
		}
	})
})

console.log('Production CLI, SQLite, and terminal checks passed.')
