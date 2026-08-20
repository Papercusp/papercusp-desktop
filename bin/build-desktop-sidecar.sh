#!/usr/bin/env bash
# Build the Node sidecar that the Papercusp desktop app bundles.
#
# Strategy (post operator-vite migration, Phase F3/G4; entry swapped to
# `serve` by SP1 C5): the operator UI is the Vite SPA (apps/operator-vite),
# and the SPA + /api/* + /internal/docs/* are served by a single-process Hono
# host. The boot entry is `apps/operator/bin/serve.ts` — the headless
# operator orchestrator that ALSO owns embedded Postgres (start, migrations,
# ~/.papercusp/embedded-pg.json) and writes ~/.papercusp/operator.json
# discovery. This script `vite build`s the SPA and esbuild-bundles serve into
# papercusp-desktop/src-tauri/sidecar/, which Tauri's bundler picks up as a
# resource (declared in tauri.conf.json `resources`). Tauri main.rs spawns
# `node sidecar/serve.mjs --ensure`.
#
# The bundled sidecar is self-contained: serve.mjs has every inlinable module
# bundled in; only genuinely-native deps (node-pty, the holepunch stack) and
# the embedded-postgres-server package (PG binaries resolve off its real
# package dir) ship as node_modules.

set -euo pipefail

# Multi-repo layout (post phase-c split). The desktop bundle pulls from
# two sibling clones:
#
#   Papercusp/papercusp-desktop   ← this repo (HERE = bin/)
#   Papercusp/papercup            ← contains apps/operator (Next.js UI)
#                                    AND libs/papercusp/ (submodule with
#                                    embedded-postgres-server, zero-cache-server,
#                                    harness, papercusp-mcp-server,
#                                    cli, orchestrator). The submodule is the
#                                    canonical post-phase-c location for these
#                                    packages — the old sibling-repo
#                                    Papercusp/papercusp clone is no longer
#                                    used by this script.
#
# Override locations with REPO_ROOT / PAPERCUSP_ROOT if your layout
# differs (e.g. CI clones into a flat workspace dir).

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
REPO_ROOT="${REPO_ROOT:-$ROOT/..}"
PAPERCUSP_ROOT="${PAPERCUSP_ROOT:-$REPO_ROOT/libs/papercusp}"
WEB_DIR="$REPO_ROOT/apps/operator"

# EI-20971912793028056: the final assembled-sidecar identity audit deliberately
# refuses to certify unless the owner's NAME is asserted at run time. Git cannot
# supply it: release builders use automation identities, and accepting those would
# turn a clean verdict into false evidence. This used to fail only after the entire
# sidecar had been assembled. Mirror audit-release-bundle.py's exact non-empty rule
# here (comma/semicolon-separated values, surrounding whitespace ignored) so a
# release-audited build fails before the first toolchain or dependency operation.
# Keep the value runtime-only — writing it into tracked source would create the
# identity leak this gate exists to prevent.
_release_owner_name="${PAPERCUSP_RELEASE_OWNER_NAME:-}"
if [[ "${PAPERCUSP_RELEASE_AUDIT:-0}" == "1" \
   && -z "${_release_owner_name//[[:space:],;]/}" ]]; then
  echo "ERROR: PAPERCUSP_RELEASE_AUDIT=1 requires a non-empty PAPERCUSP_RELEASE_OWNER_NAME before building." >&2
  echo "       Export it at run time (never write it into a tracked file), then re-run." >&2
  echo "       Refusing now because the final identity audit cannot certify without it." >&2
  exit 2
fi
unset _release_owner_name

# EI-20228051309163209: release builders are invoked from several environments
# (interactive shells, systemd user units, cron/routines). The systemd user
# manager can retain an OLD PATH for days: on 2026-08-12 it resolved NVM Node 22
# even though the repo's .nvmrc/engines require Node 25 and the host's current
# Linuxbrew runtime was Node 25. npm 10 under Node 22 then reported a successful
# scoped install while leaving 100+ direct operator dependencies un-extracted,
# producing a misleading dependency-resolution red after the build had started.
# Resolve the repo-pinned major here, before the first node/npm call. Prefer the
# caller's node when it satisfies the pin; otherwise use a matching common
# NVM/Homebrew/mise install and prepend ITS bin directory to PATH so `npm` uses
# the same runtime. If none exists, fail fast with the actual vs required major.
PAPERCUSP_REQUIRED_NODE_MAJOR="$(sed -nE 's/^[[:space:]]*v?([0-9]+).*$/\1/p' "$REPO_ROOT/.nvmrc" 2>/dev/null | head -1)"
# P-411 R1 (check-assert-integrity): this used to coerce an empty read to 25.
# An empty read means EITHER "the pin is unreadable/missing" OR "the parse
# failed" — it never means "the pin is 25". Coercing made an UNMEASURED probe
# score as the permissive case, and the consequence is not hypothetical: the
# moment the repo pins 26, an unreadable .nvmrc would still admit a Node 25
# build, and the `-ge` assert below would report a requirement it never read.
# That is precisely the failure this whole block was added to prevent
# (EI-20228051309163209), so fail closed — the pin is one cheap file read.
if ! [[ "$PAPERCUSP_REQUIRED_NODE_MAJOR" =~ ^[0-9]+$ ]]; then
  echo "ERROR: could not read the repo-pinned Node major from $REPO_ROOT/.nvmrc" >&2
  echo "       (parsed: '${PAPERCUSP_REQUIRED_NODE_MAJOR:-<empty>}')." >&2
  echo "       The runtime pin is load-bearing for this release build, so this" >&2
  echo "       script refuses to guess it. Restore/repair .nvmrc and re-run." >&2
  exit 1
fi
papercusp_node_major() {
  local candidate="$1"
  [ -x "$candidate" ] || return 1
  "$candidate" -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || return 1
}
_current_node="$(command -v node 2>/dev/null || true)"
_brew_node=""
if command -v brew >/dev/null 2>&1; then
  _brew_node="$(brew --prefix node 2>/dev/null || true)/bin/node"
fi
_selected_node=""
for _node_candidate in \
  "$_current_node" \
  "$_brew_node" \
  /home/linuxbrew/.linuxbrew/bin/node \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  "$HOME"/.nvm/versions/node/v"$PAPERCUSP_REQUIRED_NODE_MAJOR"*/bin/node \
  "$HOME"/.local/share/mise/installs/node/"$PAPERCUSP_REQUIRED_NODE_MAJOR"*/bin/node; do
  [ -n "$_node_candidate" ] && [ -x "$_node_candidate" ] || continue
  _node_major="$(papercusp_node_major "$_node_candidate" || true)"
  if [[ "$_node_major" =~ ^[0-9]+$ ]] && [ "$_node_major" -ge "$PAPERCUSP_REQUIRED_NODE_MAJOR" ]; then
    _selected_node="$_node_candidate"
    break
  fi
done
if [ -z "$_selected_node" ]; then
  _current_version="$($_current_node -v 2>/dev/null || echo unavailable)"
  echo "ERROR: sidecar release build requires Node >=$PAPERCUSP_REQUIRED_NODE_MAJOR (.nvmrc), but PATH resolves ${_current_node:-no node} (${_current_version})." >&2
  echo "       Install/expose the pinned runtime (for example: nvm use $PAPERCUSP_REQUIRED_NODE_MAJOR) before building." >&2
  exit 1
fi
export PATH="$(dirname "$_selected_node"):$PATH"
hash -r
echo "→ using pinned Node runtime: $(command -v node) ($(node -v), required >=$PAPERCUSP_REQUIRED_NODE_MAJOR)"
unset _current_node _current_version _brew_node _selected_node _node_candidate _node_major

# WI-5651: normally the sidecar is assembled + published at src-tauri/sidecar
# (where tauri build's bundle.resources glob reads it — a real release cut MUST
# use that). PAPERCUSP_SIDECAR_OUT redirects the WHOLE build (temp stage, lock,
# atomic publish) to a scratch dir so a cross-platform TEST bundle can be built
# and inspected WITHOUT clobbering the live host sidecar on this shared tree.
SIDECAR_DIR="${PAPERCUSP_SIDECAR_OUT:-$ROOT/src-tauri/sidecar}"

if [[ ! -d "$WEB_DIR" ]]; then
  echo "ERROR: papercup/apps/operator not found at $WEB_DIR"
  echo "       Set REPO_ROOT to the path of your Papercusp/papercup clone."
  exit 1
fi
if [[ ! -d "$PAPERCUSP_ROOT" ]]; then
  echo "ERROR: papercusp not found at $PAPERCUSP_ROOT"
  echo "       Set PAPERCUSP_ROOT to the path of your Papercusp/papercusp clone."
  exit 1
fi

# ── EI-1836 / WI-5695 class guard: fail FAST + NAMED on a committed git conflict
# marker, before spending minutes on npm install + the vite build. On 2026-06-20
# (EI-1836) and again on 2026-07-20 (WI-5695, a `git stash` mishap — see
# EI-18215743778965613) a git-sync auto-commit swept up `apps/operator/app/globals.css`
# mid-conflict, and this script's `vite build` then died on a cryptic
# `CssSyntaxError: Unknown word "Stashed"` with no named root — green-checkpoint
# already runs this same check (apps/operator/lib/release/green-checkpoint.ts) but
# this standalone sidecar-build path did not, so the SAME class recurred here
# undetected. scripts/check-conflict-markers.mjs is the single tested source of
# truth for the marker pattern (packages/operator-core/lib/__tests__/check-conflict-markers-guard.test.ts) — reuse it.
echo "→ checking for committed git conflict markers (EI-1836/WI-5695 class guard)"
if ! node "$REPO_ROOT/scripts/check-conflict-markers.mjs"; then
  echo "ERROR: committed git conflict marker(s) found in $REPO_ROOT — resolve before building (see above)."
  exit 1
fi

# ── WI-5651: cross-target sidecar (bake on Linux for mac/windows, retire the VMs) ─
# The sidecar's JS (serve.mjs, spa/, db-sql/) is platform-INDEPENDENT — only its
# BINARY payload differs per OS/arch: the vendored `node`, gh/zellij/pui, the
# embedded-postgres binaries, pgvector, and the native .node addons (node-pty,
# sharp, the bare/holepunch stack, onnxruntime-node). Historically this script
# built ONLY for its own host ($(uname)), so a mac/windows bundle had to be
# produced ON a mac/windows host (the fragile QEMU build VMs). WI-5651 retires
# those VMs by CROSS-baking every leg on this Linux box.
#   TARGET_OS   = linux | darwin | windows   (default: this host)
#   TARGET_ARCH = x64 | arm64                 (default: this host)
# Both DEFAULT to the host, so an UN-set invocation is byte-for-byte the same
# build as before — every existing linux/native caller is unchanged. The value
# flows into: target_os/target_arch (external-binary section), the native-addon
# prune (keeps the TARGET's prebuilds) + fetch (pulls the TARGET's per-platform
# optional pkgs npm won't install cross), embedded-postgres, and pgvector.
_host_os=""
case "$(uname -s)" in
  Linux*)               _host_os="linux" ;;
  Darwin*)              _host_os="darwin" ;;
  MINGW*|MSYS*|CYGWIN*) _host_os="windows" ;;
  *)                    _host_os="$(uname -s)" ;;
esac
_host_arch=""
case "$(uname -m)" in
  x86_64|amd64)  _host_arch="x64" ;;
  arm64|aarch64) _host_arch="arm64" ;;
  *)             _host_arch="$(uname -m)" ;;
esac
TARGET_OS="${TARGET_OS:-$_host_os}"
TARGET_ARCH="${TARGET_ARCH:-$_host_arch}"
CROSS_BUILD=0
if [[ "$TARGET_OS" != "$_host_os" || "$TARGET_ARCH" != "$_host_arch" ]]; then
  CROSS_BUILD=1
  echo "→ WI-5651 CROSS-baking sidecar for ${TARGET_OS}-${TARGET_ARCH} on a ${_host_os}-${_host_arch} host"
fi

# WI-2644 / EI-18751304112302229: the packaged sidecar's serve.mjs runs
# standalone (no `npm run` context), so process.env.npm_package_version is
# unset at runtime and build-info.ts / serve.ts fall back to their (differing)
# hardcoded defaults — the installed app's /api/health + UI footer report a
# fake '0.0.0'/dev version instead of the real shipped one. tauri.conf.json's
# `version` is the authoritative shipped version (release.config.ts's
# versionFiles bumps package.json + tauri.conf.json + Cargo.toml together on
# every release), so read it here and bake it into the bundle via esbuild
# --define below.
#
# EI-18751304112302229: this used to bake ONLY
# --define:process.env.npm_package_version, but esbuild's --define is a
# SYNTACTIC rewrite of the exact member expression named. That correctly
# reaches a call site that writes the literal expression itself (e.g.
# endpoint-route/routes/desktop/onboarding-launch-context.ts's `appVersion:
# process.env.npm_package_version ?? …`), but build-info.ts never writes that
# literal — it reads through an injectable-seam alias (`const env = opts.env
# ?? process.env; env.npm_package_version`) — so for THAT consumer (the one
# WI-2644 was actually filed about: /api/health) the define had nothing to
# match and silently baked into nothing. Keep the original literal define for
# the former, and ALSO bake a dedicated global identifier — the same idiom
# __PAPERCUSP_BUNDLED_SIDECAR__ already uses below — that build-info.ts reads
# directly, so there is no alias left for esbuild to miss.
PAPERCUSP_DESKTOP_VERSION="$(node -e "try{process.stdout.write(require('$ROOT/src-tauri/tauri.conf.json').version||'')}catch(e){}" 2>/dev/null)"
# Built as an array (not a bare --define string) so the UNREADABLE case omits
# the flag ENTIRELY rather than baking an empty string: `?? '0.0.0'`-style
# fallbacks only trigger on undefined/null, so `--define:...="\"\""` would bake
# a WORSE empty-string version than today's unset-env fallback.
VERSION_DEFINE_ARGS=()
if [[ -n "$PAPERCUSP_DESKTOP_VERSION" ]]; then
  VERSION_DEFINE_ARGS=(
    --define:process.env.npm_package_version="\"${PAPERCUSP_DESKTOP_VERSION}\""
    --define:__PAPERCUSP_SIDECAR_VERSION__="\"${PAPERCUSP_DESKTOP_VERSION}\""
  )
else
  echo "WARN: could not read version from $ROOT/src-tauri/tauri.conf.json — sidecar will report its unstamped fallback version"
fi

# ── EI-160: no concurrent-build clobber (P-056) ─────────────────────────────
# Two builds racing into the same live SIDECAR_DIR used to interleave
# rm -rf/cp — a reader (a running `tauri dev`, the federation smoke rigs)
# caught mid-swap saw a half-written bundle, and a second builder could
# truncate binaries the first was still copying. Serialize whole builds with
# flock, build into a temp sibling, and publish with an atomic rename at the
# very end so readers only ever see the complete old tree or the complete
# new tree.
#
# EI-200: this protects OTHER invocations of THIS script from each other —
# it does NOT protect a plain `cargo build`/`cargo check` under src-tauri
# from racing the publish step below. tauri.conf.json's `bundle.resources`
# glob (sidecar/**/*) is validated by `generate_context!` at COMPILE time,
# and the publish sequence briefly renames SIDECAR_FINAL_DIR OUT before
# renaming the new tree IN (a real, if narrow, "sidecar/ doesn't exist at
# all" window) — a cargo-build invocation whose glob validation lands there fails with
# a misleading "path not found" error. Use bin/cargo-build-safe.sh instead
# of a bare `cargo <args>` under src-tauri when building alongside active
# desktop-sidecar contention — it takes a SHARED flock on this same lock
# file, so it waits out an in-flight rebuild instead of racing it.
SIDECAR_FINAL_DIR="$SIDECAR_DIR"
SIDECAR_TMP_DIR="$SIDECAR_FINAL_DIR.tmp.$$"
mkdir -p "$(dirname "$SIDECAR_FINAL_DIR")"
# shellcheck source=lib/sidecar-lock-yield.sh
source "$HERE/lib/sidecar-lock-yield.sh"
exec 9>"$SIDECAR_FINAL_DIR.lock"
SIDECAR_LOCKDIR=""

if command -v flock >/dev/null 2>&1; then
  __pc_acquire_sidecar_flock "$SIDECAR_FINAL_DIR.lock" || exit $?
else
  # macOS ships no flock(1) — same EI-160 serialization via a mkdir
  # spinlock with stale-PID reclaim.
  SIDECAR_LOCKDIR="$SIDECAR_FINAL_DIR.lockdir"
  if [[ -d "$SIDECAR_LOCKDIR" ]]; then
    echo "→ sidecar lock is busy; allowing the current writer ${SIDECAR_READER_YIELD_AFTER}s before requesting a cooperative yield"
    ((SIDECAR_READER_YIELD_AFTER == 0)) || sleep "$SIDECAR_READER_YIELD_AFTER"
    __pc_request_cooperative_reader_yield "$SIDECAR_FINAL_DIR.lock" "$SIDECAR_LOCKDIR"
  fi
  __pc_lock_deadline=$(( $(date +%s) + SIDECAR_LOCK_WAIT ))
  while ! mkdir "$SIDECAR_LOCKDIR" 2>/dev/null; do
    holder="$(cat "$SIDECAR_LOCKDIR/pid" 2>/dev/null || true)"
    if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$SIDECAR_LOCKDIR"
      continue
    fi
    if (( $(date +%s) >= __pc_lock_deadline )); then
      __pc_report_sidecar_lock_timeout "$SIDECAR_FINAL_DIR.lock" "$SIDECAR_LOCKDIR"
      exit 5
    fi
    sleep 1
  done
  echo "$$" > "$SIDECAR_LOCKDIR/pid"
fi
SIDECAR_DIR="$SIDECAR_TMP_DIR"

# STALE STAGING SWEEP (WI-38368 / EI-18882950272344248) — reap residue the EXIT
# trap structurally CANNOT catch.
#
# The EXIT trap above already covers far more than it looks like it does:
# measured on this box, a bash EXIT trap DOES fire on SIGTERM and SIGINT, so
# `trap ... EXIT INT TERM` would add nothing. What no trap can ever catch is
# SIGKILL (also the OOM killer, a power loss, a hard reset) — the process is
# destroyed without running userspace. That is the ONLY way residue survives
# now, and it is how `sidecar.tmp.3992781` (1.4GB, owning pid long dead) came
# to sit here for over a day. A sweep is therefore not redundant with the
# trap; it is the only mechanism that can close the remaining class.
#
# Placed deliberately AFTER the lock is held and BEFORE the disk preflight:
#   - holding the EXCLUSIVE flock means no concurrent build is between
#     lock-acquire and lock-release, so anything matching here is by
#     construction not an in-flight peer's tree;
#   - sweeping before the preflight means reclaimed space COUNTS toward the
#     free-GB requirement, so a build that would have died on "not enough
#     space" now succeeds off its own garbage.
#
# ⚠ PID-CHECKED, NEVER BLANKET. This is a shared multi-agent tree and a
# blanket `rm -rf sidecar.tmp.*` would turn a latent race (a concurrent build
# finishing its atomic rename while STAGE2 tars src-tauri) into a reliable
# failure. `kill -0` ALONE is not enough either: pid wrap happens ~daily on
# this box under fleet load, so a recycled pid would otherwise protect dead
# residue forever. We require the pid to be alive AND to actually be a
# build-desktop-sidecar.sh process. Both checks failing open (skip, don't
# delete) is the safe direction — a missed reap costs disk, a wrong reap
# costs someone else's build.
__pc_sweep_stale_staging() {
  local d pid base reaped=0 freed_kb=0 sz
  for d in "$SIDECAR_FINAL_DIR".tmp.* "$SIDECAR_FINAL_DIR".old.*; do
    [[ -d "$d" ]] || continue                 # unmatched glob expands to itself
    [[ "$d" == "$SIDECAR_TMP_DIR" ]] && continue   # never our own staging tree
    base="${d##*.}"
    pid="$base"
    # A non-numeric suffix is not a pid-stamped staging dir we own — leave it.
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    [[ "$pid" == "$$" ]] && continue
    if kill -0 "$pid" 2>/dev/null &&
       ps -p "$pid" -o args= 2>/dev/null | grep -q 'build-desktop-sidecar'; then
      echo "[sweep] skip $(basename "$d") — pid $pid is a LIVE build"
      continue
    fi
    sz="$(du -sk "$d" 2>/dev/null | cut -f1)"
    [[ "$sz" =~ ^[0-9]+$ ]] || sz=0
    if rm -rf "$d" 2>/dev/null; then
      reaped=$((reaped + 1)); freed_kb=$((freed_kb + sz))
      echo "[sweep] reaped $(basename "$d") — owning pid $pid is dead ($((sz / 1024))MB)"
    else
      echo "[sweep] WARN could not remove $d" >&2
    fi
  done
  (( reaped > 0 )) && echo "[sweep] reclaimed $((freed_kb / 1024))MB from $reaped stale staging dir(s)"
  return 0
}
__pc_sweep_stale_staging

# DISK PREFLIGHT (EI-20090527288494606) — refuse now, not 3 minutes into the copy.
# This script stages a multi-GB tree (node_modules + the ~2.4GB sidecar payload)
# and, at publish time, briefly holds BOTH the old and new trees during the
# OLD_DIR swap — so the requirement is roughly twice the payload plus slack. On
# 2026-08-10 this ran with the root fs at 100% and died mid-`cp` with
# `No space left on device`, leaving a partially-staged tree that still looked
# valid to later steps. Measured against the dir we actually stage INTO, which is
# not necessarily $PWD.
# shellcheck source=lib/disk-preflight.sh
source "$HERE/lib/disk-preflight.sh"
papercusp_require_free_gb "$SIDECAR_DIR" "${PAPERCUSP_SIDECAR_MIN_FREE_GB:-8}" "sidecar staging" || exit $?

# Clean the temp tree (and the darwin lockdir) on any exit; after the
# publish rename the tmp half is a no-op.
#
# WI-6557: OLD_DIR is ALSO reaped here, even though `OLD_DIR` is not assigned
# until much later (the `mv "$SIDECAR_FINAL_DIR" "$OLD_DIR"` swap just before
# publish) — this trap string is single-quoted, so `${OLD_DIR:+...}` is
# re-expanded at FIRE time, by which point OLD_DIR is whatever the run has
# reached (unset/empty before the swap, the real path after it). `:+` never
# trips `set -u` for an unset var, so this is safe on every exit before the
# swap too. Before this fix, the ONLY reap of OLD_DIR was the explicit
# `rm -rf "$OLD_DIR"` on the success path — so ANY failure between the swap
# and that line (a `set -e` death, an explicit `exit 1` guard, e.g. the
# stray-runtime-.cache check) permanently stranded the ENTIRE outgoing
# sidecar tree (multiple GB) with no cleanup path at all. 11 orphaned
# `sidecar.old.<pid>` dirs — one per such death, one of them 2.5G — were
# found stranded on this box from exactly this gap. Safe to add
# unconditionally: on the success path OLD_DIR is already removed by the
# explicit `rm -rf` below by the time this trap fires, so `rm -rf` on an
# already-gone path is a silent no-op; the trap never fires MID-run (only at
# actual process exit), so it cannot race the overlay-preservation read that
# copies FROM OLD_DIR just after the swap.
trap 'rm -rf "$SIDECAR_TMP_DIR" ${SIDECAR_LOCKDIR:+"$SIDECAR_LOCKDIR"} ${OLD_DIR:+"$OLD_DIR"}' EXIT

# ---------------------------------------------------------------------------
# operator-vite migration (Phase F3 / G4). The desktop UI is no longer a
# Next.js app — it is the Vite SPA (apps/operator-vite) served, together
# with /api/* and /internal/docs/*, by the single-process Hono host
# (apps/operator/bin/hono-host.ts). So instead of `next build` →
# `.next/standalone`, this section:
#
#   1. installs operator + operator-vite deps,
#   2. `vite build`s the SPA → apps/operator-vite/dist/,
#   3. esbuild-bundles the serve entry into one ESM file (sidecar/serve.mjs),
#   4. copies the SPA, the Starlight docs, operator prompts, and the
#      externalized native deps (node-pty, embedded-postgres-server, …)
#      into the sidecar.
#
# Why esbuild and not a node_modules copy: the monorepo hoists deps to the
# repo-root node_modules, so `cp apps/operator/node_modules` would miss
# them. `next build`'s standalone tracer used to resolve that; esbuild
# resolves it differently — it follows the host's import graph and *inlines*
# every module, hoisting and workspace symlinks alike. The result needs no
# node_modules except the handful that genuinely cannot be inlined.
#
# ┌─ BUNDLE STEP: VERIFIED 2026-05-21 ──────────────────────────────────┐
# │ The esbuild bundle step itself is verified — esbuild@0.25.0 bundles  │
# │ the full host import graph clean (17.5MB host.mjs, parses as valid   │
# │ ESM) with exactly the HOST_EXTERNALS below. node-pty is the only     │
# │ genuinely-native external. UNVERIFIED beyond bundling: whether the   │
# │ bundle RUNS correctly in the packaged desktop (needs a real          │
# │ `tauri build` + the embedded-PG sidecars). If a FUTURE host route    │
# │ adds a native (.node) or .wasm dep, esbuild will fail with "Could    │
# │ not resolve" — add that package to HOST_EXTERNALS and copy it into   │
# │ sidecar/node_modules alongside the node-pty copy below.              │
# └─────────────────────────────────────────────────────────────────────┘
# ---------------------------------------------------------------------------
echo "→ building operator-vite SPA + esbuild-bundling the Hono host"
VITE_DIR="$REPO_ROOT/apps/operator-vite"
if [[ ! -d "$VITE_DIR" ]]; then
  echo "ERROR: apps/operator-vite not found at $VITE_DIR"
  exit 1
fi
echo "→ installing operator + operator-vite deps (ONE combined workspace install)"
# ROOT-CAUSE FIX (2026-07-07, WI-3284): this USED to be two SEPARATE
# `(cd apps/operator && npm install)` then `(cd apps/operator-vite && npm install)`
# calls. Each such directory-scoped install reconciles the shared root
# node_modules against ONLY that one workspace's OWN declared dependency graph
# and PRUNES anything not in it — so the SECOND call (operator-vite) silently
# stripped packages the FIRST call (operator) had just hoisted for itself,
# because npm's dependency graph only follows package.json "dependencies"
# edges, not Vite's `@` alias (which treats apps/operator/app/** as literal
# operator-vite source, not a package boundary). Every package reachable ONLY
# through that alias — @glideapps/glide-data-grid's peers (lodash / marked /
# react-responsive-carousel), @papercusp/lexicon, @udecode/plate-markdown,
# dockview (via @papercusp/dock-workbench) — has repeatedly broken `vite
# build` with "Rolldown failed to resolve <pkg>" this way. Patching
# apps/operator-vite/package.json one missing package at a time (the old
# glide-data-grid fix) does not scale — a NEW alias-reachable import from
# apps/operator always reopens the same hole.
# FIX: install BOTH workspaces in ONE npm call so npm reconciles against the
# UNION of their declared dependency graphs — nothing either one needs gets
# pruned, regardless of which one the vite alias actually resolves through.
#
# ── `--prefer-offline` REMOVED (2026-07-25, WI-5769) — root cause of the
# whole "fix one missing dep, VM build finds another" saga ──────────────────
# On a fresh/remote VM (its npm cache never saw a just-declared package
# before), `npm install --prefer-offline --workspace=X --workspace=Y` prints
# "up to date" and EXITS WITHOUT ERROR while silently leaving that package
# missing from node_modules — the lockfile (and node_modules/.package-lock.json)
# both correctly list it as resolved, but the tarball is never actually
# extracted to disk. `npm ls <pkg>` then reports "(empty)". This is an npm
# workspace-scoped-install quirk, not flakiness: reproduced deterministically
# 3x — dropping just this one flag (keeping --legacy-peer-deps --no-audit
# --no-fund --ignore-scripts) made every one of 4 independently-diagnosed
# "missing dependency" bugs (@mantine/hooks, ajv-errors, slate,
# @anthropic-ai/sdk) resolve in the SAME single install, instead of needing
# 6+ separate full universal-arch rebuild retries (each tens of minutes) to
# discover them one at a time. Do not re-add `--prefer-offline` here without
# re-verifying against a VM whose npm cache is cold for the packages in
# question.
(cd "$REPO_ROOT" && npm install --legacy-peer-deps --no-audit --no-fund --ignore-scripts \
  --workspace=@papercusp/web --workspace=@papercusp/operator-vite \
  --workspace=@papercusp/sse)

# POST-INSTALL RUNTIME BUILDS (EI-20505823617947029) -------------------------
# setup-release-checkout.sh builds these gitignored runtime entry points from
# the pinned release source before a cut starts. The scoped install above is a
# second dependency-reification boundary, though: npm can leave the workspace
# symlink and package.json intact while removing the generated dist/ behind it.
# That exact shape made `createRequire(...).resolve("@papercusp/sse")` fail in
# the D-026 stable cut even though the package was correctly installed.
#
# Rebuild from THIS REPO_ROOT after the install, never by copying an integration
# tree's dist/. The registry is intentionally explicit and is checked against
# every workspace with a gitignored main/require/default target by
# setup-release-checkout-workspace-builds.test.ts.
RUNTIME_BUILD_WORKSPACES=(
  "@papercusp/sse"
)

