import {createHash, randomBytes, randomUUID} from 'node:crypto'

import ky, {HTTPError, type Input, type KyInstance, type Options} from 'ky'
import stripAnsi from 'strip-ansi'
import {z} from 'zod'

import publicClients from './cloud-oauth-clients.json' with {type: 'json'}

import CloudRclone, {
	CLOUD_RCLONE_REMOTE,
	RcloneProcessError,
	readCloudConfig,
	type RcloneConfigTransaction,
} from './cloud-rclone.js'
import {
	CLOUD_INVALID_ACCOUNT_CONFIG_ERROR,
	CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR,
	type Account,
	type Provider,
	type RemoteRef,
	type WebDavFlavor,
} from './cloud-types.js'

export const OAUTH_SESSION_LIFETIME = 10 * 60 * 1000

export const CLOUD_OAUTH_SCOPES = {
	dropbox: ['account_info.read', 'files.metadata.read', 'files.content.read', 'sharing.read'],
	onedrive: ['offline_access', 'User.Read', 'Files.Read'],
} as const

const MAX_AUTH_CODE_LENGTH = 16384
const MAX_PROVIDER_RESPONSE = 2 * 1024 * 1024
const PROVIDER_REQUEST_TIMEOUT = 30 * 1000
const UNTRUSTED_CERTIFICATE_PATTERN = /tls: failed to verify certificate|\bx509:/i
const OAUTH_PROVIDERS = ['google-drive', 'dropbox', 'onedrive'] as const
type OAuthProvider = (typeof OAUTH_PROVIDERS)[number]
type PublicOAuthProvider = 'dropbox' | 'onedrive'
type Fetch = NonNullable<Options['fetch']>

// Public registration metadata is maintained once by the distributor, not by users.
// Google Desktop clients cannot use this fixed HTTPS callback contract; keep
// existing Google accounts readable, but do not advertise a working public flow.
const publicClientSchema = z.object({clientId: z.string().trim().max(512)}).strict()
const publicConfigSchema = z
	.object({
		redirectUri: z.string().trim().max(2048),
		dropbox: publicClientSchema,
		onedrive: publicClientSchema,
	})
	.strict()
type PublicConfig = z.infer<typeof publicConfigSchema>
type OAuthClient = {clientId: string}
const validatePublicConfig = (config: PublicConfig) => {
	const parsed = publicConfigSchema.parse(config)
	if (parsed.redirectUri) {
		const url = new URL(parsed.redirectUri)
		if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
			throw new Error('[cloud-invalid-oauth-configuration]')
	}
	return parsed
}

export type OAuthSession = {
	kind: 'oauth'
	sessionId: string
	accountId: string
	provider: PublicOAuthProvider
	verifier: string
	state: string
	clientId: string
	redirectUrl: string
	expiresAt: number
}

export type RcloneOAuthToken = {
	access_token: string
	token_type: string
	refresh_token: string
	expiry: string
}

export type CloudProviderLocation = {
	id: string
	displayName: string
	remote: RemoteRef
}

export type CloudProviderLocations = {
	locations: CloudProviderLocation[]
	truncated: boolean
}

const dropboxLocation = (): CloudProviderLocation => ({
	id: 'dropbox',
	displayName: 'Dropbox',
	remote: {path: ''},
})

const webDavLocation = (displayName: string): CloudProviderLocation => ({
	id: 'webdav',
	displayName,
	remote: {path: ''},
})

const iCloudLocation = (): CloudProviderLocation => ({
	id: 'icloud-drive',
	displayName: 'iCloud Drive',
	remote: {path: ''},
})

const singleLocation = (location: CloudProviderLocation): CloudProviderLocations => ({
	locations: [location],
	truncated: false,
})

export type ConnectedAccount = Omit<Account, 'id' | 'userId'>

export type OAuthConnectionResult = {
	account: ConnectedAccount
	locations: CloudProviderLocations
}

export type ICloudChallenge = {
	state: string
	step: string
	prompt: string
	choices?: {value: string; displayName: string}[]
}

