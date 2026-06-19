#!/usr/bin/env bash
# two-instance-content-matrix-smoke.sh — Lane A (shared-hive-release-testing):
# the FULL live multi-peer federation proof on the REAL packaged binary.
#
# What the from-repo smoke proves (create→publish→join→FEATURE federation) this
# extends to the brief's complete matrix:
#   1. owner create+publish a PUBLIC hive  (+ a separate INVITE hive)
#   2. B joins via the CURRENT flow (POST /api/discovery/join-hive) — the
#      joiner-resolves-its-own-topic path; assert A & B land on the SAME
#      derive-swarm-topic hex (the topic-split-bug home)
#   3. per-content-type bidirectional sync matrix A<->B: every federated table
#      ({type x direction}: write origin='local' on src -> capture trigger ->
#      peer-log -> projection applies origin='remote' on dst within a bounded poll)
#   4. 3rd peer C joins LATE -> full backfill of PRE-EXISTING content
#   5. NEGATIVE: C BEFORE it joins (running, on the testnet DHT, not joined)
#      must see ZERO of the hive's rows  (isolation)
#
# REAL BINARY: extracts the .deb and launches usr/bin/papercusp-desktop under
# vglrun+Xvfb (fed_local_launch). It injects luxon into the extracted sidecar
# node_modules (the A-001 build fix, mirrored: build-desktop-sidecar.sh now does
# `copy_pkg_closure luxon`) so the bundle boots — without it serve.mjs throws
# `Cannot find module 'luxon'` -> EMBEDDED_PG_FAILED (the shipped .deb's bug).
#
# Leaves the trio RUNNING (stable WORK dir + stop.sh) so the live-instance lanes
# (Brief E/G) can reuse the window. Tear down with $WORK/stop.sh.
#
# Usage: bin/two-instance-content-matrix-smoke.sh [path/to/Papercusp_*.deb]
#   PAPERCUSP_SMOKE_DISPLAY=N   headless Xvfb display (default 152)
#   HIVE_SMOKE_REPO_URL=...     fixture repo (default octocat/Hello-World)
set -uo pipefail
DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"

REPO_DIR="${PAPERCUSP_REPO_DIR:-/home/marsh-office/papercupai-workspace/papercup}"
DEB="${1:-/home/marsh-office/.cargo-target/release/bundle/deb/Papercusp_0.0.2_amd64.deb}"
DEB="$(readlink -f "$DEB" 2>/dev/null || echo "$DEB")"
LUXON_SRC="$REPO_DIR/node_modules/luxon"
OPERATOR_DIR="${PAPERCUSP_OPERATOR_DIR:-$REPO_DIR/apps/operator}"
REPO_URL="${HIVE_SMOKE_REPO_URL:-https://github.com/octocat/Hello-World}"
CUPBOARD_URL="${HIVE_SMOKE_CUPBOARD_URL:-http://127.0.0.1:9}"
DISPLAY_NUM="${PAPERCUSP_SMOKE_DISPLAY:-152}"
P_A_USER="${P_A_USER:-papercupai}"
P_B_USER="${P_B_USER:-aviynw}"
P_C_USER="${P_C_USER:-papercupai}"   # only 2 gh identities; C = papercupai 2nd device (fresh HOME)

