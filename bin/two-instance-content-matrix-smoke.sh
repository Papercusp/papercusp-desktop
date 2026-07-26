#!/usr/bin/env bash
# two-instance-content-matrix-smoke.sh — Lane A (shared-pot-release-testing):
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
#   4. B joins via the CURRENT flow (POST /api/discovery/join-pot); assert A & B
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

REPO_DIR="${PAPERCUSP_REPO_DIR:-/home/marsh-office/papercupai-workspace/papercusp}"
default_deb() {
  local cargo_target="${CARGO_TARGET_DIR:-$HOME/.cargo-target}"
  ls -t \
    "$DESKTOP_DIR"/src-tauri/target/release/bundle/deb/Papercusp*_amd64.deb \
    "$cargo_target"/release/bundle/deb/Papercusp\ GUI_*_amd64.deb \
    "$cargo_target"/release/bundle/deb/Papercusp_*_amd64.deb 2>/dev/null | head -1
}
DEB="${1:-$(default_deb)}"
DEB="$(readlink -f "$DEB" 2>/dev/null || echo "$DEB")"
LUXON_SRC="$REPO_DIR/node_modules/luxon"
OPERATOR_DIR="${PAPERCUSP_OPERATOR_DIR:-$REPO_DIR/apps/operator}"
REPO_URL="${HIVE_SMOKE_REPO_URL:-https://github.com/octocat/Hello-World}"
INV_REPO_URL="${HIVE_INVITE_REPO_URL:-https://github.com/octocat/Spoon-Knife}"
# WI-1873: a THIRD, distinct repo for B's own publish leg (below) — must differ from
# both A's URLs so the derived hiveSlug can never collide with A's public/invite hives.
B_REPO_URL="${HIVE_SMOKE_B_REPO_URL:-https://github.com/octocat/git-consortium}"
CUPBOARD_URL="${HIVE_SMOKE_CUPBOARD_URL:-http://127.0.0.1:9}"
DISPLAY_NUM="${PAPERCUSP_SMOKE_DISPLAY:-154}"
P_A_USER="${P_A_USER:-papercupai}"
P_B_USER="${P_B_USER:-aviynw}"

WORK="${PAPERCUSP_MATRIX_WORK:-$HOME/.papercusp-lane-a-fed}"
# WI-2115: this smoke reuses the SAME fixed $WORK (and therefore the same fixed
# $DISPLAY_NUM) across every invocation, and a run that reaches the end leaves
# its pair (+ Xvfb) INTENTIONALLY running for follow-on lanes E/G (see header).
# Nothing ever tears that down automatically — a human/agent must run the OLD
# $WORK/stop.sh themselves. The unattended periodic gate (live-federation-gate.sh)
# never does; it just re-runs this script on a timer. Result: the very first
# completed run's Xvfb permanently squats $DISPLAY_NUM and EVERY subsequent gate
# run fails fed_fresh_display's busy-refusal forever (observed: an orphan lived
# 9+ hours and blocked both the periodic gate and a peer's manual WI-2102
# verification reruns). Reap whatever a PRIOR invocation left behind, with its
# OWN self-scoped stop.sh (pgrep -f "$WORK", excludes the invoker chain — safe,
# never a binary-name-pattern kill), BEFORE wiping $WORK out from under it.
# EI-18659596698001601: two concurrent invocations sharing this SAME fixed $WORK
# (the default path, or any custom PAPERCUSP_MATRIX_WORK two callers happen to
# share) used to race straight into the reap-then-rm-rf below — the second
# invocation's startup reap (stop.sh + rm -rf) tears down the FIRST invocation's
# still-running sidecars/probes out from under it, mid-scenario, forging an
# indistinguishable-from-real `A->B FAIL (probe=0)` federation-regression
# signature (observed live 2026-07-25: an 18:38 GATE_FORCE run's sidecars were
# `Killed` by an 18:43 hourly-timer run's teardown of this same lane dir).
# Serialize on a lock file scoped to THIS $WORK path (never rm -rf'd, so the
# lock survives across the whole reap+rerun cycle): a second invocation queues
# here instead of clobbering the first, and by the time it acquires the lock
# the first invocation's script process has genuinely exited (either a clean
# completion that intentionally leaves the pair running for lanes E/G — in
# which case the reap below is the SAME intended recycle-old-run behavior it
# always was — or an early-abort whose own EXIT trap already ran
# fed_cleanup_scoped). This does not change the leave-it-running-for-E/G design
# (WI-2115) at all; it only stops a run in progress from being reaped by a
# sibling that started too soon.
LOCK_FILE="${WORK}.flock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "another invocation holds $LOCK_FILE (lane dir busy) — queuing until it exits, to avoid EI-18659596698001601's collision"
  flock 9
