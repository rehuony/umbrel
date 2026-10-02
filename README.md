# Personal System

A Web panel system based on Umbrel. It retains the existing panel design, multiple users and personal directories, files, Web photos, storage management, and virtual machines. The backend uses Node.js and TypeScript. Applications use the original app-store configuration and Docker Compose runtime, with an additional form for importing custom Compose applications.

The main components are `packages/frontend`, `packages/backend`, and `packages/system`. Use the root Makefile for development, verification, and image builds:

```sh
make help
make deps
make typecheck
make test
make build
make image-pi4
```

The primary hardware target is Raspberry Pi 4 with 8 GB RAM and ARM64. Raspberry Pi 5, generic ARM64, and AMD64 build targets remain available. A build target does not imply physical-device validation; see the [validation record](documents/validation.md) for actual results.

This release requires a fresh installation. Standalone clients, historical installation migrations, and the default upstream online system updater have been removed. Official and community app stores retain their original format. Administrators can import custom Compose files with an application name, icon, description, and other metadata. Uninstalling an application removes its application directory and owned data using the original cleanup rules.

[Development documentation](documents/README.md) · [Application configuration](documents/applications.md) · [Image builds](packages/system/README.md)

## License and provenance

The upstream Git history and licenses are retained. The original project is [getumbrel/umbrel](https://github.com/getumbrel/umbrel). See [LICENSE.md](LICENSE.md) and component licenses for applicable terms; this refactor does not change those terms.
