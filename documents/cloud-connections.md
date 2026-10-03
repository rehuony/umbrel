# Cloud connections

Files runs cloud connections on the device. The OS repository contains no hosted OAuth server or callback-page deployment. The static callback page will be maintained in a separate repository.

The user experience remains: choose a provider, open its consent page, copy the authorization result from the callback page, and paste it into Files. End users do not register developer applications or configure client IDs. User credentials are stored on the device. Dropbox and OneDrive token exchange and renewal go directly to the provider. File browsing and downloads go directly to every provider.

## Maintainer configuration

Edit only [`cloud-oauth-clients.json`](../packages/backend/source/modules/files/cloud-oauth-clients.json):

```json
{
	"redirectUri": "https://auth.example.com/callback",
	"dropbox": {"clientId": "YOUR_DROPBOX_APP_KEY"},
	"onedrive": {"clientId": "YOUR_ENTRA_APPLICATION_ID"}
}
```

These are public registration identifiers and an HTTPS callback URL, not account credentials. They may be committed and included in the system image. The OS needs no client secret, encryption key, or hosted-service environment file. The configuration rejects secret fields and callbacks containing credentials, queries, or fragments. Each provider must register exactly the configured callback URI.

The checked-in values are empty until the project's registrations and callback page are ready. Missing registration metadata makes that provider unavailable, with no fallback to upstream or rclone's default client identity. Fill the public configuration before building a release advertised as ready to authorize. Source packaging includes this file through the existing backend image build; no separate CI secret or build argument is needed.

Google Drive new connections remain unavailable. Existing Google account data and saved configurations are preserved. Google is not enabled by filling the public configuration.

## Provider setup

| Entry        | Connection method                                        | What the project maintainer prepares                                                         |
| ------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Dropbox      | Authorization code with S256 PKCE, no client secret      | Dropbox App key, full-Dropbox access, read permissions, exact callback URI                   |
| OneDrive     | Public desktop client, authorization code with S256 PKCE | Entra Application ID, public-client platform, delegated read permissions, exact callback URI |
| Google Drive | New connections deferred                                 | No supported public-client configuration in this release                                     |
| iCloud Drive | Local Apple account and verification flow                | No shared OAuth registration                                                                 |
| Nextcloud    | Local WebDAV account connection                          | No shared OAuth registration                                                                 |
| ownCloud     | Local WebDAV account connection                          | No shared OAuth registration                                                                 |
| WebDAV       | Local WebDAV account connection                          | No shared OAuth registration                                                                 |

### Dropbox