build_runtime_workspace_outputs_after_install() {
  local workspace
  for workspace in "${RUNTIME_BUILD_WORKSPACES[@]}"; do
    echo "→ reifying build-time devDependencies for $workspace"
    if ! (cd "$REPO_ROOT" && npm install --legacy-peer-deps --no-audit --no-fund \
      --ignore-scripts --include=dev --workspace="$workspace"); then
      echo "ERROR: could not reify build-time devDependencies for $workspace" >&2
      exit 1
    fi
    echo "→ verifying the resolved TypeScript toolchain for $workspace"
    if ! (cd "$REPO_ROOT" && npm --workspace="$workspace" exec -- node -e '
const expected = require("./package.json").devDependencies?.typescript ?? "";
let actual = "<unresolved>";
try {
  actual = require("typescript/package.json").version;
} catch {
  // The diagnostic below names the unresolved toolchain.
}
const expectedMatch = /^(~|\^)?(\d+)\.(\d+)\.(\d+)$/.exec(expected);
const actualMatch = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(actual);
let compatible = false;
if (expectedMatch && actualMatch) {
  const [, operator = "", expectedMajor, expectedMinor, expectedPatch] = expectedMatch;
  const [, actualMajor, actualMinor, actualPatch] = actualMatch;
  const eMajor = Number(expectedMajor);
  const eMinor = Number(expectedMinor);
  const ePatch = Number(expectedPatch);
  const aMajor = Number(actualMajor);
  const aMinor = Number(actualMinor);
  const aPatch = Number(actualPatch);
  if (operator === "~") {
    compatible = aMajor === eMajor && aMinor === eMinor && aPatch >= ePatch;
  } else if (operator === "^") {
    compatible =
      aMajor === eMajor &&
      (eMajor > 0
        ? aMinor > eMinor || (aMinor === eMinor && aPatch >= ePatch)
        : eMinor > 0
          ? aMinor === eMinor && aPatch >= ePatch
          : aMinor === 0 && aPatch === ePatch);
  } else {
    compatible = aMajor === eMajor && aMinor === eMinor && aPatch === ePatch;
  }
}
if (!compatible) {
  console.error(
    "FATAL: " + (process.env.npm_package_name ?? "runtime workspace") +
      " build toolchain mismatch: package pins typescript " +
      (expected || "<missing>") + " but resolves " + actual + ".",
  );
  process.exit(1);
}
console.log(
  "  ✓ " + (process.env.npm_package_name ?? "runtime workspace") +
    ": TypeScript " + actual + " satisfies " + expected,
);
'); then
      echo "ERROR: resolved TypeScript does not satisfy the workspace pin for $workspace" >&2
      exit 1
    fi
    echo "→ rebuilding post-install runtime output for $workspace"
    (cd "$REPO_ROOT" && npm --workspace "$workspace" run build)
  done
}
build_runtime_workspace_outputs_after_install
# END POST-INSTALL RUNTIME BUILDS ---------------------------------------------

echo "→ verifying workspace deps resolved"
echo "  apps/operator/node_modules/@restart/ contents:"
ls -la "$WEB_DIR/node_modules/@restart" 2>&1 | head -10 || echo "(no @restart subdir)"
echo "  apps/operator/node_modules/@papercusp/ contents:"
ls -la "$WEB_DIR/node_modules/@papercusp" 2>&1 | head -10 || echo "(no @papercusp subdir)"
# FAIL-FAST GUARD (2026-07-25, WI-5769): the two `ls` checks above are purely
# informational — neither fails the build, so the exact "npm said up to date
# but a declared dep never got extracted to node_modules" bug this whole
# section's header comment documents used to sail straight through this
# "verification" and only surface ~10 minutes later as a cryptic Rolldown
# "failed to resolve" error, and again ~45 minutes after THAT inside the
# 6+-minute-a-pop full universal-arch Rust/Swift build if the vite build step
# were ever skipped.
#
# SURGICAL, not `npm ls --all`: an earlier version of this guard shelled out to
# `npm ls --all --workspace=…` and failed on ANY "npm error missing:" line.
# That is too broad — under --legacy-peer-deps, `npm ls` reports every UNMET
# (non-optional) PEER dependency the same way, including transitive peers of
# packages that are test-only and never reach the vite bundle graph (concrete
# case: @papercusp/test-config → @nestjs/testing's REQUIRED peer @nestjs/core,
# which nothing in apps/operator/app or apps/operator-vite/src imports — a
# real false-positive that blocked a build for a dependency this build never
# needed). Check instead — and ONLY — that every package OUR OWN two
# workspaces directly declare in "dependencies" actually resolves on disk;
# that is the exact shape of the original bug (a declared dep silently
# un-extracted) without inheriting every third-party package's own optional
# peer graph.
#
# RETRY-WITH-DELAY (2026-07-26, WI-5769 retry8): a live mac-VM run hit this
# guard firing on a genuinely-transient miss — @restart/@papercusp missing
# immediately after "up to date in 19s" — that could NOT be reproduced by
# re-running the identical scoped install + immediate check twice afterward
# (both came back MISSING COUNT: 0 instantly). That is the signature of a
# filesystem-sync race (the VM's disk/extraction hadn't settled by the time
# this check ran), not a real un-extracted dependency — but the guard used to
# fail HARD on the very first check, turning a ~3-second race into a wasted
# 15-30min full universal-arch rebuild retry. Give the filesystem a few
# seconds to settle before declaring a real miss: retry the same check up to
# 3x with a short delay: a persistent miss across all 3 attempts (spanning 6s)
# is a real un-extracted dependency and still fails the build; a miss that
# clears on retry is the race, logged but non-fatal.
dep_check_attempts=3
dep_check_ok=0
for dep_check_attempt in $(seq 1 "$dep_check_attempts"); do
  if node -e '
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const repoRoot = process.argv[1];
const attempt = process.argv[2];
const pkgs = ["apps/operator/package.json", "apps/operator-vite/package.json"];
const missing = [];
const runtimeDetails = [];

for (const workspace of process.argv.slice(3)) {
  const packageRoot = path.join(repoRoot, "node_modules", workspace);
  const manifestPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(manifestPath)) {
    runtimeDetails.push(`${workspace}: package.json MISSING; TypeScript <unresolved>`);
    continue;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    runtimeDetails.push(
      `${workspace}: package.json unreadable (${error instanceof Error ? error.message : String(error)}); TypeScript <unresolved>`,
    );
    continue;
  }

  let tscVersion = "<unresolved>";
  try {
    tscVersion = createRequire(manifestPath).resolve("typescript/package.json");
    tscVersion = JSON.parse(fs.readFileSync(tscVersion, "utf8")).version;
  } catch {
    // Keep the diagnostic explicit when the workspace-local/root compiler is absent.
  }

  const runtimeTargets = [];
  if (typeof manifest.main === "string") runtimeTargets.push(manifest.main);
  if (manifest.exports && typeof manifest.exports === "object") {
    for (const entry of Object.values(manifest.exports)) {
      if (typeof entry === "string") {
        runtimeTargets.push(entry);
      } else if (entry && typeof entry === "object") {
        for (const condition of ["require", "default"]) {
          if (typeof entry[condition] === "string") runtimeTargets.push(entry[condition]);
        }
      }
    }
  }
  const outputStatus = [...new Set(runtimeTargets)]
    .map((target) => {
      const outputPath = target.startsWith("./")
        ? path.resolve(packageRoot, target)
        : path.join(packageRoot, target);
      return `${target}=${fs.existsSync(outputPath) ? "present" : "MISSING"}`;
    })
    .join(", ") || "none declared";
  runtimeDetails.push(
    `${workspace}: TypeScript ${tscVersion} (pin ${manifest.devDependencies?.typescript ?? "<missing>"}); runtime outputs ${outputStatus}`,
  );
}

for (const rel of pkgs) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
  for (const dep of Object.keys(pkg.dependencies || {})) {
    // Resolve the way Node/Rolldown would: workspace-local node_modules first,
    // falling back to the hoisted root node_modules.
    const candidates = [
      path.join(repoRoot, path.dirname(rel), "node_modules", dep),
      path.join(repoRoot, "node_modules", dep),
    ];
    if (!candidates.some((c) => fs.existsSync(c))) {
      missing.push(`${dep} (declared in ${rel})`);
    }
  }
}

// WI-38149: Vite follows file: workspace dependencies through their symlinks
// and resolves imports from each library realpath, not from the consuming app
// directory. A scoped npm install can therefore report both app workspaces
// complete while putting a runtime peer only beneath apps/operator/node_modules,
// where the linked library cannot see it. Validate the complete peer contract
// of DIRECT file: dependencies from the union installed above: each required
// peer must be declared by at least one installed app workspace and must
// resolve from the library realpath Vite uses. This stays narrower than the
// old npm-ls --all false-positive class because it never walks transitive peers.
const installDeclarations = new Set();
for (const rel of pkgs) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
  for (const dep of Object.keys(pkg.dependencies || {})) installDeclarations.add(dep);
  for (const dep of Object.keys(pkg.devDependencies || {})) installDeclarations.add(dep);
}
for (const rel of pkgs) {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
  for (const [dep, spec] of Object.entries(pkg.dependencies || {})) {
    if (typeof spec !== "string" || !spec.startsWith("file:")) continue;
    const workspaceRoot = path.resolve(repoRoot, path.dirname(rel), spec.slice("file:".length));
    const workspacePackagePath = path.join(workspaceRoot, "package.json");
    if (!fs.existsSync(workspacePackagePath)) continue;
    const workspacePackage = JSON.parse(fs.readFileSync(workspacePackagePath, "utf8"));
    const requireFromWorkspace = createRequire(workspacePackagePath);
    for (const peer of Object.keys(workspacePackage.peerDependencies || {})) {
      if (workspacePackage.peerDependenciesMeta?.[peer]?.optional) continue;
      if (!installDeclarations.has(peer)) {
        missing.push(`${peer} (required peer of ${dep}, but undeclared by the installed app workspaces)`);
        continue;
      }
      try {
        requireFromWorkspace.resolve(peer);
      } catch {
        missing.push(`${peer} (required peer of ${dep}, unresolved from ${path.relative(repoRoot, workspaceRoot)}/ realpath)`);
      }
    }
  }
}
if (missing.length > 0) {
  console.error(`dep-check attempt ${attempt}: post-install dependency resolution found missing DIRECTLY-DECLARED dependencies on disk. This is a real dependency-tree miss, not an npm "up to date" or extraction-class diagnosis; if it persists across all retries it is not a filesystem-sync race.`);
  for (const m of missing) console.error(`  - ${m}`);
  console.error("  runtime-build diagnostics (output targets + resolved TypeScript):");
  for (const detail of runtimeDetails) console.error(`  - ${detail}`);
  process.exit(1);
}
' "$REPO_ROOT" "$dep_check_attempt" "${RUNTIME_BUILD_WORKSPACES[@]}"; then
    dep_check_ok=1
    break
  fi
  if [[ "$dep_check_attempt" -lt "$dep_check_attempts" ]]; then
    echo "dep-check: retrying in 2s (attempt $dep_check_attempt/$dep_check_attempts missed — could be a filesystem-sync race; WI-5769)"
    sleep 2
  fi
done
if [[ "$dep_check_ok" -ne 1 ]]; then
  echo "FATAL: dependency-resolution check still failing after $dep_check_attempts attempts with delay — this is a REAL un-extracted dependency, not a transient race. See the dep-check output above for exactly which package(s)."
  exit 1
fi

# Prepare the sidecar staging root before the Vite build. The singleflight seam
# captures the completed SPA into this directory while its build lock is still
# held; later packaging steps consume that stable snapshot instead of rereading
# the shared live dist/ after another build can start.
rm -rf "$SIDECAR_DIR"
mkdir -p "$SIDECAR_DIR/spa" "$SIDECAR_DIR/node_modules/@lydell"

echo "→ building operator-vite SPA (vite build → locked sidecar snapshot)"
# PAPERCUSP_RETAIN_DIST_CHUNKS=0 — this is a PACKAGING build. The
# `VITE_BUILD_SNAPSHOT_DIR` handoff is captured by vite-build-singleflight while
# it holds the Vite build lock, so the SPA that ships is not invalidated by a
# concurrent build after this command exits. Retention (the default since
# `dist-chunk-retention-default-2026-07-26`) keeps old hashed chunks around to
# stop live windows 404-ing their pinned lazy imports — correct on a working
# tree, dead weight in a distributable. So this one caller opts out explicitly.
# Note the tradeoff this makes visible rather than introduces: the build runs in
# $REPO_ROOT (the shared tree), so it empties that tree's dist/ and any desktop
# window open against it will need a reload. Packaging is deliberate and rare.
(cd "$REPO_ROOT" && PAPERCUSP_RETAIN_DIST_CHUNKS=0 \
  VITE_BUILD_SNAPSHOT_DIR="$SIDECAR_DIR/spa" \
  npm --workspace @papercusp/operator-vite run build)
if [[ ! -f "$SIDECAR_DIR/spa/index.html" ]]; then
  echo "ERROR: expected locked Vite snapshot at $SIDECAR_DIR/spa/index.html after the build"
  exit 1
fi

echo "→ building sidecar into $SIDECAR_DIR (atomic publish to $SIDECAR_FINAL_DIR at the end)"
mkdir -p "$SIDECAR_DIR" "$SIDECAR_DIR/node_modules/@lydell"

echo "→ esbuild-bundling the serve entry (headless operator boot) → $SIDECAR_DIR/serve.mjs"
# SP1 C5 (operator-core-headless-serve-2026-06-04, Decision F): the sidecar
# entry is now `bin/serve.ts` — the self-contained operator boot that OWNS
# embedded-PG (start, migrations, embedded-pg.json) and writes operator.json
# discovery. The Rust embedder spawns `serve.mjs --ensure` instead of the old
# host.mjs + a separate embedded-postgres-server process. serve imports the
# full host graph (host-handler/host-bootstrap), so the bundle recipe is the
# same as the old host.mjs one.
#
# ESM output: the host's import graph contains `import.meta.url` (a CJS
# bundle rejects it). ESM has no `__dirname`/`__filename`/`require`, so the
# banner re-creates them — the standard esbuild-ESM-for-Node recipe — for
# the bundled code + the externalized CJS deps below.
#
# The banner, native-package list, and shared optional externals are sourced
# from the development-host recipe so a host-graph change cannot silently
# leave the packaged sidecar with a different esbuild boundary.
source "$WEB_DIR/bin/bundle-host-common.sh"
HOST_EXTERNALS=(
  "${HOST_COMMON_EXTERNALS[@]}"

  # @embedded-postgres/<platform> — `embedded-postgres/dist/binary.js` does
  # `import('@embedded-postgres/<plat>')` for EVERY platform, but only the host's
  # own (linux-x64) is installed, so esbuild can't resolve the others and the
  # bundle fails. Externalize ONLY the non-host platforms; linux-x64 MUST stay
  # bundled — host.mjs imports it at runtime (the operator's embedded-PG discovery
  # path), and externalizing it makes host.mjs crash at boot with
  # ERR_MODULE_NOT_FOUND (it's not resolvable next to the standalone host.mjs).
  --external:@embedded-postgres/darwin-arm64
  --external:@embedded-postgres/darwin-x64
  --external:@embedded-postgres/linux-arm
  --external:@embedded-postgres/linux-arm64
  --external:@embedded-postgres/linux-ia32
  --external:@embedded-postgres/linux-ppc64
  --external:@embedded-postgres/windows-x64
  --external:@papercusp/embedded-postgres-server
)
for np in "${NATIVE_PKGS[@]}"; do HOST_EXTERNALS+=( "--external:$np" ); done
# esbuild pinned to 0.25.x — the repo's hoisted esbuild is 0.17.x, which
# predates `with { type: 'json' }` import-attribute support (the host graph
# imports a plugin JSON schema that way). Verified 2026-05-21: 0.25.0
# bundles the full host graph clean (17.5MB host.mjs, valid ESM) with the
# externals below — esbuild inlines workspace + hoisted deps alike, so the
# monorepo dep-hoist is a non-issue.
# --define:__PAPERCUSP_BUNDLED_SIDECAR__=true (EI-650): in this single-file
# bundle EVERY inlined module shares ONE import.meta.url (serve.mjs's own),
# which equals process.argv[1] — so a library-CLI's naive self-exec guard
# (`import.meta.url === pathToFileURL(process.argv[1]).href` and the
# `file://${process.argv[1]}` / `fileURLToPath(import.meta.url) === argv[1]`
# spellings) fires for EVERY bundled CLI at boot, each running main()+
# process.exit() and killing the operator before it serves. The CJS
# `require.main === module` idiom is already neutralised by the dummy `module`
# in HOST_BANNER; this define is the symmetric fix for the ESM idiom — library
# CLIs guard with isCliEntry() (operator-core/lib/util/cli-entry.ts), which
# returns false when this define is present, so only the real entry (serve.ts,
# which does NOT use the helper) boots.
# --define:process.env.PAPERCUP_DOGFOOD_REPO_REF (clone-progress + version-pin):
# bake the release's monorepo ref so the shipped app's `papercusp` dogfood hive
# clones the EXACT version the binary was built from (bootstrap-papercusp-hive's
# dogfoodRef() reads process.env.PAPERCUP_DOGFOOD_REPO_REF). release-local.sh
# exports it (= the release tag) + tags the monorepo. Unset (a plain dev sidecar
# build) bakes "" → the bootstrap falls back to the remote default branch (main).
# VERSION_DEFINE_ARGS (WI-2644 / EI-18751304112302229) — TWO defines for the
# real shipped version (read from tauri.conf.json above): the literal
# --define:process.env.npm_package_version reaches any call site that writes
# that exact expression directly (e.g. onboarding-launch-context.ts's
# `appVersion`); --define:__PAPERCUSP_SIDECAR_VERSION__ reaches build-info.ts,
# which reads through an injectable-seam alias esbuild's syntactic --define
# cannot see through — so build-info.ts's health endpoint + serve.ts's own
# VERSION const (which reads getBuildInfo()) report the actual installed
# version instead of their unset-env fallback ('0.0.0'). Empty
# VERSION_DEFINE_ARGS when unreadable (plain dev run outside this script) →
# both call sites keep their existing
# npm_package_version / '0.0.0' fallback, unchanged from today.
# --minify-whitespace + --minify-syntax (deliberately NOT --minify-identifiers):
# strip comments/whitespace and apply safe syntax compaction on every bundle.
# We do NOT rename identifiers — DBOS registers workflows/steps by function name
# (fn.name) and some runtime lookups key on class/function names, so
# identifier-mangling risks breaking workflow registration/recovery. Whitespace +
# syntax alone cut serve.mjs ~49MB→~35MB with zero behaviour change
# (install-size-audit 2026-07-07, owner-directed). Full --minify would save a
# further ~6MB but is left out for that name-dependency risk.
MINIFY_ARGS=(--minify-whitespace --minify-syntax)
(cd "$WEB_DIR" && npx --yes esbuild@0.25.0 bin/serve.ts \
  --bundle --platform=node --format=esm --target=node22 \
  "${MINIFY_ARGS[@]}" \
  --outfile="$SIDECAR_DIR/serve.mjs" \
  --banner:js="$HOST_BANNER" \
  --define:__PAPERCUSP_BUNDLED_SIDECAR__=true \
  --define:process.env.PAPERCUP_DOGFOOD_REPO_REF="\"${PAPERCUP_DOGFOOD_REPO_REF:-}\"" \
  --define:process.env.PAPERCUP_DOGFOOD_POT_PUBKEY="\"${PAPERCUP_DOGFOOD_POT_PUBKEY:-${PAPERCUP_DOGFOOD_HIVE_PUBKEY:-}}\"" \
  --define:process.env.PAPERCUP_DOGFOOD_POT_INVITE_SECRET="\"${PAPERCUP_DOGFOOD_POT_INVITE_SECRET:-${PAPERCUP_DOGFOOD_HIVE_INVITE_SECRET:-}}\"" \
  "${VERSION_DEFINE_ARGS[@]}" \
  "${HOST_EXTERNALS[@]}")
if [[ ! -f "$SIDECAR_DIR/serve.mjs" ]]; then
  echo "ERROR: esbuild did not produce $SIDECAR_DIR/serve.mjs"
  exit 1
fi

# git-ext-bridge.mjs — the pot-git `ext::` transport helper (fetch-transport.ts
# resolves it as a SIBLING of the running entry: dirname(import.meta.url), which
# in the bundled sidecar is serve.mjs's own dir). git execs it as an external
# on-disk node script, so it can never be inlined into the bundle — without this
# copy every packaged desktop's hive-git fetch (G-8 bootstrap / G-2 transport)
# dies "Cannot find module .../git-ext-bridge.mjs" (live-caught on the P-302
# rig, WI-3496). Pure node:net, no deps — a straight copy is the whole ship.
cp "$REPO_ROOT/packages/operator-core/lib/sync/pot-git/git-ext-bridge.mjs" "$SIDECAR_DIR/git-ext-bridge.mjs"
if [[ ! -f "$SIDECAR_DIR/git-ext-bridge.mjs" ]]; then
  echo "ERROR: failed to stage git-ext-bridge.mjs next to serve.mjs"
  exit 1
fi

# WORKER SCRIPTS — the SAME dirname(import.meta.url) gotcha as git-ext-bridge.mjs
# above, and it has been silently live in the packaged desktop app (WI-37555,
# measured 2026-08-09). Each of these modules spawns `new Worker(resolve(dirname(
# here), '<name>.script.mjs'))`, which inside this bundle resolves to $SIDECAR_DIR
# — and NOTHING was copying them here, so the spawn failed with ENOENT on every
# packaged install. Measured on the 2026-08-09 06:06 sidecar build: serve.mjs
# REFERENCES local-embedder-worker.script.mjs, and no *.script.mjs existed beside
# it at all.
#
# Every one of these workers has a deliberate INLINE fallback, which is exactly
# why this went unnoticed — the app keeps working and merely moves the work onto
# the main event loop:
#   - local-embedder-worker  → every embed runs inline ONNX (~6s vs ~36ms; WI-4196)
#   - cpu-task-worker        → large responses JSON.stringify on the loop (EI-19465075959589134)
#   - local-reranker-worker  → rerank blocks the loop AND its timeout bound stops
#                              being exact, re-opening EI-20005411672741677 on the
#                              no-sidecar desktop install, which is that bug's
#                              entire exposed case.
# WARN rather than exit, matching bundle-host.sh: a missing worker is slow, not
# broken, and a hard failure here would block a desktop build over a perf asset.
# `packages/operator-core/lib/worker-scripts-bundled.test.ts` fails if a NEW
# worker script is added without a copy step in BOTH bundlers.
for _worker_src in \
  "$REPO_ROOT/libs/generic/memory/src/local-embedder-worker.script.mjs" \
  "$REPO_ROOT/packages/operator-core/lib/cpu-task-worker.script.mjs" \
  "$REPO_ROOT/libs/generic/rerank/src/local-reranker-worker.script.mjs"; do
  _worker_name="$(basename "$_worker_src")"
  if [[ -f "$_worker_src" ]]; then
    cp "$_worker_src" "$SIDECAR_DIR/$_worker_name"
    echo "    ✓ staged $_worker_name next to serve.mjs"
  else
    echo "WARNING: worker script not found at $_worker_src — that subsystem will run INLINE on the main event loop in the packaged app"
  fi
done

# Blocked-event-loop sentinel worker (EI-20013016005187186). Unlike the workers
# above this one is TypeScript and imports the shared decider, so a plain copy
# cannot work: the packaged desktop sidecar runs `node serve.mjs` with NO tsx
# loader. Bundle it to a self-contained .mjs beside the entry, matching the
# host bundle's runtime artifact. The sentinel's runtime resolver prefers this
# .mjs and falls back to the .ts only for tsx runtimes.
SENTINEL_WORKER_SRC="$REPO_ROOT/packages/operator-core/lib/event-loop-sentinel.worker.ts"
if [[ -f "$SENTINEL_WORKER_SRC" ]]; then
  npx --yes esbuild@0.25.0 "$SENTINEL_WORKER_SRC" \
    --bundle --platform=node --format=esm --target=node22 \
    --outfile="$SIDECAR_DIR/event-loop-sentinel.worker.mjs" \
    --log-limit=5 \
    && echo "    ✓ bundled event-loop sentinel worker beside serve.mjs" \
    || echo "WARNING: sentinel worker bundle FAILED — the desktop will run with NO blocked-loop detection"
else
  echo "WARNING: sentinel worker not found at $SENTINEL_WORKER_SRC — the desktop will run with NO blocked-loop detection"
fi

# opusscript_native_wasm.wasm (EI-501) — the SAME dirname(import.meta.url)
# gotcha as git-ext-bridge.mjs above, one layer deeper: esbuild INLINES
# opusscript's JS shim (voice-node/codec.ts's lazy `import('opusscript')`) into
# serve.mjs like any other pure-JS dep, but that shim's Emscripten wasm loader
# reads its binary asset off `__dirname + "/opusscript_native_wasm.wasm"` at
# RUNTIME (node_modules/opusscript/build/opusscript_native_wasm.js) — and in
# this bundle every inlined module shares serve.mjs's own
# `__dirname`/`import.meta.url` (the HOST_BANNER above), so it looks for the
# .wasm right next to serve.mjs, not inside node_modules/opusscript/build/.
# esbuild has no way to see that runtime fs read (same reason rrule/luxon need
# an explicit copy below) — the .wasm is a pure BINARY ASSET, un-inlinable
# regardless. Without this copy the packaged app hard-aborts the moment
# anything touches the voice/Opus codec seam: "Aborted(Error: ENOENT: no such
# file or directory, open '.../sidecar/opusscript_native_wasm.wasm')".
echo "→ copying opusscript_native_wasm.wasm → $SIDECAR_DIR (EI-501)"
_opus_wasm=""
for base in "$WEB_DIR/node_modules" "$REPO_ROOT/node_modules" "$ROOT/node_modules"; do
  cand="$base/opusscript/build/opusscript_native_wasm.wasm"
  [[ -f "$cand" ]] && { _opus_wasm="$cand"; break; }
done
if [[ -z "$_opus_wasm" ]]; then
  echo "ERROR: opusscript_native_wasm.wasm not found in any node_modules — voice/Opus would hard-abort in the packaged app (EI-501)"
  exit 1
fi
cp "$_opus_wasm" "$SIDECAR_DIR/opusscript_native_wasm.wasm"
if [[ ! -f "$SIDECAR_DIR/opusscript_native_wasm.wasm" ]]; then
  echo "ERROR: failed to stage opusscript_native_wasm.wasm next to serve.mjs (EI-501)"
  exit 1
fi

echo "→ esbuild-bundling packaged MCP proxy → $SIDECAR_DIR/mcp-proxy.mjs"
(cd "$WEB_DIR" && npx --yes esbuild@0.25.0 bin/mcp-proxy.ts \
  --bundle --platform=node --format=esm --target=node22 \
  "${MINIFY_ARGS[@]}" \
  --outfile="$SIDECAR_DIR/mcp-proxy.mjs" \
  --banner:js="$HOST_BANNER")
if [[ ! -f "$SIDECAR_DIR/mcp-proxy.mjs" ]]; then
  echo "ERROR: esbuild did not produce $SIDECAR_DIR/mcp-proxy.mjs"
  exit 1
fi

# psu + ptool — the superuser CLI launcher and the defineTool CLI. Ship them in
# the runtime so an end user can open a superuser agent session from the app
# (psu-in-desktop-builds-2026-06-23 A1). esbuild-bundles each into a
# SELF-CONTAINED ESM file the SAME way serve.mjs is built: @inquirer/prompts
# (the picker) and @modelcontextprotocol/sdk (ptool's transport) are inlined, so
# the shipped runtime needs NO operator node_modules tree for them. node-pty is
# the only external — psu-pty-host.mjs `require()`s @lydell/node-pty LAZILY (only
# on the pty-host path), so it resolves from sidecar/node_modules at runtime just
# like serve.mjs, and the common launch path never touches it.
#
# Two deliberate differences from the serve.mjs recipe:
#   * NO --define:__PAPERCUSP_BUNDLED_SIDECAR__=true. That define makes
#     isCliEntry() return false to stop inlined library-CLIs self-exec'ing inside
#     serve.mjs. psu/ptool ARE the real entrypoints — they MUST run main() when
#     invoked, so the define must be absent.
#   * Only --external:@lydell/* (psu/ptool don't pull the holepunch native stack).
# The ~/.papercusp/bin/{psu,ptool} shims that `exec node` these are written on
# boot by installPapercuspFiles() (papercup CLAUDE.md desktop-install path; A2).
echo "→ esbuild-bundling psu + ptool + onboard + tutorial-runner + project-history → $SIDECAR_DIR/scripts/"
mkdir -p "$SIDECAR_DIR/scripts"
# pairs of <output-name>:<source-stem> (source lives at $WEB_DIR/scripts/<stem>.mjs)
# onboard = the onboarding/tutorial concierge (agent-first-onboarding P-014):
# shipped so the deb postinst can expose `papercusp onboard|tutorial` + the
# Papercusp Tutorial desktop icon.
# tutorial-runner = the DETERMINISTIC tutorial the concierge launches at handoff
# (deterministic-onboarding-tutorial-2026-07-04 P-006/P-008). MUST ship next to
# onboard.mjs: the concierge resolves it via `new URL('./tutorial-runner.mjs',
# import.meta.url)`, so the output name MUST stay `tutorial-runner`. Without it a
# packaged build silently falls back to the agentic tutor.
for _psu_cli in psu:psu-launcher ptool:ptool onboard:onboard-launcher tutorial-runner:tutorial-runner; do
  _psu_out="${_psu_cli%%:*}"
  _psu_src="${_psu_cli##*:}"
  if [[ ! -f "$WEB_DIR/scripts/$_psu_src.mjs" ]]; then
    echo "ERROR: $WEB_DIR/scripts/$_psu_src.mjs not found — psu cannot ship"
    exit 1
  fi
  (cd "$WEB_DIR" && npx --yes esbuild@0.25.0 "scripts/$_psu_src.mjs" \
    --bundle --platform=node --format=esm --target=node22 \
    "${MINIFY_ARGS[@]}" \
    --outfile="$SIDECAR_DIR/scripts/$_psu_out.mjs" \
    --banner:js="$HOST_BANNER" \
    "--external:@lydell/*")
  if [[ ! -f "$SIDECAR_DIR/scripts/$_psu_out.mjs" ]]; then
    echo "ERROR: esbuild did not produce $SIDECAR_DIR/scripts/$_psu_out.mjs"
    exit 1
  fi
done

# Project History is a Papercusp platform CLI, not an operator-host concern.
# Bundle its narrow entry directly from @papercusp/cli so installed projects can
# generate the versioned read model without a monorepo checkout or tsx. The
# shared ESM banner is load-bearing: plan-parser reaches yaml's CJS path, whose
# dynamic require otherwise fails only in the packaged bundle.
_project_history_src="$REPO_ROOT/libs/papercusp/packages/cli/src/project-history-entry.ts"
if [[ ! -f "$_project_history_src" ]]; then
  echo "ERROR: $_project_history_src not found — project-history cannot ship"
  exit 1
fi
(cd "$WEB_DIR" && npx --yes esbuild@0.25.0 "$_project_history_src" \
  --bundle --platform=node --format=esm --target=node22 \
  "${MINIFY_ARGS[@]}" \
  --outfile="$SIDECAR_DIR/scripts/project-history.mjs" \
  --banner:js="$HOST_BANNER")
if [[ ! -f "$SIDECAR_DIR/scripts/project-history.mjs" ]]; then
  echo "ERROR: esbuild did not produce $SIDECAR_DIR/scripts/project-history.mjs"
  exit 1
fi
echo "  bundled psu.mjs + ptool.mjs + onboard.mjs + tutorial-runner.mjs + project-history.mjs"

# Copy the externalized native deps. esbuild inlined everything else, so
# this is a tiny tree — node-pty + its platform-binary sub-package(s).
# Search every node_modules the monorepo might have hoisted them into.
echo "→ copying externalized native deps (node-pty) into the sidecar"
npt_count=0
for base in "$WEB_DIR/node_modules" "$REPO_ROOT/node_modules" "$ROOT/node_modules"; do
  for nptdir in "$base/@lydell"/node-pty*; do
    [[ -d "$nptdir" ]] || continue
    name="$(basename "$nptdir")"
    [[ -e "$SIDECAR_DIR/node_modules/@lydell/$name" ]] && continue
    cp -aL "$nptdir" "$SIDECAR_DIR/node_modules/@lydell/$name"
    npt_count=$((npt_count + 1))
  done
done
echo "  copied $npt_count node-pty package(s)"
if [[ "$npt_count" -eq 0 ]]; then
  echo "ERROR: node-pty not found in any node_modules — the pty terminal routes will crash"
  exit 1
fi

