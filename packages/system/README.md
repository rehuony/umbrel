# System Images

This package builds the Debian system, packages bootable images, and runs local QEMU machines. Run its public commands through the repository's Makefile.

## Layout

```text
system/
├── rootfs/
│   ├── Dockerfile         # Debian, kernel, runtime dependencies, and panel
│   ├── scripts/           # Root filesystem installation steps
│   ├── files/common/      # Files installed on every platform
│   ├── files/raspberrypi/ # Raspberry Pi-specific files
│   ├── custom/            # Packages, account defaults, SSH policy, and terminfo
│   └── assets/            # Package checksums and build-time configuration
├── images/
│   ├── rugix-bakery.toml  # Hardware targets and image partition layouts
│   ├── layers/            # Root imports, target recipes, and Ctrl versions
│   └── recipes/           # Boot setup, persistent state, and reset hooks
├── scripts/               # Build orchestration and pinned Bakery runner
├── vm/                    # QEMU management
├── installer/             # Optional NixOS USB installer
└── build/                 # Generated files; never committed
    ├── images/            # Images, update bundles, metadata, and SHA-256 files
    ├── installer/         # USB installer intermediate files
    ├── vm/                # Local VM state, unless VM_STATE_DIR overrides it
    └── work.*/            # Per-run root archives and Rugix work files
```

System files mirror their installed paths inside each `files/` directory. Platform configuration remains declarative; shell scripts orchestrate tools without embedding partition layouts. There are no generated configuration files in the source directories.

## Build commands

| Command                                | Output under `build/images/`                      |
| -------------------------------------- | ------------------------------------------------- |
| `make image-pi4`                       | `umbrelos-pi4.img`                                |
| `make image-pi5`                       | `umbrelos-pi.img`, using Rugix tryboot            |
| `make image-arm64`                     | `umbrelos-arm64.img`                              |
| `make image-amd64`                     | `umbrelos-amd64.img`                              |
| `make image`                           | All four targets                                  |
| `make image IMAGE_TARGETS="arm64 pi4"` | Only the selected targets                         |
| `make image-usb-installer`             | AMD64 installer ISO; requires a built AMD64 image |

Set `VERSION=...` to supply the embedded release version. Otherwise it contains the source revision, a dirty marker when appropriate, and a UTC build timestamp. Each successful image has an adjacent `.img.sha256` file, a `.rugixb` update bundle, its checksum, and a `.update.json` record. Existing images for other targets are left untouched, so their existence is not evidence that they were rebuilt.

The build checks Docker execution support for all requested architectures first, builds each required root filesystem once, and runs Rugix against a fresh working copy of `images/`. Pi 4 and Pi 5 share a root archive. Docker layers and Rugix downloads remain cached; path-keyed Rugix build layers do not cross build runs. Completed artifacts are copied to `build/images/` after checksum generation. A failed target leaves its previous final artifact untouched.

A lock prevents concurrent image builds from sharing an output directory. `SYSTEM_BUILD_DIR` selects a different output directory; `make release-manifest` uses the same directory; VM consumers need an explicit image path. Set `KEEP_BUILD_WORK=true` to retain the temporary workspace for diagnostics. Interrupted runs that cannot execute cleanup may leave `.build-lock`; remove it only after confirming no build still uses that directory.

Builds require Node.js 24 (see `.nvmrc`), Corepack-enabled pnpm, Docker, Buildx, `shasum`, and permission to run privileged Rugix containers. The host must already support the requested CPU architecture. The AMD64 root also requires SSSE3 support. The scripts never install or replace host emulators. Tool versions and checksums remain pinned in the Dockerfile, package checksum asset, Bakery runner, and image layers according to the tool they configure.

