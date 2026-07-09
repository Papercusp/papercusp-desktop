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
# DEFAULT-ON since the all-5-buttons dogfood bundle is VM-verified end-to-end on
# Linux (WI-3308, 2026-07-07: dev:3270 + local:3055 spawn from the extracted tree;
# Windows WI-3306 / Mac WI-3307 mirror the same seams) — a finished feature never
# ships dark. Opt OUT with PAPERCUSP_STAGE_SOURCE=0 (e.g. a deliberately smaller
# build with only the 3 bundled-sidecar buttons).
#
# Runs AFTER bin/build-desktop-sidecar.sh (needs a fresh src-tauri/sidecar/) and
# BEFORE `tauri build` (so the existing `sidecar/**/*` resources glob in
# tauri.conf.json + tauri.server.conf.json sweeps source.tar.zst into the
# bundle — zero tauri.conf / Rust glob changes needed). src-tauri/sidecar/ is
# .gitignored, so the multi-GB artifact never reaches git-sync.
set -euo pipefail

# ── Self-read guard (WI-3306, 2026-07-08): the body runs inside this { } group
# so bash reads the whole script before executing — a peer editing this
# shared-tree file during the multi-minute tar below can't corrupt the running
# shell's read offset. Matching } + exit at EOF. Same guard as the caller,
# bin/build-windows-on-vm.sh (and bin/mac-vm-build.sh, which also stages here).
{
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"                  # papercusp-desktop
MONO="$(cd "$ROOT/.." && pwd)"                  # monorepo root (apps/, libs/, node_modules/)
SIDECAR="$ROOT/src-tauri/sidecar"

if [[ "${PAPERCUSP_STAGE_SOURCE:-1}" != "1" ]]; then
  echo "==> stage-source-tree: skipped (PAPERCUSP_STAGE_SOURCE=0 — building without the dev/local runnable source tree; only the 3 bundled-sidecar buttons will work — WI-3308)"
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

# EXCLUDES. Two classes:
#
# (1) SECRETS / CREDENTIALS — MUST NOT ship (the mono root carries the dev box's
#     own .env*, .gitconfig, .npmrc, .mcp.json + a nested apps/operator/.env.local).
#     Even on owner-only dogfood machines, baking creds into a distributable
#     bundle is wrong + a leak vector if the approach generalizes. Patterns are
#     ANCHORED to real dotfiles (`/.env.` not `*.env.*`) so a legit source file
#     like `foo.env.d.ts` is NOT collateral-excluded.
#
# (2) HEAVY / IRRELEVANT to running dev(:3270 tsx hono-host)/local(:3055 vite):
#     .git (7.2G history); papercusp-desktop/ (the Tauri/Rust shell — its own
#     src-tauri/sidecar 2G self-reference, seed 2.1G, Rust target; the operators
#     never import it and detectPapercupRoot's markers live at the mono root);
#     Rust build targets; editor dirs; logs; tsbuildinfo.
#
# node_modules IS KEPT — it is the shipped toolchain (tsx/vite + the whole
# @papercusp/* runtime closure). dist/.next are DELIBERATELY kept: some internal
# packages resolve their "main" to a built dist/ at runtime, so pruning them
# would break module resolution.
declare -a EXCLUDES=(
  # (1) secrets / credentials — root + nested, anchored to dotfiles
  --exclude='./.env' --exclude='*/.env'
  --exclude='./.env.*' --exclude='*/.env.*'
  --exclude='./.npmrc' --exclude='*/.npmrc'
  --exclude='./.gitconfig' --exclude='*/.gitconfig'
  --exclude='./.git-credentials' --exclude='*/.git-credentials'
  --exclude='./.netrc' --exclude='*/.netrc'
  --exclude='./.mcp.json' --exclude='./.mcp.json.*'
  --exclude='*/.mcp.json' --exclude='*/.mcp.json.*'
  --exclude='./.bashrc' --exclude='*/.bashrc'
  --exclude='./.bash_profile' --exclude='*/.bash_profile'
  --exclude='./.bash_history' --exclude='*/.bash_history'
  --exclude='./.profile' --exclude='*/.profile'
  --exclude='./.zshrc' --exclude='*/.zshrc'
  # ssh / cloud credential dirs (never blanket *.pem/*.key — node_modules ships
  # legit CA bundles + test certs that TLS needs at runtime)
  --exclude='./.ssh' --exclude='*/.ssh'
  --exclude='./.aws' --exclude='*/.aws'
  --exclude='./.gnupg' --exclude='*/.gnupg'
  # (2) heavy / irrelevant
  --exclude='./.git'
  --exclude='./papercusp-desktop'
  --exclude='./target' --exclude='./.cargo-target'
  # per-work-item isolated cargo target dirs (.wiNNNN-cargo-target): multi-GB
  # build output — one swept into the 2026-07-09 0.0.5 cut and tripled the
  # source bundle to 7.1G (plus "file changed as we read it" tar churn from
  # the concurrent build writing it)
  --exclude='./.wi*-cargo-target' --exclude='./*cargo-target*'
  --exclude='*/.turbo'
  --exclude='./.idea' --exclude='*/.idea'
  --exclude='./.vscode' --exclude='*/.vscode'
  --exclude='*.log'
  --exclude='*.tsbuildinfo'
  --exclude='./.DS_Store' --exclude='*/.DS_Store'
)
zstd_level="${PAPERCUSP_SOURCE_ZSTD_LEVEL:-6}"
# GNU tar REQUIRED (WI-3307 mac leg): the exclude anchoring + --owner/--group
# flags above are GNU dialect — macOS bsdtar rejects --owner outright and
# matches excludes subtly differently (a silent-content bug, not a loud one).
# On macOS: brew install gnu-tar → gtar.
TAR_BIN=tar
if ! tar --version 2>/dev/null | grep -q 'GNU tar'; then
  if command -v gtar >/dev/null 2>&1; then
    TAR_BIN=gtar
  else
    echo "ERROR: GNU tar required (macOS: brew install gnu-tar) — bsdtar's --owner/exclude dialect differs" >&2
    exit 1
  fi
fi
command -v zstd >/dev/null 2>&1 || { echo "ERROR: zstd not on PATH (macOS: brew install zstd)" >&2; exit 1; }
# The shared tree is edited by the whole fleet WHILE this multi-minute tar
# runs; GNU tar exits 1 for "file changed as we read it" — a warning (the
# entry is still written), not corruption. Under set -e/pipefail that exit 1
# would kill a ~25-min VM build at the pack step, so tolerate exactly exit 1
# (the changed-file warnings stay visible on stderr); exit ≥2 and any zstd
# failure remain fatal.
set +e +o pipefail
"$TAR_BIN" --numeric-owner --owner=0 --group=0 \
  "${EXCLUDES[@]}" \
  -C "$MONO" -cf - . \
  | zstd -T0 "-${zstd_level}" --long=27 -q -f -o "$OUT"
rcs=("${PIPESTATUS[@]}")
set -e -o pipefail
(( rcs[0] <= 1 )) || { echo "ERROR: tar failed (exit ${rcs[0]})" >&2; exit 1; }
(( rcs[1] == 0 )) || { echo "ERROR: zstd failed (exit ${rcs[1]})" >&2; exit 1; }

sz="$(du -h "$OUT" | cut -f1)"
echo "    ✓ source.tar.zst staged (${sz} compressed, zstd -${zstd_level} --long=27)"
echo "      → first boot extracts it to a writable dir; PAPERCUSP_INTEGRATION_ROOT points at it (WI-3308)"
exit 0

}  # ── end self-read guard (WI-3306) — opened after 'set -euo pipefail' above ──
