# Verification

Use the current source revision, manifests and executable workflows as the
validation baseline. Record commands, environment, results and unverified targets
with the change or release being reviewed. Historical test counts and old image
paths do not establish that a later revision is validated.

## Local checks

Install the Node.js version in [`.nvmrc`](../.nvmrc), enable Corepack, and run
`make deps` from the repository root. The root package manifest pins pnpm; CI and
image builds use the workspace lockfile with `--frozen-lockfile`.

| Command                   | Coverage                                                                |
| ------------------------- | ----------------------------------------------------------------------- |
| `make typecheck`          | Backend, frontend and frontend build configuration types                |
| `make format-check`       | Backend and frontend formatting                                         |
| `make lint`               | Frontend lint rules                                                     |
| `make translations-check` | Locale structure, source freshness and translation workflow tests       |
| `make test`               | Backend unit tests, frontend tests and system build orchestration tests |
| `make build-frontend`     | Production dashboard bundle                                             |
| `git diff --check`        | Whitespace errors in the patch                                          |

Run focused tests while editing, then the checks appropriate to the final change.
Runtime-script tests need Bash 4 or newer, Mike Farah's yq 4, jq, GNU coreutils and
`envsubst`; the macOS system Bash is insufficient. See
[continuous integration](../.github/workflows/ci.yml) for the maintained Linux
setup and [translation checks](../.github/workflows/check-translations.yml) for
the locale checks. The formatting commands discover Markdown files through Git, including new source
files while excluding ignored output and deleted files. They use the existing
Prettier executable and shared configuration.

`make test-system` uses stubbed Docker and remote transport commands. It covers
build target selection, shared root archives, locking, failure preservation,
checksums and argument forwarding. It does not build or boot an image.

## Linux integration

Integration tests require an isolated Linux development container and its system
services. Use the existing [development commands](architecture.md#development-commands)
and select a test through `make test-integration TEST="source/...integration.test.ts"`.
Do not run application image-cleanup tests against a shared Docker daemon.

Changes to authentication, cloud connections, storage or application lifecycle
need their corresponding behavioral tests. Preserve negative cases for revoked
sessions, member permissions, account isolation, interrupted uploads and failed
writes. Real filesystem and process tests complement mocked unit tests; neither
alone establishes physical-device behavior.

## Images and virtual machines

Follow [system image instructions](../packages/system/README.md) to build the
requested hardware target and verify its adjacent SHA-256 file. Check the
embedded version and artifact metadata as well: a previously generated image can
still exist after a later build fails. Test image and update-bundle integrity
separately from successful boot.

Use the repository's [VM testing guidance](../.agents/skills/system-vm-testing/SKILL.md)
when authoring or running machine scenarios. The customization scenario uses the
authenticated WebSocket terminal and checks actual reboots, persistent user data,
disposable root changes and factory reset. Fresh images enforce public-key-only
SSH with no bundled login keys; scenarios using the older password-based SSH
helper need a compatible test transport before they can validate these images.
Do not weaken production SSH policy to make a test pass.

The [system update scenario](system-updates.md#verification) requires two compatible
images with different stable versions. It tests bundle verification, inactive-slot
installation, boot health, rollback and persistent data. Its local release fixture
does not validate a live GitHub release download. Report QEMU results separately
from physical Raspberry Pi results, with the tested target and acceleration mode.

## Release acceptance

The [release workflow](../.github/workflows/release.yml) builds target artifacts and
creates a draft release. Passing the workflow does not replace these environment-
specific acceptance checks:

- Boot and recover on each claimed hardware target, including networking and storage.
- Exercise updates and rollback against the intended release source while retaining user data.
- Verify [external access](external-access.md) through the actual reverse proxy, including login callbacks, WebSockets and denied access.
- Verify [cloud authorization](cloud-connections.md) with registered clients and the deployed callback page. Test cancellation, token refresh, expiry and account isolation. Empty registration fields deliberately keep new connections unavailable.
- Check desktop and narrow-screen interactions; terminal soft keyboards require a real mobile browser.
- Measure large-file and many-small-file transfers on the target disk and network, checking file contents and bounded memory. Local benchmarks do not prove Raspberry Pi throughput.

Report missing prerequisites, skipped tests and warnings explicitly. Keep
credentials, personal data, build output and temporary benchmark results out of
source control; use CI artifacts or the release's verification record for run-specific evidence.