fi
[ -x "$WORK/stop.sh" ] && { "$WORK/stop.sh" >/dev/null 2>&1 || true; }
rm -rf "$WORK" 2>/dev/null; mkdir -p "$WORK"
PKG="$WORK/pkg"; BIN="$PKG/usr/bin/papercusp-desktop"
declare -A FED_LOG=( [a]="$WORK/inst-a.log" [b]="$WORK/inst-b.log" )
declare -A AHOME=( [a]="$WORK/inst-a" [b]="$WORK/inst-b" )
NONCE="$(date +%s)"
log() { printf '\n=== %s ===\n' "$*"; }
# WI-2115: on a HARD early exit (extract/clobber/display/DHT/boot/API/create/join
# all `|| exit N` on failure) THIS invocation's own freshly-started Xvfb/DHT/
# sidecars must not leak — reap exactly what fed_fresh_display/fed_start_testnet_dht
# etc. appended to FED_KILL_PIDS. A CLEAN full-completion exit (status 0, whatever
# the content-matrix poll results say) is UNCHANGED: still left running for lanes
# E/G, per the header note — only the early-abort paths get cleaned.
trap 'ec=$?; [ "$ec" -ne 0 ] && { log "cleanup on early exit (scoped to $WORK, status=$ec)"; fed_cleanup_scoped "$WORK"; }; exit $ec' EXIT
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
SIDE="$(fed_sidecar_dir "$PKG")"   # dynamic install root (post two-role-split rename)
[ -d "$SIDE/node_modules/luxon" ] || { echo "→ A-001 fix: injecting luxon"; cp -aL "$LUXON_SRC" "$SIDE/node_modules/luxon" || exit 1; }
fed_clobber_check "$PKG" || exit 2
fed_assert_deb_swarm_support "$PKG" || exit 2
fed_fresh_display "$DISPLAY_NUM" "$WORK" || exit 1
BOOTSTRAP="$(fed_start_testnet_dht "$OPERATOR_DIR" "$WORK")" || exit 3
echo "PAPERCUSP_DHT_BOOTSTRAP=$BOOTSTRAP"

log "launch A($P_A_USER, owner) + B($P_B_USER, joiner) [REAL BINARY, :$DISPLAY_NUM]"
# two-role split (2026-07-03, P-002): the GUI binary no longer boots a sidecar in an
# extracted-pkg smoke — launch the PACKAGED sidecar directly (fed_local_launch_sidecar).
# staggered per-instance ports (WI-754 pattern): an ARGLESS fed_pick_free_port
# returns 18000 for EVERY pre-bind call, so hono==pg and A==B all collided
# (found 2026-07-03 P-002 rerun r2 — all four smokes EADDRINUSE'd at boot).
SMK_A_HONO="$(fed_pick_free_port 18071)"; SMK_A_PG="$(fed_pick_free_port 18532)"
SMK_B_HONO="$(fed_pick_free_port $((SMK_A_HONO + 1)))"; SMK_B_PG="$(fed_pick_free_port $((SMK_A_PG + 100)))"
fed_local_launch_sidecar "${AHOME[a]}" "${FED_LOG[a]}" "$SIDE" "$SMK_A_HONO" "$SMK_A_PG" GH_TOKEN="$A_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" PAPERCUSP_CUPBOARD_URL="$CUPBOARD_URL"
fed_local_launch_sidecar "${AHOME[b]}" "${FED_LOG[b]}" "$SIDE" "$SMK_B_HONO" "$SMK_B_PG" GH_TOKEN="$B_TOKEN" PAPERCUSP_DHT_BOOTSTRAP="$BOOTSTRAP" PAPERCUSP_CUPBOARD_URL="$CUPBOARD_URL"
for inst in a b; do fed_wait_boot "$inst" 80 || { echo "$inst boot failed: ${FED_BOOT_ERR:-?}"; tail -25 "${FED_LOG[$inst]}"; exit 4; }; done
log "A: sc=${FED_SC[a]} pg=${FED_PG[a]} | B: sc=${FED_SC[b]} pg=${FED_PG[b]}"
# WI-5641 (same category as WI-5509's "insufficient boot-timeout headroom" fix):
# this call site hardcoded 30 tries*2s=60s, HALF of fed_wait_api's own documented
# fix (EI-521: bumped the function's default to 60 tries*2s=120s specifically
# because embedded-PG init + ~500 migrations + owner-bootstrap can exceed the old
# 40s budget). The override here silently re-introduced the exact flake EI-521
# already fixed — reproduced live 2026-07-20: a fresh boot's create+publish step
# got an EMPTY response because fed_wait_api gave up waiting for 2xx at 60s and
# "accepted liberally" while the sidecar was still mid-migration. Drop the
# explicit tries so both instances get the intended 120s headroom.
fed_wait_api a && fed_wait_api b || { echo "FATAL: sidecar API never came up"; exit 4; }

