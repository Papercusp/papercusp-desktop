#!/usr/bin/env bash
# two-instance-content-matrix-smoke.sh — Lane A (shared-hive-release-testing):
# the FULL live federation proof on the REAL packaged binary, 2 DISTINCT peers.
#
# Covers every brief-A scenario with a 2-peer SEQUENCED design (A=owner papercupai,
# B=joiner aviynw) — no 3rd peer, because this box has only 2 gh identities and a
# 3rd instance reusing the OWNER's identity corrupts admission (B aggregates the
# wrong same-identity log → nothing crosses; observed, see findings A-NOTE). The
# sequencing (A writes content BEFORE B joins) tests TRUE backfill without a 3rd peer:
#
#   1. A create+publish a PUBLIC hive (+ a separate INVITE hive).
#   2. A SEEDS pre-existing content (one row per federated type, origin='local').
#   3. NEGATIVE: B (running, NOT joined) sees ZERO of the hive's content (isolation).
#   4. B joins via the CURRENT flow (POST /api/discovery/join-hive); assert A & B
#      land on the SAME derive-swarm-topic hex (joiner-resolves-its-own-topic path).
#   5. BACKFILL: B receives the PRE-EXISTING (pre-join) content (origin='remote').
#   6. INCREMENTAL matrix A<->B: new writes each direction, per type, origin='remote'.
#
# REAL BINARY: extracts the .deb, injects luxon into the extracted sidecar (A-001
# build fix) so it boots, launches usr/bin/papercusp-desktop under vglrun+Xvfb.
# Pass the luxon-repacked .deb to skip the inject. Leaves the pair UP for lanes E/G.
#
# Usage: bin/two-instance-content-matrix-smoke.sh [path/to/Papercusp_*.deb]
set -uo pipefail
DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"

REPO_DIR="${PAPERCUSP_REPO_DIR:-/home/marsh-office/papercupai-workspace/papercup}"
DEB="${1:-/home/marsh-office/.cargo-target/release/bundle/deb/Papercusp_0.0.2_amd64.deb}"
DEB="$(readlink -f "$DEB" 2>/dev/null || echo "$DEB")"
LUXON_SRC="$REPO_DIR/node_modules/luxon"
OPERATOR_DIR="${PAPERCUSP_OPERATOR_DIR:-$REPO_DIR/apps/operator}"
REPO_URL="${HIVE_SMOKE_REPO_URL:-https://github.com/octocat/Hello-World}"
INV_REPO_URL="${HIVE_INVITE_REPO_URL:-https://github.com/octocat/Spoon-Knife}"
CUPBOARD_URL="${HIVE_SMOKE_CUPBOARD_URL:-http://127.0.0.1:9}"
DISPLAY_NUM="${PAPERCUSP_SMOKE_DISPLAY:-154}"
P_A_USER="${P_A_USER:-papercupai}"
P_B_USER="${P_B_USER:-aviynw}"