1. Create an application in the [Dropbox App Console](https://www.dropbox.com/developers/apps).
2. Choose scoped access and full Dropbox access to browse existing folders. App-folder access does not provide the same capability.
3. Enable `account_info.read`, `files.metadata.read`, `files.content.read`, and `sharing.read`.
4. Register the exact HTTPS callback URI and copy the App key into the public configuration. Do not copy the App secret.
5. Complete Dropbox's production-access requirements before distributing to users outside the app's development limits.

The device requests offline access and exchanges the code using its private, per-attempt PKCE verifier. Dropbox documents this approach for distributed software in its [OAuth guide](https://docs.dropboxapi.com/dropbox-api/docs/oauth).

### OneDrive

1. Register an application in [Microsoft Entra](https://entra.microsoft.com/). Choose supported account types appropriate to the product; personal and organizational accounts require the corresponding registration option.
2. Add the callback under **Mobile and desktop applications** as a custom redirect URI and enable public-client flows as required by the registration. Do not configure this as a confidential Web client or a browser SPA.
3. Configure delegated `User.Read` and `Files.Read`; the device also requests `offline_access` for renewal.
4. Copy the Application (client) ID into the public configuration. Do not create or copy a client secret for this flow.
5. Verify organizational consent policies and personal-account access with real accounts before release.

See Microsoft's [redirect URI configuration](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri) and [authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow). The current connector supports the user's personal or business drive, not arbitrary SharePoint libraries.

### Google Drive

New Google Drive connections are intentionally unavailable. A Google Desktop client's loopback callback targets the browser's computer, which can differ from the OS device. Google's device grant does not offer the full `drive.readonly` scope, while a Web registration requires a client secret for exchange and renewal. A static copy-result page alone does not address those constraints. Google support needs a separate design before it can be advertised as available.

See [Google native-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [device-flow scopes](https://developers.google.com/identity/protocols/oauth2/limited-input-device#allowedscopes), and [Web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

Existing persisted Google accounts, files, and sync definitions are not deleted or rewritten. Their saved configuration continues to control renewal. Reconnecting a Google account is unavailable in this release.

## Separate callback-page contract

The callback page only displays a copyable result. Its browser code must not exchange codes, hold provider secrets, retain user tokens, redirect to arbitrary local addresses, or forward file traffic.

On a successful provider callback, copy this JSON as one value:

```json
{"code": "THE_CODE_FROM_THE_PROVIDER", "state": "THE_UNMODIFIED_STATE_FROM_THE_PROVIDER"}
```

Both fields are required. A raw code alone is rejected. The user still performs a single copy-and-paste action; the state travels with the code. The local device checks state before sending any token request, then exchanges the code with its device-held PKCE verifier and the original registered callback URI against the direct Dropbox/OneDrive endpoint.

The future callback implementation must:

- Accept a single nonempty `code` and `state` parameter, preserving their decoded values exactly; reject duplicate parameters and error callbacks.
- Bound code length to 8,192 characters and state to 128; the complete pasted JSON must fit 16,384 characters.
- Render values as text, never HTML. Clear sensitive query parameters from browser history after parsing them.
- Use HTTPS, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, restrictive CSP, no analytics or third-party resources, and no query-string access logging.
- Display a safe failure message on denied consent and instruct users to retry in Files. Never invent a code for an error response.

The callback host sees a short-lived code and state but not the device's PKCE verifier or refresh tokens. It remains a trusted part of the login experience and must be protected accordingly. This contract does not imply the callback page has been deployed.

## Local behavior and storage

- Sessions expire after ten minutes and belong to the authenticated panel user. Each attempt has independent random state and a fresh S256 PKCE verifier. Neither the verifier nor provider tokens are returned in the frontend session API.
- Completion checks the account, state, expiration, client ID, and callback URI. Codes are exchanged only against fixed provider endpoints; HTTP redirects are rejected.
- Cancelling, closing, or abandoning the dialog releases the session. Duplicate completion requests share one operation. Late requests cannot revive a cancelled UI flow.
- The backend validates provider identity and read access before promoting temporary credentials. Reauthorization must keep the existing account identity. Failures and cancellation preserve existing account data.
- Local rclone account configurations explicitly use the project's client ID and an empty client secret. Dropbox and OneDrive use their native provider endpoints. rclone renews tokens and persists rotations. No central-service grant handle is stored.
- Credentials remain in the private `cloud/accounts/<account-id>/rclone.conf` area under the device data directory, protected by existing restrictive file permissions and account-owner checks. They are not placed in browsable user folders. Synced files use the existing owner-validated destination under Home, the member's user directory, or an explicitly selected permitted storage destination.
- Existing locally authorized accounts remain compatible. Their saved registration metadata is not silently replaced; explicitly reconnecting a supported provider replaces credentials only after successful validation.
- Existing disconnect behavior is retained: local credentials and scheduled work are removed, with provider revocation where supported. Provider-level revocation may affect other authorizations using that registration; OneDrive users can also remove application access in their Microsoft account settings.

Removing credentials from source does not erase them from Git history or revoke them at the provider. Check both current files and history before publishing. Public client IDs are registration metadata; do not treat them as secret account credentials.

## Verification and release gates

Focused tests cover public-client requests, state and PKCE binding, unavailable configuration, failed exchanges, account isolation, duplicate completion, cancellation, and UI races. A separate opt-in test uses rclone 1.75.1 and a local fake token endpoint to verify two renewals, omitted secrets, and rotated-token persistence. It denies real cloud requests, so it is not evidence of a successful real provider login.

```sh
pnpm --filter backend test source/modules/files/cloud-auth.unit.test.ts source/modules/files/cloud.unit.test.ts
pnpm --filter frontend test src/features/files/hooks/use-cloud-oauth.test.tsx
RCLONE_BINARY=/absolute/path/to/verified-rclone-1.75.1 pnpm --filter backend test source/modules/files/cloud-auth.integration.test.ts
```

Before distribution, register real clients, deploy the separate callback page, fill the public metadata, and verify new login, denied consent, expired/wrong-device copied results, renewal after restart, disconnect, and member isolation on real Dropbox and OneDrive accounts. Check rclone behavior on supported image targets. Tests using synthetic providers cannot confirm provider approval, tenant policy, callback hosting, or hardware operation.