dsn() { echo "postgresql://harness_admin:harness_admin_pwd@localhost:${FED_PG[$1]}/papercusp"; }
q() { psql "$(dsn "$1")" -tA -c "$2" 2>/dev/null | tr -d '\r'; }
sc() { echo "http://127.0.0.1:${FED_SC[$1]}"; }

cat > "$WORK/instances.env" <<EOF
A_IDENTITY=$P_A_USER  A_SIDECAR=http://127.0.0.1:${FED_SC[a]}  A_PG=${FED_PG[a]}  A_LOG=${FED_LOG[a]}
B_IDENTITY=$P_B_USER  B_SIDECAR=http://127.0.0.1:${FED_SC[b]}  B_PG=${FED_PG[b]}  B_LOG=${FED_LOG[b]}
DHT=$BOOTSTRAP  DISPLAY=:$DISPLAY_NUM  WORK=$WORK
EOF
# stop.sh kills by pgrep MINUS the invoker chain ($$/$PPID): a bare pkill -f "$WORK"
# also matches the CALLER's argv when an agent runs `bash <lane>/stop.sh` or inlines
# the path in a shell -c string, killing the invoker mid-script (self-hit 2026-07-03 P-002).
#
# WI-2150 (display-leak part 2): `pgrep -f "$WORK"` NEVER matches the bare
# `Xvfb :$DISPLAY_NUM -screen 0 1280x1024x24` process fed_fresh_display starts —
# its argv contains no $WORK substring at all (only the shell-level `>"$work/xvfb.log"`
# REDIRECT mentions $WORK, which isn't part of Xvfb's own argv/cmdline). So this
# stop.sh reaped every OTHER scoped process but always left Xvfb running — live-
# reproduced 2026-07-04: a completed run's Xvfb survived its own stop.sh, and the
# VERY NEXT invocation (which calls the prior run's stop.sh at top before rm -rf
# $WORK) hit "FATAL: :$DISPLAY_NUM busy" on Xvfb start. The periodic gate silently
# downgrades that FATAL to a SKIP (WI-1977), so this was invisibly starving the
# content-matrix leg on every cycle after the first completed run, forever, until
# someone noticed. Fix: also kill by the exact display number (trailing space in
# the pattern so :154 never matches :1540 etc).
printf '#!/usr/bin/env bash\nfor p in $(pgrep -f "%s"); do [ "$p" = "$$" ] || [ "$p" = "$PPID" ] || kill -9 "$p" 2>/dev/null; done\nfor p in $(pgrep -f "Xvfb %s "); do [ "$p" = "$$" ] || [ "$p" = "$PPID" ] || kill -9 "$p" 2>/dev/null; done\necho stopped\n' "$WORK" ":$DISPLAY_NUM" > "$WORK/stop.sh"; chmod +x "$WORK/stop.sh"

# ── 1. create + publish ──────────────────────────────────────────────────────
# WI-2150 (fixture poisoning): the from-repo endpoint does a repo→Hive lookup
# FIRST and, on a repeat run against a repo it already registered (e.g. a prior
# smoke run under the same $P_A_USER identity), returns {ok:true, existing:{...}}
# — a JOIN OFFER, not a fresh {created:{potSlug,...}} (field renamed hiveSlug→potSlug).
# This smoke's predicate only ever reads created potSlug/hiveSlug, so a rerun against an
# already-registered fixture repo got HIVE_SLUG='' and hard-FAILED at step 1
# (rerun#4's actual failure mode, gate history in WI-2150). Fix: force:true
# (already a first-class param on this route/createHiveFromRepo — "create-anyway
# past an existing hive/share for this repo... flagged duplicateOf for the
# claim/supersede flow") makes every invocation mint a FRESH hive+slug instead of
# short-circuiting to the existing one, so the smoke is idempotent/rerunnable.
log "A: create+publish PUBLIC hive ($REPO_URL)"
a_resp="$(curl -s -m 610 -X POST "$(sc a)/api/harness/pots/from-repo" -H 'content-type: application/json' \
  -d "{\"githubUrl\":\"$REPO_URL\",\"visibility\":\"public\",\"runTests\":false,\"shallow\":true,\"force\":true}")"