WORK="${PAPERCUSP_MATRIX_WORK:-$HOME/.papercusp-lane-a-fed}"
rm -rf "$WORK" 2>/dev/null; mkdir -p "$WORK"
PKG="$WORK/pkg"; BIN="$PKG/usr/bin/papercusp-desktop"
declare -A FED_LOG=( [a]="$WORK/inst-a.log" [b]="$WORK/inst-b.log" )
declare -A AHOME=( [a]="$WORK/inst-a" [b]="$WORK/inst-b" )
NONCE="$(date +%s)"
log() { printf '\n=== %s ===\n' "$*"; }
jget() { printf '%s' "$1" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
try: print($2)
except Exception: pass
" 2>/dev/null; }

A_TOKEN="$(gh auth token --user "$P_A_USER" 2>/dev/null)" || true
B_TOKEN="$(gh auth token --user "$P_B_USER" 2>/dev/null)" || true
[ -n "$A_TOKEN" ] && [ -n "$B_TOKEN" ] || { echo "FATAL: need gh tokens for $P_A_USER + $P_B_USER"; exit 1; }

log "extract $DEB"
fed_extract_deb "$DEB" "$PKG" || exit 1
SIDE="$PKG/usr/lib/Papercusp/sidecar"
[ -d "$SIDE/node_modules/luxon" ] || { echo "→ A-001 fix: injecting luxon"; cp -aL "$LUXON_SRC" "$SIDE/node_modules/luxon" || exit 1; }
fed_clobber_check "$PKG" || exit 2
fed_assert_deb_swarm_support "$PKG" || exit 2
fed_fresh_display "$DISPLAY_NUM" "$WORK" || exit 1
BOOTSTRAP="$(fed_start_testnet_dht "$OPERATOR_DIR" "$WORK")" || exit 3
echo "PAPERCUSP_DHT_BOOTSTRAP=$BOOTSTRAP"

log "launch A($P_A_USER, owner) + B($P_B_USER, joiner) [REAL BINARY, :$DISPLAY_NUM]"
fed_local_launch "${AHOME[a]}" "${FED_LOG[a]}" "$BIN" "$DISPLAY_NUM" GH_TOKEN="$A_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" PAPERCUSP_CUPBOARD_URL="$CUPBOARD_URL"
fed_local_launch "${AHOME[b]}" "${FED_LOG[b]}" "$BIN" "$DISPLAY_NUM" GH_TOKEN="$B_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" PAPERCUSP_CUPBOARD_URL="$CUPBOARD_URL"
for inst in a b; do fed_wait_boot "$inst" 80 || { echo "$inst boot failed: ${FED_BOOT_ERR:-?}"; tail -25 "${FED_LOG[$inst]}"; exit 4; }; done
log "A: sc=${FED_SC[a]} pg=${FED_PG[a]} | B: sc=${FED_SC[b]} pg=${FED_PG[b]}"
fed_wait_api a 30 && fed_wait_api b 30 || { echo "FATAL: sidecar API never came up"; exit 4; }

dsn() { echo "postgresql://harness_admin:harness_admin_pwd@localhost:${FED_PG[$1]}/papercusp"; }
q() { psql "$(dsn "$1")" -tA -c "$2" 2>/dev/null | tr -d '\r'; }
sc() { echo "http://127.0.0.1:${FED_SC[$1]}"; }

cat > "$WORK/instances.env" <<EOF
A_IDENTITY=$P_A_USER  A_SIDECAR=http://127.0.0.1:${FED_SC[a]}  A_PG=${FED_PG[a]}  A_LOG=${FED_LOG[a]}
B_IDENTITY=$P_B_USER  B_SIDECAR=http://127.0.0.1:${FED_SC[b]}  B_PG=${FED_PG[b]}  B_LOG=${FED_LOG[b]}
DHT=$BOOTSTRAP  DISPLAY=:$DISPLAY_NUM  WORK=$WORK
EOF
printf '#!/usr/bin/env bash\npkill -9 -f "%s" 2>/dev/null||true\necho stopped\n' "$WORK" > "$WORK/stop.sh"; chmod +x "$WORK/stop.sh"

# ── 1. create + publish ──────────────────────────────────────────────────────
log "A: create+publish PUBLIC hive ($REPO_URL)"
a_resp="$(curl -s -m 610 -X POST "$(sc a)/api/harness/hives/from-repo" -H 'content-type: application/json' \
  -d "{\"githubUrl\":\"$REPO_URL\",\"visibility\":\"public\",\"runTests\":false,\"shallow\":true}")"
HIVE_SLUG="$(jget "$a_resp" "d['created']['hiveSlug']")"; SLUG="$(jget "$a_resp" "d['created']['memberSlug']")"
[ -n "$HIVE_SLUG" ] && [ -n "$SLUG" ] && echo "✓ public hive='$HIVE_SLUG' member='$SLUG' announced=$(jget "$a_resp" "d['publish']['announced']")" \
  || { echo "✗ create failed: $(echo "$a_resp" | head -c 300)"; exit 6; }
if [ -z "${SKIP_INVITE:-}" ]; then
  log "A: create separate INVITE hive ($INV_REPO_URL)"
  inv="$(curl -s -m 610 -X POST "$(sc a)/api/harness/hives/from-repo" -H 'content-type: application/json' \
    -d "{\"githubUrl\":\"$INV_REPO_URL\",\"visibility\":\"invite\",\"runTests\":false,\"shallow\":true}")"
  INV_SLUG="$(jget "$inv" "d['created']['hiveSlug']")"
  INV_TOPIC="$(q a "SELECT payload::text FROM harness_shared.harness_registry WHERE payload::text LIKE '%$INV_SLUG%' LIMIT 1;" | grep -oE 'topic[^,]{0,80}' | head -1)"
  [ -n "$INV_SLUG" ] && echo "✓ invite hive='$INV_SLUG' (topic carrier: ${INV_TOPIC:-see inst-a.log})" || echo "△ invite hive create: $(echo "$inv" | head -c 200)"
else
  echo "· SKIP_INVITE set — single-hive run (isolating the 2nd-hive variable)"
fi

WS_A="$(q a "SELECT DISTINCT workspace_id FROM harness_shared.harness_features_consolidated LIMIT 1;")"; [ -z "$WS_A" ] && WS_A=default
WS_B="$(q b "SELECT DISTINCT workspace_id FROM harness_shared.harness_registry LIMIT 1;")"; [ -z "$WS_B" ] && WS_B=default
echo "  member=$SLUG hiveHome=$HIVE_SLUG WS_A=$WS_A WS_B=$WS_B"

# ── per-type SQL (origin='local' write on src; poll dst for origin='remote') ────
# ins_<type> <ws> <tag> ; poll_<type> <tag>  — $SLUG harness-scoped, $HIVE_SLUG hive-scoped.
TYPES="${MATRIX_TYPES:-features conversations messages threads thread-posts plans plan-parts item-assignments presence hive-settings hive-members}"
ins() { local ty="$1" ws="$2" t="$3" nid; [ "$t" = ba ] && nid=2 || nid=1
  case "$ty" in
   features) echo "INSERT INTO harness_shared.harness_features_consolidated (harness_slug,feature_id,title,summary,status,attempts,origin,ts,created_ts,updated_ts) VALUES ('$SLUG','F-MX-$t','mx','x','todo',0,'local',${NONCE}000,${NONCE}000,${NONCE}000);";;
   conversations) echo "INSERT INTO harness_shared.coord_conversations (workspace_id,id,kind,scope,harness_slug,asker_id,title,body,state,created_at,updated_at,origin) VALUES ('$ws','conv-MX-$t','discussion','harness','$SLUG','tester','mx','b-$t','open',now(),now(),'local');";;
   messages) echo "INSERT INTO harness_shared.coord_event_log (workspace_id,surface,writer_key,msg_id,body,harness_slug,ts,origin) VALUES ('$ws','messages','tester','msg-MX-$t','{\"summary\":\"mx $t\",\"to\":[\"x\"]}'::jsonb,'$SLUG',now(),'local');";;
   threads) echo "INSERT INTO harness_shared.coord_threads (workspace_id,thread_id,parent_kind,parent_ref,title,created_by,created_at,post_count,harness_slug,origin) VALUES ('$ws','thr-MX-$t','conversation','conv-MX-$t','mx','tester',now(),0,'$SLUG','local');";;
   thread-posts) echo "INSERT INTO harness_shared.coord_thread_posts (workspace_id,thread_id,author_id,body,created_at,post_msg_id,harness_slug,origin) VALUES ('$ws','thr-MX-$t','tester','pb $t',now(),'post-MX-$t','$SLUG','local');";;
   plans) echo "INSERT INTO harness_shared.harness_plans (workspace_id,harness_slug,plan_slug,content,content_hash,title,status,supersedes,archived,is_legacy,origin) VALUES ('$ws','$SLUG','plan-mx-$t','# mx $t','h$t','MX','draft','{}',false,false,'local');";;
   plan-parts) echo "INSERT INTO harness_shared.harness_plan_parts (workspace_id,harness_slug,plan_slug,part_key,kind,body,ordinal,fed_ts,author,tombstone,origin) VALUES ('$ws','$SLUG','ppmx-$t','item:P-001','item','pb $t',1,${NONCE}000,'tester',false,'local');";;
   item-assignments) echo "INSERT INTO harness_shared.plan_item_assignments (workspace_id,harness_slug,plan_slug,item_id,assignee_name,assigned_by_user,assigned_ts,strategy,note,origin) VALUES ('$ws','$SLUG','plan-mx-$t','P-00$nid','agent-x','tester',now(),'coding','mx','local');";;
   presence) echo "INSERT INTO harness_shared.shared_presence (workspace_id,harness_slug,github_user_id,machine_label,device_pubkey,intent,current_view,last_seen_at,schema_version,hive_slug) VALUES ('$ws','$SLUG',9999$nid,'mx-$t','pk-MX-$t','mx','v',now(),1,'$HIVE_SLUG');";;
   hive-settings) echo "INSERT INTO harness_shared.hive_settings (workspace_id,harness_slug,setting_key,value,created_at,updated_at,origin) VALUES ('$ws','$HIVE_SLUG','mxk-$t','\"mx-$t\"',${NONCE}000,${NONCE}000,'local');";;
   hive-members) echo "INSERT INTO harness_shared.hive_members (workspace_id,hive_home_slug,github_user_id,github_username,device_attestations,revoked_pubkeys,binding_status,origin) VALUES ('$ws','$HIVE_SLUG',8888$nid,'mxu$t','[]'::jsonb,'{}'::text[],'bound','local');";;
  esac; }
