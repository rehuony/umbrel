# System Development Documentation

This repository contains the Web dashboard, Node.js / TypeScript server, and source
for building flashable system images. Applications use the original app-store
configuration, with a form for importing custom Docker Compose applications.

| Reference                                                                        | Contents                                                         |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Architecture and development](architecture.md)                                  | Component boundaries, toolchain, authentication and translations |
| [Applications](applications.md)                                                  | Application configuration and custom Compose imports             |
| [External access](external-access.md)                                            | Direct service ports, public launch URLs and application login   |
| [Cloud connections](cloud-connections.md)                                        | Public OAuth clients, copy-code callbacks and token refresh      |
| [System updates](system-updates.md)                                              | Release source, verified bundles, boot health and rollback       |
| [Verification](validation.md)                                                    | Test commands, environments and release acceptance boundaries    |
| [System images](../packages/system/README.md)                                    | Build inputs, hardware targets and persistent state              |
| [Photos service contract](../packages/backend/source/modules/photos/CONTRACT.md) | Account-scoped media API                                         |
| [Photos read model](../packages/backend/source/modules/photos/README.md)         | Reader workers, projection consistency and schema recovery       |

Raspberry Pi 4 with 8 GB RAM and ARM64 is the primary hardware target. Raspberry Pi 5,
generic ARM64 and AMD64 build targets remain supported. System images discard
runtime root modifications on reboot. Permanent tools, services and defaults
belong in the image customization inputs; user data and home directories remain
persistent. Installation on an existing Debian host remains deferred.
