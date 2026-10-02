# System Development Documentation

This repository contains the Web dashboard, Node.js / TypeScript server, and source for building flashable system images. Applications use the original app-store configuration, with a form for importing custom Docker Compose applications.

- [Architecture and development](architecture.md)
- [Application configuration and custom Compose](applications.md)
- [Validation record](validation.md)
- [System images](../packages/system/README.md)
- [Photos service contract](../packages/backend/source/modules/photos/CONTRACT.md)

Validation prioritizes Raspberry Pi 4 with 8 GB RAM and ARM64. Raspberry Pi 5, generic ARM64, and AMD64 build targets remain supported. A writable system root, installation on an existing Debian host, and configurable external reverse-proxy entry URLs are deferred.
