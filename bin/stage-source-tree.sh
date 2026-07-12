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

# EXCLUDES. Two classes, and only ONE of them is maintained here:
#
# (1) SECRETS / PRIVACY — NOT maintained here. Derived at run time from
#     bin/audit-release-bundle.py --tar-excludes, which is also THE GATE that
#     fails this build if any of it slips through. These used to be two
#     hand-kept lists of the same knowledge — a denylist here, a regex set
#     there — and two copies drift by construction. Read the old list as a
#     postmortem log: cargo-target added after it blew up the 0.0.5 cut, .next
#     after it tripled 0.0.8, and NOBODY had ever heard of .papercusp/, so 0.0.8
#     shipped 121 agent session transcripts. Now the exclude and the check that
#     catches a missed exclude come from ONE rule (WI-4419).
#
#     Nested is the half the top-level allowlist below cannot do: the junk sits
#     INSIDE apps/ and packages/ (packages/operator-core/.papercusp,
#     apps/operator/test-results, **/.vitest-tmp), and some of it is git-TRACKED
#     via a .gitignore anchoring bug — so "tracked" was never a safety signal.
#
# (2) HEAVY / IRRELEVANT to running dev(:3270 tsx hono-host)/local(:3055 vite):
#     .git (7.2G history); papercusp-desktop/ (the Tauri/Rust shell — its own
#     src-tauri/sidecar 2G self-reference, seed 2.1G, Rust target; the operators
#     never import it and detectPapercupRoot's markers live at the mono root);
#     Rust build targets; editor dirs; logs; tsbuildinfo. Size, not secrecy —
#     so it stays local, and a miss here is a fat bundle, not a leak.
#
# node_modules IS KEPT — it is the shipped toolchain (tsx/vite + the whole
# @papercusp/* runtime closure). dist/ is DELIBERATELY kept: some internal
# packages resolve their "main" to a built dist/ at runtime, so pruning it
# would break module resolution. .next is NOT kept (2026-07-11, 0.0.8 cut):
# apps/operator/.next had grown to 21G (19.5G webpack cache) and bloated the
# 0.0.8 GUI deb to 9.4GB (0.0.6: 2.9GB) with a ~35G first-boot extract; the
# standalone Next operator path is RETIRED and nothing in hono-host /
# host-bootstrap / env-operator-launcher resolves into .next at runtime.
declare -a EXCLUDES=()
# (1) secrets / privacy — from the gate, never re-typed here.
while IFS= read -r pat; do
  [[ -n "$pat" ]] && EXCLUDES+=(--exclude="$pat")