WORK="${PAPERCUSP_MATRIX_WORK:-$HOME/.papercusp-lane-a-fed}"
rm -rf "$WORK" 2>/dev/null; mkdir -p "$WORK"
PKG="$WORK/pkg"; BIN="$PKG/usr/bin/papercusp-desktop"
declare -A FED_LOG=( [a]="$WORK/inst-a.log" [b]="$WORK/inst-b.log" [c]="$WORK/inst-c.log" )
declare -A AHOME=( [a]="$WORK/inst-a" [b]="$WORK/inst-b" [c]="$WORK/inst-c" )
NONCE="$(date +%s)"
log() { printf '\n=== %s ===\n' "$*"; }
jget() { printf '%s' "$1" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
try: print($2)
except Exception: pass
" 2>/dev/null; }

# ── tokens ────────────────────────────────────────────────────────────────────
A_TOKEN="$(gh auth token --user "$P_A_USER" 2>/dev/null)" || true
B_TOKEN="$(gh auth token --user "$P_B_USER" 2>/dev/null)" || true
C_TOKEN="$(gh auth token --user "$P_C_USER" 2>/dev/null)" || true
[ -n "$A_TOKEN" ] && [ -n "$B_TOKEN" ] || { echo "FATAL: need gh tokens for $P_A_USER + $P_B_USER"; exit 1; }

# ── extract + A-001 luxon fix + integrity ──────────────────────────────────────
log "extract $DEB"
fed_extract_deb "$DEB" "$PKG" || exit 1
SIDE="$PKG/usr/lib/Papercusp/sidecar"
if [ ! -d "$SIDE/node_modules/luxon" ]; then
  echo "→ A-001 fix: injecting luxon into the extracted sidecar (the shipped .deb omits it)"
  cp -aL "$LUXON_SRC" "$SIDE/node_modules/luxon" || { echo "FATAL: could not inject luxon from $LUXON_SRC"; exit 1; }
  echo "  luxon files: $(find "$SIDE/node_modules/luxon" -type f | wc -l)"
else
  echo "  luxon already present in .deb (rebuilt) — no injection needed"
fi
fed_clobber_check "$PKG" || exit 2
fed_assert_deb_swarm_support "$PKG" || exit 2
fed_fresh_display "$DISPLAY_NUM" "$WORK" || exit 1

# ── local testnet DHT ──────────────────────────────────────────────────────────
BOOTSTRAP="$(fed_start_testnet_dht "$OPERATOR_DIR" "$WORK")" || exit 3
echo "PAPERCUSP_DHT_BOOTSTRAP=$BOOTSTRAP"

# ── launch A (owner) + B (joiner) + C (late joiner / negative) ─────────────────
log "launch A($P_A_USER) + B($P_B_USER) + C($P_C_USER 2nd device) [REAL BINARY, :$DISPLAY_NUM]"
fed_local_launch "${AHOME[a]}" "${FED_LOG[a]}" "$BIN" "$DISPLAY_NUM" GH_TOKEN="$A_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" PAPERCUSP_CUPBOARD_URL="$CUPBOARD_URL"
fed_local_launch "${AHOME[b]}" "${FED_LOG[b]}" "$BIN" "$DISPLAY_NUM" GH_TOKEN="$B_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" PAPERCUSP_CUPBOARD_URL="$CUPBOARD_URL"
fed_local_launch "${AHOME[c]}" "${FED_LOG[c]}" "$BIN" "$DISPLAY_NUM" GH_TOKEN="$C_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" PAPERCUSP_CUPBOARD_URL="$CUPBOARD_URL"

for inst in a b c; do
  fed_wait_boot "$inst" 80 || { echo "$inst boot failed: ${FED_BOOT_ERR:-?}"; tail -25 "${FED_LOG[$inst]}"; exit 4; }
done
log "A: sc=${FED_SC[a]} pg=${FED_PG[a]} | B: sc=${FED_SC[b]} pg=${FED_PG[b]} | C: sc=${FED_SC[c]} pg=${FED_PG[c]}"
fed_wait_api a 30 && fed_wait_api b 30 && fed_wait_api c 30 || { echo "FATAL: a sidecar API never came up"; exit 4; }

# stable env + stop.sh for the Brief E/G handoff (instances LEFT RUNNING)
cat > "$WORK/instances.env" <<EOF
# Lane A live trio (real binary). hiveSlug/memberSlug printed in the run log.
A_IDENTITY=$P_A_USER  A_SIDECAR=http://127.0.0.1:${FED_SC[a]}  A_PG=${FED_PG[a]}  A_LOG=${FED_LOG[a]}
B_IDENTITY=$P_B_USER  B_SIDECAR=http://127.0.0.1:${FED_SC[b]}  B_PG=${FED_PG[b]}  B_LOG=${FED_LOG[b]}
C_IDENTITY=$P_C_USER  C_SIDECAR=http://127.0.0.1:${FED_SC[c]}  C_PG=${FED_PG[c]}  C_LOG=${FED_LOG[c]}
DHT=$BOOTSTRAP  DISPLAY=:$DISPLAY_NUM  WORK=$WORK
EOF
printf '#!/usr/bin/env bash\npkill -9 -f "%s" 2>/dev/null || true\necho "Lane A trio torn down (%s)"\n' "$WORK" "$WORK" > "$WORK/stop.sh"
chmod +x "$WORK/stop.sh"

dsn() { echo "postgresql://harness_admin:harness_admin_pwd@localhost:${FED_PG[$1]}/papercusp"; }
q() { psql "$(dsn "$1")" -tA -c "$2" 2>/dev/null | tr -d '\r'; }
sc() { echo "http://127.0.0.1:${FED_SC[$1]}"; }

# ── 1. A: create + publish PUBLIC hive (from-repo, the current flow) ────────────
log "A: POST /api/harness/hives/from-repo ($REPO_URL, public)"
a_resp="$(curl -s -m 610 -X POST "$(sc a)/api/harness/hives/from-repo" -H 'content-type: application/json' \
  -d "{\"githubUrl\":\"$REPO_URL\",\"visibility\":\"public\",\"runTests\":false,\"shallow\":true}")"
HIVE_SLUG="$(jget "$a_resp" "d['created']['hiveSlug']")"
SLUG="$(jget "$a_resp" "d['created']['memberSlug']")"
A_ANN="$(jget "$a_resp" "d['publish']['announced']")"
[ -n "$HIVE_SLUG" ] && [ -n "$SLUG" ] && echo "✓ public hive='$HIVE_SLUG' member='$SLUG' announced=$A_ANN" \
  || { echo "✗ public create failed: $(echo "$a_resp" | head -c 400)"; exit 6; }

# 1b. a SEPARATE invite hive — confirm the link carries a topic
log "A: create a separate INVITE hive (visibility=invite)"
inv_resp="$(curl -s -m 610 -X POST "$(sc a)/api/harness/hives/from-repo" -H 'content-type: application/json' \
  -d "{\"githubUrl\":\"https://github.com/octocat/Spoon-Knife\",\"visibility\":\"invite\",\"runTests\":false,\"shallow\":true}")"
INV_SLUG="$(jget "$inv_resp" "d['created']['hiveSlug']")"
INV_LINK="$(jget "$inv_resp" "(d['created'].get('memberLinks') or d.get('publish',{}).get('memberLinks') or [''])[0]")"
INV_VIS="$(jget "$inv_resp" "d['created'].get('visibility') or d.get('visibility')")"
if [ -n "$INV_SLUG" ]; then
  echo "✓ invite hive='$INV_SLUG' vis=$INV_VIS link=$(printf '%s' "$INV_LINK" | head -c 60)…"
  echo "$INV_LINK" | grep -q 'topic=' && echo "✓ invite member link carries topic=" || echo "△ invite link has no topic= field (check $WORK/inst-a.log)"
else
  echo "△ invite hive create returned: $(echo "$inv_resp" | head -c 300)"
fi

# ── 2. B discovers + joins (current flow) ───────────────────────────────────────
log "B: poll /api/discovery/hives for '$HIVE_SLUG' then join-hive"
B_ROW=""; for i in $(seq 1 40); do
  B_ROW="$(jget "$(curl -s -m 10 "$(sc b)/api/discovery/hives")" "json.dumps(next(r for r in d['rows'] if r['hiveId']=='$HIVE_SLUG'))")"
  [ -n "$B_ROW" ] && break; sleep 3
done
[ -n "$B_ROW" ] && echo "✓ B discovered '$HIVE_SLUG'" || { echo "✗ B never discovered the hive"; exit 6; }
LINKS="$(jget "$B_ROW" "json.dumps(d.get('memberLinks') or [])")"
join_resp="$(curl -s -m 610 -X POST "$(sc b)/api/discovery/join-hive" -H 'content-type: application/json' \
  -d "{\"hiveId\":\"$HIVE_SLUG\",\"memberLinks\":$LINKS}")"
J_OK="$(jget "$join_resp" "d.get('ok')")"
[ "$J_OK" = "True" ] && echo "✓ B join-hive ok (view materialized + re-keyed onto hive topic)" \
  || { echo "✗ B join-hive failed: $(echo "$join_resp" | head -c 300)"; exit 6; }

# topic-equality: A & B must be on the SAME swarm topic (derive-swarm-topic hex)
sleep 5
A_TOPICS="$(grep -aoE '\[swarm\] joined topic [0-9a-f]{8,}' "${FED_LOG[a]}" 2>/dev/null | grep -oE '[0-9a-f]{8,}' | sort -u)"
B_TOPICS="$(grep -aoE '\[swarm\] joined topic [0-9a-f]{8,}' "${FED_LOG[b]}" 2>/dev/null | grep -oE '[0-9a-f]{8,}' | sort -u)"
SHARED_TOPIC="$(comm -12 <(echo "$A_TOPICS") <(echo "$B_TOPICS") | head -1)"
[ -n "$SHARED_TOPIC" ] && echo "✓ TOPIC-EQUAL: A & B both on swarm topic ${SHARED_TOPIC:0:20}… (joiner resolved owner topic)" \
  || echo "△ could not confirm a shared [swarm] topic hex from logs (federation below is the real proof)"

# resolve workspace ids (federated writes need the instance's own workspace_id)
WS_A="$(q a "SELECT workspace_id FROM harness_shared.harness_registry WHERE slug='$SLUG' LIMIT 1;")"
WS_B="$(q b "SELECT workspace_id FROM harness_shared.harness_registry WHERE slug='$SLUG' LIMIT 1;")"
[ -z "$WS_A" ] && WS_A="$(q a "SELECT DISTINCT workspace_id FROM harness_shared.substrate_outbox LIMIT 1;")"
[ -z "$WS_B" ] && WS_B="$(q b "SELECT DISTINCT workspace_id FROM harness_shared.harness_registry LIMIT 1;")"
echo "  WS_A=$WS_A  WS_B=$WS_B  member=$SLUG  hiveHome=$HIVE_SLUG"

# ── 3. per-content-type bidirectional matrix ────────────────────────────────────
MATRIX=""
# probe <label> <table> <src> <dst> <key_desc> <insert_sql> <poll_sql>
#   insert_sql runs on src (origin='local'); poll_sql on dst returns origin (or 'present').
probe() {
  local label="$1" table="$2" src="$3" dst="$4" kdesc="$5" ins="$6" poll="$7" tries=22 i row cap t0 t1
  if ! psql "$(dsn "$src")" -tA -c "$ins" >/dev/null 2>"$WORK/ins.err"; then
    printf '  ✗ %-16s %s->%s SETUP-FAIL: %s\n' "$label" "$src" "$dst" "$(head -1 "$WORK/ins.err" | head -c 90)"
    MATRIX+="| $label | $src→$dst | SETUP-FAIL |\n"; return
  fi
  cap="$(q "$src" "SELECT count(*) FROM harness_shared.substrate_outbox WHERE table_name='$table';")"
  t0="$(date +%s%3N)"
  for i in $(seq 1 $tries); do
    row="$(psql "$(dsn "$dst")" -tA -c "$poll" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$row" ] && { t1="$(date +%s%3N)"; printf '  ✓ %-16s %s->%s  origin=%s in %sms (outbox=%s)\n' "$label" "$src" "$dst" "$row" "$((t1-t0))" "$cap"; MATRIX+="| $label | $src→$dst | PASS ($row, $((t1-t0))ms) |\n"; return; }
    sleep 3
  done
  printf '  ✗ %-16s %s->%s  NEVER crossed (src outbox=%s)\n' "$label" "$src" "$dst" "$cap"
  MATRIX+="| $label | $src→$dst | FAIL (outbox=$cap) |\n"
}

