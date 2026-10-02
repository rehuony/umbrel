import {checkBoot, install} from './worker.js'
import {readState, saveState} from './state.js'

try {
	if (process.argv[2] === 'install') await install()
	else if (process.argv[2] === 'boot') await checkBoot()
	else if (process.argv[2] === 'failed') {
		const state = await readState()
		if (state && ['queued', 'downloading', 'verifying', 'installing'].includes(state.phase))
			await saveState({
				...state,
				phase: 'failed',
				error: 'The update service exited unexpectedly. See its system journal for details.',
			})
	} else throw new Error('Expected install or boot')
} catch (error) {
	console.error(error)
	process.exitCode = 1
}
