#!/usr/bin/env bash

set -euo pipefail

# Pin the Rugix Docker image.
export RUGIX_BAKERY_IMAGE="ghcr.io/rugix/rugix-bakery@sha256:41fbea6785fccec14e43d22501b50af8cb4812f3560fc5d5abf41e2607350ef7" # v0.9.3
# export RUGIX_VERSION="branch-main"
# export RUGIX_DEV=true

# Allow running from anywhere
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OS_BUILD_DIR="$(pwd)"

docker_buildx() {
    docker buildx build --load "$@"
}

# Check only the architectures requested by this build. An ARM-only image must
# not replace the host's emulators just because AMD64 execution is unavailable.
# amd64 emulation only counts as working if the container sees SSSE3 in
# /proc/cpuinfo: Rosetta and native hosts do, QEMU user-mode emulation doesn't
# (and Homebrew hard-fails on exactly that check during the amd64 root fs build).
host_emulation_is_good() {
    if [ -z "${SKIP_AMD64:-}" ]; then
        docker run --rm --platform linux/amd64 alpine grep -q ssse3 /proc/cpuinfo > /dev/null 2>&1 || return 1
    fi
    if [ -z "${SKIP_ARM64:-}" ] || [ -z "${SKIP_PI:-}" ]; then
        docker run --rm --platform linux/arm64 alpine true > /dev/null 2>&1 || return 1
    fi
}

# Run a command with sudo only in GitHub Actions
# These commands fail in GHA without sudo but they aren't needed locally and it's
# annoying for the script to get blocked and be prompted.
maybe_sudo() {
    if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
        sudo "$@"
    else
        "$@"
    fi
}

cleanup_os_build_intermediates() {
    local cleanup_failed=0

    echo "Cleaning OS build intermediates..."
    maybe_sudo rm -rf \
        "${OS_BUILD_DIR}/rugix/.rugix" \
        "${OS_BUILD_DIR}/rugix/build" \
        || cleanup_failed=1
    maybe_sudo rm -f \
        "${OS_BUILD_DIR}"/build/umbrelos-root-*.tar \
        || cleanup_failed=1

    return "${cleanup_failed}"
}

os_build_cleanup_enabled() {
    # CI checkouts are ephemeral, and release builds run concurrently in the same
    # checkout, so cleaning their shared Rugix state is unnecessary and unsafe.
    [ "${GITHUB_ACTIONS:-false}" != "true" ] \
        && [ "${SKIP_OS_BUILD_CLEANUP:-false}" != "true" ]
}

cleanup_os_build_intermediates_on_exit() {
    local build_exit_code=$?
    local cleanup_exit_code=0

    trap - EXIT
    if os_build_cleanup_enabled; then
        cleanup_os_build_intermediates || cleanup_exit_code=$?
    fi

    if [ "${build_exit_code}" -ne 0 ]; then
        exit "${build_exit_code}"
    fi
    exit "${cleanup_exit_code}"
}

