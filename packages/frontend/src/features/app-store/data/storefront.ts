// Project-owned editorial content, resolved against the installed repository catalog.
// Recommendations cannot create apps or override their installable versions.

import {z} from 'zod'

import {buildAppDates, type AppDates} from '@/features/app-store/data/catalog'
import type {RegistryApp} from '@/trpc/trpc'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const boundedString = (max: number) => z.string().trim().min(1).max(max)

// Bound editorial configuration size before reconciling it with the catalog.
export const STOREFRONT_LIMITS = {
	sections: 32,
	sectionAppIds: 512,
	spotlightBanners: 24,
	categories: 64,
	categoryFeaturedAppIds: 24,
	appMetadata: 1024,
} as const

const appIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9-]+$/)

const appIdsSchema = z.array(appIdSchema).max(STOREFRONT_LIMITS.sectionAppIds)

// Banners ship with the dashboard and must never point to a remote feed.
const artworkUrlSchema = z.string().regex(/^\/assets\/app-store\/storefront\/[a-z0-9-]+\.webp$/)

// umbrelOS is dark-only, so artwork is a single image
const artworkSchema = z.object({
	dark: artworkUrlSchema,
})

const sectionBaseSchema = z.object({
	id: boundedString(64),
	title: boundedString(80),
})

const appListSectionSchema = sectionBaseSchema.extend({
	type: z.literal('app-list'),
	layout: z.enum(['grid', 'rail']),
	subtitle: boundedString(40).optional(),
	appIds: appIdsSchema,
})

// One section of banners. Each banner is a complete editorial composition
// (the app's icon, name and headline are part of the image), so all a banner
// needs is the app it opens and its artwork.
const spotlightSectionSchema = z.object({
	id: boundedString(64),
	type: z.literal('spotlight'),
	banners: z.array(z.object({appId: appIdSchema, artwork: artworkSchema})).max(STOREFRONT_LIMITS.spotlightBanners),
})

const categoryFeatureSectionSchema = sectionBaseSchema.extend({
	type: z.literal('category-feature'),
	categoryId: boundedString(64),
	description: boundedString(300),
	appIds: appIdsSchema,
	artwork: artworkSchema,
	// Which side of the artwork is clear enough to place copy on
	textSide: z.enum(['left', 'right']).default('left'),
})

const knownSectionSchema = z.discriminatedUnion('type', [
	appListSectionSchema,
	spotlightSectionSchema,
	categoryFeatureSectionSchema,
])

export type StorefrontSection = z.infer<typeof knownSectionSchema>

const storefrontSchema = z.object({
	schemaVersion: z.literal(1),
	// Sections are validated individually below so a single malformed or
	// unknown-typed section drops that section, not the whole feed
	sections: z.array(z.unknown()).max(STOREFRONT_LIMITS.sections),
	categories: z
		.array(
			z.object({
				id: boundedString(64),
				featuredAppIds: z.array(appIdSchema).max(STOREFRONT_LIMITS.categoryFeaturedAppIds),
			}),
		)
		.max(STOREFRONT_LIMITS.categories)
		.default([]),
	apps: z
		.array(
			z.object({
				id: appIdSchema,
				version: boundedString(64),
				createdAt: z.string().max(64).nullish(),
				updatedAt: z.string().max(64).nullish(),
			}),
		)
		.max(STOREFRONT_LIMITS.appMetadata)
		.default([]),
})

export type Storefront = {
	sections: StorefrontSection[]
	categories: {id: string; featuredAppIds: string[]}[]
	apps: z.infer<typeof storefrontSchema>['apps']
}

/**
 * Validates the bundled storefront configuration. Throws when the
 * envelope is malformed;
 * individual sections that are malformed or of an unknown future type are
 * dropped silently.
 */
export function parseStorefront(data: unknown): Storefront {
	const parsed = storefrontSchema.parse(data)

	const sections: StorefrontSection[] = []
	for (const rawSection of parsed.sections) {
		const section = knownSectionSchema.safeParse(rawSection)
		if (section.success) sections.push(section.data)
	}

	return {sections, categories: parsed.categories, apps: parsed.apps}
}

// ---------------------------------------------------------------------------
// Resolution against the local registry
// ---------------------------------------------------------------------------

export type SpotlightBanner = {app: RegistryApp; artwork: {dark: string}}

export type ResolvedSection =
	| {type: 'app-list'; id: string; layout: 'grid' | 'rail'; title: string; subtitle?: string; apps: RegistryApp[]}
	| {type: 'spotlight'; id: string; banners: SpotlightBanner[]}
	| {
			type: 'category-feature'
			id: string
			categoryId: string
			title: string
			description: string
			apps: RegistryApp[]
			artwork: {dark: string}
			textSide: 'left' | 'right'
	  }

export type ResolvedStorefront = {
	sections: ResolvedSection[]
	/** Up to 6 locally available featured apps per category id */
	featuredByCategory: Map<string, RegistryApp[]>
	/** Reconciled creation/update dates for locally available apps */
	dates: Map<string, AppDates>
}

/**
 * Resolves a parsed feed against the local registry. Missing apps are dropped,
 * ids are deduplicated, and sections without enough locally available content
 * disappear entirely rather than rendering half-broken.
 */
export function resolveStorefront(
	storefront: Storefront,
	localAppsKeyed: Record<string, RegistryApp>,
	localCategories: Record<string, readonly unknown[]> = {},
): ResolvedStorefront {
	const resolveApps = (appIds: readonly string[]) => {
		const resolved: RegistryApp[] = []
		const seen = new Set<string>()
		for (const appId of appIds) {
			if (seen.has(appId)) continue
			seen.add(appId)
			const app = localAppsKeyed[appId]
			if (app) resolved.push(app)
		}
		return resolved
	}

	const sections: ResolvedSection[] = []
	for (const section of storefront.sections) {
		if (section.type === 'app-list') {
			const apps = resolveApps(section.appIds)
			if (apps.length === 0) continue
			sections.push({...section, apps})
		} else if (section.type === 'spotlight') {
			// Banners for apps this device doesn't know are dropped, one per app
			const banners: SpotlightBanner[] = []
			const seen = new Set<string>()
			for (const banner of section.banners) {
				const app = localAppsKeyed[banner.appId]
				if (!app || seen.has(app.id)) continue
				seen.add(app.id)
				banners.push({app, artwork: banner.artwork})
			}
			if (banners.length === 0) continue
			sections.push({type: 'spotlight', id: section.id, banners})
		} else if (section.type === 'category-feature') {
			const apps = resolveApps(section.appIds)
			const categoryHasLocalApps = (localCategories[section.categoryId]?.length ?? 0) > 0
			if (apps.length === 0 || !categoryHasLocalApps) continue
			sections.push({...section, apps})
		}
	}

	const featuredByCategory = new Map<string, RegistryApp[]>()
	for (const category of storefront.categories) {
		const apps = resolveApps(category.featuredAppIds)
		if (apps.length > 0) featuredByCategory.set(category.id, apps)
	}

	return {
		sections,
		featuredByCategory,
		dates: buildAppDates(storefront.apps, localAppsKeyed),
	}
}