HIVE_SLUG="$(jget "$a_resp" "d['created'].get('potSlug') or d['created'].get('hiveSlug') or ''")"; SLUG="$(jget "$a_resp" "d['created']['memberSlug']")"
[ -n "$HIVE_SLUG" ] && [ -n "$SLUG" ] && echo "✓ public hive='$HIVE_SLUG' member='$SLUG' announced=$(jget "$a_resp" "d['publish']['announced']")" \
  || { echo "✗ create failed: $(echo "$a_resp" | head -c 300)"; exit 6; }
if [ -z "${SKIP_INVITE:-}" ]; then
  log "A: create separate INVITE hive ($INV_REPO_URL)"
  inv="$(curl -s -m 610 -X POST "$(sc a)/api/harness/pots/from-repo" -H 'content-type: application/json' \
    -d "{\"githubUrl\":\"$INV_REPO_URL\",\"visibility\":\"invite\",\"runTests\":false,\"shallow\":true,\"force\":true}")"
  INV_SLUG="$(jget "$inv" "d['created'].get('potSlug') or d['created'].get('hiveSlug') or ''")"
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
#
# NOTE (WI-2781 et al — content-matrix false-positive RED, 8+ live-federation-gate
# runs 2026-07-04 14:41-18:54): 'presence' is DELIBERATELY EXCLUDED from the default
# set. harness_shared.shared_presence is a "log-first" table (migration
# 214-federated-fed-ts-local-stamp.sql: "Log-first tables (contributors /
# feature_queue / feature_working_set / shared_presence / harness_feature_prs) are
# NOT touched — ... they have no capture trigger to re-arm") — it is NOT one of the
# 11 CDC-captured tables, so a raw SQL INSERT here NEVER produces a
# harness_shared.substrate_outbox row (src outbox is always literally 0/0, in every
# direction and phase — this is structural, not a regression). Real cross-machine
# presence sync (if any) rides presence-gossip.ts's own signed frames, a path this
# smoke's raw-INSERT method does not exercise. Asserting it here can never pass and
# was spamming a duplicate WI every gate run. Set MATRIX_TYPES to include it
# explicitly (e.g. for a one-off manual probe) — it just won't gate on failure.
TYPES="${MATRIX_TYPES:-features conversations messages threads thread-posts plans plan-parts item-assignments hive-settings hive-members}"
# NOTE (WI-2737/2624 et al — hive-members write SETUP-FAIL every single run, not just
# reruns): `nid` disambiguates the numeric ids embedded in a few fixture rows
# (hive-members' github_user_id=8888$nid, presence's 9999$nid, item-assignments'
# P-00$nid). write_all() is called 3x per run with DISTINCT tags (seed, ab, ba) — but
# the old `[ "$t" = ba ] && nid=2 || nid=1` only ever produced 2 distinct values, so
# "seed" and "ab" (BOTH on side A, same $ws) collapsed to the SAME nid=1 and collided on
# hive-members' (workspace_id,pot_home_slug,github_user_id) primary key on every gate
# run (not a cross-run staleness issue — a same-run collision). Fixed to a 3-way map (one
# per tag) so every phase within a run gets a distinct numeric id.
ins() { local ty="$1" ws="$2" t="$3" nid; case "$t" in ba) nid=2;; ab) nid=3;; *) nid=1;; esac
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
   hive-settings) echo "INSERT INTO harness_shared.pot_settings (workspace_id,harness_slug,setting_key,value,created_at,updated_at,origin) VALUES ('$ws','$HIVE_SLUG','mxk-$t','\"mx-$t\"',${NONCE}000,${NONCE}000,'local');";;
   hive-members) echo "INSERT INTO harness_shared.pot_members (workspace_id,pot_home_slug,github_user_id,github_username,device_attestations,revoked_pubkeys,binding_status,origin) VALUES ('$ws','$HIVE_SLUG',8888$nid,'mxu$t','[]'::jsonb,'{}'::text[],'bound','local');";;
  esac; }