run_matrix() {  # <src> <dst> <ws_src> <tag>
  local s="$1" d="$2" ws="$3" t="$4" nid
  [ "$t" = ab ] && nid=1 || nid=2   # numeric github_user_id suffix (must be int)
  probe features harness_features_consolidated "$s" "$d" feature_id \
    "INSERT INTO harness_shared.harness_features_consolidated (harness_slug,feature_id,title,summary,status,attempts,origin,ts,created_ts,updated_ts) VALUES ('$SLUG','F-MX-$t','mx feat','x','todo',0,'local',${NONCE}000,${NONCE}000,${NONCE}000);" \
    "SELECT origin FROM harness_shared.harness_features_consolidated WHERE feature_id='F-MX-$t' AND origin='remote' LIMIT 1;"
  probe conversations coord_conversations "$s" "$d" id \
    "INSERT INTO harness_shared.coord_conversations (workspace_id,id,kind,scope,harness_slug,asker_id,title,body,state,created_at,updated_at,origin) VALUES ('$ws','conv-MX-$t','discussion','harness','$SLUG','tester','mx','body-$t','open',now(),now(),'local');" \
    "SELECT origin FROM harness_shared.coord_conversations WHERE id='conv-MX-$t' AND origin='remote' LIMIT 1;"
  probe messages coord_event_log "$s" "$d" msg_id \
    "INSERT INTO harness_shared.coord_event_log (workspace_id,surface,writer_key,msg_id,body,harness_slug,ts,origin) VALUES ('$ws','messages','tester','msg-MX-$t','{\"summary\":\"mx $t\",\"to\":[\"x\"]}'::jsonb,'$SLUG',now(),'local');" \
    "SELECT origin FROM harness_shared.coord_event_log WHERE msg_id='msg-MX-$t' AND origin='remote' LIMIT 1;"
  probe threads coord_threads "$s" "$d" thread_id \
    "INSERT INTO harness_shared.coord_threads (workspace_id,thread_id,parent_kind,parent_ref,title,created_by,created_at,post_count,harness_slug,origin) VALUES ('$ws','thr-MX-$t','conversation','conv-MX-$t','mx thread','tester',now(),0,'$SLUG','local');" \
    "SELECT origin FROM harness_shared.coord_threads WHERE thread_id='thr-MX-$t' AND origin='remote' LIMIT 1;"
  probe thread-posts coord_thread_posts "$s" "$d" post_msg_id \
    "INSERT INTO harness_shared.coord_thread_posts (workspace_id,thread_id,author_id,body,created_at,post_msg_id,harness_slug,origin) VALUES ('$ws','thr-MX-$t','tester','post body $t',now(),'post-MX-$t','$SLUG','local');" \
    "SELECT origin FROM harness_shared.coord_thread_posts WHERE post_msg_id='post-MX-$t' AND origin='remote' LIMIT 1;"
  probe plans harness_plans "$s" "$d" plan_slug \
    "INSERT INTO harness_shared.harness_plans (workspace_id,harness_slug,plan_slug,content,content_hash,title,status,supersedes,archived,is_legacy,origin) VALUES ('$ws','$SLUG','plan-mx-$t','# mx plan $t','hash$t','MX plan','draft','{}',false,false,'local');" \
    "SELECT origin FROM harness_shared.harness_plans WHERE plan_slug='plan-mx-$t' AND origin='remote' LIMIT 1;"
  probe plan-parts harness_plan_parts "$s" "$d" "plan_slug:part_key" \
    "INSERT INTO harness_shared.harness_plan_parts (workspace_id,harness_slug,plan_slug,part_key,kind,body,ordinal,fed_ts,author,tombstone,origin) VALUES ('$ws','$SLUG','ppmx-$t','item:P-001','item','part body $t',1,${NONCE}000,'tester',false,'local');" \
    "SELECT origin FROM harness_shared.harness_plan_parts WHERE plan_slug='ppmx-$t' AND part_key='item:P-001' AND origin='remote' LIMIT 1;"
  probe item-assignments plan_item_assignments "$s" "$d" "plan_slug:item_id" \
    "INSERT INTO harness_shared.plan_item_assignments (workspace_id,harness_slug,plan_slug,item_id,assignee_name,assigned_by_user,assigned_ts,strategy,note,origin) VALUES ('$ws','$SLUG','plan-mx-$t','P-00$t','agent-x','tester',now(),'coding','mx','local');" \
    "SELECT origin FROM harness_shared.plan_item_assignments WHERE plan_slug='plan-mx-$t' AND item_id='P-00$t' AND origin='remote' LIMIT 1;"
  probe presence shared_presence "$s" "$d" "gh/machine" \
    "INSERT INTO harness_shared.shared_presence (workspace_id,harness_slug,github_user_id,machine_label,device_pubkey,intent,current_view,last_seen_at,schema_version,hive_slug) VALUES ('$ws','$SLUG',9999$nid,'mx-machine-$t','pk-mx-$t','mx intent','mx view',now(),1,'$HIVE_SLUG');" \
    "SELECT 'present' FROM harness_shared.shared_presence WHERE device_pubkey='pk-mx-$t' LIMIT 1;"
  probe hive-settings hive_settings "$s" "$d" setting_key \
    "INSERT INTO harness_shared.hive_settings (workspace_id,harness_slug,setting_key,value,created_at,updated_at,origin) VALUES ('$ws','$HIVE_SLUG','mx-key-$t','\"mx-$t\"',now(),now(),'local');" \
    "SELECT origin FROM harness_shared.hive_settings WHERE harness_slug='$HIVE_SLUG' AND setting_key='mx-key-$t' AND origin='remote' LIMIT 1;"
  probe hive-members hive_members "$s" "$d" github_user_id \
    "INSERT INTO harness_shared.hive_members (workspace_id,hive_home_slug,github_user_id,github_username,device_attestations,revoked_pubkeys,binding_status,origin) VALUES ('$ws','$HIVE_SLUG',8888$nid,'mxuser$t','[]'::jsonb,'{}'::text[],'bound','local');" \
    "SELECT origin FROM harness_shared.hive_members WHERE hive_home_slug='$HIVE_SLUG' AND github_user_id=8888$nid AND origin='remote' LIMIT 1;"
}

