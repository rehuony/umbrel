// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {Orb} from './orb'
import {orbPaletteFromHsl} from './orb-palette'
import {createOrbRenderer, type OrbRenderer} from './orb-renderer'

vi.mock('./orb-renderer', () => ({createOrbRenderer: vi.fn()}))
vi.mock('@/providers/wallpaper', () => ({useWallpaper: () => ({wallpaper: {}})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const palette = orbPaletteFromHsl('24 90% 50%')
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
let renderer: OrbRenderer
let media: {matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn>}

beforeEach(() => {
	media = {matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()}
	vi.stubGlobal('matchMedia', () => media)
	renderer = {
		setPalette: vi.fn(),
		setSize: vi.fn(),
		setEnergy: vi.fn(),
		pulse: vi.fn(),
		start: vi.fn(),
		stop: vi.fn(),
		frame: vi.fn(),
		dispose: vi.fn(),
	}
	vi.mocked(createOrbRenderer).mockReset().mockReturnValue(renderer)
	container = document.createElement('div')
	root = createRoot(container)
})
afterEach(() => {
	act(() => root.unmount())
	vi.unstubAllGlobals()
})

test('draws the stationary orb and redraws when hover animation stops', () => {
	act(() => root.render(<Orb size={20} palette={palette} live={false} />))
	expect(renderer.frame).toHaveBeenCalledOnce()
	expect(renderer.start).not.toHaveBeenCalled()
	act(() => root.render(<Orb size={20} palette={palette} live />))
	expect(renderer.start).toHaveBeenCalledOnce()
	act(() => root.render(<Orb size={20} palette={palette} live={false} />))
	expect(renderer.frame).toHaveBeenCalledTimes(2)
})

test('shows the palette fallback after a running renderer loses its context', () => {
	act(() => root.render(<Orb size={20} palette={palette} />))
	expect(container.querySelector('span')).toBeNull()
	const options = vi.mocked(createOrbRenderer).mock.calls[0][1]!
	act(() => options.onContextLost!())
	expect(container.querySelector('span')?.style.background).toContain('radial-gradient')
	expect(container.querySelector('.invisible')).not.toBeNull()
})

test('keeps a visible fallback when graphics initialization fails', () => {
	vi.mocked(createOrbRenderer).mockImplementation(() => {
		throw new Error('Graphics unavailable')
	})
	act(() => root.render(<Orb size={20} palette={palette} />))
	expect(container.querySelector('span')?.style.background).toContain('radial-gradient')
})

test('uses the static fallback for reduced motion and initializes graphics when re-enabled', () => {
	media.matches = true
	act(() => root.render(<Orb size={20} palette={palette} live={false} />))
	expect(createOrbRenderer).not.toHaveBeenCalled()
	expect(container.querySelector('span')).not.toBeNull()
	media.matches = false
	act(() => media.addEventListener.mock.calls[0][1]())
	expect(createOrbRenderer).toHaveBeenCalledOnce()
	expect(renderer.setPalette).toHaveBeenCalledWith(palette)
	expect(renderer.frame).toHaveBeenCalledOnce()
	expect(container.querySelector('span')).toBeNull()
})

test('initializes the size, palette and still frame after replacing the renderer', () => {
	act(() => root.render(<Orb size={20} palette={palette} live={false} seed={0} />))
	act(() => root.render(<Orb size={20} palette={palette} live={false} seed={1} />))
	expect(renderer.dispose).toHaveBeenCalledOnce()
	expect(renderer.setSize).toHaveBeenCalledTimes(2)
	expect(renderer.setPalette).toHaveBeenCalledTimes(2)
	expect(renderer.frame).toHaveBeenCalledTimes(2)
})
