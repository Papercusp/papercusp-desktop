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

# --- STALE-SIDECAR GUARD (EI-18683847182779973, third occurrence 2026-07-26) ---
#
# `tauri build` does NOT rebuild the sidecar (tauri.conf.json beforeBuildCommand
# is ""), and src-tauri/sidecar/serve.mjs is an esbuild bundle that INLINES its
# vendored deps — including patched ones like hyperdht. So applying a patch to
# node_modules (and regenerating patches/*.patch) updates every SOURCE-level
# check an agent can run, while changing nothing in the artifact the rig
# actually executes.
#
# That is not a normal stale-build bug. The instrumentation a diagnostic patch
# adds reads back `undefined`, which renders as the FALSY value — which in a
# diagnostic context is usually the "nothing unusual happened" reading. So the
# run does not error and does not look odd: it produces a clean CONFIRMATION of
# whatever hypothesis predicted the falsy value. A stale bundle here does not
# lose data, it MANUFACTURES AGREEMENT.
#
# This has now nearly cost three separate investigation runs in one week, so it
# fails the build rather than warning. Escape hatch for a deliberate build with
# a knowingly-older sidecar: PAPERCUSP_ALLOW_STALE_SIDECAR=1.
SIDECAR_STAMP="$DESKTOP_DIR/src-tauri/sidecar/.sidecar-build-stamp"
if [[ -f "$SIDECAR_STAMP" && "${PAPERCUSP_ALLOW_STALE_SIDECAR:-0}" != "1" ]]; then
  STAMP_EPOCH="$(sed -n 's/.*"epochSec"[[:space:]]*:[[:space:]]*\([0-9]\+\).*/\1/p' "$SIDECAR_STAMP" | head -1)"
  if [[ -n "$STAMP_EPOCH" ]]; then
    NEWEST_PATCH=""
    NEWEST_PATCH_EPOCH=0
    while IFS= read -r -d '' p; do
      # Do NOT coerce a failed stat to epoch 0 — that would silently treat an
      # unreadable patch as "doesn't count" and defeat the exact staleness
      # check this script exists to enforce (see header). Fail outright.
      if ! pe="$(stat -c '%Y' "$p")"; then
        echo "FATAL: could not stat patch file '$p' while checking sidecar staleness." >&2
        exit 1
      fi
      if [[ "$pe" -gt "$NEWEST_PATCH_EPOCH" ]]; then
        NEWEST_PATCH_EPOCH="$pe"
        NEWEST_PATCH="$p"
      fi
    done < <(find "$REPO_DIR/patches" -maxdepth 1 -name '*.patch' -print0 2>/dev/null)

    if [[ "$NEWEST_PATCH_EPOCH" -gt "$STAMP_EPOCH" ]]; then
      echo "" >&2
      echo "FATAL: STALE SIDECAR — the bundle predates a vendored-dependency patch." >&2
      echo "" >&2
      echo "  sidecar built : $(date -u -d "@$STAMP_EPOCH" +%Y-%m-%dT%H:%M:%SZ)  ($SIDECAR_STAMP)" >&2
      echo "  newer patch   : $(date -u -d "@$NEWEST_PATCH_EPOCH" +%Y-%m-%dT%H:%M:%SZ)  ${NEWEST_PATCH#$REPO_DIR/}" >&2
      echo "" >&2
      echo "  serve.mjs INLINES its vendored deps, so this build would ship the PRE-patch" >&2
      echo "  copy. Any instrumentation the patch adds would read back \`undefined\` —" >&2
      echo "  i.e. FALSY — and a diagnostic run would silently 'confirm' whatever" >&2
      echo "  hypothesis predicted the falsy value instead of failing loudly." >&2
      echo "" >&2
      echo "  FIX:  bash bin/build-desktop-sidecar.sh   # then re-run this script" >&2
      echo "  THEN VERIFY THE ARTIFACT, not node_modules and not the .patch file:" >&2
      echo "        grep -c '<your new field>' src-tauri/sidecar/serve.mjs   # expect > 0" >&2
      echo "" >&2
      echo "  Deliberate build against an older sidecar: PAPERCUSP_ALLOW_STALE_SIDECAR=1" >&2
      echo "  Background: /internal/docs/agent-insights/stale-bundle-fabricates-diagnostic-confirmation" >&2
      echo "" >&2
      exit 4
    fi
  fi