# Copy the externalized hypercore/holepunch native packages — WITH their full
# runtime dependency closure (require-addon, streamx, b4a, compact-encoding, …)
# — into the bundle. esbuild inlines the host's own JS, but the externalized
# native packages resolve their deps from node_modules at runtime, so the whole
# closure must be present or host.mjs crashes ("Cannot find module
# 'require-addon'"). BFS each native package's package.json `dependencies`.
echo "→ copying externalized native deps + their dependency closure into the sidecar"
nat_copied=0; nat_missing=0
# Visited-set as a space-delimited string, NOT `declare -A` — macOS ships
# bash 3.2 (no associative arrays) and this script must run on the mac
# build VM (mac-desktop-release-readiness-2026-06-11).
_seen=" "
# The bare-*/holepunch native packages (bare-type, bare-fs, bare-os, …) ship
# npm-published prebuilds for EVERY platform they support — not just desktop
# (linux/darwin/win32) but android-{ia32,arm,arm64,x64} and ios-{arm64,x64}
# simulator variants too, each a real Android/iOS ELF/Mach-O binary. A plain
# `cp -a` brings all of them, which (a) bloats the sidecar ~13x over what one
# platform needs, and (b) breaks Linux AppImage bundling outright: linuxdeploy
# walks every ELF file under the AppDir resolving shared-library deps via ldd,
# and chokes on the Android prebuilds — `ERROR: Could not find dependency:
# libm.so` (Android's bionic libc has no standalone libm.so; the symbol is
# folded into libc.so) — which aborts the whole `tauri build --bundles
# appimage` (WI-807). Prune every closure-copied package's `prebuilds/`
# down to just this build host's platform-arch dir immediately after copying.
# WI-5651: prune to the TARGET platform-arch (default host), NOT $(uname) — so a
# cross-baked darwin/windows bundle KEEPS the target's prebuilds and drops this
# Linux host's. Prebuild dirs use node's process.platform spelling (`win32`), so
# map windows→win32 here (TARGET_OS uses the `windows` spelling elsewhere).
case "$TARGET_OS" in
  windows) _bare_node_platform="win32" ;;
  *)       _bare_node_platform="$TARGET_OS" ;;
