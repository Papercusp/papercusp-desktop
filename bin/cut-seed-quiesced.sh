#!/usr/bin/env bash
# cut-seed-quiesced.sh — cut a fresh sparse release seed while the local
# papercusp-bg-host is QUIESCED, with the quiesce made tamper-evident.
#
# Lineage: the /tmp/p101-seed-cut.sh wrapper used for the P-101 seed cuts
# (endgame plan p2p-public-release-endgame-2026-09-01, WI-2039869). Cut #4
# (2026-09-01) survived a PEER's `dev:restart {target:'bg-host'}` mid-cut only
# because cut-seed-cli holds the corestore fd-lock — bg-host came back up,
# logged `boot_fail harness=papercusp File descriptor could not be locked` every
# ~4 min, and the single-primary alarm kept luring agents into restarting it
# (WI-2140796 / EI-22090984621328730). This wrapper closes that hole:
#
#   1. stop bg-host, then `systemctl --user mask --runtime` it for the cut's
#      duration — a peer `systemctl start` / dev:restart now FAILS LOUDLY with
#      "Unit papercusp-bg-host.service is masked" instead of silently
#      un-quiescing (the mask lives in /run, so it cannot outlive a reboot);
#   2. publish a quiesce marker (pid, reason, since) that tooling / peers can
#      read before touching bg-host;
#   3. the EXIT trap unmasks BEFORE it starts bg-host, so the guard is removed
#      on every exit path the shell can see (rc≠0, TERM, INT, HUP).
#
# ⚠ If this wrapper is SIGKILLed the trap never runs and the runtime mask
#   persists until reboot. Recovery (one line):
#     systemctl --user unmask --runtime papercusp-bg-host.service && systemctl --user start papercusp-bg-host.service
#
# ⚠ Never edit this file (or the /tmp copy) WHILE a cut is running — bash reads
#   scripts incrementally, so an in-place edit corrupts the running instance.
#
# Cuts to $OUT under /tmp (NEVER the committed seed dir — wipe-on-abort
# isolation); rsync into papercusp-desktop/src-tauri/seed is a separate,
# git-sync-locked step (see WI-2039869 checkpoint).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
M="${PAPERCUSP_REPO_ROOT:-$(cd "$HERE/../.." && pwd)}"
OUT="${SEED_CUT_OUT:-/tmp/p101-seed-fresh}"
LOG="${SEED_CUT_LOG:-/tmp/p101-seed-cut.log}"
UNIT="${SEED_CUT_BG_HOST_UNIT:-papercusp-bg-host.service}"
IDENTITY_ENV="${PAPERCUSP_RELEASE_IDENTITY_ENV:-$HOME/.papercusp/release-identity.env}"
WORKSPACE_ID="${SEED_CUT_WORKSPACE_ID:-papercusp-workspace}"
HIVE="${SEED_CUT_HIVE:-papercusp}"
ORIGIN="${SEED_CUT_ORIGIN:-https://github.com/Papercusp/papercup}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
MARKER="$RUNTIME_DIR/papercusp-seed-cut.quiesce"

exec >>"$LOG" 2>&1
echo "=== seed cut start $(date -u +%FT%TZ) (wrapper pid $$) ==="

MASKED=0
release_quiesce() {
  local rc=$?
  trap - EXIT TERM INT HUP
  if [ "$MASKED" = 1 ]; then
    systemctl --user unmask --runtime "$UNIT"
    echo "=== $UNIT unmask rc=$? at $(date -u +%FT%TZ) ==="
  fi
  rm -f "$MARKER"
  systemctl --user start "$UNIT"
  echo "=== $UNIT start rc=$? at $(date -u +%FT%TZ) ==="
  exit "$rc"
}
trap release_quiesce EXIT TERM INT HUP

# --- quiesce -----------------------------------------------------------------
systemctl --user stop "$UNIT"
sleep 5
ACT="$(systemctl --user is-active "$UNIT")"
if [ "$ACT" = "active" ]; then
  echo "FATAL: $UNIT still active after stop — aborting (no cut attempted)"
  exit 7
fi
systemctl --user mask --runtime "$UNIT" || { echo "FATAL: could not mask $UNIT"; exit 8; }
MASKED=1
EN="$(systemctl --user is-enabled "$UNIT" 2>/dev/null || true)"
case "$EN" in
  masked|masked-runtime) ;;
  *) echo "FATAL: $UNIT is-enabled=$EN after mask (expected masked-runtime) — aborting"; exit 8 ;;
esac
printf '{"pid":%d,"unit":"%s","reason":"release seed cut — corestore fd-lock held by cut-seed-cli; do NOT start/restart bg-host","since":"%s","log":"%s"}\n' \
  "$$" "$UNIT" "$(date -u +%FT%TZ)" "$LOG" >"$MARKER"
echo "$UNIT quiesced (state=$ACT, is-enabled=$EN, marker=$MARKER) at $(date -u +%FT%TZ)"

# --- cut ---------------------------------------------------------------------
rm -rf "$OUT"
cd "$M/apps/operator" || exit 1
set -a
[ -f ./.env.local ] && . ./.env.local
# EI-22086776666843792: the projection scrub + the cut-time identity guard hunt the SAME
# literal set the build gate hunts (audit-release-bundle.py --identity-literals), and that
# set is only complete with the owner identity the build script also sources. Cut #3 ran
# without it and passed its guard on 5 build-box literals while the seed carried the handle.
if [ -f "$IDENTITY_ENV" ]; then . "$IDENTITY_ENV"; fi
set +a
if [ -z "${PAPERCUSP_RELEASE_OWNER_NAME:-}" ] || [ -z "${PAPERCUSP_RELEASE_OWNER_EMAIL:-}" ]; then
  echo "FATAL: $IDENTITY_ENV did not supply PAPERCUSP_RELEASE_OWNER_NAME/EMAIL — refusing to cut without the release literal set"; exit 11
fi
echo "=== release literal set armed: $(python3 "$M/papercusp-desktop/bin/audit-release-bundle.py" --identity-literals | wc -l) literal(s) (owner identity from $IDENTITY_ENV) ==="
# rc=134 on cut #2: 'Ineffective mark-compacts near heap limit' at the default ~4GB V8
# heap. spawn in cut-seed-cli.ts inherits env, so this reaches the bwrap re-exec.
export NODE_OPTIONS="${SEED_CUT_NODE_OPTIONS:---max-old-space-size=24576}"
PAPERCUSP_ALLOW_DEV_RESTART=1 PAPERCUSP_WORKSPACE_ROOT="$M" \
  npx tsx lib/release/cut-seed-cli.ts \
    --out "$OUT" \
    --repo "$M" \
    --origin "$ORIGIN" \
    --workspace-id "$WORKSPACE_ID" \
    --hive "$HIVE" \
    --rev HEAD \
    --depth 1 \
    --sparse \
    --emit-epoch-key
rc=$?
echo "=== cut rc=$rc at $(date -u +%FT%TZ) ==="
exit $rc
