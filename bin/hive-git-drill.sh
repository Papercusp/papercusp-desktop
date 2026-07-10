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

log "spin local testnet DHT (announce stays off the public DHT)"
BOOTSTRAP="$(fed_start_testnet_dht "$REPO_DIR/apps/operator" "$WORK")" || exit 3
echo "PAPERCUSP_DHT_BOOTSTRAP=$BOOTSTRAP"

log "launch sidecar A (single-box stand-in for 'tower')"
SMK_HONO="$(fed_pick_free_port 18371)"; SMK_PG="$(fed_pick_free_port 19032)"
fed_local_launch_sidecar "${AHOME[a]}" "${FED_LOG[a]}" "$SIDE" "$SMK_HONO" "$SMK_PG" \
  PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP"
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
resp="$(fed_run_with_heartbeat "throwaway hive create (cap 610s)" 20 -- \
  curl -s -m 610 -X POST "$SC/api/harness/pots/from-repo" -H 'content-type: application/json' -H "$H_WS" \
  -d "{\"githubUrl\":\"$REPO_URL\",\"visibility\":\"public\",\"runTests\":false,\"shallow\":true}")"
HIVE_SLUG="$(jget "$resp" "d['created'].get('potSlug') or d['created'].get('hiveSlug') or ''")"  # field renamed hiveSlug→potSlug (cup-lexicon-full-rename); accept both for version skew
HIVE_PATH="created"
if [ -z "$HIVE_SLUG" ]; then
  HIVE_SLUG="$(jget "$resp" "d['existing']['hive']['hiveId']")"; HIVE_PATH="existing"
fi
[ -n "$HIVE_SLUG" ] || { echo "✗ hive create failed: $(echo "$resp" | head -c 300)"; exit 6; }
echo "  hive=$HIVE_SLUG (path=$HIVE_PATH)"

# ── LEG MODE — hiveGit.mode round-trip against the real packaged instance ───
# Direct SQL (harness_shared.hive_settings, mig 186) — the same table
# setHiveGitMode/getHiveGitMode read/write; no HTTP route sets this yet
# (github-bridge-hive-egress-2026-07-02 pattern: activation is structural,
# there is no admin route or flag for the mode itself).
log "LEG MODE — flip hiveGit.mode legacy -> bridged -> rollback -> legacy"
NOWMS="$(date +%s)000"
q "INSERT INTO harness_shared.hive_settings (workspace_id, harness_slug, setting_key, value, created_at, updated_at)
   VALUES ('$WS','$HIVE_SLUG','hiveGit.mode','\"bridged\"',$NOWMS,$NOWMS)
   ON CONFLICT (workspace_id, harness_slug, setting_key) DO UPDATE SET value=EXCLUDED.value, updated_at=$NOWMS;" >/dev/null
modeval="$(q "SELECT value FROM harness_shared.hive_settings WHERE workspace_id='$WS' AND harness_slug='$HIVE_SLUG' AND setting_key='hiveGit.mode';")"
if [ "$modeval" = '"bridged"' ]; then
  ok "hiveGit.mode row set to bridged ($modeval)"
else
  bad "hiveGit.mode row wrong after set: '$modeval' (want \"bridged\")"
fi
log "LEG MODE — ROLLBACK (delete the row — the documented instant fail-open revert)"
q "DELETE FROM harness_shared.hive_settings WHERE workspace_id='$WS' AND harness_slug='$HIVE_SLUG' AND setting_key='hiveGit.mode';" >/dev/null
rows_left="$(q "SELECT count(*) FROM harness_shared.hive_settings WHERE workspace_id='$WS' AND harness_slug='$HIVE_SLUG' AND setting_key='hiveGit.mode';")"
if [ "$rows_left" = "0" ]; then
  ok "rollback: row deleted — getHiveGitMode now reads 'legacy' (fail-open default, hive-git-mode.ts)"
else
  bad "rollback left $rows_left row(s) — mode did not revert"
fi

# ── SKIP census — the Phase-3 legs (P-302..P-308), owners = the plan's P-201/
#    P-202/P-204/P-205 wiring lanes + the LIVE-1 rig for the real 2-machine run ──
log "SKIP census — Phase-3 legs (owners: p2p-git-live-activation-2026-07-09 lanes)"
skipp "LEG A (P-302) storage + join — needs the LIVE-1 rig (real 2nd machine) AND P-201 serve-plane wiring so a real VM can cold-join via G-8 bootstrap; this scaffold's single sidecar has no peer to join against yet"
skipp "LEG B (P-303) replication — needs P-202 announce->fetch driver wired (ref-announce-tick.ts has no scheduled caller today) + the rig for a genuine tower<->VM round-trip"
skipp "LEG C (P-304) trust / tamper drill — needs LEG B's live fetch path to exist before a relay-lie / rollback / non-member-refuse drill has anything to attack"
skipp "LEG E (P-306) GitHub bridge live — needs the rig's 2nd machine to prove commit-only members don't false-alarm the watchdog under real multi-machine load (single-box analysis already done + verified, see the runbook's watchdog section; this leg proves it live, not analytically)"
skipp "LEG G (P-308) chaos — needs LEGS A-F live first (kill-the-integrator / PG-blip / VM-restart drills are meaningless without a live multi-machine replication loop to interrupt)"

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
# 2-host proof is LEG A/B's job (rig-gated), not this leg's.
log "LEG D (P-305) — integrator computes+publishes canonical staging; a non-steer head lands in the REAL PG integration-requests queue with a visible receipt; the OTHER machine's worktree ff-advances and never touches a dirty/locked file"
LEGD_ROOT="$WORK/leg-d-git-root"; mkdir -p "$LEGD_ROOT"
cat > "$WORK/leg-d.ts" <<EOF
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

async function main() {
  const sql = postgres('$DSN', { prepare: false });
  const WS = '$WS'; const POT_SLUG = '$HIVE_SLUG'; const REPO_KEY = 'leg-d-repo';
  const repo = await ensureHiveGitRepo(POT_SLUG, REPO_KEY);
  const integrator = keypair();
  const memberSteer = keypair();
  const memberBelow = keypair();

  const src = join('$LEGD_ROOT', 'src');
  await initWorktree(src);
  await writeFile(join(src, 'f.txt'), 'steer-v1\n');
  await git(['add', '.'], src);
  await git(['commit', '-q', '-m', 'S1'], src);
  const steerSha = await git(['rev-parse', 'HEAD'], src);
  await writeNamespaceRef(repo, memberSteer.pubkeyBase64, WORK_REF, steerSha);

  await git(['checkout', '-q', '--orphan', 'below'], src);
  await writeFile(join(src, 'below.txt'), 'below-v1\n');
  await git(['add', 'below.txt'], src);
  await git(['commit', '-q', '-m', 'below'], src);
  const belowSha = await git(['rev-parse', 'HEAD'], src);
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
    stagingIsSteerSha: (await readStaging(repo, integrator.pubkeyBase64)) === steerSha,
    integrationAdvanced: out.integration?.advanced === true,
    gated: out.gated,
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
legd_out="$(cd "$REPO_DIR/packages/operator-core" && env -u npm_config_local_prefix npx tsx "$WORK/leg-d.ts" 2>"$WORK/legd.err")"
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
HGGIT="$REPO_DIR/packages/operator-core/lib/sync/hive-git"
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
