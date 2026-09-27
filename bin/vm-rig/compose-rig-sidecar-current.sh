#!/usr/bin/env bash
# compose-rig-sidecar-current.sh — build a CURRENT tower-side sidecar for the
# rig VM and (optionally) push it to ~/rig-sidecar-current on the far side.
#
# WHY THIS EXISTS (2026-07-26)
# ---------------------------
# The rig's far side runs `~/boot-headless-current.sh` → `~/rig-sidecar-current`
# rather than the installed app bundle (the installed Jul-11 mac bundle was cut
# MID-rename: it still queries harness_shared.hive*, so loadHivePubkey returns
# null, it cannot sign, and outbound federation is dead).
#
# That composed dir was originally assembled BY HAND during the 2026-07-17
# WI-4070 endgame and no composer was ever committed. Two failures followed
# directly from that gap:
#
#   1. It went STALE. By 2026-07-26 its db-sql/ was at migration 614 while the
#      repo was at 674 — 60 behind. `bin/hive-git-drill.sh`'s own freshness
#      guard exists precisely because a stale bundle produces a MISLEADING
#      "relation does not exist" mid-leg failure that looks like a pot-git
#      regression (that is how WI-3969 was filed: 18 behind, no real defect).
#
#   2. It was composed WRONG. `sql/` received the MAIN migration set instead of
#      the ~21-file locks set, which killed file-locking rig-wide
#      (EI-18738657041884511) — see the TWO SQL DIRS note below.
#
# TWO SQL DIRS — DO NOT SWAP THEM (this is the subtle one)
# --------------------------------------------------------
#   db-sql/  MAIN papercusp migrations (000-baseline + NNN-*). Consumed by
#            serve's embedded-PG boot runner via PAPERCUSP_PG_SQL_DIR.
#   sql/     The @papercusp/locks migration set (001-bootstrap … 0NN-*), applied
#            to the `papercusp_su` SIDE-database.
#
# `su-lock-store.ts` resolves its SQL_DIR as `dirname(import.meta.url)/sql`. In
# an esbuild single-file bundle EVERY inlined module shares serve.mjs's OWN
# import.meta.url (build-desktop-sidecar.sh documents this; it is also why
# EI-650's __PAPERCUSP_BUNDLED_SIDECAR__ define exists). So `<bundle dir>/sql`
# IS the locks migration set — whatever you put there is what gets applied to
# papercusp_su. The main set lands there ⇒ 000-baseline.sql is applied to a DB
# created by a bare CREATE DATABASE (template1, NO extensions) ⇒ it dies on
# `type "public.vector" does not exist`, the txn rolls back, ensureBootstrap()
# throws, and every lock call fails rig-wide behind ONE log line.
#
# USAGE
#   bin/vm-rig/compose-rig-sidecar-current.sh            # build + staged deploy
#   bin/vm-rig/compose-rig-sidecar-current.sh --no-push  # build locally only
#   PCUSP_VM_SSH=user@host bin/vm-rig/compose-rig-sidecar-current.sh
#
# Native dependencies remain links into the installed app. The externalized
# embedded-postgres-server JS package is refreshed as part of each payload;
# the launcher first detaches linked containers in its private candidate.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_ROOT="$(cd "$HERE/../.." && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$DESKTOP_ROOT/.." && pwd)}"
WEB_DIR="$REPO_ROOT/apps/operator"

VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
REMOTE_DIR="${PCUSP_RIG_SIDECAR_DIR:-/Users/aviweiss/rig-sidecar-current}"
REMOTE_HOME="${PCUSP_RIG_HOME:-/Users/aviweiss}"
REMOTE_SERVICE_USER="${PCUSP_RIG_SERVICE_USER:-aviweiss}"
REMOTE_LAUNCHER="${PCUSP_RIG_CURRENT_LAUNCHER:-${REMOTE_HOME}/.papercusp/vm-rig/boot-headless-current.sh}"
REMOTE_LAUNCHER_DIR="$(dirname "$REMOTE_LAUNCHER")"
REMOTE_LAUNCHD_DIR="${PCUSP_RIG_LAUNCHD_DIR:-${REMOTE_HOME}/.papercusp/vm-rig/launchd}"
# Staging dir for the composed bundle, rsynced to $REMOTE_DIR below. It is pure
# build OUTPUT and MUST NOT default inside the repo: it used to default to
# $REPO_ROOT/.rig-sidecar-current, where git-sync's blanket `git add -A` committed
# 762 files of it on 2026-07-26 (a 58MB esbuild bundle + verbatim copies of all
# ~549 db-sql migrations + the prompts tree). The 58MB bundle then tripped the
# pot-git publish guard's secrets scan, which FROZE ALL GIT EGRESS for this device
# for ~3h — "nothing this device commits is reaching peers or origin" — because
# the guard re-judges the same range until the offending content leaves it.
# .gitignore also covers the old path, but defaulting OUT out of the tree is the
# real fix: nothing regenerable should be written into a shared working tree.
OUT="${PCUSP_RIG_COMPOSE_OUT:-${XDG_CACHE_HOME:-$HOME/.cache}/papercusp/rig-sidecar-current}"

PUSH=1
[ "${1:-}" = "--no-push" ] && PUSH=0

MAIN_SQL_SRC="$REPO_ROOT/libs/papercusp/libs/db/sql"
LOCKS_SQL_SRC="$REPO_ROOT/libs/papercusp/packages/locks/src/sql"
EMBEDDED_PG_SRC="$REPO_ROOT/libs/papercusp/packages/embedded-postgres-server"
PROMPTS_SRC="$WEB_DIR/prompts"

for d in "$MAIN_SQL_SRC" "$LOCKS_SQL_SRC" "$EMBEDDED_PG_SRC/src" "$EMBEDDED_PG_SRC/bin" "$EMBEDDED_PG_SRC/package.json" "$PROMPTS_SRC" "$WEB_DIR/bin/bundle-host-common.sh"; do
  [ -e "$d" ] || { echo "FATAL: missing $d" >&2; exit 1; }
done
[ -x "$HERE/boot-headless-current.sh" ] || {
  echo "FATAL: $HERE/boot-headless-current.sh must be executable (tracked mode 0755)" >&2
  exit 1
}
[ -r "$HERE/seed-resource-root.sh" ] || {
  echo "FATAL: $HERE/seed-resource-root.sh is required by the current-payload launcher" >&2
  exit 1
}

# --- sanity: the two sources must NOT be the same shape (catches a bad edit here)
[ -e "$LOCKS_SQL_SRC/001-bootstrap.sql" ] || { echo "FATAL: $LOCKS_SQL_SRC is not the locks set (no 001-bootstrap.sql)" >&2; exit 1; }
[ -e "$MAIN_SQL_SRC/000-baseline.sql" ]   || { echo "FATAL: $MAIN_SQL_SRC is not the main set (no 000-baseline.sql)" >&2; exit 1; }

mkdir -p "$OUT"

# ── 1. esbuild serve.ts → serve.mjs, using the SHARED recipe ────────────────
# Sourced (not duplicated) so a host-graph change can never leave the rig
# bundle on a different esbuild boundary than the packaged sidecar.
# shellcheck source=/dev/null
source "$WEB_DIR/bin/bundle-host-common.sh"
HOST_EXTERNALS=(
  "${HOST_COMMON_EXTERNALS[@]}"
  # The rig VM is darwin — but embedded-postgres/dist/binary.js dynamic-imports
  # EVERY platform, and this build host only has its own installed. Externalize
  # ALL of them (plus the server wrapper): on the VM they resolve out of the
  # composed node_modules symlinks into the app bundle's darwin natives.
  --external:@embedded-postgres/darwin-arm64
  --external:@embedded-postgres/darwin-x64
  --external:@embedded-postgres/linux-arm
  --external:@embedded-postgres/linux-arm64
  --external:@embedded-postgres/linux-ia32
  --external:@embedded-postgres/linux-ppc64
  --external:@embedded-postgres/linux-x64
  --external:@embedded-postgres/windows-x64
  --external:@papercusp/embedded-postgres-server
)
for np in "${NATIVE_PKGS[@]}"; do HOST_EXTERNALS+=( "--external:$np" ); done

