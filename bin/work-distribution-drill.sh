#!/usr/bin/env bash
# work-distribution-drill.sh — P-007 LIVE-2 acceptance drill
# (shared-hive-p2p-release-readiness-2026-07-03 P-007; spec = p2p-work-distribution-2026-07-02
# P-305, re-homed LOCAL per D-001 — WI-1751 deprecated "infra unavailable; superseded by
# local-rig track").
#
# The drill VERIFIES the p2p-hive-git fleet's work-distribution build on the REAL packaged
# sidecar. Any silent leg = FAIL; any leg whose runtime wiring does not exist yet is an
# explicit SKIP-with-reason (never a silent green) — the SKIP census IS the release
# evidence that those legs are unproven. As the owning lanes wire each leg, its SKIP
# flips to a live assert and this drill goes greener with zero re-authoring.
#
# LIVE legs driven today (single-box, one packaged sidecar):
#   G   grant Delegate    p2p-grant-set { preset:'delegate' } → p2p_peer_grants row,
#                         capabilities expanded {chat,steer,work-offer,wake}, epoch stamped
#   M11 zero-allotment    granting confers NO allotment — resource_allotments stays empty
#                         for the grantee fleet until the host sets numbers
#   FW  in-flight session synthetic 'active' p2p_foreign_workspaces row (drill scaffold —
#                         the REAL spawn path is the unwired offer-executor, see SKIPs)
#   R   revoke → reap     p2p-grant-set { action:'revoke' } → row state='reaped', refusal
#                         receipt (grant-revoked, work-offer:reap, offer_id-threaded),
#                         grantor high-water epoch bumped, grant status flipped
#   T   p2p:trace         M21 — the timeline assembles the reap receipt by offer_id
#
# UNWIRED legs (SKIP census; owner = p2p-work-distribution-2026-07-02 lanes):
#   OFFER-PUBLISH  WIRED 2026-07-04 (WI-1935): store mig 490 + offer-store.ts +
#                  projections/work-offers.ts + publish leg offer-store-publish.ts;
#                  production caller = the D-005 seat-offer hook on resource:delegate
#                  agent_slot (reaper deferred #2 also wired: host-local offer
#                  disposition on revocation). Cross-node proof = matrix scenario
#                  seat_offer (order 56, lib/scenarios/seat-offer.sh).
#   PULL           P-103 standing-puller DORMANT by design — X11 PULLER_ACTIVATION_LANDED
#                  unflipped pending the P-003 claim-path soak
#   SPAWN          P-104 offer-executor REQUIRED injections have no production caller
#   RESULTS D-018  rides SPAWN (foreign-git-sync exists but nothing spawns to exercise it)
#   METERING       P-205 substrate LANDED (mig 483 + metering-store.ts, WI-1938 passed
#                  07-03) but NO production writer yet — spend rides the owner-gated
#                  executor leg (WI-1937), contribution rides the soak-gated puller
#                  (WI-1936); this SKIP flips only when real rows flow
#   NUDGE          P-303 push-nudge pure module unwired ("deferred to P-305 rig")
#   FED-REAP       revoke on A → reap on B needs the peer-grants projection-apply hook
#                  (revocation-reaper.ts deferred #3); the LOCAL reap path is leg R
#
# Cross-node (2-node rig) variant: WI-1910 CLOSED 2026-07-03 (leader verdict — connect
# symptom non-repro on the current deb; the 07-02 pin is lifted). WI-2006 WIRED
# 2026-07-04: the fleet-directory PUBLISH leg now authors owner-signed cards on every
# fleet lifecycle write (p2p/fleet-directory-publish.ts, hooked in agent-fleets-store;
# the scope-roster `directory?` injection was already live in boot.ts), and the
# cross-node proof is a REGISTERED MATRIX SCENARIO — bin/lib/scenarios/fleet-directory.sh
# (fleet:create on frame A → owner-signed card → origin='remote' sig-verified row in
# frame B's p2p_fleet_directory; run via bin/local-matrix.sh). Every other leg above is
# per-machine BY DESIGN (M19 allotments; LOCAL reaper/receipts/metering). Content-layer
# asserts stay OUT regardless (epoch-key class still red — WI-183).
#
# Usage: bin/work-distribution-drill.sh [path/to/Papercusp*_.deb]
#   KEEP_UP=1        leave the sidecar running for inspection
#   PAPERCUSP_DRILL_WORK=/path   override the lane home (default ~/.papercusp-drill-p007)
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
OPERATOR_DIR="${PAPERCUSP_OPERATOR_DIR:-$REPO_DIR/apps/operator}"
REPO_URL="${HIVE_SMOKE_REPO_URL:-https://github.com/octocat/Hello-World}"
CUPBOARD_URL="${HIVE_SMOKE_CUPBOARD_URL:-http://127.0.0.1:9}"   # deliberately dead (cupboard-off)
P_A_USER="${P_A_USER:-papercupai}"
DRILL_FLEET="${DRILL_FLEET:-p007-drill-fleet}"
DRILL_OFFER="p007-drill-offer-$(date +%s)"