fi

# --- BUNDLE MUTEX + PROCESS-GROUP OWNERSHIP (EI-18698595682442781) ----------
#
# The deb staging path ($CARGO_TARGET/<profile>/bundle/deb/<name>/) is a SINGLE
# FIXED directory — not per-agent, not per-PID. On this shared box several agents
# build concurrently, and two bundlers in that directory race on control/,
# md5sums and data.tar.gz: one hashes a tree the other is rewriting, a file
# vanishes mid-hash, and you get the thoroughly misleading
#   `Failed to create md5sums file: No such file or directory (os error 2)`
# which sends you hunting for filesystem debris instead of for a peer. Observed
# live 2026-07-26 with three concurrent tauri builds owned by two agents.
# Worse, a race can leave a PARTIAL .deb at the canonical output path that looks
# complete by size — and anything selecting "the newest .deb" then ships stale
# or truncated contents silently.
#
# `node_modules` has the same class of problem and got a mutex (install:safe +
# scripts/lib/fs-mutex.mjs); this path had none. We use flock here rather than
# that ESM helper to match the sibling build script (build-desktop-sidecar.sh
# already locks with flock), keeping ONE locking idiom in this script family.
#
# fd 9 is held by THIS shell for the lock's lifetime. The build runs with fd 9
# CLOSED (exec 9>&-) so that a daemonizing grandchild (sccache, node) cannot
# inherit and retain the lock after we exit — the same hazard, and the same fix,
# that test/build-desktop-sidecar-lock.test.js pins for the sidecar build.
#
# The build also runs via setsid, in its OWN process group, with a trap that
# kills that group. Without this, killing the wrapper leaves `npm run build` ->
# `tauri build` -> node ORPHANED and still writing to the shared staging dir
# (observed: ~10 minutes of a killed build continuing to corrupt a peer's).
# Note there is no safe pattern-kill alternative — a host-wide
# `pkill -f 'tauri build'` kills peers' builds and is guarded against
# (EI-18690252462401774), so owning our own process group is the only correct fix.
#
# EI-18721802836296042: the default lock path used to be a single fixed
# /tmp path regardless of CARGO_TARGET_DIR. That's correct for the common case
# (CARGO_TARGET_DIR unset, everyone sharing $HOME/.cargo-target — the whole
# reason this mutex exists), but it also means an agent who deliberately
# isolates CARGO_TARGET_DIR (the documented workaround for this exact
# collision class — see the memory note this script's own header references)
# still contends the SAME global lock as every other build on the box, even
# though their bundle dir is provably disjoint and there is no real collision
# risk. Hit live 2026-07-26: an isolated-target build queued 11+ minutes
# behind an unrelated peer's ~5h-old build on the shared default target dir,
# nearly hitting the 3600s timeout on a critical-path deb.
#
# FIX: default the lock path OFF CARGO_TARGET so it naturally follows the same
# isolation an agent already opted into — no separate env var to remember, no
# risk of eating a spurious stall/timeout just for not knowing the trick. An
# explicit PAPERCUSP_DEB_BUNDLE_LOCK still overrides this for anyone who wants
# a different scheme.
BUNDLE_LOCK="${PAPERCUSP_DEB_BUNDLE_LOCK:-$CARGO_TARGET/.deb-bundle.lock}"
BUNDLE_LOCK_WAIT="${PAPERCUSP_DEB_BUNDLE_LOCK_WAIT:-3600}"
mkdir -p "$(dirname "$BUNDLE_LOCK")"

