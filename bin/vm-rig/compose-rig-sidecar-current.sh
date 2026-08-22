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
# NOTE: node_modules/ in the composed dir is a set of per-entry symlinks into
# the VM app bundle's own darwin natives. This script never touches it — it is
# composed once on the VM and survives these refreshes.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_ROOT="$(cd "$HERE/../.." && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "$DESKTOP_ROOT/.." && pwd)}"
WEB_DIR="$REPO_ROOT/apps/operator"

VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
REMOTE_DIR="${PCUSP_RIG_SIDECAR_DIR:-/Users/aviweiss/rig-sidecar-current}"
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
PROMPTS_SRC="$WEB_DIR/prompts"

for d in "$MAIN_SQL_SRC" "$LOCKS_SQL_SRC" "$PROMPTS_SRC" "$WEB_DIR/bin/bundle-host-common.sh"; do
  [ -e "$d" ] || { echo "FATAL: missing $d" >&2; exit 1; }
done
[ -x "$HERE/boot-headless-current.sh" ] || {
  echo "FATAL: $HERE/boot-headless-current.sh must be executable (tracked mode 0755)" >&2
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

# ── 4. post-conditions: the exact two failures this script exists to prevent ─
[ -e "$OUT/sql/001-bootstrap.sql" ] && [ ! -e "$OUT/sql/000-baseline.sql" ] \
  || { echo "FATAL: composed sql/ is not the locks set" >&2; exit 1; }
repo_max="$(ls "$MAIN_SQL_SRC"/*.sql | xargs -n1 basename | grep -oE '^[0-9]+' | sort -n | tail -1)"
out_max="$(ls "$OUT/db-sql"/*.sql   | xargs -n1 basename | grep -oE '^[0-9]+' | sort -n | tail -1)"
[ "$out_max" = "$repo_max" ] \
  || { echo "FATAL: composed db-sql/ at $out_max but repo is at $repo_max" >&2; exit 1; }
echo "  ✓ sql/ = locks set;  db-sql/ fresh at migration $out_max"

# ── 5. push ─────────────────────────────────────────────────────────────────
if [ "$PUSH" = "1" ]; then
  DEPLOY_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  REMOTE_STAGE="${REMOTE_DIR}.incoming.${DEPLOY_ID}"
  REMOTE_CONTROL="/tmp/papercusp-boot-headless-current.${DEPLOY_ID}.sh"
  REMOTE_STAGE_Q="$(printf '%q' "$REMOTE_STAGE")"
  REMOTE_CONTROL_Q="$(printf '%q' "$REMOTE_CONTROL")"
  echo "→ staging payload on $VM:$REMOTE_STAGE (node_modules/ untouched)"
  # The active directory is not written in place. boot-headless-current.sh
  # validates the complete stage, stops the exact recorded owner PID, swaps the
  # sibling directories atomically, and restores the backup if health fails.
  ssh "$VM" "mkdir -p $REMOTE_STAGE_Q/db-sql $REMOTE_STAGE_Q/sql $REMOTE_STAGE_Q/prompts $REMOTE_STAGE_Q/node_modules"
  rsync -a "$OUT/serve.mjs" "$VM:$REMOTE_STAGE/serve.mjs"
  rsync -a "$OUT/BUILD-STAMP.txt" "$VM:$REMOTE_STAGE/BUILD-STAMP.txt"
  rsync -a --delete "$OUT/db-sql/"  "$VM:$REMOTE_STAGE/db-sql/"
  rsync -a --delete "$OUT/sql/"     "$VM:$REMOTE_STAGE/sql/"
  rsync -a --delete "$OUT/prompts/" "$VM:$REMOTE_STAGE/prompts/"
  rsync -a --chmod=F755 "$HERE/boot-headless-current.sh" "$VM:$REMOTE_CONTROL"
  ssh "$VM" "bash $REMOTE_CONTROL_Q --stage $REMOTE_STAGE_Q --cleanup-control $REMOTE_CONTROL_Q"
  echo "→ staged deploy completed through exact-PID restart/rollback boundary"
  echo "→ verify what the far side is RUNNING (not what you think it is):"
  echo "     ssh $VM 'cat $REMOTE_DIR/BUILD-STAMP.txt; shasum -a 256 $REMOTE_DIR/serve.mjs'"
  echo "     ssh $VM 'grep -ao \"\\[sidecar\\] build [^\"\\\`]*\" $REMOTE_DIR/serve.mjs | head -1'"
  echo "   after a restart the stamp is also the first line in the sidecar log."
else
  echo "→ built locally at $OUT (not pushed)"
fi