WORK="${PAPERCUSP_DRILL_WORK:-$HOME/.papercusp-drill-p007}"
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

A_TOKEN="$(gh auth token --user "$P_A_USER" 2>/dev/null)" || true
[ -n "$A_TOKEN" ] || A_TOKEN="$(gh auth token 2>/dev/null)" || true
[ -n "$A_TOKEN" ] || { echo "FATAL: no gh token — grants need a resolved GitHub identity (X9)"; exit 2; }

log "extract $DEB"
fed_extract_deb "$DEB" "$PKG" || exit 1
SIDE="$(fed_sidecar_dir "$PKG")"
[ -d "$SIDE/node_modules/luxon" ] || { echo "→ A-001 fix: injecting luxon"; cp -aL "$LUXON_SRC" "$SIDE/node_modules/luxon" || exit 1; }
fed_clobber_check "$PKG" || exit 2

log "spin local testnet DHT (announce stays off the public DHT)"
BOOTSTRAP="$(fed_start_testnet_dht "$OPERATOR_DIR" "$WORK")" || exit 3
echo "PAPERCUSP_DHT_BOOTSTRAP=$BOOTSTRAP"

log "launch sidecar A ($P_A_USER)"
SMK_HONO="$(fed_pick_free_port 18271)"; SMK_PG="$(fed_pick_free_port 18932)"
fed_local_launch_sidecar "${AHOME[a]}" "${FED_LOG[a]}" "$SIDE" "$SMK_HONO" "$SMK_PG" \
  GH_TOKEN="$A_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" PAPERCUSP_CUPBOARD_URL="$CUPBOARD_URL"
fed_wait_boot a 80 || { echo "boot failed: ${FED_BOOT_ERR:-?}"; tail -25 "${FED_LOG[a]}"; exit 4; }
# WI-5641: don't override fed_wait_api's own default (60 tries*2s=120s, EI-521) —
# a hardcoded 30 re-introduces the boot-readiness flake EI-521 already fixed.
fed_wait_api a || { echo "FATAL: sidecar API never came up"; exit 4; }
DSN="postgresql://harness_admin:harness_admin_pwd@localhost:${FED_PG[a]}/papercusp"
q() { psql "$DSN" -tA -c "$1" 2>/dev/null | tr -d '\r'; }
SC="http://127.0.0.1:${FED_SC[a]}"
echo "  sc=${FED_SC[a]} pg=${FED_PG[a]}"

# ── workspace partition (WI-1564) ────────────────────────────────────────────
# grant-store REFUSES writes under the 'default' partition (a grant that never
# federates is dead config; a stranded revocation is a security hole). The
# product path: the GUI creates a workspace and every window stamps
# x-papercusp-workspace on its requests — the drill replicates exactly that
# (run-1 finding: curls without the header resolve 'default' → all writes refused).
log "create workspace (the GUI onboarding step the drill must replicate)"
wresp="$(curl -s -m 30 -X POST "$SC/api/workspaces" -H 'content-type: application/json' \
  -d '{"name":"P-007 Drill"}')"
