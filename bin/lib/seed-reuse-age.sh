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

# Output-only D166 doc copy point. Private originals survive outside the shipped
# tree for independent review; never rewrite the canonical docs or a frozen core.
seed_uuid_project_sidecar_documents() {
  local formatter="$1" sidecar="$2"
  local census="${PAPERCUSP_SEED_UUID_CENSUS_PATH:-}"
  local digest="${PAPERCUSP_SEED_UUID_CENSUS_SHA256:-}"
  [[ -n "$census$digest" ]] || return 0
  if [[ "$sidecar" != */src-tauri/sidecar || ! -d "$sidecar" || -L "$sidecar" \
      || "$census" != /* || ! -f "$census" || -L "$census" || ! "$digest" =~ ^[0-9a-f]{64}$ ]]; then
    echo "ERROR: UUID document projection needs exact private context and the generated sidecar root (values omitted)." >&2
    return 1
  fi
  local actual
  actual="$(sha256sum -- "$census" 2>/dev/null)" || return 1
  [[ "${actual%% *}" == "$digest" ]] || { echo "ERROR: UUID census changed before document projection (values omitted)." >&2; return 1; }
  local evidence index=0 relative frozen projected report public_report original
  if ! node - "$sidecar" "${VH_RUN_DIR:-}" <<'NODE'
const fs = require('node:fs'), path = require('node:path');
try {
  const [sidecar, run] = process.argv.slice(2);
  const repository = path.resolve(fs.realpathSync(sidecar), '../../..');
  const evidence = fs.realpathSync(run);
  if (!fs.statSync(evidence).isDirectory() || evidence === repository || evidence.startsWith(repository + path.sep)) process.exit(1);
} catch { process.exit(1); }
NODE
  then
    echo "ERROR: UUID private evidence requires a durable verification run outside the source/resource tree (values omitted)." >&2
    return 1
  fi
  evidence="$(mktemp -d "$VH_RUN_DIR/uuid-doc-inputs.XXXXXX")" || return 1
  chmod 700 "$evidence" || return 1
  for relative in internal-docs apps/operator-docs/src/content/docs spa; do
    [[ ! -e "$sidecar/$relative" && ! -L "$sidecar/$relative" ]] && continue
    if [[ ! -d "$sidecar/$relative" || -L "$sidecar/$relative" ]]; then
      echo "ERROR: UUID doc copy point is linked or not a directory (values omitted)." >&2
      return 1
    fi
    frozen="$evidence/input-$index"
    projected="$evidence/projected-$index"
    report="$evidence/redactions-$index.json"
    public_report="$sidecar/uuid-idempotency-doc-redactions-$index.json"
    if [[ -e "$public_report" || -L "$public_report" ]]; then
      echo "ERROR: UUID document manifest already exists; a fresh copy point is required (values omitted)." >&2
      return 1
    fi
    cp -a "$sidecar/$relative" "$frozen" 2>/dev/null || return 1
    if ! python3 "$formatter" --project-uuid-documents "$census" "$frozen" "$projected" "$report" \
        || ! python3 "$formatter" --validate-uuid-documents "$census" "$frozen" "$projected" "$report"; then
      echo "ERROR: UUID doc projection or independent manifest check refused (values omitted)." >&2
      return 1
    fi
    # Keep the pre-projection copy for review. The destination is a newly minted
    # output tree that both source-derived checks have already verified.
    original="$evidence/pre-projection-$index"
    if ! diff -r "$frozen" "$sidecar/$relative" >/dev/null 2>&1; then
      echo "ERROR: UUID doc copy changed after freezing (values omitted)." >&2
      return 1
    fi
    mv "$sidecar/$relative" "$original" 2>/dev/null || return 1
    if ! mv "$projected" "$sidecar/$relative" 2>/dev/null; then
      mv "$original" "$sidecar/$relative" 2>/dev/null || true
      return 1
    fi
    mv "$report" "$public_report" 2>/dev/null || return 1
    node - "$evidence" "$census" "$digest" "$relative" "$frozen" "$sidecar/$relative" "$public_report" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const [directory, censusPath, censusSha256, relative, sourcePath, outputPath, manifestPath] = process.argv.slice(2);
const file = path.join(directory, 'projection-inputs.private.json');
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { censusPath, censusSha256, inputPlane: 'generated-doc-copy-after-normal-privacy-projection-not-signed-source-proof', documentProjections: [] };
const manifestSha256 = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
state.documentProjections.push({ relative, sourcePath, outputPath, manifestPath, manifestSha256 });
fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
NODE
    [[ "$?" == "0" ]] || return 1
    index=$((index+1))
  done
  if [[ "$index" == "0" ]]; then
    echo "ERROR: UUID doc copy point enumerated no input directories (values omitted)." >&2
    return 1
  fi
  actual="$(sha256sum -- "$census" 2>/dev/null)" || return 1
  [[ "${actual%% *}" == "$digest" ]] || { echo "ERROR: UUID census changed during document projection (values omitted)." >&2; return 1; }
  # A PRIVATE run-scoped pointer, never in the Tauri resource roots.
  if [[ -n "${VH_RUN_DIR:-}" && -d "$VH_RUN_DIR" ]]; then
    local pointer
    pointer="$(mktemp "$VH_RUN_DIR/uuid-document-projection-inputs.XXXXXX")" || return 1
    printf '%s\n' "$evidence/projection-inputs.private.json" > "$pointer" || return 1
    chmod 600 "$pointer" || return 1
  fi
  SEED_UUID_DOC_INPUTS_PATH="$evidence/projection-inputs.private.json"
}