done < <(python3 "$HERE/audit-release-bundle.py" --tar-excludes)
(( ${#EXCLUDES[@]} > 0 )) \
  || { echo "ERROR: audit-release-bundle.py --tar-excludes returned nothing — refusing to stage an UNFILTERED tree (WI-4419)" >&2; exit 1; }
echo "    privacy excludes: ${#EXCLUDES[@]} patterns (derived from the gate's rules)"
EXCLUDES+=(
  # (2) heavy / irrelevant — size, not secrecy
  --exclude='./papercusp-desktop'
  --exclude='./target' --exclude='./.cargo-target'
  # per-work-item isolated cargo target dirs (.wiNNNN-cargo-target): multi-GB
  # build output — one swept into the 2026-07-09 0.0.5 cut and tripled the
  # source bundle to 7.1G (plus "file changed as we read it" tar churn from
  # the concurrent build writing it)
  --exclude='./.wi*-cargo-target' --exclude='./*cargo-target*'
  # Next.js build/cache dirs (WI-4229): apps/operator/.next hit 21G (19.5G
  # webpack cache) and tripled the 0.0.8 source bundle; the standalone Next
  # operator is retired and nothing resolves into .next at runtime (dist/ is
  # the runtime-resolved build output and stays).
  --exclude='./.next' --exclude='*/.next'
  --exclude='*/.turbo'
  --exclude='./.idea' --exclude='*/.idea'
  --exclude='./.vscode' --exclude='*/.vscode'
  --exclude='*.log'
  --exclude='*.tsbuildinfo'
  --exclude='./.DS_Store' --exclude='*/.DS_Store'
)
# ── ALLOWLIST (WI-4419). The EXCLUDES above are kept as a second layer for
# NESTED junk inside an allowed dir (apps/operator/.next, a stray */.env), but
# they are no longer what decides whether a top-level entry ships.
#
# WHY THIS IS AN ALLOWLIST NOW. It used to be `-cf - .` (everything at the mono
# root, minus exclusions). A denylist can only ever exclude what someone already
# learned to fear — read the EXCLUDES list as a postmortem log: cargo-target was
# added after it blew up the 0.0.5 cut, .next after it tripled 0.0.8. Meanwhile
# NOBODY thought of <mono>/.papercusp/, so the 0.0.8 bundles shipped 53,225
# untracked files including 121 AGENT SESSION TRANSCRIPTS
# (.papercusp/pi-sessions/*.jsonl) with the operator's home path in every record
# (WI-4419). The mono root is a working tree on a busy dev box — .agent-tmp/,
# .tmp/, scratch/, test-results/, ~140 .papercup-console-active.* turds — and a
# denylist silently re-opens every single time any tool drops a new one.
#
# So: name what the dev(:3270 tsx hono-host) / local(:3055 vite) buttons actually
# need. Anything not named here does not ship, including things that do not exist
# yet. Adding a top-level dir to the repo is now a DELIBERATE decision to ship it.
#
# NOT shipped, on purpose: .papercusp .agent-tmp .claude .harness .nx .tmp*
# .vitest-tmp .pcv-socktest scratch scratchpad test-results briefs _retired
# papercusp-desktop .git .github benchmarks infra deploy — plus every root dotfile
# (.env* .bashrc .gitconfig .npmrc .mcp.json*), which git happens to TRACK here,
# so "tracked" was never a safety signal either.
declare -a INCLUDES=()
declare -a MISSING=()
for entry in \
  package.json package-lock.json tsconfig.base.json .nvmrc \
  eslint.config.mjs knip.json bunfig.toml .gitignore .gitmodules \
  CLAUDE.md AGENTS.md BORROWABLE.md \
  node_modules apps libs packages \
  tools scripts templates patches design design-tokens rubrics docs bin
do
  if [[ -e "$MONO/$entry" ]]; then
    INCLUDES+=("./$entry")
  else
    MISSING+=("$entry")
  fi
done
# The four load-bearing ones — a packaged install has no npm to repair a gap, so
# a missing one is a silently-broken dev/local button in the field, not a warning.
for required in node_modules apps libs packages; do
  [[ -e "$MONO/$required" ]] \
    || { echo "ERROR: allowlist requires $MONO/$required — refusing to stage a tree the dev/local buttons cannot run" >&2; exit 1; }
done
(( ${#MISSING[@]} == 0 )) \
  || echo "    note: allowlist entries absent from this tree (skipped): ${MISSING[*]}"
echo "    allowlist: ${#INCLUDES[@]} top-level entries"

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
  -C "$MONO" -cf - "${INCLUDES[@]}" \
  | zstd -T0 "-${zstd_level}" --long=27 -q -f -o "$OUT"
rcs=("${PIPESTATUS[@]}")
set -e -o pipefail
(( rcs[0] <= 1 )) || { echo "ERROR: tar failed (exit ${rcs[0]})" >&2; exit 1; }
(( rcs[1] == 0 )) || { echo "ERROR: zstd failed (exit ${rcs[1]})" >&2; exit 1; }

sz="$(du -h "$OUT" | cut -f1)"
echo "    ✓ source.tar.zst staged (${sz} compressed, zstd -${zstd_level} --long=27)"
echo "      → first boot extracts it to a writable dir; PAPERCUSP_INTEGRATION_ROOT points at it (WI-3308)"

# ── THE GATE (WI-4419). Audit what we ACTUALLY produced, not what we meant to.
# Wired HERE, in the producer, rather than in each of the three callers
# (release-local.sh / mac-vm-build.sh / build-windows-on-vm.sh) — a gate that
# each platform has to remember to call is a gate that one platform forgets, and
# the leak's CONTENTS vary by build host (the mac Server bundle carried the same
# structural hole with zero transcripts, purely because that box had none). The
# allowlist decides what we MEAN to ship; this decides what we DID.
#
# Fatal by design. If this fires, fix the allowlist above — do not add an
# exception to make the build pass.
if ! python3 "$HERE/audit-release-bundle.py" "$OUT"; then
  echo "" >&2
  echo "ERROR: release bundle audit FAILED — refusing to package (WI-4419)." >&2
  exit 1
fi
exit 0

}  # ── end self-read guard (WI-3306) — opened after 'set -euo pipefail' above ──
