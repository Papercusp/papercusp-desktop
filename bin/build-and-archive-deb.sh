#!/usr/bin/env bash
# build-and-archive-deb.sh — EI-7048.
#
# THE GAP THIS CLOSES
# --------------------
# `npm run build` (tauri build) always overwrites the SAME fixed bundle path
# (~/.cargo-target/release/bundle/deb/Papercusp GUI_0.0.2_amd64.deb — the
# version stamp is constant 0.0.2, so even the filename never disambiguates
# builds). Every new build silently destroys the only copy of the PRIOR
# build's artifact. Observed live (2026-07-03, WI-1910 hunt): a leader
# directed "pin any deb-validation run to the 07-02 deb" — impossible to
# execute, because the 07-03 11:52 build had already clobbered the 07-02
# 8/8-baseline artifact. Recovery required scavenging an offloaded rig
# workdir's extracted pkg tree from days earlier and repacking via
# dpkg-deb — 30+ minutes, and even then only an OLDER build survived, not
# the one actually directed.
#
# THE FIX
# --------
# A thin wrapper around the existing `npm run build` (untouched — this is
# purely ADDITIVE, so nothing that already calls `npm run build` directly
# changes behavior) that, on a successful build, HARDLINKS (not copies — the
# .deb is ~1GB and hardlinks cost ~0 extra disk on the same filesystem) the
# fresh artifact into a git-sha + timestamp-stamped archive path, then prunes
# to the last N (default 10) archived builds so this can run unattended
# (e.g. from a CI/gate script) without unbounded disk growth.
#
# Usage: bin/build-and-archive-deb.sh [--debug] [--keep N]
#   --debug     build the debug bundle (tauri build --debug) instead of release
#   --keep N    number of archived builds to retain (default 10)
set -euo pipefail
DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="${PAPERCUSP_REPO_DIR:-/home/marsh-office/papercupai-workspace/papercusp}"
CARGO_TARGET="${CARGO_TARGET_DIR:-$HOME/.cargo-target}"

DEBUG=0
KEEP=10
while [ $# -gt 0 ]; do
  case "$1" in
    --debug) DEBUG=1; shift ;;
    --keep) KEEP="${2:?--keep requires a number}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

PROFILE_DIR="release"
BUILD_CMD="npm run build"
if [ "$DEBUG" = 1 ]; then
  PROFILE_DIR="debug"
  BUILD_CMD="npm run build:debug"
fi

DEB_DIR="$CARGO_TARGET/$PROFILE_DIR/bundle/deb"
ARCHIVE_DIR="$DEB_DIR/archive"

# WI-3287 / env-switcher-packaged-all-platforms-2026-07-06: stage the bundled
# env-sidecars/staging bundle inside sidecar/ (if a sidecar was already built)
# so the packaged env switcher has a real staging button — see
# bin/stage-env-sidecars.sh for the contract. Best-effort: this script does
# not itself build the sidecar (the documented manual flow does that first),
# so skip quietly if there's nothing to stage yet.
if [[ -f "$DESKTOP_DIR/src-tauri/sidecar/serve.mjs" ]]; then
  bash "$DESKTOP_DIR/bin/stage-env-sidecars.sh"
else
  echo "NOTE: src-tauri/sidecar/serve.mjs not found — skipping env-sidecars/staging (run bin/build-desktop-sidecar.sh first for a packaged staging button)"
fi

echo "=== building ($BUILD_CMD) ==="
( cd "$DESKTOP_DIR" && eval "$BUILD_CMD" )

DEB_PATH="$(find "$DEB_DIR" -maxdepth 1 -iname '*.deb' -newer "$DESKTOP_DIR/package.json" 2>/dev/null | head -1)"
if [ -z "$DEB_PATH" ]; then
  # Fallback: the single most-recently-modified .deb in the bundle dir (the
  # -newer check above can miss on a filesystem with coarse mtime resolution).
  DEB_PATH="$(find "$DEB_DIR" -maxdepth 1 -iname '*.deb' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
fi
if [ -z "$DEB_PATH" ] || [ ! -f "$DEB_PATH" ]; then
  echo "FATAL: build reported success but no .deb found under $DEB_DIR" >&2
  exit 3
fi

GIT_SHA="$(cd "$REPO_DIR" && git rev-parse --short HEAD 2>/dev/null || echo 'nogit')"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="$(basename "$DEB_PATH" .deb)"
ARCHIVED_PATH="$ARCHIVE_DIR/${STAMP}-${GIT_SHA}-${BASENAME}.deb"

mkdir -p "$ARCHIVE_DIR"
if ln "$DEB_PATH" "$ARCHIVED_PATH" 2>/dev/null; then
  echo "✓ archived (hardlink, 0 extra disk): $ARCHIVED_PATH"
else
  # Cross-device or hardlink-unsupported fallback — a real copy, still correct,
  # just costs disk (the .deb is large; this path should be rare on one box).
  cp "$DEB_PATH" "$ARCHIVED_PATH"
  echo "✓ archived (copy — hardlink failed, cross-device or unsupported): $ARCHIVED_PATH"
fi

# Prune to the last $KEEP archived builds (oldest-first deletion), so an
# unattended repeated build (e.g. a periodic gate) never grows this unbounded.
mapfile -t ARCHIVED < <(find "$ARCHIVE_DIR" -maxdepth 1 -iname '*.deb' -printf '%T@ %p\n' 2>/dev/null | sort -n | cut -d' ' -f2-)
COUNT="${#ARCHIVED[@]}"
if [ "$COUNT" -gt "$KEEP" ]; then
  PRUNE_COUNT=$((COUNT - KEEP))
  for ((i = 0; i < PRUNE_COUNT; i++)); do
    echo "  pruning old archive: ${ARCHIVED[$i]}"
    rm -f "${ARCHIVED[$i]}"
  done
fi

echo "=== done: live artifact $DEB_PATH, archived copy $ARCHIVED_PATH, $KEEP most-recent builds retained ==="