esac
_bare_node_arch="$TARGET_ARCH"
# WI-5651: fetch a single per-platform npm package that npm WON'T install on this
# host because it is an optionalDependency scoped to a DIFFERENT platform (e.g.
# @img/sharp-darwin-x64 while building on linux). `npm pack` downloads the tarball
# for ANY platform regardless of the host, so a cross-baked darwin/windows sidecar
# can pull the exact @scope/pkg@version the target needs and unpack it where the
# closure/embedded-pg install would have placed it. ALWAYS pass an explicit
# @version (the `%@*` name-strip below assumes one). Idempotent; fails loud.
fetch_cross_npm_pkg() {
  local spec="$1" nm_dir="$2"
  local pkg_name="${spec%@*}"            # @img/sharp-darwin-x64@0.35.3 → @img/sharp-darwin-x64
  local dest="$nm_dir/$pkg_name"
  [[ -e "$dest/package.json" ]] && { echo "    ✓ $pkg_name already present — skip cross-fetch"; return 0; }
  local tmp; tmp="$(mktemp -d)"
  if ! ( cd "$tmp" && npm pack "$spec" --silent >/dev/null 2>&1 ); then
    echo "ERROR: npm pack '$spec' failed (cross-fetch of a per-platform pkg)"; rm -rf "$tmp"; return 1
  fi
  local tgz; tgz="$(ls "$tmp"/*.tgz 2>/dev/null | head -1)"
  [[ -f "$tgz" ]] || { echo "ERROR: npm pack '$spec' produced no tarball"; rm -rf "$tmp"; return 1; }
  mkdir -p "$dest"
  if ! tar -xzf "$tgz" -C "$dest" --strip-components=1; then
    echo "ERROR: extracting '$spec' tarball failed"; rm -rf "$tmp"; return 1
  fi
  rm -rf "$tmp"
  echo "    ✓ cross-fetched $pkg_name → ${dest#"$SIDECAR_DIR/"}"
}
# Read an exact pinned version from a package's optionalDependencies map (npm pins
# @img/* and @lydell/* platform packages to an EXACT version there, so we fetch the
# ABI-matched build instead of `latest`, which could drift ahead of the JS pkg).
opt_dep_version() {
  local pkg_json="$1" dep="$2"
  node -e "try{const d=require('$pkg_json').optionalDependencies||{};process.stdout.write(String(d['$dep']||''))}catch(e){}" 2>/dev/null
}
prune_foreign_prebuilds() {
  local pkg_dir="$1"
  [[ -d "$pkg_dir/prebuilds" && -n "$_bare_node_platform" && -n "$_bare_node_arch" ]] || return 0
  local keep="${_bare_node_platform}-${_bare_node_arch}"
  local pd pd_name pruned=0
  for pd in "$pkg_dir/prebuilds"/*/; do
    [[ -d "$pd" ]] || continue
    pd_name="$(basename "$pd")"
    [[ "$pd_name" == "$keep" ]] && continue
    rm -rf "$pd"
    pruned=$((pruned+1))
  done
  [[ $pruned -gt 0 ]] && echo "  ✂ $(basename "$pkg_dir"): pruned $pruned foreign-platform prebuilds/ dir(s), kept $keep"
}
# onnxruntime-node does NOT use the prebuilds/<platform>-<arch>/ convention above:
# it ships bin/napi-v6/<platform>/<arch>/{onnxruntime_binding.node,libonnxruntime.so}
# for all 5 platforms (211M). A plain closure-copy therefore (a) bloats the sidecar
# ~6x over what one platform needs, and (b) re-arms WI-807: linuxdeploy ldd-walks
# every ELF under the AppDir and chokes on the foreign-arch linux/arm64 .so, aborting
# `tauri build --bundles appimage`. Same remedy as prune_foreign_prebuilds, different
# layout. (P-009.)
prune_foreign_onnx_bins() {
  local pkg_dir="$1"
  [[ -d "$pkg_dir/bin/napi-v6" && -n "$_bare_node_platform" && -n "$_bare_node_arch" ]] || return 0
  local pd pd_name pruned=0
  for pd in "$pkg_dir/bin/napi-v6"/*/; do
    [[ -d "$pd" ]] || continue
    pd_name="$(basename "$pd")"
    if [[ "$pd_name" != "$_bare_node_platform" ]]; then
      rm -rf "$pd"; pruned=$((pruned+1)); continue
    fi
    # keep this platform, drop its foreign ARCH subdirs
    local ad ad_name
    for ad in "$pd"*/; do
      [[ -d "$ad" ]] || continue
      ad_name="$(basename "$ad")"
      [[ "$ad_name" == "$_bare_node_arch" ]] && continue
      rm -rf "$ad"; pruned=$((pruned+1))
    done
  done
  [[ $pruned -gt 0 ]] && echo "  ✂ $(basename "$pkg_dir"): pruned $pruned foreign onnx bin dir(s), kept ${_bare_node_platform}/${_bare_node_arch}"
  return 0
}
# The KEPT platform/arch dir from the prune above still ships ONNX Runtime's GPU
# EXECUTION PROVIDERS — and on linux/x64 that is the single largest file in the
# entire sidecar:
#     libonnxruntime_providers_cuda.so      301M   ← dead weight, on every install
#     libonnxruntime_providers_tensorrt.so  835K   ← same
#     libonnxruntime_providers_shared.so     14K   ← KEEP: the EP-registration shim
#
# Dead weight because nothing in this product ever constructs a GPU session, and
# that is a DECISION, not an oversight:
#   • the embedder is CPU-only ON PURPOSE (EI-19363236885307403). Shipping the
#     provider actively makes CUDA *look* available — it then fails at pipeline
#     construction on `libcudnn.so.9: cannot open shared object file`, because
#     cuDNN 9 is absent and Ubuntu's apt only offers cuDNN 8. See the long note in
#     libs/generic/memory/src/local-embedder-worker.script.mjs.
#   • the one component that CAN target a GPU — the local reranker — is opt-IN
#     (PAPERCUSP_RERANK_DEVICE) *and* verified-load: a provider that fails to
#     construct falls back to the CPU pair (libs/generic/rerank/src/local-engine.ts,
#     `_gpuUnusable` → CPU_EXECUTION_TARGET).
#
# So removing these .so files removes no capability. It swaps one failing provider
# load for another on the SAME already-exercised fallback path, and stops us
# shipping 301M to every user that could never execute on their machine. (WI-38682.)
prune_onnx_gpu_providers() {
  local pkg_dir="$1"
  [[ -d "$pkg_dir/bin/napi-v6" ]] || return 0
  local f freed_kb=0 pruned=0
  while IFS= read -r -d '' f; do
    freed_kb=$(( freed_kb + ( $(stat -c %s "$f" 2>/dev/null || echo 0) / 1024 ) ))
    rm -f "$f"
    pruned=$((pruned+1))
  done < <(find "$pkg_dir/bin/napi-v6" -type f \( \
             -name 'libonnxruntime_providers_cuda.*' -o \
             -name 'libonnxruntime_providers_tensorrt.*' \) -print0 2>/dev/null)
  [[ $pruned -gt 0 ]] && echo "  ✂ $(basename "$pkg_dir"): pruned $pruned GPU execution provider(s), $((freed_kb / 1024))MB (CPU-only by design, EI-19363236885307403)"
  return 0
}
# The backstop for the prune above. prune_onnx_gpu_providers runs PER PACKAGE inside
# the closure walk, so it only ever sees what that walk brought in. Anything that puts
# a GPU provider back into the assembled tree AFTERWARDS would ship hundreds of MB of
# dead weight with nothing failing and no line in the log — a new dependency vendoring
# its own onnxruntime copy, an onnxruntime-node bump adding a provider we do not know
# about, or the prune silently not running because its call site was dropped in a
# refactor. So this scans the ASSEMBLED tree and refuses to build.
#
# Deliberately an ALLOWLIST rather than a denylist of known-bad names: a provider
# nobody has seen before is exactly the case that must stop the line instead of
# shipping silently, and a denylist cannot catch one. libonnxruntime_providers_shared
# (14K) is the EP-registration shim and is REQUIRED — everything else is a GPU
# execution provider this product never constructs a session for. (WI-38682.)
assert_no_onnx_gpu_providers() {
  local root="$1"
  local _gpu_eps="" _ep
  [[ -d "$root" ]] || return 0
  while IFS= read -r -d '' _ep; do
    case "$(basename "$_ep")" in
      libonnxruntime_providers_shared.*) continue ;;
    esac
    _gpu_eps+="         $(( $(stat -c %s "$_ep" 2>/dev/null || echo 0) / 1048576 ))MB  ${_ep#"$root"/}"$'\n'
  done < <(find "$root" -type f -name 'libonnxruntime_providers_*' -print0 2>/dev/null)
  [[ -z "$_gpu_eps" ]] && return 0
  echo "ERROR: ONNX GPU execution provider(s) survived sidecar staging (WI-38682):" >&2
  printf '%s' "$_gpu_eps" >&2
  echo "       This product never constructs a GPU session, so these can never execute on a" >&2
  echo "       user's machine — they are pure install-size bloat. The embedder is CPU-only BY" >&2
  echo "       DESIGN (EI-19363236885307403) and the reranker's GPU path is opt-in AND" >&2
  echo "       verified-load with a CPU fallback, so nothing here is a capability regression." >&2
  echo "       • New provider from an onnxruntime-node bump? Add it to prune_onnx_gpu_providers()." >&2
  echo "       • Vendored by a new dependency? Prune it at the source, like the closure walk does." >&2
  echo "       • Genuinely intend to ship GPU execution? That is a real product decision — make" >&2
  echo "         it deliberately (and it needs the cuDNN 9 story solved first, see the note in" >&2
  echo "         libs/generic/memory/src/local-embedder-worker.script.mjs)." >&2
  return 1
}
# node-gyp SCAFFOLDING carries the build box's absolute paths — and therefore the
# owner's identity — into the shipped bundle (WI-4419). A compiled native module
# needs only its addon binary at build/Release/*.node; everything else node-gyp
# leaves behind (Makefile, binding.Makefile, config.gypi, *.target.mk, the
# Release/.deps/*.o.d dependency lists, obj.target/ objects) embeds
# /home/<user>/... literally. That is what failed the 0.0.13 identity gate: 22
# files across cpu-features/ and ssh2/, every one of them build residue with no
# runtime role.
#
# Prune it at the SOURCE — which is exactly what the gate demands ("prune the
# leaking file from the sidecar copy … never add an exclude here"), because the
# scan deliberately honors no path-exclude list. Runs in EVERY build, not just a
# release: a dev sidecar that differs structurally from the shipped one is how
# this class of leak hides until the release gate. Safe against the dev tree —
# the sidecar holds real COPIES (the closure walker cp's each package), and
# `find -type d` never follows a symlink, so a symlinked package is skipped.
# Vendored TEST FIXTURES have no runtime role, and they are where HOSTILE archives
# live: tar-fs ships test/fixtures/invalid.tar, a tar whose links deliberately
# escape the extraction root (it exists precisely to prove tar-fs rejects it). The
# WI-4419 identity scan correctly refuses to report CLEAN on bytes it could not
# read, so that one vendored fixture failed the 0.0.14 release at minute 22 of a
# 22-minute cut (WI-37620). audit-release-bundle.py now reads tars member-wise and
# is no longer stoppable by such a member — this prune is the other half: the junk
# should not be in what ships at all.
#
# Prune at the SOURCE, per the same doctrine as prune_gyp_build_intermediates
# ("never add an exclude here" — the scan honors no path-exclude list), and in
# EVERY build, so a dev sidecar never differs structurally from the shipped one.
#
# Deliberately NARROW: only `<pkg>/test|tests/fixtures`. A blanket `-name test`
# would also match a legitimately-named PACKAGE (node_modules/test), and a wrong
# prune breaks the app at runtime for a beta tester — far worse than shipping junk.
prune_vendored_test_fixtures() {
  local root="$1"
  [[ -d "$root" ]] || return 0
  local d pruned=0
  while IFS= read -r -d '' d; do
    rm -rf "$d"
    pruned=$((pruned+1))
  done < <(find "$root" -type d \( \
             -path '*/node_modules/*/test/fixtures'  -o \
             -path '*/node_modules/*/tests/fixtures' -o \
             -path '*/node_modules/*/test/fixture'   \) -print0 2>/dev/null)
  [[ $pruned -gt 0 ]] && echo "  ✂ pruned $pruned vendored test-fixture dir(s) (WI-37620: no runtime role, and they carry deliberately-hostile archives)"
  return 0
}
prune_gyp_build_intermediates() {
  local root="$1"
  [[ -d "$root" ]] || return 0
  local bd pruned=0
  while IFS= read -r -d '' bd; do
    rm -rf "$bd/Release/.deps" "$bd/Release/obj.target" "$bd/Release/obj" "$bd/deps"
    rm -f  "$bd/Makefile" "$bd/binding.Makefile" "$bd/config.gypi" "$bd"/*.mk "$bd"/gyp-*-tool
    find "$bd" \( -name '*.target.mk' -o -name '*.o.d' -o -name '*.gypi' \) -type f -delete 2>/dev/null || true
    pruned=$((pruned+1))
  done < <(find "$root" -type d -name build -path '*/node_modules/*' -print0 2>/dev/null)
  [[ $pruned -gt 0 ]] && echo "  ✂ pruned node-gyp build scaffolding from $pruned native-module build/ dir(s) (WI-4419: they embed build-box paths)"
  return 0
}
# Walks a package's dependency closure and copies each package into the sidecar.
#
# ⚠ It follows BOTH `dependencies` AND `optionalDependencies`, and it must:
# napi/node-gyp packages ship their PLATFORM BINARIES as optionalDependencies —
# that is the convention, not an edge case. sharp is the worst offender:
#     sharp --(optional)--> @img/sharp-linux-x64 --(optional)--> @img/sharp-libvips-linux-x64
# Every hop is optional, so a copier that walks only `dependencies` copies sharp's
# JavaScript and NONE of its native code. The result INSTALLS cleanly and then dies
# at boot with `Could not load the "sharp" module using the linux-x64 runtime` — which
# is exactly how 0.0.9 shipped dead on all three platforms. It survived every check
# because on a dev box the desktop app falls back to a :3070 operator that a beta
# tester does not have; the only thing that sees it is a real install on a clean
# machine. (sharp reaches us transitively via @huggingface/transformers / the ONNX
# voice stack.) Note the musl-strip further down already spoke of "@img/sharp-linuxmusl-*"
# arriving "as optional deps" — it was stripping packages that never got copied.
#
# A queued name may carry a leading '?', meaning "reached via optionalDependencies".
# For those, NOT FOUND is the expected, correct outcome — npm only installs the
# optionalDeps matching THIS platform, so @img/sharp-darwin-arm64 is legitimately
# absent on Linux — so it is a silent skip. A missing REQUIRED dep still warns and
# counts, because that one is a real defect.
copy_pkg_closure() {
  local queue=("$1")
  while [[ ${#queue[@]} -gt 0 ]]; do
    local cur="${queue[0]}"; queue=("${queue[@]:1}")
    local optional=0
    if [[ "$cur" == '?'* ]]; then optional=1; cur="${cur#\?}"; fi
    case "$_seen" in *" $cur "*) continue ;; esac
    _seen="${_seen}${cur} "
    # onnxruntime-web is a @huggingface/transformers dependency but is ONLY used on
    # the browser backend — the node path loads onnxruntime-node. Copying it would
    # add 134M of wasm/js to the sidecar that can never execute. Skip it outright.
    [[ "$cur" == "onnxruntime-web" ]] && { echo "  ⊘ skipping onnxruntime-web (browser-only backend; node uses onnxruntime-node)"; continue; }
    [[ -e "$SIDECAR_DIR/node_modules/$cur" ]] && continue
    local src=""
    for base in "$WEB_DIR/node_modules" "$REPO_ROOT/node_modules" "$ROOT/node_modules"; do
      [[ -d "$base/$cur" ]] && { src="$base/$cur"; break; }
    done
    if [[ -z "$src" ]]; then
      # An optionalDep for another platform is SUPPOSED to be absent here — not a defect.
      [[ $optional -eq 1 ]] && continue
      echo "  ⚠ closure dep '$cur' not found in any node_modules"; nat_missing=$((nat_missing+1)); continue
    fi
    mkdir -p "$SIDECAR_DIR/node_modules/$(dirname "$cur")"
    cp -aL "$src" "$SIDECAR_DIR/node_modules/$cur"
    # WI-5638 (2026-07-20, revised 2026-07-27): strip runtime model-download
    # scratch — but NOT the two embedding models the desktop app actually
    # needs at runtime. @huggingface/transformers' DEFAULT cacheDir resolves
    # to a path INSIDE its own package dir (src/env.js: `DEFAULT_CACHE_DIR =
    # path.join(dirname__, '/.cache/')` when RUNNING_LOCALLY, which is always
    # true under Node) — there is no env.cacheDir/localModelPath override
    # anywhere in libs/generic/memory, so that in-bundle path is the ONLY
    # place the packaged app looks. A .deb installs its resources tree
    # root-owned/read-only for the running (non-root) user, so "models
    # re-download on first use" — the ORIGINAL assumption behind a blanket
    # `rm -rf .cache` here — does not hold: a stripped harrier/gemma cache
    # cannot be regenerated at runtime, it just breaks local embedding
    # silently. Per owner [owner 2026-07-20, recorded in memory]: the desktop
    # app runs a LIVE HYBRID of the harrier + embeddinggemma embedders (both
    # intentionally bundled, not dead weight) — keep BOTH. Only bge-small
    # (Xenova/bge-small-en-v1.5, 'local' mode) and any other/future scratch
    # under `.cache` is genuinely unused and safe to strip.
    _transformers_cache="$SIDECAR_DIR/node_modules/$cur/.cache"
    if [[ "$cur" == "@huggingface/transformers" && -d "$_transformers_cache" ]]; then
      find "$_transformers_cache" -mindepth 1 -maxdepth 1 ! -name 'onnx-community' -exec rm -rf {} +
      if [[ -d "$_transformers_cache/onnx-community" ]]; then
        find "$_transformers_cache/onnx-community" -mindepth 1 -maxdepth 1 \
          ! -name 'harrier-oss-v1-0.6b-ONNX' ! -name 'embeddinggemma-300m-ONNX' -exec rm -rf {} +
      fi
    else
      rm -rf "$SIDECAR_DIR/node_modules/$cur/.cache"
    fi
    prune_foreign_prebuilds "$SIDECAR_DIR/node_modules/$cur"
    prune_foreign_onnx_bins "$SIDECAR_DIR/node_modules/$cur"
    prune_onnx_gpu_providers "$SIDECAR_DIR/node_modules/$cur"
    nat_copied=$((nat_copied+1))
    local deps; deps=$(node -e "try{const p=require('$src/package.json');const r=Object.keys(p.dependencies||{});const o=Object.keys(p.optionalDependencies||{}).map(n=>'?'+n);process.stdout.write([...r,...o].join(' '))}catch(e){}" 2>/dev/null)
    for d in $deps; do queue+=("$d"); done
  done
}
for np in "${NATIVE_PKGS[@]}"; do copy_pkg_closure "$np"; done
echo "  copied $nat_copied package(s) ($nat_missing missing)"

# rrule is loaded at runtime via `createRequire(import.meta.url)('rrule')` in
# operator-core/lib/harness/routines/schedule-next.ts (rrule's CJS build sets
# __esModule:true with NO `default`, so every static-import form diverges between
# the tsx dev host and the esbuild bundle — createRequire is the only form that
# works in both). esbuild can't see a dynamic createRequire, so it never inlines
# rrule, and it is pure-JS (not in NATIVE_PKGS) so it was never copied either —
# the bundled operator then crashed at boot with `Cannot find module 'rrule'`
# (EMBEDDED_PG_FAILED). Copy rrule + its dep closure (tslib) so the runtime
# createRequire('rrule') from sidecar/serve.mjs resolves.
echo "→ copying createRequire runtime dep rrule (+ closure) into the sidecar"
copy_pkg_closure rrule
echo "  rrule closure copied ($nat_copied total package(s), $nat_missing missing)"

# luxon — IDENTICAL createRequire gotcha as rrule above. schedule-next.ts loads
# `createRequire(import.meta.url)('luxon')` (DST-correct schedule math; landed
# 2026-06-17 in 5472dec3c, the scheduled-plans EI-1368/136 fixes — which did NOT
# add this copy line). esbuild can't see the dynamic createRequire, luxon is
# pure-JS (no deps, not in NATIVE_PKGS) so it was never copied → the packaged
# operator crashed at boot with `Cannot find module 'luxon'` (EMBEDDED_PG_FAILED),
# i.e. the .deb did not boot at all. Copy luxon so the runtime createRequire('luxon')
# from sidecar/serve.mjs resolves. (shared-pot-release-testing Lane A, A-001.)
echo "→ copying createRequire runtime dep luxon (+ closure) into the sidecar"
copy_pkg_closure luxon
echo "  luxon closure copied ($nat_copied total package(s), $nat_missing missing)"

# EI-19981394187273902 (2026-08-09) — IDENTICAL createRequire gotcha as rrule/luxon
# above, caught by the sidecar-createrequire-bundling.test.ts recurrence guard
# (EI-1589). device-push-dispatcher.ts loads BOTH
# `createRequire(import.meta.url)('google-auth-library')` (FCM push — signs a
# service-account JWT) AND `createRequire(import.meta.url)('jose')` (APNs push —
# signs the ES256 provider JWT). Both are pure-JS (not in NATIVE_PKGS), so esbuild
# can't see the dynamic createRequire and never inlined either — the packaged
# operator would crash at boot with `Cannot find module 'google-auth-library'` (or
# 'jose') the first time a push dispatch actually ran. Copy both (+ closures) so
# the runtime createRequire(...) calls from sidecar/serve.mjs resolve.
echo "→ copying createRequire runtime deps google-auth-library, jose (+ closures) into the sidecar"
copy_pkg_closure google-auth-library
copy_pkg_closure jose
echo "  google-auth-library/jose closures copied ($nat_copied total package(s), $nat_missing missing)"

# WI-5651: cross-bake the darwin native addons npm SKIPPED on this linux host.
# copy_pkg_closure silently drops foreign-platform optionalDeps (correct on a
# native build — npm never installed @img/sharp-darwin-* on linux). For a cross
# darwin bundle those ARE the addons the app loads at runtime, so fetch each one
# at the EXACT version its parent pins in optionalDependencies (ABI-matched, not
# `latest`). sharp/node-pty dying at boot ('Could not load the sharp module') is
# exactly the class that shipped 0.0.9 dead — so a resolve failure is fatal here.
if [[ "$CROSS_BUILD" == "1" && "$TARGET_OS" == "darwin" ]]; then
  echo "→ WI-5651 cross-fetching darwin native addons for darwin-${TARGET_ARCH} (npm skipped them on ${_host_os})"
  _xnm="$SIDECAR_DIR/node_modules"
  # node-pty: @lydell/node-pty pins @lydell/node-pty-darwin-<arch> in optionalDependencies.
  _npty_json="$_xnm/@lydell/node-pty/package.json"
  if [[ -f "$_npty_json" ]]; then
    _npty_dep="@lydell/node-pty-darwin-${TARGET_ARCH}"
    _npty_ver="$(opt_dep_version "$_npty_json" "$_npty_dep")"
    [[ -n "$_npty_ver" ]] || { echo "ERROR: cannot resolve $_npty_dep version from @lydell/node-pty optionalDependencies"; exit 1; }
    fetch_cross_npm_pkg "${_npty_dep}@${_npty_ver}" "$_xnm" || exit 1
  else
    echo "  ⚠ @lydell/node-pty not in the sidecar closure — no darwin node-pty addon to fetch"
  fi
  # sharp: sharp pins @img/sharp-darwin-<arch>, which in turn pins @img/sharp-libvips-darwin-<arch>.
  _sharp_json="$_xnm/sharp/package.json"
  if [[ -f "$_sharp_json" ]]; then
    _sharp_dep="@img/sharp-darwin-${TARGET_ARCH}"
    _sharp_ver="$(opt_dep_version "$_sharp_json" "$_sharp_dep")"
    [[ -n "$_sharp_ver" ]] || { echo "ERROR: cannot resolve $_sharp_dep version from sharp optionalDependencies"; exit 1; }
    fetch_cross_npm_pkg "${_sharp_dep}@${_sharp_ver}" "$_xnm" || exit 1
    _vips_dep="@img/sharp-libvips-darwin-${TARGET_ARCH}"
    _vips_ver="$(opt_dep_version "$_xnm/${_sharp_dep}/package.json" "$_vips_dep")"
    if [[ -n "$_vips_ver" ]]; then
      fetch_cross_npm_pkg "${_vips_dep}@${_vips_ver}" "$_xnm" || exit 1
    else
      echo "  ⚠ $_vips_dep not pinned by $_sharp_dep — assuming sharp bundles libvips internally"
    fi
  else
    echo "  ⚠ sharp not in the sidecar closure — no darwin sharp addon to fetch"
  fi
  echo "  ✓ darwin native addons cross-fetched"
fi

# Static payloads the host serves. host-spa.ts / host-docs.ts resolve these
# from the PAPERCUSP_SPA_DIST / PAPERCUSP_DOCS_ROOT env vars Tauri main.rs
# sets — see those files' root-resolution comments.
echo "→ using locked operator-vite snapshot → sidecar/spa"
if [[ ! -f "$SIDECAR_DIR/spa/index.html" ]]; then
  echo "ERROR: locked Vite SPA snapshot disappeared before packaging"
  exit 1
fi
# WI-3172 / WI-3063 — trim dead weight from the copied SPA so the Windows payload
# clears the NSIS 4GiB datablock cap WITHOUT dropping the offline seed. The Vite
# dist is a wholesale copy of web/public, which bundles the whole Starlight site
# under dist/internal/docs — but /internal/docs/* is served by the DEDICATED
# docsRoutes (bin/host-docs.ts, from PAPERCUSP_DOCS_ROOT = sidecar/internal-docs),
# registered BEFORE the SPA catch-all (bin/host-spa.ts is the final `*` fallback).
# So spa/internal/docs is NEVER served — it's a 147MB byte-for-byte duplicate of
# sidecar/internal-docs. It also carries any stale `<name>.old.<pid>` dir the
# docs-sync atomic-swap (operator-docs postbuild-copy.sh) left un-reaped in
# public/internal/ (found live 2026-07-06: spa/internal/docs.old.2116786 = 146MB
# of pure garbage). Drop the duplicate + purge stale swap leftovers (~293MB).
rm -rf "$SIDECAR_DIR/spa/internal/docs"
find "$SIDECAR_DIR/spa" -depth -type d -name '*.old.[0-9]*' -prune -exec rm -rf {} + 2>/dev/null || true
# ── ONNX Runtime wasm: prune dead backends + dedup the 3 identical copies ────
# (install-size-audit 2026-07-07, owner-directed). The SPA ships the ORT wasm
# runtime in THREE dirs — spa/ (STT/transformers), spa/wake-runtime/ (openwakeword,
# wasmPaths:'/wake-runtime/') and spa/vad-runtime/ (VAD) — each a full ~79MB set of
# FOUR backend builds (.wasm 12M + .jsep.wasm 24M + .asyncify.wasm 26M + .jspi.wasm
# 17M), copied wholesale by setup-{wake,vad}-runtime.sh (glob copy). ~237MB, almost
# all waste:
#   • DEAD BACKENDS: the bundled onnxruntime-web (ort.bundle.min.mjs) only ever
#     constructs the `.jsep` filename, and the app's own chunks reference only
#     `.jsep.mjs` + plain `.mjs` — NOTHING names `.asyncify` or `.jspi` (the
#     proxy-worker / JSPI-stack-switching builds this app never enables). So the
#     .asyncify + .jspi {wasm,mjs} are fetched by no code path → drop them.
#   • TRIPLICATION: the kept .jsep/.plain files (+ the silero .onnx models) are
#     BYTE-IDENTICAL across the three dirs. serve.mjs serves them read-only over
#     HTTP, so replacing the wake-/vad- copies with HARDLINKS to the spa-root copy
#     ships one physical copy with zero behaviour change (a hardlink IS the file,
#     served identically; no symlink-follow needed).
# Net: ~237MB → ~36MB. If a FUTURE change enables ORT proxy/JSPI/WebGPU-only
# builds, stop pruning the needed variant here.
echo "→ ONNX wasm: pruning dead backends (.asyncify/.jspi) + deduping the 3 runtime dirs"
_ort_pruned=0
_ort_linked=0
for _ort_dir in "$SIDECAR_DIR/spa" "$SIDECAR_DIR/spa/wake-runtime" "$SIDECAR_DIR/spa/vad-runtime"; do
  [[ -d "$_ort_dir" ]] || continue
  for _dead in "$_ort_dir"/ort-wasm-*.asyncify.* "$_ort_dir"/ort-wasm-*.jspi.*; do
    [[ -e "$_dead" ]] || continue
    rm -f "$_dead"
    _ort_pruned=$((_ort_pruned + 1))
  done
done
for _ort_sub in wake-runtime vad-runtime; do
  _ort_subdir="$SIDECAR_DIR/spa/$_ort_sub"
  [[ -d "$_ort_subdir" ]] || continue
  for _f in "$_ort_subdir"/*; do
    [[ -f "$_f" ]] || continue
    _canon="$SIDECAR_DIR/spa/$(basename "$_f")"
    [[ -f "$_canon" ]] || continue
    [[ "$_f" -ef "$_canon" ]] && continue          # already the same inode
    cmp -s "$_f" "$_canon" || continue             # only dedup byte-identical files
    if rm -f "$_f" && ln "$_canon" "$_f" 2>/dev/null; then
      _ort_linked=$((_ort_linked + 1))
    else
      cp -a "$_canon" "$_f"                         # FS without hardlink support — restore a copy
    fi
  done
done
echo "  ✓ ONNX wasm: pruned $_ort_pruned dead-backend file(s), hardlinked $_ort_linked duplicate(s)"
echo "→ copying Starlight docs → sidecar/internal-docs"
if [[ -d "$WEB_DIR/public/internal/docs" ]]; then
  # WI-1998: public/internal/docs is a live docs-sync deploy target
  # (apps/operator-docs/scripts/postbuild-copy.sh) that republishes via an
  # atomic rename-swap, not an in-place mutation — so the window this `cp -a`
  # can lose to has shrunk from "however long a delete+rewrite mirror takes"
  # to "this cp -a happened to start/traverse during someone else's rename
  # swap", which is rare but not impossible for a multi-second recursive copy
  # racing a swap that can land at any instant. A swapped-out old tree isn't
  # reaped for a couple minutes (see postbuild-copy.sh), so a short retry
  # picks up either the (still-intact) pre-swap tree a moment earlier or the
  # (now-published) post-swap tree a moment later — either is a valid
  # complete docs tree; only the fraction-of-a-second window mid-swap fails.
  _docs_cp_attempts=5
  _docs_cp_ok=0
  for _docs_cp_try in $(seq 1 "$_docs_cp_attempts"); do
    rm -rf "$SIDECAR_DIR/internal-docs"
    if cp -a "$WEB_DIR/public/internal/docs" "$SIDECAR_DIR/internal-docs" 2>/tmp/docs-cp-err.$$; then
      _docs_cp_ok=1
      break
    fi
    echo "  ⚠ Starlight docs copy attempt $_docs_cp_try/$_docs_cp_attempts hit a live docs-sync republish race — retrying"
    cat /tmp/docs-cp-err.$$ >&2 || true
    rm -f /tmp/docs-cp-err.$$
    sleep 1
  done
  rm -f /tmp/docs-cp-err.$$
  if [[ "$_docs_cp_ok" -ne 1 ]]; then
    echo "ERROR: Starlight docs copy failed $_docs_cp_attempts times (persistent docs-sync race or a real fault, not a one-off) — aborting rather than shipping a partial/missing docs tree"
    exit 1
  fi
else
  echo "  ⚠ $WEB_DIR/public/internal/docs not found — /internal/docs/* will 404 in the bundle"
fi

# docs-qa retrieval grounding (2026-07-05). The tutorial/palette "Ask a question"
# (packages/operator-core/.../desktop/docs-qa.ts → @papercusp/docs-engine searchDocs)
# reads the SOURCE Starlight .mdx tree via _repo-paths.DOCS_CONTENT_ROOT — NOT the
# rendered public/internal/docs copied above. In a packaged sidecar, findRepoRoot()
# walks up from cwd (= the sidecar dir), finds no repo, and falls back to cwd, so
# DOCS_CONTENT_ROOT resolves to <sidecar>/apps/operator-docs/src/content/docs. Ship the
# source tree THERE so retrieveDocsContext returns real blocks and the answer is grounded
# (cites /internal/docs/...) instead of hallucinating. Without this the retrieval returns
# zero blocks in EVERY packaged install → the deflecting "I can't define that" answers the
# owner hit on 2026-07-05.
_docs_src="$WEB_DIR/../operator-docs/src/content/docs"
if [[ -d "$_docs_src" ]]; then
  echo "→ copying Starlight docs SOURCE tree → sidecar/apps/operator-docs/src/content/docs (docs-qa grounding)"
  mkdir -p "$SIDECAR_DIR/apps/operator-docs/src/content"
  rm -rf "$SIDECAR_DIR/apps/operator-docs/src/content/docs"
  cp -a "$_docs_src" "$SIDECAR_DIR/apps/operator-docs/src/content/docs"
else
  echo "  ⚠ $_docs_src not found — docs-qa (tutorial/palette Ask) will be UNGROUNDED in the bundle"
fi

# ── Release privacy (WI-4419 follow-up). The two doc copies above pull from the
# LIVE monorepo tree, NOT the stager's source.tar.zst, so the in-build release
# audit (which scans source.tar.zst) is STRUCTURALLY BLIND to them: 0.0.9 shipped
# the mac VM's sudo/login passwords (aviweiss/avraham) inside the sidecar docs
# while every leg's source audit passed CLEAN. Durable fix, co-located with the
# copy that creates the exposure:
#   (1) PRUNE the same internal-build-infra docs the release audit forbids, using
#       audit-release-bundle.py's own rule as the SINGLE source of truth (no drift).
#   (2) In a RELEASE build, IDENTITY-SCAN the assembled sidecar UNCONDITIONALLY
#       (honoring no path-exclude) and FAIL if any known-sensitive/build-box
#       identity survives on disk — the ultimate backstop the source.tar.zst scan
#       cannot be. Hard-fail is release-gated (PAPERCUSP_RELEASE_AUDIT=1) so a dev
#       sidecar on the build box — whose own identity legitimately pervades its
#       compiled binaries — still builds; the prune runs in every build regardless.
#   (3) PRUNE node-gyp build scaffolding from every native module in the sidecar.
#       Same exposure, different source: these are build residue (Makefile,
#       config.gypi, *.target.mk, .deps/*.o.d) that embed the build box's absolute
#       paths. Must run BEFORE the identity scan below, which is what catches them.
echo "→ pruning node-gyp build scaffolding from sidecar native modules (release-privacy, WI-4419)"
prune_gyp_build_intermediates "$SIDECAR_DIR"
echo "→ pruning vendored test fixtures from sidecar (release-privacy, WI-37620)"
prune_vendored_test_fixtures "$SIDECAR_DIR"

echo "→ verifying no ONNX GPU execution providers survive in the sidecar (WI-38682)"
assert_no_onnx_gpu_providers "$SIDECAR_DIR" || exit 1

_audit_py="$HERE/audit-release-bundle.py"
if [[ -f "$_audit_py" ]]; then
  echo "→ pruning internal-build-infra docs from sidecar (release-privacy, WI-4419)"
  python3 "$_audit_py" --prune-docs \
    "$SIDECAR_DIR/internal-docs" \
    "$SIDECAR_DIR/apps/operator-docs/src/content/docs"
  # The prune above deletes by PATH; the gate below fails by CONTENT. A doc whose
  # path is not internal-build-infra but whose TEXT quotes this box's identity slips
  # between the two — 65 assembled files did exactly that on the 0.0.16 cut. Redact
  # the shipping doc TEXT from the same identity map --scrub-binaries uses, which is
  # the sidecar half of the redaction bin/stage-source-tree.sh already applies to
  # source.tar.zst. Must run BEFORE the scan below.
  echo "→ scrubbing build-box identity from sidecar text (release-privacy, WI-4419)"
  python3 "$_audit_py" --scrub-text \
    "$SIDECAR_DIR/internal-docs" \
    "$SIDECAR_DIR/apps/operator-docs/src/content/docs" \
    "$SIDECAR_DIR/serve.mjs" \
    "$SIDECAR_DIR/spa"
  # WI-37620: a build-box path baked into a COMPILED addon (.rodata assert string)
  # is reachable by neither of the gate's other remedies — `strip` leaves it and the
  # file is needed at runtime — so scrub it. Must run BEFORE the scan below.
  echo "→ scrubbing build-box identity from compiled native addons (release-privacy, WI-37620)"
  python3 "$_audit_py" --scrub-binaries "$SIDECAR_DIR/node_modules"
  # NOTE (EI-20304355477263736): the release identity SCAN used to run right here,
  # which made it a scan of a HALF-ASSEMBLED sidecar — 44 further cp/mkdir/cat
  # writes into $SIDECAR_DIR happen below this line (harness/**, prompts/**,
  # db-sql/**, sql/**, the vendored bin/** binaries, pui, provenance, across 112
  # $SIDECAR_DIR references in total). The two files that killed
  # 0.0.16-alpha attempt 5 were both written AFTER this point, so this position
  # could not have caught them however correct the scanner was. The scan now runs
  # at the END of this script (search: ASSEMBLED-SIDECAR IDENTITY SCAN). The
  # prune/scrub steps above stay here: they must precede the copies they rewrite.
elif [[ "${PAPERCUSP_RELEASE_AUDIT:-0}" == "1" ]]; then
  echo "ERROR: release build requires $_audit_py for sidecar privacy enforcement — aborting."
  exit 1
else
  echo "  ⚠ audit-release-bundle.py not found at $_audit_py — sidecar release-privacy NOT enforced (dev build)"
fi

# Operator prompts — some endpoint-route handlers read apps/operator/prompts/
# at runtime. esbuild doesn't trace runtime fs reads, so copy them explicitly.
if [[ -d "$WEB_DIR/prompts" ]]; then
  echo "→ copying operator prompts → sidecar/prompts"
  cp -a "$WEB_DIR/prompts" "$SIDECAR_DIR/prompts"
fi

# Desktop-install integration (Phase 1 of
# desktop-app-install-integration-2026-05-23) reads the OMP hook files at
# runtime and copies them into ~/.papercusp/. The playbook lives under prompts/
# (above), while the OMP files are under apps/operator/scripts/hooks/omp/.
# esbuild doesn't trace these fs.readFile paths, so copy every direct TypeScript
# sibling explicitly. This keeps the installed bundle loadable when an entrypoint
# gains a relative companion such as non-preempting-delivery.ts.
OMP_HOOK_SRC_DIR="$WEB_DIR/scripts/hooks/omp"
OMP_HOOK_DST_DIR="$SIDECAR_DIR/apps/operator/scripts/hooks/omp"
if [[ -d "$OMP_HOOK_SRC_DIR" ]]; then
  echo "→ copying omp hook TypeScript bundle → sidecar/apps/operator/scripts/hooks/omp/"
  mkdir -p "$OMP_HOOK_DST_DIR"
  for omp_hook_src in "$OMP_HOOK_SRC_DIR"/*.ts; do
    [[ -f "$omp_hook_src" ]] || continue
    cp -a "$omp_hook_src" "$OMP_HOOK_DST_DIR/"
  done
fi

# Same reason again, for the CONTEXT-INJECTION pair
# (omp-context-injection-parity-2026-08-09 P-003): the shared dispatcher
# apps/operator/scripts/hooks/inject/** and the omp artifact
# apps/operator/scripts/hooks/omp/inject-hook.ts are read at runtime by
# lib/desktop-install/papercusp-files.ts, not imported, so esbuild does not
# trace them.
#
# ⚠ SHIP BOTH OR NEITHER. The artifact locates the dispatcher relative to
# itself; shipping the hook without the dispatcher yields a packaged app whose
# omp sessions load the hook, find nothing, and fail-silently inject NOTHING on
# every turn — indistinguishable from "no memories were relevant". That is the
# EI-8191 shape exactly: fail-open looks like success, so it stays invisible.
# The `.mjs` set is the dispatcher; adapters/ is a required subdirectory.
INJECT_SRC_DIR="$WEB_DIR/scripts/hooks/inject"
if [[ -d "$INJECT_SRC_DIR" && -f "$OMP_HOOK_SRC_DIR/inject-hook.ts" ]]; then
  INJECT_DST_DIR="$SIDECAR_DIR/apps/operator/scripts/hooks/inject"
  echo "→ copying context-injection dispatcher → sidecar/apps/operator/scripts/hooks/inject/"
  mkdir -p "$INJECT_DST_DIR/adapters" "$SIDECAR_DIR/apps/operator/scripts/hooks/omp"
  cp -a "$INJECT_SRC_DIR"/*.mjs "$INJECT_DST_DIR"/
  cp -a "$INJECT_SRC_DIR"/adapters/*.mjs "$INJECT_DST_DIR"/adapters/
fi

# Same reason: the Claude/Codex CC hooks (statusline-fleet + lock/coord/activity/
# lifecycle/objective-title/bash-gate/workitem-nudge) under
# apps/operator/scripts/hooks/cc/ are read at runtime by
# lib/desktop-install/papercusp-files.ts (installClaudeHooks → ~/.papercusp/hooks/cc/
# + merged into ~/.claude/settings.json). esbuild doesn't trace them, so copy the
# runtime scripts explicitly. Without them the packaged Mac/Windows app installs NO
# Claude statusline/lock/coord hooks (EI-8191: "blank bottom statusline", lock
# enforcement silently off). The *.sh scripts AND the *.py libs they import — skip
# __tests__/ and *.tmp scratch.
#
# WI-3665: `*.sh` alone is NOT enough. statusline-fleet.sh and posttooluse-objective-title.sh
# `import pc_tty` (resolved off their own dirname) to find the terminal they may write the
# fleet-identity title to. A sidecar missing pc_tty.py raises ImportError, the hooks fail
# OPEN, and the packaged app silently stops setting the terminal title — the same shape as
# EI-8191, and invisible because fail-open looks exactly like success.
CC_HOOK_SRC_DIR="$WEB_DIR/scripts/hooks/cc"
if [[ -d "$CC_HOOK_SRC_DIR" ]]; then
  CC_HOOK_DST_DIR="$SIDECAR_DIR/apps/operator/scripts/hooks/cc"
  echo "→ copying cc hooks → sidecar/apps/operator/scripts/hooks/cc/"
  mkdir -p "$CC_HOOK_DST_DIR"
  cp -a "$CC_HOOK_SRC_DIR"/*.sh "$CC_HOOK_DST_DIR"/
  # nullglob-safe: if a future refactor removes every .py, don't copy a literal '*.py'.
  for py in "$CC_HOOK_SRC_DIR"/*.py; do
    [[ -e "$py" ]] && cp -a "$py" "$CC_HOOK_DST_DIR"/
  done
  # EI-16981: guard-operator-desktop.mjs is a Node hook (not .sh/.py) — without
  # this the packaged app silently ships NO desktop-navigation guard, the exact
  # WI-3665/EI-8191 fail-open shape. nullglob-safe, same pattern as the .py loop.
  for mjs in "$CC_HOOK_SRC_DIR"/*.mjs; do
    [[ -e "$mjs" ]] && cp -a "$mjs" "$CC_HOOK_DST_DIR"/
  done
fi

# Same reason: lib/desktop-install/papercusp-files.ts resolves the
# playbook source via <operatorAppRoot>/prompts/papercusp-su.tools.md.
# In production the operator app root lives at sidecar/apps/operator/,
# so the playbook must be available there too (the sidecar/prompts/
# copy above is for other endpoint-route handlers with a different
# expectation).
PLAYBOOK_SRC="$WEB_DIR/prompts/papercusp-su.tools.md"
if [[ -f "$PLAYBOOK_SRC" ]]; then
  PLAYBOOK_DST="$SIDECAR_DIR/apps/operator/prompts/papercusp-su.tools.md"
  mkdir -p "$(dirname "$PLAYBOOK_DST")"
  cp -a "$PLAYBOOK_SRC" "$PLAYBOOK_DST"
fi

# Bundle the `papercup` CLI shim + greeting status script. Used by the
# native-console launcher (the "+" button in the chrome header) — the
# user's spawned terminal runs `papercup status` before exec'ing their
# shell. Next.js standalone build doesn't include apps/operator/scripts/
# (not imported by any route), so we copy them explicitly.
#
# Lives in `sidecar/bin/` so Tauri's existing PATH-prepend
# (sidecar/bin → child PATH) makes `papercup` discoverable without
# absolute paths in the launcher one-liner.
PAPERCUP_SCRIPTS_SRC="$WEB_DIR/scripts"
PAPERCUP_BIN_DST="$SIDECAR_DIR/bin"
if [[ -f "$PAPERCUP_SCRIPTS_SRC/papercup" && -f "$PAPERCUP_SCRIPTS_SRC/papercup-status.mjs" ]]; then
  echo "→ copying papercup CLI shim → $PAPERCUP_BIN_DST"
  mkdir -p "$PAPERCUP_BIN_DST"
  cp -a "$PAPERCUP_SCRIPTS_SRC/papercup" "$PAPERCUP_BIN_DST/papercup"
  cp -a "$PAPERCUP_SCRIPTS_SRC/papercup-status.mjs" "$PAPERCUP_BIN_DST/papercup-status.mjs"
  chmod +x "$PAPERCUP_BIN_DST/papercup"
else
  echo "  ⚠ papercup shim source not found at $PAPERCUP_SCRIPTS_SRC; native console greeting will degrade"
fi

# Bundle the harness package (run.sh, prompts, templates, identity, docs-viewer).
# At runtime, the sidecar reads PAPERCUSP_HARNESS_DIR (set by Tauri main.rs)
# to locate this. Without it, the harness loop has nothing to execute.
HARNESS_SRC="$PAPERCUSP_ROOT/packages/harness"
HARNESS_DST="$SIDECAR_DIR/harness"
echo "→ copying harness package from $HARNESS_SRC"
if [[ ! -d "$HARNESS_SRC" ]]; then
  echo "ERROR: harness package not found at $HARNESS_SRC"
  exit 1
fi
mkdir -p "$HARNESS_DST"
# Use `find -type f` enumeration instead of `cp -a` so we:
#  1. Skip symlinks entirely (find -type f doesn't match -type l). The harness
#     has dev-time symlinks like docs-viewer/src/content/docs/projects/restart
#     pointing at retired pre-split paths — those dangle on CI and
#     either cause Tauri's resource bundler to fail (Linux/mac) or `cp` itself
#     to fail (Windows can't create those symlinks).
#  2. Skip docs-viewer entirely. It's an Astro sub-project that needs its own
#     node_modules and isn't required by the harness loop. Phase 4 polish.
#  3. Skip node_modules — those would be re-installed at runtime if needed,
#     not bundled.
echo "→ enumerating harness files (skipping symlinks, docs-viewer, node_modules)"
( cd "$HARNESS_SRC" && find . -type f \
    -not -path "./docs-viewer/*" \
    -not -path "./node_modules/*" \
    -not -path "*/.git/*" ) > /tmp/harness-files.txt
file_count=$(wc -l < /tmp/harness-files.txt)
echo "  $file_count files to copy"
while IFS= read -r f; do
  rel="${f#./}"
  dst_dir="$HARNESS_DST/$(dirname "$rel")"
  mkdir -p "$dst_dir"
  cp "$HARNESS_SRC/$rel" "$HARNESS_DST/$rel"
done < /tmp/harness-files.txt
rm -f /tmp/harness-files.txt

# Sanity-check the artifacts the orchestrator actually needs.
# (run.sh was retired — see harness commit 4b7e162 "retire run.sh — the TS
# orchestrator is the only driver"; the iteration driver is now
# @papercusp/orchestrator, so the legacy run.sh is no longer bundled.)
#
# The top-level `prompts/` dir was RETIRED by the deterministic-blueprints
# migration — role spawn prompts now live PER-BLUEPRINT at
# `blueprints/<bp>/prompts/<role>.md` (the `find -type f` copy above brings them
# over with the rest of `blueprints/`). So require `blueprints` (+ `templates`)
# and assert a representative role prompt actually landed, instead of the stale
# top-level `prompts/` dir.
for required in blueprints templates; do
  if [[ ! -e "$HARNESS_DST/$required" ]]; then
    echo "ERROR: harness bundle missing $required at $HARNESS_DST"
    exit 1
  fi
done
# Assert the base-blueprint prompt set actually landed. NOTE: the previous
# sentinel was the single file `blueprints/base/prompts/queen.md`, but the
# WI-2932 blueprint rename churn (2026-07-05) moved/renamed the queen prompts
# (queen.md → queen.base.md → relocated again mid-refactor), so a single-file
# sentinel red-pins this build on an unrelated in-flight rename. Guard the
# INVARIANT instead: a healthy base prompt dir carries dozens of role prompts —
# require a sane minimum so a broken copy (0/near-0 files) still fails loudly.
BASE_PROMPTS_COUNT=$(find "$HARNESS_DST/blueprints/base/prompts" -maxdepth 1 -name '*.md' -type f 2>/dev/null | wc -l)
if [[ "$BASE_PROMPTS_COUNT" -lt 10 ]]; then
  echo "ERROR: harness bundle base prompts look missing/empty ($BASE_PROMPTS_COUNT .md files under blueprints/base/prompts) at $HARNESS_DST"
  echo "  Role spawn prompts live under blueprints/<bp>/prompts/ — the harness copy did not bring them over."
  exit 1
fi
find "$HARNESS_DST/bin" -type f -name "*.sh" -exec chmod +x {} \; 2>/dev/null || true

# Bundle the first-party app-templates (local-first-party-template-bundling-2026-07-07).
# The `templates:*` verbs resolve the bundled first-party templates from this dir at
# runtime (packages/operator-core/lib/cupboard/template-store.ts). Tauri's main.rs sets
# PAPERCUSP_TEMPLATES_DIR -> <resources>/sidecar/templates; a dev checkout with no env
# falls back to the in-repo templates/ dir. Shipped via tauri.conf.json resources
# ("sidecar/**/*"). Content only — the per-template checks/*.test.ts are PORTABLE content
# copied into composed apps, never run in-repo (templates/ is excluded from test discovery).
TEMPLATES_SRC="$REPO_ROOT/templates"
TEMPLATES_DST="$SIDECAR_DIR/templates"
echo "→ copying first-party templates from $TEMPLATES_SRC"
if [[ ! -d "$TEMPLATES_SRC" ]]; then
  echo "ERROR: first-party templates dir not found at $TEMPLATES_SRC"
  exit 1
fi
mkdir -p "$TEMPLATES_DST"
( cd "$TEMPLATES_SRC" && find . -type f \
    -not -path "./node_modules/*" \
    -not -path "*/.git/*" ) > /tmp/template-files.txt
while IFS= read -r f; do
  rel="${f#./}"
  mkdir -p "$TEMPLATES_DST/$(dirname "$rel")"
  cp "$TEMPLATES_SRC/$rel" "$TEMPLATES_DST/$rel"
done < /tmp/template-files.txt
rm -f /tmp/template-files.txt
# official-mobile-app-templates-2026-08-20 P-016: the generic copier above is
# deliberately future-proof, but a successful copy count cannot prove the five
# launch-critical mobile directories landed. Fail the release build on the exact
# self-describing entry files each templates:* path requires.
REQUIRED_MOBILE_TEMPLATES=(
  papercusp-mobile-base
  papercusp-android-shell
  papercusp-android-app
  papercusp-iphone-shell
  papercusp-iphone-app
)
for required in "${REQUIRED_MOBILE_TEMPLATES[@]}"; do
  for entry in listing.json template.yaml GUIDE.md; do
    if [[ ! -f "$TEMPLATES_DST/$required/$entry" ]]; then
      echo "ERROR: required official mobile template entry missing from sidecar: $required/$entry"
      exit 1
    fi
  done
done
# Sanity: the first-party set + their self-describing listing.json actually landed.
tmpl_count=$(find "$TEMPLATES_DST" -maxdepth 2 -name listing.json 2>/dev/null | wc -l)
if [[ "$tmpl_count" -lt 1 ]]; then
  echo "ERROR: no first-party template listing.json landed at $TEMPLATES_DST"
  exit 1
fi
echo "  ✓ $tmpl_count first-party templates bundled → $TEMPLATES_DST"

# Bundle the first-party rubrics (local-first-party-rubric-bundling-2026-07-07) —
# same design as the templates block above: self-describing dirs (listing.json +
# rubric.json + METHOD.md) resolved at runtime from the bundled layer via
# PAPERCUSP_RUBRICS_DIR (Tauri main.rs → <resources>/sidecar/rubrics; dev falls
# back to the in-repo rubrics/ dir) and SEEDED into the workspace rubric store on
# first use, so a fresh install has the standard rubrics on day one.
RUBRICS_SRC="$REPO_ROOT/rubrics"
RUBRICS_DST="$SIDECAR_DIR/rubrics"
echo "→ copying first-party rubrics from $RUBRICS_SRC"
if [[ ! -d "$RUBRICS_SRC" ]]; then
  echo "ERROR: first-party rubrics dir not found at $RUBRICS_SRC"
  exit 1
fi
mkdir -p "$RUBRICS_DST"
( cd "$RUBRICS_SRC" && find . -type f \
    -not -path "./node_modules/*" \
    -not -path "*/.git/*" ) > /tmp/rubric-files.txt
while IFS= read -r f; do
  rel="${f#./}"
  mkdir -p "$RUBRICS_DST/$(dirname "$rel")"
  cp "$RUBRICS_SRC/$rel" "$RUBRICS_DST/$rel"
done < /tmp/rubric-files.txt
rm -f /tmp/rubric-files.txt
# Sanity: the first-party set + their self-describing listing.json actually landed.
rubric_count=$(find "$RUBRICS_DST" -maxdepth 2 -name listing.json 2>/dev/null | wc -l)
if [[ "$rubric_count" -lt 1 ]]; then
  echo "ERROR: no first-party rubric listing.json landed at $RUBRICS_DST"
  exit 1
fi
echo "  ✓ $rubric_count first-party rubrics bundled → $RUBRICS_DST"

# Bundle the @papercusp/orchestrator entry bins as self-contained esbuild .mjs,
# shipped as a SIBLING of harness/ (sidecar/orchestrator/bin/*.mjs) — the path
# harnessPath('../orchestrator/bin/...') + the preflight harness check resolve to.
# The DBOS orchestrator-runner spawns invoke-once as a SEPARATE `node` process;
# bundling it self-contained means no tsx + no node_modules dep tree on disk
# (mirrors the host.mjs approach). harness-paths.ts prefers the .mjs when present.
ORCH_SRC="$PAPERCUSP_ROOT/packages/orchestrator"
ORCH_DST="$SIDECAR_DIR/orchestrator"
echo "→ esbuild-bundling orchestrator bins from $ORCH_SRC"
if [[ ! -d "$ORCH_SRC/bin" ]]; then
  echo "ERROR: orchestrator package not found at $ORCH_SRC"
  exit 1
fi
mkdir -p "$ORCH_DST/bin"
for b in invoke-once run assemble-prompt get-plan-context; do
  if [[ -f "$ORCH_SRC/bin/$b.ts" ]]; then
    (cd "$WEB_DIR" && npx --yes esbuild@0.25.0 "$ORCH_SRC/bin/$b.ts" \
      --bundle --platform=node --format=esm --target=node22 \
      "${MINIFY_ARGS[@]}" \
      --outfile="$ORCH_DST/bin/$b.mjs")
  fi
done
# Minimal package.json so the dir is a resolvable @papercusp/orchestrator root.
cat > "$ORCH_DST/package.json" <<'JSON'
{ "name": "@papercusp/orchestrator", "version": "0.0.1", "private": true, "type": "module" }
JSON
if [[ ! -f "$ORCH_DST/bin/invoke-once.mjs" ]]; then
  echo "ERROR: orchestrator invoke-once.mjs not produced at $ORCH_DST/bin"
  exit 1
fi
echo "  ✓ orchestrator bins bundled → $ORCH_DST/bin"

# Bundle the embedded-postgres-server package (real PG with logical
# replication enabled). This is the ONLY desktop DB — the legacy
# pglite-server fallback was removed 2026-06-01 (a failed embedded-PG must
# fail LOUD, not silently degrade to a WASM single-connection engine).
#
# SP1 C5: no longer spawned as its own process — serve.mjs imports
# `@papercusp/embedded-postgres-server` (externalized in the esbuild step
# above) and runs PG IN-PROCESS. Shipping it under sidecar/node_modules/
# makes the bare-specifier import resolve, and keeps the PG binary paths
# (computed from the package's own import.meta.url) correct.
EMBEDDED_PG_SRC="$PAPERCUSP_ROOT/packages/embedded-postgres-server"
EMBEDDED_PG_DST="$SIDECAR_DIR/node_modules/@papercusp/embedded-postgres-server"
echo "→ bundling embedded-postgres-server"
if [[ ! -d "$EMBEDDED_PG_SRC" ]]; then
  echo "ERROR: @restart/embedded-postgres-server not found at $EMBEDDED_PG_SRC"
  exit 1
fi
mkdir -p "$EMBEDDED_PG_DST"
cp "$EMBEDDED_PG_SRC/package.json" "$EMBEDDED_PG_DST/"
cp -a "$EMBEDDED_PG_SRC/src" "$EMBEDDED_PG_DST/"
cp -a "$EMBEDDED_PG_SRC/bin" "$EMBEDDED_PG_DST/"
chmod +x "$EMBEDDED_PG_DST/bin/embedded-postgres-server.mjs"
# Install embedded-postgres + postgres-js. embedded-postgres pulls platform
# binaries (~60-150MB per arch) — npm picks the right @embedded-postgres/<plat>
# package automatically based on the build host's platform. For
# cross-platform releases, run this script once per target platform.
echo "→ installing embedded-postgres-server runtime deps into the bundle (~60-150MB binary download)"
( cd "$EMBEDDED_PG_DST" && npm install --omit=dev --no-workspaces --legacy-peer-deps --silent ) || {
  echo "ERROR: failed to install embedded-postgres-server runtime deps"
  exit 1
}
# WI-5651: cross-swap the embedded-postgres binary pkg for a darwin build. npm
# resolved @embedded-postgres/<HOST> above (e.g. linux-x64 — it keys the optional
# binary pkg on the build host); for a cross darwin bundle that is dead weight AND
# wrong. Drop it and fetch the target's binary pkg at the SAME resolved version.
# The published @embedded-postgres/darwin-<arch> tarball SHIPS native/bin/{initdb,
# postgres,pg_ctl} as real Mach-O UNIVERSAL (fat x86_64+arm64) directly — no
# postinstall — so npm-pack+extract yields runnable binaries the assertion below
# accepts. (Proven on linux, WI-5651.)
if [[ "$CROSS_BUILD" == "1" && "$TARGET_OS" == "darwin" ]]; then
  _epg_root="$EMBEDDED_PG_DST/node_modules/@embedded-postgres"
  _epg_host="$(ls "$_epg_root" 2>/dev/null | head -1)"
  [[ -n "$_epg_host" ]] || { echo "ERROR: no @embedded-postgres/<host> pkg after npm install — cannot derive the cross version"; exit 1; }
  _epg_ver="$(node -e "console.log(require('$_epg_root/$_epg_host/package.json').version)" 2>/dev/null)"
  [[ -n "$_epg_ver" ]] || { echo "ERROR: could not read installed @embedded-postgres/$_epg_host version"; exit 1; }
  echo "→ WI-5651 cross-swapping embedded-postgres binary pkg: drop $_epg_host, fetch darwin-${TARGET_ARCH}@${_epg_ver}"
  rm -rf "${_epg_root:?}"/*
  fetch_cross_npm_pkg "@embedded-postgres/darwin-${TARGET_ARCH}@${_epg_ver}" "$EMBEDDED_PG_DST/node_modules" || exit 1
  # tar/umask can drop the exec bit on extract; the assertion below requires -x.
  chmod +x "$_epg_root/darwin-${TARGET_ARCH}/native/bin/"* 2>/dev/null || true
fi
# Sanity check: must have at least one @embedded-postgres/<platform> binary pkg
if ! ls "$EMBEDDED_PG_DST/node_modules/@embedded-postgres" 2>/dev/null | grep -q .; then
  echo "ERROR: bundled embedded-postgres missing platform binary — node_modules install didn't include @embedded-postgres/*"
  exit 1
fi

# ── BUILD-TIME ASSERTION: the embedded-PG server binaries MUST be real ──────
# This is the guard for the 0-byte-binary bug (2026-06-01): a concurrent /
# interrupted build, a strip step, or a botched copy can leave initdb /
# postgres present-but-empty or non-executable in the bundle. The packaged
# app would then fail to initdb at runtime. With the pglite fallback gone,
# that's a hard, user-visible failure — so catch it HERE, at build time,
# before anything ships. We assert across EVERY bundled @embedded-postgres
# platform tree (cross-platform builds may have more than one).
echo "→ asserting embedded-postgres binaries are present, non-empty, and executable"
pg_bin_checked=0
for _pg_bin_dir in "$EMBEDDED_PG_DST/node_modules/@embedded-postgres"/*/native/bin; do
  [[ -d "$_pg_bin_dir" ]] || continue
  for _req_bin in initdb postgres; do
    _bin_path="$_pg_bin_dir/$_req_bin"
    if [[ ! -e "$_bin_path" ]]; then
      echo "ERROR: bundled embedded-PG binary missing: $_bin_path"
      echo "  The embedded-postgres npm install did not produce this binary."
      echo "  Refusing to ship a bundle whose Postgres cannot initdb."
      exit 1
    fi
    if [[ ! -s "$_bin_path" ]]; then
      echo "ERROR: bundled embedded-PG binary is 0 bytes: $_bin_path"
      echo "  An empty binary means an interrupted build or a botched copy"
      echo "  truncated it. (Concurrent builds are flock-serialized and publish"
      echo "  atomically since P-056, so a parallel build should no longer be"
      echo "  the cause.) Refusing to ship a broken Postgres."
      exit 1
    fi
    if [[ ! -x "$_bin_path" ]]; then
      echo "ERROR: bundled embedded-PG binary is not executable: $_bin_path"
      echo "  The executable bit was lost (cp without -a / mode-preservation)."
      echo "  Refusing to ship a Postgres binary the app cannot exec."
      exit 1
    fi
    _bin_size=$(stat -c %s "$_bin_path" 2>/dev/null || stat -f %z "$_bin_path" 2>/dev/null || echo 0)
    echo "  ✓ $_req_bin: ${_bin_size} bytes, executable ($_bin_path)"
    pg_bin_checked=$((pg_bin_checked + 1))
  done
done
if [[ "$pg_bin_checked" -eq 0 ]]; then
  echo "ERROR: no @embedded-postgres/*/native/bin/ tree found to assert against"
  echo "  Expected initdb + postgres under $EMBEDDED_PG_DST/node_modules/@embedded-postgres/*/native/bin/"
  exit 1
fi

# ── WI-5651: restore the darwin dylib compat symlinks the cross-fetch dropped ──
# The @embedded-postgres/darwin-<arch> server binaries (postgres/initdb/pg_ctl)
# reference dylibs by their SHORT soname via @loader_path/../lib/<name>
# (libzstd.1.dylib, liblz4.1.dylib, libz.1.dylib, libicui18n.dylib, …), but
# native/lib ships only the FULLY-versioned files (libzstd.1.5.7.dylib, …). A
# Homebrew keg carries the short→versioned compat symlinks; the npm-pack→extract
# cross-fetch above drops them. dyld then aborts the instant postgres is exec'd
# on macOS ("Library not loaded: @loader_path/../lib/libzstd.1.dylib") — a
# failure the linux-side verifier is blind to (it cannot run a Mach-O; caught
# only by executing on the mac VM, WI-5651). Re-create every referenced-but-
# missing name as a symlink to its versioned counterpart. Idempotent (ln -sf),
# a no-op where the package already ships the link. (libcurl.4.dylib — referenced
# only by libpq-oauth-18.dylib, the OAuth plugin embedded PG never dlopens under
# local/trust auth — has no bundled counterpart and is correctly skipped.)
_pg_otool="$(command -v llvm-otool-18 2>/dev/null || command -v otool 2>/dev/null || true)"
if [[ -n "$_pg_otool" ]]; then
  for _pg_native in "$EMBEDDED_PG_DST/node_modules/@embedded-postgres"/darwin-*/native; do
    [[ -d "$_pg_native/lib" ]] || continue
    _pg_made=0
    _pg_refs="$( { for _f in "$_pg_native/bin/"* "$_pg_native/lib/"*.dylib; do [[ -f "$_f" ]] && "$_pg_otool" -L "$_f" 2>/dev/null; done; } \
      | grep -oE '@loader_path/\.\./lib/[^ ]+\.dylib' | sed 's#.*/lib/##' | sort -u )"
    for _ref in $_pg_refs; do
      [[ -e "$_pg_native/lib/$_ref" ]] && continue
      # Versioned counterpart: libzstd.1.dylib → libzstd.1.<ver>.dylib. compgen -G
      # so a ref with NO bundled counterpart (e.g. libcurl.4.dylib — OAuth-only,
      # never dlopen'd) yields an EMPTY list and is SKIPPED. The prior
      # `ls "…${_ref%.dylib}."*.dylib | head -1` aborted the ENTIRE sidecar build on
      # such a ref: an unmatched glob makes `ls` exit 2, and under this script's
      # `set -euo pipefail` the failing command-substitution assignment tripped
      # errexit (exit 2, no error text) — invisible when the block is run
      # interactively without errexit, caught only by a clean in-script rebuild.
      # Portable equivalent of `mapfile -t` (avoid — macOS ships bash 3.2
      # system-wide (GPLv3 license cutoff after bash 3.2), which predates
      # `mapfile`/`readarray` (bash 4.0+); a remote build invoked over ssh
      # without an explicit Homebrew-bash PATH override resolves `bash` to
      # that ancient system one and dies here with "mapfile: command not
      # found" (WI-5769 — 5th independently-discovered missing-dependency-
      # class packaging bug, this one an interpreter-version bug not a
      # missing npm dep). `while read` is bash-3.2-safe.
      _pg_cands=()
      while IFS= read -r _pg_cand; do
        [[ -n "$_pg_cand" ]] && _pg_cands+=("$_pg_cand")
      done < <(compgen -G "$_pg_native/lib/${_ref%.dylib}.*.dylib" || true)
      [[ ${#_pg_cands[@]} -gt 0 ]] || continue
      ln -sf "$(basename "${_pg_cands[0]}")" "$_pg_native/lib/$_ref" && _pg_made=$((_pg_made + 1))
    done
    echo "  ✓ darwin PG dylib compat symlinks: ${_pg_made} restored in ${_pg_native#$SIDECAR_DIR/}/lib"
  done
fi

# Bundle pgvector into the embedded-postgres binary tree, per platform.
# Without this, mem0's vector store falls back to in-process memory
# (volatile across restarts). The embedded-postgres binaries from zonky
# ship server-only — no extensions beyond plpgsql — so we source pgvector
# from a system install on the build host and copy it into the bundle.
#
# Platform sources:
#   Linux (Ubuntu/Debian): apt install postgresql-18-pgvector
#                          → /usr/lib/postgresql/18/lib/vector.so
#                            /usr/share/postgresql/18/extension/vector*
#   macOS (Homebrew):      brew install pgvector (against postgresql@18)
#                          → $(brew --prefix)/lib/postgresql/vector.dylib
#                            $(brew --prefix)/share/postgresql@18/extension/vector*
#   Windows:               No automation yet; we warn and continue. mem0
#                          falls back to in-memory provider on Windows
#                          desktops until a vector.dll is bundled.
# WI-5651: shared OCI core for fetching a Homebrew bottle for a DARWIN target
# FROM this linux host (brew is absent here). Homebrew publishes bottles as OCI
# artifacts on ghcr; this pulls the darwin/<arch> bottle for <formula>@<ver> from
# ghcr repo <repo>, PREFERRING the macOS 14 (sonoma) build (proven ABI-matched to
# zonky's embedded PG18), falling back to the newest available. Extracts the
# tarball and echoes the extraction TMP root — the caller finds files under it and
# MUST rm -rf it when done. set -e is DISABLED inside (these fns are called via
# `||`), so every failure is checked by hand and returns non-zero.
_fetch_brew_bottle_raw() {
  local formula="$1" ver="$2" arch="$3" repo="$4"
  local brew_arch; case "$arch" in x64) brew_arch=amd64 ;; arm64) brew_arch=arm64 ;; *) echo "bottle($formula): unsupported arch $arch" >&2; return 1 ;; esac
  local token; token="$(curl -fsSL "https://ghcr.io/token?service=ghcr.io&scope=repository:${repo}:pull" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])' 2>/dev/null)"
  [[ -n "$token" ]] || { echo "bottle($formula): ghcr token fetch failed" >&2; return 1; }
  local idx; idx="$(curl -fsSL -H "Authorization: Bearer $token" -H "Accept: application/vnd.oci.image.index.v1+json" "https://ghcr.io/v2/${repo}/manifests/${ver}" 2>/dev/null)"
  [[ -n "$idx" ]] || { echo "bottle($formula): index manifest fetch failed (v${ver})" >&2; return 1; }
  local nested; nested="$(printf '%s' "$idx" | python3 -c '
import sys,json,re
idx=json.load(sys.stdin); want=sys.argv[1]
def mac(s):
    m=re.search(r"(\d+)", s or ""); return int(m.group(1)) if m else -1
cands=[]
for m in idx.get("manifests",[]):
    p=m.get("platform",{}) or {}
    if p.get("os")=="darwin" and p.get("architecture")==want:
        cands.append((mac(p.get("os.version","")), m.get("digest","")))
if not cands: sys.exit(1)
# prefer macOS 14 (sonoma, proven), else the newest available
sonoma=[c for c in cands if c[0]==14]
pick=sonoma[0] if sonoma else max(cands, key=lambda c:c[0])
print(pick[1])
' "$brew_arch" 2>/dev/null)"
  [[ -n "$nested" ]] || { echo "bottle($formula): no darwin/$brew_arch manifest in the index" >&2; return 1; }
  local man; man="$(curl -fsSL -H "Authorization: Bearer $token" -H "Accept: application/vnd.oci.image.manifest.v1+json" "https://ghcr.io/v2/${repo}/manifests/${nested}" 2>/dev/null)"
  local layer; layer="$(printf '%s' "$man" | python3 -c 'import sys,json;print(json.load(sys.stdin)["layers"][0]["digest"])' 2>/dev/null)"
  [[ -n "$layer" ]] || { echo "bottle($formula): could not read layer digest" >&2; return 1; }
  local tmp; tmp="$(mktemp -d)"
  curl -fsSL -H "Authorization: Bearer $token" "https://ghcr.io/v2/${repo}/blobs/${layer}" -o "$tmp/bottle.tar.gz" 2>/dev/null || { echo "bottle($formula): blob download failed" >&2; rm -rf "$tmp"; return 1; }
  tar -xzf "$tmp/bottle.tar.gz" -C "$tmp" 2>/dev/null || { echo "bottle($formula): tar extract failed" >&2; rm -rf "$tmp"; return 1; }
  printf '%s\n' "$tmp"
}

# WI-5651: fetch <formula>@<ver> darwin bottle and copy its keg root (the dir
# directly containing bin/ lib/ share/) into <outdir>. Echoes <outdir>. Sources
# the darwin PostgreSQL client tools + libreadline on the linux cross host.
fetch_brew_keg() {
  local formula="$1" ver="$2" arch="$3" repo="$4" outdir="$5"
  local tmp; tmp="$(_fetch_brew_bottle_raw "$formula" "$ver" "$arch" "$repo")" || return 1
  local keg; keg="$(find "$tmp" -maxdepth 4 -type d \( -name bin -o -name lib \) 2>/dev/null | head -1)"
  [[ -n "$keg" ]] || { echo "bottle($formula): could not locate keg root (no bin/ or lib/)" >&2; rm -rf "$tmp"; return 1; }
  keg="$(dirname "$keg")"
  rm -rf "$outdir"; mkdir -p "$outdir"
  cp -a "$keg/." "$outdir/" || { echo "bottle($formula): keg copy failed" >&2; rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  printf '%s\n' "$outdir"
}

# WI-5651: fetch the pgvector Homebrew bottle for a darwin target and normalize
# to <out>/vector.dylib + <out>/extension/ (from share/postgresql@18/extension).
fetch_pgvector_darwin_bottle() {
  local ver="$1" arch="$2"
  local tmp; tmp="$(_fetch_brew_bottle_raw pgvector "$ver" "$arch" homebrew/core/pgvector)" || return 1
  # The bottle carries BOTH share/postgresql@18/extension (the SQL + vector.control
  # we want) AND include/postgresql@18/server/extension (headers, no control) — so
  # target the share/ path EXPLICITLY, or a bare `-name extension` picks include/
  # (it sorts first) and the copy fails. NB: set -e is DISABLED inside this fn (it
  # is called via `||`), so every failure is checked by hand and returns non-zero.
  local dylib; dylib="$(find "$tmp" -type f -path '*/lib/postgresql@18/vector.dylib' | head -1)"
  [[ -z "$dylib" ]] && dylib="$(find "$tmp" -type f -name vector.dylib | head -1)"
  local extdir; extdir="$(find "$tmp" -type d -path '*/share/postgresql@18/extension' | head -1)"
  [[ -z "$extdir" ]] && extdir="$(dirname "$(find "$tmp" -type f -path '*/share/*' -name vector.control | head -1)")"
  [[ -f "$dylib" ]] || { echo "pgvector bottle: lib/postgresql@18/vector.dylib not found in bottle" >&2; rm -rf "$tmp"; return 1; }
  [[ -n "$extdir" && -f "$extdir/vector.control" ]] || { echo "pgvector bottle: share/postgresql@18/extension/vector.control not found in bottle" >&2; rm -rf "$tmp"; return 1; }
  local out; out="$(mktemp -d)"; mkdir -p "$out/extension"
  cp "$dylib" "$out/vector.dylib" || { echo "pgvector bottle: dylib copy failed" >&2; rm -rf "$tmp"; return 1; }
  cp "$extdir"/vector*.sql "$out/extension/" 2>/dev/null || true
  cp "$extdir"/vector.control "$out/extension/" || { echo "pgvector bottle: vector.control copy failed" >&2; rm -rf "$tmp"; return 1; }
  [[ -f "$out/vector.dylib" && -f "$out/extension/vector.control" ]] || { echo "pgvector bottle: normalized output incomplete" >&2; rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  printf '%s\n' "$out"
}
echo "→ bundling pgvector into embedded-postgres (per platform)"
pgvector_copied=0
# WI-5651: route pgvector's platform off TARGET_OS (default host), NOT uname — a
# cross darwin bundle must ship the darwin vector.dylib, not this linux host's .so.
# TARGET_OS is already spelled linux|darwin|windows, matching the branches below.
_pgv_os="$TARGET_OS"
case "$_pgv_os" in
  linux)
    pgv_lib_src="/usr/lib/postgresql/18/lib/vector.so"
    pgv_ext_src="/usr/share/postgresql/18/extension"
    pgv_lib_ext="so"
    ;;
  darwin)
    pgv_lib_ext="dylib"
    if [[ "$CROSS_BUILD" == "1" ]]; then
      # brew is absent on the linux cross host — fetch the darwin bottle from ghcr.
      _pgv_ver="$(curl -fsSL https://formulae.brew.sh/api/formula/pgvector.json 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["versions"]["stable"])' 2>/dev/null)"
      [[ -n "$_pgv_ver" ]] || { echo "ERROR: could not resolve pgvector stable version from the brew formula api"; exit 1; }
      echo "  → cross: fetching pgvector ${_pgv_ver} darwin-${TARGET_ARCH} bottle from ghcr (no brew on ${_host_os})"
      _pgv_bottle="$(fetch_pgvector_darwin_bottle "$_pgv_ver" "$TARGET_ARCH")" || { echo "ERROR: pgvector darwin bottle fetch failed (see above)"; exit 1; }
      pgv_lib_src="$_pgv_bottle/vector.dylib"
      pgv_ext_src="$_pgv_bottle/extension"
    elif command -v brew >/dev/null 2>&1; then
      brew_prefix="$(brew --prefix 2>/dev/null)"
      pgv_lib_src="$brew_prefix/lib/postgresql/vector.dylib"
      pgv_ext_src="$brew_prefix/share/postgresql@18/extension"
      if [[ ! -f "$pgv_lib_src" ]] && pg_prefix=$(brew --prefix postgresql@18 2>/dev/null); then
        pgv_lib_src="$pg_prefix/lib/postgresql/vector.dylib"
        pgv_ext_src="$pg_prefix/share/postgresql@18/extension"
      fi
      # Modern pgvector keg layout: per-PG-version subdirs under the
      # pgvector keg itself (opt/pgvector/lib/postgresql@18/vector.dylib).
      if [[ ! -f "$pgv_lib_src" ]] && pgv_prefix=$(brew --prefix pgvector 2>/dev/null); then
        pgv_lib_src="$pgv_prefix/lib/postgresql@18/vector.dylib"
        pgv_ext_src="$pgv_prefix/share/postgresql@18/extension"
      fi
    fi
    ;;
  windows)
    echo "  ⚠ pgvector not bundled on Windows (no automated source); mem0 will use in-memory fallback on Windows desktops"
    pgv_lib_src=""
    ;;
