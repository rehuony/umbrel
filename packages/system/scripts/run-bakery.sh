#!/usr/bin/env bash
set -euo pipefail

# Build tool version is independent of the on-device Ctrl version in images/layers.
BAKERY_IMAGE="ghcr.io/rugix/rugix-bakery@sha256:41fbea6785fccec14e43d22501b50af8cb4812f3560fc5d5abf41e2607350ef7" # v0.9.3
CACHE_VOLUME=rugix-build-cache

docker image inspect "$BAKERY_IMAGE" >/dev/null 2>&1 || docker pull "$BAKERY_IMAGE"
docker volume inspect "$CACHE_VOLUME" >/dev/null 2>&1 || docker volume create "$CACHE_VOLUME" >/dev/null

exec docker run --rm --privileged \
    --volume "$PWD":/project \
    --volume "$PWD":/run/rugix/bakery/context \
    --volume "$CACHE_VOLUME":/run/rugix/bakery/cache \
    --volume /dev:/dev \
    --env "RUGIX_HOST_PROJECT_DIR=$PWD" \
    --env "RUGIX_BAKERY_IMAGE=$BAKERY_IMAGE" \
    "$BAKERY_IMAGE" "$@"
