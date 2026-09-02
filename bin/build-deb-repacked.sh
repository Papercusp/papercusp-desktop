#!/usr/bin/env bash
# Build Debian bundles (or all bundles with --all-bundles), then route every
# Debian bundle produced by this invocation through the canonical xz +
# env-sidecar deduplication repacker.
set -euo pipefail

# rustup installs cargo into ~/.cargo/bin, which an interactive shell gets from the
# profile but a systemd --user unit (papercup-live-federation-gate.service) or an
# operator-spawned shell does NOT. Without this the very first cargo call dies with
# "cargo metadata … No such file or directory" and the gate's local-matrix leg goes
# dark behind a missing base .deb (WI-2141192, measured 2026-09-02 base-build.log).
# A script a unit invokes must not depend on the caller's interactive PATH.
if ! command -v cargo >/dev/null 2>&1; then
  [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
  [ -x "$HOME/.cargo/bin/cargo" ] && export PATH="$HOME/.cargo/bin:$PATH"
fi
command -v cargo >/dev/null 2>&1 || { echo "FATAL: cargo not resolvable (checked PATH and ~/.cargo/bin) — install rustup or fix PATH" >&2; exit 12; }

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
    -b|--bundles|-b=*|-b?*|--bundles=*)
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
# tauri.conf.json sets bundle.createUpdaterArtifacts, so `tauri build` signs the updater
# artifact AFTER the .deb is bundled and exits non-zero without a private key
# ("A public key has been found, but no private key… TAURI_SIGNING_PRIVATE_KEY").
# Measured 2026-09-02 08:13Z (endgame P-302): the .deb was already on disk when the
# build "failed", and every caller of this script (npm run build, the live-federation
# gate's base build, rig scripts) read that exit as "no artifact". Default the key the
# same way bin/build-and-archive-deb.sh does — Tauri accepts a key PATH in this
# variable — and only when the file exists, so a box without a key still fails loudly
# on the signature step rather than silently shipping unsigned updater artifacts.
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  _SIGNING_KEY_FILE="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.papercusp/signing/papercusp.key}"
  if [[ -r "$_SIGNING_KEY_FILE" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY="$_SIGNING_KEY_FILE"
  fi
fi
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

# build-and-archive-deb.sh owns a dedicated, independently bounded repack
# phase. Generic npm/tauri callers keep the historical behavior below; only
# that outer archive producer opts into deferral after proving a fresh deb was
# emitted. This prevents a cold compile from consuming the xz phase's budget.
case "${PAPERCUSP_DEFER_DEB_REPACK:-0}" in
  0) ;;
  1)
    echo "==> deferring xz repack for ${#BUILT_DEBS[@]} fresh Debian bundle(s) to the archive wrapper's dedicated phase"
    exit 0
    ;;
  *)
    echo "FATAL: PAPERCUSP_DEFER_DEB_REPACK must be 0 or 1" >&2
    exit 8
    ;;
esac

for deb in "${BUILT_DEBS[@]}"; do
  bash "$SCRIPT_DIR/repack-deb-xz.sh" "$deb"
done