esac

if [[ -n "${pgv_lib_src:-}" ]]; then
  if [[ -f "$pgv_lib_src" && -d "$pgv_ext_src" ]]; then
    for plat_dir in "$EMBEDDED_PG_DST/node_modules/@embedded-postgres"/*/native; do
      [[ -d "$plat_dir" ]] || continue
      mkdir -p "$plat_dir/lib/postgresql" "$plat_dir/share/postgresql/extension"
      # cp -f, not GNU-only -u: BSD/macOS cp has no -u.
      cp -f "$pgv_lib_src" "$plat_dir/lib/postgresql/"
      cp -f "$pgv_ext_src"/vector*.sql "$plat_dir/share/postgresql/extension/"
      cp -f "$pgv_ext_src/vector.control" "$plat_dir/share/postgresql/extension/"
      pgvector_copied=$((pgvector_copied + 1))
    done
    echo "  ✓ pgvector copied into $pgvector_copied embedded-postgres tree(s) (lib.${pgv_lib_ext} + sql + control)"
  else
    # HARD ERROR, not the old "mem0 in-memory fallback" warning: the
    # baseline schema CREATEs vector-typed columns, so a fresh-DB boot of a
    # bundle without pgvector dies fatally ('type "public.vector" does not
    # exist') — proven on the first mac DMG first-launch (2026-06-11).
    echo "ERROR: pgvector not found at $pgv_lib_src — a bundle without it cannot boot a fresh database"
    case "$_pgv_os" in
      linux)  echo "    Install: sudo apt install postgresql-18-pgvector" ;;
      darwin) echo "    Install: brew install pgvector  (requires postgresql@18 keg)" ;;
    esac
    exit 1
  fi
fi

# Fail loudly if pgvector ended up NOT bundled on a platform that requires it.
# The per-source HARD ERROR above only fires when a source was FOUND but
# incomplete (brew present, .dylib missing). It does NOT catch the SILENT-SKIP
# cases: on darwin `pgv_lib_src` is only set inside `if command -v brew`, so a
# build shell without `brew` on PATH (e.g. a NON-LOGIN shell that never ran
# path_helper, so /usr/local/bin is absent) leaves it empty → the whole block
# is skipped with no copy and no error → a bundle ships with no pgvector and
# dies on first fresh-DB boot ('type "public.vector" does not exist'). This
# backstop makes that a build failure instead. (Proven live 2026-06-30 on the
# mac VM: a nohup/non-login test build silently shipped a pgvector-less sidecar.)
if [[ "$_pgv_os" != "windows" && "${pgvector_copied:-0}" -eq 0 ]]; then
  echo "ERROR: pgvector was NOT bundled into any embedded-postgres tree on $_pgv_os."
  echo "       A fresh-DB boot will die fatally with 'type \"public.vector\" does not exist'."
  case "$_pgv_os" in
    linux)  echo "       Install: sudo apt install postgresql-18-pgvector" ;;
    darwin) echo "       Install: brew install pgvector  — AND ensure 'brew' is on PATH for the build shell"
            echo "                (a non-login shell may lack /usr/local/bin; run the build via 'bash -lc' or 'eval \$(/usr/local/bin/brew shellenv)')" ;;
  esac
  exit 1
fi

# Surface real pg_dump / psql to the sidecar's $PATH so the snapshot
# subsystem (packages/backup/src/hook.ts spawns `pg_dump` by bare name; the
# legacy libs/papercusp-export-state/src/pg-dump.ts is retired) finds them.
# NOTE hook.ts DEGRADES SOFTLY on spawn failure — a broken vendored tool means
# snapshots silently ship WITHOUT the PG dump, which is why the guards below
# hard-fail the build instead of trusting a runtime error to surface it.
# Replaces the legacy WASM-pg_dump path that went through pglite-server's
# /admin/pg-dump endpoint.
#
# IMPORTANT: zonky's embedded-postgres-binaries (what `embedded-postgres`
# wraps) ships SERVER-only — initdb, pg_ctl, postgres. Client tools
# (pg_dump, psql, pg_dumpall) are stripped to keep size small (~60MB
# instead of ~200MB). So we can't symlink from the embedded distribution
# alone; we have to source the client tools elsewhere. Strategy:
#   1. If an embedded copy exists for the tool → use it.
#   2. Otherwise, copy from the build host's system PATH.
#   3. If neither: HARD FAIL — snapshot capture would be broken on the
#      shipped bundle. Don't silently produce a broken release.
mkdir -p "$SIDECAR_DIR/bin"
EMBEDDED_PG_BIN_DIR=""
for plat in "$EMBEDDED_PG_DST/node_modules/@embedded-postgres"/*/native/bin; do
  if [[ -d "$plat" ]]; then
    EMBEDDED_PG_BIN_DIR="$plat"
    break
  fi
done
if [[ -z "$EMBEDDED_PG_BIN_DIR" ]]; then
  echo "ERROR: could not find native/bin directory inside @embedded-postgres/*"
  exit 1
fi
echo "→ wiring pg_dump / psql / pg_dumpall into $SIDECAR_DIR/bin/"
SOURCE_NOTE_FILE="$SIDECAR_DIR/bin/.pg-tools-source"
> "$SOURCE_NOTE_FILE"
# WI-5651: cross-baking the darwin sidecar on THIS linux host. The client-tool
# wiring below needs a dedicated cross-darwin path — every host-source branch
# resolves LINUX binaries, and the darwin Mach-Os can't be exec'd here (so even
# the version/probe steps must avoid running them).
_cross_darwin=0
[[ "$CROSS_BUILD" == "1" && "$TARGET_OS" == "darwin" ]] && _cross_darwin=1
# The embedded server's major version — vendored client tools must match it
# (pg_dump cannot dump a server NEWER than itself, so distro-default clients —
# e.g. Ubuntu 24.04's v16 vs our embedded 18 — are not acceptable sources).
if [[ "$_cross_darwin" == "1" ]]; then
  # Can't exec the darwin `postgres` binary on this linux host — derive the major
  # from the installed @embedded-postgres/<platform> package version instead
  # (e.g. 18.3.0-beta.17 → 18). EMBEDDED_PG_BIN_DIR is <pkg>/native/bin.
  _epg_pkg_json="$(cd "$EMBEDDED_PG_BIN_DIR/../.." 2>/dev/null && pwd)/package.json"
  EMBEDDED_PG_MAJOR="$(node -e "console.log(String(require('$_epg_pkg_json').version).split('.')[0])" 2>/dev/null)"
else
  EMBEDDED_PG_MAJOR="$("$EMBEDDED_PG_BIN_DIR/postgres" --version 2>/dev/null | grep -oE '[0-9]+' | head -1)"
fi
if [[ -z "$EMBEDDED_PG_MAJOR" ]]; then
  echo "ERROR: could not determine embedded postgres major version from $EMBEDDED_PG_BIN_DIR/postgres"
  exit 1
fi

# WI-5651 cross-darwin: pre-fetch the darwin PostgreSQL client tools (Homebrew
# postgresql@<major> bottle) + the one dylib the embedded native/lib lacks
# (libreadline, psql's dep). The tool loop below sources from $_cross_darwin_pg_keg
# and rewrites keg-dylib refs via _cross_darwin_vendor_pg_tool. native/lib already
# ships libpq/libintl/libcrypto/liblz4/libzstd for the server, so we REUSE those
# and vendor ONLY readline — avoiding a duplicate multi-dylib closure in the app.
_cross_darwin_pg_keg=""
if [[ "$_cross_darwin" == "1" ]]; then
  _brew_pg_ver="$(curl -fsSL "https://formulae.brew.sh/api/formula/postgresql@${EMBEDDED_PG_MAJOR}.json" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["versions"]["stable"])' 2>/dev/null)"
  [[ -n "$_brew_pg_ver" ]] || { echo "ERROR: could not resolve postgresql@${EMBEDDED_PG_MAJOR} stable version from the brew formula api"; exit 1; }
  echo "  → cross: fetching postgresql@${EMBEDDED_PG_MAJOR} ${_brew_pg_ver} darwin-${TARGET_ARCH} client tools from ghcr (no brew on ${_host_os})"
  _cross_darwin_pg_keg="$(fetch_brew_keg "postgresql@${EMBEDDED_PG_MAJOR}" "$_brew_pg_ver" "$TARGET_ARCH" "homebrew/core/postgresql/${EMBEDDED_PG_MAJOR}" "$(mktemp -d)/pgkeg")" \
    || { echo "ERROR: postgresql@${EMBEDDED_PG_MAJOR} darwin bottle fetch failed (see above)"; exit 1; }
  # readline: psql's one non-system dep NOT already in native/lib. Vendor it into
  # bin/.pg-lib (its only dep, libncurses, is a macOS system lib — leave it).
  _brew_rl_ver="$(curl -fsSL "https://formulae.brew.sh/api/formula/readline.json" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["versions"]["stable"])' 2>/dev/null)"
  [[ -n "$_brew_rl_ver" ]] || { echo "ERROR: could not resolve readline stable version from the brew formula api"; exit 1; }
  echo "  → cross: fetching readline ${_brew_rl_ver} darwin-${TARGET_ARCH} bottle (libreadline.8 for psql)"
  _cross_rl_keg="$(fetch_brew_keg readline "$_brew_rl_ver" "$TARGET_ARCH" "homebrew/core/readline" "$(mktemp -d)/rlkeg")" \
    || { echo "ERROR: readline darwin bottle fetch failed (see above)"; exit 1; }
  mkdir -p "$SIDECAR_DIR/bin/.pg-lib"
  _rl_src="$(find "$_cross_rl_keg/lib" -maxdepth 1 -name 'libreadline.8.dylib' | head -1)"
  [[ -n "$_rl_src" ]] || _rl_src="$(find "$_cross_rl_keg/lib" -maxdepth 1 -name 'libreadline.8*.dylib' ! -type l | head -1)"
  [[ -n "$_rl_src" ]] || { echo "ERROR: libreadline.8.dylib not found in the readline bottle"; exit 1; }
  cp -L "$_rl_src" "$SIDECAR_DIR/bin/.pg-lib/libreadline.8.dylib"
  chmod 755 "$SIDECAR_DIR/bin/.pg-lib/libreadline.8.dylib"
  llvm-install-name-tool-18 -id "@executable_path/.pg-lib/libreadline.8.dylib" "$SIDECAR_DIR/bin/.pg-lib/libreadline.8.dylib"
  rcodesign sign "$SIDECAR_DIR/bin/.pg-lib/libreadline.8.dylib" >/dev/null 2>&1 \
    || { echo "ERROR: rcodesign ad-hoc sign failed for vendored libreadline.8.dylib"; exit 1; }
  echo "  ✓ cross: vendored + signed libreadline.8.dylib into bin/.pg-lib"
fi

# NEVER vendor a #!-script as a pg tool. On Debian/Ubuntu `command -v psql`
# resolves to postgresql-common's perl pg_wrapper DISPATCHER, not the real
# binary. It works on the build host (wrapper + versioned client both
# installed there) so every build-time probe passes — then dies on every
# clean machine (`Can't locate PgCommon.pm`). We shipped ALL FOUR tools as
# that broken 9.5K shim until 2026-07-07, which silently disabled the PG half
# of the snapshot subsystem in the packaged app (hook.ts degrades to a
# dump-less snapshot on spawn failure). Resolve the real binary or fail loud.
_is_script() { [[ "$(head -c 2 "$1" 2>/dev/null)" == "#!" ]]; }

# WI-3314 (darwin): brew-keg Mach-Os reference absolute /usr/local | /opt/homebrew
# dylib paths that exist only on Homebrew machines (masked on the build VM, dead
# on clean targets). Vendor the non-system dylib closure into bin/.pg-lib and
# rewrite every reference @executable_path-relative (@loader_path between
# dylibs), then ad-hoc re-sign each mutated Mach-O — install_name_tool
# invalidates the linker signature, and a stale signature can SIGKILL on load.
# The darwin twin of the Linux .pg-real/LD_LIBRARY_PATH wrapper above.
_darwin_vendor_keg_dylibs() {
  local target="$1" prefix="$2"
  local libdir="$SIDECAR_DIR/bin/.pg-lib"
  mkdir -p "$libdir"
  local dep base
  while IFS= read -r dep; do
    [[ -n "$dep" ]] || continue
    base="$(basename "$dep")"
    if [[ ! -e "$libdir/$base" ]]; then
      cp -L "$dep" "$libdir/$base"
      chmod 755 "$libdir/$base"
      install_name_tool -id "@loader_path/$base" "$libdir/$base"
      _darwin_vendor_keg_dylibs "$libdir/$base" "@loader_path"
    fi
    install_name_tool -change "$dep" "$prefix/$base" "$target"
  done < <(otool -L "$target" 2>/dev/null | awk 'NR>1{print $1}' | grep -E '^(/usr/local|/opt/homebrew)/' || true)
  codesign --force -s - "$target"
}