poll() { local ty="$1" t="$2" nid; case "$t" in ba) nid=2;; ab) nid=3;; *) nid=1;; esac
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
   hive-settings) echo "SELECT origin FROM harness_shared.pot_settings WHERE harness_slug='$HIVE_SLUG' AND setting_key='mxk-$t' AND origin='remote' LIMIT 1;";;
   hive-members) echo "SELECT origin FROM harness_shared.pot_members WHERE pot_home_slug='$HIVE_SLUG' AND github_user_id=8888$nid AND origin='remote' LIMIT 1;";;
  esac; }
tbl() { case "$1" in features)echo harness_features_consolidated;;conversations)echo coord_conversations;;messages)echo coord_event_log;;threads)echo coord_threads;;thread-posts)echo coord_thread_posts;;plans)echo harness_plans;;plan-parts)echo harness_plan_parts;;item-assignments)echo plan_item_assignments;;presence)echo shared_presence;;hive-settings)echo pot_settings;;hive-members)echo pot_members;;esac; }

MATRIX=""
write_all() { local src="$1" ws="$2" t="$3" ty; for ty in $TYPES; do
  psql "$(dsn "$src")" -tA -c "$(ins "$ty" "$ws" "$t")" >/dev/null 2>"$WORK/ins.err" || echo "  ⚠ $ty $src write SETUP-FAIL: $(head -1 "$WORK/ins.err"|head -c 80)"; done; }
check_all() { local dst="$1" t="$2" phase="$3" src="$4" ty row cap tries=24 i; for ty in $TYPES; do
  # undrained/total: a growing undrained count = the capture landed in a scope
  # with NO drain (wrong workspace_id / unbooted harness — the WI-971 class);
  # 0/N = captured+drained, so a miss is receive-side (latency or apply).
  cap="$(q "$src" "SELECT count(*) FILTER (WHERE drained_at IS NULL) || '/' || count(*) FROM harness_shared.substrate_outbox WHERE table_name='$(tbl "$ty")';")"
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
log "B: discover + join-pot '$HIVE_SLUG'"
BR=""; RESP=""; for i in $(seq 1 ${DISCOVERY_RETRIES:-40}); do RESP="$(curl -s -m 10 "$(sc b)/api/discovery/pots")"; BR="$(jget "$RESP" "json.dumps(next((r for r in d['rows'] if r['potId']=='$HIVE_SLUG'), None))")"; [ -n "$BR" ] && [ "$BR" != "null" ] && break; sleep 3; done
echo "  [discovery] B saw rows=$(jget "$RESP" "len(d.get('rows') or [])"); target '$HIVE_SLUG' match=$([ -n "$BR" ] && [ "$BR" != "null" ] && echo Y || echo N) after ${DISCOVERY_RETRIES:-40} tries"
LINKS="$(jget "${BR:-null}" "json.dumps((d or {}).get('memberLinks') or [])" 2>/dev/null || echo '[]')"
if [ "$(jget "$LINKS" "len(d)")" = 0 ]; then
  LINKS="$(jget "$a_resp" "json.dumps(d.get('publish', {}).get('memberLinks') or [])")"
  echo "  [join] directory row missing memberLinks; using create response publish.memberLinks=$(jget "$LINKS" "len(d)")"
fi
HIVE_PUBKEY="$(jget "$a_resp" "d.get('publish', {}).get('hivePubkey') or ''")"
JOIN_BODY="$(python3 - "$HIVE_SLUG" "${HIVE_PUBKEY:-}" "${LINKS:-[]}" <<'PY'
import json, sys
hive, pubkey, links_json = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    links = json.loads(links_json)
except Exception:
    links = []
body = {"potId": hive, "memberLinks": links}  # join-pot body field renamed hiveId→potId (join-pot.ts requires potId)
if pubkey:
    body["hivePubkey"] = pubkey
print(json.dumps(body))
PY
)"
jr="$(curl -s -m 610 -X POST "$(sc b)/api/discovery/join-pot" -H 'content-type: application/json' -d "$JOIN_BODY")"
[ "$(jget "$jr" "d.get('ok')")" = True ] && echo "✓ B joined" || { echo "✗ B join failed: $(echo "$jr"|head -c 200)"; exit 6; }
# WI-5673 instrumentation: stamp the join moment so the report can measure how long
# the OWNER (A) took to admit the JOINER's (B's) log core. That delay is the single
# quantity that decides the incr-B→A matrix — see the report section for why.
JOIN_MS="$(( $(date +%s) * 1000 ))"
sleep 5
# WS_B RE-DERIVE (2026-07-03, WI-971 differential): the pre-join `LIMIT 1` read can
# return a meta-only workspace row (e.g. the seeded 'papercusp-workspace' carrying
# only hiveDirectoryMeta, projects:[]) while the JOIN registers the member under
# activeWorkspaceId() (= 'default' on a fresh packaged instance). B-side writes
# stamped with the wrong workspace_id land in a scope with NO booted substrate →
# captured but NEVER drained → false "incr-B→A NEVER crossed" reds for every
# workspace_id-bearing table (7/11 types on the 2026-07-03 run; features passed only
# because its INSERT omits workspace_id → column default 'default'). Re-derive from
# the registry row that actually CONTAINS the joined member.
WS_B_JOINED="$(q b "SELECT workspace_id FROM harness_shared.harness_registry WHERE payload->'projects' @> '[{\"slug\":\"$SLUG\"}]'::jsonb LIMIT 1;")"
if [ -n "$WS_B_JOINED" ] && [ "$WS_B_JOINED" != "$WS_B" ]; then
  echo "  WS_B re-derived post-join: '$WS_B' → '$WS_B_JOINED' (member '$SLUG' registered there)"
  WS_B="$WS_B_JOINED"
