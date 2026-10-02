import {SVGProps, useId} from 'react'

// The tapered body and raised lid use the same theme color and bevel as the other sidebar icons.
const BODY =
	'M2.25 5.5H13.75L12.85 13.25C12.7 14.55 11.7 15.4 10.4 15.4H5.6C4.3 15.4 3.3 14.55 3.15 13.25L2.25 5.5ZM5.7 7A0.65 0.65 0 0 0 5.05 7.7L5.45 12.7A0.65 0.65 0 0 0 6.75 12.6L6.35 7.6A0.65 0.65 0 0 0 5.7 7ZM10.3 7A0.65 0.65 0 0 0 9.65 7.6L9.25 12.6A0.65 0.65 0 0 0 10.55 12.7L10.95 7.7A0.65 0.65 0 0 0 10.3 7Z'

const LID =
	'M5.5 0.6H10.5A1.5 1.5 0 0 1 12 2.1V3H14A1 1 0 0 1 14 5H2A1 1 0 0 1 2 3H4V2.1A1.5 1.5 0 0 1 5.5 0.6ZM5.5 3H10.5V2.3A0.2 0.2 0 0 0 10.3 2.1H5.7A0.2 0.2 0 0 0 5.5 2.3V3Z'

export const TrashIcon = (props: SVGProps<SVGSVGElement>) => {
	const id = useId()
	return (
		<svg width={16} height={16} viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg' {...props}>
			<g filter={`url(#filter-${id})`}>
				<path fillRule='evenodd' clipRule='evenodd' d={BODY} fill='hsl(var(--color-brand))' />
				<path fillRule='evenodd' clipRule='evenodd' d={BODY} fill={`url(#gradient-${id})`} />
				<path fillRule='evenodd' clipRule='evenodd' d={LID} fill='hsl(var(--color-brand))' />
				<path fillRule='evenodd' clipRule='evenodd' d={LID} fill={`url(#gradient-${id})`} />
			</g>
			<defs>
				<filter
					id={`filter-${id}`}
					x='0.15'
					y='0.15'
					width='15.7'
					height='15.7'
					filterUnits='userSpaceOnUse'
					colorInterpolationFilters='sRGB'
				>
					<feFlood floodOpacity={0} result='BackgroundImageFix' />
					<feBlend mode='normal' in='SourceGraphic' in2='BackgroundImageFix' result='shape' />
					<feColorMatrix
						in='SourceAlpha'
						type='matrix'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
						result='hardAlpha'
					/>
					<feOffset dx='0.32' dy='0.32' />
					<feGaussianBlur stdDeviation='0.08' />
					<feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
					<feColorMatrix type='matrix' values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.25 0' />
					<feBlend mode='normal' in2='shape' result='innerShadowTop' />
					<feColorMatrix
						in='SourceAlpha'
						type='matrix'
						values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0'
						result='hardAlpha'
					/>
					<feOffset dx='-0.32' dy='-0.32' />
					<feGaussianBlur stdDeviation='0.16' />
					<feComposite in2='hardAlpha' operator='arithmetic' k2='-1' k3='1' />
					<feColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0' />
					<feBlend mode='normal' in2='innerShadowTop' result='innerShadowBottom' />
				</filter>
				<linearGradient id={`gradient-${id}`} x1='8' y1='0.5' x2='8' y2='15.4' gradientUnits='userSpaceOnUse'>
					<stop offset='0.315' stopOpacity={0} />
					<stop offset='0.965' stopOpacity={0.48} />
				</linearGradient>
			</defs>
		</svg>
	)
}