# --- HARD BUILD TIMEOUT (EI-18721897570279658) ------------------------------
#
# BUNDLE_LOCK_WAIT above bounds how long a LOSER waits to ACQUIRE the lock —
# it does nothing to bound how long the WINNER may hold it. A build that
# wedges (hangs against a stuck toolchain, a stalled network fetch, a runaway
# linker, ...) previously squatted on the lock — and on cargo's own
# target-dir lock underneath it — for as long as the process lived, with
# nothing to reap it. Observed live 2026-07-26: an orphaned build (its
# owning work-item already closed, its own session long gone) sat at ~99% CPU
# for 5h13m with no cargo/rustc child left to explain the CPU, starving the
# next scheduled deb build behind cargo's target-dir lock and burning a real
# CPU core the whole time as phantom host load.
#
# FIX: wrap the build in `timeout` so it fails LOUDLY after a bounded duration
# instead of squatting silently — the exact same "bounded wait, fail loud"
# shape BUNDLE_LOCK_WAIT already applies to lock acquisition, just applied to
# the build's own execution. Default is generous (a clean release build here
# runs single-digit minutes) so it only fires on a genuine wedge; override
# with PAPERCUSP_DEB_BUILD_TIMEOUT_SEC for a deliberately long build (e.g. a
# cold cache on a fresh box). `--kill-after` escalates to SIGKILL if the
# build ignores the initial SIGTERM.
BUILD_TIMEOUT_SEC="${PAPERCUSP_DEB_BUILD_TIMEOUT_SEC:-3600}"

BUILD_PGID=""
stop_build_group() {
  if [ -n "$BUILD_PGID" ] && kill -0 "-$BUILD_PGID" 2>/dev/null; then
    echo "==> stopping build process group $BUILD_PGID (so it cannot orphan into the shared staging dir)" >&2
    kill -TERM "-$BUILD_PGID" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "-$BUILD_PGID" 2>/dev/null || break
      sleep 1
    done
    kill -KILL "-$BUILD_PGID" 2>/dev/null || true
  fi
}
trap stop_build_group EXIT INT TERM

exec 9>"$BUNDLE_LOCK"
if ! flock -w "$BUNDLE_LOCK_WAIT" 9; then
  echo "FATAL: timed out after ${BUNDLE_LOCK_WAIT}s waiting for the deb bundle lock ($BUNDLE_LOCK)." >&2
  echo "       Another agent is very likely mid-build against the same shared" >&2
  echo "       \$CARGO_TARGET bundle directory. Check with:" >&2
  echo "         pgrep -af 'tauri build'   # then read /proc/<pid>/environ for CLAUDE_CONFIG_DIR" >&2
  exit 5
fi
echo "==> holding deb bundle lock ($BUNDLE_LOCK)"

echo "=== building ($BUILD_CMD), bounded to ${BUILD_TIMEOUT_SEC}s ==="
set +e
setsid timeout --signal=TERM --kill-after=30 "$BUILD_TIMEOUT_SEC" bash -c 'exec 9>&-; cd "$1" && eval "$2"' _ "$DESKTOP_DIR" "$BUILD_CMD" &
BUILD_PGID=$!
wait "$BUILD_PGID"
BUILD_RC=$?
set -e
BUILD_PGID=""
if [ "$BUILD_RC" -eq 124 ] || [ "$BUILD_RC" -eq 137 ]; then
  echo "FATAL: build exceeded the ${BUILD_TIMEOUT_SEC}s timeout and was killed (rc=$BUILD_RC)." >&2
  echo "       This is very likely a WEDGED build (stuck toolchain fetch, a runaway" >&2
  echo "       linker, an orphaned process from a prior session) rather than a merely" >&2
  echo "       slow one — a clean release build here normally finishes in single-digit" >&2
  echo "       minutes. If this really is a deliberately long build (e.g. a cold cache" >&2
  echo "       on a fresh box), rerun with a larger PAPERCUSP_DEB_BUILD_TIMEOUT_SEC." >&2
  exit 6
fi
if [ "$BUILD_RC" -ne 0 ]; then
  echo "FATAL: build failed (rc=$BUILD_RC)." >&2
  echo "       If this was 'Failed to create md5sums file', suspect a CONCURRENT build" >&2
  echo "       rather than filesystem debris — but note this script now holds a mutex," >&2
  echo "       so a peer would have to be invoking 'npm run build' directly to collide." >&2
  exit "$BUILD_RC"
fi

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
