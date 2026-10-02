import {randomUUID} from 'node:crypto'
import pWaitFor from 'p-wait-for'
import {WebSocket} from 'ws'
import type {createTestVm} from './create-test-umbreld.js'

export async function runInTerminal(system: Awaited<ReturnType<typeof createTestVm>>, command: string, asRoot = false) {
	const ticket = await system.client.user.createWebSocketTicket.mutate({target: 'terminal'})
	const socket = new WebSocket(`ws://127.0.0.1:${system.vm.httpPort}/terminal?cols=160&rows=24&ticket=${ticket}`)
	const marker = `__terminal_${randomUUID().replaceAll('-', '')}__`
	const script = `printf %s ${Buffer.from(command).toString('base64')} | base64 -d | /bin/bash`
	const invocation = asRoot ? `printf '%s\\n' 'moneyprintergobrrr' | sudo -S -p '' /bin/bash -c "${script}"` : script
	let output = ''
	let socketError: Error | undefined
	socket.on('message', (data) => (output += data.toString()))
	socket.on('error', (error) => (socketError = error))
	try {
		await pWaitFor(
			() => {
				if (socketError) throw socketError
				return output.includes('umbrel@') && output.includes('$')
			},
			{interval: 100, timeout: 15_000},
		)
		socket.send(
			`terminal_output=$(${invocation} 2>&1); terminal_code=$?; printf '\\n${marker}%s:%s\\n' "$terminal_code" "$(printf %s "$terminal_output" | base64 -w0)"\r`,
		)
		const resultPattern = new RegExp(`${marker}(\\d+):([A-Za-z0-9+/=]*)[\\r\\n]`)
		await pWaitFor(
			() => {
				if (socketError) throw socketError
				return resultPattern.test(output)
			},
			{interval: 100, timeout: 60_000},
		).catch((error) => {
			throw new Error(`Guest terminal did not return a result: ${output.slice(-4000)}`, {cause: error})
		})
		const result = output.match(resultPattern)!
		const decoded = Buffer.from(result[2], 'base64').toString()
		if (result[1] !== '0') throw new Error(`Guest command failed (${result[1]}): ${decoded}`)
		return decoded
	} finally {
		socket.terminate()
	}
}
