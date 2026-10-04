# System updates

The kernel, Debian packages, system services, backend, and frontend ship as one versioned system. The owner starts an update in **Settings → Software update**. The device installs an update bundle into the inactive Rugix boot group and restarts. It does not reflash the data partition or update the panel independently.

## Release source and version identity

`packages/backend/source/modules/system/updates/source.json` selects `rehuony/umbrel`, update protocol 1, and shared data format 1. Build tooling and the device read this same configuration. Fork maintainers must change it before building their own images. No Umbrel upstream update endpoint or downloaded shell script is used.

Only published, stable GitHub Releases with tags such as `v1.2.3` are eligible. Drafts and prereleases are ignored. The highest semantic version among the most recent 100 releases is selected. Empty release lists, inaccessible repositories, rate limits, incompatible bundles, and an already current installation are distinct results. Checks run when the owner opens or refreshes the update page; updates are never installed automatically.

Rugix's `/etc/rugix/system-build-info.json` supplies the installed version and exact hardware target. A Pi 4 cannot install a generic ARM64 or Pi 5 update. Environments without image metadata, including development containers, do not offer system updates. A non-semantic development image may be replaced by an explicitly confirmed stable release.

## Build and publish

```sh
make image VERSION=1.2.3
make release-manifest VERSION=1.2.3
```

Each target produces a flashable `.img`, a `.rugixb` update bundle, adjacent SHA-256 files, and a `.update.json` build record under `packages/system/build/images/`. The release manifest command verifies all four records against the actual bundles before writing `system-release.json`. Never mix targets from different versions.

**Build System Release** is the only GitHub Actions image entry point. A manual run selects one hardware target or all four, reuses **Verify System** checks, and uploads `system-<target>` artifacts without creating a release. All targets in that run share a source-revision and timestamp version. Flash images use XZ compression to stay within GitHub's per-asset release limit. Download and extract the artifact, verify the `.img.xz.sha256`, decompress the image with `xz -d`, and verify its `.img.sha256` before flashing.

A pushed stable version tag builds all four targets. The workflow validates the repository identity, reuses the full source checks, builds on native ARM64 and AMD64 runners, compresses flash images, and runs the existing AMD64 boot and persistence scenario. Only after these checks pass does it assemble metadata and upload a **draft** release. Review the assets and release notes and complete device acceptance before publishing the draft. Published release assets must retain GitHub API SHA-256 digests; incomplete releases are rejected. Tag creation, pushing, and publication are explicit maintainer operations, not side effects of local or manual builds.

The initial image must already include this updater. Older custom images from before this implementation have no online update entry point; prepare a backup and provision an updater-enabled image separately. This does not add legacy system or backup migration support.

## Installation and recovery

1. The authenticated owner reviews the selected release and confirms downtime. The backend rechecks the release and serializes update requests. Members cannot manage system updates.
2. An independent systemd worker revalidates the release, boot identity, supported A/B layout, persistent storage, and download space. Progress lives in `/data/system-updates/` and survives panel restarts.
3. The complete bundle is downloaded with bounded size and duration. Its SHA-256 must agree with the manifest and GitHub release asset metadata. Rugix also receives the expected bundle header hash and verifies payload contents before applying them. Verification failures do not write a system slot.
4. Installation replaces only the inactive group. Its previous-version record is invalidated before writing. Installation failure is reported as failure and never triggers a successful-update message or an automatic reboot.
5. Rugix requests a trial boot. Normal systemd shutdown stops the panel, applications, and virtual machines. Browser connections reconnect after startup.
6. The health service requires persistent Rugix state, Docker availability, completed backend startup with the expected version, an available public Web endpoint, and a durable state write. Three consecutive checks must pass before the boot group is committed. An open API socket alone is insufficient.
7. An unhealthy trial reboots without committing, returning to the prior default group. A separate shell recovery service handles a broken Node runtime or health-service crash. A broken default group is not repeatedly rebooted.
8. After successful acceptance, the owner can explicitly return to the previous verified group through the same interface. The next installation overwrites that spare group; it is not an unlimited version history.

Interrupted downloads or installations are reported on the next boot. The update worker is bounded by systemd's timeout. A successful API response means the job was queued, not that installation succeeded. The durable status and boot health determine the final outcome.

The update protocol trusts the configured GitHub repository and GitHub's HTTPS API as the release authority. Checksums protect integrity; this version does **not** provide an independent publisher signature or an offline signing-key trust chain. Repository and release permissions therefore matter. No authentication tokens are embedded in images; the repository and release assets must be public.

## Data and rollback boundaries

The writable root is still reset on reboot. Permanent system customization must be baked into each new image. User homes, application data, and panel settings remain on shared persistent storage. Restoring a system group does not restore or erase those files.

Only releases declaring the current update protocol and shared data version are accepted. Maintainers must change the data version when a release introduces incompatible persistent changes. Such a transition requires a separately designed backup, migration, and recovery procedure; falsely declaring compatibility makes OS rollback unsafe. Application-specific migrations performed by third-party applications are not reversed by an OS rollback. Keep normal data backups before upgrades.

If the panel is unavailable but a console remains accessible, inspect:

```sh
systemctl status panel-update.service panel-update-health.service
journalctl -u panel-update.service -u panel-update-health.service -u panel-update-recover.service
cat /data/system-updates/status.json
rugix-ctrl system info
```

The health service and its shell fallback do not depend on the Web UI. They cannot recover every firmware, bootloader, hardware, or data-device failure. If neither system can boot, use separate rescue media and preserve the data disk before repair. SSH access still requires separately provisioned keys; this feature does not add key management.

## Verification

```sh
make test-system
pnpm --dir packages/backend test updates/ --exclude '**/*.vm.test.ts'
make test-frontend ARGS=src/routes/settings/software-update.test.tsx
UPDATE_TEST_IMAGE=/absolute/path/to/baseline.img \
UPDATE_TEST_ARTIFACT=/absolute/path/to/candidate.update.json \
  pnpm --dir packages/backend test updates/system-update.vm.test.ts --maxWorkers=1
```

The VM scenario uses two actual images with different stable versions and the `umbrel-home` profile. A local fixture replaces release HTTP transport inside the guest; checksum verification, slot installation, reboot, health commit, manual rollback, automatic fallback on a mismatched release version, and persistent user/application data use the real system. It does not publish a remote release or prove physical Raspberry Pi behavior. See the [verification guide](validation.md) for environment prerequisites and release acceptance boundaries.

References: [Rugix system updates](https://rugix.org/docs/ctrl/updates/system-updates/) and [GitHub Releases API](https://docs.github.com/en/rest/releases/releases).
