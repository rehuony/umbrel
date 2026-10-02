// Optional remote release history never blocks the local application catalog.
export const REMOTE_TIMEOUT_MS = 3000

export function remoteJsonFetcher(url: string) {
	return async ({signal}: {signal?: AbortSignal} = {}): Promise<unknown> => {
		const timeoutSignal = AbortSignal.timeout(REMOTE_TIMEOUT_MS)
		const response = await fetch(url, {
			credentials: 'omit',
			referrerPolicy: 'no-referrer',
			signal: signal && 'any' in AbortSignal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
		})
		if (!response.ok) throw new Error(`Unexpected status ${response.status}`)
		if (!response.headers.get('content-type')?.includes('application/json')) {
			throw new Error('Unexpected content type')
		}
		return response.json()
	}
}