export type ICloudConnectionResult =
	| {complete: false; challenge: ICloudChallenge}
	| {complete: true; account: ConnectedAccount; locations: CloudProviderLocations}

type ConfigTransaction = Pick<RcloneConfigTransaction, 'accountId' | 'configPath' | 'call'>
type Rclone = {
	browse: CloudRclone['browse']
	getAccountPaths: (accountId: string) => {config: string}
}

type RcloneConfigOutput = {
	State?: unknown
	Option?: {
		Name?: unknown
		Help?: unknown
		Examples?: {Value?: unknown; Help?: unknown}[]
	}
	Error?: unknown
}

type OAuthProviderDefinition = {
	authorizationUrl: string
	tokenUrl: string
	scopes: readonly string[]
}

const PROVIDERS: Record<PublicOAuthProvider, OAuthProviderDefinition> = {
	dropbox: {
		authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
		tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
		scopes: CLOUD_OAUTH_SCOPES.dropbox,
	},
	onedrive: {
		authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
		tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
		scopes: CLOUD_OAUTH_SCOPES.onedrive,
	},
}

export class CloudProviderHttpError extends Error {
	provider: Provider
	statusCode?: number
	providerErrorCode?: string
	upstreamErrorName?: string
	upstreamErrorCode?: string

	constructor(
		provider: Provider,
		statusCode?: number,
		{providerErrorCode, upstream}: {providerErrorCode?: string; upstream?: {name?: string; code?: string}} = {},
	) {
		super('[cloud-provider-request-failed]')
		this.name = 'CloudProviderHttpError'
		this.provider = provider
		this.statusCode = statusCode
		this.providerErrorCode = providerErrorCode
		this.upstreamErrorName = upstream?.name
		this.upstreamErrorCode = upstream?.code
	}
}

const providerErrorCodeFromResponse = async (response: Response) => {
	const declaredLength = Number(response.headers.get('content-length'))
	if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE) return
	try {
		const rawBody = await response.clone().text()
		if (Buffer.byteLength(rawBody) > MAX_PROVIDER_RESPONSE) return
		const body = JSON.parse(rawBody) as {error?: unknown}
		const code =
			typeof body.error === 'string'
				? body.error
				: body.error && typeof body.error === 'object' && '.tag' in body.error
					? body.error['.tag']
					: undefined
		return typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : undefined
	} catch {
		return
	}
}

const upstreamErrorDetails = (error: unknown) => {
	if (!error || typeof error !== 'object') return undefined
	const name = 'name' in error && typeof error.name === 'string' ? error.name : undefined
	const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
	return name || code ? {name, code} : undefined
}

const isOAuthProvider = (provider: Provider): provider is OAuthProvider =>
	OAUTH_PROVIDERS.includes(provider as OAuthProvider)

// The separate callback site copies this JSON object, not a long-lived token.
// State and the device-held PKCE verifier bind it to this local sign-in attempt.
const authorizationResultSchema = z
	.object({
		code: z
			.string()
			.min(1)
			.max(8192)
			.refine((code) => !/[\u0000-\u001f\u007f]/.test(code)),
		state: z.string().min(1).max(128),
	})
	.strict()

const readProviderJson = async <T>(provider: Provider, response: Response) => {
	const declaredLength = Number(response.headers.get('content-length'))
	if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE) {
		throw new CloudProviderHttpError(provider, response.status)
	}

	try {
		const responseBody = await response.text()
		if (Buffer.byteLength(responseBody) > MAX_PROVIDER_RESPONSE) {
			throw new CloudProviderHttpError(provider, response.status)
		}
		return JSON.parse(responseBody) as T
	} catch (error) {
		if (error instanceof CloudProviderHttpError) throw error
		throw new CloudProviderHttpError(provider, response.status)
	}
}

const normalizeWebDavUrl = (value: string) => {
	let url: URL
	try {
		url = new URL(value.trim())
	} catch {
		throw new Error('[cloud-invalid-webdav-url]')
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
		throw new Error('[cloud-invalid-webdav-url]')
	}
	url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
	return url.toString()
}