log "MATRIX A→B"; run_matrix a b "$WS_A" "ab"
log "MATRIX B→A"; run_matrix b a "$WS_B" "ba"

# ── 4+5. negative isolation (C pre-join) then late-join backfill ────────────────
log "NEGATIVE: C has NOT joined — must see ZERO hive content"
C_FEATS="$(q c "SELECT count(*) FROM harness_shared.harness_features_consolidated WHERE feature_id LIKE 'F-MX-%' OR feature_id LIKE 'F-HIVE%';")"
C_CONVS="$(q c "SELECT count(*) FROM harness_shared.coord_conversations WHERE id LIKE 'conv-MX-%';")"
[ "${C_FEATS:-0}" = "0" ] && [ "${C_CONVS:-0}" = "0" ] && echo "✓ NEGATIVE: C (non-member) sees 0 hive features + 0 conversations" \
  || echo "✗ NEGATIVE LEAK: C sees feats=$C_FEATS convs=$C_CONVS without joining (S0)"

log "BACKFILL: C joins LATE → must receive PRE-EXISTING content"
C_ROW=""; for i in $(seq 1 40); do
  C_ROW="$(jget "$(curl -s -m 10 "$(sc c)/api/discovery/hives")" "json.dumps(next(r for r in d['rows'] if r['hiveId']=='$HIVE_SLUG'))")"
  [ -n "$C_ROW" ] && break; sleep 3
