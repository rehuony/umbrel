# External application access

## Architecture

The existing backend owns both panel traffic and authenticated application forwarding. The VPS terminates public HTTPS and forwards registered hostnames through Tailscale to the same system ingress port. No additional authentication server or gateway process is required.

The implementation has these boundaries:

1. Add owner-managed HTTPS origins and exact trusted proxy addresses. Keep configuration separate from application manifests. Reject duplicate origins and unknown applications.
2. Dispatch registered application hosts to the existing streaming application gateway. Reject untrusted forwarding and unknown hosts received from trusted proxies. External access always requires authentication, independently of LAN application settings.
3. Replace the separate application login page, APIs, listener, and build entry with the regular panel login and a bounded, browser-bound handoff. Preserve member authorization, session expiry, revocation, and original application paths.
4. Expose panel/proxy configuration through Advanced Settings and application URLs through each application's settings. Use external application origins when launching from the external panel. Never silently construct an unreachable domain-and-port URL for an unconfigured external application.
5. Remove redundant authentication/configuration reads without retaining stale permission grants. Keep request and response bodies streaming; do not add a second proxy process or buffer complete uploads.
6. Verify malformed configuration, forwarded-header forgery, unknown domains, missing sessions, denied members, cross-application use, replay, expiry, revoked sessions, WebSockets, configuration changes, and ordinary LAN access. Verify the UI and production build separately from real-device acceptance.

## Authentication boundary

An unauthenticated browser is redirected to the configured panel origin. The regular panel login retains an internal return URL. An authenticated HTTP procedure checks both panel credentials and app access before issuing a short-lived, single-use handoff. The callback destination comes from server-owned state, not an arbitrary browser URL.

The application callback requires the initiating browser's HttpOnly cookie, the pending request, and the exact ticket issued for that request. Requests expire after five minutes; issued tickets expire after thirty seconds and can be consumed only once. External application sessions are host-only, Secure, HttpOnly, and scoped to a specific app and origin. Application containers never receive panel, handoff-binding, or gateway session cookies. Session and member-access revocation continue to be enforced by the central authentication module; registered WebSockets close on revocation. Already admitted HTTP transfers may finish.

Unauthenticated API requests and WebSocket upgrades fail without redirecting to HTML. Authenticated members without access receive a denial rather than a login loop. Application-native accounts are not replaced by gateway authentication.

## Operational boundary

Only explicitly registered applications are exposed. A wildcard DNS record does not publish other applications. The VPS must preserve the registered Host header and overwrite forwarding headers; the system trusts only configured TCP peer addresses. DNS, certificates, the VPS configuration, and Tailscale policy remain operator-managed.

Application container ports must not be publicly published by a separate router or proxy. Configure Tailscale policy to permit the VPS to reach only the intended gateway port before enabling access. This restriction also protects startup periods before backend-managed firewall rules are installed. Audit other tailnet peers separately: their access remains governed by their LAN/Tailscale policy.

Once applied, the ingress firewall restricts configured proxy source IPs to TCP 80/443 before Docker DNAT. Other TCP ports, including SSH and raw application ports, are blocked for those IPs. This guard remains while the proxy IPs are configured, including when the external-access toggle is off. Disabling access denies configured external hosts instead of falling through to the LAN panel. Removing a proxy IP deliberately removes its restriction; update Tailscale policy first. Local app access from other LAN peers retains its existing policy. UDP and non-web services are outside this gateway's scope.

Backend restart briefly interrupts application forwarding. External browser sessions may need a new automatic handoff after restart; existing panel sessions remain the source of identity. No persistent user or application data is discarded.

## Configuration

