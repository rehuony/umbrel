import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useSearchParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {BareCoverMessage} from '@/components/ui/cover-message'
import {EnsureLoggedIn} from '@/modules/auth/ensure-logged-in'
import {trpcClient} from '@/trpc/trpc'

function ApplicationHandoff() {
	const {t} = useTranslation()
	const [params] = useSearchParams()
	const request = params.get('request') ?? ''
	const pending = useRef<
		{request: string; result: ReturnType<typeof trpcClient.apps.authorizeAccess.mutate>} | undefined
	>(undefined)
	const [error, setError] = useState('')
	useEffect(() => {
		let active = true
		setError('')
		// StrictMode may replay effects; issue only one handoff for this request.
		if (pending.current?.request !== request)
			pending.current = {request, result: trpcClient.apps.authorizeAccess.mutate({request})}
		void pending.current.result
			.then(({url, params}) => {
				if (!active) return
				const callback = new URL(url)
				callback.search = new URLSearchParams(params).toString()
				window.location.replace(callback.toString())
			})
			.catch((cause: unknown) => {
				if (active) setError(cause instanceof Error ? cause.message : t('auth.failed-checking-if-user-logged-in'))
			})
		return () => {
			active = false
		}
	}, [request, t])

	return (
		<BareCoverMessage delayed={!error}>
			{error ? (
				<div className='flex max-w-md flex-col items-center gap-4 px-6 text-center'>
					<p role='alert'>{error}</p>
					<Button onClick={() => window.location.replace('/')}>{t('external-access.home')}</Button>
				</div>
			) : (
				t('auth.checking-backend-for-user')
			)}
		</BareCoverMessage>
	)
}

export default function AppAccess() {
	return (
		<EnsureLoggedIn>
			<ApplicationHandoff />
		</EnsureLoggedIn>
	)
}