# ── 1a. BUILD STAMP (EI-18781869842495729) ──────────────────────────────────
# WHY: this bundle is minified and git-sync EXCLUDES it, so "does the deployed
# process contain fix X?" was answerable only by grepping serve.mjs for marker
# strings and then reasoning about what esbuild preserves. That reasoning is a
# trap: a PROPERTY (`state.drainWaiters`) survives minification while a
# module-local FUNCTION (`flushDrainWaiters`) is renamed away — so the same fix
# reads as "present" or "absent" depending purely on which identifier you
# happened to grep. On 2026-07-27 that produced a CONFIDENTLY WRONG attribution
# claim ("converged on fix A alone") that reached a `confidence: verified` fact
# and a work-item completion record before being caught.
#
# `composedAt` is the field that actually settles it: compare it against the
# mtime of the source file carrying your fix. No string archaeology.
# Do NOT mutate HOST_BANNER itself — it is shared with the packaged sidecar.
BUILD_SHA="$(cd "$REPO_ROOT" && git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
BUILD_DIRTY=0
[ -n "$(cd "$REPO_ROOT" && git status --porcelain 2>/dev/null | head -1)" ] && BUILD_DIRTY=1
COMPOSED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BUILD_STAMP="sha=$BUILD_SHA dirty=$BUILD_DIRTY composedAt=$COMPOSED_AT"
# Single-quoted JS string; the stamp is [0-9a-z=:.TZ -] only, so it cannot break out.
STAMP_BANNER="${HOST_BANNER}console.log('[sidecar] build ${BUILD_STAMP}');"

echo "→ esbuild-bundling serve entry → $OUT/serve.mjs"
echo "  build stamp: $BUILD_STAMP"
( cd "$WEB_DIR" && npx --yes esbuild@0.25.0 bin/serve.ts \
    --bundle --platform=node --format=esm --target=node22 \
    "${HOST_EXTERNALS[@]}" \
    --outfile="$OUT/serve.mjs" \
    --banner:js="$STAMP_BANNER" \
    --define:__PAPERCUSP_BUNDLED_SIDECAR__=true )
[ -s "$OUT/serve.mjs" ] || { echo "FATAL: esbuild produced no serve.mjs" >&2; exit 1; }

bundle_host_workers "$REPO_ROOT" "$OUT" || exit 1
cp "$REPO_ROOT/packages/operator-core/lib/systemd-scope-env-runner.mjs" "$OUT/"

# Sidecar stamp file: lets you answer the question with a `cat` instead of
# grepping a 61MB minified file, and the sha256 proves the far side's serve.mjs
# is byte-identical to what was built here (catches a truncated/partial rsync).
SERVE_SHA256="$(sha256sum "$OUT/serve.mjs" | cut -d' ' -f1)"
printf '%s\nserveSha256=%s\nserveBytes=%s\n' \
  "$BUILD_STAMP" "$SERVE_SHA256" "$(wc -c < "$OUT/serve.mjs" | tr -d ' ')" \
  > "$OUT/BUILD-STAMP.txt"

# Post-condition: the stamp must be REACHABLE in the artifact, or the whole
# point is lost silently (this is the recurrence guard for the bug above).
grep -aq "\[sidecar\] build sha=$BUILD_SHA" "$OUT/serve.mjs" \
  || { echo "FATAL: build stamp missing from composed serve.mjs" >&2; exit 1; }