fi
AT="$(grep -aoE '\[swarm\] joined topic [0-9a-f]{8,}' "${FED_LOG[a]}"|grep -oE '[0-9a-f]{8,}'|sort -u)"
BT="$(grep -aoE '\[swarm\] joined topic [0-9a-f]{8,}' "${FED_LOG[b]}"|grep -oE '[0-9a-f]{8,}'|sort -u)"
ST="$(comm -12 <(echo "$AT") <(echo "$BT")|head -1)"
TEQ=$([ -n "$ST" ] && echo "PASS (${ST:0:16}…)" || echo UNCONFIRMED); echo "  topic-equal=$TEQ"

# ── 4b. SYMMETRIC directory listing: B creates+publishes ITS OWN hive; A must
# discover it via GET /api/discovery/hives (WI-1873 — the one B→A leg left uncovered
# when two-instance-hive-directory-smoke.sh was retired 2026-07-03/WI-1839; every
# other leg here already exercises A→B, this is the missing mirror). Independent of
# steps 1-4 (a distinct repo → a distinct hiveSlug, no join/content interaction).
if [ -z "${SKIP_B_PUBLISH:-}" ]; then
  log "B: create+publish its OWN PUBLIC hive ($B_REPO_URL) — symmetric directory check"
  b_resp="$(curl -s -m 610 -X POST "$(sc b)/api/harness/pots/from-repo" -H 'content-type: application/json' \
    -d "{\"githubUrl\":\"$B_REPO_URL\",\"visibility\":\"public\",\"runTests\":false,\"shallow\":true,\"force\":true}")"
  B_HIVE_SLUG="$(jget "$b_resp" "d['created'].get('potSlug') or d['created'].get('hiveSlug') or ''")"
  if [ -n "$B_HIVE_SLUG" ]; then
    echo "✓ B public hive='$B_HIVE_SLUG' announced=$(jget "$b_resp" "d['publish']['announced']")"
    AR=""; ABR=""; for i in $(seq 1 ${DISCOVERY_RETRIES:-40}); do AR="$(curl -s -m 10 "$(sc a)/api/discovery/pots")"; ABR="$(jget "$AR" "json.dumps(next((r for r in d['rows'] if r['potId']=='$B_HIVE_SLUG'), None))")"; [ -n "$ABR" ] && [ "$ABR" != "null" ] && break; sleep 3; done
    BA_DIR=$([ -n "$ABR" ] && [ "$ABR" != "null" ] && echo PASS || echo "FAIL (A never saw B's hive after ${DISCOVERY_RETRIES:-40} tries)")
  else
    echo "✗ B publish failed: $(echo "$b_resp" | head -c 300)"; BA_DIR="FAIL (publish)"
  fi
  echo "  B→A directory-listing=$BA_DIR"
else
  BA_DIR="SKIPPED"; echo "· SKIP_B_PUBLISH set — B→A directory leg not run"
fi

