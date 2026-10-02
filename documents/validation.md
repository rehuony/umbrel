# Refactor and Validation Record

## Bash, SSH policy, and Ghostty customization

The current customization selects Bash for both `umbrel` and `root`, seeds Bash aliases and prompts plus Vim defaults, and keeps Zsh installed as an optional shell without selecting it or seeding Zsh defaults. The existing `eza` package selection is retained. SSH permits public-key authentication only; no login keys or panel key-management feature are included. Ghostty 1.3.1 terminfo is compiled into the image's global terminal database.

The customization VM scenario now performs low-level assertions through the existing authenticated owner WebSocket terminal. It does not inject SSH keys or weaken SSH policy for testing. Other VM scenarios using the shared password-based SSH helper require separate test-transport adaptation before they can run against these images; their earlier results below do not validate the new SSH policy.

- Backend type checking, focused formatting, Bash syntax checks, and `git diff --check` passed. The six build orchestration tests and three terminal lifecycle unit tests passed.
- The exported Ghostty description compiled successfully in a separate Debian 13 container, and `tput colors` returned 256 without a terminal-type error.
- Generic ARM64, Raspberry Pi 4, and Raspberry Pi 5 images were rebuilt with version `3d7d915-dirty-20261002042813`; all three adjacent SHA-256 files passed independent verification. The successful build cleaned its temporary workspace and lock.
- The updated `system-customization.vm.test.ts` passed in 183 seconds on the QEMU `umbrel-home` ARM64 profile using the new ARM64 image. It verified owner registration; Bash as the default for `umbrel` and `root`; installed Zsh and eza; aliases and distinct user/root prompt colors; global Ghostty terminfo and terminal capability lookup; effective public-key-only SSH policy with no preinstalled login keys; personal Bash configuration through the actual WebSocket terminal; two guest-initiated reboots; discarded runtime package, root-file, and service changes; persistent user configuration and files; and explicit factory reset. No forced-shutdown fallback occurred.
- Nested interactive shells in the test run in separate terminal sessions so they cannot take over the Web terminal's TTY. This fixes the test's initial wait timeout without changing production terminal behavior.
- Physical Raspberry Pi acceptance, a Ghostty-to-device SSH login, and the other SSH-dependent VM suites were not performed. AMD64 and the USB installer remain unverified on this host. No panel SSH key management or online update service was implemented.

## Previous build and customization refactor

The preceding build refactor separated root filesystem sources, image definitions, orchestration, VM tools, and the USB installer. Outputs live under `packages/system/build/images/`. The root overlay is explicitly discarded on reboot. Permanent customizations have a build-time package list, file tree, and setup script; the first customization installs Zsh, selects it for the host account, and seeds personal shell defaults. The panel terminal follows the account shell.

- Six build orchestration tests, three terminal unit tests, and four VM port-retry unit tests passed.
- Backend type checking, focused formatting, 22 shell syntax checks, Zsh configuration syntax, Makefile command expansion, VM help, and `git diff --check` passed.
- Generic ARM64, Raspberry Pi 4, and Raspberry Pi 5 image construction and independent SHA-256 verification passed. Build version: `3d7d915-dirty-20261002032628`.
- The `system-customization.vm.test.ts` scenario passed in 116 seconds on the QEMU `umbrel-home` ARM64 profile. It verified fresh registration, baked-in Zsh, the host account shell, actual authenticated WebSocket terminal output, personal shell startup configuration, two guest-initiated reboots, removal of a temporary Debian package and root-file/service changes, preservation of user data, and explicit factory reset. No forced shutdown fallback was reported in this run.
- Application-owned TLS VM regression passed on the new ARM64 image in 279 seconds: Compose import, live application HTTPS, panel HTTPS, application restart, power cycle, and uninstall. No forced shutdown fallback was reported.
- The build exited successfully and removed its temporary workspaces and lock. Physical Raspberry Pi boot, network, storage, and application acceptance have not been performed.
- AMD64 preflight still fails with a host execution-format error; the AMD64 image and USB installer have not been rebuilt. Host emulation registrations and existing service containers were left unchanged. Image CI now selects native ARM64 runners for ARM targets and an AMD64 runner for AMD64; this workflow has not been dispatched.
- The upstream online updater remains removed. A/B boot support is retained; a custom update channel, health-gated slot commit, and shared-data rollback still require their own implementation and acceptance tests.

The historical results below predate these build and shell changes.

## Previous foundation validation

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

Runtime root persistence is deliberately excluded: system changes belong in the image; user data stays persistent. Standalone installation on existing Debian hosts, configurable external reverse-proxy entry URLs, and a self-hosted online system update service remain outside the current stage.

## Built artifacts

Paths are relative to the repository root. All three images below contain the current Bash customization, optional Zsh, public-key-only SSH policy, Ghostty terminfo, and disposable-root configuration, with version `3d7d915-dirty-20261002042813`. Images and checksums are local, ignored build outputs; they have not been published.

| Target                   | Image                                             | Checksum                    |
| ------------------------ | ------------------------------------------------- | --------------------------- |
| Raspberry Pi 4           | `packages/system/build/images/umbrelos-pi4.img`   | `umbrelos-pi4.img.sha256`   |
| Raspberry Pi 5 / tryboot | `packages/system/build/images/umbrelos-pi.img`    | `umbrelos-pi.img.sha256`    |
| Generic ARM64            | `packages/system/build/images/umbrelos-arm64.img` | `umbrelos-arm64.img.sha256` |

Successful image construction and checksum verification do not establish hardware boot compatibility or physical Raspberry Pi acceptance.

## Environment notes

- Package renaming required an explicit `umbreld` executable mapping and an image-build assertion. The backend development launcher uses the current executable directly and does not depend on removed root npm metadata.
- Runtime script tests require Bash 4+, Mike Farah yq 4, jq, GNU coreutils, and envsubst. CI installs these prerequisites; the macOS system Bash is insufficient.
- Development containers previously reset OrbStack's architecture emulation registrations through `systemd-binfmt`. New containers mask that service, and the existing test containers have been adjusted. ARM-only builds check only their required architecture. Restoring AMD64 execution may require an OrbStack restart, which would interrupt the user's PostgreSQL and Redis containers; restart approval is pending, so no restart was performed.
- Virtual machine network initialization inside the OrbStack development container is limited by missing host `tc` checksum-action support. The VM feature is retained but is not considered validated by unit or container tests.
- Dependency installation reports existing advisories. This work does not constitute a dependency security audit or a claim that all dependencies are free of vulnerabilities.
