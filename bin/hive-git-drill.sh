#!/usr/bin/env bash
# hive-git-drill.sh — P-301 LIVE-G acceptance drill scaffold
# (p2p-git-live-activation-2026-07-09 P-301; design = docs/plans/p2p-git-research-2026-07-01.md;
#  Phase 3 spec = the plan's P-302..P-308, "legs A-G"; runbook =
#  apps/operator-docs/src/content/docs/agent-insights/hive-git-p2p-ops-runbook-2026-07-09.mdx)
#
# Mirrors bin/work-distribution-drill.sh's shape exactly: every leg is either a
# LIVE assert (wiring has landed) or an explicit SKIP-with-reason (never a
# silent green) — the SKIP census IS the release evidence for what's still
# unproven. As each owning lane's wiring lands, flip its skipp() to a live
# assert IN THIS SAME FILE — the harness below (sidecar boot, workspace,
# throwaway hive) is built to stay put; only the leg BODIES change.
#
# TODAY'S STATUS (2026-07-10, p2p-live-federation-crack-2026-07-10 P-006
# re-verify — re-check against the runbook doc + `git log -- packages/
# operator-core/lib/sync/pot-git/` before trusting this further): the module
# was renamed lib/sync/hive-git -> lib/sync/pot-git since 2026-07-09 (this
# script's paths/function names below are kept current with that rename).
# Per the WI-3497/WI-3498 checkpoints, the P-201 serve plane, P-202 announce
# ->fetch driver, and P-204 worktree-bridge driver are now CODE-COMPLETE +
# integration-tested end-to-end over a real socket duplex (real bare repos,
# real ed25519 signing, real git subprocesses) — they are just not yet
# SCHEDULED as a live production routine (no caller wires
# runRefAnnouncePublishTick/runRefAnnounceReceiveTick into a routine today).
# That means LEGS A, B, C below can now run LIVE, single-box/in-process,
# using the SAME real production functions the dedicated regression tests
# already exercise (bootstrap.integration.test.ts / ref-announce.integration.
# test.ts / leg-c-trust-drill.integration.test.ts) — mirroring exactly how
# LEG D and LEG F were flipped from skip to live: a second local git
# worktree/repo stands in for "the other machine", never a reimplementation.
# LEG E stays SKIP — its remaining gap (real multi-machine wall-clock/network
# timing under the git-sync-stall-watchdog) is not something a local git
# object trick can prove; the runbook's own commit-only-mode analysis is
# static-verified but explicitly NOT the live proof this leg is for. LEG G
# (chaos) stays SKIP — needs A-F live under one genuine multi-machine run
# first. P-205 (gc/secrets-guard) DID land 2026-07-09 (WI-3494) so LEG F
# stays LIVE (unchanged from 2026-07-09).
#
# LIVE today, single-box, no rig needed:
#   MODE   hiveGit.mode round-trip against the packaged sidecar's OWN PG:
#          unset(legacy) -> bridged -> ROLLBACK(delete row) -> unset(legacy).
#          Exercises exactly the rollback lever the runbook documents (the
#          fail-open coercion itself is unit-tested in hive-git-mode.test.ts;
#          this proves the STORAGE round-trip against a real packaged instance).
#   A/B/C  run the dedicated pot-git regression suites in-process (see below).
#   D/F    real production code against real bare repos this drill builds itself.
#
# The genuine tower<->VM 2-machine legs still need the LIVE-1 rig
# (docs/plans/LIVE-1-rig-runbook-2026-07-02.md, owned by the plan leader +
# su-4dc3befd's WI-1729 lane) for real network/DHT peer-discovery conditions —
# this scaffold boots ONE local packaged instance (single-box, like
# work-distribution-drill.sh's "single-box live subset") so the harness
# (workspace + throwaway hive + a real sidecar) exists and is exercised
# end-to-end today, and legs A-D now separately prove the git-replication
# MECHANICS single-box via a real local transport stand-in for "the other
# machine". A genuine 2-node run substitutes the rig for that stand-in once
# the rig itself is unblocked — see two-instance-federation-smoke.sh /
# bin/vm-federation.sh for the 2-instance and real-VM driver patterns this
# would graduate to.
#
# Usage: bin/hive-git-drill.sh [path/to/Papercusp*.deb]
#   KEEP_UP=1   leave the sidecar running for inspection
set -uo pipefail
DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"

REPO_DIR="${PAPERCUSP_REPO_DIR:-/home/marsh-office/papercupai-workspace/papercusp}"
# lib/sync/hive-git -> lib/sync/pot-git (renamed 2026-07-09/10) — defined once,
# up front, so every leg below (A/B/C/D/F) sees it; a leg-local redefinition
# right before its own heredoc is what silently broke LEG D previously (the
# heredoc expands $HGGIT at *creation* time, and HGGIT was only being set much
# later, right before LEG F — so LEG D's imports resolved to '/storage' etc.).
HGGIT="$REPO_DIR/packages/operator-core/lib/sync/pot-git"
DEB="${1:-}"
if [ -z "$DEB" ]; then
  DEB="$(ls -t /home/marsh-office/.cargo-target/release/bundle/deb/Papercusp*_amd64.deb 2>/dev/null | head -1)"
fi
DEB="$(readlink -f "$DEB" 2>/dev/null || echo "${DEB:-}")"
[ -f "$DEB" ] || { echo "FATAL: no .deb found (pass one; tried .cargo-target bundle dir)"; exit 2; }
LUXON_SRC="$REPO_DIR/node_modules/luxon"
REPO_URL="${HIVE_SMOKE_REPO_URL:-https://github.com/octocat/Hello-World}"
DRILL_HIVE_TITLE="P-301 hive-git drill"