# ── 5. BACKFILL: B receives the pre-existing (pre-join) content ─────────────────
log "BACKFILL: B must receive A's PRE-EXISTING seed content (origin=remote)"; check_all b seed backfill a
BACKFILL_TABLE="$MATRIX"; MATRIX=""

# ── 6. INCREMENTAL matrix both directions (post-join) ───────────────────────────
log "INCREMENTAL A→B"; write_all a "$WS_A" ab; check_all b ab "incr-A→B" a
AB_TABLE="$MATRIX"; MATRIX=""
log "INCREMENTAL B→A"; write_all b "$WS_B" ba; check_all a ba "incr-B→A" b
BA_TABLE="$MATRIX"; MATRIX="$AB_TABLE$BA_TABLE"

# ── 6a. INCREMENTAL B→A LATE-RECHECK: latency vs dead (WI-5673 differential) ────
# WI-5673 (3+ live-federation-gate runs 2026-07-20): features/conversations/
# messages/threads incr-B→A intermittently "NEVER crossed (src outbox=0/1)" —
# src-side capture+drain confirms the op was genuinely SENT (0 undrained), so a
# miss here is receive/apply-side (or in-flight), not a lost write. These 4 types
# are exactly the FIRST 4 entries in $TYPES, i.e. the first ops write_all() issues
# in B's very first outbound burst since it joined — the same "early-after-join
# ops are at risk, later ones are reliable" shape WI-5672 documented for the
# local-matrix leg's early scenarios. This mirrors the BACKFILL LATE-RECHECK
# pattern below (§6b) for the incremental leg specifically: a poll-only recheck
# (no new writes) after the normal window distinguishes "still missing after
# more real time" (genuine gap) from "landed once B's send/replication path
# finished warming up" (latency, not death) — never gates CONTENT_OVERALL, purely
# diagnostic so the next gate run's report says which one this was.
if printf '%b' "$BA_TABLE" | grep -q FAIL; then
  PRE_LATE_MATRIX="$MATRIX"; MATRIX=""
  log "INCREMENTAL B→A LATE-RECHECK (was the incr-B→A miss above latency or death?)"
  check_all a ba "incr-B→A-late" b
  BA_LATE_TABLE="$MATRIX"; MATRIX="$PRE_LATE_MATRIX"
else
  BA_LATE_TABLE=""
fi

# ── 6b. BACKFILL LATE-RECHECK: latency vs dead (2026-07-03 differential) ─────────
# Pre-join (historical) log entries were observed applying MINUTES after the live
# tail (seed appended 13:26 → applied on B between 13:38 and 14:05 while incr ops
# crossed in seconds). A ✗ in phase 5 + a ✓ here = backfill-LATE (receive-side
# catch-up latency, its own bug class); ✗ in both = backfill genuinely dead.
if printf '%b' "$BACKFILL_TABLE" | grep -q FAIL; then
  INCR_TABLE="$MATRIX"; MATRIX=""
  log "BACKFILL LATE-RECHECK (were the phase-5 misses latency or death?)"
  check_all b seed backfill-late a
  BACKFILL_LATE_TABLE="$MATRIX"; MATRIX="$INCR_TABLE"
else
  BACKFILL_LATE_TABLE=""
fi

# ── report ──────────────────────────────────────────────────────────────────────
log "RESULT (member=$SLUG hive=$HIVE_SLUG)"
echo "BACKFILL (late-joiner gets pre-existing content):"; printf "| type | phase | result |\n|---|---|---|\n"; printf "$BACKFILL_TABLE"
if [ -n "$BACKFILL_LATE_TABLE" ]; then echo; echo "BACKFILL LATE-RECHECK (post-incremental re-poll — PASS here + FAIL above = latency, not death):"; printf "| type | phase | result |\n|---|---|---|\n"; printf "$BACKFILL_LATE_TABLE"; fi
echo; echo "INCREMENTAL (post-join, both directions):"; printf "| type | dir | result |\n|---|---|---|\n"; printf "$MATRIX"
if [ -n "$BA_LATE_TABLE" ]; then echo; echo "INCREMENTAL B→A LATE-RECHECK (post-window re-poll — PASS here + FAIL above = latency/warm-up, not death; see WI-5673):"; printf "| type | dir | result |\n|---|---|---|\n"; printf "$BA_LATE_TABLE"; fi
echo; echo "negative-isolation=$NEG  topic-equal=$TEQ  b-to-a-directory=$BA_DIR"

