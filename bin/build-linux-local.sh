#!/usr/bin/env bash
# Build the Linux x86_64 desktop release (deb + AppImage) LOCALLY, WITHOUT
# GitHub — the committed local-Linux counterpart to bin/build-windows-on-vm.sh
# and the mac VM leg. Produces artifacts the owner uploads themselves (fact
# releases-not-on-github-owner-2026-07-08); prints their paths + sha256.
#
# WHY THIS EXISTS (2026-07-09): there was no committed local-Linux recipe — the
# canonical bin/release-local.sh bakes in a version-bump + `gh release` publish,
# so past local Linux builds were an ad-hoc manual chain. This scripts that chain
# durably AND fixes the artifact-location divergence: this box has a GLOBAL cargo
# override (~/.cargo/config.toml → target-dir = ~/.cargo-target), so a native
# `cargo`/`tauri build` drops bundles under ~/.cargo-target/release/bundle, NOT
# under the source tree like the Mac (src-tauri/target/universal-apple-darwin/…)
# and Windows (src-tauri/target/windows-vm/…) legs. This script COLLECTS the
# finished Linux artifacts into src-tauri/target/release/bundle/ so all three
# platforms' release artifacts live under one tree:
#     papercusp-desktop/src-tauri/target/…
# (both that path and ~/.cargo-target are symlinked to /mnt/data on the dev box,
# so the collection is a same-filesystem move — instant, no copy.)
#
# Usage:
#   bin/build-linux-local.sh                 # version from tauri.conf.json
#   PAPERCUSP_SKIP_SEED_CUT=1 bin/build-linux-local.sh   # reuse committed seed
#
# Env passthrough (same knobs as release-local.sh's Linux leg):
#   PAPERCUSP_SKIP_SEED_CUT=1  reuse src-tauri/seed as-is (no live-store seed cut)
#   PAPERCUSP_BUILD_ROLES      subset of "gui server" (default both)
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  minisign key passphrase (default empty)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

VERSION="$(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['version'])")"
BUILD_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '')"
KEY_FILE="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.papercusp/signing/papercusp.key}"
ROLES="${PAPERCUSP_BUILD_ROLES:-gui server}"
[[ -f "$KEY_FILE" ]] || { echo "ERROR: minisign signing key not found at $KEY_FILE"; exit 1; }

# Collection destination — the same tree Mac/Windows artifacts land in.
DEST_BUNDLE="$ROOT/src-tauri/target/release/bundle"

echo "==> Linux local build: desktop sha=${BUILD_SHA:-<none>} version=$VERSION roles='$ROLES'  $(date -u +%H:%M:%SZ)"
echo "    (provenance baked via option_env! → /api/health self-reports sha+version)"

# ── Seed: reuse the committed src-tauri/seed unless a cut is explicitly wanted.
# A live-store seed cut belongs in release-local.sh (it owns cut_release_seed);
# a local rebuild almost always reuses the committed seed.
if [[ "${PAPERCUSP_SKIP_SEED_CUT:-0}" != "1" ]]; then
  echo "WARN: PAPERCUSP_SKIP_SEED_CUT!=1 — this local script does NOT cut a fresh seed;"
  echo "      it ships the committed src-tauri/seed. Use bin/release-local.sh for a seed cut."
fi

echo "==> [1/5] building sidecar (build-desktop-sidecar.sh)"
bash "$ROOT/bin/build-desktop-sidecar.sh"

echo "==> [2/5] staging env-sidecars (stage-env-sidecars.sh)"
bash "$ROOT/bin/stage-env-sidecars.sh"

echo "==> [3/5] staging source tree / all-5-buttons bundle (stage-source-tree.sh)"
bash "$ROOT/bin/stage-source-tree.sh"

export TAURI_SIGNING_PRIVATE_KEY="$KEY_FILE"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

