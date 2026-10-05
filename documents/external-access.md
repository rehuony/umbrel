# Direct service access

The panel and application services are separate endpoints. The panel retains its own login, two-factor authentication, session revocation and management API permissions. Each application authenticates its own users and API clients. Application requests do not acquire or require an Umbrel session.

## Reverse proxy configuration

Configure public DNS, TLS and the private connection on the VPS. Point each upstream at the system's private IP and the service's published host port. A Compose mapping such as `18080:8080` uses port `18080` on the VPS upstream. Separate domains may point at different ports of the same application, for example its web UI and API server. Use the application's native credentials and proxy settings where required.

The panel can be forwarded through its normal HTTP or HTTPS listener. For HTTPS upstreams, trust the system's local CA and verify the upstream name. Ingress derives the panel cookie transport from the actual upstream connection; client-supplied forwarded protocol headers do not override it. Keep the panel and applications on their respective domains and ports.

There is no system-wide public panel URL, proxy-IP registry, host-based application dispatcher or source-IP restriction to ports 80/443. Existing ingress rules still protect internal listeners and keep HTTP/HTTPS routing working. Network reachability and service publication follow Compose and the operator's network configuration.

## Application launch URL

An application's `settings.yml` may contain `externalUrl`, an HTTP or HTTPS URL without embedded credentials. `apps.setSettings` saves or clears it; `apps.list` returns it. An empty value clears the URL. This setting does not modify Compose, restart the app, configure a reverse proxy or change authentication.

The dashboard chooses the icon destination from the address currently used to open the panel:

- Private IPv4, loopback, IPv6 local/link-local addresses, single-label hosts, `.local`, `.localhost`, `.home.arpa` and `.ts.net` use the panel host and the application's primary service port.
- Other hostnames and public IPs use the application's external URL. A public panel opened from inside the LAN still uses the external URL. A private DNS zone outside the local suffixes listed above also uses this URL.
- Tor uses the application's hidden service. Apps without a hidden service show an unavailable message; direct Compose imports do not create one automatically.

A public launch without an external URL shows an unavailable message instead of constructing a public hostname with an internal port. A URL with an explicit path, query or fragment is used as configured. A bare origin uses the manifest path. Explicit application subpage links remain on the selected origin.

This URL is launcher metadata, not an access rule. Dashboard app sharing controls which icons and management information a member can see; it does not authorize or revoke native application connections.

## Compose imports and store applications

Custom imports preserve the submitted Compose definition, including multiple service port mappings. Choose one fixed published TCP host port, a protocol and a path for the icon's web entry. Host-network applications require an explicit port. A background app may have no icon web entry while retaining its published ports. Dynamic mappings and ranges remain in Compose but cannot be selected as a fixed icon endpoint. The external launch URL can be supplied during import or edited later in app settings.

The imported manifest records the native web-entry protocol as `portProtocol`, defaulting to HTTP. Direct endpoints bypass the HTTP/TLS ingress mux so Compose bind addresses and application-owned TLS remain intact. Local icons use this protocol independently of the panel's protocol; public icons use the external URL's protocol. Store apps without an explicit `portProtocol` retain their existing HTTP/TLS ingress behavior.

Imports accept direct service declarations rather than `app_proxy`. Store applications may still declare `app_proxy` as their upstream transport target. The in-process transport preserves streaming HTTP, WebSockets, native application credentials, upstream errors and target recovery. It has no Umbrel login checks, authentication overrides, callback tickets or application session cookies. It removes panel browser-session cookies before forwarding to an upstream application.

All explicitly published ports, including secondary and background-service ports, are reserved against hidden ingress listener allocation. Published ports must also respect the existing Machines port reservation. These allocation rules do not create a VPS source-IP whitelist.

## Verification

Focused tests cover launch address selection, Compose binding preservation, external URL validation and persistence, transparent application credentials and WebSockets, long uploads, upstream failures, and panel session boundaries. VM scenarios cover HTTP/HTTPS ingress, Tor endpoints, loopback forwarding, panel login and member isolation. Run VM scenarios against an image built from the changed revision; an older image cannot validate these source changes. Validate the actual VPS routes, native app authentication and each published service port after the operator deploys the update.