1. Create HTTPS DNS names for the panel and each exposed application. They must be different origins on port 443; wildcard host routing and subpath applications are not supported.
2. Restrict the VPS in Tailscale policy to the Raspberry Pi's TCP port 80. Keep a separate trusted LAN administration path while changing ingress settings.
3. In **Settings → Advanced Settings → External access**, enter the panel origin and the VPS's exact Tailscale source IP. Enable and save external access here before configuring application URLs. This form only edits global ingress settings.
4. When global access is disabled, the application row is inactive and its **Configure** button opens the global settings directly. Open an application's **Settings → External access** and enter its HTTPS origin. The application settings dialog retains unsaved URL edits while switching sections and warns before discarding them. A URL-only save does not restart the application. Empty origins remain LAN-only; saved origins are retained when global external access is disabled. Only the owner can change either scope, and concurrent saves preserve other applications' mappings. Nothing is exposed by default.
5. Configure the VPS as below, with valid certificates and the real Raspberry Pi Tailscale address. Test and reload Nginx using its normal administrative workflow.
6. Set each application's public URL/trusted-proxy options when that application requires them. Gateway authentication does not replace application-native accounts. External clients without browser sessions, webhooks, and cross-origin API calls are deliberately denied; there is no implicit bypass allowlist.

All domains use the same upstream. The following directives belong in Nginx's `http` context; certificate paths and names are placeholders. Keep unknown-host rejection in the VPS's default server as well. The log format excludes query strings because callbacks contain short-lived credentials.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' ''; # Keep ordinary HTTP connections reusable.
}

log_format panel_gateway '$remote_addr $host $request_method $uri $status';

upstream panel_ingress {
    server 100.64.0.20:80;
    keepalive 32;
}

server {
    listen 443 ssl;
    server_name panel.example.com photos.example.com app.example.com;
    ssl_certificate /etc/nginx/certificates/example.fullchain.pem;
    ssl_certificate_key /etc/nginx/certificates/example.key;
    access_log /var/log/nginx/panel-gateway.log panel_gateway;

    # Adjust to the largest upload you intend to allow.
    client_max_body_size 20g;

    location / {
        proxy_pass http://panel_ingress;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Forwarded "";
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

Do not rewrite cookies to a parent domain, cache authenticated responses, or create additional VPS locations pointing directly at application ports. Keep callback query strings out of debug/access logs too. The backend overwrites forwarding metadata from the configured TCP peer; forwarded client-IP headers cannot establish trust.

Applications with an existing `app_proxy` target use that target directly. A directly published HTTP application uses its local published port. For an upstream that speaks only HTTPS, declare an HTTPS application gateway target; the gateway verifies its certificate and does not silently disable TLS verification. Browser-based apps that require special origins, streaming timeouts, or WebSocket settings still need application-specific acceptance tests.

## Runtime and maintenance

External routing, transient login attempts, and app sessions are indexed in memory. HTTP bodies and responses remain streaming, and the application proxy reuses upstream connections. Authentication performs one account validation per request and checks current member grants; concurrent file-store reads share in-flight I/O only, with independent results for callers. No permission cache survives a completed read or hides a later write.

The separate App Auth frontend, backend APIs, port-2000 listener, and Tor authentication port are removed. LAN and Tor application login also return through the normal panel login. The existing app manifest/Compose format and LAN app-auth settings remain supported because the application catalog still uses them. External policy ignores LAN auth exemptions.

Saving configuration invalidates old external sessions and pending requests. Failed application of ingress settings restores the prior configuration and reports failure. Uninstalling an application removes its public mapping, so reinstalling the same app ID does not silently republish it. Transient login/session tables are bounded; public deployments should also apply appropriate request-rate controls at the VPS.

The proxy configuration follows [Nginx's WebSocket guidance](https://nginx.org/en/docs/http/websocket.html) and [streaming proxy directives](https://nginx.org/en/docs/http/ngx_http_proxy_module.html). Cookie isolation follows the [host-prefixed cookie requirements](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

## Verification

The gateway tests exercise local HTTP and WebSocket connections, central
authentication and RPC handlers. They cover browser/app/request binding, expired
and reused tickets, concurrent callbacks, member denial, session revocation,
cross-origin requests, spoofed forwarding headers, unknown hosts, configuration
rollback and application removal. UI tests cover callback navigation, external
URL selection, draft retention, save failures and disabled global access.

Use the [verification guide](validation.md) for test commands and environment
requirements. Deployment acceptance also needs the actual VPS/Nginx/Tailscale
path, a current image and application-specific browser/client checks. Verify
firewall restrictions in an isolated environment before applying them to the
intended proxy. Synthetic gateway tests do not establish physical Raspberry Pi
throughput or successful provider/application access.
