import {useEffect, useRef} from 'react'
import {useTranslation} from 'react-i18next'
import {Link} from 'react-router-dom'

import {Layout, primaryButtonProps} from '@/layouts/bare/shared'
import {useOnboardingDevice} from '@/routes/onboarding/use-onboarding-device'
import {trpcReact} from '@/trpc/trpc'

export default function AccountCreated() {
	const {t} = useTranslation()
	const continueLinkRef = useRef<HTMLAnchorElement>(null)
	const device = useOnboardingDevice()

	const getQuery = trpcReact.user.get.useQuery()

	// Grab the first name
	const name = getQuery.data?.name?.split(' ')[0]

	useEffect(() => {
		continueLinkRef.current?.focus()
	}, [])

	if (!name) {
		return null
	}

	return (
		<Layout
			title={t('onboarding.account-created.youre-all-set-name', {name})}
			subTitle={null}
			subTitleMaxWidth={630}
			subTitleClassName='text-white/50'
			showLogo={!device.showDevice}
		>
			{device.showDevice && device.image && (
				<>
					<img src={device.image} alt='Umbrel device' className={device.imageClassName} />
					<p className='-mt-4 text-[13px] font-medium text-white/30'>{device.name}</p>
				</>
			)}

			<Link
				data-testid='to-desktop'
				to='/'
				viewTransition
				ref={continueLinkRef}
				className={`mt-4 ${primaryButtonProps.className}`}
				style={primaryButtonProps.style}
			>
				{t('onboarding.launch-umbrelos')}
			</Link>
		</Layout>
	)
}