For GitHub-hosted builds, open **Actions → Build System Release → Run workflow**.
Choose the source branch and a target (`pi4`, `pi5`, `arm64`, `amd64`, or `all`).
The workflow runs the shared source checks and uploads `system-<target>` artifacts
containing compressed flash images, update bundles and checksums. Pi 4 uses
`umbrelos-pi4.img.gz`; Pi 5 uses `umbrelos-pi.img.gz`. Verify the compressed
checksum, decompress the image, and verify the original image checksum before
flashing. Manual builds do not create releases. Stable version tags build all
targets and prepare a draft release; see [system updates](../../documents/system-updates.md#build-and-publish).

## Image customization

Maintain permanent system changes in `rootfs/custom/`:

- `packages.list`: additional Debian package names, one per line. Blank lines and `#` comments are allowed. Packages come from the image's pinned APT snapshot.
- `files/`: files copied over the base root filesystem, preserving their paths and modes. Put service units under `files/etc/systemd/system/` and account defaults under `files/etc/skel/`.
- `configure.sh`: build-time setup after packages and files are installed. Use it to configure accounts or enable image-owned services with `systemctl enable`; do not start services during the build.
- `terminfo/`: portable terminal descriptions compiled into `/usr/share/terminfo` with `tic -x` during the build.

The same customization runs on all four platforms before initramfs generation and initial data seeding. Boot layout and Rugix state settings are owned by `images/`; the packaging recipe takes its final hostname and hosts files from `rootfs/files/common/etc/`. Keep package selections and scripts architecture-compatible, or branch explicitly on the image architecture when necessary. Rebuilding future versions with the same maintained inputs includes these customizations again; ad-hoc changes made on a running device are not captured automatically.

Both `umbrel` and `root` use Bash by default. The image seeds `.bashrc`, `.bash_aliases`, `.vimrc`, and `.hushlogin` for both accounts. Prompts use green for ordinary users and red for root, with a blue working directory. Aliases include `ll`, `la`, `l`, and `cls`; the explicit `quit` alias clears that account's Bash history before exiting, matching the reference initialization script. Normal `exit` retains history. Vim uses line numbers, UTF-8, and four-space indentation, with swap and backup files disabled. `.hushlogin` silences compatible login transports; the panel terminal still displays its own welcome text.

Zsh remains preinstalled as an optional shell, but is not selected by default; no Oh My Zsh framework or personal Zsh defaults are installed. The panel's host terminal follows the account's configured login shell; application-container terminals keep their existing behavior. Existing home directories are preserved during an image update; image defaults do not overwrite personal dotfiles. Panel members remain application accounts, not separate Linux login accounts. Root's baked-in configuration is restored on each reboot because `/root` remains in the disposable root filesystem.

The image owns SSH server policy in `files/etc/ssh/sshd_config.d/00-panel.conf`: port 22, public-key authentication only, no password or keyboard-interactive login, no empty passwords, root permitted only through public keys, and client keepalives every 60 seconds with three unanswered probes allowed. The build runs `sshd -t` without starting the service. No login public or private keys are bundled. A fresh installation therefore has no SSH login access until authorized keys are provisioned separately. Panel key management is deferred; browser login and the authenticated host terminal remain available. Existing per-device SSH host-key generation and persistence are unchanged.

Ghostty support is included for both accounts, including commands run through sudo. `terminfo/xterm-ghostty.terminfo` was exported from Ghostty 1.3.1 with `infocmp -x xterm-ghostty` (using the application's terminfo directory explicitly outside Ghostty). The build compiles it with `tic -x -o /usr/share/terminfo` and verifies the installed entry with `infocmp`. This is the image-time equivalent of [Ghostty's documented SSH installation](https://ghostty.org/docs/help/terminfo); it requires no download or SSH connection during boot. The upstream MIT license is retained under `files/usr/share/doc/ghostty-terminfo/`.

To add another tool, edit the package list, rebuild with `make image-pi4` (or another target), and validate the resulting image. To maintain a custom service, add its unit and configuration under `files/`, enable it in `configure.sh`, and store runtime state under the existing persistent data hierarchy. These scripts execute inside the image build, never on the build host or on every boot.

## Runtime state

Normal boots discard the writable root overlay and restore the customized image's system files. Runtime package installations and changes under `/etc`, `/usr`, `/opt`, `/root`, and ordinary `/var` paths are temporary. Tools, services, and defaults baked into the image remain available after every reboot.

Declared data stays persistent: `/data`, user homes, panel and application data, Docker state, logs, and the other existing mounts in `rootfs/files/common/etc/fstab`. Thus personal `.bashrc` and `.bash_aliases` edits and shell history under `/home/umbrel` survive a reboot, while a runtime `chsh` or APT installation must be encoded into the image to survive. Panel-managed settings are reapplied from their persistent state at startup.

The base system remains read-only, including SquashFS on Raspberry Pi. If the normal overlay cannot be mounted, the existing in-memory fallback still allows recovery. Explicit factory reset removes the active installation's managed user state and restores image defaults, including the seeded shell configuration; it does not remove packages baked into the image. The existing RAID recovery flow remains separate.

The shared configuration is `images/recipes/setup-rugix/files/state-data.toml`. It applies to all four targets. See the [Rugix state management documentation](https://rugix.org/docs/ctrl/state-management/) and the [pinned Ctrl configuration schema](https://github.com/rugix/rugix/blob/v1.2.1-dev.1/schemas/rugix-ctrl-state.schema.json).

## Upgrade boundary

The Rugix A/B layout and disposable-root state model remain intact. The configured repository's stable releases deliver the kernel, system services, and panel together. The owner installs a verified bundle into the inactive group and restarts; persistent user and application data remain in place. A separate health service commits the trial only after sustained core readiness and returns an unhealthy trial to the previous group.

Build-time APT snapshots remain pinned; runtime package or kernel upgrades are not the maintained upgrade path. Shared data format changes need a separate migration and recovery design, because switching OS slots cannot undo arbitrary database changes. The updater currently accepts only the same declared data format and update protocol.

See [system updates](../../documents/system-updates.md) for version checks, build artifacts, the draft release workflow, integrity verification, and recovery boundaries. Local builds do not publish artifacts. Flashing a full image is still a fresh installation that can overwrite data; use the update bundle for the supported A/B upgrade procedure. Legacy systems, Mender, old USB installations, and old backups are not imported.

## Verification

`make test-system` checks target selection, shared root builds, failure preservation, build locking, checksums, and architecture preflight using a fake Docker executable. Release metadata tests verify all four targets, versions, and bundle checksums. These are orchestration tests, not image boot tests.

After building the native image, run:

```sh
make test-vm TEST=source/modules/system/system-customization.vm.test.ts
```

This scenario uses the authenticated WebSocket terminal rather than password-based SSH. It checks Bash defaults for both accounts, the effective SSH server policy, Ghostty terminfo, temporary system changes, a local package, and personal shell configuration. After two real guest reboots, temporary root changes must be gone while the image customizations and user data remain. Factory reset must clear personal state while retaining the baked-in defaults. Use `make vm ARGS="help"` for manual QEMU operation. Report image builds, emulated boot tests, and physical Raspberry Pi validation separately.
