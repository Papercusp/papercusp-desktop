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

# D166 extends the shared seed-mode policy. Call before any skip or repair.
# The CLI verifies private permissions, actual source rows/head and literal
# policy; no value or private binding hash is printed by this guard.
seed_uuid_row_drop_prepare() {
  SEED_UUID_ROW_DROP_ACTIVE=0
  SEED_UUID_ROW_DROP_ARGS=()
  local plan="${PAPERCUSP_SEED_UUID_PLAN_PATH:-}"
  local digest="${PAPERCUSP_SEED_UUID_PLAN_SHA256:-}"
  [[ -n "$plan$digest" ]] || return 0
  local store="${PAPERCUSP_SEED_STORE_DIR:-}"
  local census="${PAPERCUSP_SEED_UUID_CENSUS_PATH:-}"
  local census_digest="${PAPERCUSP_SEED_UUID_CENSUS_SHA256:-}"
  if [[ "$plan" != /* || "$store" != /* || ! "$digest" =~ ^[0-9a-f]{64}$ \
      || ! -f "$plan" || -L "$plan" || ! -d "$store" || -L "$store" \
      || "$census" != /* || ! "$census_digest" =~ ^[0-9a-f]{64}$ || ! -f "$census" || -L "$census" \
      || "${PAPERCUSP_SKIP_SEED_CUT:-0}" == "1" || "${PAPERCUSP_FAST_ITER:-0}" == "1" \
      || "${PAPERCUSP_SEED_CORESTORE:-1}" != "1" || "${PAPERCUSP_SEED_REUSE_CORESTORE:-auto}" != "0" \
      || "${PAPERCUSP_SEED_SPARSE:-1}" != "0" || "${PAPERCUSP_SEED_FORCE:-0}" != "1" ]]; then
    echo "ERROR: UUID row-drop plans require exact private inputs and a fresh, full frozen-source cut; skip/reuse/refresh is refused." >&2
    return 1
  fi
  local actual
  actual="$(sha256sum -- "$plan" 2>/dev/null)" || return 1
  if [[ "${actual%% *}" != "$digest" ]]; then
    echo "ERROR: UUID row-drop plan input changed (values omitted)." >&2
    return 1
  fi
  # Both private inputs must name the same original census. Do not let a later
  # document projection silently use a different class population.
  if ! node - "$plan" "$census" "$census_digest" <<'NODE'
const fs = require('node:fs'), crypto = require('node:crypto');
try {
  const [plan, census, digest] = process.argv.slice(2);
  const bytes = fs.readFileSync(census);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== digest
      || JSON.parse(fs.readFileSync(plan, 'utf8')).privateSourceBindings?.configSha256 !== digest
      || JSON.parse(bytes).reviewRef !== 'p2p-public-release-endgame-2026-09-01#D-166') process.exit(1);
} catch { process.exit(1); }
NODE
  then
    echo "ERROR: UUID census input changed or does not bind the row plan (values omitted)." >&2
    return 1
  fi
  SEED_UUID_ROW_DROP_ACTIVE=1
  SEED_UUID_ROW_DROP_ARGS=(--skip-corestore-refresh --uuid-idempotency-drop-plans "$plan" --uuid-idempotency-drop-plans-sha256 "$digest")
}