WS="$(jget "$wresp" "d.get('id') or (d.get('workspace') or {}).get('id') or ''")"
[ -n "$WS" ] || WS="$(jget "$wresp" "d['workspaces'][0]['id']")"
[ -n "$WS" ] || { echo "✗ workspace create failed: $(echo "$wresp" | head -c 300)"; exit 6; }
echo "  workspace=$WS (writes below stamp x-papercusp-workspace: $WS)"
H_WS="x-papercusp-workspace: $WS"

log "create + publish PUBLIC hive ($REPO_URL)"
resp="$(curl -s -m 610 -X POST "$SC/api/harness/pots/from-repo" -H 'content-type: application/json' \
  -d "{\"githubUrl\":\"$REPO_URL\",\"visibility\":\"public\",\"runTests\":false,\"shallow\":true}")"
# Two OK shapes: fresh 'created', or 'existing' — the identity+repo hive anchor
# persists ACROSS instance homes (earlier same-identity smoke runs registered
# hello-world-hive), so a fresh home can get { ok:true, existing:{ hive:{ hiveId } } }.
HIVE_SLUG="$(jget "$resp" "d['created'].get('potSlug') or d['created'].get('hiveSlug') or ''")"  # renamed hiveSlug→potSlug; accept both for skew
HIVE_PATH="created"
if [ -z "$HIVE_SLUG" ]; then
  HIVE_SLUG="$(jget "$resp" "d['existing']['hive']['potId']")"; HIVE_PATH="existing"  # offer key renamed hiveId→potId (lookup-hive-for-repo.ts HiveHit)
fi
[ -n "$HIVE_SLUG" ] || { echo "✗ hive create failed: $(echo "$resp" | head -c 300)"; exit 6; }
echo "  hive=$HIVE_SLUG (path=$HIVE_PATH)"

# ── LEG G: grant Delegate ────────────────────────────────────────────────────
log "LEG G — grant Delegate to fleet '$DRILL_FLEET'"
g="$(curl -s -m 60 -X POST "$SC/api/agent-mcp/p2p-grant-set" -H 'content-type: application/json' -H "$H_WS" \
  -d "{\"action\":\"set\",\"potSlug\":\"$HIVE_SLUG\",\"granteeKind\":\"fleet\",\"granteeRef\":\"$DRILL_FLEET\",\"preset\":\"delegate\",\"note\":\"P-007 LIVE-2 drill\"}")"
[ "$(jget "$g" "d.get('ok')")" = "True" ] || { bad "grant-set refused: $(echo "$g" | head -c 300)"; }
grow="$(q "SELECT workspace_id||'|'||harness_slug||'|'||array_to_string(capabilities,',')||'|'||status||'|'||grantor_epoch||'|'||grantor_github_user_id FROM harness_shared.p2p_peer_grants WHERE grantee_ref='$DRILL_FLEET' AND harness_slug='$HIVE_SLUG';")"
CAPS="$(echo "$grow" | cut -d'|' -f3)"
GSTATUS="$(echo "$grow" | cut -d'|' -f4)"; EPOCH0="$(echo "$grow" | cut -d'|' -f5)"; GRANTOR="$(echo "$grow" | cut -d'|' -f6)"
if [ "$CAPS" = "chat,steer,work-offer,wake" ] && [ "$GSTATUS" = "active" ]; then
  ok "grant row live: caps expanded '$CAPS' status=active epoch=$EPOCH0 (ws=$WS grantor=$GRANTOR)"
else
  bad "grant row wrong: '$grow' (want caps chat,steer,work-offer,wake + active)"
fi

# ── LEG M11: default allotment is ZERO ───────────────────────────────────────
log "LEG M11 — granting confers NO allotment"
arows="$(q "SELECT count(*) FROM harness_shared.resource_allotments WHERE fleet_slug='$DRILL_FLEET';")"
[ "$arows" = "0" ] && ok "resource_allotments empty for '$DRILL_FLEET' (M11: grant ≠ allotment)" \
                   || bad "M11 violated: $arows allotment row(s) appeared from a bare grant"

