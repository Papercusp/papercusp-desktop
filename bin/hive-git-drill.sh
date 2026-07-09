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
# TODAY'S STATUS (2026-07-09 — re-verify against the runbook doc + `git log -p
# -- packages/operator-core/lib/harness/git-sync/git-sync-action.ts` before
# trusting this): only the github-bridge tick + the integrator tick are wired
# into production (gated on hiveGit.mode != legacy). The serve plane (P-201),
# announce->fetch driver (P-202), worktree-bridge driver (P-204), and
# gc/secrets-guard-on-the-publish-path (P-205) are NOT wired yet. So every
# Phase-3 leg below (A-G) is SKIP today — this run proves the SCAFFOLD works
# (real packaged sidecar, real throwaway hive, real hive_settings row), not
# the replication plane itself.
#
# LIVE today, single-box, no rig needed:
#   MODE   hiveGit.mode round-trip against the packaged sidecar's OWN PG:
#          unset(legacy) -> bridged -> ROLLBACK(delete row) -> unset(legacy).
#          Exercises exactly the rollback lever the runbook documents (the
#          fail-open coercion itself is unit-tested in hive-git-mode.test.ts;
#          this proves the STORAGE round-trip against a real packaged instance).
#
# Two-machine (tower<->VM) legs need the LIVE-1 rig
# (docs/plans/LIVE-1-rig-runbook-2026-07-02.md, owned by the plan leader +
# su-4dc3befd's WI-1729 lane) — this scaffold boots ONE local packaged
# instance (single-box, like work-distribution-drill.sh's "single-box live
# subset") so the harness (workspace + throwaway hive + a real sidecar) exists
# and is exercised end-to-end today. A genuine 2-node run substitutes the rig
# for this local instance once P-201/P-202/P-204 land — see
# two-instance-federation-smoke.sh / bin/vm-federation.sh for the 2-instance
# and real-VM driver patterns this would graduate to.
#
# Usage: bin/hive-git-drill.sh [path/to/Papercusp*.deb]
#   KEEP_UP=1   leave the sidecar running for inspection
set -uo pipefail
DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"

REPO_DIR="${PAPERCUSP_REPO_DIR:-/home/marsh-office/papercupai-workspace/papercusp}"
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
wresp="$(curl -s -m 30 -X POST "$SC/api/workspaces" -H 'content-type: application/json' \
  -d '{"name":"P-301 hive-git drill"}')"
WS="$(jget "$wresp" "d.get('id') or (d.get('workspace') or {}).get('id') or ''")"
[ -n "$WS" ] || WS="$(jget "$wresp" "d['workspaces'][0]['id']")"
[ -n "$WS" ] || { echo "✗ workspace create failed: $(echo "$wresp" | head -c 300)"; exit 6; }
echo "  workspace=$WS"
H_WS="x-papercusp-workspace: $WS"

log "create THROWAWAY test hive ($REPO_URL)"
resp="$(curl -s -m 610 -X POST "$SC/api/harness/pots/from-repo" -H 'content-type: application/json' -H "$H_WS" \
  -d "{\"githubUrl\":\"$REPO_URL\",\"visibility\":\"public\",\"runTests\":false,\"shallow\":true}")"
HIVE_SLUG="$(jget "$resp" "d['created']['hiveSlug']")"
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
skipp "LEG D (P-305) integration — needs P-204 worktree-bridge driver wired (staging-advance event has no worktree consumer yet) so the OTHER machine's tree can be observed advancing ff-only"
skipp "LEG E (P-306) GitHub bridge live — needs the rig's 2nd machine to prove commit-only members don't false-alarm the watchdog under real multi-machine load (single-box analysis already done + verified, see the runbook's watchdog section; this leg proves it live, not analytically)"
skipp "LEG F (P-307) lifecycle — needs P-205 G-9 gc scheduling + G-10 secrets/oversized-blob guard wired onto the publish path (gc.ts has no production caller today)"
skipp "LEG G (P-308) chaos — needs LEGS A-F live first (kill-the-integrator / PG-blip / VM-restart drills are meaningless without a live multi-machine replication loop to interrupt)"

echo
echo "════════════════════════════════════════════════════════"
echo "P-301 hive-git drill (single-box scaffold): PASS=$PASS FAIL=$FAIL SKIP=$SKIPPED"
if [ "$FAIL" -eq 0 ]; then
  echo "OVERALL: PASS — scaffold + mode round-trip green; $SKIPPED Phase-3 legs unproven (unwired or rig-gated, see census)"
  exit 0
fi
echo "OVERALL: FAIL"
exit 1