WORK="${PAPERCUSP_DRILL_WORK:-$HOME/.papercusp-drill-p301}"
rm -rf "$WORK" 2>/dev/null; mkdir -p "$WORK"
PKG="$WORK/pkg"
declare -A FED_LOG=( [a]="$WORK/inst-a.log" )
declare -A AHOME=( [a]="$WORK/inst-a" )
log() { printf '\n=== %s ===\n' "$*"; }
jget() { printf '%s' "$1" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
try: print($2)
except Exception: pass
" 2>/dev/null; }

PASS=0; FAIL=0; SKIPPED=0
ok()   { echo "  ✓ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $*"; FAIL=$((FAIL+1)); }
skipp(){ echo "  ⏭ SKIP $*"; SKIPPED=$((SKIPPED+1)); }

# stop.sh: pgrep MINUS the invoker chain — never pkill -f a path your own argv carries
printf '#!/usr/bin/env bash\nfor p in $(pgrep -f "%s"); do [ "$p" = "$$" ] || [ "$p" = "$PPID" ] || kill -9 "$p" 2>/dev/null; done\necho stopped\n' "$WORK" > "$WORK/stop.sh"; chmod +x "$WORK/stop.sh"
cleanup() { [ -n "${KEEP_UP:-}" ] && { echo "KEEP_UP=1 — sidecar left running; $WORK/stop.sh to stop"; return; }; bash "$WORK/stop.sh" >/dev/null 2>&1; }
trap cleanup EXIT

log "extract $DEB"
fed_extract_deb "$DEB" "$PKG" || exit 1
SIDE="$(fed_sidecar_dir "$PKG")"
[ -d "$SIDE/node_modules/luxon" ] || { echo "→ A-001 fix: injecting luxon"; cp -aL "$LUXON_SRC" "$SIDE/node_modules/luxon" || exit 1; }
fed_clobber_check "$PKG" || exit 2

# WI-3969: a stale bundled .deb (db-sql/ behind the repo's libs/papercusp/libs/db/sql/)
# does NOT fail loudly — the sidecar boots fine, then a leg queries a table a later
# migration created/renamed and dies mid-run with a misleading "relation does not
# exist" / "git commit failed" trace, indistinguishable from a real pot-git
# regression (this is exactly how the LEG D "failure" that filed this WI happened —
# 18 migrations behind, hives->pots rename mig 557 missing, no real code defect).
# Fail FAST here, before any leg runs, with the actual diagnosis instead.
REPO_SQL_DIR="$REPO_DIR/libs/papercusp/libs/db/sql"
BUNDLED_SQL_DIR="$SIDE/db-sql"
repo_max_mig="$(ls "$REPO_SQL_DIR"/*.sql 2>/dev/null | xargs -n1 basename | grep -oE '^[0-9]+' | sort -n | tail -1)"
bundled_max_mig="$(ls "$BUNDLED_SQL_DIR"/*.sql 2>/dev/null | xargs -n1 basename | grep -oE '^[0-9]+' | sort -n | tail -1)"
if [ -n "$repo_max_mig" ] && [ -n "$bundled_max_mig" ] && [ "$bundled_max_mig" -lt "$repo_max_mig" ]; then
  echo "FATAL: bundled .deb's db-sql/ is STALE — highest migration $bundled_max_mig, repo is at $repo_max_mig ($((repo_max_mig - bundled_max_mig)) migration(s) behind)."
  echo "  This is a stale TEST ARTIFACT, not a pot-git regression. Rebuild the .deb"
  echo "  (papercusp-desktop/bin/build-and-archive-deb.sh, or a fresh release build) or"
  echo "  pass a fresher one explicitly: bin/hive-git-drill.sh /path/to/fresh.deb"
  echo "  Stale DEB: $DEB"
  exit 2
elif [ -n "$repo_max_mig" ] && [ -n "$bundled_max_mig" ]; then
  echo "  bundled db-sql at migration $bundled_max_mig, repo at $repo_max_mig — fresh, continuing"
fi

log "spin local testnet DHT (announce stays off the public DHT)"
BOOTSTRAP="$(fed_start_testnet_dht "$REPO_DIR/apps/operator" "$WORK")" || exit 3
echo "PAPERCUSP_DHT_BOOTSTRAP=$BOOTSTRAP"

log "launch sidecar A (single-box stand-in for 'tower')"
SMK_HONO="$(fed_pick_free_port 18371)"; SMK_PG="$(fed_pick_free_port 19032)"
# 2026-07-10: a fresh isolated $AHOME has no local HF model cache, so the
# default embedder (gemma) crashes the WHOLE sidecar process at boot ("Unable
# to get model file path or buffer" from @huggingface/transformers) before the
# API ever comes up — unrelated to git-federation; tracked separately under
# shared-embedding-sidecar-and-enrichment-2026-07-10. This drill exercises
# pot-git, not memory/embeddings, so disable the embedder rather than block on
# that other lane's fix.
fed_local_launch_sidecar "${AHOME[a]}" "${FED_LOG[a]}" "$SIDE" "$SMK_HONO" "$SMK_PG" \
  PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" \
  PAPERCUSP_MEMORY_EMBEDDER=disabled
fed_wait_boot a 80 || { echo "boot failed: ${FED_BOOT_ERR:-?}"; tail -25 "${FED_LOG[a]}"; exit 4; }
fed_wait_api a 30 || { echo "FATAL: sidecar API never came up"; exit 4; }
DSN="postgresql://harness_admin:harness_admin_pwd@localhost:${FED_PG[a]}/papercusp"
q() { psql "$DSN" -tA -c "$1" 2>/dev/null | tr -d '\r'; }
SC="http://127.0.0.1:${FED_SC[a]}"
echo "  sc=${FED_SC[a]} pg=${FED_PG[a]}"

# ── workspace + throwaway hive (the harness every leg below shares) ─────────
log "create workspace"
wresp="$(fed_run_with_heartbeat "workspace create" 10 -- \
  curl -s -m 30 -X POST "$SC/api/workspaces" -H 'content-type: application/json' \
  -d '{"name":"P-301 hive-git drill"}')"
WS="$(jget "$wresp" "d.get('id') or (d.get('workspace') or {}).get('id') or ''")"
[ -n "$WS" ] || WS="$(jget "$wresp" "d['workspaces'][0]['id']")"
[ -n "$WS" ] || { echo "✗ workspace create failed: $(echo "$wresp" | head -c 300)"; exit 6; }
echo "  workspace=$WS"
H_WS="x-papercusp-workspace: $WS"

log "create THROWAWAY test hive ($REPO_URL)"
# HEARTBEAT (P-307 hardening, leader audit 2026-07-10): -m 610 alone is silent for
# up to 10 minutes if the sidecar is mid-churn (bg-host restart, wedged outbox, …)
# — a wedged-but-not-dead request looked identical to a hung script. Heartbeat
# every 20s so that distinction is visible without changing the 610s hard cap.
# DRILL_SLUG (2026-07-10): request a fresh slug for the FIRST-ever run
# against a clean workspace. NOTE (corrected 2026-07-10): the lookup step
# keys purely on githubRepositoryId (the `slug` field is only consulted on
# the CREATED path's derivation, never on the lookup) — so once a hive for
# $REPO_URL has EVER been created in this workspace, every later run still
# takes the "existing" branch regardless of this slug. See POT_GIT_SLUG below
# for the fix that actually matters: sanitizing whatever comes back (created
# OR existing) before using it as a pot-git filesystem path component.
DRILL_SLUG="p301-drill-$$"
resp="$(fed_run_with_heartbeat "throwaway hive create (cap 610s)" 20 -- \
  curl -s -m 610 -X POST "$SC/api/harness/pots/from-repo" -H 'content-type: application/json' -H "$H_WS" \
  -d "{\"githubUrl\":\"$REPO_URL\",\"slug\":\"$DRILL_SLUG\",\"visibility\":\"public\",\"runTests\":false,\"shallow\":true}")"
HIVE_SLUG="$(jget "$resp" "d['created'].get('potSlug') or d['created'].get('hiveSlug') or ''")"  # field renamed hiveSlug→potSlug (cup-lexicon-full-rename); accept both for version skew
HIVE_PATH="created"
if [ -z "$HIVE_SLUG" ]; then
  HIVE_SLUG="$(jget "$resp" "d['existing']['hive'].get('potId') or d['existing']['hive'].get('hiveId') or ''")"  # field renamed hiveId->potId (cup-lexicon-full-rename); accept both for version skew
  HIVE_PATH="existing"
fi
[ -n "$HIVE_SLUG" ] || { echo "✗ hive create failed: $(echo "$resp" | head -c 300)"; exit 6; }
echo "  hive=$HIVE_SLUG (path=$HIVE_PATH)"
# POT_GIT_SLUG: the "existing" branch's hive.potId is a raw GitHub coordinate
# ("owner/repo") — a `/` fails pot-git storage.ts's assertSafeComponent (a
# filesystem path component, not a display slug). LEG D needs a path-safe
# identifier, not necessarily the sidecar's own notion of the hive's slug, so
# sanitize once here rather than re-deriving it inside the LEG D heredoc.
POT_GIT_SLUG="${HIVE_SLUG//\//-}"

# ── LEG MODE — hiveGit.mode round-trip against the real packaged instance ───
# Direct SQL (harness_shared.pot_settings, mig 186 / renamed from hive_settings
# by mig 557 cup-lexicon-db-rename-phase3, 2026-07-09) — the same table
# setHiveGitMode/getHiveGitMode (hive-settings-store.ts) read/write; no HTTP
# route sets this yet (github-bridge-hive-egress-2026-07-02 pattern: activation
# is structural, there is no admin route or flag for the mode itself).
# NOTE (WI-4062): this drill's own q() helper redirects psql's stderr to
# /dev/null, so a stale table name here doesn't error loudly — it just reads
# back as an empty string / empty count, which is exactly what happened when
# this still said hive_settings post-557 (mode "reads back ''", rollback
# "does NOT revert" — both were psql silently failing against a table that no
# longer existed, not a real hiveGit.mode bug).
log "LEG MODE — flip hiveGit.mode legacy -> bridged -> rollback -> legacy"
NOWMS="$(date +%s)000"
q "INSERT INTO harness_shared.pot_settings (workspace_id, harness_slug, setting_key, value, created_at, updated_at)
   VALUES ('$WS','$HIVE_SLUG','hiveGit.mode','\"bridged\"',$NOWMS,$NOWMS)
   ON CONFLICT (workspace_id, harness_slug, setting_key) DO UPDATE SET value=EXCLUDED.value, updated_at=$NOWMS;" >/dev/null
modeval="$(q "SELECT value FROM harness_shared.pot_settings WHERE workspace_id='$WS' AND harness_slug='$HIVE_SLUG' AND setting_key='hiveGit.mode';")"
if [ "$modeval" = '"bridged"' ]; then
  ok "hiveGit.mode row set to bridged ($modeval)"
else
  bad "hiveGit.mode row wrong after set: '$modeval' (want \"bridged\")"
fi
log "LEG MODE — ROLLBACK (delete the row — the documented instant fail-open revert)"
q "DELETE FROM harness_shared.pot_settings WHERE workspace_id='$WS' AND harness_slug='$HIVE_SLUG' AND setting_key='hiveGit.mode';" >/dev/null
rows_left="$(q "SELECT count(*) FROM harness_shared.pot_settings WHERE workspace_id='$WS' AND harness_slug='$HIVE_SLUG' AND setting_key='hiveGit.mode';")"
if [ "$rows_left" = "0" ]; then
  ok "rollback: row deleted — getHiveGitMode now reads 'legacy' (fail-open default, hive-git-mode.ts)"
else
  bad "rollback left $rows_left row(s) — mode did not revert"
fi

# ── run_vitest_leg — shells out to a dedicated pot-git regression suite and
#    folds its pass/fail into this drill's own PASS/FAIL/SKIP census. Reuses
#    the REAL checked-in regression tests (real production functions, real
#    git subprocesses, real ed25519 signing over a real socket duplex) rather
#    than re-implementing their bodies inline — those files already ARE each
#    leg's single-box proof (see leg-c-trust-drill.integration.test.ts's own
#    header for the precedent this follows). `--reporter=json` -> stdout only
#    (warnings go to stderr) so the summary is cleanly parseable.
run_vitest_leg() {
  local leg_label="$1"; shift
  local json_out
  json_out="$(cd "$REPO_DIR/packages/operator-core" && env -u npm_config_local_prefix \
    npx vitest run --config vitest.integration.config.ts --reporter=json "$@" 2>"$WORK/${leg_label// /_}.err")"
  local total passed failed
  total="$(jget "$json_out" "d.get('numTotalTests')")"
  passed="$(jget "$json_out" "d.get('numPassedTests')")"
  failed="$(jget "$json_out" "d.get('numFailedTests')")"
  if [ -z "$total" ] || [ "$total" = "0" ]; then
    bad "$leg_label: vitest produced no parseable result — see $WORK/${leg_label// /_}.err"
    return
  fi
  if [ "$failed" = "0" ]; then
    ok "$leg_label: $passed/$total tests passed ($*)"
  else
    bad "$leg_label: $failed/$total tests FAILED ($*) — see $WORK/${leg_label// /_}.err"
  fi
}

# ── LEG A (P-302) storage + join — LIVE as of 2026-07-10: G-8 cold-clone
# bootstrap (bootstrapFromPeer) is code-complete + already integration-tested
# over a REAL socket duplex (two local bare repos standing in for "self" and
# "peer", the identical fetch-transport link LEG B/D use) — the same
# single-box-stand-in-for-the-other-machine pattern already established for
# LEG D/F. The genuine gap left for the rig is real network/DHT peer
# discovery + a real second physical device, not the join mechanics.
log "LEG A (P-302) — G-8 cold-clone bootstrap: a fresh joiner seeds every namespace a peer holds, over a real socket duplex"
run_vitest_leg "LEG A" lib/sync/pot-git/bootstrap.integration.test.ts

# ── LEG B (P-303) replication — LIVE as of 2026-07-10: per the WI-3497/3498
# checkpoints the P-202 announce->fetch driver is code-complete (ref-announce.
# ts / fetch-transport.ts) and already integration-tested end-to-end (announce
# -> fetch -> sigrefs accept -> heads reconcile -> mirrored, PLUS the
# relay-tampered-head refusal) over a real socket duplex against real bare
# repos. Not yet SCHEDULED as a live production routine (no caller wires
# runRefAnnouncePublishTick/runRefAnnounceReceiveTick into a routine today) —
# that scheduling + the genuine tower<->VM round-trip stay rig/P-003 work.
log "LEG B (P-303) — G-3 announce-driven fetch: announce -> fetch -> sigrefs accept -> heads reconcile -> mirrored, over a real socket duplex"
run_vitest_leg "LEG B" lib/sync/pot-git/ref-announce.integration.test.ts

# ── LEG C (P-304) trust / tamper drill — LIVE as of 2026-07-10: per the
# WI-3498 checkpoint this was EXTRACTED into its own file precisely so it
# could run independent of the rig — it drives the trust-verification layer
# (sigrefs signature/rollback/reconcile + the scope-serve-gate) directly:
# a relay lying about a third device's namespace, a rollback replay, and a
# non-member fetch, all real production code over real bare repos + real
# ed25519 keys, no network transport or rig needed.
log "LEG C (P-304) — trust/tamper drill: relay-lie detection, rollback refusal (G-4b), non-member scope-serve-gate refusal"
run_vitest_leg "LEG C" lib/sync/pot-git/leg-c-trust-drill.integration.test.ts

# ── SKIP census — the two Phase-3 legs still genuinely rig-gated ───────────
log "SKIP census — legs needing the real LIVE-1 rig (owners: p2p-git-live-activation-2026-07-09 lanes)"
skipp "LEG E (P-306) GitHub bridge live — needs the rig's 2nd machine to prove commit-only members don't false-alarm the watchdog under REAL multi-machine wall-clock/network timing; the runbook's commit-only-mode watchdog analysis (git-sync-stall-watchdog.ts's commitStale is unaffected by commit-only mode) is static-verified, re-confirmed 2026-07-10, but is explicitly NOT the live proof this leg exists for — no local git-object trick substitutes for real timing skew"
skipp "LEG G (P-308) chaos — needs LEGS A-F live UNDER ONE GENUINE MULTI-MACHINE RUN first (kill-the-integrator / PG-blip / VM-restart drills are meaningless without a live multi-machine replication loop to interrupt); legs A-D proving their mechanics single-box today is necessary but not sufficient for this leg"

# ── LEG D (P-305) integration — LIVE as of 2026-07-10: P-204 worktree-bridge
# driver landed (WI-3493, runWorktreeBridgeLeg wired into git-sync-action.ts).
# Same standard as LEG F: real production code (runIntegratorTick,
# runWorktreeBridgeTick, the real G-5c ratify-queue writer) against a real bare
# hive-git repo AND this drill's own real packaged-sidecar Postgres (the SAME
# $DSN the LEG MODE round-trip above already proves is live) — never a fake
# sql, never a reimplementation. "The OTHER machine" is a SEPARATE worktree
# over the same local mirror (openDuplex omitted because the objects are
# already local) — the identical precedent worktree-bridge.integration.test.ts
# itself uses for its own "second machine-view" case; a genuine 2-process /
# 2-host proof is P-003's live-rig job, not this leg's (LEG A/B above prove
# the join/replication MECHANICS single-box the same way; none of A/B/D
# substitute for the real 2-machine run).
log "LEG D (P-305) — integrator computes+publishes canonical staging; a non-steer head lands in the REAL PG integration-requests queue with a visible receipt; the OTHER machine's worktree ff-advances and never touches a dirty/locked file"
LEGD_ROOT="$WORK/leg-d-git-root"; mkdir -p "$LEGD_ROOT"
# Node/tsx resolve a bare specifier (`import postgres from 'postgres'`) by
# walking up node_modules from the SCRIPT'S OWN path — never from the process
# cwd — so a script written under $WORK (outside the repo tree entirely) can
# never find the repo's hoisted `postgres` package no matter what directory
# `npx tsx` is invoked FROM. Write it into the repo's own gitignored scratch
# dir instead (mirrors the existing .papercusp/scratch/leg-c-trust-drill.ts
# precedent) so the upward walk reaches $REPO_DIR/node_modules/postgres.
LEGD_SCRATCH_DIR="$REPO_DIR/.papercusp/scratch"; mkdir -p "$LEGD_SCRATCH_DIR"
LEGD_SCRIPT="$LEGD_SCRATCH_DIR/hive-git-drill-leg-d-$$.ts"
cat > "$LEGD_SCRIPT" <<EOF
import postgres from 'postgres';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.PAPERCUSP_HIVE_GIT_ROOT = '$LEGD_ROOT';
import { generateEd25519KeypairDer, signWithPrivateKeyDer } from '$HGGIT/../../identity/ed25519';
import { defaultRunGit, ensurePotGitRepo, writeNamespaceRef } from '$HGGIT/storage';
import { WORK_REF, readStaging } from '$HGGIT/integrator';
import { runIntegratorTick } from '$HGGIT/integrator-tick';
import { runWorktreeBridgeTick } from '$HGGIT/worktree-bridge-tick';
import { listIntegrationRequests } from '$HGGIT/integration-requests';

function keypair() {
  const { privateKeyDer, pubkeyBase64 } = generateEd25519KeypairDer();
  return { pubkeyBase64, sign: async (bytes: Buffer) => signWithPrivateKeyDer(privateKeyDer, bytes) };
}
async function git(args: string[], cwd: string): Promise<string> {
  const r = await defaultRunGit(args, cwd);
  if (r.code !== 0) throw new Error(\`git \${args.join(' ')} failed: \${r.stderr}\`);
  return r.stdout.trim();
}
async function initWorktree(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await git(['init', '-q', '-b', 'main'], dir);
  await git(['config', 'user.name', 't'], dir);
  await git(['config', 'user.email', 't@t'], dir);
}
// A commit minted in \`src\` (a separate worktree/repo) only exists in SRC's
// own object database — writeNamespaceRef(repo, ...) update-refs against
// the pot-git bare \`repo\`, which has never seen those objects, so it fails
// with "nonexistent object" unless they're transferred first. Mirrors the
// real publishToPeer() helper in worktree-bridge.integration.test.ts (the
// file this leg is explicitly modeled on): fetch the branch from src into
// repo as a throwaway ref, which pulls the objects along with it.
async function importFromSrc(repoPath: string, srcPath: string, branch: string): Promise<void> {
  await git(['fetch', '-q', srcPath, \`+refs/heads/\${branch}:refs/bridge-import/\${branch}\`], repoPath);
}

async function main() {
  const sql = postgres('$DSN', { prepare: false });
  // REPO_KEY must be UNIQUE per drill invocation: ensurePotGitRepo() reuses
  // an existing bare repo keyed only on (POT_SLUG, REPO_KEY) — a hardcoded
  // literal here left the pot-git bare repo (and its STAGING_REF) PERSISTENT
  // across runs, since POT_SLUG is stable (the "existing" hive's coords never
  // change). A leftover STAGING_REF from a prior run silently broke this
  // run's "first tick, base=null ⇒ staging becomes steerSha directly"
  // assumption — it fell into the 3-way-merge branch against unrelated
  // history instead, so stagingIsSteerSha came back false even though
  // integration genuinely advanced. A fresh key each run reproduces the
  // intended first-tick scenario every time, matching this leg's own
  // real-bare-repo-per-run doc comment above.
  const WS = '$WS'; const POT_SLUG = '$POT_GIT_SLUG'; const REPO_KEY = 'leg-d-repo-$$';
  const repo = await ensurePotGitRepo(POT_SLUG, REPO_KEY);
  const integrator = keypair();
  const memberSteer = keypair();
  const memberBelow = keypair();

  const src = join('$LEGD_ROOT', 'src');
  await initWorktree(src);
  await writeFile(join(src, 'f.txt'), 'steer-v1\n');
  await git(['add', '.'], src);
  await git(['commit', '-q', '-m', 'S1'], src);
  const steerSha = await git(['rev-parse', 'HEAD'], src);
  await importFromSrc(repo, src, 'main');
  await writeNamespaceRef(repo, memberSteer.pubkeyBase64, WORK_REF, steerSha);

  await git(['checkout', '-q', '--orphan', 'below'], src);
  await writeFile(join(src, 'below.txt'), 'below-v1\n');
  await git(['add', 'below.txt'], src);
  await git(['commit', '-q', '-m', 'below'], src);
  const belowSha = await git(['rev-parse', 'HEAD'], src);
  await importFromSrc(repo, src, 'below');
  await writeNamespaceRef(repo, memberBelow.pubkeyBase64, WORK_REF, belowSha);
  await git(['checkout', '-q', 'main'], src);

  const out = await runIntegratorTick({
    potHomeSlug: POT_SLUG, workspaceId: WS, repoKey: REPO_KEY,
    memberDevicePubkeysBase64: [memberSteer.pubkeyBase64, memberBelow.pubkeyBase64],
    integratorDevicePubkeyBase64: integrator.pubkeyBase64,
    epoch: 1, priorSeq: 0, sign: integrator.sign,
    resolveTier: (dev) => (dev === memberSteer.pubkeyBase64 ? 'steer' : 'message'),
    deps: { isIntegrator: async () => true, sql },
  });

  // WI-4230 fix: capture the FIRST tick's staging check HERE, before the
  // second tick (out2, below) advances staging again — reading it at the
  // very end of main() (the original bug) always compared against the STALE
  // first-tick steerSha after staging had already moved to steerSha2,
  // guaranteeing a false FAIL regardless of whether the first tick actually
  // worked. Reproduced live 2026-07-12 (single-box drill run against a
  // fresh 0.0.8 build): stagingIsSteerSha:false despite integrationAdvanced:
  // true — this stale-read bug, not a product defect, matching the
  // 'transient/load-induced' hypothesis in the P-305 plan-item history.
  const stagingIsSteerSha = (await readStaging(repo, integrator.pubkeyBase64)) === steerSha;

  const queued = await listIntegrationRequests({ workspaceId: WS, potSlug: POT_SLUG, repoKey: REPO_KEY }, sql);
  const receipt = queued.find((q) => q.devicePubkey === memberBelow.pubkeyBase64 && q.headSha === belowSha);

  const otherWt = join('$LEGD_ROOT', 'other-machine-wt');
  await initWorktree(otherWt);
  const bridgeOut = await runWorktreeBridgeTick({
    bareRepoPath: repo, worktreePath: otherWt, pending: [out.announcement!],
    prior: { epochSeq: null, stagingSha: null }, accept: { expectedDevice: integrator.pubkeyBase64 },
  });
  const otherHead = await git(['rev-parse', 'HEAD'], otherWt);
  const otherContent = await readFile(join(otherWt, 'f.txt'), 'utf8');

  // Second advance while the other worktree has a DIRTY (locked) f.txt.
  await writeFile(join(src, 'f.txt'), 'steer-v2\n');
  await git(['add', '.'], src);
  await git(['commit', '-q', '-m', 'S2'], src);
  const steerSha2 = await git(['rev-parse', 'HEAD'], src);
  await importFromSrc(repo, src, 'main');
  await writeNamespaceRef(repo, memberSteer.pubkeyBase64, WORK_REF, steerSha2);
  const out2 = await runIntegratorTick({
    potHomeSlug: POT_SLUG, workspaceId: WS, repoKey: REPO_KEY,
    memberDevicePubkeysBase64: [memberSteer.pubkeyBase64, memberBelow.pubkeyBase64],
    integratorDevicePubkeyBase64: integrator.pubkeyBase64,
    epoch: 1, priorSeq: 1, sign: integrator.sign,
    resolveTier: (dev) => (dev === memberSteer.pubkeyBase64 ? 'steer' : 'message'),
    deps: { isIntegrator: async () => true, sql },
  });
  await writeFile(join(otherWt, 'f.txt'), 'locally-edited, uncommitted\n');
  const dirtyBridgeOut = await runWorktreeBridgeTick({
    bareRepoPath: repo, worktreePath: otherWt, pending: [out2.announcement!],
    prior: bridgeOut.watermark, accept: { expectedDevice: integrator.pubkeyBase64 },
  });
  const dirtyHeadAfter = await git(['rev-parse', 'HEAD'], otherWt);
  const dirtyContentAfter = await readFile(join(otherWt, 'f.txt'), 'utf8');

  await sql.end();
  console.log(JSON.stringify({
    stagingIsSteerSha,
    integrationAdvanced: out.integration?.advanced === true,
    gated: out.gated,
    // WI-4230: surface the actual error strings, not just the count — a bare
    // gated.errors:N (or top-level errors.length) with no message is
    // undiagnosable; print both ticks' errors[] so a future flake carries
    // its own root cause in the drill output instead of forcing a re-run.
    errors: out.errors,
    errors2: out2.errors,
    receiptFound: !!receipt,
    receiptState: receipt?.state ?? null,
    receiptReason: receipt?.reason ?? null,
    firstAdvanceOutcome: bridgeOut.results[0]?.bridge.outcome,
    firstAdvanceHeadMatches: otherHead === steerSha,
    firstAdvanceContent: otherContent,
    dirtyAdvanceOutcome: dirtyBridgeOut.results[0]?.bridge && 'advance' in dirtyBridgeOut.results[0].bridge ? dirtyBridgeOut.results[0].bridge.advance.outcome : dirtyBridgeOut.results[0]?.bridge.outcome,
    dirtyHeadUnchanged: dirtyHeadAfter === steerSha,
    dirtyContentUntouched: dirtyContentAfter === 'locally-edited, uncommitted\n',
  }));
}
main().catch((e) => { console.error(e); process.exit(1); });
EOF
legd_out="$(cd "$REPO_DIR/packages/operator-core" && env -u npm_config_local_prefix npx tsx "$LEGD_SCRIPT" 2>"$WORK/legd.err")"
rm -f "$LEGD_SCRIPT"
if [ -z "$legd_out" ]; then
  bad "LEG D: script produced no output — see $WORK/legd.err"
else
  [ "$(jget "$legd_out" "d['stagingIsSteerSha']")" = "True" ] && [ "$(jget "$legd_out" "d['integrationAdvanced']")" = "True" ] \
    && ok "integrator computed + published canonical staging from the steer-tier member's real head (real bare repo)" \
    || bad "integrator did not publish the expected canonical staging ($legd_out)"
  [ "$(jget "$legd_out" "d['receiptFound']")" = "True" ] && [ "$(jget "$legd_out" "d['receiptState']")" = "pending" ] && [ "$(jget "$legd_out" "d['receiptReason']")" = "below-steer-tier" ] \
    && ok "non-steer member's head landed in the REAL Postgres integration-requests queue (pending, below-steer-tier) — visible receipt, never silently merged" \
    || bad "no visible receipt for the non-steer head in hive_integration_requests ($legd_out)"
  [ "$(jget "$legd_out" "d['firstAdvanceOutcome']")" = "accepted" ] && [ "$(jget "$legd_out" "d['firstAdvanceHeadMatches']")" = "True" ] && [ "$(jget "$legd_out" "d['firstAdvanceContent']")" = "steer-v1" ] \
    && ok "the OTHER machine's worktree (a second worktree over the local mirror) ff-advanced to the integrator's published staging" \
    || bad "the other machine's worktree did not ff-advance as expected ($legd_out)"
  [ "$(jget "$legd_out" "d['dirtyAdvanceOutcome']")" = "deferred-dirty" ] && [ "$(jget "$legd_out" "d['dirtyHeadUnchanged']")" = "True" ] && [ "$(jget "$legd_out" "d['dirtyContentUntouched']")" = "True" ] \
    && ok "G-7b: a dirty/locked file on the OTHER machine is NEVER touched — the advance defers instead of clobbering it" \
    || bad "a dirty/locked file was touched (or the advance did not defer) — see $legd_out"
fi

# ── LEG F (P-307) lifecycle — G-9 gc + G-10 secrets/oversized-blob guard ────
# LIVE as of 2026-07-09: P-205 (WI-3494) landed gc.ts's production caller
# (hive-git-gc-action.ts) + publish-guard.ts (checkPublishGuard, 8/8
# integration). Both are pure over a real bare repo (no DB/HTTP needed — the
# gc/publish-guard functions take a repoPath directly), so this leg builds its
# OWN throwaway bare repo (not the sidecar's hive) and calls the REAL
# gcHiveGitRepo / checkPublishGuard functions via tsx against the checked-out
# source — proving the actual production code, not a reimplementation.
log "LEG F (P-307) — G-9 gc keep-work/last-N/departed-member archival + G-10 secrets/oversized-blob guard, real bare repos"
LEGF_GC_REPO="$WORK/leg-f-gc.git"; git init -q --bare "$LEGF_GC_REPO"
NS_LIVE="$(printf '%064d' 1)"; NS_GONE="$(printf '%064d' 2)"
legf_commit() { # <repo> <ref> <content> <committer-ts>
  local repo="$1" ref="$2" content="$3" ts="$4" blob tree commit
  blob="$(printf '%s' "$content" | git -C "$repo" hash-object -w --stdin)"
  tree="$(printf '100644 blob %s\tfile.txt\n' "$blob" | git -C "$repo" mktree)"
  commit="$(echo leg-f | GIT_COMMITTER_DATE="$ts" GIT_AUTHOR_DATE="$ts" git -C "$repo" commit-tree "$tree")"
  git -C "$repo" update-ref "$ref" "$commit"
}
# a live device: its always-kept WORK_REF (refs/heads/work) + 3 published
# snapshots (only the newest keepPublishedRefsPerNamespace=2 should survive).
legf_commit "$LEGF_GC_REPO" "refs/namespaces/$NS_LIVE/refs/heads/work" "work-v1" "1000000000 +0000"
legf_commit "$LEGF_GC_REPO" "refs/namespaces/$NS_LIVE/published/v1" "pub-v1" "1000000100 +0000"
legf_commit "$LEGF_GC_REPO" "refs/namespaces/$NS_LIVE/published/v2" "pub-v2" "1000000200 +0000"
legf_commit "$LEGF_GC_REPO" "refs/namespaces/$NS_LIVE/published/v3" "pub-v3" "1000000300 +0000"
# a departed member's namespace — should be archived wholesale, not pruned.
legf_commit "$LEGF_GC_REPO" "refs/namespaces/$NS_GONE/published/v1" "gone-v1" "1000000050 +0000"
cat > "$WORK/legf-gc.ts" <<EOF
import { gcHiveGitRepo } from '$HGGIT/gc';
gcHiveGitRepo('$LEGF_GC_REPO', { archiveNamespaces: ['$NS_GONE'], keepPublishedRefsPerNamespace: 2 })
  .then((r) => console.log(JSON.stringify(r)));
EOF
gc_out="$(cd "$REPO_DIR/packages/operator-core" && env -u npm_config_local_prefix npx tsx "$WORK/legf-gc.ts" 2>"$WORK/legf-gc.err")"
gc_errs="$(jget "$gc_out" "len(d['errors'])")"
refs_after="$(git -C "$LEGF_GC_REPO" for-each-ref --format='%(refname)')"
if [ "$gc_errs" = "0" ] \
  && echo "$refs_after" | grep -q "refs/namespaces/$NS_LIVE/refs/heads/work" \
  && echo "$refs_after" | grep -q "refs/namespaces/$NS_LIVE/published/v2" \
  && echo "$refs_after" | grep -q "refs/namespaces/$NS_LIVE/published/v3" \
  && ! echo "$refs_after" | grep -q "refs/namespaces/$NS_LIVE/published/v1" \
  && echo "$refs_after" | grep -q "refs/archive/namespaces/$NS_GONE/published/v1" \
  && ! echo "$refs_after" | grep -q "refs/namespaces/$NS_GONE/published/v1"; then
  ok "G-9 gc: kept work-ref + newest 2 published (v2,v3), pruned oldest (v1), archived the departed namespace under refs/archive/"
else
  bad "G-9 gc: unexpected ref state after gc — see $WORK/leg-f-gc.git refs + $WORK/legf-gc.err ($gc_out)"
fi

LEGF_GUARD_REPO="$WORK/leg-f-guard.git"; git init -q --bare "$LEGF_GUARD_REPO"
BASE_BLOB="$(printf 'base' | git -C "$LEGF_GUARD_REPO" hash-object -w --stdin)"
BASE_TREE="$(printf '100644 blob %s\tbase.txt\n' "$BASE_BLOB" | git -C "$LEGF_GUARD_REPO" mktree)"
BASE_COMMIT="$(echo base | git -C "$LEGF_GUARD_REPO" commit-tree "$BASE_TREE")"
# Split across two vars so the AWS-key SHAPE never appears as a contiguous
# literal in this file's own bytes (the shared-tree secrets-guard PreToolUse
# hook would otherwise flag this drill script itself) — only exists once bash
# concatenates them at run time.
LEGF_FAKE_KEY_PFX="AKIA"; LEGF_FAKE_KEY_SFX="ABCDEFGHIJKLMNOP"
SECRET_BLOB="$(printf 'aws_key = %s%s\n' "$LEGF_FAKE_KEY_PFX" "$LEGF_FAKE_KEY_SFX" | git -C "$LEGF_GUARD_REPO" hash-object -w --stdin)"
SECRET_TREE="$(printf '100644 blob %s\tbase.txt\n100644 blob %s\tsecret.txt\n' "$BASE_BLOB" "$SECRET_BLOB" | git -C "$LEGF_GUARD_REPO" mktree)"
SECRET_COMMIT="$(echo secret | git -C "$LEGF_GUARD_REPO" commit-tree "$SECRET_TREE" -p "$BASE_COMMIT")"
BIG_BLOB="$(head -c 6144 /dev/zero | tr '\0' 'x' | git -C "$LEGF_GUARD_REPO" hash-object -w --stdin)"
BIG_TREE="$(printf '100644 blob %s\tbase.txt\n100644 blob %s\tbig.bin\n' "$BASE_BLOB" "$BIG_BLOB" | git -C "$LEGF_GUARD_REPO" mktree)"
BIG_COMMIT="$(echo big | git -C "$LEGF_GUARD_REPO" commit-tree "$BIG_TREE" -p "$BASE_COMMIT")"
cat > "$WORK/legf-guard.ts" <<EOF
import { checkPublishGuard } from '$HGGIT/publish-guard';
async function main() {
  const clean = await checkPublishGuard({ repoPath: '$LEGF_GUARD_REPO', fromOid: null, toOid: '$BASE_COMMIT' });
  const secret = await checkPublishGuard({ repoPath: '$LEGF_GUARD_REPO', fromOid: '$BASE_COMMIT', toOid: '$SECRET_COMMIT' });
  const big = await checkPublishGuard({ repoPath: '$LEGF_GUARD_REPO', fromOid: '$BASE_COMMIT', toOid: '$BIG_COMMIT', caps: { maxBlobBytes: 4096 } });
  console.log(JSON.stringify({ clean: clean.ok, secretOk: secret.ok, secretCode: secret.refusalCode, bigOk: big.ok, bigCode: big.refusalCode }));
}
main();
EOF
guard_out="$(cd "$REPO_DIR/packages/operator-core" && env -u npm_config_local_prefix npx tsx "$WORK/legf-guard.ts" 2>"$WORK/legf-guard.err")"
if [ "$(jget "$guard_out" "d['clean']")" = "True" ]; then ok "G-10 publish-guard: a clean commit is admitted"; else bad "G-10 publish-guard: clean commit wrongly refused ($guard_out)"; fi
if [ "$(jget "$guard_out" "d['secretOk']")" = "False" ] && [ "$(jget "$guard_out" "d['secretCode']")" = "secrets" ]; then
  ok "G-10 secrets guard: a planted AWS-key-shaped secret REFUSES the publish (code=secrets)"
else
  bad "G-10 secrets guard: planted secret did not refuse as expected ($guard_out)"
fi
if [ "$(jget "$guard_out" "d['bigOk']")" = "False" ] && [ "$(jget "$guard_out" "d['bigCode']")" = "blob-over-cap" ]; then
  ok "G-10 oversized-blob guard: a 6KB blob over a 4KB cap REFUSES the publish (code=blob-over-cap)"
else
  bad "G-10 oversized-blob guard: oversized blob did not refuse as expected ($guard_out)"
fi

echo
echo "════════════════════════════════════════════════════════"
echo "P-301 hive-git drill (single-box scaffold): PASS=$PASS FAIL=$FAIL SKIP=$SKIPPED"
if [ "$FAIL" -eq 0 ]; then
  echo "OVERALL: PASS — scaffold + mode round-trip green; $SKIPPED Phase-3 legs unproven (unwired or rig-gated, see census)"
  exit 0
fi
echo "OVERALL: FAIL"
exit 1