echo "==> [4/5] tauri build --bundles deb (roles: $ROLES)"
for role in $ROLES; do
  role_cfg=(); [[ "$role" == "server" ]] && role_cfg=(--config src-tauri/tauri.server.conf.json)
  echo "    -- role=$role  $(date -u +%H:%M:%SZ)"
  (cd "$ROOT" && PAPERCUSP_BUILD_SHA="$BUILD_SHA" PAPERCUSP_BUILD_VERSION="$VERSION" \
     npx --yes -p @tauri-apps/cli@"${PAPERCUSP_TAURI_CLI_VERSION:-2.11.0}" tauri build --bundles deb "${role_cfg[@]}")
done

if [[ " $ROLES " == *" gui "* ]]; then
  echo "==> [5/5] building Linux AppImage (gui, build-appimage.sh)"
  (cd "$ROOT" && PAPERCUSP_BUILD_SHA="$BUILD_SHA" PAPERCUSP_BUILD_VERSION="$VERSION" \
     TAURI_SIGNING_PRIVATE_KEY="$KEY_FILE" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
     bash "$ROOT/bin/build-appimage.sh")
fi

# ── COLLECT: move the finished artifacts under the source tree so all platforms
# share one location. cargo's real target dir (respects the global override) is
# resolved via `cargo metadata`; if it already equals src-tauri/target, this is
# a no-op. Same-filesystem move ⇒ instant rename, no byte copy.
echo "==> collecting Linux artifacts into $DEST_BUNDLE"
SRC_ROOT="$(cd "$ROOT/src-tauri" && cargo metadata --no-deps --format-version 1 2>/dev/null \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("target_directory",""))' 2>/dev/null || true)"
[[ -n "$SRC_ROOT" ]] || SRC_ROOT="$ROOT/src-tauri/target"
SRC_BUNDLE="$SRC_ROOT/release/bundle"

collected=()
if [[ "$(readlink -f "$SRC_BUNDLE" 2>/dev/null)" == "$(readlink -f "$DEST_BUNDLE" 2>/dev/null)" ]]; then
  echo "    cargo already targets the source tree — artifacts are in place ($DEST_BUNDLE)"
  for f in "$DEST_BUNDLE"/deb/*_"$VERSION"_*.deb "$DEST_BUNDLE"/deb/*_"$VERSION"_*.deb.sig \
           "$DEST_BUNDLE"/appimage/*_"$VERSION"_*.AppImage "$DEST_BUNDLE"/appimage/*_"$VERSION"_*.AppImage.sig; do
    [[ -f "$f" ]] && collected+=("$f")
  done
else
  mkdir -p "$DEST_BUNDLE/deb" "$DEST_BUNDLE/appimage"
  shopt -s nullglob
  for f in "$SRC_BUNDLE"/deb/*_"$VERSION"_*.deb "$SRC_BUNDLE"/deb/*_"$VERSION"_*.deb.sig; do
    mv -f "$f" "$DEST_BUNDLE/deb/"; collected+=("$DEST_BUNDLE/deb/$(basename "$f")")
  done
  for f in "$SRC_BUNDLE"/appimage/*_"$VERSION"_*.AppImage "$SRC_BUNDLE"/appimage/*_"$VERSION"_*.AppImage.sig; do
    mv -f "$f" "$DEST_BUNDLE/appimage/"; collected+=("$DEST_BUNDLE/appimage/$(basename "$f")")
  done
  shopt -u nullglob
fi

[[ ${#collected[@]} -gt 0 ]] || { echo "ERROR: no Linux artifacts collected for version $VERSION under $SRC_BUNDLE"; exit 1; }

echo "=== LINUX BUILD DONE  $(date -u +%H:%M:%SZ) ==="
echo "Artifacts (under papercusp-desktop/src-tauri/target/release/bundle):"
for f in "${collected[@]}"; do printf '  %s\n' "$f"; done
echo "=== sha256 (installers only) ==="
for f in "${collected[@]}"; do
  case "$f" in *.deb|*.AppImage) sha256sum "$f" ;; esac
done
