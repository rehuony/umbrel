# Architecture and Development

## Components

| Directory                          | Responsibility                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/frontend`                | React Web dashboard, desktop and mobile browser layouts, and tRPC clients                                                                           |
| `packages/backend`                 | Node.js / TypeScript services for accounts, browser sessions, files, photos, Compose applications, storage, virtual machines, and system management |
| `packages/system`                  | Debian root filesystem, systemd services, Rugix boot chain, and QEMU tooling                                                                        |
| `scripts`                          | Development containers and remote build implementations invoked by Makefile                                                                         |
| `.agents/skills/system-vm-testing` | System VM test authoring guidance                                                                                                                   |

The backend remains Node.js. Update public contracts in the dashboard and server together. Standalone native-client RPCs have been removed; applications retain the original store configuration and runtime. Change internal service names and device paths only when necessary. Existing branding in valid source, licenses, or hardware identifiers does not make those files obsolete.

## Development commands

Create a task branch from the current branch in the current checkout. Do not create worktrees. Preserve uncommitted changes; commits and pushes require an explicit request.

```sh
make help
make deps
make typecheck
make lint
make translations-check
make test
make build
make dev
make test-integration TEST="source/modules/apps/apps.integration.test.ts"
make image-pi4
make test-vm TEST="source/modules/system/sd-card-only.pi.vm.test.ts"
```

Each JavaScript package owns its `package.json` and lockfile. Makefile invokes system scripts. Runtime script tests need Bash 4 or newer, Mike Farah's yq 4, jq, GNU coreutils, and envsubst; the macOS system Bash is insufficient. Integration tests require an isolated Linux development container. Never run application image-cleanup tests against a shared Docker daemon. VM tests require a corresponding built image, QEMU, and a machine target selected according to the repository skill.

The development container masks `systemd-binfmt.service` with a read-only mount to prevent container initialization from resetting the host's architecture emulation registrations. Do not manually register binfmt handlers from a container on a shared Docker host. Development startup waits for dashboard readiness and fails with instructions to inspect instance logs when the timeout expires.

## Data and authentication

First boot requires an empty data directory. `.panel-data.json` records the system data format and version. Old directories, unknown versions, and old backups are rejected without deleting their contents. Photo account state and file indexes have new initial database versions. Version mechanisms remain available for future evolution of this system.

Browser sessions include browser information and support two-factor authentication, revocation, WebSocket tickets, and application gateway authorization. Internal commands and necessary system calls use separate credentials. Members have individual Home directories; application access follows member grants. Application installation, updates, uninstallation, and repository management require an administrator.

Apple standalone clients, native-client login/refresh/discovery/pairing, phone photo backup protocols, and historical migrations have been removed. SMB, mobile browsers, browser HTTPS, Web uploads, and local photo indexing remain available.

The system retains Rugix's A/B boot layout and resets the writable root overlay on reboot. Permanent packages, services, and defaults are baked into every customized image. User homes and declared application data remain persistent; explicit factory reset restores the image's initial data. The panel host terminal follows the Linux account's login shell. System updates use the configured repository's stable releases, verified Rugix bundles, trial boot, and a separate health service before committing a slot. The panel and system share one release. See [system updates](system-updates.md) for the release contract and shared-data rollback boundary, and [system builds](../packages/system/README.md) for image customization.

## Language and translations

Write project documentation and code comments in English. Preserve localized interface text and Unicode test fixtures. Existing interface translations remain. New custom application interface entries have English and Chinese text, with English fallbacks for other locales. Use the existing generation and snapshot checks in `packages/frontend/scripts/translations.mjs`; passing these checks does not imply human review of every translation.