# Main entrypoint.
function main() {
    trap cleanup_os_build_intermediates_on_exit EXIT

    release="${1:-}"
    dev="false"
    if [[ "${release}" == "" ]]
    then
        local git_hash
        git_hash="$(git rev-parse --short HEAD 2>/dev/null || echo "dev")"
        release="${git_hash}-$(date +%s)"
        dev="true"
    fi

    # Enable QEMU/binfmt-based multi-platform support for building arm64 on
    # amd64 or vice versa, e.g., to build for Pi 5 on an x86 system. Skipped when
    # the host already runs both architectures well, since installing the QEMU
    # handlers would replace Rosetta on Apple Silicon (OrbStack/Docker Desktop),
    # which is faster than QEMU and, unlike it, exposes the x86 CPU flags that
    # Homebrew requires (we probe with the same SSSE3 check Homebrew performs).
    if ! host_emulation_is_good; then
        docker run --privileged --rm tonistiigi/binfmt --install all
    fi

    if [ -z "${SKIP_ROOTS:-}" ]; then
        if [ -z "${SKIP_PI:-}" ]; then
            build_root_fs pi "${release}"
        fi
        if [ -z "${SKIP_ARM64:-}" ]; then
            build_root_fs arm64 "${release}"
        fi
        if [ -z "${SKIP_AMD64:-}" ]; then
            build_root_fs amd64 "${release}"
        fi
    fi

    if [ -z "${SKIP_RUGIX_ARTIFACTS:-}" ]; then
        build_rugix_artifacts "${release}" "${dev}"
    fi

    # Only freshly installable images are delivered. Online updates have no
    # configured service in this system; do not produce historical bundles.
    for image in build/*.img; do
        [ -f "$image" ] || continue
        (cd build && shasum -a 256 "$(basename "$image")" > "$(basename "$image").sha256")
    done

    # To boot from QEMU
    # qemu-system-x86_64 -net nic -net user,hostfwd=tcp::2222-:22 -machine accel=tcg -cpu max -smp 4 -m 8192 -hda build/umbrelos.img -bios OVMF.fd
}

# Build the root filesystem.
#
# Arguments: <arch> <release>
# arch can be: amd64, arm64, pi
function build_root_fs() {
    local arch=$1;
    local release=$2;

    # Determine the Docker platform and base variant
    local platform_arch="${arch}"
    local base_variant=""
    if [[ "${arch}" == "pi" ]]; then
        platform_arch="arm64"
        base_variant="-pi"
    fi

    echo "Ensuring the build dir exists..."
    mkdir -p build

    echo "Building Umbrel OS Docker image for ${arch}..."
    # The dedicated umbrelos-${arch} cache job already exports these layers to the
    # gha cache. In CI contexts that only need the image (not to refresh the
    # cache), set SKIP_CACHE_EXPORT=true to skip the redundant re-export — mass
    # or transient re-exports otherwise intermittently fail the build with cache
    # backend errors (429/504/not_found). The --cache-from import is unaffected.
    local cache_args=(--progress plain)
    if [ "${GITHUB_ACTIONS:-false}" = "true" ]; then
        cache_args+=(--cache-from "type=gha,scope=umbrelos-${arch}")
        if [ "${SKIP_CACHE_EXPORT:-false}" != "true" ]; then
            cache_args+=(--cache-to "type=gha,mode=max,scope=umbrelos-${arch}")
        fi
    fi
    # Note that we run the build context in ../../ so the build process has access to the
    # entire repo to copy in umbreld stuff.
    docker buildx build \
        "${cache_args[@]}" \
        --platform "linux/${platform_arch}" \
        --build-arg BASE_VARIANT="${base_variant}" \
        --file umbrelos.Dockerfile \
        --output "type=tar,dest=build/umbrelos-root-${arch}.tar" \
        ../../
}

# Build the Rugix artifacts.
#
# Arguments: <release> <dev>
function build_rugix_artifacts() {
    local release="$1"
    local dev="$2"

    # Make sure that the Rugix build directory exists.
    mkdir -p rugix/build/umbrelos-root
    # Copy the root filesystems previously build with Docker.
    cp build/*.tar rugix/build/umbrelos-root
    # Copy `/etc/hostname` and `/etc/hosts` such that Rugix can fix them.
    cp overlay/etc/{hostname,hosts} rugix/recipes/fix-overlay/files
    
    pushd rugix
    # Clean Rugix cache to force a clean build.
    # Rugix keys imported files by their path rather than their contents, so reusing
    # this cache across OS builds could silently use a stale root filesystem.
    # CI starts with a fresh checkout and may run parallel builds in this directory.
    if os_build_cleanup_enabled; then
        rm -rf .rugix || true
    fi

    if [ -z "${SKIP_PI:-}" ] && [ -z "${SKIP_PI4:-}" ]; then
        build_rugix_system "umbrelos-pi4" "$release" "$dev"
        maybe_sudo mv -f "build/umbrelos-pi4/system.img" "../build/umbrelos-pi4.img"
    fi
    if [ -z "${SKIP_PI:-}" ] && [ -z "${SKIP_PI_TRYBOOT:-}" ]; then
        build_rugix_system "umbrelos-pi-tryboot" "$release" "$dev"
        maybe_sudo mv -f "build/umbrelos-pi-tryboot/system.img" "../build/umbrelos-pi.img"
    fi
    if [ -z "${SKIP_AMD64:-}" ]; then
        build_rugix_system "umbrelos-amd64" "$release" "$dev"
        maybe_sudo mv -f "build/umbrelos-amd64/system.img" "../build/umbrelos-amd64.img"
    fi
    if [ -z "${SKIP_ARM64:-}" ]; then
        build_rugix_system "umbrelos-arm64" "$release" "$dev"
        maybe_sudo mv -f "build/umbrelos-arm64/system.img" "../build/umbrelos-arm64.img"
    fi
    popd
}

# Build an installable image using the current Rugix boot chain.
function build_rugix_system() {
    local system="$1"
    local release="$2"
    ./run-bakery bake image --release-version "$release" "$system"
}

main "$@"