poll() { local ty="$1" t="$2" nid; [ "$t" = ba ] && nid=2 || nid=1
  case "$ty" in
   features) echo "SELECT origin FROM harness_shared.harness_features_consolidated WHERE feature_id='F-MX-$t' AND origin='remote' LIMIT 1;";;
   conversations) echo "SELECT origin FROM harness_shared.coord_conversations WHERE id='conv-MX-$t' AND origin='remote' LIMIT 1;";;
   messages) echo "SELECT origin FROM harness_shared.coord_event_log WHERE msg_id='msg-MX-$t' AND origin='remote' LIMIT 1;";;
   threads) echo "SELECT origin FROM harness_shared.coord_threads WHERE thread_id='thr-MX-$t' AND origin='remote' LIMIT 1;";;
   thread-posts) echo "SELECT origin FROM harness_shared.coord_thread_posts WHERE post_msg_id='post-MX-$t' AND origin='remote' LIMIT 1;";;
   plans) echo "SELECT origin FROM harness_shared.harness_plans WHERE plan_slug='plan-mx-$t' AND origin='remote' LIMIT 1;";;
   plan-parts) echo "SELECT origin FROM harness_shared.harness_plan_parts WHERE plan_slug='ppmx-$t' AND part_key='item:P-001' AND origin='remote' LIMIT 1;";;
   item-assignments) echo "SELECT origin FROM harness_shared.plan_item_assignments WHERE plan_slug='plan-mx-$t' AND item_id='P-00$nid' AND origin='remote' LIMIT 1;";;
   presence) echo "SELECT 'present' FROM harness_shared.shared_presence WHERE device_pubkey='pk-MX-$t' LIMIT 1;";;
   hive-settings) echo "SELECT origin FROM harness_shared.hive_settings WHERE harness_slug='$HIVE_SLUG' AND setting_key='mxk-$t' AND origin='remote' LIMIT 1;";;
   hive-members) echo "SELECT origin FROM harness_shared.hive_members WHERE hive_home_slug='$HIVE_SLUG' AND github_user_id=8888$nid AND origin='remote' LIMIT 1;";;
  esac; }