const validateCredential = (value: string, error: string, maxLength: number, trim = true) => {
	const normalized = trim ? value.trim() : value
	if (!normalized || normalized.length > maxLength || normalized.includes('\0')) throw new Error(error)
	return normalized
}

const tokenFromResponse = (
	provider: OAuthProvider,
	response: Record<string, unknown>,
	now: number,
): RcloneOAuthToken => {
	const accessToken = response.access_token
	const refreshToken = response.refresh_token
	const expiresIn = response.expires_in
	if (
		typeof accessToken !== 'string' ||
		!accessToken ||
		typeof refreshToken !== 'string' ||
		!refreshToken ||
		typeof expiresIn !== 'number' ||
		!Number.isFinite(expiresIn) ||
		expiresIn <= 0
	) {
		throw new CloudProviderHttpError(provider)
	}

	return {
		access_token: accessToken,
		token_type: typeof response.token_type === 'string' && response.token_type ? response.token_type : 'Bearer',
		refresh_token: refreshToken,
		expiry: new Date(now + expiresIn * 1000).toISOString(),
	}
}

const bearerHeaders = (token: Pick<RcloneOAuthToken, 'access_token'>) => ({
	authorization: `Bearer ${token.access_token}`,
})

const sanitizeProviderString = (value: string) => stripAnsi(value).replace(/[\u0000-\u001F\u007F-\u009F]/g, '')

const providerString = (provider: Provider, value: unknown) => {
	if (typeof value !== 'string' || !value) throw new CloudProviderHttpError(provider)
	const sanitized = sanitizeProviderString(value)
	if (!sanitized) throw new CloudProviderHttpError(provider)
	return sanitized
}

const parseICloudOutput = (output: RcloneConfigOutput): ICloudChallenge | undefined => {
	if (typeof output.Error === 'string' && output.Error) throw new Error('[cloud-icloud-auth-failed]')
	const state = output.State
	if (state === '' || state === undefined) return
	if (
		typeof state !== 'string' ||
		!output.Option ||
		typeof output.Option.Name !== 'string' ||
		typeof output.Option.Help !== 'string'
	) {
		throw new Error('[cloud-invalid-icloud-auth-state]')
	}
	const step = sanitizeProviderString(output.Option.Name)
	const prompt = sanitizeProviderString(output.Option.Help)
	if (!step || !prompt) throw new Error('[cloud-invalid-icloud-auth-state]')
	const choices = output.Option.Examples?.flatMap((choice) =>
		typeof choice.Value === 'string' && typeof choice.Help === 'string'
			? [{value: choice.Value, displayName: sanitizeProviderString(choice.Help)}]
			: [],
	).filter(({displayName}) => displayName)
	return {state, step, prompt, ...(choices?.length ? {choices} : {})}
}

const readTokenFromConfig = async (configPath: string) => {
	const encodedToken = (await readCloudConfig(configPath)).values.token
	let token: Partial<RcloneOAuthToken>
	try {
		token = JSON.parse(encodedToken) as Partial<RcloneOAuthToken>
	} catch {
		throw new Error(CLOUD_INVALID_ACCOUNT_CONFIG_ERROR)
	}
	if (typeof token.access_token !== 'string' || !token.access_token) {
		throw new Error(CLOUD_INVALID_ACCOUNT_CONFIG_ERROR)
	}
	return token as Partial<RcloneOAuthToken> & {access_token: string}
}

export default class CloudAuth {
	readonly rclone: Rclone
	readonly http: KyInstance
	readonly now: () => number
	readonly redirectUrl: string
	readonly oauthClients: Partial<Record<PublicOAuthProvider, OAuthClient>>

	constructor({
		rclone,
		fetch = globalThis.fetch,
		now = Date.now,
		configuration = publicClients,
	}: {
		rclone: Rclone
		fetch?: Fetch
		now?: () => number
		configuration?: PublicConfig
	}) {
		this.rclone = rclone
		this.http = ky.create({fetch, retry: 0, timeout: false, redirect: 'error'})
		this.now = now
		const config = validatePublicConfig(configuration)
		this.redirectUrl = config.redirectUri
		this.oauthClients = Object.fromEntries(
			(['dropbox', 'onedrive'] as const).flatMap((provider) =>
				config.redirectUri && config[provider].clientId ? [[provider, config[provider]]] : [],
			),
		)
	}

