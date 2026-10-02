// @vitest-environment jsdom

import {describe, expect, test} from 'vitest'

import {withDialog, withoutDialog} from './dialog'

const search = (query: string) => new URLSearchParams(query)

describe('dialog slot', () => {
	test('closing takes the dialog and its prefixed params, and leaves the page its own', () => {
		expect(withoutDialog(search('sort=name&dialog=photos-source&photos-source-id=example')).toString()).toBe(
			'sort=name',
		)
	})

	test('closing takes the unprefixed aliases a dialog owns', () => {
		expect(withoutDialog(search('dialog=app-settings&app=jellyfin&view=storage&sort=name')).toString()).toBe(
			'sort=name',
		)
	})

	test('a param belongs to a dialog only while that dialog is open', () => {
		expect(withoutDialog(search('app=jellyfin&photos-source-id=example')).toString()).toBe(
			'app=jellyfin&photos-source-id=example',
		)
		expect(withoutDialog(search('dialog=logout&photos-source-id=example')).toString()).toBe('photos-source-id=example')
	})

	test('opening names its params by the dialog, or by their alias', () => {
		expect(withDialog(search(''), 'photos-source', {id: 'example'}).toString()).toBe(
			'dialog=photos-source&photos-source-id=example',
		)
		expect(withDialog(search(''), 'app-settings', {for: 'jellyfin'}).toString()).toBe(
			'dialog=app-settings&app=jellyfin',
		)
	})

	test('opening over another dialog replaces it whole', () => {
		expect(
			withDialog(search('sort=name&dialog=app-settings&app=jellyfin&view=storage'), 'photos-source').toString(),
		).toBe('sort=name&dialog=photos-source')
	})

	test('reopening a dialog drops the params it is not given again', () => {
		expect(withDialog(search('dialog=photos-source&photos-source-id=example'), 'photos-source').toString()).toBe(
			'dialog=photos-source',
		)
	})

	test('the current search params are left untouched', () => {
		const current = search('dialog=photos-source&photos-source-id=example')
		withDialog(current, 'logout')
		withoutDialog(current)
		expect(current.toString()).toBe('dialog=photos-source&photos-source-id=example')
	})
})