# ── 2. the two sql dirs (see the note at the top) ───────────────────────────
echo "→ db-sql/  ← MAIN migrations   ($(ls "$MAIN_SQL_SRC"/*.sql | wc -l | tr -d ' ') files)"
rm -rf "$OUT/db-sql"; mkdir -p "$OUT/db-sql"; cp -a "$MAIN_SQL_SRC"/. "$OUT/db-sql/"
echo "→ sql/     ← LOCKS migrations  ($(ls "$LOCKS_SQL_SRC"/*.sql | wc -l | tr -d ' ') files)"
rm -rf "$OUT/sql";    mkdir -p "$OUT/sql";    cp -a "$LOCKS_SQL_SRC"/. "$OUT/sql/"

# ── 3. prompts ──────────────────────────────────────────────────────────────
echo "→ prompts/"
rm -rf "$OUT/prompts"; cp -a "$PROMPTS_SRC" "$OUT/prompts"

# The serve bundle externalizes @papercusp/embedded-postgres-server so its
# platform-native binaries resolve from the installed app's node_modules. The
# JS package itself remains part of the runtime contract: the current
# operator imports migration-runner.js directly. Refresh its source in the
# staged payload while leaving the VM's native dependency tree intact.
echo "→ embedded-postgres-server JS sources"
rm -rf "$OUT/node_modules/@papercusp/embedded-postgres-server"
mkdir -p "$OUT/node_modules/@papercusp/embedded-postgres-server"
cp "$EMBEDDED_PG_SRC/package.json" "$OUT/node_modules/@papercusp/embedded-postgres-server/"
cp -a "$EMBEDDED_PG_SRC/src" "$OUT/node_modules/@papercusp/embedded-postgres-server/src"
cp -a "$EMBEDDED_PG_SRC/bin" "$OUT/node_modules/@papercusp/embedded-postgres-server/bin"
# ── 4. post-conditions: the exact two failures this script exists to prevent ─
[ -e "$OUT/sql/001-bootstrap.sql" ] && [ ! -e "$OUT/sql/000-baseline.sql" ] \
  || { echo "FATAL: composed sql/ is not the locks set" >&2; exit 1; }
repo_max="$(ls "$MAIN_SQL_SRC"/*.sql | xargs -n1 basename | grep -oE '^[0-9]+' | sort -n | tail -1)"
out_max="$(ls "$OUT/db-sql"/*.sql   | xargs -n1 basename | grep -oE '^[0-9]+' | sort -n | tail -1)"
out_count="$(find "$OUT/db-sql" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
[ "$out_max" = "$repo_max" ] \
  || { echo "FATAL: composed db-sql/ at $out_max but repo is at $repo_max" >&2; exit 1; }
printf 'dbSqlHighest=%s\ndbSqlCount=%s\n' "$out_max" "$out_count" >> "$OUT/BUILD-STAMP.txt"

# EI-20225452142754784: the old physical deploy copied directories with ad-hoc
# rsync commands and validated only local source shape. A trailing-slash mistake
# could leave the remote db-sql/ directory empty while placing its contents at
# the staging root; an already-migrated database could still boot, permanently
# publishing a payload that fails on the next fresh install. Bind every staged
# file to a deterministic manifest and stamp the migration shape. The remote
# installer verifies BOTH before it can swap the active sibling directory.
(
  cd "$OUT"
  manifest_tmp="PAYLOAD-MANIFEST.sha256.tmp.$$"
  find serve.mjs "${HOST_WORKER_OUTPUTS[@]}" systemd-scope-env-runner.mjs BUILD-STAMP.txt db-sql sql prompts \
    node_modules/@papercusp/embedded-postgres-server/package.json \
    node_modules/@papercusp/embedded-postgres-server/src \
    node_modules/@papercusp/embedded-postgres-server/bin \
    -type f -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum > "$manifest_tmp"
  mv -f "$manifest_tmp" PAYLOAD-MANIFEST.sha256
)
echo "  ✓ sql/ = locks set; db-sql/ fresh at migration $out_max ($out_count files); payload manifest sealed"