	getAvailableProviders(): Provider[] {
		return [
			...(['dropbox', 'onedrive'] as const).filter((provider) => this.oauthClients[provider]),
			'webdav' as const,
			'icloud' as const,
		]
	}

	beginOAuth(accountId: string, provider: Provider) {
		if (!isOAuthProvider(provider)) throw new Error('[cloud-oauth-not-supported]')
		if (provider === 'google-drive') throw new Error('[cloud-provider-unavailable]')
		const client = this.oauthClients[provider]
		if (!client) throw new Error('[cloud-provider-unavailable]')

		const verifier = randomBytes(32).toString('base64url')
		const challenge = createHash('sha256').update(verifier).digest('base64url')
		const definition = PROVIDERS[provider]
		const authorizationUrl = new URL(definition.authorizationUrl)
		authorizationUrl.searchParams.set('client_id', client.clientId)
		authorizationUrl.searchParams.set('redirect_uri', this.redirectUrl)
		authorizationUrl.searchParams.set('response_type', 'code')
		authorizationUrl.searchParams.set('code_challenge', challenge)
		authorizationUrl.searchParams.set('code_challenge_method', 'S256')
		authorizationUrl.searchParams.set('scope', definition.scopes.join(' '))
		const state = randomBytes(32).toString('base64url')
		authorizationUrl.searchParams.set('state', state)

		if (provider === 'dropbox') authorizationUrl.searchParams.set('token_access_type', 'offline')
		if (provider === 'onedrive') {
			authorizationUrl.searchParams.set('response_mode', 'query')
			authorizationUrl.searchParams.set('prompt', 'select_account')
		}

		const session: OAuthSession = {
			kind: 'oauth',
			sessionId: randomUUID(),
			accountId,
			provider,
			verifier,
			state,
			clientId: client.clientId,
			redirectUrl: this.redirectUrl,
			expiresAt: this.now() + OAUTH_SESSION_LIFETIME,
		}
		return {authorizationUrl: authorizationUrl.toString(), session}
	}

	async completeOAuth(
		session: OAuthSession,
		code: string,
		transaction: ConfigTransaction,
		signal?: AbortSignal,
	): Promise<OAuthConnectionResult> {
		if (session.expiresAt <= this.now()) throw new Error('[cloud-auth-session-expired]')
		if (session.accountId !== transaction.accountId) throw new Error('[cloud-auth-session-mismatch]')
		let result: z.infer<typeof authorizationResultSchema>
		try {
			const value = validateCredential(code, '[cloud-invalid-authorization-code]', MAX_AUTH_CODE_LENGTH)
			result = authorizationResultSchema.parse(JSON.parse(value))
		} catch {
			throw new Error('[cloud-invalid-authorization-code]')
		}
		if (result.state !== session.state) throw new Error('[cloud-auth-session-mismatch]')
		const client = this.oauthClients[session.provider]
		if (!client || client.clientId !== session.clientId || session.redirectUrl !== this.redirectUrl)
			throw new Error('[cloud-provider-unavailable]')

		const tokenParameters = new URLSearchParams({
			client_id: client.clientId,
			code: result.code,
			code_verifier: session.verifier,
			grant_type: 'authorization_code',
			redirect_uri: session.redirectUrl,
		})

		const tokenResponse = await this.requestJson<Record<string, unknown>>(
			session.provider,
			PROVIDERS[session.provider].tokenUrl,
			{
				method: 'POST',
				headers: {'content-type': 'application/x-www-form-urlencoded'},
				body: tokenParameters,
				signal,
			},
		)
		const token = tokenFromResponse(session.provider, tokenResponse, this.now())
		const [account, locations] = await Promise.all([
			this.getOAuthIdentity(session.provider, token, signal),
			this.getOAuthLocations(session.provider, token, signal),
		])
		signal?.throwIfAborted()
		await this.configureOAuthTransaction(transaction, session.provider, token, locations.locations)
		signal?.throwIfAborted()
		await this.rclone.browse({
			accountId: transaction.accountId,
			provider: session.provider,
			remote: locations.locations[0].remote,
			configPath: transaction.configPath,
			maxEntries: 1,
			signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
		})
		return {account, locations}
	}

