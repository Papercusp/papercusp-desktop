#!/usr/bin/env bash
# stage-source-tree.sh — WI-3308; plan env-switcher-packaged-all-platforms-2026-07-06.
#
# The "all-5-buttons" dogfood bundle: the dev(:3270) + local(:3055) env buttons
# run from SOURCE (dev = `tsx apps/operator/bin/hono-host.ts`; local = the Vite
# SPA dev server over apps/operator-vite). The launcher gates both on
# detectPapercupRoot() + defaultHasToolchain() (env-operator-launcher.ts). A
# packaged install has NO npm/npx/tsx, so we ship a PRE-`npm install`ed runnable
# monorepo tree + its node_modules; the bundled node (sidecar/bin/node,
# v24.15.0) runs the tree's OWN tsx/vite (proven WI-3308: tsx v4.21.0 + vite
# 7.3.5 both run under the bundled node with no npm/npx on PATH).
#
# ARCHITECTURE (pinned; Mac/Win mirror): ship the tree as ONE compressed
# resource `sidecar/source.tar.zst`, extracted on FIRST BOOT to a WRITABLE dir,
# with PAPERCUSP_INTEGRATION_ROOT pointed at it — NOT an uncompressed
# `sidecar/**` glob. Rationale: the install dir (/usr/lib/…) is read-only so an
# in-place tree can't be edited (editability is the whole point of a dogfood
# source drop); tauri copying ~9GB uncompressed through its resource pipeline is
# slow; and node_modules `.bin/*` symlinks survive `tar` but not tauri's copy.
#
# OPT-IN while the end-to-end is being wired (Rust first-boot extract +
# b0fbf's launcher spawn-command change, WI-3306): set PAPERCUSP_STAGE_SOURCE=1.
# Flips to default-on once dev+local are VM-verified (WI-3308) — a finished
# feature never ships dark.
#
# Runs AFTER bin/build-desktop-sidecar.sh (needs a fresh src-tauri/sidecar/) and
# BEFORE `tauri build` (so the existing `sidecar/**/*` resources glob in
# tauri.conf.json + tauri.server.conf.json sweeps source.tar.zst into the
# bundle — zero tauri.conf / Rust glob changes needed). src-tauri/sidecar/ is
# .gitignored, so the multi-GB artifact never reaches git-sync.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"                  # papercusp-desktop
MONO="$(cd "$ROOT/.." && pwd)"                  # monorepo root (apps/, libs/, node_modules/)
SIDECAR="$ROOT/src-tauri/sidecar"

if [[ "${PAPERCUSP_STAGE_SOURCE:-0}" != "1" ]]; then
  echo "==> stage-source-tree: skipped (set PAPERCUSP_STAGE_SOURCE=1 to bundle the dev/local runnable source tree — WI-3308)"
  exit 0
fi

if [[ ! -f "$SIDECAR/serve.mjs" ]]; then
  echo "ERROR: $SIDECAR/serve.mjs missing — run bin/build-desktop-sidecar.sh first" >&2
  exit 1
fi
# The mono root MUST carry the detectPapercupRoot() markers, or dev/local skip
# with 'no-source-tree' at runtime.
if [[ ! -f "$MONO/apps/operator/package.json" || ! -f "$MONO/libs/papercusp/package.json" ]]; then
  echo "ERROR: $MONO is not the monorepo root (missing apps/operator + libs/papercusp package.json markers)" >&2
  exit 1
fi
# The tree MUST ship PRE-installed — installs have no npm/npx to populate it.
if [[ ! -x "$MONO/node_modules/.bin/tsx" ]]; then
  echo "ERROR: $MONO/node_modules/.bin/tsx missing — run 'npm install' at the monorepo root first (defaultHasToolchain needs <root>/node_modules/.bin; installs have no npm)" >&2
  exit 1
fi

OUT="$SIDECAR/source.tar.zst"
rm -f "$OUT"
echo "==> stage-source-tree: taring runnable monorepo tree from $MONO"

# EXCLUDES — heavy or irrelevant to running dev(:3270)/local(:3055):
#  • .git (7.2G history) — not needed to run.
#  • papercusp-desktop/ — the Tauri/Rust shell (its own src-tauri/sidecar 2G
#    self-reference, seed 2.1G, Rust target); the operators never import it and
#    detectPapercupRoot's markers are at the mono root, not here.
#  • Rust build targets + OS/editor cruft + logs.
# node_modules IS KEPT — it is the shipped toolchain (tsx/vite + the whole
# @papercusp/* runtime closure). dist/.next are DELIBERATELY kept: some internal
# packages resolve their "main" to a built dist/ at runtime, so pruning them
# would break module resolution.
zstd_level="${PAPERCUSP_SOURCE_ZSTD_LEVEL:-6}"
tar --numeric-owner --owner=0 --group=0 \
  --exclude='./.git' \
  --exclude='./papercusp-desktop' \
  --exclude='./target' \
  --exclude='./.cargo-target' \
  --exclude='*/.turbo' \
  --exclude='*.log' \
  --exclude='./.DS_Store' \
  -C "$MONO" -cf - . \
  | zstd -T0 "-${zstd_level}" --long=27 -q -f -o "$OUT"

sz="$(du -h "$OUT" | cut -f1)"
echo "    ✓ source.tar.zst staged (${sz} compressed, zstd -${zstd_level} --long=27)"
echo "      → first boot extracts it to a writable dir; PAPERCUSP_INTEGRATION_ROOT points at it (WI-3308)"
