import path from 'node:path'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, {reactCompilerPreset} from '@vitejs/plugin-react'
import {defineConfig} from 'vite'
import {imagetools} from 'vite-imagetools'

// https://vitejs.dev/config/

export default defineConfig({
	plugins: [
		tailwindcss(),
		// React Compiler automatically memoizes components, hooks, and expressions
		// at build time. No need to manually add useMemo/useCallback/React.memo.
		// useMemo/useCallback can still be used as escape hatches for precise control.
		// If a component behaves unexpectedly, add "use no memo" directive to opt it out.
		react(),
		babel({presets: [reactCompilerPreset()]}),
		imagetools({
			// Currently we only convert SVGs in features/files/assets/file-items-thumbnails
			include: /src\/features\/files\/assets\/file-items-thumbnails\/[^?]+\.svg(\?.*)?$/,
		}),
	],
	// Development containers use mDNS names. Keep Vite's host check enabled
	// while allowing those names alongside its default localhost and IP support.
	server: {
		host: '127.0.0.1',
		allowedHosts: ['.local'],
	},
	resolve: {
		alias: {
			'@/': `${path.resolve(import.meta.dirname, 'src')}/`,
		},
	},
	build: {
		rolldownOptions: {
			output: {
				minifyInternalExports: true,
				codeSplitting: {
					groups: [
						{name: 'react', test: /node_modules\/(?:react|react-dom|scheduler)\//},
						{name: 'i18n', test: /node_modules\/(?:i18next(?:-[^/]+)?|react-i18next)\//},
						{name: 'fetch', test: /node_modules\/(?:@tanstack\/react-query|@trpc\/(?:react-query|client))\//},
						{name: 'css', test: /node_modules\/(?:tailwind-merge|clsx)\//},
						{name: 'reactRouter', test: /node_modules\/react-router(?:-dom)?\//},
						{name: 'dev', test: /node_modules\/(?:@tanstack\/react-query-devtools|react-json-tree)\//},
						{name: 'colorThief', test: /node_modules\/colorthief\//},
					],
				},
			},
		},
	},
})