# WI-5651: the CROSS twin of _darwin_vendor_keg_dylibs — runs on THIS linux host
# with llvm-install-name-tool-18 + rcodesign (native otool/install_name_tool/
# codesign are macOS-only). The Homebrew bottle tools reference their dylibs via
# @@HOMEBREW_CELLAR@@ / @@HOMEBREW_PREFIX@@ placeholder TOKENS. Rewrite every
# non-system ref to REUSE the darwin native/lib already shipped for the embedded
# server (name-matched to the exact versioned filename present — the tree ships
# NO compat-name symlinks), or the caller's own vendored-lib dir (bin/.pg-lib by
# default; EI-3620 reuses this for git's bin/.git-lib via the 2nd arg — same
# placeholder-token mechanism, confirmed identical across every Homebrew bottle
# fetched via fetch_brew_keg/_fetch_brew_bottle_raw); then ad-hoc re-sign
# (rewriting the load commands invalidates the signature, and a stale one
# SIGKILLs on load). rcodesign's `verify` is buggy (exits 0 on error) — the sign
# step's exit code is the reliable signal.
# EI-3620: `vendor_dir` is an ABSOLUTE vendor-lib directory (was a bin/-relative
# subdir NAME, which silently assumed every $tool lives directly in
# $SIDECAR_DIR/bin/ — true for the flat pg_dump/psql/etc layout, but WRONG for
# git's nested bin/.git-vendor/{bin,libexec/git-core}/ tree, where two
# different real-Mach-O directories sit at two different depths relative to
# bin/). @executable_path is resolved by dyld relative to $tool's OWN
# directory at runtime, so the relative offset to nlibdir/vendor_dir is now
# computed PER TOOL via `python3 -c os.path.relpath(...)` instead of a single
# hardcoded "../" — this generalizes correctly to any nesting depth and is a
# no-op behavior change for the existing flat pg callers (relpath from
# $SIDECAR_DIR/bin/<tool> reduces to the same "../…"/".pg-lib" strings as
# before). Caught live on papercup-vm-mac (2026-07-26): the naive
# bin/-relative version shipped a `git` whose dyld load failed with "Library
# not loaded: @executable_path/.git-lib/libpcre2-8.0.dylib" because bin/git
# actually lived two directories deeper, under bin/.git-vendor/bin/.
_cross_darwin_vendor_pg_tool() {
  local tool="$1"
  local vendor_dir="${2:-$SIDECAR_DIR/bin/.pg-lib}"   # absolute vendor-lib dir
  local nlibdir="${EMBEDDED_PG_BIN_DIR%/bin}/lib"
  local tool_dir; tool_dir="$(cd "$(dirname "$tool")" && pwd)"
  local emb_lib_rel; emb_lib_rel="$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$nlibdir" "$tool_dir")"
  local vendor_rel; vendor_rel="$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$vendor_dir" "$tool_dir")"
  chmod +w "$tool"
  local dep base stem m tgt
  while IFS= read -r dep; do
    [[ -n "$dep" ]] || continue
    case "$dep" in /usr/lib/*|/System/*) continue ;; esac      # macOS system libs — always present
    base="$(basename "$dep")"
    tgt=""
    if [[ -e "$nlibdir/$base" ]]; then
      tgt="$base"                                              # exact (libpq.5, libintl.8, libcrypto.3)
    else
      stem="${base%.dylib}"
      m="$(ls "$nlibdir/$stem".*.dylib 2>/dev/null | head -1)" # compat→versioned (libzstd.1→libzstd.1.5.7)
      [[ -n "$m" ]] && tgt="$(basename "$m")"
    fi
    if [[ -n "$tgt" ]]; then
      llvm-install-name-tool-18 -change "$dep" "@executable_path/$emb_lib_rel/$tgt" "$tool"
    elif [[ -e "$vendor_dir/$base" ]]; then
      llvm-install-name-tool-18 -change "$dep" "@executable_path/$vendor_rel/$base" "$tool"
    else
      echo "ERROR: $(basename "$tool") links '$dep' ($base) — neither in the embedded darwin"
      echo "  native/lib ($nlibdir) nor vendored in $vendor_dir. It would dangle on a clean Mac."
      return 1
    fi
  done < <(llvm-otool-18 -L "$tool" 2>/dev/null | awk 'NR>1{print $1}' | grep -vE '^@(executable_path|loader_path|rpath)/' || true)
  rcodesign sign "$tool" >/dev/null 2>&1 || { echo "ERROR: rcodesign ad-hoc sign failed for $tool"; return 1; }
}

_pg_build_os="$(uname -s)"
for tool in pg_dump psql pg_dumpall pg_restore; do
  src=""
  method=""
  # WI-5651 cross-darwin: source from the fetched Homebrew postgresql bottle
  # (checked FIRST — every other branch below resolves this linux host's binaries).
  if [[ "$_cross_darwin" == "1" ]]; then
    if [[ -f "$_cross_darwin_pg_keg/bin/$tool" ]]; then
      src="$_cross_darwin_pg_keg/bin/$tool"
      method="copy (darwin postgresql@${EMBEDDED_PG_MAJOR} bottle)"
    else
      echo "ERROR: $tool not present in the darwin postgresql bottle ($_cross_darwin_pg_keg/bin)"
      exit 1
    fi
  fi
  if [[ -z "$src" ]] && [[ -x "$EMBEDDED_PG_BIN_DIR/$tool" ]] && ! _is_script "$EMBEDDED_PG_BIN_DIR/$tool"; then
    src="$EMBEDDED_PG_BIN_DIR/$tool"
    method="symlink (from embedded-postgres)"
  fi
  # Debian/Ubuntu: the REAL versioned binaries live under /usr/lib/postgresql/
  # (pgdg layout). Require the major to match the embedded server exactly.
  if [[ -z "$src" && "$_pg_build_os" == "Linux" && -x "/usr/lib/postgresql/$EMBEDDED_PG_MAJOR/bin/$tool" ]] \
      && ! _is_script "/usr/lib/postgresql/$EMBEDDED_PG_MAJOR/bin/$tool"; then
    src="/usr/lib/postgresql/$EMBEDDED_PG_MAJOR/bin/$tool"
    method="copy (real binary, pgdg /usr/lib/postgresql/$EMBEDDED_PG_MAJOR/bin)"
  fi
  # pg_config bindir (brew libpq keg, pgdg with pg_config on PATH, …).
  if [[ -z "$src" ]] && command -v pg_config >/dev/null 2>&1; then
    _pg_bindir="$(pg_config --bindir 2>/dev/null)"
    if [[ -n "$_pg_bindir" && -x "$_pg_bindir/$tool" ]] && ! _is_script "$_pg_bindir/$tool"; then
      src="$_pg_bindir/$tool"
      method="copy (pg_config bindir $_pg_bindir)"
    fi
  fi
  # Last resort: system PATH — but REJECT script shims instead of vendoring them.
  if [[ -z "$src" ]] && system_path=$(command -v "$tool" 2>/dev/null) && [[ -n "$system_path" ]]; then
    if _is_script "$system_path"; then
      echo "ERROR: $tool on PATH ($system_path) is a script shim (Debian pg_wrapper), not a"
      echo "  real binary. Vendoring it ships a tool that only runs on hosts with a full"
      echo "  PostgreSQL client install (the 2026-07-07 broken-psql bug class). Install the"
      echo "  real client matching the embedded server:"
      echo "    Ubuntu/Debian: apt-get install postgresql-client-$EMBEDDED_PG_MAJOR   (pgdg repo)"
      exit 1
    fi
    src="$system_path"
    method="copy (from system PATH)"
  fi
  if [[ -z "$src" ]]; then
    echo "ERROR: $tool not found in embedded-postgres distribution AND not on system PATH"
    echo "  embedded-postgres ships server-only (initdb, pg_ctl, postgres). The build"
    echo "  host needs PostgreSQL client tools (real binaries, major $EMBEDDED_PG_MAJOR)"
    echo "  for the snapshot subsystem to work in the bundled desktop app. Install via:"
    echo "    macOS:   brew install libpq && brew link --force libpq"
    echo "    Ubuntu:  apt-get install postgresql-client-$EMBEDDED_PG_MAJOR   (pgdg repo)"
    echo "    Windows: install PostgreSQL from postgresql.org"
    exit 1
  fi
  case "$method" in
    symlink*) ln -sfn "$src" "$SIDECAR_DIR/bin/$tool" ;;
    copy*)
      if [[ "$_cross_darwin" == "1" ]]; then
        # WI-5651: cross-baking darwin ON linux — the build host IS Linux, so the
        # branches below would wrongly build the Linux .pg-real wrapper. Copy the
        # darwin bottle binary and rewrite its keg dylibs with the llvm/rcodesign
        # toolchain (native otool/install_name_tool/codesign are macOS-only).
        cp -L "$src" "$SIDECAR_DIR/bin/$tool"
        chmod 755 "$SIDECAR_DIR/bin/$tool"
        _cross_darwin_vendor_pg_tool "$SIDECAR_DIR/bin/$tool" || exit 1
      elif [[ "$_pg_build_os" == "Linux" ]]; then
        # Real pgdg binaries link libpq.so.5 (and psql libreadline.so.8) that a
        # clean target machine may not have. Ship the binary under bin/.pg-real/
        # fronted by a sh wrapper whose LD_LIBRARY_PATH points at (a) the
        # embedded-postgres lib dir — libpq.so.5 plus the openssl-1.1 it links,
        # already shipped for the server ($ORIGIN/../lib) — and (b) .pg-real/lib
        # for readline/tinfo copied off the build host. Remaining deps
        # (zstd/lz4/z/crypto3) are Ubuntu base-system libs.
        mkdir -p "$SIDECAR_DIR/bin/.pg-real/lib"
        cp -L "$src" "$SIDECAR_DIR/bin/.pg-real/$tool"
        chmod 755 "$SIDECAR_DIR/bin/.pg-real/$tool"
        _emb_lib_rel="${EMBEDDED_PG_BIN_DIR#"$SIDECAR_DIR"/}"   # node_modules/.../native/bin
        _emb_lib_rel="../${_emb_lib_rel%/bin}/lib"               # ../node_modules/.../native/lib (relative to bin/)
        cat > "$SIDECAR_DIR/bin/$tool" <<WRAP
#!/bin/sh
# Generated by build-desktop-sidecar.sh — vendored PostgreSQL client tool.
# Real binary in .pg-real/; libs resolved from the embedded-postgres lib dir
# (libpq + its openssl 1.1) and .pg-real/lib (readline/tinfo).
d=\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)
LD_LIBRARY_PATH="\$d/$_emb_lib_rel:\$d/.pg-real/lib\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}" exec "\$d/.pg-real/$tool" "\$@"
WRAP
        chmod 755 "$SIDECAR_DIR/bin/$tool"
      else
        # chmod 755, not just +x: brew ships these 0555 (read-only) and
        # tauri-build's resource copy into target/<triple>/release/ then
        # EACCESes overwriting its own previous read-only copy on rebuild.
        cp -L "$src" "$SIDECAR_DIR/bin/$tool"
        chmod 755 "$SIDECAR_DIR/bin/$tool"
        if [[ "$_pg_build_os" == "Darwin" ]]; then
          _darwin_vendor_keg_dylibs "$SIDECAR_DIR/bin/$tool" "@executable_path/.pg-lib"
        fi
        # Windows: an .exe copied without its sibling DLLs (libpq.dll, ssl,
        # iconv/intl) still resolves them via PATH on the BUILD host — masked
        # — and breaks on clean machines (WI-3313). Ship the source dir's
        # DLLs beside the exes: the exe's own dir is first in the Windows
        # DLL search order, making the tools self-contained.
        case "$_pg_build_os" in
          MINGW*|MSYS*|CYGWIN*)
            cp -n "$(dirname "$src")"/*.dll "$SIDECAR_DIR/bin/" 2>/dev/null || true ;;
        esac
      fi
      ;;
  esac
  echo "  $tool: $method ($src)"
  echo "$tool: $method ($src)" >> "$SOURCE_NOTE_FILE"
done

# Linux: psql needs readline+tinfo, which minimal images may lack — bundle them
# into .pg-real/lib (tiny; resolved via the wrapper's LD_LIBRARY_PATH).
if [[ "$_pg_build_os" == "Linux" && -d "$SIDECAR_DIR/bin/.pg-real" ]]; then
  for _lib in libreadline.so.8 libtinfo.so.6; do
    _libpath="$(ldconfig -p 2>/dev/null | awk -v l="$_lib" '$1==l {print $NF; exit}')"
    if [[ -n "$_libpath" && -e "$_libpath" ]]; then
      cp -L "$_libpath" "$SIDECAR_DIR/bin/.pg-real/lib/$_lib"
    else
      echo "ERROR: $_lib not found on build host (needed by vendored psql on clean targets)"
      exit 1
    fi
  done
fi

# Sanity-probe every bundled tool AS INSTALLED (i.e. through the wrapper on
# linux, so the bundled-libs path is what's exercised) — and assert none of
# them is still a #!-script (the pg_wrapper bug class shipping again).
for tool in pg_dump psql pg_dumpall pg_restore; do
  _final="$SIDECAR_DIR/bin/$tool"
  if [[ "$_pg_build_os" == "Linux" && -e "$SIDECAR_DIR/bin/.pg-real/$tool" ]] && _is_script "$SIDECAR_DIR/bin/.pg-real/$tool"; then
    echo "ERROR: vendored $tool (.pg-real) is a script shim — refusing to ship it"
    exit 1
  fi
  if [[ "$_pg_build_os" != "Linux" ]] && _is_script "$_final"; then
    echo "ERROR: bundled $tool is a script shim — refusing to ship it"
    exit 1
  fi
  if [[ "$_cross_darwin" == "1" ]]; then
    # WI-5651: can't exec a darwin Mach-O on this linux host — assert STRUCTURALLY
    # instead: no keg/absolute dylib refs remain, every @executable_path ref
    # resolves to a bundled file, and the Mach-O is ad-hoc signed (dyld SIGKILLs
    # an unsigned/stale-signed binary on load).
    _bad="$(llvm-otool-18 -L "$_final" 2>/dev/null | awk 'NR>1{print $1}' | grep -E '@@|/opt/|/Library/|/usr/local/' || true)"
    if [[ -n "$_bad" ]]; then
      echo "ERROR: cross-vendored $tool still references keg/absolute dylib paths (would dangle on a clean Mac):"
      echo "$_bad" | sed 's/^/    /'
      exit 1
    fi
    while IFS= read -r _ref; do
      [[ -n "$_ref" ]] || continue
      _res="${_ref/@executable_path/$SIDECAR_DIR/bin}"
      [[ -e "$_res" ]] || { echo "ERROR: cross-vendored $tool references a missing bundled lib: $_ref"; exit 1; }
    done < <(llvm-otool-18 -L "$_final" 2>/dev/null | awk 'NR>1{print $1}' | grep -E '^@executable_path' || true)
    if ! rcodesign print-signature-info "$_final" 2>/dev/null | grep -q 'CodeDirectory'; then
      echo "ERROR: cross-vendored $tool is not ad-hoc signed (dyld would SIGKILL it on load)"
      exit 1
    fi
    echo "  $tool probe: cross-darwin structural OK (no dangling refs, bundled libs resolve, signed)"
    continue
  fi
  if ! _probe_out="$("$_final" --version 2>&1)"; then
    echo "ERROR: bundled $tool fails --version probe; not loadable as installed:"
    echo "  $_probe_out"
    echo "  This usually means dynamic library mismatch (e.g. libpq from a different"
    echo "  PG major version). Build on a host with real PG $EMBEDDED_PG_MAJOR client tools."
    exit 1
  fi
  echo "  $tool probe: $_probe_out"
done
# Linux: assert the vendored binaries' NEEDED libs all resolve using ONLY the
# wrapper's lib path + system dirs — catches a dep that exists on the build
# host but would never ship (masked-on-build-host bug class).
if [[ "$_pg_build_os" == "Linux" && -d "$SIDECAR_DIR/bin/.pg-real" ]]; then
  _emb_lib_dir="${EMBEDDED_PG_BIN_DIR%/bin}/lib"
  for tool in pg_dump psql pg_dumpall pg_restore; do
    _missing="$(LD_LIBRARY_PATH="$_emb_lib_dir:$SIDECAR_DIR/bin/.pg-real/lib" ldd "$SIDECAR_DIR/bin/.pg-real/$tool" 2>/dev/null | grep 'not found' || true)"
    if [[ -n "$_missing" ]]; then
      echo "ERROR: vendored $tool has unresolved shared libs:"
      echo "$_missing"
      exit 1
    fi
  done
fi

# ── kopia (snapshot subsystem, WI-3312) ─────────────────────────────────────
# packages/backup/src/workspace-backup.ts spawns bare `kopia` (KOPIA_BIN ??
# 'kopia') with sidecar/bin on the operator PATH. It was never bundled: dev
# boxes have a system kopia so everything worked there, while clean installs
# got `spawn kopia ENOENT` and every snapshot silently shipped without a
# kopia backup — same masked-dependency class as the pg_wrapper bug above.
# kopia is a single fully-static Go binary (Apache-2.0) — vendor it.
if [[ "$_cross_darwin" == "1" ]]; then
  # WI-5651: fetch the DARWIN kopia (Go static binary — links only macOS system
  # libs, so no dylib rewrite needed) matching the build host's kopia version. A
  # copied linux kopia would be an ELF the mac can't exec → silently dump-less
  # snapshots, and the host `--version` probe below CAN'T catch it (it runs the
  # ELF on linux, where it passes). Just fetch, copy, ad-hoc sign.
  _kopia_ver="$(kopia --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
  [[ -n "$_kopia_ver" ]] || { echo "ERROR: could not determine build-host kopia version to match the darwin download"; exit 1; }
  case "$TARGET_ARCH" in x64) _kopia_arch=x64 ;; arm64) _kopia_arch=arm64 ;; *) echo "ERROR: unsupported kopia target arch $TARGET_ARCH"; exit 1 ;; esac
  _kopia_url="https://github.com/kopia/kopia/releases/download/v${_kopia_ver}/kopia-${_kopia_ver}-macOS-${_kopia_arch}.tar.gz"
  echo "  → cross: fetching darwin kopia ${_kopia_ver} (${_kopia_arch}) from github releases"
  _kopia_tmp="$(mktemp -d)"
  curl -fsSL "$_kopia_url" -o "$_kopia_tmp/kopia.tgz" || { echo "ERROR: darwin kopia download failed: $_kopia_url"; rm -rf "$_kopia_tmp"; exit 1; }
  tar -xzf "$_kopia_tmp/kopia.tgz" -C "$_kopia_tmp" || { echo "ERROR: darwin kopia extract failed"; rm -rf "$_kopia_tmp"; exit 1; }
  _kopia_bin="$(find "$_kopia_tmp" -type f -name kopia | head -1)"
  [[ -n "$_kopia_bin" ]] || { echo "ERROR: kopia binary not found in the darwin tarball"; rm -rf "$_kopia_tmp"; exit 1; }
  cp -L "$_kopia_bin" "$SIDECAR_DIR/bin/kopia"
  chmod 755 "$SIDECAR_DIR/bin/kopia"
  rcodesign sign "$SIDECAR_DIR/bin/kopia" >/dev/null 2>&1 || { echo "ERROR: rcodesign ad-hoc sign failed for darwin kopia"; rm -rf "$_kopia_tmp"; exit 1; }
  rm -rf "$_kopia_tmp"
  echo "  kopia: cross-fetched darwin ${_kopia_ver} (${_kopia_arch}), ad-hoc signed"
  echo "kopia: cross-fetch (darwin ${_kopia_ver} ${_kopia_arch} github release)" >> "$SOURCE_NOTE_FILE"
elif [[ -x "$SIDECAR_DIR/bin/kopia" ]] && "$SIDECAR_DIR/bin/kopia" --version >/dev/null 2>&1; then
  echo "  kopia: already bundled ($("$SIDECAR_DIR/bin/kopia" --version 2>/dev/null | head -1))"
else
  _kopia_src="$(command -v kopia 2>/dev/null || true)"
  if [[ -z "$_kopia_src" ]]; then
    echo "ERROR: kopia not found on the build host — required for the bundled snapshot"
    echo "  subsystem (packages/backup/src/workspace-backup.ts). Install the static"
    echo "  binary: https://kopia.io/docs/installation/  (apt/brew install kopia)"
    exit 1
  fi
  if _is_script "$_kopia_src"; then
    echo "ERROR: kopia on PATH ($_kopia_src) is a script shim — refusing to vendor it"
    exit 1
  fi
  cp -L "$_kopia_src" "$SIDECAR_DIR/bin/kopia"
  chmod 755 "$SIDECAR_DIR/bin/kopia"
  if ! "$SIDECAR_DIR/bin/kopia" --version >/dev/null 2>&1; then
    echo "ERROR: bundled kopia fails --version probe as installed"
    exit 1
  fi
  echo "  kopia: copy ($_kopia_src) → $("$SIDECAR_DIR/bin/kopia" --version 2>/dev/null | head -1)"
  echo "kopia: copy (from system PATH) ($_kopia_src)" >> "$SOURCE_NOTE_FILE"
fi

# NOTE: zero-cache-server is no longer bundled (SP1 C5, 2026-06-06). The
# legacy opt-in spawn (PAPERCUSP_USE_ZERO_CACHE=1) was removed from the Rust
# embedder along with the rest of its PG/sidecar process management — the
# operator's /api/zero-harness/sse path (PG LISTEN/NOTIFY) replaced the Zero
# WS transport on desktop back on 2026-05-07. Saves ~50MB of bundle.

# NOTE: the legacy pglite-server is no longer bundled (removed 2026-06-01).
# embedded-postgres-server is the only desktop DB. A failed embedded-PG must
# fail LOUD (see Tauri main.rs) rather than silently degrade to a WASM
# single-connection engine with limited LISTEN/NOTIFY.

# Bundle the papercusp MCP server. Auto-registered into ~/.omp/agent/mcp.json
# on first pi spawn (pty.ts:ensurePapercuspMcpRegistered) so the LLM sees
# mcp_papercusp_* tools out of the box.
MCP_SRC="$PAPERCUSP_ROOT/packages/papercusp-mcp-server"
MCP_DST="$SIDECAR_DIR/papercusp-mcp-server"
echo "→ bundling papercusp-mcp-server"
if [[ -d "$MCP_SRC" ]]; then
  mkdir -p "$MCP_DST"
  cp "$MCP_SRC/package.json" "$MCP_DST/"
  cp -a "$MCP_SRC/src" "$MCP_DST/"
  cp -a "$MCP_SRC/bin" "$MCP_DST/"
  chmod +x "$MCP_DST/bin/papercusp-mcp-server.mjs"
  ( cd "$MCP_DST" && npm install --omit=dev --silent ) || {
    echo "WARN: failed to install MCP server deps; users won't see mcp_papercusp_* tools"
  }
fi

# node-pty's prebuilt native bindings live in
# `node_modules/@lydell/node-pty-<platform>/prebuilds/<arch>/pty.node`
# and are loaded via dynamic require — Next.js's standalone tracer
# doesn't follow that, so the .node files aren't copied. We copy them
# explicitly from the source workspace's node_modules into whichever
# platform packages exist in the bundled tree.
echo "→ patching @lydell/node-pty prebuilts (native bindings)"
# Next's tracer copies @lydell/node-pty-<plat>/lib but not the
# prebuilds/<arch>/pty.node native binary (it's loaded via dynamic
# require, see next.config.js outputFileTracingIncludes for the
# half-fix that covers /api/[[...route]]/**). We backfill from the
# operator workspace's node_modules — that's where npm actually
# installed @lydell/* — rather than the desktop repo root, which
# only depends on @tauri-apps/cli.
for pkg in $SIDECAR_DIR/node_modules/@lydell/node-pty-*/; do
  [[ -d "$pkg" ]] || continue
  pkg_name="$(basename "$pkg")"
  # WI-5651: a CROSS-FETCHED per-platform package (e.g. node-pty-darwin-x64 pulled
  # by fetch_cross_npm_pkg) ALREADY ships its prebuilds/<plat>/pty.node — and the
  # host has no source for a foreign platform anyway. If they're already present,
  # keep them (the native path still backfills the host's own package, whose
  # prebuilds Next's tracer strips — that's why the host-source copy exists).
  if find "$pkg/prebuilds" -name '*.node' 2>/dev/null | grep -q .; then
    echo "  ✓ $pkg_name: prebuilds already present ($(find "$pkg/prebuilds" -name '*.node' | wc -l) .node file(s)) — cross-fetched pkg"
    continue
  fi
  src_prebuilds=""
  for cand in \
    "$WEB_DIR/node_modules/@lydell/$pkg_name/prebuilds" \
    "$REPO_ROOT/node_modules/@lydell/$pkg_name/prebuilds" \
    "$ROOT/node_modules/@lydell/$pkg_name/prebuilds"; do
    if [[ -d "$cand" ]]; then
      src_prebuilds="$cand"
      break
    fi
  done
  if [[ -n "$src_prebuilds" ]]; then
    cp -a "$src_prebuilds" "$pkg/"
    echo "  ✓ $pkg_name ← $src_prebuilds → $(find "$pkg/prebuilds" -name '*.node' | wc -l) .node file(s)"
  elif [[ "$CROSS_BUILD" == "1" ]]; then
    # A cross bundle whose TARGET pty binding is missing would 500 on every agent
    # spawn on a clean target — fail loud rather than ship it silently broken.
    echo "ERROR: $pkg_name: no prebuilds present in the cross-fetched package AND none on the host — the target's node-pty native binding would be missing (agent PTYs 500 at module load)"
    exit 1
  else
    echo "  ⚠ $pkg_name: no prebuilds source found in any candidate path; the catch-all /api route will 500 at module load"
  fi
done

# Bundle the framework DDL files so embedded-PG first-boot init can find
# them at runtime. The Tauri main passes this dir to serve.mjs
# (PAPERCUSP_PG_SQL_DIR) which applies the schema on first boot.
echo "→ bundling framework DDL"
rm -rf "$SIDECAR_DIR/db-sql"
mkdir -p "$SIDECAR_DIR/db-sql"
cp "$PAPERCUSP_ROOT/libs/db/sql/"*.sql "$SIDECAR_DIR/db-sql/"

