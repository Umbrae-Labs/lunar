#!/bin/bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPOSITORY_ROOT"

: "${LUNAR_SOURCE_COMMIT:?Missing GitHub source commit}"
: "${LUNAR_BUILD_ID:?Missing GitHub build identity}"
: "${LUNAR_GITHUB_REPOSITORY:?Missing GitHub repository}"
: "${BUILD_PROFILE:?Missing build profile}"
[[ "$LUNAR_SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$LUNAR_BUILD_ID" =~ ^[0-9]+-[0-9]+-[0-9]+-(release|nightly|development)$ ]]
[[ "$(git rev-parse HEAD)" == "$LUNAR_SOURCE_COMMIT" ]]
case "$BUILD_PROFILE" in
  release) node scripts/release.mjs validate "$RELEASE_TAG" ;;
  nightly|development) ;;
  *) echo 'Unsupported APK build profile' >&2; exit 1 ;;
esac

# These directories belong exclusively to this build; only SDK/tool caches are reused.
rm -rf -- artifacts cnb-artifacts
bash scripts/build-android.sh "$BUILD_PROFILE" "artifacts/lunar-${BUILD_PROFILE}.apk"
if [[ "$BUILD_PROFILE" == release ]]; then
  node scripts/release.mjs prepare "$RELEASE_TAG"
else
  node scripts/nightly.mjs prepare "$BUILD_PROFILE"
fi

mkdir -p cnb-artifacts
for asset in artifacts/*; do
  cp -- "$asset" "cnb-artifacts/${LUNAR_BUILD_ID}--${asset##*/}"
done