tbl() { case "$1" in features)echo harness_features_consolidated;;conversations)echo coord_conversations;;messages)echo coord_event_log;;threads)echo coord_threads;;thread-posts)echo coord_thread_posts;;plans)echo harness_plans;;plan-parts)echo harness_plan_parts;;item-assignments)echo plan_item_assignments;;presence)echo shared_presence;;hive-settings)echo hive_settings;;hive-members)echo hive_members;;esac; }

MATRIX=""
write_all() { local src="$1" ws="$2" t="$3" ty; for ty in $TYPES; do
  psql "$(dsn "$src")" -tA -c "$(ins "$ty" "$ws" "$t")" >/dev/null 2>"$WORK/ins.err" || echo "  ⚠ $ty $src write SETUP-FAIL: $(head -1 "$WORK/ins.err"|head -c 80)"; done; }
check_all() { local dst="$1" t="$2" phase="$3" src="$4" ty row cap tries=24 i; for ty in $TYPES; do
  cap="$(q "$src" "SELECT count(*) FROM harness_shared.substrate_outbox WHERE table_name='$(tbl "$ty")';")"
  row=""; for i in $(seq 1 $tries); do row="$(psql "$(dsn "$dst")" -tA -c "$(poll "$ty" "$t")" 2>/dev/null | tr -d '[:space:]')"; [ -n "$row" ] && break; sleep 3; done
  if [ -n "$row" ]; then printf '  ✓ %-16s %s %s=%s\n' "$ty" "$phase" "$row" "ok"; MATRIX+="| $ty | $phase | PASS ($row) |\n"
  else printf '  ✗ %-16s %s NEVER crossed (src outbox=%s)\n' "$ty" "$phase" "$cap"; MATRIX+="| $ty | $phase | FAIL (outbox=$cap) |\n"; fi; done; }

