#!/usr/bin/env bash
set -euo pipefail

# Pin the Nix Docker image.
NIX_IMAGE="nixos/nix@sha256:bf1d938835ab96312f098fa6c2e9cab367728e0aad0646ee3e02a787c80d8fb8" # 2.34.7

# Allow running from anywhere
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run a command inside the pinned Nix container. The repo's packages/system
# directory is mounted at /data and the Nix store is kept in a named volume
# so consecutive runs (e.g. base build then image injection) are fast.
nix_container() {
    docker run --rm --platform linux/amd64 \
        --volume umbrelos-usb-installer-nix:/nix \
        --volume "$(cd .. && pwd)":/data \
        --workdir /data/installer \
        "${NIX_IMAGE}" \
        bash -c "$1"
}

# filter-syscalls is disabled so builds also work under QEMU/Rosetta emulation
# (e.g. building the amd64 ISO on an Apple Silicon machine).
nix="nix --extra-experimental-features 'nix-command flakes' --option filter-syscalls false --print-build-logs"

# Build the installer ISO without an umbrelOS image. This is the slow part of
# the build and doesn't depend on the umbrelOS image, so CI can run it
# concurrently with the umbrelOS image build.
build_base() {
    echo "Building base USB installer ISO..."
    mkdir -p ../build/images ../build/installer
    nix_container "
        ${nix} build path:.#iso -o /tmp/result &&
        cp -fL /tmp/result/iso/umbrelos-amd64-usb-installer.iso /data/build/installer/umbrelos-amd64-usb-installer-base.iso
    "
}

# Compress and embed the raw AMD64 image into the base ISO to produce the final
# installer ISO. This is fast so the umbrelOS image can be dropped in as the
# last step of the build.
inject_image() {
    echo "Injecting umbrelOS image into USB installer ISO..."
    (cd ../build/images && shasum -a 256 -c umbrelos-amd64.img.sha256)
    nix_container "
        ${nix} build path:.#inject-umbrelos-image -o /tmp/inject &&
        /tmp/inject/bin/inject-umbrelos-image \
            /data/build/installer/umbrelos-amd64-usb-installer-base.iso \
            /data/build/images/umbrelos-amd64.img \
            /data/build/installer/umbrelos-amd64-usb-installer.iso
    "
    (cd ../build/installer && shasum -a 256 umbrelos-amd64-usb-installer.iso > umbrelos-amd64-usb-installer.iso.sha256)
    mv ../build/installer/umbrelos-amd64-usb-installer.iso ../build/installer/umbrelos-amd64-usb-installer.iso.sha256 ../build/images/
}

command="${1:-all}"
case "${command}" in
    base) build_base ;;
    inject) inject_image ;;
    all) build_base && inject_image ;;
    *) echo "Usage: $0 [base|inject|all]" && exit 1 ;;
esac
