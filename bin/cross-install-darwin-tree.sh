#!/usr/bin/env bash
# cross-install-darwin-tree.sh — WI-3307 (mac cross-build "all-5-buttons" gap).
#
# Produces a COPY of the monorepo with a genuinely-darwin (Mach-O) node_modules,
# built entirely on THIS Linux box, for use as PAPERCUSP_STAGE_SOURCE_ROOT in
# stage-source-tree.sh — which then does the real allowlist + identity-scrub +
# release-bundle audit pass when producing the shipped source.tar.zst. This
# script's output is a SCRATCH intermediate; it is never shipped directly.
#
# THE GAP THIS CLOSES (build-mac-cross.sh's own "KNOWN CROSS-BUILD GAPS" header,
# and WI-3307's checkpoint): stage-source-tree.sh tars `node_modules` from
# wherever its MONO root points. On this Linux cross-build box that is always
# linux-x64 native addons — wrong arch for the bundled darwin node the packaged
# app ships with, so a naive mirror of the Windows/Linux "all-5-buttons" legs
# onto Mac would break the dev(:3270)/local(:3055) source-tree buttons at
# runtime. This script gives stage-source-tree.sh a tree whose node_modules is
# real darwin output instead.
#
# WHY THIS WORKS: `npm_config_platform`/`npm_config_arch` override npm's OS/CPU
# detection at install time, so `npm ci` resolves + fetches each
# optionalDependency's darwin prebuilt — and, for the small set of packages that
# carry a binding.gyp native-compile fallback (better-sqlite3, bufferutil,
# cpu-features — the only three anywhere in this monorepo's node_modules, all
# well-supported prebuild-install consumers with solid darwin coverage), fetches
# a prebuild-install darwin release asset instead of ever compiling on this box.
# This is the EXACT trick bin/build-desktop-sidecar.sh already uses for the
# sidecar's own better-sqlite3 dependency (its own darwin cross-fetch via
# `npx prebuild-install --platform=$TARGET_OS --arch=$TARGET_ARCH`) — just
# applied at the `npm ci` level for a full monorepo install instead of one
# package. Independently validated standalone on this box 2026-08-03 (WI-3307
# checkpoint): `npm_config_platform=darwin npm_config_arch=x64 npm install
# better-sqlite3@^12.9.0` in a scratch dir produced a genuine
# `Mach-O 64-bit x86_64 bundle` .node file — no local compilation.
#
# v1 SCOPE: x64 only is expected to be used in practice (build-mac-cross.sh
# stages a single x64 tree even for a universal-apple-darwin build — x64 .node
# prebuilts run fine under Rosetta 2 on Apple Silicon, and staging one arch
# instead of two keeps the install + tar cost to a single pass). arm64 is
# supported here too (in case a native-arm64 dev/local tree is ever wired up)
# but is NOT yet exercised by any caller.
#
# USAGE: cross-install-darwin-tree.sh <arch: x64|arm64> <out-dir>
set -euo pipefail

# ── Self-read guard (WI-3306 idiom): read the whole script before executing,
# so a peer's mid-run edit to this shared-tree file can't shift the running
# shell's read offset mid-install (this can run for many minutes).
{
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"        # papercusp-desktop
MONO="$(cd "$ROOT/.." && pwd)"        # monorepo root — this box's real (linux) tree, the rsync SOURCE

ARCH="${1:-}"
OUT="${2:-}"
if [[ -z "$ARCH" || -z "$OUT" ]]; then
  echo "usage: cross-install-darwin-tree.sh <x64|arm64> <out-dir>" >&2
  exit 1
fi
case "$ARCH" in
  x64|arm64) : ;;
  *) echo "ERROR: arch must be x64 or arm64 (got '$ARCH')" >&2; exit 1 ;;
esac

command -v rsync >/dev/null 2>&1 || { echo "ERROR: rsync not on PATH" >&2; exit 1; }
command -v file >/dev/null 2>&1 || { echo "ERROR: file(1) not on PATH (needed to verify Mach-O output)" >&2; exit 1; }

echo "==> cross-install-darwin-tree: rsyncing $MONO -> $OUT"
echo "    (excluding .git, node_modules, papercusp-desktop, build-target dirs — this is a SCRATCH npm-install"
echo "     input; stage-source-tree.sh does the real allowlist/scrub/audit pass on top of this later)"
mkdir -p "$OUT"
rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='papercusp-desktop' \
  --exclude='target' --exclude='.cargo-target' \
  --exclude='.wi*-cargo-target' --exclude='*cargo-target*' \
  --exclude='.next' \
  --exclude='.turbo' \
  --exclude='.papercusp' --exclude='.agent-tmp' --exclude='.claude' --exclude='.harness' \
  "$MONO/" "$OUT/"

[[ -f "$OUT/package.json" && -f "$OUT/package-lock.json" ]] \
  || { echo "ERROR: $OUT is missing package.json/package-lock.json after rsync — refusing to npm ci" >&2; exit 1; }

echo "==> cross-install-darwin-tree: npm ci (npm_config_platform=darwin npm_config_arch=$ARCH — this box's real npm/node, cross-arch env override)"
( cd "$OUT" && npm_config_platform=darwin npm_config_arch="$ARCH" npm ci --no-audit --no-fund )

echo "==> cross-install-darwin-tree: verifying every *.node under node_modules is Mach-O (darwin), not a linux compile fallback"
declare -a bad=()
while IFS= read -r nodefile; do
  file "$nodefile" 2>/dev/null | grep -q 'Mach-O' || bad+=("$nodefile")
done < <(find "$OUT/node_modules" -name '*.node' -type f 2>/dev/null)
if (( ${#bad[@]} > 0 )); then
  echo "ERROR: ${#bad[@]} .node file(s) under $OUT/node_modules are NOT Mach-O (a linux-native compile fallback slipped through — cross-install is NOT safe to ship):" >&2
  printf '  %s\n' "${bad[@]}" >&2
  exit 1
fi
count="$(find "$OUT/node_modules" -name '*.node' -type f 2>/dev/null | wc -l)"
echo "    ✓ ${count} native .node file(s) verified Mach-O (darwin/$ARCH) — zero linux fallbacks"

# The two markers stage-source-tree.sh's own preflight requires, plus the
# .bin toolchain — fail loud here rather than let the caller discover it later.
[[ -f "$OUT/apps/operator/package.json" && -f "$OUT/libs/papercusp/package.json" ]] \
  || { echo "ERROR: $OUT is missing the apps/operator + libs/papercusp package.json markers stage-source-tree.sh requires" >&2; exit 1; }
[[ -e "$OUT/node_modules/.bin/tsx" ]] \
  || { echo "ERROR: $OUT/node_modules/.bin/tsx missing after npm ci — toolchain incomplete" >&2; exit 1; }

echo "    ✓ cross-installed darwin($ARCH) tree ready at $OUT"
exit 0
}  # ── end self-read guard ──
