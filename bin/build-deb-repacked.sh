#!/usr/bin/env bash
# Build Debian bundles (or all bundles with --all-bundles), then route every
# Debian bundle produced by this invocation through the canonical xz +
# env-sidecar deduplication repacker.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROFILE="release"
TAURI_SUBCOMMAND="build"
BUNDLE_ARGS=(--bundles deb)
TAURI_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --tauri-subcommand=*)
      TAURI_SUBCOMMAND="${arg#*=}"
      ;;
    -d|--debug)
      PROFILE="debug"
      TAURI_ARGS+=("$arg")
      ;;
    --all-bundles)
      BUNDLE_ARGS=()
      ;;
    -b|--bundles|-b=*|--bundles=*)
      # The generic Tauri chokepoint has already proved this explicit filter
      # includes deb. Preserve the caller's exact list and do not append a
      # second, narrowing `--bundles deb` option.
      BUNDLE_ARGS=()
      TAURI_ARGS+=("$arg")
      ;;
    *)
      TAURI_ARGS+=("$arg")
      ;;
  esac
done

case "$TAURI_SUBCOMMAND" in
  build|bundle) ;;
  *)
    echo "FATAL: unsupported Tauri subcommand for Debian repacking: $TAURI_SUBCOMMAND" >&2
    exit 2
    ;;
esac

BUILD_TARGET=""
EXPECT_TARGET=0
for arg in "${TAURI_ARGS[@]}"; do
  if [[ "$EXPECT_TARGET" == 1 ]]; then
    BUILD_TARGET="$arg"
    EXPECT_TARGET=0
    continue
  fi
  case "$arg" in
    -t|--target) EXPECT_TARGET=1 ;;
    -t=*|--target=*) BUILD_TARGET="${arg#*=}" ;;
  esac
done

BUILD_MARKER="$(mktemp "${TMPDIR:-/tmp}/papercusp-deb-build.XXXXXX")"
cleanup() { rm -f "$BUILD_MARKER"; }
trap cleanup EXIT

cd "$ROOT"
tauri "$TAURI_SUBCOMMAND" "${BUNDLE_ARGS[@]}" "${TAURI_ARGS[@]}"

CARGO_TARGET_ROOT="$(
  cd "$ROOT/src-tauri"
  cargo metadata --no-deps --format-version 1 2>/dev/null \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])'
)"
if [[ -n "$BUILD_TARGET" ]]; then
  DEB_DIR="$CARGO_TARGET_ROOT/$BUILD_TARGET/$PROFILE/bundle/deb"
else
  DEB_DIR="$CARGO_TARGET_ROOT/$PROFILE/bundle/deb"
fi

mapfile -d '' -t BUILT_DEBS < <(
  find "$DEB_DIR" -maxdepth 1 -type f -name '*.deb' -newer "$BUILD_MARKER" -print0 \
    | sort -z
)
[[ ${#BUILT_DEBS[@]} -gt 0 ]] || {
  echo "FATAL: tauri $TAURI_SUBCOMMAND completed without a fresh Debian bundle under $DEB_DIR" >&2
  exit 7
}

for deb in "${BUILT_DEBS[@]}"; do
  bash "$SCRIPT_DIR/repack-deb-xz.sh" "$deb"
done