# WI-4419 D-004 (copy-point identity scrub): db-sql/ is a SECOND path (besides
# source.tar.zst) by which must-ship canonical source leaves the tree VERBATIM —
# the migration SQL is copied byte-for-byte, so an [owner:Avi] provenance header
# (e.g. migrations 630/631) survives to disk and is caught by this build's own
# release-privacy --scan-dir audit below (and the AppImage AppDir scan). Unlike
# the compiled .ts source (esbuild strips comments), these .sql comments ship as-
# is. Redact the SHIPPED COPY in place — NEVER the canonical working-tree source
# (that would rewrite the owner's committed authorship AND break test fixtures
# that assert on these literals) — using the gate's ONE rule
# (audit-release-bundle.py --identity-literals) as the single source of truth so
# the scrub cannot drift from what the audit later fails on. Filenames + count are
# preserved, so the WI-3047 tree-match guard below still holds. Opt out with
# PAPERCUSP_STAGE_SCRUB=0 (mirrors stage-source-tree.sh).
if [[ "${PAPERCUSP_STAGE_SCRUB:-1}" == "1" && -f "$HERE/audit-release-bundle.py" ]]; then
  declare -a _dbsql_sed=()
  # Column 4 is audit-release-bundle.py's ready-to-use portable case-folded ERE.
  # Consume it directly so this shipped-copy scrub cannot drift from the final
  # scan's case rule. Columns 1-3 remain a compatibility fallback for an older
  # audit script that does not emit the pattern yet.
  while IFS=$'\t' read -r _val _red _wb _pat; do
    [[ -z "$_val" ]] && continue
    _r="$(printf '%s' "$_red" | sed 's/[&/\]/\\&/g')"
    if [[ -n "$_pat" ]]; then
      _dbsql_sed+=(-e "s/${_pat}/${_r}/g")
    else
      _p="$(printf '%s' "$_val" | sed 's/[][\.^$*+?(){}|/]/\\&/g')"
      if [[ "$_wb" == "1" ]]; then _dbsql_sed+=(-e "s/\\b${_p}\\b/${_r}/g"); else _dbsql_sed+=(-e "s/${_p}/${_r}/g"); fi
    fi
  done < <(python3 "$HERE/audit-release-bundle.py" --identity-literals)
  _scrub_sidecar_db_sql() {
    local _scope="$1"
    shift
    (( ${#_dbsql_sed[@]} > 0 )) || return 0
    local -a _roots=()
    local _root _f
    for _root in "$@"; do
      [[ -d "$_root" ]] && _roots+=("$_root")
    done
    (( ${#_roots[@]} > 0 )) || return 0
    local _dbsql_scrubbed=0
    while IFS= read -r -d '' _f; do
      sed -E "${_dbsql_sed[@]}" "$_f" | cmp -s - "$_f" && continue
      # sed -i replaces the inode rather than mutating a preserved hardlink in
      # place, so cleaning an env overlay cannot rewrite its primary sibling.
      sed -E -i "${_dbsql_sed[@]}" "$_f"
      _dbsql_scrubbed=$((_dbsql_scrubbed+1))
    done < <(find "${_roots[@]}" -type f -name '*.sql' -print0)
    echo "    identity scrub: redacted $_dbsql_scrubbed shipped db-sql file(s) in $_scope (WI-4419 D-004)"
  }
  _scrub_sidecar_db_sql "primary sidecar" "$SIDECAR_DIR/db-sql"
fi

# WI-3047 guard: assert what we just copied EXACTLY matches the source tree at
# this instant (same count, same highest migration number) — cheap defense-in-
# depth against a partial/failed cp, a stale leftover db-sql/ from a prior
# build (hence the rm -rf above), or a future refactor that decouples this copy
# from the seed build below. Root cause of the WI-3047 incident was actually a
# STALE `libs/papercusp` SUBMODULE checkout (see the freshness check in
# release-local.sh, which is where that class is actually caught); this check
# covers the narrower "the tree itself and what got shipped disagree" case so a
# regression here is a red build, not a silent runtime error a user hits.
_tree_sql_max="$(ls "$PAPERCUSP_ROOT/libs/db/sql/"*.sql 2>/dev/null | xargs -n1 basename | grep -oE '^[0-9]+' | sort -n | tail -1)"
_tree_sql_count="$(ls "$PAPERCUSP_ROOT/libs/db/sql/"*.sql 2>/dev/null | wc -l | tr -d ' ')"
_shipped_sql_max="$(ls "$SIDECAR_DIR/db-sql/"*.sql 2>/dev/null | xargs -n1 basename | grep -oE '^[0-9]+' | sort -n | tail -1)"
_shipped_sql_count="$(ls "$SIDECAR_DIR/db-sql/"*.sql 2>/dev/null | wc -l | tr -d ' ')"
if [[ -z "$_tree_sql_max" || "$_tree_sql_max" != "$_shipped_sql_max" || "$_tree_sql_count" != "$_shipped_sql_count" ]]; then
  echo "ERROR: shipped sidecar/db-sql/ (highest=$_shipped_sql_max, count=$_shipped_sql_count) does not match"
  echo "       the source tree libs/db/sql/ (highest=$_tree_sql_max, count=$_tree_sql_count) — refusing to ship"
  echo "       a schema that could silently diverge from the tree (WI-3047)."
  exit 1
fi
echo "    ✓ shipped db-sql/ matches the tree (highest migration $_tree_sql_max, $_tree_sql_count files)"

# ── Pre-migrated PGDATA seed (desktop first-boot fast path) ─────────────────
# Boot the JUST-BUNDLED embedded-PG ONCE at build time (initdb + apply every
# migration in db-sql/), cleanly stop, and archive the resulting data dir into
# db-seed.tar.gz. On a FRESH install the Server extracts this INSTEAD of running
# the ~11s "initdb + full migration replay" (see embedded-postgres-server
# src/index.js seedPath handling — measured ~11x faster first-boot; ~13MB gz).
# Because it runs the SAME bundled binary that ships, the seed is byte-compatible
# with THIS bundle's platform by construction (no cross-arch seed hazard). It also
# doubles as a build-time gate that the full migration set applies cleanly on this
# platform. Skip with PAPERCUSP_BUILD_PG_SEED=0 (then first-boot falls back to the
# old initdb+replay path — correct, just slow).
if [[ "$CROSS_BUILD" == "1" ]]; then
  # WI-5651: the seed is built by BOOTING the just-bundled embedded-PG — which is
  # the TARGET's binary, impossible to exec on this ${_host_os} cross host (the
  # cross-swap also dropped the host's @embedded-postgres pkg). And a seed built
  # with the HOST's PG would be exactly the cross-platform PGDATA hazard the note
  # above says this step avoids "by construction". Skip it: the target machine's
  # first boot does initdb + replay (correct, ~11s slower on the FIRST launch only).
  echo "→ WI-5651 skipping pre-migrated seed (cross ${TARGET_OS}-${TARGET_ARCH} bundle — can't boot the target's PG on a ${_host_os} host); first-boot will initdb + replay migrations on the target"
elif [[ "${PAPERCUSP_BUILD_PG_SEED:-1}" == "1" ]]; then
  echo "→ building pre-migrated PGDATA seed (first-boot fast path)"
  _seed_tmp="$(mktemp -d)"
  if node "$EMBEDDED_PG_DST/bin/build-seed.mjs" \
       --data "$_seed_tmp/pgdata" \
       --sql "$SIDECAR_DIR/db-sql" \
       --out "$SIDECAR_DIR/db-seed.tar.gz" \
       --port "${PAPERCUSP_BUILD_PG_SEED_PORT:-5549}"; then
    echo "→ db-seed.tar.gz staged ($(du -h "$SIDECAR_DIR/db-seed.tar.gz" | cut -f1))"
  else
    echo "ERROR: pre-migrated seed build failed — refusing to ship a bundle without a verified schema."
    echo "  (Set PAPERCUSP_BUILD_PG_SEED=0 to intentionally ship without the first-boot fast path.)"
    rm -f "$SIDECAR_DIR/db-seed.tar.gz"
    rm -rf "$_seed_tmp"
    exit 1
  fi
  rm -rf "$_seed_tmp"
else
  echo "→ skipping pre-migrated seed (PAPERCUSP_BUILD_PG_SEED=0) — first-boot will initdb + replay migrations"
fi

# Bundle the @papercusp/locks (papercusp_su side-DB) migrations. EI-2669:
# @papercusp/locks is esbuild-BUNDLED into serve.mjs (not externalized), so its
# su-lock-store resolves SQL_DIR = dirname(import.meta.url)/sql = <sidecar>/sql.
# esbuild inlines only JS, never the package's sibling src/sql/*.sql, so without
# this copy the packaged git-sync lock infra ENOENTs on scandir '<sidecar>/sql'
# and git-sync (repo-content sync for hive members) is degraded on EVERY hive.
# These are the LOCK schema (001-bootstrap … 015-…), a distinct set from the
# framework DDL above — they must land at sidecar/sql/, NOT db-sql/.
echo "→ bundling @papercusp/locks DDL"
mkdir -p "$SIDECAR_DIR/sql"
cp "$PAPERCUSP_ROOT/packages/locks/src/sql/"*.sql "$SIDECAR_DIR/sql/"

# Bundle the sidecar preload script. Loaded via `node --require` before
# server.js to strip Node 22+'s partial localStorage stub (see file
# header for full reasoning).
echo "→ bundling sidecar preload"
cp "$ROOT/bin/sidecar-preload.js" "$SIDECAR_DIR/sidecar-preload.js"

# ---------------------------------------------------------------------------
# Bundle external binaries — node + gh.
#
# omp (Pi) is NO LONGER bundled (owner directive 2026-07-07): the desktop app
# uses the omp installed on the USER's machine. There is a first-run install
# procedure for it (setup-pty-commands buildFrameworkInstallSpec lands omp at
# ~/.papercusp/bin/omp; the onboarding wizard drives it), and both detection
# (preflight-binaries detectOmp) and launch (psu spawns bare `omp`, resolved
# via the terminal's PATH which prepends ~/.papercusp/bin + ~/.local/bin) find
# that local install. Bundling a second 485MB copy just shadowed the user's own
# and bloated the installer.
#
# code-server is NO LONGER bundled either (owner directive 2026-07-07): the app
# no longer uses the vscode-in-the-browser panel, so the ~447MB code-server
# tarball is dead weight. Its Tauri spawn is removed in main.rs.
#
# What remains bundled here: node (the sidecar runtime) + gh (git ops). We pick
# the binary matching the target platform/arch the build host is running on. CI
# runs the desktop build under `tauri build` on a matrix of macos-{14,13},
# ubuntu-22.04, and windows-2022, so each matrix leg picks the right asset.
# ---------------------------------------------------------------------------
# WI-5651: target_os/target_arch now come from the TARGET_OS/TARGET_ARCH resolved
# at the top of this script (default = host $(uname), so an un-set invocation is
# unchanged). Cross-baking a mac/windows bundle on Linux sets them; the darwin/win
# node + gh + zellij + pui fetches below already switch on these vars.
target_os="$TARGET_OS"
target_arch="$TARGET_ARCH"
echo "→ bundling external binaries for $target_os-$target_arch$([[ "$CROSS_BUILD" == "1" ]] && echo " (cross-baked on ${_host_os}-${_host_arch})")"

# BIN_DIR (historically OMP_DIR) — destination for bundled CLIs (node, gh).
# Tauri prepends this dir to the sidecar's PATH on spawn (see main.rs PATH
# munging) so the sidecar finds them without a user-side install. Hoisted here
# from below because the Node download block referenced it before its old
# in-place definition under `set -u`, killing the build with 'OMP_DIR: unbound
# variable'. Name kept as OMP_DIR to avoid churning the node/gh copy lines.
OMP_DIR="$SIDECAR_DIR/bin"
mkdir -p "$OMP_DIR"

# EI-1869: SIDECAR_DIR is a fresh `sidecar.tmp.$$` tree every single build (the
# EI-160 atomic-publish scheme above), so a same-build "already extracted"
# check inside it can never hit across builds — every rebuild re-downloaded
# Node (~118M) + gh (~38M) from scratch, ~10min of identical re-fetch on the
# edit→build→verify loop. Vendor fetched binaries into a stable,
# version-keyed cache OUTSIDE the per-build tmp tree; a version bump
# (NODE_VERSION/GH_VERSION) naturally busts its own cache slot since the key
# includes the version. Override with PAPERCUSP_SIDECAR_BIN_CACHE (e.g. to
# point CI at a persisted cache dir).
SIDECAR_BIN_CACHE="${PAPERCUSP_SIDECAR_BIN_CACHE:-$HOME/.cache/papercusp-sidecar-bins}"
mkdir -p "$SIDECAR_BIN_CACHE"

# Node.js — vendor a known-good runtime so users don't need Node on PATH.
# Tauri main spawns the sidecar + embedded-postgres-server with this binary
# explicitly (see resolve_node_bin in main.rs). Bare `node` only — we don't need npm
# at runtime, the standalone bundle has its dependencies pre-installed.
NODE_VERSION="${NODE_VERSION:-v24.15.0}"
node_dst=""
case "$target_os" in
  linux)   node_archive="node-${NODE_VERSION}-linux-${target_arch}.tar.xz" ;;
  darwin)  case "$target_arch" in
             x64)   node_archive="node-${NODE_VERSION}-darwin-x64.tar.gz" ;;
             arm64) node_archive="node-${NODE_VERSION}-darwin-arm64.tar.gz" ;;
           esac ;;
  windows) node_archive="node-${NODE_VERSION}-win-x64.zip" ;;
esac
if [[ -n "${node_archive:-}" ]]; then
  # EI-1869: cache slot keyed by version+platform (a version/arch bump ⇒ a new
  # slot ⇒ correctly re-downloads; nothing else invalidates it).
  node_cache_bin="node"
  [[ "$target_os" == "windows" ]] && node_cache_bin="node.exe"
  node_cache_dir="$SIDECAR_BIN_CACHE/node-${NODE_VERSION}-${target_os}-${target_arch}"
  if [[ -f "$node_cache_dir/$node_cache_bin" ]]; then
    cp "$node_cache_dir/$node_cache_bin" "$OMP_DIR/$node_cache_bin"
    chmod +x "$OMP_DIR/$node_cache_bin"
    node_dst="$OMP_DIR/$node_cache_bin"
    echo "  ✓ node $NODE_VERSION cached → $node_dst ($(du -h "$node_dst" | awk '{print $1}')) — skipped download"
  else
    echo "→ downloading Node $NODE_VERSION → $node_archive"
    node_tarball="/tmp/$node_archive"
    if curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${node_archive}" -o "$node_tarball"; then
      tmp_node_dir=$(mktemp -d)
      case "$node_archive" in
        *.tar.xz) tar -xJf "$node_tarball" -C "$tmp_node_dir" --strip-components=1 ;;
        *.tar.gz) tar -xzf "$node_tarball" -C "$tmp_node_dir" --strip-components=1 ;;
        *.zip)    unzip -q "$node_tarball" -d "$tmp_node_dir" && \
                   inner=$(find "$tmp_node_dir" -maxdepth 1 -mindepth 1 -type d | head -1) && \
                   mv "$inner"/* "$tmp_node_dir/" 2>/dev/null || true ;;
      esac
      if [[ -f "$tmp_node_dir/bin/node" ]]; then
        cp "$tmp_node_dir/bin/node" "$OMP_DIR/node"
        chmod +x "$OMP_DIR/node"
        node_dst="$OMP_DIR/node"
      elif [[ -f "$tmp_node_dir/node.exe" ]]; then
        cp "$tmp_node_dir/node.exe" "$OMP_DIR/node.exe"
        node_dst="$OMP_DIR/node.exe"
      fi
      rm -rf "$tmp_node_dir" "$node_tarball"
      if [[ -n "$node_dst" ]]; then
        echo "  ✓ node at $node_dst ($(du -h "$node_dst" | awk '{print $1}'))"
        # Seed the cache (best-effort; a seed failure never fails the build —
        # the next build just re-downloads).
        mkdir -p "$node_cache_dir" && cp "$node_dst" "$node_cache_dir/$node_cache_bin" 2>/dev/null || true
      else
        echo "  ⚠ node tarball extracted but no node binary found at expected path; sidecar will fall back to system node"
      fi
    else
      echo "  ⚠ failed to download Node; sidecar will fall back to system node"
    fi
  fi
fi

# gh (GitHub CLI) — single Go binary, used by harness flows that
# create/comment on GitHub PRs. cli/cli releases ship per-platform
# tarballs; we extract just `bin/gh[.exe]` into our sidecar/bin/.
GH_VERSION="${GH_VERSION:-2.92.0}"
gh_archive=""
gh_inner_dir=""
case "$target_os" in
  # gh names its linux x86_64 asset "amd64" (not "x64") — x64 404s silently.
  linux)   _gh_arch="$target_arch"; [[ "$target_arch" == "x64" ]] && _gh_arch="amd64"
           gh_archive="gh_${GH_VERSION}_linux_${_gh_arch}.tar.gz";  gh_inner_dir="gh_${GH_VERSION}_linux_${_gh_arch}" ;;
  darwin)  case "$target_arch" in
             x64)   gh_archive="gh_${GH_VERSION}_macOS_amd64.zip";   gh_inner_dir="gh_${GH_VERSION}_macOS_amd64" ;;
             arm64) gh_archive="gh_${GH_VERSION}_macOS_arm64.zip";   gh_inner_dir="gh_${GH_VERSION}_macOS_arm64" ;;
           esac ;;
  windows) gh_archive="gh_${GH_VERSION}_windows_amd64.zip";          gh_inner_dir="gh_${GH_VERSION}_windows_amd64" ;;
esac
if [[ -n "$gh_archive" ]]; then
  # EI-1869: same version-keyed cache as Node, above.
  gh_cache_bin="gh"
  [[ "$target_os" == "windows" ]] && gh_cache_bin="gh.exe"
  gh_cache_dir="$SIDECAR_BIN_CACHE/gh-${GH_VERSION}-${target_os}-${target_arch}"
  if [[ -f "$gh_cache_dir/$gh_cache_bin" ]]; then
    gh_dst="$OMP_DIR/$gh_cache_bin"
    cp "$gh_cache_dir/$gh_cache_bin" "$gh_dst"
    chmod +x "$gh_dst"
    echo "  ✓ gh $GH_VERSION cached → $gh_dst ($(du -h "$gh_dst" | awk '{print $1}')) — skipped download"
  else
    echo "→ downloading gh $GH_VERSION → $gh_archive"
    gh_tarball="/tmp/$gh_archive"
    if curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/${gh_archive}" -o "$gh_tarball"; then
      gh_tmp=$(mktemp -d)
      case "$gh_archive" in
        *.tar.gz) tar -xzf "$gh_tarball" -C "$gh_tmp" ;;
        *.zip)    unzip -q "$gh_tarball" -d "$gh_tmp" ;;
      esac
      # Find the gh binary regardless of inner dir naming quirks
      gh_src=$(find "$gh_tmp" -name "gh" -o -name "gh.exe" 2>/dev/null | head -1)
      if [[ -n "$gh_src" && -f "$gh_src" ]]; then
        gh_dst="$OMP_DIR/$(basename "$gh_src")"
        cp "$gh_src" "$gh_dst"
        chmod +x "$gh_dst"
        echo "  ✓ gh at $gh_dst ($(du -h "$gh_dst" | awk '{print $1}'))"
        # Seed the cache (best-effort; never fails the build).
        mkdir -p "$gh_cache_dir" && cp "$gh_dst" "$gh_cache_dir/$(basename "$gh_dst")" 2>/dev/null || true
      else
        echo "  ⚠ gh archive extracted but no gh binary found"
      fi
      rm -rf "$gh_tmp" "$gh_tarball"
    else
      echo "  ⚠ failed to download gh; harness GitHub-integration flows will fall back to user-installed gh"
    fi
  fi
fi

# ── better-sqlite3 darwin native (WI-5651 cross) ────────────────────────────
# Unlike the holepunch/bare *-native stack (prebuildify — ships ALL platforms in
# the npm package, so prune_foreign_prebuilds just keeps the target's), and
# unlike sharp/node-pty (sibling per-platform packages, cross-fetched above),
# better-sqlite3 is a node-gyp package: npm only produced THIS host's
# build/Release/better_sqlite3.node (a linux ELF). A darwin bundle needs the
# darwin binary or it dies at boot (it's in verify's REQUIRED_NATIVE_MODULES).
# Fetch the matching prebuilt with prebuild-install, which derives the node ABI
# from --target=$NODE_VERSION (available here, after the node bundle above).
# (Windows cross runs the sidecar under WSL with the LINUX node — its better-
# sqlite3 is correctly the linux binary — so this is darwin-only.)
if [[ "$_cross_darwin" == "1" ]]; then
  _bsq_dir="$SIDECAR_DIR/node_modules/better-sqlite3"
  if [[ -d "$_bsq_dir" ]]; then
    echo "→ WI-5651 cross-fetching better-sqlite3 darwin-${TARGET_ARCH} prebuilt (node ${NODE_VERSION}, ABI via prebuild-install)"
    rm -f "$_bsq_dir"/build/Release/*.node
    ( cd "$_bsq_dir" && npx --yes prebuild-install --platform="$TARGET_OS" --arch="$TARGET_ARCH" --target="${NODE_VERSION#v}" --runtime=node --tag-prefix=v ) \
      || { echo "ERROR: better-sqlite3 ${TARGET_OS}-${TARGET_ARCH} prebuilt fetch failed (prebuild-install). The bundle would die at boot ('Could not locate the bindings file')."; exit 1; }
    _bsq_node="$(find "$_bsq_dir" -name '*.node' 2>/dev/null | head -1)"
    [[ -n "$_bsq_node" ]] || { echo "ERROR: better-sqlite3: no *.node present after prebuild-install"; exit 1; }
    echo "  ✓ better-sqlite3 ${TARGET_OS} binding → ${_bsq_node#"$SIDECAR_DIR"/}"
  else
    echo "  ⚠ better-sqlite3 not in the sidecar closure — nothing to cross-fetch"
  fi
fi

# EI-3620 (darwin, cross-build only): vendor a relocatable git for the macOS
# sidecar. A fresh, Xcode-CLT-less Mac has only the `/usr/bin/git` STUB, which
# on non-interactive invocation prints "xcode-select: no developer tools were
# found …" and exits non-zero — so the dogfood `git clone` fails ("Setting up
# Papercusp workspace failed", found on an owner Mac VM 2026-06-25). Until this
# shipped, the wizard's only mitigations were (a) prepending /opt/homebrew/bin
# to the sidecar PATH (tool-path.ts) to find a Homebrew git, and (b) an
# actionable "run `xcode-select --install`" hint when git is genuinely absent
# (clone-github.ts git_missing) — both stay in place as the fallback for a
# native (non-cross) macOS build, which this block does not yet cover.
#
# Mechanism (verified empirically 2026-07-26 on papercup-vm-mac, see EI-3620
# thread): Homebrew's darwin git bottle (+ its only two REAL, non-
# uses_from_macos deps — pcre2 and gettext/libintl; curl+expat are
# uses_from_macos, i.e. system-provided) ships every dylib load command as a
# literal `@@HOMEBREW_PREFIX@@`/`@@HOMEBREW_CELLAR@@` placeholder TOKEN string
# (brew's own `pour` step does the substitution at real-install time) — NOT a
# baked absolute path — so the SAME WI-3314 token-rewrite mechanism already
# proven for postgresql/readline (_cross_darwin_vendor_pg_tool, generalized
# above to take a vendor-subdir arg) applies directly, reusing embedded-pg's
# already-shipped libintl when its exact/compat filename matches and falling
# back to a dedicated bin/.git-lib vendor otherwise.
#
# git's own libexec/git-core/ is Homebrew's busybox-style multi-call layout —
# ~150 of its ~183 entries are plain symlinks (mostly to ../../bin/git, a few
# to ../../bin/{git-shell,git-cvsserver,scalar}, one same-dir git-remote-https
# -> git-remote-http) — so the whole upstream bin/+libexec/git-core/+
# share/git-core/templates/ tree is copied VERBATIM (cp -a preserves the
# relative symlinks byte-identical, still valid since we preserve the same
# relative nesting depth), then every REAL (non-symlink) Mach-O anywhere in
# that copy is rewritten + ad-hoc re-signed in place; the ~30 real files that
# are shell/perl/python scripts are left untouched — gated via `file -b`
# reporting a `Mach-O` prefix, NOT `llvm-otool-18`'s own exit code: verified
# empirically that `llvm-otool-18 -h` exits 0 on a non-Mach-O input too (it
# only differs in printing "is not an object file" to stdout), so exit-code
# gating silently let a script reach rcodesign and fail the whole build.
#
# git --exec-path compiles to a hardcoded absolute Homebrew path (this bottle
# was not built with RUNTIME_PREFIX) regardless of which relocation mechanism
# is used for the dylibs, so GIT_EXEC_PATH + GIT_TEMPLATE_DIR must be set as
# env vars at spawn time — wired process-wide in tool-path.ts's
# ensureToolPathEnv() (inherited by every child spawn that doesn't override
# `env`) rather than patched into each of the ~80 individual git spawn call
# sites in the codebase.
_cross_darwin_git_keg=""
if [[ "$_cross_darwin" == "1" ]]; then
  # `file -b` gates which vendored files get Mach-O rewrite+sign below — if it's
  # missing, that gate silently degrades to "nothing looks like Mach-O" instead
  # of erroring, which would ship git's real binaries with dangling
  # @@HOMEBREW_PREFIX@@ tokens. Hard-fail now rather than discover it at runtime
  # on a clean Mac.
  command -v file >/dev/null 2>&1 || { echo "ERROR: 'file' not found on the build host — required to distinguish Mach-O binaries from scripts while vendoring git (EI-3620)"; exit 1; }
  _brew_git_ver="$(curl -fsSL "https://formulae.brew.sh/api/formula/git.json" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["versions"]["stable"])' 2>/dev/null)"
  [[ -n "$_brew_git_ver" ]] || { echo "ERROR: could not resolve git stable version from the brew formula api"; exit 1; }
  echo "  → cross: fetching git ${_brew_git_ver} darwin-${TARGET_ARCH} bottle from ghcr (no brew on ${_host_os})"
  _cross_darwin_git_keg="$(fetch_brew_keg git "$_brew_git_ver" "$TARGET_ARCH" "homebrew/core/git" "$(mktemp -d)/gitkeg")" \
    || { echo "ERROR: git darwin bottle fetch failed (see above)"; exit 1; }
  [[ -f "$_cross_darwin_git_keg/bin/git" && -d "$_cross_darwin_git_keg/libexec/git-core" ]] \
    || { echo "ERROR: git bottle keg missing bin/git or libexec/git-core ($_cross_darwin_git_keg)"; exit 1; }

  mkdir -p "$SIDECAR_DIR/bin/.git-lib"
  # pcre2 + gettext: git's only two non-uses_from_macos deps (confirmed via
  # llvm-otool-18 --dylibs-used across every Mach-O in the bottle — identical
  # dep set for git/git-shell/scalar and every libexec/git-core/* helper).
  # Vendored via the SAME readline-style -id rewrite + sign pattern used above
  # for libreadline: both dylibs' own non-system deps are libSystem/libiconv/
  # CoreFoundation/CoreServices only (all system-provided), so no recursive
  # dep-rewrite is needed — just fix each dylib's own self-reference.
  for _gd_formula in pcre2 gettext; do
    case "$_gd_formula" in
      pcre2)   _gd_expect_base="libpcre2-8.0.dylib" ;;
      gettext) _gd_expect_base="libintl.8.dylib" ;;
    esac
    # Reuse-check FIRST — cheap, and skips a whole bottle fetch when embedded-pg
    # already ships a compatible libintl (native/lib) for the server.
    if [[ -e "$SIDECAR_DIR/bin/.git-lib/$_gd_expect_base" || -e "${EMBEDDED_PG_BIN_DIR%/bin}/lib/$_gd_expect_base" ]]; then
      echo "  ✓ cross: $_gd_expect_base already available (embedded-pg native/lib or bin/.git-lib) — reusing, no fetch needed"
      continue
    fi
    _gd_ver="$(curl -fsSL "https://formulae.brew.sh/api/formula/${_gd_formula}.json" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["versions"]["stable"])' 2>/dev/null)"
    [[ -n "$_gd_ver" ]] || { echo "ERROR: could not resolve $_gd_formula stable version from the brew formula api"; exit 1; }
    echo "  → cross: fetching $_gd_formula ${_gd_ver} darwin-${TARGET_ARCH} bottle (git dep)"
    _gd_keg="$(fetch_brew_keg "$_gd_formula" "$_gd_ver" "$TARGET_ARCH" "homebrew/core/$_gd_formula" "$(mktemp -d)/${_gd_formula}keg")" \
      || { echo "ERROR: $_gd_formula darwin bottle fetch failed (see above)"; exit 1; }
    _gd_src="$(find "$_gd_keg/lib" -maxdepth 1 -name "$_gd_expect_base" ! -type l | head -1)"
    [[ -n "$_gd_src" && -f "$_gd_src" ]] || { echo "ERROR: $_gd_expect_base not found in the $_gd_formula bottle ($_gd_keg/lib)"; exit 1; }
    cp -L "$_gd_src" "$SIDECAR_DIR/bin/.git-lib/$_gd_expect_base"
    chmod 755 "$SIDECAR_DIR/bin/.git-lib/$_gd_expect_base"
    llvm-install-name-tool-18 -id "@executable_path/.git-lib/$_gd_expect_base" "$SIDECAR_DIR/bin/.git-lib/$_gd_expect_base"
    rcodesign sign "$SIDECAR_DIR/bin/.git-lib/$_gd_expect_base" >/dev/null 2>&1 \
      || { echo "ERROR: rcodesign ad-hoc sign failed for vendored $_gd_expect_base"; exit 1; }
    echo "  ✓ cross: vendored + signed $_gd_expect_base into bin/.git-lib"
  done

  echo "→ vendoring git ${_brew_git_ver} (darwin-${TARGET_ARCH}) into bin/.git-vendor"
  rm -rf "$SIDECAR_DIR/bin/.git-vendor"
  mkdir -p "$SIDECAR_DIR/bin/.git-vendor/libexec" "$SIDECAR_DIR/bin/.git-vendor/share/git-core"
  cp -a "$_cross_darwin_git_keg/bin" "$SIDECAR_DIR/bin/.git-vendor/bin"
  cp -a "$_cross_darwin_git_keg/libexec/git-core" "$SIDECAR_DIR/bin/.git-vendor/libexec/git-core"
  if [[ -d "$_cross_darwin_git_keg/share/git-core/templates" ]]; then
    cp -a "$_cross_darwin_git_keg/share/git-core/templates" "$SIDECAR_DIR/bin/.git-vendor/share/git-core/templates"
  fi

  _git_vendor_count=0
  while IFS= read -r -d '' _gv_file; do
    if file -b "$_gv_file" 2>/dev/null | grep -q '^Mach-O'; then
      _cross_darwin_vendor_pg_tool "$_gv_file" "$SIDECAR_DIR/bin/.git-lib" || exit 1
      _git_vendor_count=$((_git_vendor_count + 1))
    fi
  done < <(find "$SIDECAR_DIR/bin/.git-vendor" -type f -print0)
  echo "  ✓ cross: rewrote + signed $_git_vendor_count Mach-O binaries under bin/.git-vendor"

  # A clean Mac must find `git` on PATH without knowing the vendor layout —
  # bin/ is already the sidecar's PATH-priority dir (tool-path.ts composeToolPath
  # puts PAPERCUSP_SIDECAR_BIN first), so a plain symlink at bin/git is enough;
  # GIT_EXEC_PATH/GIT_TEMPLATE_DIR (set in tool-path.ts) point INTO .git-vendor.
  ln -sfn ".git-vendor/bin/git" "$SIDECAR_DIR/bin/git"
  [[ -e "$SIDECAR_DIR/bin/git" ]] || { echo "ERROR: bin/git symlink to .git-vendor/bin/git did not resolve"; exit 1; }
  echo "  ✓ cross: vendored git ${_brew_git_ver} — bin/git -> .git-vendor/bin/git"
fi

# MinGit-busybox (Windows only) — provides BOTH `git.exe` and a busybox-
# backed `bash.exe`, plus the small POSIX util set the harness scripts
# expect (sed, grep, sort, …). Tauri main prepends `git/cmd` and `git/usr/bin`
# to PATH on Windows so all bundled tools resolve by name.
#
# Linux ships git via the distro, so we skip vendoring there — only Windows
# (MinGit, below) and macOS (EI-3620, above) lack a reliable system git.
#
# We pin to the busybox flavor of MinGit (vs. the full MinGit) because it
# includes the POSIX shell + utils the harness needs; the regular MinGit
# strips them.
if [[ "$target_os" == "windows" ]]; then
  MINGIT_VERSION="${MINGIT_VERSION:-2.54.0}"
  MINGIT_TAG="${MINGIT_TAG:-v${MINGIT_VERSION}.windows.1}"
  mingit_asset="MinGit-${MINGIT_VERSION}-busybox-64-bit.zip"
  GIT_DIR="$SIDECAR_DIR/git"
  echo "→ downloading MinGit-busybox $MINGIT_VERSION (provides git.exe + bash.exe + POSIX utils on Windows)"
  mingit_zip="/tmp/$mingit_asset"
  if curl -fsSL "https://github.com/git-for-windows/git/releases/download/${MINGIT_TAG}/${mingit_asset}" -o "$mingit_zip"; then
    rm -rf "$GIT_DIR"
    mkdir -p "$GIT_DIR"
    unzip -q "$mingit_zip" -d "$GIT_DIR"
    rm -f "$mingit_zip"
    # MinGit-busybox bundles busybox.exe but no bash.exe — busybox
    # dispatches by argv[0], so a copy named bash.exe routes to its
    # built-in shell. The harness `run.sh` shebang and several scripts
    # need bash on PATH; this is how we satisfy that on Windows.
    if [[ -f "$GIT_DIR/mingw64/bin/busybox.exe" ]]; then
      cp "$GIT_DIR/mingw64/bin/busybox.exe" "$GIT_DIR/mingw64/bin/bash.exe"
    fi
    if [[ -f "$GIT_DIR/cmd/git.exe" && -f "$GIT_DIR/mingw64/bin/bash.exe" ]]; then
      echo "  ✓ MinGit at $GIT_DIR ($(du -sh "$GIT_DIR" | awk '{print $1}'))"
    else
      echo "  ⚠ MinGit zip extracted but cmd/git.exe + mingw64/bin/bash.exe not at expected paths"
      rm -rf "$GIT_DIR"
    fi
  else
    echo "  ⚠ failed to download MinGit; Windows builds will require user-installed Git for Windows"
  fi
fi

# omp (Pi) is NOT bundled — the desktop app uses the user's locally-installed
# omp (owner directive 2026-07-07). See the header comment above for the
# detection + launch path that finds it. meridian was decommissioned earlier
# (2026-07-06, WI-3180) for the same "use the local install, not a bundled
# copy" reason.

# code-server is NOT bundled — the vscode-in-the-browser panel is retired
# (owner directive 2026-07-07). The Tauri spawn is removed in main.rs; nothing
# reads sidecar/code-server anymore.

# Strip embedded-postgres language extensions that link to system libs we
# don't ship (libpython3.6, libperl5.26, libtcl). These are PL/Python,
# PL/Perl, PL/Tcl — none of which Papercusp uses. linuxdeploy walks every
# ELF in the sidecar during AppImage bundling and bails on missing libs.
# IMPORTANT: only strip plperl/plpython/pltcl — DO NOT strip plpgsql,
# which is the default procedural language and required for ANY pgdata
# initdb (FATAL: extension "plpgsql" is not available).
# NOTE: the glob is a SUBSTRING match (*plpython*, not plpython*) — contrib
# "bridge" extensions like ltree_plpython3.so / hstore_plperl.so / jsonb_
# plpython3.so link libpython/libperl too but are PREFIXED with the data-type
# name, not the language, so a prefix-only glob (plpython*) misses them. A
# missed one still crashes AppImage bundling the same way (WI-807 live repro:
# `ERROR: Could not find dependency: libpython3.6m.so.1.0` from
# ltree_plpython3.so, only surfaced after the plpython*-prefixed files were
# already stripped). plpgsql is safe under substring matching too — it
# contains none of plperl/plpython/pltcl as a substring.
echo "→ stripping unused PL/* extensions (plperl, plpython, pltcl) from embedded-postgres"
pl_count=0
for ext_dir in "$EMBEDDED_PG_DST/node_modules/@embedded-postgres"/*/native/share/postgresql/extension; do
  [[ -d "$ext_dir" ]] || continue
  for f in "$ext_dir"/*plperl* "$ext_dir"/*plpython* "$ext_dir"/*pltcl*; do
    [[ -e "$f" ]] || continue
    rm -f "$f"
    pl_count=$((pl_count + 1))
  done
done
for lib_dir in "$EMBEDDED_PG_DST/node_modules/@embedded-postgres"/*/native/lib/postgresql; do
  [[ -d "$lib_dir" ]] || continue
  for f in "$lib_dir"/*plperl* "$lib_dir"/*plpython* "$lib_dir"/*pltcl*; do
    [[ -e "$f" ]] || continue
    rm -f "$f"
    pl_count=$((pl_count + 1))
  done
done
echo "  removed $pl_count PL/* extension files (plpgsql preserved)"

# Strip musl-libc native binary variants. npm pulls these in as optional
# deps (e.g. @img/sharp-linuxmusl-*, @lydell/node-pty-linuxmusl-*) alongside
# the glibc variants, intended for Alpine. Our AppImage targets glibc, so
# these are dead weight AND they break linuxdeploy: it walks every ELF and
# tries to resolve its deps, but `libc.musl-x86_64.so.1` doesn't exist on
# the glibc runner, so AppImage bundling aborts with:
#   ERROR: Could not find dependency: libc.musl-x86_64.so.1
#   ERROR: Failed to deploy dependencies for existing files
#   Error [tauri_cli] failed to bundle project
# Documented in the AppImage debug arc 2026-05-01.
# NOTE: publishers spell the musl variant TWO different ways — the
# `-linuxmusl-<arch>` node-gyp-build convention (@lydell/node-pty,
# @img/sharp) AND the `linux-<arch>-musl` napi-rs convention (e.g.
# @libsql/linux-x64-musl, pulled in transitively via meridian-host's
# node_modules). A pattern that only matches the first form misses the
# second and still crashes linuxdeploy on `libc.musl-x86_64.so.1` (WI-807
# live repro: meridian-host/node_modules/@libsql/linux-x64-musl/index.node
# — "Failed to run ldd: exited with code 1"). Match "musl" anywhere in the
# dir name so both conventions (and any future variant) are caught.
echo "→ stripping musl-libc native binary variants (incompatible with glibc AppImage)"
musl_dirs=$(find "$SIDECAR_DIR" -type d -iname "*musl*" 2>/dev/null)
if [[ -n "$musl_dirs" ]]; then
  while IFS= read -r d; do
    echo "  ✗ removing $d"
    rm -rf "$d"
  done <<< "$musl_dirs"
else
  echo "  (none found)"
fi

# Seed-dump bake REMOVED — the mechanism it fed no longer exists (EI-19455334533123459).
#
# This block used to pg_dump into $SIDECAR_DIR/seed.dump, and when no dump was
# present it printed "bundle will boot empty". NOTHING has consumed seed.dump
# since the restore path was retired in self-contained-migration-baseline-2026-06-02
# (D-004), so that line described a defect that could not occur — and it had
# already misdiagnosed the seed twice by the time this was removed.
#
# Verified at removal (2026-08-03), so a future reader need not re-derive it:
#   • src-tauri/src/ contains NO seed.dump detection and NO pg_restore — the
#     comment here previously asserted the Rust main did both. It did not.
#   • startEmbeddedPostgresServer() accepts no seedDumpPath/pgRestoreBin; the
#     tombstone is at embedded-postgres-server/src/index.js:499.
#
# A fresh install now builds its schema by applying 000-baseline.sql + migrations
# directly, so an empty first boot is the DESIGNED path, not a missing seed.
# Re-introducing a build-time data seed means restoring the consumer FIRST.

# ── chat dock: pui + companion wasm + zellij 0.44.3 (cross-platform) ─────────
# The desktop chat dock runs `pui chat` (zellij hosting the pui-companion plugin).
# This was mac-ONLY (in bin/mac-vm-build.sh), so a packaged LINUX app shipped NONE
# of these → the dock was a blank pane (the pui/zellij binaries simply weren't
# bundled). Bundling them here (the shared sidecar builder, run by every platform's
# build) — OS-aware on the zellij triple — gives Linux parity. native_terminal.rs's
# cross-platform dock-env prep then puts sidecar/bin on PATH + points
# PUI_COMPANION_WASM at the bundled plugin. (linux-chat-dock-parity-2026-06-27.)
echo "→ chat dock: pui + companion wasm + zellij 0.44.3"
REPO="$(cd "$ROOT/.." && pwd)"
mkdir -p "$SIDECAR_DIR/bin"
# Resolve cargo's REAL target dir (honors CARGO_TARGET_DIR + ~/.cargo/config.toml
# `[build] target-dir` — this box redirects ALL builds to ~/.cargo-target, so the
# built binaries are NOT under <crate>/target/. Same resolution release-local.sh
# uses; empty string on failure → the standard in-crate paths below still match).
if ! CARGO_TGT="$(
  cd "$REPO/apps/tui" \
    && cargo metadata --no-deps --format-version 1 \
      | python3 -c 'import sys,json;print(json.load(sys.stdin).get("target_directory",""))'
)"; then
  # WI-40008: this probe was documented as fail-soft (the standard in-crate /
  # workspace target candidates below are valid fallbacks), but `set -e` plus
  # `pipefail` made a transient cargo-metadata error abort the ENTIRE sidecar
  # build here, with both stderr streams suppressed. Two live federation builds
  # ended exactly at the chat-dock banner as a result. Keep the failure loud,
  # then take the fallback the surrounding code has always promised.
  echo "    WARN: cargo metadata could not resolve the pui target directory — falling back to standard crate/workspace target paths" >&2
  CARGO_TGT=""
fi
# EI-20094260886633250 / WI-4736 / EI-11730 — REMAP BUILD PATHS OUT OF THE BINARIES.
# rustc bakes ABSOLUTE build paths into .rodata (panic locations, file!(), and the
# std/registry paths behind them). On 2026-08-10 that made the shipped chat-dock
# payload carry the build-box identity: `pui` held the builder's $HOME path 544
# times and pui-companion.wasm 40 times, and the AppImage identity gate correctly
# REFUSED to package (FATAL, LINUX_EXIT=1) — blocking the 0.0.14 Linux recut.
#
# `strip` DOES NOT FIX THIS, and it is the obvious wrong turn: measured on a copy,
# `strip --strip-all` removed 3MB of DWARF and left ALL 59 matching lines intact,
# because these strings live in .rodata, not in debug info. The only fix that works
# is to never bake the path — hence --remap-path-prefix at COMPILE time, applied to
# every pui/companion cargo invocation below (native, darwin-cross, and wasm).
#
# $REPO first: it is a prefix UNDER $HOME, and rustc takes the first match in order.
# Safe to set RUSTFLAGS here — no cargo config on this box sets rustflags (only
# [build] target-dir), so this overrides nothing.
_PUI_REMAP="--remap-path-prefix=$REPO=/papercusp --remap-path-prefix=$HOME=/build"

# 1. pui (apps/tui) — release build for the TARGET triple.
# Close the sidecar lock fd in the cargo subtree. RUSTC_WRAPPER may start the
# long-lived sccache server; if that daemon inherits fd 9 it keeps the flock
# alive after this builder exits and wedges stage-source-tree forever. The
# parent shell still owns fd 9, so the lock remains held for this whole build.
# WI-5651: for a cross darwin bundle, pui is a native binary — build it with
# `cargo zigbuild --target <triple>` (same zig+SDK toolchain the tauri binary
# uses), NOT the host `cargo build`, or the dock would ship a linux ELF `pui`.
_pui_rust_arch="$TARGET_ARCH"
case "$_pui_rust_arch" in x64) _pui_rust_arch="x86_64" ;; arm64) _pui_rust_arch="aarch64" ;; esac
if [[ "$CROSS_BUILD" == "1" && "$TARGET_OS" == "darwin" ]]; then
  _pui_triple="${_pui_rust_arch}-apple-darwin"
  echo "    → cross: cargo zigbuild pui for ${_pui_triple}"
  rustup target add "$_pui_triple" >/dev/null 2>&1 || true
  # WI-37553: zig lives at a PERSISTENT path now. This call site used to hardcode
  # the EPHEMERAL /tmp/zig. build-mac-cross.sh was fixed to prefer
  # ~/.papercusp/zig, but THIS site was not — so the mac leg kept dying with the
  # opaque `Failed to find zig / cannot find binary path` even after zig had been
  # installed and the "fix" was believed to be in. Resolve identically, honour the
  # same env override, and FAIL LOUDLY naming the path so the next occurrence is
  # self-diagnosing rather than a cargo-zigbuild riddle.
  _zig_dir="${PAPERCUSP_ZIG_DIR:-$HOME/.papercusp/zig}"
  [ -x "$_zig_dir/zig" ] || { [ -x /tmp/zig/zig ] && _zig_dir=/tmp/zig; }
  [ -x "$_zig_dir/zig" ] || {
    echo "    ✗ zig not found at $_zig_dir/zig (set PAPERCUSP_ZIG_DIR, or install:" >&2
    echo "      curl -sSL https://ziglang.org/download/0.13.0/zig-linux-x86_64-0.13.0.tar.xz | tar -xJ -C \"\$HOME/.papercusp\" && mv \"\$HOME/.papercusp/zig-linux-x86_64-0.13.0\" \"\$HOME/.papercusp/zig\")" >&2
    exit 1
  }
  ( exec 9>&-; cd "$REPO/apps/tui" && PATH="$_zig_dir:$PATH" SDKROOT="$HOME/.papercusp/macos-sdk/MacOSX.sdk" RUSTFLAGS="${RUSTFLAGS:-} $_PUI_REMAP" cargo zigbuild --release --target "$_pui_triple" )
  _pui_target_sub="$_pui_triple/release/pui"
else
  ( exec 9>&-; cd "$REPO/apps/tui" && RUSTFLAGS="${RUSTFLAGS:-} $_PUI_REMAP" cargo build --release )
  _pui_target_sub="release/pui"
fi
# Existence-checked candidates (NOT `find` over a maybe-missing dir — under
# `set -eo pipefail` a missing path arg makes find non-zero → exit). The resolved
# CARGO_TGT comes first (covers the target-dir redirect); then the standard
# in-crate / workspace target dirs (non-redirected boxes, e.g. the mac VM).
PUI_BIN=""
for _c in "$CARGO_TGT/$_pui_target_sub" "$REPO/apps/tui/target/$_pui_target_sub" "$REPO/target/$_pui_target_sub"; do
  [[ -f "$_c" ]] && PUI_BIN="$_c" && break
done
[[ -n "$PUI_BIN" ]] || { echo "ERROR: pui binary not found after build"; exit 1; }
cp "$PUI_BIN" "$SIDECAR_DIR/bin/pui"; chmod 755 "$SIDECAR_DIR/bin/pui"
echo "    ✓ pui → sidecar/bin/pui ($PUI_BIN)"
# 2. companion zellij plugin (wasm32-wasip1) — plugin API version-coupled to zellij 0.44.3.
rustup target add wasm32-wasip1 >/dev/null 2>&1 || true
( exec 9>&-; cd "$REPO/apps/pui-zellij-plugin" && RUSTFLAGS="${RUSTFLAGS:-} $_PUI_REMAP" cargo build --release --target wasm32-wasip1 )
WASM=""
for _c in "$CARGO_TGT/wasm32-wasip1/release/pui_companion.wasm" "$REPO/apps/pui-zellij-plugin/target/wasm32-wasip1/release/pui_companion.wasm" "$REPO/target/wasm32-wasip1/release/pui_companion.wasm"; do
  [[ -f "$_c" ]] && WASM="$_c" && break
done
[[ -n "$WASM" ]] || { echo "ERROR: companion .wasm not found after build"; exit 1; }
cp "$WASM" "$SIDECAR_DIR/pui-companion.wasm"
echo "    ✓ companion → sidecar/pui-companion.wasm ($WASM)"
# 3. zellij 0.44.3 — the plugin API is version-coupled; must match EXACTLY.
#    OS-aware triple: Linux uses the STATIC musl build (libc-independent → portable
#    across distros); macOS uses apple-darwin (matching bin/mac-vm-build.sh).
ZJ_VER=0.44.3
# WI-5651: OS/arch off TARGET_* (default host) so a cross darwin bundle fetches the
# apple-darwin zellij, not this linux host's musl build.
case "$TARGET_ARCH" in arm64) ZJ_ARCH=aarch64 ;; *) ZJ_ARCH=x86_64 ;; esac
case "$TARGET_OS" in
  linux)   ZJ_TRIPLE="${ZJ_ARCH}-unknown-linux-musl" ;;
  darwin)  ZJ_TRIPLE="${ZJ_ARCH}-apple-darwin" ;;
  *)       echo "ERROR: zellij bundling: unsupported target OS $TARGET_OS"; exit 1 ;;
esac
# The "already present" fast-path RUNS the binary (`--version`), which only works
# when the bundled zellij matches THIS host — so never trust it for a cross build
# (a stale host-platform zellij would masquerade as up-to-date and ride into the
# wrong-OS bundle). Force a fresh fetch when cross-baking.
if [[ "$CROSS_BUILD" == "0" && -x "$SIDECAR_DIR/bin/zellij" ]] && "$SIDECAR_DIR/bin/zellij" --version 2>/dev/null | grep -q "$ZJ_VER"; then
  echo "    ✓ zellij ${ZJ_VER} already present — skipping download"
else
  curl -fsSL "https://github.com/zellij-org/zellij/releases/download/v${ZJ_VER}/zellij-${ZJ_TRIPLE}.tar.gz" | tar -xz -C "$SIDECAR_DIR/bin"
  [[ -x "$SIDECAR_DIR/bin/zellij" ]] || { echo "ERROR: zellij ${ZJ_VER} (${ZJ_TRIPLE}) not fetched"; exit 1; }
  chmod 755 "$SIDECAR_DIR/bin/zellij"
  echo "    ✓ zellij ${ZJ_VER} (${ZJ_TRIPLE}) → sidecar/bin/zellij"
fi

# ── strip debug symbols from bundled native binaries ────────────────────────
# (install-size-audit 2026-07-07, owner-directed). The vendored Node ships
# UNSTRIPPED with debug_info (~117MB → ~100MB stripped, i.e. ~17MB of symbol
# table + debug_info the runtime never needs — node stack traces come from JS,
# not the C++ symbol table). gh/kopia/zellij already ship stripped by their
# release process (0 change — the pass is a no-op for them but future-proofs a
# future unstripped drop-in). Strip each in place SAFELY: back it up, strip, then
# re-probe it still runs `--version`; if the probe regresses, restore the
# unstripped copy. (pui is deliberately NOT in the list — it has no `--version`,
# so its probe can't confirm runnability; leave it untouched rather than guess.)
# Only the current build host's OS — a linux build can't strip a Mach-O and
# Windows ships no strip; the desktop is built per-platform so each platform
# strips its OWN binaries. macOS uses `-S` (debug entries only — a full strip can
# drop dyld-needed symbols) and the result is re-signed by the later
# `tauri build` bundling step (strip-then-sign).
_strip_os="$(uname -s)"
# WI-5651: a cross bundle's native binaries are for a DIFFERENT OS, so this host's
# `strip` can't touch them (a GNU strip on a Mach-O just fails; the re-probe then
# restores the unstripped copy — pure wasted churn). Skip the pass; node ships
# ~17MB unstripped and gh/kopia/zellij are already stripped by their release.
if [[ "$CROSS_BUILD" == "1" ]]; then
  echo "→ WI-5651 skipping native-binary strip pass (cross ${TARGET_OS}-${TARGET_ARCH} bundle; host strip can't strip foreign binaries)"
fi
if [[ "$CROSS_BUILD" == "0" ]] && command -v strip >/dev/null 2>&1 && [[ "$_strip_os" == "Linux" || "$_strip_os" == "Darwin" ]]; then
  _strip_flags=(); [[ "$_strip_os" == "Darwin" ]] && _strip_flags=(-S)
  echo "→ stripping debug symbols from bundled native binaries ($_strip_os)"
  _strip_saved=0
  for _sb in node gh kopia zellij; do
    _sbp="$SIDECAR_DIR/bin/$_sb"
    [[ -f "$_sbp" ]] || continue
    # Skip anything that isn't a real native executable (a wrapper/script).
    if command -v file >/dev/null 2>&1; then
      case "$(file -b "$_sbp" 2>/dev/null)" in *ELF*|*Mach-O*) ;; *) continue ;; esac
    fi
    _before=$(wc -c < "$_sbp")
    cp -a "$_sbp" "$_sbp.prestrip" || continue
    if strip "${_strip_flags[@]}" "$_sbp" 2>/dev/null && "$_sbp" --version >/dev/null 2>&1; then
      _after=$(wc -c < "$_sbp")
      _strip_saved=$((_strip_saved + _before - _after))
      rm -f "$_sbp.prestrip"
      echo "    ✓ $_sb: $((_before/1048576))MB → $((_after/1048576))MB"
    else
      # strip failed OR the stripped binary no longer runs — restore the original.
      mv -f "$_sbp.prestrip" "$_sbp"
      echo "    ⚠ $_sb: strip skipped (probe regressed) — kept unstripped"
    fi
  done
  echo "  ✓ strip pass reclaimed ~$((_strip_saved/1048576))MB"
fi

# ── release-bundle dependency verifier (WI-3315) ────────────────────────────
# Verifies the bundle against its RUNTIME CONTRACT (manifest of spawned tools,
# no script shims, linkage closure over bundle libs + base allowlist) BEFORE
# the atomic publish — a bundle that fails never replaces the last good one.
# The point: build-host probes are masked (the host has the dev deps), which
# is exactly how the pg_wrapper psql (WI-3311) and unbundled kopia (WI-3312)
# shipped broken. See the verifier's header before touching its allowlists.
"$ROOT/bin/verify-sidecar-bundle.sh" "$SIDECAR_DIR" --target-os "$TARGET_OS" --target-arch "$TARGET_ARCH"

# ── EI-160: atomic publish (P-056) ──────────────────────────────────────────
# Retire the old bundle via rename, rename the temp build into place, then
# delete the retired tree. Renames on one filesystem are atomic, so a
# concurrent reader sees only complete-old or complete-new — never the
# half-written dir the old in-place rm -rf/cp produced.
# Normalize owner-write on the whole tree: sources copied from brew kegs
# (libpq tools, pgvector dylib) arrive 0444/0555, and tauri-build's
# per-target resource copy then EACCESes overwriting its own previous
# read-only copy on every REBUILD (whack-a-mole class: pg_dumpall, then
# vector.dylib — kill it wholesale).
chmod -R u+w "$SIDECAR_DIR"

# NB: plain `mv src dst` (no GNU-only -T; BSD/macOS mv lacks it) — safe ONLY
# while the destination is absent; if it exists, mv falls into
# move-INTO-directory mode. The publish below re-checks for that (see the
# squatter guard) because "absent" is NOT guaranteed under concurrency.
OLD_DIR="$SIDECAR_FINAL_DIR.old.$$"
if [[ -d "$SIDECAR_FINAL_DIR" ]]; then
  mv "$SIDECAR_FINAL_DIR" "$OLD_DIR"
fi
# ── Preserve release-staged OVERLAY artifacts across a republish (WI-3346) ──
# stage-source-tree.sh (sidecar/source.tar.zst — the all-5-buttons dev-source
# tree) and stage-env-sidecars.sh (sidecar/env-sidecars/) add files ON TOP of a
# completed sidecar build; this script does NOT produce them. A concurrent dev
# `npm run tauri dev` (→ beforeDevCommand → this script) atomically republished
# the sidecar BETWEEN a release's stage-*.sh and its Linux tauri/appimage
# resource read, wiping source.tar.zst → the 0.0.3-alpha Linux leg died with
# "resource path 'sidecar/source.tar.zst' doesn't exist". Since this build
# didn't create the overlays, carry any present in the OUTGOING tree into the
# new one so a republish can never clobber a release mid-build. (A slim build
# that wants them gone: `rm -rf src-tauri/sidecar` first — a fresh tree has no
# OLD_DIR, so nothing is preserved.)
if [[ -d "$OLD_DIR" ]]; then
  for _overlay in source.tar.zst env-sidecars; do
    if [[ -e "$OLD_DIR/$_overlay" && ! -e "$SIDECAR_TMP_DIR/$_overlay" ]]; then
      cp -a "$OLD_DIR/$_overlay" "$SIDECAR_TMP_DIR/$_overlay" \
        && echo "→ preserved release overlay across republish: $_overlay"
    fi
  done
fi
# The preserved env overlays are copied AFTER the primary db-sql scrub above.
# They carry their own db-sql trees (and may preserve hardlinks), so scrub every
# restored environment copy at this actual copy point before stamping/publishing.
# This closes EI-20588742052141621's second path instead of relying on the late
# assembled scan to rediscover it after the expensive build has finished.
if declare -F _scrub_sidecar_db_sql >/dev/null 2>&1; then
  _scrub_sidecar_db_sql \
    "preserved env sidecars" \
    "$SIDECAR_TMP_DIR"/env-sidecars/*/db-sql
