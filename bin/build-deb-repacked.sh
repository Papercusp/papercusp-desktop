#!/usr/bin/env bash
# Build only Debian bundles, then route every bundle produced by this invocation
# through the canonical xz + env-sidecar deduplication repacker.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROFILE="release"
for arg in "$@"; do
  [[ "$arg" == "--debug" ]] && PROFILE="debug"
done

BUILD_MARKER="$(mktemp "${TMPDIR:-/tmp}/papercusp-deb-build.XXXXXX")"
cleanup() { rm -f "$BUILD_MARKER"; }
trap cleanup EXIT

cd "$ROOT"
tauri build --bundles deb "$@"

CARGO_TARGET_ROOT="$(
  cd "$ROOT/src-tauri"
  cargo metadata --no-deps --format-version 1 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])'
)"
DEB_DIR="$CARGO_TARGET_ROOT/$PROFILE/bundle/deb"

mapfile -d '' -t BUILT_DEBS < <(
  find "$DEB_DIR" -maxdepth 1 -type f -name '*.deb' -newer "$BUILD_MARKER" -print0 \
    | sort -z
)
[[ ${#BUILT_DEBS[@]} -gt 0 ]] || {
  echo "FATAL: tauri build completed without a fresh Debian bundle under $DEB_DIR" >&2
  exit 7
}

for deb in "${BUILT_DEBS[@]}"; do
  bash "$SCRIPT_DIR/repack-deb-xz.sh" "$deb"
done
