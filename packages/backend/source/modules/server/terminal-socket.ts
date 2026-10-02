import type http from 'node:http'

import {$} from 'execa'
import pty, {IPty} from 'node-pty'
import {WebSocket} from 'ws'

import type Umbreld from '../../index.js'
import type createLogger from '../utilities/logger.js'

export default function createTerminalWebSocketHandler({
	umbreld,
	logger,
}: {
	umbreld: Umbreld
	logger: ReturnType<typeof createLogger>
}) {
	return async function (ws: WebSocket, request: http.IncomingMessage) {
		let ptyProcess: IPty | undefined
		let socketClosed = false
		// Install cleanup before any asynchronous app/container lookup. Otherwise
		// an early disconnect can be missed and leave a later-spawned PTY orphaned.
		ws.once('close', () => {
			socketClosed = true
			ptyProcess?.kill()
		})

		try {
			const appId = new URL(`https://localhost/${request.url}`).searchParams.get('appId')
			const cols = Number(new URL(`https://localhost/${request.url}`).searchParams.get('cols'))
			const rows = Number(new URL(`https://localhost/${request.url}`).searchParams.get('rows'))

			if (appId) {
				const app = await umbreld.apps.getApp(appId)
				const [manifest, compose] = await Promise.all([app.readManifest(), app.readCompose()])
				const service =
					manifest.defaultShell ?? Object.keys(compose.services ?? {}).find((name) => name !== 'app_proxy')
				const container = service ? compose.services?.[service]?.container_name : undefined
				if (!container) throw new Error('Application has no running container')
				if (socketClosed || ws.readyState !== WebSocket.OPEN) return

				// Launch terminal with interactive docker shell
				// We set a consistent '$ ' prompt across different containers regardless of the shell environment (bash or sh)
				// by overriding any existing PS1 settings.
				// We prioritize bash for better feature support but fall back to sh if bash is not available.
				// We disable bashrc with `--norc` to make sure the prompt isn't overridden.
				ptyProcess = pty.spawn(
					'docker',
					[
						'exec',
						'-it',
						container,
						'/bin/sh',
						'-c',
						`
						export PS1='$ '
						if command -v bash >/dev/null 2>&1; then
							exec bash --norc
						else
							exec sh
						fi
						`,
					],
					{
						name: 'xterm-color',
						cols,
						rows,
					},
				)
			} else {
				// Get username of first non-root user on the system
				const {stdout: username} = await $`id -nu 1000`
				if (socketClosed || ws.readyState !== WebSocket.OPEN) return
				// launch terminal with non-root user
				ptyProcess = pty.spawn(
					'sudo',
					['--user', username, '--login', 'bash', '-c', 'if [ -f /etc/motd ]; then cat /etc/motd; fi; exec bash'],
					{
						name: 'xterm-color',
						cols,
						rows,
					},
				)
			}
			// Stream output from the shell to the WebSocket
			ptyProcess.onData((data) => {
				if (ws.readyState === WebSocket.OPEN) ws.send(data)
			})

			// A hostile peer can continue delivering buffered frames after a graceful
			// close begins. Never write terminal input unless the socket is fully open.
			ws.on('message', (data) => {
				if (ws.readyState === WebSocket.OPEN) ptyProcess?.write(data.toString())
			})
		} catch (error) {
			logger.error(`Terminal socket`, error)
			if (ws.readyState === WebSocket.OPEN) ws.close()
		}
	}
}