fi
# Preserved env overlays also carry serve.mjs + compiled SPA text. Scrub them at
# the actual restore point; the earlier primary-sidecar scrub cannot see bytes
# copied later from OLD_DIR.
if [[ "${PAPERCUSP_STAGE_SCRUB:-1}" == "1" && -f "$HERE/audit-release-bundle.py" \
      && -d "$SIDECAR_TMP_DIR/env-sidecars" ]]; then
  python3 "$HERE/audit-release-bundle.py" --scrub-text \
    "$SIDECAR_TMP_DIR/env-sidecars"
fi
# ── P-004 (desktop-build-hardening-tri-platform-2026-07-11): sidecar freshness
# stamp ─────────────────────────────────────────────────────────────────────
# build-windows-on-vm.sh PACKS sidecar/serve.mjs AS-IS (it never rebuilds the
# sidecar), so a stale serve.mjs — left from an older operator build — could
# ship none of the operator fixes while the cut still looked green (the
# artifact-level LABELED!=PACKED class this plan eradicates). Stamp the tree the
# packers verify against: the sha256 of the serve.mjs (+ mcp-proxy.mjs) we
# ACTUALLY built, when, and from which monorepo HEAD. Written into the TMP tree
# so the atomic publish below ships it WITH the bundle it describes. Cheap (two
# sha256 over the just-built .mjs). The Windows leg's fail-closed guard reads it
# (P-004 / D-003).
# PORTABLE hashing (WI-4223, 0.0.8 mac cut): macOS ships NO sha256sum — only
# `shasum` — and under this script's `set -eo pipefail` the bare
# `sha256sum|cut` pipeline exited 127 and killed the ENTIRE publish, silently
# (the 2>/dev/null ate bash's "command not found"), right after
# verify-sidecar-bundle: OK. A metadata stamp must NEVER kill a verified
# build: prefer sha256sum (linux), fall back to shasum -a 256 (macOS
# built-in), and yield "" (visible in the stamp JSON) rather than a death if
# neither/no file exists. EI-9905: the helper now lives in
# bin/lib/portable-sha256.sh so any OTHER script that gains a darwin
# execution path can reuse it instead of re-deriving this fix.
# shellcheck source=lib/portable-sha256.sh
source "$HERE/lib/portable-sha256.sh"
_stamp_serve_sha="$(papercusp_portable_sha256 "$SIDECAR_TMP_DIR/serve.mjs")"
_stamp_proxy_sha="$(papercusp_portable_sha256 "$SIDECAR_TMP_DIR/mcp-proxy.mjs")"
_stamp_git_head="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
{
  printf '{\n'
  printf '  "serveSha256": "%s",\n'    "${_stamp_serve_sha:-}"
  printf '  "mcpProxySha256": "%s",\n' "${_stamp_proxy_sha:-}"
  printf '  "builtAtUtc": "%s",\n'     "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "epochSec": %s,\n'         "$(date +%s)"
  printf '  "gitHead": "%s"\n'         "$_stamp_git_head"
  printf '}\n'
} > "$SIDECAR_TMP_DIR/.sidecar-build-stamp"
echo "→ wrote sidecar freshness stamp (serve.mjs ${_stamp_serve_sha:0:12}…, P-004)"

# WI-5638 recurrence guard (revised 2026-07-27 — see the copy_pkg_closure
# comment above for why the strip is no longer blanket): every runtime
# download-scratch `.cache` dir must still never reach the .deb from any
# OTHER path (a new closure entry point, the embedded-postgres/node-pty
# copies, a future package, …) — that class-level backstop stays absolute.
# The ONE exception is the transformers package's own `.cache`, which now
# deliberately CARRIES the two owner-confirmed live embedding models
# (harrier-oss + embeddinggemma); this guard still fails the build if
# anything else survives there (a stray third model, a future regression
# reintroducing the full scratch tree, …), so the exception can't silently
# widen.
_expected_cache="$SIDECAR_DIR/node_modules/@huggingface/transformers/.cache"
# `|| true` IS LOAD-BEARING — do not remove it (EI-18885442084466501).
# `grep -v` exits 1 when it filters out every line, and under this script's
# `set -euo pipefail` that non-zero status kills the whole build. The healthy
# case — no stray caches, so grep emits nothing — is therefore the case that
# died, silently and with no message, making this guard's ONLY non-fatal path
# a fatal one.
#
# It failed here rather than anywhere else because of WHERE this line sits: the
# destructive `mv "$SIDECAR_FINAL_DIR" "$OLD_DIR"` has already run, and the
# EXIT trap installed at the top then `rm -rf`s the staged tmp dir. So each run
# moved the previous sidecar aside, built a complete bundle, verified it
# ("verify-sidecar-bundle: OK"), printed its freshness stamp — and then deleted
# the result and left the tree with NO sidecar at all, worse off than before.
# The last line printed was success-shaped, so it read as a clean build.
#
# 11 orphaned sidecar.old.<pid> dirs were sitting in src-tauri/ when this was
# found: one per build that died right here. That litter had already been filed
# as a cleanup omission (EI-18882950272344248) — it is not. The script never
# reaches its cleanup because it never gets past this line.
_stray_caches=$(find "$SIDECAR_DIR/node_modules" -type d -name ".cache" 2>/dev/null \
  | { grep -v -F -x "$_expected_cache" || true; })
if [[ -n "$_stray_caches" ]]; then
  echo "FATAL: runtime .cache dir(s) found in staged sidecar node_modules — these are download scratch that must never ship (WI-5638):" >&2
  echo "$_stray_caches" >&2
  exit 1
fi
if [[ -d "$_expected_cache" ]]; then
  _unexpected_cache_entries=$(find "$_expected_cache" -mindepth 1 -maxdepth 1 ! -name 'onnx-community' 2>/dev/null)
  if [[ -n "$_unexpected_cache_entries" ]]; then
    echo "FATAL: unexpected top-level entries in the preserved transformers .cache — only onnx-community/{harrier-oss,embeddinggemma} should survive (WI-5638):" >&2
    echo "$_unexpected_cache_entries" >&2
    exit 1
  fi
  if [[ -d "$_expected_cache/onnx-community" ]]; then
    _unexpected_model_entries=$(find "$_expected_cache/onnx-community" -mindepth 1 -maxdepth 1 \
      ! -name 'harrier-oss-v1-0.6b-ONNX' ! -name 'embeddinggemma-300m-ONNX' 2>/dev/null)
    if [[ -n "$_unexpected_model_entries" ]]; then
      echo "FATAL: unexpected model dir(s) survived the transformers .cache strip — only harrier-oss + embeddinggemma are owner-confirmed live (WI-5638):" >&2
      echo "$_unexpected_model_entries" >&2
      exit 1
    fi
  fi
fi

# EI-200 epilogue (2026-07-18, gate run 20260718-000508): the destination is
# NOT guaranteed absent here — a concurrent bare `cargo build` (tauri-dev
# shells don't go through cargo-build-safe.sh) can run build.rs in the long
# window since the OLD_DIR rename (overlay cp + two sha256 stamps) and
# recreate $SIDECAR_FINAL_DIR as a placeholder skeleton. Plain mv then
# publishes sidecar/sidecar.tmp.<pid>/ NESTED inside it — a silently-corrupt
# tree the federation gate repacked into a .deb and burned a content-matrix
# RED on. Portable guard: evict a squatter just before the rename, then
# verify the publish landed flat and repair the nested shape if the race
# re-fired inside the tiny check→mv gap.
if [[ -d "$SIDECAR_FINAL_DIR" ]]; then
  echo "→ WARN: $SIDECAR_FINAL_DIR reappeared mid-publish (concurrent cargo build.rs placeholder) — evicting squatter before the publish rename"
  rm -rf "$SIDECAR_FINAL_DIR"
fi
mv "$SIDECAR_TMP_DIR" "$SIDECAR_FINAL_DIR"
_tmp_base="$(basename "$SIDECAR_TMP_DIR")"
if [[ ! -f "$SIDECAR_FINAL_DIR/serve.mjs" && -d "$SIDECAR_FINAL_DIR/$_tmp_base" ]]; then
  _squat_dir="$SIDECAR_FINAL_DIR.squat.$$"
  mv "$SIDECAR_FINAL_DIR" "$_squat_dir"
  mv "$_squat_dir/$_tmp_base" "$SIDECAR_FINAL_DIR"
  rm -rf "$_squat_dir"
  echo "→ repaired nested publish (a squatter raced the final rename)"
fi
[[ -f "$SIDECAR_FINAL_DIR/serve.mjs" ]] || { echo "FATAL: published sidecar has no serve.mjs — publish corrupted, refusing to report success" >&2; exit 1; }
rm -rf "$OLD_DIR"
SIDECAR_DIR="$SIDECAR_FINAL_DIR"

# ── Provenance (EI-19446480107603858) ────────────────────────────────────────
# Record WHAT SOURCE this sidecar was baked from, using the SAME shared emitter
# and schema as the mac/windows/linux release legs (bin/emit-build-provenance.sh)
# — no second provenance shape, so verify-provenance-parity.sh stays satisfied.
#
# WHY: the cross-build legs CONSUME a sidecar they did not build, and gated it on
# existence + arch only. Both guards are loud when it is MISSING and silent when
# it is STALE — and stale is the common case, because rebuilding it is a separate
# manual step. On 2026-08-03 (WI-3307) that shipped a bundle carrying a 9-hour-old
# operator while the bundle's OTHER half (the rsync'd source tree) was current, so
# the acceptance criteria all passed on the fresh half. Without this file the
# staleness is not merely unguarded, it is UNKNOWABLE — nothing on disk records
# when the sidecar was baked or from which commit.
#
# Non-fatal by design: a metadata emit must never kill a fully-built, verified
# sidecar (the EI-9899 lesson that produced bin/lib/portable-sha256.sh). Consumers
# treat an absent file as "cannot judge", never as a pass.
if [[ -x "$HERE/emit-build-provenance.sh" ]]; then
  PROVENANCE_GIT_ROOT="$REPO_ROOT" \
    bash "$HERE/emit-build-provenance.sh" \
      "$SIDECAR_DIR" \
      "${PAPERCUSP_DESKTOP_VERSION:-unknown}" \
      "${PAPERCUSP_BUILD_SHA:-}" \
      false \
      "$SIDECAR_DIR/serve.mjs" \
      "$SIDECAR_DIR/bin/node" \
      >/dev/null \
    || echo "→ WARN: sidecar provenance emit failed (non-fatal; consumers will report 'cannot judge')"
  # Explicit `if`, not `[[ ... ]] && echo` — a trailing AND-list leaves the block's
  # exit status at 1 when the test fails, which is a set -e footgun in a script that
  # has already done 20 minutes of work.
  if [[ -f "$SIDECAR_DIR/build-provenance.json" ]]; then
    echo "→ provenance recorded at $SIDECAR_DIR/build-provenance.json"
  fi
fi

# ── ASSEMBLED-SIDECAR IDENTITY SCAN (WI-4419, repositioned by EI-20304355477263736)
# The ultimate backstop the source.tar.zst audit structurally cannot be: it reads
# the assembled bytes that actually ship and honors NO path-exclude. It lives HERE,
# at the very end, because a scan is only as good as its position — every earlier
# position leaves whatever is copied afterwards unscanned, and 0.0.16-alpha attempt
# 5 died on exactly that (two files written after the scrub block ~2100 lines above,
# caught ~40 minutes later by the per-leg AppDir gate instead). Anything added to
# the sidecar in the future is therefore covered by construction, with no second
# place to remember to update.
#
# Release-gated (PAPERCUSP_RELEASE_AUDIT=1) exactly as before: a dev sidecar on the
# build box — whose own identity legitimately pervades its compiled binaries —
# still builds. The prune/scrub steps stay where they are, upstream of the copies
# they rewrite. Pinned by packages/operator-core/lib/release-identity-gate-ordering.test.ts.
if [[ "${PAPERCUSP_RELEASE_AUDIT:-0}" == "1" && -f "$HERE/audit-release-bundle.py" ]]; then
  echo "→ identity-scanning assembled sidecar (release gate, honors NO path-exclude)"
  if ! python3 "$HERE/audit-release-bundle.py" --scan-dir "$SIDECAR_DIR"; then
    echo "ERROR: assembled sidecar carries a sensitive/build-box identity — refusing to ship (WI-4419)."
    exit 1
  fi
  # EI-20588742052141621: the direct cross-builders consume an already-built
  # sidecar and used to have no proof that THIS final scan ever ran. Record the
  # attestation only after success. This is the sole post-scan sidecar write: it
  # rewrites one fixed-schema metadata document with no copied/input-derived text,
  # so it cannot introduce the identity-bearing payload class the scan polices.
  _release_audit_stamp="$SIDECAR_DIR/.sidecar-build-stamp"
  node - "$_release_audit_stamp" <<'NODE'
const fs = require('node:fs');
const stampPath = process.argv[2];
const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
stamp.releaseIdentityAudit = {
  schemaVersion: 1,
  passed: true,
  scanner: 'audit-release-bundle.py --scan-dir',
  passedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
};
const tmpPath = `${stampPath}.audit-attestation.tmp`;
fs.writeFileSync(tmpPath, `${JSON.stringify(stamp, null, 2)}\n`);
fs.renameSync(tmpPath, stampPath);
NODE
  echo "→ recorded release identity-audit attestation in .sidecar-build-stamp"
fi

# Compute size
total_size=$(du -sh "$SIDECAR_DIR" 2>/dev/null | awk '{print $1}')
echo "✓ sidecar built at $SIDECAR_DIR ($total_size)"