# ── WI-5673 ADMISSION-DELAY PROBE — the ONE number that explains the incr-B→A matrix ──
# ROOT-CAUSE MODEL (2026-07-26, derived from 4 gate runs + the §6a late-recheck):
# the incr-B→A failures are NOT a per-type capture/writer defect. write_all() issues all
# 10 INSERTs back-to-back, then check_all() polls the types SEQUENTIALLY at tries=24 ×
# sleep 3 = 72s each — so type k is only polled during t=[72(k-1), 72k] after the checks
# start. A SINGLE unblock event at t=T (the owner finally admitting the joiner's log core,
# after which A backfills B's whole log at once) therefore FAILS exactly the types whose
# poll window closed before T and PASSES every later one. Hence the failing set is always
# a PREFIX of $TYPES, with N_failing ≈ T/72s — the "first 4 types" / "first 7 types"
# pattern is an artifact of the POLL ORDER, not a property of those types.
#   observed: 07-20 T≈5min → first 4 FAIL · 07-26 ×3 T≈8min → first 7 FAIL · 07-26 10:40
#   T<72s → all 10 PASS. Every failing run's §6a LATE-RECHECK passes all 10 → nothing is
#   ever lost, and src outbox=0/1 confirms capture+drain were fine all along.
# WHY MEMBER→OWNER ONLY: B learns A's log core out-of-band from the directory memberLinks
# at join time, so A→B is live immediately; A can only learn B's core from B's SIGNED
# ANNOUNCE over the paired announce channel, so any announce-channel pairing delay
# ([swarm:unpaired] in A's log) is a member→owner-ONLY outage. That asymmetry is the bug.
# This probe prints T every run so the model is CHECKED rather than re-argued: if the
# actual B→A FAIL count stops tracking delay/72s, the model above is REFUTED — say so.
ADMIT_MS="$(q a "SELECT COALESCE(min(ts)::text,'') FROM harness_shared.boot_history_events WHERE kind='announce_admitted' AND message LIKE '%owner_admit_joiner%' AND ts >= ${JOIN_MS:-0};" || true)"
ADMIT_MS="$(printf '%s' "$ADMIT_MS" | tr -dc '0-9')"
if [ -n "$ADMIT_MS" ] && [ -n "${JOIN_MS:-}" ]; then
  ADMIT_DELAY_S=$(( (ADMIT_MS - JOIN_MS) / 1000 ))
  PREDICTED_PREFIX=$(( (ADMIT_DELAY_S + 71) / 72 )); [ "$PREDICTED_PREFIX" -gt 10 ] && PREDICTED_PREFIX=10
  ACTUAL_BA_FAILS="$(printf '%b' "$BA_TABLE" | grep -c 'incr-B→A | FAIL' || true)"
  echo "owner-admits-joiner-delay=${ADMIT_DELAY_S}s  predicted-B→A-FAIL-prefix=${PREDICTED_PREFIX}/10  actual-B→A-FAIL=${ACTUAL_BA_FAILS}/10  (WI-5673 model: FAIL count ≈ delay/72s; a mismatch REFUTES it)"
else
  echo "owner-admits-joiner-delay=UNMEASURED (no announce_admitted/owner_admit_joiner row on A at/after the join stamp — WI-5673 probe)"
fi
UNPAIRED_A="$(grep -ac 'swarm:unpaired' "${FED_LOG[a]}" 2>/dev/null || true)"
echo "A-announce-channel-unpaired-escalations=${UNPAIRED_A:-0} (>0 = a live-but-never-paired announce channel on A — the suspected source of the admission delay)"

CONTENT_OVERALL=PASS
[ "$NEG" = PASS ] || CONTENT_OVERALL=INCOMPLETE
case "$TEQ" in PASS*) ;; *) CONTENT_OVERALL=INCOMPLETE ;; esac
if printf '%b%b%b%b' "$BACKFILL_TABLE" "$BACKFILL_LATE_TABLE" "$MATRIX" "$BA_LATE_TABLE" | grep -q FAIL; then
  CONTENT_OVERALL=INCOMPLETE
fi
if [ "$CONTENT_OVERALL" = PASS ]; then
  echo "OVERALL: PASS — content federation matrix green (directory mirror: $BA_DIR)"
else
  echo "OVERALL: INCOMPLETE — content federation matrix has a failing assertion (directory mirror: $BA_DIR)"
fi
echo "Pair LEFT RUNNING for Brief E/G. Ports: $WORK/instances.env  ·  STOP: $WORK/stop.sh"