done
C_LINKS="$(jget "$C_ROW" "json.dumps(d.get('memberLinks') or [])")"
cj="$(curl -s -m 610 -X POST "$(sc c)/api/discovery/join-hive" -H 'content-type: application/json' -d "{\"hiveId\":\"$HIVE_SLUG\",\"memberLinks\":${C_LINKS:-[]}}")"
echo "C join-hive → $(echo "$cj" | head -c 160)"
bf_ok=0
for i in $(seq 1 30); do
  n="$(q c "SELECT count(*) FROM harness_shared.harness_features_consolidated WHERE feature_id='F-MX-ab' AND origin='remote';")"
  [ "${n:-0}" -ge 1 ] && { bf_ok=1; break; }
  sleep 3
done
[ "$bf_ok" = 1 ] && echo "✓ BACKFILL: C received pre-existing F-MX-ab (origin=remote) after late join" \
  || echo "✗ BACKFILL: C did NOT receive pre-existing content after late join"

# ── report ──────────────────────────────────────────────────────────────────────
log "MATRIX RESULT (member=$SLUG hive=$HIVE_SLUG)"
printf "| type | dir | result |\n|---|---|---|\n"; printf "$MATRIX"
echo
echo "negative-isolation=$([ "${C_FEATS:-1}" = 0 ] && [ "${C_CONVS:-1}" = 0 ] && echo PASS || echo FAIL)  late-backfill=$([ "$bf_ok" = 1 ] && echo PASS || echo FAIL)  topic-equal=$([ -n "$SHARED_TOPIC" ] && echo PASS || echo UNCONFIRMED)"
echo
echo "Instances LEFT RUNNING for Brief E/G. Ports: $WORK/instances.env  ·  STOP: $WORK/stop.sh"