	async configureOAuthTransaction(
		transaction: ConfigTransaction,
		provider: PublicOAuthProvider,
		token: RcloneOAuthToken,
		locations: CloudProviderLocation[],
	) {
		const client = this.oauthClients[provider]
		if (!client) throw new Error('[cloud-provider-unavailable]')
		const firstLocation = locations[0]
		if (!firstLocation) throw new Error('[cloud-unsupported-provider-location]')

		let type: string
		let parameters: Record<string, unknown>
		if (provider === 'dropbox') {
			type = 'dropbox'
			parameters = {
				client_id: client.clientId,
				client_secret: '',
				token: JSON.stringify(token),
			}
		} else {
			if (!firstLocation.remote.driveId || !firstLocation.remote.driveType || !firstLocation.remote.folderId) {
				throw new Error('[cloud-unsupported-provider-location]')
			}
			type = 'onedrive'
			parameters = {
				client_id: client.clientId,
				client_secret: '',
				region: 'global',
				access_scopes: CLOUD_OAUTH_SCOPES.onedrive.join(' '),
				drive_id: firstLocation.remote.driveId,
				drive_type: firstLocation.remote.driveType,
				root_folder_id: firstLocation.remote.folderId,
				token: JSON.stringify(token),
			}
		}

		// Supplying a token over the RC JSON body
		// writes a usable remote before the non-interactive backend state machine asks
		// about optional locations. Tokens never enter process argv.
		await transaction.call('config/create', {
			name: CLOUD_RCLONE_REMOTE,
			type,
			parameters,
			opt: {nonInteractive: true, noOutput: true},
		})
	}

	async connectWebDav(
		transaction: ConfigTransaction,
		{
			flavor,
			url,
			username,
			password,
			tlsMode,
		}: {
			flavor: WebDavFlavor
			url: string
			username: string
			password: string
			tlsMode: 'default' | 'insecure'
		},
	): Promise<OAuthConnectionResult> {
		const normalizedUrl = normalizeWebDavUrl(url)
		const normalizedUsername = validateCredential(username, '[cloud-invalid-webdav-username]', 1024)
		const normalizedPassword = validateCredential(password, '[cloud-invalid-webdav-password]', 8192, false)
		await transaction.call('config/create', {
			name: CLOUD_RCLONE_REMOTE,
			type: 'webdav',
			parameters: {
				url: normalizedUrl,
				vendor: 'other',
				user: normalizedUsername,
				pass: normalizedPassword,
				...(tlsMode === 'insecure' ? {'override.no_check_certificate': 'true'} : {}),
			},
			opt: {obscure: true, nonInteractive: true, noOutput: true},
		})

		const parsedUrl = new URL(normalizedUrl)
		const location = webDavLocation(parsedUrl.host)
		try {
			await this.rclone.browse({
				accountId: transaction.accountId,
				provider: 'webdav',
				remote: location.remote,
				configPath: transaction.configPath,
				maxEntries: 1,
				signal: AbortSignal.timeout(60_000),
			})
		} catch (error) {
			if (
				tlsMode === 'default' &&
				error instanceof RcloneProcessError &&
				error.records.some(({msg}) => typeof msg === 'string' && UNTRUSTED_CERTIFICATE_PATTERN.test(msg))
			) {
				throw new Error('[cloud-webdav-untrusted-certificate]')
			}
			throw error
		}
		return {
			account: {
				provider: 'webdav',
				identity: `${normalizedUsername}\n${normalizedUrl}`,
				displayName: `${normalizedUsername} · ${parsedUrl.host}`,
				connection: {kind: 'webdav', flavor, url: normalizedUrl, username: normalizedUsername, tlsMode},
			},
			locations: singleLocation(location),
		}
	}