# ── LEG A: allotment set→remove round-trip (P-201) ───────────────────────────
# su-35c3b live-verified this on the :3270 integration operator (2026-07-03);
# the drill re-proves it on the PACKAGED sidecar as a hard assertion.
log "LEG A — allotment set → row → remove → clean (P-201 two-axis store)"
as="$(curl -s -m 30 -X POST "$SC/api/agent-mcp/p2p-allotment-set" -H 'content-type: application/json' -H "$H_WS" \
  -d "{\"action\":\"set\",\"fleetSlug\":\"$DRILL_FLEET\",\"resourceKind\":\"account\",\"resourceRef\":\"p007-drill-account\",\"sharePct\":25}")"
[ "$(jget "$as" "d.get('ok')")" = "True" ] || bad "allotment set refused: $(echo "$as" | head -c 200)"
arow="$(q "SELECT share_pct||'|'||status FROM harness_shared.resource_allotments WHERE fleet_slug='$DRILL_FLEET' AND resource_ref='p007-drill-account';")"
[ "$arow" = "25|active" ] && ok "allotment row upserted (share_pct=25 status=active)" \
                          || bad "allotment row wrong: '$arow' (want 25|active)"
curl -s -m 30 -X POST "$SC/api/agent-mcp/p2p-allotment-set" -H 'content-type: application/json' -H "$H_WS" \
  -d "{\"action\":\"remove\",\"fleetSlug\":\"$DRILL_FLEET\",\"resourceKind\":\"account\",\"resourceRef\":\"p007-drill-account\"}" >/dev/null
gone="$(q "SELECT count(*) FROM harness_shared.resource_allotments WHERE fleet_slug='$DRILL_FLEET';")"
[ "$gone" = "0" ] && ok "allotment removed — table left clean" || bad "allotment remove left $gone row(s)"

# ── LEG FW: synthetic in-flight foreign session (drill scaffold) ─────────────
log "LEG FW — seed synthetic ACTIVE foreign session (real spawn path unwired, see SKIPs)"
q "INSERT INTO harness_shared.p2p_foreign_workspaces
     (workspace_id, offer_id, fleet_slug, origin_github_user_id, executor_device, root_path, clone_path, state)
   VALUES ('$WS','$DRILL_OFFER','$DRILL_FLEET', 1567022, 'p007-drill-device', '$WORK/foreign-root', '$WORK/foreign-root/clone', 'active');" >/dev/null
fw="$(q "SELECT state FROM harness_shared.p2p_foreign_workspaces WHERE offer_id='$DRILL_OFFER';")"
[ "$fw" = "active" ] && ok "foreign session row active (offer_id=$DRILL_OFFER)" || bad "seed failed: state='$fw'"

# ── LEG R: revoke → reap + receipt + epoch bump ──────────────────────────────
log "LEG R — revoke the grant; the reaper must fail-close the in-flight session"
r="$(curl -s -m 60 -X POST "$SC/api/agent-mcp/p2p-grant-set" -H 'content-type: application/json' -H "$H_WS" \
  -d "{\"action\":\"revoke\",\"potSlug\":\"$HIVE_SLUG\",\"granteeKind\":\"fleet\",\"granteeRef\":\"$DRILL_FLEET\"}")"
[ "$(jget "$r" "d.get('ok')")" = "True" ] || bad "revoke refused: $(echo "$r" | head -c 300)"
reaped=""
for i in $(seq 1 15); do
  reaped="$(q "SELECT state FROM harness_shared.p2p_foreign_workspaces WHERE offer_id='$DRILL_OFFER';")"
  [ "$reaped" = "reaped" ] && break; sleep 2
done
[ "$reaped" = "reaped" ] && ok "in-flight foreign session REAPED (fail-closed)" \
                         || bad "session NOT reaped after 30s (state='$reaped') — C6 direct-registry reap broken?"
rcpt="$(q "SELECT kind||'|'||action||'|'||coalesce(offer_id,'-') FROM harness_shared.p2p_receipts WHERE offer_id='$DRILL_OFFER' AND action='work-offer:reap';")"
[ -n "$rcpt" ] && ok "refusal receipt emitted + offer-threaded: $rcpt" \
               || bad "NO reap receipt for offer_id=$DRILL_OFFER (D-004 silent drop)"
