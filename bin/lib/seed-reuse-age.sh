#!/usr/bin/env bash
# seed-reuse-age.sh — the ONE age guard for a reused installer-seed corestore.
#
# WI-10004429: a --reuse-corestore graft ships the committed corestore AS-CUT, of
# ANY age. 0.0.26 reused release-seeds/current, cut 2026-09-22, three days before
# the first P-530 receipt-filtered set existed, so every joiner seeded at the old
# unfiltered set and folded ~887k dead governor receipts. Nothing refreshes the
# snapshot store automatically, so every reuse site refuses a stale one loudly.
#
# WI-10004593: the guard first landed inline in release-local.sh only, while
# mac-vm-build.sh and ensure-release-seed.sh kept auto-reusing with no age check.
# It now lives here and all three call it, so the sites cannot drift apart again.
#
# Usage: seed_reuse_age_check <manifest.json path>
#   PAPERCUSP_SEED_REUSE_MAX_AGE_HOURS  (default 72; 0 accepts any age)
# Returns 0 when the reuse may proceed (prints the age on stdout), 1 when it must
# be refused (prints the reason on stderr). Never exits the caller.

seed_reuse_age_check() {
  local manifest="$1"
  local reuse_max_h="${PAPERCUSP_SEED_REUSE_MAX_AGE_HOURS:-72}"
  if [[ ! "$reuse_max_h" =~ ^[0-9]+$ ]]; then
    echo "ERROR: PAPERCUSP_SEED_REUSE_MAX_AGE_HOURS must be a whole number of hours (got '$reuse_max_h')" >&2
    return 1
  fi
  (( reuse_max_h > 0 )) || return 0
  local reuse_cut_ts
  reuse_cut_ts="$(node -e 'try{const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(Number.isFinite(m.cutTs))process.stdout.write(String(Math.trunc(m.cutTs)))}catch{}' "$manifest" 2>/dev/null || true)"
  if [[ -z "$reuse_cut_ts" ]]; then
    echo "ERROR: seed reuse: $manifest has no readable cutTs, so the reused corestore's age is unknown. Refusing to ship it (WI-10004429). Set PAPERCUSP_SEED_REUSE_MAX_AGE_HOURS=0 to accept any age." >&2
    return 1
  fi
  local reuse_age_h=$(( ( $(date +%s) * 1000 - reuse_cut_ts ) / 3600000 ))
  if (( reuse_age_h > reuse_max_h )); then
    echo "ERROR: seed reuse: the committed corestore was cut ${reuse_age_h}h ago (cutTs=$reuse_cut_ts), older than PAPERCUSP_SEED_REUSE_MAX_AGE_HOURS=${reuse_max_h}. A reused corestore ships as-cut, so every joiner would fold that old hive state (WI-10004429). Refresh the snapshot store: cut a fresh seed on a quiesced box (bin/cut-seed-quiesced.sh, PAPERCUSP_SEED_REUSE_CORESTORE=0) and repoint ${PAPERCUSP_SEED_SNAPSHOT_DIR-$HOME/.papercusp/release-seeds/current}. Or set PAPERCUSP_SEED_REUSE_MAX_AGE_HOURS=0 to ship it anyway." >&2
    return 1
  fi
  echo "seed: reused corestore age ${reuse_age_h}h (max ${reuse_max_h}h)"
}
