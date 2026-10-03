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

The frontend and backend form one pnpm workspace. Each package owns its manifest; `pnpm-lock.yaml` at the repository root locks the complete dependency graph. Use Node.js 24 (the exact version is in `.nvmrc`) and enable Corepack before running `make deps`; `package.json` pins pnpm. CI and image builds install with `--frozen-lockfile`. Makefile remains the entry point for development, verification, and system scripts. Runtime script tests need Bash 4 or newer, Mike Farah's yq 4, jq, GNU coreutils, and envsubst; the macOS system Bash is insufficient. Integration tests require an isolated Linux development container. Never run application image-cleanup tests against a shared Docker daemon. VM tests require a corresponding built image, QEMU, and a machine target selected according to the repository skill.

The development container mounts a writable root `node_modules` plus package-local dependency directories over the read-only checkout. A successful-install stamp covers the runtime, package manager, manifests, workspace settings, and lockfile. Production images deploy a self-contained backend, with no symlinks into the temporary workspace and no runtime package-manager lookup. The Node TypeScript configuration preset is a production dependency because the `tsx` entrypoint reads it at startup.

Root Bash scripts use `.sh` extensions: `scripts/umbrel-dev.sh` manages the development container, and `scripts/remote-builder.sh` dispatches remote builds and tests. The existing `packages/system/scripts/build.test.mjs` suite also verifies remote argument forwarding and the pnpm invocation locally with stubbed transport commands; it never contacts a remote host. These regressions run through `make test-system`.

Image construction runs the deployed backend's `scripts/check-runtime.mjs` after removing its temporary workspace. This checks CLI startup and real SQLite and terminal execution, catching missing production dependencies and native ABI problems before image packaging. Host-generated frontend assets are excluded from the build context; installation regenerates the icons from the locked package version.

Dependency build scripts are explicitly reviewed in `pnpm-workspace.yaml`; do not approve unknown scripts to silence installation failures. `packages/backend/scripts/node-pty.patch` is the single maintained dependency fix and is copied into image build workspaces. It restores the missing executable permission in its stable macOS prebuild (upstream issue [microsoft/node-pty#850](https://github.com/microsoft/node-pty/issues/850)); it has no effect on Linux. Update or remove it when adopting an upstream fixed stable release. Use a physical destination path when testing `pnpm deploy` on macOS: its patch resolver does not correctly resolve destinations beneath the `/tmp` symlink; `/private/tmp` works.

TypeScript 6 is paired with the supported TypeScript ESLint parser. Vite 8 uses Rolldown and the Babel React Compiler preset; the editor UI and production UI use the same compiler. React Router 7 includes the transition behavior previously enabled by the v6 future flag. Type checking covers both application source and the Vite configuration. See the [toolchain validation record](validation.md#pnpm-and-typescript-toolchain-migration) for tested versions and upgrade boundaries.

The development container masks `systemd-binfmt.service` with a read-only mount to prevent container initialization from resetting the host's architecture emulation registrations. Do not manually register binfmt handlers from a container on a shared Docker host. Development startup waits for dashboard readiness and fails with instructions to inspect instance logs when the timeout expires.

## Data and authentication

First boot requires an empty data directory. `.panel-data.json` records the system data format and version. Old directories, unknown versions, and old backups are rejected without deleting their contents. Photo account state and file indexes have new initial database versions. Version mechanisms remain available for future evolution of this system.

Browser sessions include browser information and support two-factor authentication, revocation, WebSocket tickets, and application gateway authorization. Internal commands and necessary system calls use separate credentials. Members have individual Home directories; application access follows member grants. Application installation, updates, uninstallation, and repository management require an administrator.

Apple standalone clients, native-client login/refresh/discovery/pairing, phone photo backup protocols, and historical migrations have been removed. SMB, mobile browsers, browser HTTPS, Web uploads, and local photo indexing remain available.

The system retains Rugix's A/B boot layout and resets the writable root overlay on reboot. Permanent packages, services, and defaults are baked into every customized image. User homes and declared application data remain persistent; explicit factory reset restores the image's initial data. The owner-only Terminal dock shortcut and search command open the host login shell directly; container terminals remain in each application's advanced settings. Terminal windows share the panel sheet layout and retain their shell session when resized. Authenticated terminal WebSockets use text frames for shell input and binary JSON controls (`type: resize`, `cols`, `rows`) for dimensions; resize controls are validated and never passed to the shell. System updates use the configured repository's stable releases, verified Rugix bundles, trial boot, and a separate health service before committing a slot. The panel and system share one release. See [system updates](system-updates.md) for the release contract and shared-data rollback boundary, and [system builds](../packages/system/README.md) for image customization.

## Language and translations

Write project documentation and code comments in English. Preserve localized interface text and Unicode test fixtures. Existing interface translations remain. New custom application interface entries have English and Chinese text, with English fallbacks for other locales. Use the existing generation and snapshot checks in `packages/frontend/scripts/translations.mjs`; passing these checks does not imply human review of every translation.
