import {useRef} from 'react'
import {useMount} from 'react-use'

import {FadeInImg} from '@/components/ui/fade-in-img'
import {cn} from '@/lib/utils'
import {useWallpaper, WallpaperAvifSource, wallpapers, type Wallpaper} from '@/providers/wallpaper'

export function WallpaperGrid({className, scrollToActive = false}: {className?: string; scrollToActive?: boolean}) {
	const {wallpaper, setWallpaperId} = useWallpaper()
	return (
		<div className={cn('grid grid-cols-2 gap-2.5', className)}>
			{wallpapers.map((item, index) => (
				<WallpaperItem
					key={item.id}
					wallpaper={item}
					active={item.id === wallpaper.id}
					onSelect={() => setWallpaperId(item.id)}
					scrollToActive={scrollToActive}
					className='animate-in fill-mode-both fade-in motion-reduce:animate-none'
					style={{animationDelay: `${index * 20}ms`}}
				/>
			))}
		</div>
	)
}

function WallpaperItem({
	active,
	wallpaper,
	onSelect,
	className,
	style,
	scrollToActive,
}: {
	active?: boolean
	wallpaper: Wallpaper
	onSelect: () => void
	className?: string
	style?: React.CSSProperties
	scrollToActive: boolean
}) {
	const ref = useRef<HTMLButtonElement>(null)

	useMount(() => {
		if (!active || !scrollToActive) return
		ref.current?.scrollIntoView({block: 'center'})
	})

	return (
		<button
			type='button'
			ref={ref}
			aria-label={`Wallpaper ${wallpaper.id}`}
			aria-pressed={active}
			className={cn(
				'relative aspect-1.9 overflow-hidden rounded-10 bg-white/10 outline-hidden focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black',
				className,
			)}
			style={{
				...style,
			}}
			onClick={onSelect}
		>
			<picture>
				<WallpaperAvifSource wallpaper={wallpaper} tier='small' />
				<FadeInImg
					src={wallpaper.url}
					className='absolute inset-0 h-full w-full rounded-10 object-cover object-center'
				/>
			</picture>
			{/* Border */}
			<div
				className={cn(
					'absolute inset-0 rounded-10 border-4 transition-colors',
					active ? 'border-white' : 'border-transparent',
				)}
			/>
		</button>
	)
}