	async beginICloud(
		transaction: ConfigTransaction,
		{appleId, password}: {appleId: string; password: string},
	): Promise<ICloudConnectionResult> {
		const normalizedAppleId = validateCredential(appleId, '[cloud-invalid-apple-id]', 320)
		const normalizedPassword = validateCredential(password, '[cloud-invalid-icloud-password]', 1024, false)
		const output = await transaction.call<RcloneConfigOutput>('config/create', {
			name: CLOUD_RCLONE_REMOTE,
			type: 'iclouddrive',
			parameters: {apple_id: normalizedAppleId, password: normalizedPassword},
			opt: {obscure: true, nonInteractive: true},
		})
		return this.finishICloudStep(transaction, normalizedAppleId, output)
	}

	async continueICloud(
		transaction: ConfigTransaction,
		appleId: string,
		state: string,
		result: string,
	): Promise<ICloudConnectionResult> {
		const normalizedAppleId = validateCredential(appleId, '[cloud-invalid-apple-id]', 320)
		const normalizedState = validateCredential(state, '[cloud-invalid-icloud-auth-state]', 1024)
		const normalizedResult = validateCredential(result, '[cloud-invalid-icloud-auth-result]', 8192)
		const output = await transaction.call<RcloneConfigOutput>('config/update', {
			name: CLOUD_RCLONE_REMOTE,
			parameters: {},
			opt: {
				continue: true,
				nonInteractive: true,
				state: normalizedState,
				result: normalizedResult,
			},
		})
		return this.finishICloudStep(transaction, normalizedAppleId, output)
	}

	async revoke(accountId: string, provider: Provider) {
		if (!isOAuthProvider(provider) || provider === 'onedrive') return
		const token = await readTokenFromConfig(this.rclone.getAccountPaths(accountId).config)
		if (provider === 'google-drive') {
			await this.request(provider, 'https://oauth2.googleapis.com/revoke', {
				method: 'POST',
				headers: {'content-type': 'application/x-www-form-urlencoded'},
				body: new URLSearchParams({token: token.refresh_token ?? token.access_token}),
			})
		} else {
			await this.request(provider, 'https://api.dropboxapi.com/2/auth/token/revoke', {
				method: 'POST',
				headers: bearerHeaders(token),
			})
		}
	}

	async getLocations(account: Account, signal?: AbortSignal): Promise<CloudProviderLocations> {
		if (account.provider === 'dropbox') {
			return singleLocation(dropboxLocation())
		}
		if (account.provider === 'webdav') {
			if (account.connection.kind !== 'webdav') throw new Error(CLOUD_INVALID_ACCOUNT_IDENTITY_ERROR)
			return singleLocation(webDavLocation(new URL(account.connection.url).host))
		}
		if (account.provider === 'icloud') {
			return singleLocation(iCloudLocation())
		}
		const token = await readTokenFromConfig(this.rclone.getAccountPaths(account.id).config)
		return this.getOAuthLocations(account.provider, token, signal)
	}

	private async getOAuthIdentity(
		provider: PublicOAuthProvider,
		token: RcloneOAuthToken,
		signal?: AbortSignal,
	): Promise<ConnectedAccount> {
		let url: string
		let init: RequestInit
		if (provider === 'dropbox') {
			url = 'https://api.dropboxapi.com/2/users/get_current_account'
			init = {method: 'POST', headers: bearerHeaders(token), signal}
		} else {
			url = 'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName'
			init = {headers: bearerHeaders(token), signal}
		}

		const identity = await this.requestJson<Record<string, unknown>>(provider, url, init)

		if (provider === 'dropbox') {
			return {
				provider,
				identity: providerString(provider, identity.account_id),
				displayName: providerString(provider, identity.email),
				connection: {kind: 'oauth'},
			}
		}
		return {
			provider,
			identity: providerString(provider, identity.id),
			displayName: providerString(provider, identity.mail ?? identity.userPrincipalName),
			connection: {kind: 'oauth'},
		}
	}

