# Refactor and Validation Record

This record covers the Web-only system foundation. The backend remains Node.js / TypeScript. Image artifacts are local; no remote publication has been performed.

## Implemented scope

- Packages are named `frontend`, `backend`, and `system`. Makefile provides development, verification, and image-build commands.
- Apple standalone clients, client-specific authentication/discovery/pairing, promotional assets, phone photo backup protocols, and their release workflows have been removed. Responsive browsers, SMB, browser HTTPS, and application-owned TLS remain supported.
- Applications retain `umbrel-app.yml`, `docker-compose.yml`, official/community stores, and the original runtime. Administrators can import custom Compose files with required application metadata through the same installation and update pipeline.
- Uninstallation removes application directories and owned data. Custom applications also lose their local source definitions. Existing member grants, safe data-directory cleanup, and shared user-directory protections remain in place.
- Fresh installations require empty data directories. System data, photo state, and file indexes have explicit initial format versions. Unsupported old data and backups are rejected without deleting them.
- Historical installation migrations, Mender artifacts, legacy USB installation detection, upstream system update services, and remote system upgrade scripts have been removed. Rugix boot and ordinary USB storage remain.
- Project instructions and VM testing guidance have been rewritten. Work proceeds in the current checkout without worktrees. The obsolete analysis worktree and redundant historical task branches were removed through Git.
- The entire `examples/` directory and its ignore rules have been removed. No separate remote application repository was created or published.
- Project documentation and comments use English; localized interface content and Unicode test fixtures are retained.

## Validation results

These results exercise the restored original application configuration. Results from the superseded `x-panel` implementation are excluded.

- Backend unit tests: **128 files passed, 1,515 tests passed, 1 skipped**.
- Frontend tests: **115 files and 876 tests passed**, plus **47 Node script tests passed**.
- Original application lifecycle and image-cleanup integration: **66 tests passed** in an isolated Linux development container. The **57 lifecycle tests** were rerun successfully with the final package paths. Store and repository integration contributed another **29 passing tests**.
- Custom Compose integration: **1 scenario passed** after package renaming, covering metadata preview, installation, actual HTTP responses, stop, update with persistent data, and uninstallation removing both the application directory and local source.
- Browser authentication integration: **6 tests passed**. Web photo upload and member directory isolation: **1 scenario passed**.
- Backend and frontend unit suites were rerun successfully after renaming. Final type checks, formatting, frontend lint, translation checks, 34 shell syntax checks, production frontend build, and `git diff --check` passed. The frontend build reports existing bundle-size warnings.
- Desktop Chrome verification passed: browser login, metadata form, Compose paste, installation, store listing, application details, update to a new version, and opening the application through its authenticated gateway. The container returned its actual Web response. The initial Alpine test fixture lacked `httpd`; it was replaced with BusyBox, and integration coverage now asserts a live HTTP response before and after update.
- The browser viewport override did not take effect, so this run does not claim a fresh mobile viewport validation. File-chooser upload was not exercised because the browser extension lacked local file access; Compose paste was verified instead.
- Fresh Raspberry Pi 4, Raspberry Pi 5, and generic ARM64 images built successfully from the final runtime source and package layout. All three adjacent SHA-256 checksum files were verified successfully. Build version: `d45ed5d-1790876432`.
- QEMU ARM64 validation: **1 scenario passed** in 173 seconds using the `umbrel-home` profile, hardware acceleration, four virtual CPUs, and 2 GB RAM. It exercised initial boot, registration, custom application TLS, application restart, another system boot, and uninstallation. The harness logged one forced-termination fallback after its 30-second graceful shutdown deadline. Application recovery passed, but this is not evidence that normal shutdown completed successfully; graceful shutdown needs separate follow-up.
- AMD64 execution remains blocked by the host emulation configuration. OrbStack has not been restarted.
- Physical Raspberry Pi 4 / 8 GB testing, other hardware boot tests, and actual Hermes Agent / Immich / Tailscale deployments have not been completed.

A writable system root, standalone installation on existing Debian hosts, configurable external reverse-proxy entry URLs, and a self-hosted online system update service remain outside this stage.

## Built artifacts

Paths are relative to the repository root. Images and checksums are local, ignored build outputs; they have not been published.

| Target                   | Image                                      | Checksum                    |
| ------------------------ | ------------------------------------------ | --------------------------- |
| Raspberry Pi 4           | `packages/system/build/umbrelos-pi4.img`   | `umbrelos-pi4.img.sha256`   |
| Raspberry Pi 5 / tryboot | `packages/system/build/umbrelos-pi.img`    | `umbrelos-pi.img.sha256`    |
| Generic ARM64            | `packages/system/build/umbrelos-arm64.img` | `umbrelos-arm64.img.sha256` |

Successful image construction and checksum verification do not establish hardware boot compatibility or physical Raspberry Pi acceptance.

## Environment notes

- Package renaming required an explicit `umbreld` executable mapping and an image-build assertion. The backend development launcher uses the current executable directly and does not depend on removed root npm metadata.
- Runtime script tests require Bash 4+, Mike Farah yq 4, jq, GNU coreutils, and envsubst. CI installs these prerequisites; the macOS system Bash is insufficient.
- Development containers previously reset OrbStack's architecture emulation registrations through `systemd-binfmt`. New containers mask that service, and the existing test containers have been adjusted. ARM-only builds check only their required architecture. Restoring AMD64 execution may require an OrbStack restart, which would interrupt the user's PostgreSQL and Redis containers; restart approval is pending, so no restart was performed.
- Virtual machine network initialization inside the OrbStack development container is limited by missing host `tc` checksum-action support. The VM feature is retained but is not considered validated by unit or container tests.
- Dependency installation reports existing advisories. This work does not constitute a dependency security audit or a claim that all dependencies are free of vulnerabilities.