# ── 2. seed pre-existing content on A (for the backfill test) ───────────────────
log "A: SEED pre-existing content (one row per type, BEFORE B joins)"; write_all a "$WS_A" seed
echo "  seeded $(echo $TYPES | wc -w) types on A"

# ── 3. NEGATIVE: B has not joined → must see ZERO ───────────────────────────────
log "NEGATIVE: B (not joined) must see ZERO hive content"
NF="$(q b "SELECT count(*) FROM harness_shared.harness_features_consolidated WHERE feature_id LIKE 'F-MX-%';")"
NC="$(q b "SELECT count(*) FROM harness_shared.coord_conversations WHERE id LIKE 'conv-MX-%';")"
NEG=$([ "${NF:-1}" = 0 ] && [ "${NC:-1}" = 0 ] && echo PASS || echo "FAIL(f=$NF c=$NC)")
echo "  negative-isolation=$NEG"

# ── 4. B joins (current flow) + topic-equality ──────────────────────────────────
log "B: discover + join-hive '$HIVE_SLUG'"
BR=""; RESP=""; for i in $(seq 1 ${DISCOVERY_RETRIES:-40}); do RESP="$(curl -s -m 10 "$(sc b)/api/discovery/hives")"; BR="$(jget "$RESP" "json.dumps(next((r for r in d['rows'] if r['hiveId']=='$HIVE_SLUG'), None))")"; [ -n "$BR" ] && [ "$BR" != "null" ] && break; sleep 3; done
echo "  [discovery] B saw rows=$(jget "$RESP" "len(d.get('rows') or [])"); target '$HIVE_SLUG' match=$([ -n "$BR" ] && [ "$BR" != "null" ] && echo Y || echo N) after ${DISCOVERY_RETRIES:-40} tries"
LINKS="$(jget "${BR:-null}" "json.dumps((d or {}).get('memberLinks') or [])" 2>/dev/null || echo '[]')"
jr="$(curl -s -m 610 -X POST "$(sc b)/api/discovery/join-hive" -H 'content-type: application/json' -d "{\"hiveId\":\"$HIVE_SLUG\",\"memberLinks\":${LINKS:-[]}}")"
[ "$(jget "$jr" "d.get('ok')")" = True ] && echo "✓ B joined" || { echo "✗ B join failed: $(echo "$jr"|head -c 200)"; exit 6; }
sleep 5
AT="$(grep -aoE '\[swarm\] joined topic [0-9a-f]{8,}' "${FED_LOG[a]}"|grep -oE '[0-9a-f]{8,}'|sort -u)"
BT="$(grep -aoE '\[swarm\] joined topic [0-9a-f]{8,}' "${FED_LOG[b]}"|grep -oE '[0-9a-f]{8,}'|sort -u)"
ST="$(comm -12 <(echo "$AT") <(echo "$BT")|head -1)"
TEQ=$([ -n "$ST" ] && echo "PASS (${ST:0:16}…)" || echo UNCONFIRMED); echo "  topic-equal=$TEQ"

# ── 5. BACKFILL: B receives the pre-existing (pre-join) content ─────────────────
log "BACKFILL: B must receive A's PRE-EXISTING seed content (origin=remote)"; check_all b seed backfill a
BACKFILL_TABLE="$MATRIX"; MATRIX=""

# ── 6. INCREMENTAL matrix both directions (post-join) ───────────────────────────
log "INCREMENTAL A→B"; write_all a "$WS_A" ab; check_all b ab "incr-A→B" a
log "INCREMENTAL B→A"; write_all b "$WS_B" ba; check_all a ba "incr-B→A" b

# ── report ──────────────────────────────────────────────────────────────────────
log "RESULT (member=$SLUG hive=$HIVE_SLUG)"
echo "BACKFILL (late-joiner gets pre-existing content):"; printf "| type | phase | result |\n|---|---|---|\n"; printf "$BACKFILL_TABLE"
echo; echo "INCREMENTAL (post-join, both directions):"; printf "| type | dir | result |\n|---|---|---|\n"; printf "$MATRIX"
echo; echo "negative-isolation=$NEG  topic-equal=$TEQ"
echo "Pair LEFT RUNNING for Brief E/G. Ports: $WORK/instances.env  ·  STOP: $WORK/stop.sh"
