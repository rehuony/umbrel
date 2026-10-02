# System Images

Run Makefile targets from the repository root. Builds require Docker, Buildx, and permission to run privileged Rugix build containers. Cross-architecture root filesystem builds require Docker execution support for the target CPU architecture.

| Command            | Output                                                       |
| ------------------ | ------------------------------------------------------------ |
| `make image-pi4`   | `packages/system/build/umbrelos-pi4.img`                     |
| `make image-pi5`   | `packages/system/build/umbrelos-pi.img`, using Rugix tryboot |
| `make image-arm64` | `packages/system/build/umbrelos-arm64.img`                   |
| `make image-amd64` | `packages/system/build/umbrelos-amd64.img`                   |
| `make image`       | All four targets                                             |

Each image has an adjacent `.img.sha256` checksum file. Set `VERSION=...` to record a build version. Images require fresh installations and empty data directories. There is no migration from old systems, Mender, legacy USB data disks, or old backups. Builds do not generate historical update bundles or publish to upstream services.

`umbrelos.Dockerfile` builds the Debian root filesystem, Web dashboard, and Node.js server. `rugix/` supplies device boot chains, partitions, and flashable images. Runtime data remains on the persistent partition. Persisting arbitrary system root modifications is outside this stage.

See `make vm ARGS="help"` for QEMU commands. `make test-vm` runs VM tests. Record emulated Raspberry Pi tests separately from physical-device validation.

The AMD64 USB installer in `usb-installer/` installs the current image. It is separate from the removed legacy USB data-disk detection mechanism.
