#!/usr/bin/env bash
set -euo pipefail

SYSTEM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$SYSTEM_DIR/../.." && pwd)"
BUILD_DIR="${SYSTEM_BUILD_DIR:-$SYSTEM_DIR/build}"
version=""
targets=()

usage() {
    echo "Usage: $0 [--version VERSION] [pi4|pi5|arm64|amd64 ...]"
    echo "With no targets, build all four images. Outputs: packages/system/build/images."
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --help|-h) usage; exit 0 ;;
        --version)
            [ "$#" -ge 2 ] || { usage >&2; exit 1; }
            version="$2"
            shift 2
            ;;
        pi4|pi5|arm64|amd64) targets+=("$1"); shift ;;
        *) echo "Unknown target or option: $1" >&2; usage >&2; exit 1 ;;
    esac
done
[ "${#targets[@]}" -gt 0 ] || targets=(pi4 pi5 arm64 amd64)

if [ -z "$version" ]; then
    revision=$(git -C "$REPO_DIR" rev-parse --short HEAD)
    if [ -n "$(git -C "$REPO_DIR" status --porcelain)" ]; then revision="$revision-dirty"; fi
    version="$revision-$(date -u +%Y%m%d%H%M%S)"
fi

# Check execution support before building. Never alter the Docker host's binfmt
# registrations: that can break unrelated containers or replace a faster emulator.
architectures=" "
for target in "${targets[@]}"; do
    arch=arm64
    [ "$target" != amd64 ] || arch=amd64
    case "$architectures" in *" $arch "*) continue ;; esac
    if ! docker run --rm --platform "linux/$arch" alpine true; then
        echo "Docker cannot execute linux/$arch. Configure native or emulated support on the build host." >&2
        exit 1
    fi
    if [ "$arch" = amd64 ] && ! docker run --rm --platform linux/amd64 alpine grep -q ssse3 /proc/cpuinfo; then
        echo "The AMD64 build requires SSSE3 support (native execution or Rosetta)." >&2
        exit 1
    fi
    architectures="$architectures$arch "
done

mkdir -p "$BUILD_DIR/images"
BUILD_DIR="$(cd "$BUILD_DIR" && pwd)"
if ! mkdir "$BUILD_DIR/.build-lock" 2>/dev/null; then
    echo "Another image build is using $BUILD_DIR. Wait for it to finish." >&2
    exit 1
fi
work_dir=""
cleanup() {
    local status=$?
    trap - EXIT
    if [ -n "$work_dir" ]; then
        if [ "${KEEP_BUILD_WORK:-false}" = true ]; then
            echo "Build workspace retained: $work_dir"
        elif [ "${GITHUB_ACTIONS:-false}" = true ]; then
            sudo rm -rf "$work_dir" || status=1
        else
            rm -rf "$work_dir" || status=1
        fi
    fi
    rmdir "$BUILD_DIR/.build-lock" || status=1
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
work_dir=$(mktemp -d "$BUILD_DIR/work.XXXXXX")

# Rugix keys imported roots by path. A fresh workspace prevents stale layers
# while Docker's content-based cache and Rugix's download cache remain reusable.
cp -R "$SYSTEM_DIR/images/." "$work_dir/"
mkdir -p "$work_dir/build/umbrelos-root" "$work_dir/recipes/fix-overlay/files"
cp "$SYSTEM_DIR/rootfs/files/common/etc/hostname" "$SYSTEM_DIR/rootfs/files/common/etc/hosts" \
    "$work_dir/recipes/fix-overlay/files/"

built_roots=" "
built_targets=" "
for target in "${targets[@]}"; do
    case "$built_targets" in *" $target "*) continue ;; esac
    case "$target" in
        pi4) root=pi; system=umbrelos-pi4; artifact=umbrelos-pi4 ;;
        pi5) root=pi; system=umbrelos-pi-tryboot; artifact=umbrelos-pi ;;
        arm64) root=arm64; system=umbrelos-arm64; artifact=umbrelos-arm64 ;;
        amd64) root=amd64; system=umbrelos-amd64; artifact=umbrelos-amd64 ;;
    esac
    case "$built_roots" in
        *" $root "*) ;;
        *)
            arch="$root"
            variant=""
            if [ "$root" = pi ]; then arch=arm64; variant=-pi; fi
            cache_args=(--progress plain)
            if [ "${GITHUB_ACTIONS:-false}" = true ]; then
                cache_args+=(--cache-from "type=gha,scope=system-root-$root")
                cache_args+=(--cache-to "type=gha,mode=max,scope=system-root-$root")
            fi
            docker buildx build "${cache_args[@]}" \
                --platform "linux/$arch" --build-arg "BASE_VARIANT=$variant" \
                --file "$SYSTEM_DIR/rootfs/Dockerfile" \
                --output "type=tar,dest=$work_dir/build/umbrelos-root/umbrelos-root-$root.tar" \
                "$REPO_DIR"
            built_roots="$built_roots$root "
            ;;
    esac

    echo "Building $target image (version $version)..."
    (cd "$work_dir" && "$SYSTEM_DIR/scripts/run-bakery.sh" bake bundle --release-version "$version" "$system")
    if [ "${GITHUB_ACTIONS:-false}" = true ]; then
        # Rugix runs as root. Hand only the export directory and artifacts back
        # to the runner; never recursively change the staged system's ownership.
        sudo chown "$(id -u):$(id -g)" "$work_dir/build/$system" \
            "$work_dir/build/$system/system.img" "$work_dir/build/$system/system.rugixb"
    fi
    # Publish only after a successful build and checksum. Leave unrelated images
    # from previous builds and their checksums untouched.
    mkdir -p "$work_dir/artifacts"
    mv "$work_dir/build/$system/system.img" "$work_dir/artifacts/$artifact.img"
    mv "$work_dir/build/$system/system.rugixb" "$work_dir/artifacts/$artifact.rugixb"
    bundle_hash=$(cd "$work_dir" && "$SYSTEM_DIR/scripts/run-bakery.sh" bundler hash "artifacts/$artifact.rugixb")
    node "$SYSTEM_DIR/scripts/release.mjs" artifact "$work_dir/artifacts" "$target" "$version" "$bundle_hash"
    (cd "$work_dir/artifacts" && shasum -a 256 "$artifact.img" > "$artifact.img.sha256")
    mv "$work_dir/artifacts/$artifact.img" "$work_dir/artifacts/$artifact.img.sha256" \
        "$work_dir/artifacts/$artifact.rugixb" "$work_dir/artifacts/$artifact.rugixb.sha256" \
        "$work_dir/artifacts/$artifact.update.json" "$BUILD_DIR/images/"
    built_targets="$built_targets$target "
    echo "Built $BUILD_DIR/images/$artifact.img"
done