EPOCH1="$(q "SELECT high_water_epoch FROM harness_shared.p2p_grantor_epochs WHERE grantor_github_user_id=$GRANTOR AND harness_slug='$HIVE_SLUG';")"
if [ -n "$EPOCH1" ] && [ "$EPOCH1" -gt "${EPOCH0:-0}" ] 2>/dev/null; then
  ok "grantor high-water epoch bumped $EPOCH0 → $EPOCH1 (X6 fence armed)"
else
  bad "epoch NOT bumped (was $EPOCH0, now '$EPOCH1') — stale-claim fence dead"
fi
gs2="$(q "SELECT status FROM harness_shared.p2p_peer_grants WHERE grantee_ref='$DRILL_FLEET' AND harness_slug='$HIVE_SLUG';")"
[ "$gs2" = "revoked" ] && ok "grant row status=revoked" || bad "grant status='$gs2' (want revoked)"

# ── LEG T: p2p:trace assembles the timeline ──────────────────────────────────
log "LEG T — p2p:trace (M21 offer-id thread)"
# run-1 finding: mcp-call reads $HOME/.papercusp/superuser-token — must be the
# DRILL SIDECAR's home (its own token), not the host operator's.
tr_out="$(cd "$REPO_DIR" && HOME="${AHOME[a]}" PAPERCUSP_HONO_PORT="${FED_SC[a]}" timeout 60 node scripts/mcp-call.mjs p2p:trace \
  "{\"hive\":\"$HIVE_SLUG\",\"offerId\":\"$DRILL_OFFER\"}" --harness "$HIVE_SLUG" --workspace "$WS" 2>&1)"
if echo "$tr_out" | grep -q "work-offer:reap"; then
  ok "p2p:trace shows the reap receipt for $DRILL_OFFER"
else
  # soft: the receipts row is already asserted in LEG R; trace failure here is a
  # tool/identity-scoping finding, not a lost receipt
  bad "p2p:trace did not surface the reap receipt (out: $(echo "$tr_out" | head -c 250))"
fi

# ── SKIP census: the unwired legs (release evidence, not silence) ────────────
log "SKIP census — legs with NO runtime wiring at HEAD (owners: p2p-work-distribution lanes)"
# Reasons agreed with su-35c3b (p2p-work-distribution leader, 2026-07-03 msg mr58yse5):
# wiring sequence = (1) claim-path soak → flip puller; (2) P-102 store + publish caller;
# (3) metering table; (4) executor LAST — OWNER-AUTHORITY-GATED (P-105 sandbox unbuilt,
# 4/5 axes; owner must ring the trust model). The executor gate is the hard line:
# this drill must NEVER pressure that leg green — SKIP, don't wire.
log  "OFFER-PUBLISH — WIRED (WI-1935 2026-07-04): mig-490 store + publish leg + D-005 seat-offer hook on resource:delegate; verified by matrix scenario seat_offer (order 56) — no longer a SKIP"
skipp "PULL — SKIP(activation gated on claim-path soak: X11 PULLER_ACTIVATION_LANDED unflipped by design)"
skipp "SPAWN — SKIP(owner-authority: P-105 foreign-work sandbox unbuilt; owner sign-off required — DO NOT WIRE)"
skipp "RESULTS(D-018) — SKIP(rides SPAWN; foreign-git-sync exists but nothing reaches it)"
skipp "METERING — SKIP(P-205 durable ledger table absent; needs a migration, not gated)"
skipp "NUDGE — SKIP(P-303 push-nudge wiring deferred to P-305 rig)"
skipp "FED-REAP — SKIP(peer-grants projection-apply hook missing, reaper deferred #3); LOCAL reap proven in LEG R"

echo
echo "════════════════════════════════════════════════════════"
echo "P-007 LIVE-2 drill (single-box live subset): PASS=$PASS FAIL=$FAIL SKIP=$SKIPPED"
if [ "$FAIL" -eq 0 ]; then
  echo "OVERALL: PASS — every WIRED leg green; $SKIPPED legs unproven (unwired, see census)"
  exit 0
fi
echo "OVERALL: FAIL"
exit 1