	private async getOAuthLocations(
		provider: OAuthProvider,
		token: Pick<RcloneOAuthToken, 'access_token'>,
		signal?: AbortSignal,
	): Promise<CloudProviderLocations> {
		if (provider === 'dropbox') {
			return singleLocation(dropboxLocation())
		}
		if (provider === 'google-drive') {
			const [root, drives] = await Promise.all([
				this.requestJson<Record<string, unknown>>(
					provider,
					'https://www.googleapis.com/drive/v3/files/root?fields=id,name',
					{
						headers: bearerHeaders(token),
						signal,
					},
				),
				this.requestJson<{nextPageToken?: unknown; drives?: unknown}>(
					provider,
					'https://www.googleapis.com/drive/v3/drives?pageSize=100&fields=nextPageToken,drives(id,name)',
					{headers: bearerHeaders(token), signal},
				),
			])
			if (!Array.isArray(drives.drives)) throw new CloudProviderHttpError(provider)
			return {
				locations: [
					{
						id: 'my-drive',
						displayName: 'My Drive',
						remote: {
							path: '/',
							folderId: providerString(provider, root.id),
						},
					},
					...drives.drives.map((drive): CloudProviderLocation => {
						if (typeof drive !== 'object' || !drive) throw new CloudProviderHttpError(provider)
						const id = providerString(provider, (drive as {id?: unknown}).id)
						return {
							id,
							displayName: providerString(provider, (drive as {name?: unknown}).name),
							remote: {path: '/', folderId: id, sharedDriveId: id},
						}
					}),
				],
				truncated: typeof drives.nextPageToken === 'string' && Boolean(drives.nextPageToken),
			}
		}

		const drive = await this.requestJson<Record<string, unknown>>(
			provider,
			'https://graph.microsoft.com/v1.0/me/drive?$select=id,name,driveType',
			{headers: bearerHeaders(token), signal},
		)
		const driveId = providerString(provider, drive.id)
		const driveType = drive.driveType
		if (driveType !== 'personal' && driveType !== 'business') throw new Error('[cloud-unsupported-onedrive-location]')
		const root = await this.requestJson<Record<string, unknown>>(
			provider,
			'https://graph.microsoft.com/v1.0/me/drive/root?$select=id,name',
			{headers: bearerHeaders(token), signal},
		)
		return {
			locations: [
				{
					id: driveId,
					displayName: providerString(provider, drive.name),
					remote: {
						path: '/',
						folderId: providerString(provider, root.id),
						driveId,
						driveType,
					},
				},
			],
			truncated: false,
		}
	}

	private async finishICloudStep(
		transaction: ConfigTransaction,
		appleId: string,
		output: RcloneConfigOutput,
	): Promise<ICloudConnectionResult> {
		const challenge = parseICloudOutput(output)
		if (challenge) return {complete: false, challenge}

		const location = iCloudLocation()
		await this.rclone.browse({
			accountId: transaction.accountId,
			provider: 'icloud',
			remote: location.remote,
			configPath: transaction.configPath,
			maxEntries: 1,
			signal: AbortSignal.timeout(60_000),
		})
		return {
			complete: true,
			account: {
				provider: 'icloud',
				identity: appleId.toLowerCase(),
				displayName: appleId,
				connection: {kind: 'icloud', appleId},
			},
			locations: singleLocation(location),
		}
	}

	private async request(provider: Provider, input: Input, options: Options = {}) {
		const timeoutSignal = AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT)
		const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal
		try {
			return await this.http(input, {...options, signal})
		} catch (error) {
			if (error instanceof HTTPError) {
				throw new CloudProviderHttpError(provider, error.response.status, {
					providerErrorCode: await providerErrorCodeFromResponse(error.response),
				})
			}
			throw new CloudProviderHttpError(provider, undefined, {upstream: upstreamErrorDetails(error)})
		}
	}

	private async requestJson<T>(provider: Provider, input: Input, options?: Options) {
		return readProviderJson<T>(provider, await this.request(provider, input, options))
	}
}