# ── 5. push ─────────────────────────────────────────────────────────────────
if [ "$PUSH" = "1" ]; then
  DEPLOY_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  REMOTE_STAGE="${REMOTE_DIR}.incoming.${DEPLOY_ID}"
  REMOTE_STAGE_Q="$(printf '%q' "$REMOTE_STAGE")"
  REMOTE_DIR_Q="$(printf '%q' "$REMOTE_DIR")"
  REMOTE_HOME_Q="$(printf '%q' "$REMOTE_HOME")"
  REMOTE_LAUNCHER_Q="$(printf '%q' "$REMOTE_LAUNCHER")"
  REMOTE_LAUNCHER_DIR_Q="$(printf '%q' "$REMOTE_LAUNCHER_DIR")"
  REMOTE_LAUNCHD_DIR_Q="$(printf '%q' "$REMOTE_LAUNCHD_DIR")"
  REMOTE_SERVICE_USER_Q="$(printf '%q' "$REMOTE_SERVICE_USER")"
  REMOTE_INSTALLER_Q="${REMOTE_LAUNCHD_DIR_Q}/install-launchdaemon.sh"
  echo "→ staging payload on $VM:$REMOTE_STAGE (native node_modules/ untouched)"
  # The active directory is not written in place. boot-headless-current.sh
  # validates the complete stage, stops the exact recorded owner PID, swaps the
  # sibling directories atomically, and restores the backup if health fails.
  ssh "$VM" "mkdir -p $REMOTE_STAGE_Q/db-sql $REMOTE_STAGE_Q/sql $REMOTE_STAGE_Q/prompts $REMOTE_STAGE_Q/node_modules $REMOTE_LAUNCHD_DIR_Q $REMOTE_LAUNCHER_DIR_Q"
  rsync -a "$OUT/serve.mjs" "$VM:$REMOTE_STAGE/serve.mjs"
  for runtime_sibling in "${HOST_WORKER_OUTPUTS[@]}" systemd-scope-env-runner.mjs; do
    rsync -a "$OUT/$runtime_sibling" "$VM:$REMOTE_STAGE/$runtime_sibling"
  done
  rsync -a "$OUT/BUILD-STAMP.txt" "$VM:$REMOTE_STAGE/BUILD-STAMP.txt"
  rsync -a "$OUT/PAYLOAD-MANIFEST.sha256" "$VM:$REMOTE_STAGE/PAYLOAD-MANIFEST.sha256"
  rsync -a --delete "$OUT/db-sql/"  "$VM:$REMOTE_STAGE/db-sql/"
  rsync -a --delete "$OUT/sql/"     "$VM:$REMOTE_STAGE/sql/"
  rsync -a --delete "$OUT/prompts/" "$VM:$REMOTE_STAGE/prompts/"
  ssh "$VM" "mkdir -p $REMOTE_STAGE_Q/node_modules/@papercusp/embedded-postgres-server"
  rsync -a --delete "$OUT/node_modules/@papercusp/embedded-postgres-server/" \
    "$VM:$REMOTE_STAGE/node_modules/@papercusp/embedded-postgres-server/"
  rsync -a --chmod=F755 "$HERE/boot-headless-current.sh" "$VM:$REMOTE_LAUNCHER"
  # The launcher sources this sibling at runtime. Keep the helper in the same
  # install transaction; omitting it makes the launcher continue without the
  # resolver under `set -uo pipefail`, silently falling back to no seed.
  rsync -a --chmod=F755 "$HERE/seed-resource-root.sh" "$VM:$REMOTE_LAUNCHER_DIR/seed-resource-root.sh"
  rsync -a --chmod=F755 "$DESKTOP_ROOT/src-tauri/launchd/install-launchdaemon.sh" "$VM:$REMOTE_LAUNCHD_DIR/install-launchdaemon.sh"
  rsync -a "$DESKTOP_ROOT/src-tauri/launchd/com.papercusp.server.plist.template" "$VM:$REMOTE_LAUNCHD_DIR/com.papercusp.server.plist.template"
  rsync -a "$DESKTOP_ROOT/src-tauri/launchd/com.papercusp.server.current.plist.template" "$VM:$REMOTE_LAUNCHD_DIR/com.papercusp.server.current.plist.template"

  # Stop the old GUI supervisor before touching launchd. It predates the
  # LaunchDaemon-aware deferral and can relaunch the stale installed Server
  # bundle while the current payload is being swapped.
  ssh "$VM" "PAPERCUSP_RIG_HOME=$REMOTE_HOME_Q PAPERCUSP_RIG_SIDECAR_DIR=$REMOTE_DIR_Q bash $REMOTE_LAUNCHER_Q --quiesce-gui"
  # Quiesce the system job before the atomic swap. Otherwise launchd can
  # interpret the deploy's exact-PID stop as a crash and respawn the old payload
  # into the same port/embedded-Postgres boundary while the swap is in flight.
  ssh "$VM" "sudo -n $REMOTE_INSTALLER_Q --bootout-only"
  # The old GUI may already have left a Server.app process behind. Once its
  # LaunchDaemon owner is booted out, stop only a PID proven to map to the exact
  # installed Server bundle; the helper fails closed if identity is uncertain.
  ssh "$VM" "PAPERCUSP_RIG_HOME=$REMOTE_HOME_Q PAPERCUSP_RIG_SIDECAR_DIR=$REMOTE_DIR_Q bash $REMOTE_LAUNCHER_Q --quiesce-server"
  if ! ssh "$VM" "PAPERCUSP_RIG_HOME=$REMOTE_HOME_Q PAPERCUSP_RIG_SIDECAR_DIR=$REMOTE_DIR_Q bash $REMOTE_LAUNCHER_Q --stage $REMOTE_STAGE_Q"; then
    echo "FATAL: staged deploy failed; restoring current-payload LaunchDaemon around the rollback payload" >&2
    ssh "$VM" "sudo -n $REMOTE_INSTALLER_Q --user $REMOTE_SERVICE_USER_Q --current-payload $REMOTE_DIR_Q --current-launcher $REMOTE_LAUNCHER_Q" || true
    exit 1
  fi

  # Bind LaunchDaemon identity to the exact source SHA stamped into the payload.
  # Without this explicit handoff, current-payload install re-reads the short
  # `sha=` stamp only after the atomic swap, but the installer invocation that
  # follows the deploy has no build identity in its command envelope and refuses
  # to supervise the fresh payload (leaving the detached fallback alive but the
  # persistent service uninstalled).
  if ! ssh "$VM" "sudo -n $REMOTE_INSTALLER_Q --user $REMOTE_SERVICE_USER_Q --current-payload $REMOTE_DIR_Q --current-launcher $REMOTE_LAUNCHER_Q --build-sha $BUILD_SHA --build-version 0.0.0"; then
    echo "FATAL: LaunchDaemon install/identity verification failed; restoring bounded detached service" >&2
    ssh "$VM" "PAPERCUSP_RIG_HOME=$REMOTE_HOME_Q PAPERCUSP_RIG_SIDECAR_DIR=$REMOTE_DIR_Q bash $REMOTE_LAUNCHER_Q" || true
    exit 1
  fi
  echo "→ staged deploy completed and system/com.papercusp.server now supervises the exact current payload"
  echo "→ verify what the far side is RUNNING (not what you think it is):"
  echo "     ssh $VM 'cat $REMOTE_DIR/BUILD-STAMP.txt; shasum -a 256 $REMOTE_DIR/serve.mjs'"
  echo "     ssh $VM 'grep -ao \"\\[sidecar\\] build [^\"\\\`]*\" $REMOTE_DIR/serve.mjs | head -1'"
  echo "   after a restart the stamp is also the first line in the sidecar log."
else
  echo "→ built locally at $OUT (not pushed)"
fi
