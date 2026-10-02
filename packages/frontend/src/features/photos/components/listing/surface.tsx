import type {ReactNode} from 'react'

import {useIsMobile} from '@/hooks/use-is-mobile'

// The actions bar, in the scroller's coordinates: its height, the gap the
// listing keeps below it (PhotosLayout's gap-3), and how far above it the
// scroller starts — on desktop the bar sits in the sheet's close button's
// row, 10px under the sheet's top edge, and the listing starts at that edge
// (see ActionsBar's top margin and the sheet's top padding in
// layouts/sheet.tsx).
const BAR_HEIGHT = 44
const BAR_GAP = 12
const BAR_TOP = {mobile: 0, desktop: 10}
// Content starts this far below the bar — as far as the bar is from the
// sheet's top edge — and the fade completes there (see .umbrel-photos-scroller)
const FADE_TAIL = 10
// How far below that the bar rests until the listing scrolls: level with the
// sheet's title, as Files' bar is. It rides up with the content and pins at
// BAR_TOP (see .umbrel-photos-actions), driven by the scroller's scroll
// timeline — where a browser has none, it simply stays pinned
const BAR_DROP = 30
const scrollDriven =
	typeof CSS !== 'undefined' && CSS.supports('animation-timeline: scroll()') && CSS.supports('timeline-scope: --a')
export function useBarDrop() {
	return useIsMobile() || !scrollDriven ? 0 : BAR_DROP
}

// The bar's title sits on the bar's bottom edge the way a group header's
// title sits on its row's: a header hands its title to the bar the moment
// the two lines coincide. That is when the header row's top is this far
// above the bar's bottom — the bar's title ends 16px above it (the view line
// is beneath), a header's 8px above its row's bottom, 30px into its
// HEADER_HEIGHT (38px) row: 16 + 30.
const TITLE_HANDOFF = 46

// Where a listing's content sits under the bar floating over it, in the
// scroller's px: `inset` is where it starts (under the bar at rest); what
// scrolls up under the pinned bar dissolves between `fadeFrom` and `fadeTo`
// (see FadedScroller); a group whose header row's top reaches `handoff` is
// the one the bar names (see TimelineGrid)
export type Frame = {inset: number; fadeFrom: number; fadeTo: number; handoff: number}

// The box a listing fills, edge to edge: pulled up under the bar and, on
// desktop, out to the sheet's right edge (countering its padding: see
// layouts/sheet.tsx) and down to its bottom edge beneath the dock — content
// runs from the sidebar to the edge and the bar's controls float over it.
// Phones and tablets keep the sheet's padding on both sides. A flex column,
// so the box's negative top margin can't collapse through.
export function ListingSurface({children}: {children: (frame: Frame) => ReactNode}) {
	const isMobile = useIsMobile()
	const drop = useBarDrop()
	const barBottom = (isMobile ? BAR_TOP.mobile : BAR_TOP.desktop) + BAR_HEIGHT
	// Content is hidden up to the pinned bar's top and fades in through the
	// bar (so the glass controls have something to frost), complete just
	// after it; it starts that far under the bar at rest
	const fadeTo = barBottom + FADE_TAIL
	const frame: Frame = {
		fadeFrom: barBottom - BAR_HEIGHT,
		fadeTo,
		inset: fadeTo + drop,
		handoff: barBottom - TITLE_HANDOFF,
	}

	return (
		<div className='relative flex flex-col'>
			{/* Heights: the sheet's height minus where this box naturally starts,
			    plus the pull-up, so the box runs exactly to the sheet's bottom
			    edge, beneath the dock — a box past it makes the sheet's own
			    ScrollArea scrollable, and its scrollbar lands on top of the
			    grid's. Mobile: the sheet is 100dvh−(--sheet-top), bottom-anchored,
			    and above the box sit the column's pt-6, the 44px title row, the
			    gap-5 and the grid's mt-[-0.5rem] (80px; md's pt-12 and text-48
			    title add 28), plus the pull-up → 136/164. Desktop: sheet
			    100vh−60px, the box starts
			    66px down (bar 10+44, gap 12) plus the pull-up → 134. The right
			    margins mirror the sheet's md/xl padding (layouts/sheet.tsx). */}
			<div
				className='-mt-(--umbrel-photos-inset) h-[calc(100dvh-var(--sheet-top)-136px+var(--umbrel-photos-inset))] md:h-[calc(100dvh-var(--sheet-top)-164px+var(--umbrel-photos-inset))] lg:-mr-10 lg:h-[calc(100vh-134px+var(--umbrel-photos-inset))] xl:-mr-[60px]'
				style={{['--umbrel-photos-inset' as string]: `${barBottom + BAR_GAP}px`}}
			>
				{children(frame)}
			</div>
		</div>
	)
}

// The grid the photos would fill, sketched behind the timeline's stateful
// screens: faint rounded tiles fading out radially, so the message floats in
// the middle of an empty mosaic. Each tile carries one flat opacity from its
// distance to the centre — a gradient mask over a ~4% fill leaves so few
// 8-bit alpha levels that its steps show as contour rings inside the tiles.
// Inline SVG — a data: URI would trip the CSP.
const GHOST_TILE = 140
const GHOST_COLS = 15
const GHOST_ROWS = 11
export function GhostGrid() {
	const tiles = []
	for (let row = 0; row < GHOST_ROWS; row++) {
		for (let col = 0; col < GHOST_COLS; col++) {
			const dx = (col - (GHOST_COLS - 1) / 2) / (GHOST_COLS / 2)
			const dy = (row - (GHOST_ROWS - 1) / 2) / (GHOST_ROWS / 2)
			const fade = Math.max(0, 1 - Math.hypot(dx, dy) / 0.8)
			const opacity = fade ** 1.8 * 0.02
			if (opacity < 0.004) continue
			tiles.push(
				<rect
					key={`${col}-${row}`}
					x={col * GHOST_TILE + 3}
					y={row * GHOST_TILE + 3}
					width={GHOST_TILE - 6}
					height={GHOST_TILE - 6}
					rx={10}
					fillOpacity={opacity.toFixed(3)}
				/>,
			)
		}
	}
	return (
		<div aria-hidden className='pointer-events-none absolute inset-0 -z-10 overflow-hidden'>
			<svg
				width={GHOST_COLS * GHOST_TILE}
				height={GHOST_ROWS * GHOST_TILE}
				className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 fill-white'
			>
				{tiles}
			</svg>
		</div>
	)
}
