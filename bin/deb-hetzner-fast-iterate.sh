#!/usr/bin/env bash
# deb-hetzner-fast-iterate.sh — FAST-ITERATION cross-machine federation harness.
#
# Sibling of bin/deb-hetzner-federation.sh (the full provision→install→merge proof,
# ~40 min/iter because it REBUILDS+REINSTALLS the whole ~1GB tauri .deb every run —
# the .deb build alone is ~25 min). This harness cuts the per-iteration loop to
# ~8 min by SEPARATING the slow, once-per-debug-session steps from the fast inner
# loop:
#
#   ── once ──   --setup --deb=PATH   provision 2 Hetzner VMs, install the .deb,
#                                     join BOTH into one hive, and KEEP THE VMS UP.
#                                     Writes the frame state to $STATE_FILE.
#
#   ── inner ──  --hotpatch=serve.mjs   scp ONLY the freshly-rebuilt serve.mjs onto
#                                     both kept-alive VMs at the sidecar path,
#                                     restart_sidecar (preserve pgdata — EI-504),
#                                     wait for [swarm] peer_connected, then re-run
#                                     the A→B + B→A merge probes (features +
#                                     plan-parts + coord) with SHORT timeouts.
#                                     This is the loop you repeat each code change:
#                                     rebuild serve.mjs locally (~4min) → --hotpatch
#                                     (~3min). NO .deb rebuild, NO reprovision.
#
#   ── done ──   --teardown            DELETE both servers (ends billing) + confirm
#                                     GONE (404) + rm the state file.
#
# Why a hotpatch is faithful: the .deb's federating unit IS the sidecar serve.mjs
# (+ its bundled embedded-pg/swarm, which DON'T change between code iterations).
# Swapping just serve.mjs and restarting under the SAME pcusp user / env / pgdata
# exercises the exact runtime the full proof does — only the slow rebuild/reinstall
# of the unchanged 1GB shell is skipped.
#
# COST-SAFETY: --setup writes every provisioned server id to $STATE_FILE BEFORE
# install; --teardown DELETEs every id in it and confirms 404, then removes the
# file. The VMs BILL until --teardown — --setup prints a loud reminder. (There is
# no EXIT-trap auto-destroy here BY DESIGN — that is the whole point: the VMs must
# survive across many separate --hotpatch invocations.)
#
# Env / creds (identical to deb-hetzner-federation.sh):
#   HCLOUD_TOKEN            Hetzner API token   (default ~/.papercusp/hcloud-token)
#   HETZNER_SSH_KEY_ID      ssh key id          (default 114898429)
#   HETZNER_SSH_IDENTITY    private key         (default ~/.ssh/papercusp-latitude-frame)
#   gh auth: papercupai + aviynw (per-frame GH_TOKEN identity)
#   PCUSP_FAST_STATE        state-file path     (default /tmp/deb-hzfast-state)
#
# Usage:
#   bin/deb-hetzner-fast-iterate.sh --setup [--deb=PATH] [--locs=ash,ash] [--type=cpx31]
#   bin/deb-hetzner-fast-iterate.sh --hotpatch=PATH_TO_serve.mjs
#   bin/deb-hetzner-fast-iterate.sh --teardown
#   bin/deb-hetzner-fast-iterate.sh --status      # show kept-alive frames
set -uo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/scripts/linux-test-vm/lib/common.sh"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"
set +e   # this driver owns its own exit codes (the asserts report PASS/FAIL)
set +u   # federation-asserts.sh + the dynamic FED_*/FRAME_* assoc arrays are
         # nounset-hostile (same reason as deb-hetzner-federation.sh).

# ── args / config ─────────────────────────────────────────────────────────────
# IMAGE must match the .deb's target ABI (ubuntu-24.04, glibc 2.38 for the bundled
# pgvector vector.so — EI-503). Same defaults as the full rig.
MODE=""; DEB=""; SERVE_PATCH=""
LOCS="ash,ash"; STYPE="cpx31"; IMAGE="ubuntu-24.04"
for arg in "$@"; do case "$arg" in
  --setup)        MODE="setup" ;;
  --hotpatch=*)   MODE="hotpatch"; SERVE_PATCH="${arg#--hotpatch=}" ;;
  --teardown)     MODE="teardown" ;;
  --status)       MODE="status" ;;
  --deb=*)        DEB="${arg#--deb=}" ;;
  --locs=*)       LOCS="${arg#--locs=}" ;;
  --type=*)       STYPE="${arg#--type=}" ;;
  --image=*)      IMAGE="${arg#--image=}" ;;
  -h|--help)      sed -n '2,52p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) die "unknown arg: $arg" ;;
esac; done
[ -n "$MODE" ] || die "pick a mode: --setup | --hotpatch=serve.mjs | --teardown | --status"

STATE_FILE="${PCUSP_FAST_STATE:-/tmp/deb-hzfast-state}"
TOKEN="${HCLOUD_TOKEN:-$(cat ~/.papercusp/hcloud-token 2>/dev/null)}"
[ -n "$TOKEN" ] || die "no HCLOUD_TOKEN (or ~/.papercusp/hcloud-token)"
SSH_KEY_ID="${HETZNER_SSH_KEY_ID:-114898429}"
SSH_IDENTITY="${HETZNER_SSH_IDENTITY:-$HOME/.ssh/papercusp-latitude-frame}"
P_A_USER="${P_A_USER:-papercupai}"; P_B_USER="${P_B_USER:-aviynw}"
HONO_PORT=39070; PG_PORT=39532
SIDECAR_SERVE="/usr/lib/Papercusp/sidecar/serve.mjs"   # confirmed from setup_frame()

declare -gA FRAME_ID FRAME_IP FRAME_USER FRAME_TOKEN

# ── Hetzner API + SSH helpers (copied from deb-hetzner-federation.sh) ──────────
hz() { curl -s -m 40 -H "Authorization: Bearer $TOKEN" "$@"; }
hssh() { local ip="$1"; shift; ssh -i "$SSH_IDENTITY" -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 \
  -o ServerAliveInterval=15 "root@$ip" "$@"; }
hscp() { local ip="$1" src="$2" dst="$3"; scp -i "$SSH_IDENTITY" -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR "$src" "root@$ip:$dst"; }

create_server() {  # <name> <loc> → echo "<id> <ip>" ; records id to STATE_FILE first
  local name="$1" loc="$2" resp id
  resp="$(hz -X POST 'https://api.hetzner.cloud/v1/servers' -H 'content-type: application/json' \
    -d "{\"name\":\"$name\",\"server_type\":\"$STYPE\",\"image\":\"$IMAGE\",\"location\":\"$loc\",\"ssh_keys\":[$SSH_KEY_ID]}")"
  id="$(printf '%s' "$resp" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("server",{}).get("id") or "")' 2>/dev/null)"
  [ -n "$id" ] || { echo "FATAL create $name: $resp" >&2; return 1; }
  # cost-safety: stamp the id into the state file BEFORE we wait/install, so even a
  # crash between create and the full state-write leaves a destroyable record.
  printf 'SERVER_ID %s\n' "$id" >> "$STATE_FILE"
  local i ip status
  for i in $(seq 1 60); do
    resp="$(hz "https://api.hetzner.cloud/v1/servers/$id")"
    status="$(printf '%s' "$resp" | python3 -c 'import json,sys;print(json.load(sys.stdin)["server"]["status"])' 2>/dev/null)"
    ip="$(printf '%s' "$resp" | python3 -c 'import json,sys;print(json.load(sys.stdin)["server"]["public_net"]["ipv4"]["ip"])' 2>/dev/null)"
    [ "$status" = "running" ] && [ -n "$ip" ] && { echo "$id $ip"; return 0; }
    sleep 5
  done
  echo "FATAL $name not running" >&2; return 1
}
delete_server() { hz -X DELETE "https://api.hetzner.cloud/v1/servers/$1" >/dev/null 2>&1; }
server_gone()   { local code; code="$(hz -o /dev/null -w '%{http_code}' "https://api.hetzner.cloud/v1/servers/$1")"; [ "$code" = "404" ]; }

# ── state file: durable handoff between --setup and --hotpatch/--teardown ──────
# Lines: SERVER_ID <id> (one per provisioned server, written eagerly in create_server)
#        FRAME <inst> <id> <ip> <user> <member_slug>
#        HIVE_ID <id> / HIVE_PUBKEY <key>
#        PORTS <hono> <pg>
state_get() {  # <key> [field-after-key...] → echoes the value(s) for the first matching line
  awk -v k="$1" '$1==k {$1=""; sub(/^ /,""); print; exit}' "$STATE_FILE" 2>/dev/null
}
state_frame_field() {  # <inst> <fieldnum 1=id 2=ip 3=user 4=slug> → value
  awk -v inst="$2" -v f="$3" '$1=="FRAME" && $2==inst {print $(2+f); exit}' "$STATE_FILE" 2>/dev/null
}
load_state() {
  [ -f "$STATE_FILE" ] || die "no state file ($STATE_FILE) — run --setup first"
  HIVE_ID="$(state_get HIVE_ID)"; HIVE_PUBKEY="$(state_get HIVE_PUBKEY)"
  read -r HONO_PORT PG_PORT <<<"$(state_get PORTS)"
  local inst
  for inst in a b; do
    FRAME_ID[$inst]="$(state_frame_field FRAME "$inst" 1)"
    FRAME_IP[$inst]="$(state_frame_field FRAME "$inst" 2)"
    FRAME_USER[$inst]="$(state_frame_field FRAME "$inst" 3)"
  done
  A_MEMBER_SLUG="$(state_frame_field FRAME a 4)"
  B_MEMBER_SLUG="$(state_frame_field FRAME b 4)"
  [ -n "${FRAME_IP[a]}" ] && [ -n "${FRAME_IP[b]}" ] || die "state file is missing frame IPs ($STATE_FILE) — re-run --setup"
}

# ── driver vtable: SSH into each frame by public IP (same as the full rig) ─────
drv_exec()   { hssh "${FRAME_IP[$1]}" 'bash -s'; }
drv_applog() { echo "/home/pcusp/serve.log"; }
drv_psql()   { printf '%s\n' "$2" | hssh "${FRAME_IP[$1]}" \
                 "psql 'postgresql://harness_admin:harness_admin_pwd@localhost:${FED_PG[$1]}/papercusp' -tA"; }

# ── install .deb + launch headless sidecar (copied from setup_frame) ───────────
setup_frame() {  # <inst>
  local inst="$1"; local ip="${FRAME_IP[$inst]}"
  fed_log "[$inst] wait sshd @ $ip"
  local i; for i in $(seq 1 40); do hssh "$ip" true 2>/dev/null && break; sleep 5; done
  hssh "$ip" true 2>/dev/null || { echo "FATAL ssh $inst"; return 1; }
  fed_log "[$inst] install .deb (fresh-install dep resolution) + driver prereqs"
  hscp "$ip" "$DEB" /tmp/Papercusp.deb || return 1
  hssh "$ip" 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq
    apt-get install -y -qq /tmp/Papercusp.deb >/dev/null 2>&1 || apt-get install -y -qq --fix-broken >/dev/null 2>&1
    command -v gh >/dev/null && command -v psql >/dev/null || apt-get install -y -qq gh postgresql-client >/dev/null 2>&1
    test -f /usr/lib/Papercusp/sidecar/serve.mjs && echo deb-ok' | grep -q deb-ok || { echo "FATAL install $inst"; return 1; }
  fed_log "[$inst] launch headless serve.mjs as non-root pcusp (PUBLIC DHT, identity ${FRAME_USER[$inst]})"
  # embedded-postgres REFUSES to initdb as root; launch under a dedicated pcusp
  # user via runuser (faithful to real usage). Fresh data dir on FIRST setup.
  printf 'GH_TOKEN=%s\n' "${FRAME_TOKEN[$inst]}" \
    | hssh "$ip" 'id pcusp >/dev/null 2>&1 || useradd -m -s /bin/bash pcusp
        umask 077; cat > /home/pcusp/fed.env; chown pcusp:pcusp /home/pcusp/fed.env'
  hssh "$ip" "HONO=$HONO_PORT PG=$PG_PORT runuser -u pcusp -- bash -s" <<'EOF'
set -e
H=/home/pcusp
pkill -u pcusp -f 'serve.mjs --ensure' 2>/dev/null || true; sleep 1
rm -rf "$H/pgdata" "$H/.papercusp" "$H/.papercusp-workspaces"; mkdir -p "$H/pgdata" "$H/fed"
SIDE=/usr/lib/Papercusp/sidecar
set -a; . "$H/fed.env"; set +a
cd "$SIDE"
env PATH="$SIDE/bin:/usr/bin:/bin" HOME="$H" USERPROFILE="$H" NODE_ENV=production \
  PAPERCUSP_HONO_PORT="$HONO" PAPERCUSP_BIND_HOST=127.0.0.1 HOSTNAME=127.0.0.1 \
  PAPERCUSP_PG_PORT="$PG" PAPERCUSP_PG_DATA_DIR="$H/pgdata" PAPERCUSP_PG_SQL_DIR="$SIDE/db-sql" \
  PAPERCUSP_SERVE_UI=0 PAPERCUSP_DESKTOP=1 PAPERCUSP_ANNOUNCE_DEBUG=1 \
  PAPERCUSP_FLAG_PAPERCUSP_PLAN_PART_FEDERATION=1 \
  PAPERCUSP_HARNESS_DIR="$SIDE/harness" PAPERCUSP_PROMPTS_DIR="$SIDE/prompts" \
  PAPERCUSP_WORKSPACES_ROOT="$H/.papercusp-workspaces" \
  GH_TOKEN="${GH_TOKEN:-}" \
  setsid nohup ./bin/node ./serve.mjs --ensure > "$H/serve.log" 2>&1 < /dev/null &
sleep 1; echo "launched as pcusp"
EOF
}

# EI-504: relaunch a sidecar WITHOUT wiping pgdata/.papercusp — the key reuse that
# lets a hotpatch preserve the registered project + embedded-PG + hive join across
# the serve.mjs swap. Same env block as setup_frame, minus the rm -rf.
restart_sidecar() {  # <inst>
  # split declarations — a single `local a=$1 b=${arr[$a]}` evaluates all RHS
  # before any assignment, so ${FRAME_IP[$inst]} would see an empty $inst
  # ("bad array subscript" + empty ip). Same class as the nat-geo.sh fix.
  local inst="$1"; local ip="${FRAME_IP[$inst]}"
  fed_log "[$inst] restart sidecar (preserve pgdata) → boot-all re-reads state → swarm rejoin"
  hssh "$ip" "HONO=$HONO_PORT PG=$PG_PORT runuser -u pcusp -- bash -s" <<'EOF'
set -e
H=/home/pcusp
pkill -u pcusp -f 'serve.mjs' 2>/dev/null || true; sleep 2
SIDE=/usr/lib/Papercusp/sidecar
set -a; . "$H/fed.env"; set +a
cd "$SIDE"
env PATH="$SIDE/bin:/usr/bin:/bin" HOME="$H" USERPROFILE="$H" NODE_ENV=production \
  PAPERCUSP_HONO_PORT="$HONO" PAPERCUSP_BIND_HOST=127.0.0.1 HOSTNAME=127.0.0.1 \
  PAPERCUSP_PG_PORT="$PG" PAPERCUSP_PG_DATA_DIR="$H/pgdata" PAPERCUSP_PG_SQL_DIR="$SIDE/db-sql" \
  PAPERCUSP_SERVE_UI=0 PAPERCUSP_DESKTOP=1 PAPERCUSP_ANNOUNCE_DEBUG=1 \
  PAPERCUSP_FLAG_PAPERCUSP_PLAN_PART_FEDERATION=1 \
  PAPERCUSP_HARNESS_DIR="$SIDE/harness" PAPERCUSP_PROMPTS_DIR="$SIDE/prompts" \
  PAPERCUSP_WORKSPACES_ROOT="$H/.papercusp-workspaces" \
  GH_TOKEN="${GH_TOKEN:-}" \
  setsid nohup ./bin/node ./serve.mjs --ensure > "$H/serve.log" 2>&1 < /dev/null &
sleep 1; echo "relaunched as pcusp (no wipe)"
EOF
}

# join-hive member-slug reader (copied from deb-hetzner-federation.sh)
join_hive_member_slug() {  # <join-hive-response-json> → first ok member's slug
  printf '%s' "$1" | python3 -c 'import json,sys
d=json.load(sys.stdin)
ms=[m for m in d.get("members",[]) if m.get("ok") and m.get("slug")]
print(ms[0]["slug"] if ms else "")' 2>/dev/null
}

# ══════════════════════════════════════════════════════════════════════════════
# MODE: --setup
# ══════════════════════════════════════════════════════════════════════════════
do_setup() {
  [ -f "$STATE_FILE" ] && die "state file already exists ($STATE_FILE) — run --teardown first (or rm it) before a new --setup"
  IFS=',' read -r LOC_A LOC_B <<<"$LOCS"
  [ -n "$DEB" ] || DEB="$(default_deb)"
  [ -n "$DEB" ] && [ -f "$DEB" ] || die "no .deb (--deb=PATH or build one; default_deb found nothing)"
  WORK="$(mktemp -d /tmp/deb-hzfast.XXXXXX)"; PKG="$WORK/pkg"
  SLUG="hzfast${WORK##*.}"
  : > "$STATE_FILE"   # create the state file NOW so create_server can stamp ids into it

  # On ANY failure before we've recorded full state, destroy whatever we created
  # (cost-safety) and remove the half-written state file.
  setup_fail() {
    echo "✗ --setup failed: $1" >&2
    if [ -s "$STATE_FILE" ]; then
      echo "  destroying any servers recorded so far (cost-safety)…" >&2
      local sid
      while read -r _ sid; do [ -n "$sid" ] || continue
        for i in 1 2 3 4 5 6; do delete_server "$sid"; server_gone "$sid" && { echo "    destroyed $sid" >&2; break; }; sleep 5; done
      done < <(grep '^SERVER_ID ' "$STATE_FILE")
    fi
    rm -f "$STATE_FILE"; rm -rf "$WORK" 2>/dev/null
    exit "${2:-1}"
  }

  # 1. artifact gates (reuse the assert core)
  fed_log "artifact: $DEB"
  fed_extract_deb "$DEB" "$PKG"          || setup_fail "deb extract"      2
  fed_clobber_check "$PKG"               || setup_fail "clobber check"    2
  fed_assert_deb_swarm_support "$PKG"    || setup_fail "swarm support"    2

  # 2. identities
  FRAME_USER[a]="$P_A_USER"; FRAME_USER[b]="$P_B_USER"
  FRAME_TOKEN[a]="$(gh auth token --user "$P_A_USER" 2>/dev/null)"
  FRAME_TOKEN[b]="$(gh auth token --user "$P_B_USER" 2>/dev/null)"
  { [ -n "${FRAME_TOKEN[a]}" ] && [ -n "${FRAME_TOKEN[b]}" ]; } || setup_fail "need gh tokens for $P_A_USER + $P_B_USER" 1

  # 3. provision both frames (create_server stamps SERVER_ID into STATE_FILE first)
  fed_log "provision 2 Hetzner $STYPE ($LOC_A + $LOC_B) — KEPT UP after setup"
  read -r FRAME_ID[a] FRAME_IP[a] <<<"$(create_server "$SLUG-a" "$LOC_A")" || setup_fail "create A" 3
  read -r FRAME_ID[b] FRAME_IP[b] <<<"$(create_server "$SLUG-b" "$LOC_B")" || setup_fail "create B" 3
  echo "  a=${FRAME_ID[a]}@${FRAME_IP[a]}  b=${FRAME_ID[b]}@${FRAME_IP[b]}"

  # 4. install + launch
  setup_frame a || setup_fail "setup_frame a" 4
  setup_frame b || setup_fail "setup_frame b" 4

  # 5. boot + join (the SAME hive flow as deb-hetzner-federation.sh)
  fed_log "wait embedded-PG + operator in both sidecars"
  fed_wait_boot a 50 || { drv_exec a <<<"tail -25 /home/pcusp/serve.log"; setup_fail "A boot ($FED_BOOT_ERR)" 5; }
  fed_wait_boot b 50 || { drv_exec b <<<"tail -25 /home/pcusp/serve.log"; setup_fail "B boot ($FED_BOOT_ERR)" 5; }
  fed_log "A: PG=${FED_PG[a]} sc=${FED_SC[a]} | B: PG=${FED_PG[b]} sc=${FED_SC[b]}"
  fed_wait_api a || echo "⚠ A api not ready"; fed_wait_api b || echo "⚠ B api not ready"

  REPO_URL="${HIVE_REPO_URL:-https://github.com/octocat/Hello-World}"
  fed_log "A: POST pots/from-repo ($REPO_URL, force) → resolve hive memberLink + hiveId + hivePubkey"
  # force:true (WI-1331): the test repo already has a hive in the shared public
  # directory from prior runs, so a non-forced from-repo returns the `existing`
  # join-offer shape (directory hit → NO memberLinks/hivePubkey) and the setup
  # FATALs "could not resolve a hive memberLink". force creates a FRESH isolated
  # hive per run. Same fix as rig_owner_publish_hive in bin/lib/deb-hetzner-rig.sh.
  a_resp="$(drv_exec a <<EOF
curl -s -m 610 -X POST http://127.0.0.1:${FED_SC[a]}/api/harness/pots/from-repo -H 'content-type: application/json' -d '{"githubUrl":"$REPO_URL","force":true,"visibility":"public","runTests":false,"shallow":true}'
EOF
)"
  echo "A from-repo → $(printf '%s' "$a_resp" | head -c 200)"
  A_HIVE_FIELDS="$(printf '%s' "$a_resp" | python3 -c 'import json,sys
d=json.load(sys.stdin)
ex=d.get("existing",{}).get("hive",{}) or {}
cr=d.get("created",{}) or {}
pub=d.get("publish",{}) or {}
ml=(ex.get("memberLinks") or cr.get("memberLinks") or pub.get("memberLinks") or [])
print(ml[0] if ml else "")
print(ex.get("hiveId") or cr.get("potSlug") or cr.get("hiveSlug") or "")
print(ex.get("hivePubkey") or pub.get("hivePubkey") or "")' 2>/dev/null)"
  { read -r A_LINK; read -r HIVE_ID; read -r HIVE_PUBKEY; } <<<"$A_HIVE_FIELDS"
  [ -n "$A_LINK" ] || setup_fail "A could not resolve a hive memberLink — body: $(printf '%s' "$a_resp" | head -c 800)" 6
  [ -n "$HIVE_ID" ] || setup_fail "A could not resolve hiveId — body: $(printf '%s' "$a_resp" | head -c 800)" 6
  echo "✓ A resolved hive link ${A_LINK:0:56}… hiveId=$HIVE_ID hivePubkey=${HIVE_PUBKEY:0:12}…"
  [ -n "$HIVE_PUBKEY" ] || echo "⚠ A surfaced NO hivePubkey — joiner will skip identity-materialize (no re-key → no federation)."

  fed_log "A + B both JOIN THE HIVE via /api/discovery/join-pot (potId=$HIVE_ID)"
  a_join="$(drv_exec a <<EOF
curl -s -m 610 -X POST http://127.0.0.1:${FED_SC[a]}/api/discovery/join-pot -H 'content-type: application/json' -d '{"potId":"$HIVE_ID","hivePubkey":"$HIVE_PUBKEY","memberLinks":["$A_LINK"]}'
EOF
)"
  A_MEMBER_SLUG="$(join_hive_member_slug "$a_join")"
  { printf '%s' "$a_join" | grep -q '"ok":true' && [ -n "$A_MEMBER_SLUG" ]; } \
    && echo "✓ A joined hive (member=$A_MEMBER_SLUG)" || echo "✗ A join-pot: $(printf '%s' "$a_join" | head -c 300)"
  b_join="$(drv_exec b <<EOF
curl -s -m 610 -X POST http://127.0.0.1:${FED_SC[b]}/api/discovery/join-pot -H 'content-type: application/json' -d '{"potId":"$HIVE_ID","hivePubkey":"$HIVE_PUBKEY","memberLinks":["$A_LINK"]}'
EOF
)"
  B_MEMBER_SLUG="$(join_hive_member_slug "$b_join")"
  { printf '%s' "$b_join" | grep -q '"ok":true' && [ -n "$B_MEMBER_SLUG" ]; } \
    && echo "✓ B joined hive (member=$B_MEMBER_SLUG)" || echo "✗ B join-pot: $(printf '%s' "$b_join" | head -c 300)"
  [ -n "$A_MEMBER_SLUG" ] && [ -n "$B_MEMBER_SLUG" ] || setup_fail "join-pot did not return member slugs for both frames" 6

  # 6. WRITE the durable state (everything --hotpatch / --teardown need)
  {
    printf 'FRAME a %s %s %s %s\n' "${FRAME_ID[a]}" "${FRAME_IP[a]}" "${FRAME_USER[a]}" "$A_MEMBER_SLUG"
    printf 'FRAME b %s %s %s %s\n' "${FRAME_ID[b]}" "${FRAME_IP[b]}" "${FRAME_USER[b]}" "$B_MEMBER_SLUG"
    printf 'HIVE_ID %s\n' "$HIVE_ID"
    printf 'HIVE_PUBKEY %s\n' "$HIVE_PUBKEY"
    printf 'PORTS %s %s\n' "$HONO_PORT" "$PG_PORT"
  } >> "$STATE_FILE"
  rm -rf "$WORK" 2>/dev/null

  fed_log "SETUP COMPLETE — VMs KEPT UP"
  echo "  A: ${FRAME_IP[a]} (member=$A_MEMBER_SLUG, $P_A_USER)"
  echo "  B: ${FRAME_IP[b]} (member=$B_MEMBER_SLUG, $P_B_USER)"
  echo "  hiveId=$HIVE_ID  state=$STATE_FILE"
  echo
  echo "  ⚠ BILLING: both Hetzner $STYPE VMs stay UP and BILL until you run --teardown."
  echo "  Next: rebuild serve.mjs locally, then:"
  echo "    bin/deb-hetzner-fast-iterate.sh --hotpatch=/path/to/serve.mjs"
  echo "  When done:"
  echo "    bin/deb-hetzner-fast-iterate.sh --teardown"
}

# ══════════════════════════════════════════════════════════════════════════════
# MODE: --hotpatch=PATH_TO_serve.mjs  (the fast inner loop)
# ══════════════════════════════════════════════════════════════════════════════
do_hotpatch() {
  [ -n "$SERVE_PATCH" ] && [ -f "$SERVE_PATCH" ] || die "--hotpatch needs an existing serve.mjs path"
  load_state
  fed_log "HOTPATCH serve.mjs onto BOTH kept-alive frames"
  echo "  patch: $SERVE_PATCH ($(stat -c%s "$SERVE_PATCH" 2>/dev/null) bytes)"
  echo "  A=${FRAME_IP[a]}  B=${FRAME_IP[b]}  hiveId=$HIVE_ID"

  # 1. scp the rebuilt serve.mjs onto both VMs at the sidecar path. The sidecar dir
  # is root-owned (/usr/lib/Papercusp/sidecar) — scp lands as root over the existing
  # file; the pcusp user only needs read, which the default mode provides.
  local inst
  for inst in a b; do
    fed_log "[$inst] scp serve.mjs → $SIDECAR_SERVE"
    hscp "${FRAME_IP[$inst]}" "$SERVE_PATCH" "$SIDECAR_SERVE" \
      || die "[$inst] scp of serve.mjs failed"
    # confirm it landed (size match) + keep it readable by pcusp
    hssh "${FRAME_IP[$inst]}" "chmod 0644 '$SIDECAR_SERVE'; stat -c '%s' '$SIDECAR_SERVE'" \
      | { read -r remote_sz; echo "  [$inst] landed $remote_sz bytes"; }
  done

  # 2. restart_sidecar on both (relaunch serve.mjs preserving pgdata + hive join)
  restart_sidecar a
  restart_sidecar b

  # 3. re-resolve PG/sidecar ports after the restart (the log markers reappear)
  fed_log "wait embedded-PG + operator after restart"
  fed_wait_boot a 40 || { drv_exec a <<<"tail -25 /home/pcusp/serve.log"; echo "✗ A re-boot failed: $FED_BOOT_ERR"; }
  fed_wait_boot b 40 || { drv_exec b <<<"tail -25 /home/pcusp/serve.log"; echo "✗ B re-boot failed: $FED_BOOT_ERR"; }
  fed_log "A: PG=${FED_PG[a]} sc=${FED_SC[a]} | B: PG=${FED_PG[b]} sc=${FED_SC[b]}"

  # 4. wait ~60s for [swarm] peer_connected on both (SHORT — kept-alive peers
  # rejoin fast; the long public-DHT cold-start window is only needed on --setup).
  fed_log "wait swarm peer_connected (~60s — warm rejoin after hotpatch)"
  sleep 8   # let both finish topic-join before probing
  echo "--- A [swarm] diag ---"; drv_exec a <<<"grep -aE '\[swarm\]|peer_connected|joined topic|drain|attempted=' /home/pcusp/serve.log | tail -8"
  echo "--- B [swarm] diag ---"; drv_exec b <<<"grep -aE '\[swarm\]|peer_connected|joined topic|drain|attempted=' /home/pcusp/serve.log | tail -8"
  disc="$(fed_wait_discovery a b strict 20 || true)"   # 20×3s ≈ 60s
  [ "$disc" = 1 ] && echo "✓ peer_connected across machines" || echo "⚠ no peer_connected in ~60s"

  # 5. re-run the merge probes with SHORT timeouts (20 iters × 3s ≈ 60s each)
  fed_log "A→B MERGE (hive probe; A member='$A_MEMBER_SLUG')"
  probe_ab="$(fed_hive_merge_probe a b "$A_MEMBER_SLUG" F-A2B 20 || true)"
  ab=0; [ "${probe_ab%% *}" = 1 ] && ab=1
  [ "$ab" = 1 ] && echo "✓ A→B: F-A2B federated into B (slug='${probe_ab#* }')" || echo "✗ A→B failed (probe=$probe_ab)"

  fed_log "B→A MERGE (hive probe; B member='$B_MEMBER_SLUG')"
  probe_ba="$(fed_hive_merge_probe b a "$B_MEMBER_SLUG" F-B2A 20 || true)"
  ba=0; [ "${probe_ba%% *}" = 1 ] && ba=1
  [ "$ba" = 1 ] && echo "✓ B→A: F-B2A federated into A (slug='${probe_ba#* }')" || echo "✗ B→A failed (probe=$probe_ba)"

  fed_log "PLAN-PART MERGE A→B + B→A"
  ppab="$(fed_plan_part_merge_assert a b "$A_MEMBER_SLUG" 20 || true)"
  [ "$ppab" = 1 ] && echo "✓ plan-part A→B" || echo "✗ plan-part A→B failed (probe=$ppab)"
  ppba="$(fed_plan_part_merge_assert b a "$B_MEMBER_SLUG" 20 || true)"
  [ "$ppba" = 1 ] && echo "✓ plan-part B→A" || echo "✗ plan-part B→A failed (probe=$ppba)"

  fed_log "COORD-COMMS MERGE A→B + B→A"
  cab="$(fed_coord_merge_probe a b "$A_MEMBER_SLUG" A2B 20 || true)"
  [ "$cab" = 1 ] && echo "✓ coord A→B" || echo "✗ coord A→B failed (probe=$cab)"
  cba="$(fed_coord_merge_probe b a "$B_MEMBER_SLUG" B2A 20 || true)"
  [ "$cba" = 1 ] && echo "✓ coord B→A" || echo "✗ coord B→A failed (probe=$cba)"

  # 6. report
  fed_log "HOTPATCH RESULT"
  echo "discovery=$([ "$disc" = 1 ] && echo PASS || echo FAIL)  A→B=$([ "$ab" = 1 ] && echo PASS || echo FAIL)  B→A=$([ "$ba" = 1 ] && echo PASS || echo FAIL)  plan-part A→B=$([ "$ppab" = 1 ] && echo PASS || echo FAIL)  plan-part B→A=$([ "$ppba" = 1 ] && echo PASS || echo FAIL)  coord A→B=$([ "${cab:-0}" = 1 ] && echo PASS || echo FAIL)  coord B→A=$([ "${cba:-0}" = 1 ] && echo PASS || echo FAIL)"
  if [ "$disc" = 1 ] && [ "$ab" = 1 ] && [ "$ba" = 1 ] && [ "$ppab" = 1 ] && [ "$ppba" = 1 ] && [ "${cab:-0}" = 1 ] && [ "${cba:-0}" = 1 ]; then
    echo "OVERALL: PASS — hotpatched serve.mjs federates cross-machine (features + plan-parts + coord)"
    echo "  (VMs still UP — iterate again with --hotpatch, or --teardown when done)"
    exit 0
  fi
  echo "OVERALL: INCOMPLETE — inspect /home/pcusp/serve.log on each frame (A=${FRAME_IP[a]} B=${FRAME_IP[b]})"
  echo "  (VMs still UP — fix serve.mjs and --hotpatch again, or --teardown)"
  exit 6
}

# ══════════════════════════════════════════════════════════════════════════════
# MODE: --teardown  (cost-safety: must reliably destroy)
# ══════════════════════════════════════════════════════════════════════════════
do_teardown() {
  [ -f "$STATE_FILE" ] || { echo "no state file ($STATE_FILE) — nothing to tear down."; exit 0; }
  fed_log "TEARDOWN — DESTROY all frames in $STATE_FILE (ends billing)"
  local sid leftover=0
  # Use SERVER_ID lines (every created server is stamped there, even ones that
  # never reached full FRAME state) so a partial setup is still fully destroyed.
  while read -r _ sid; do
    [ -n "$sid" ] || continue
    local i
    for i in 1 2 3 4 5 6; do delete_server "$sid"; server_gone "$sid" && { echo "  destroyed $sid"; break; }; sleep 5; done
    if server_gone "$sid"; then echo "  ✓ confirmed gone: $sid"
    else echo "  ⚠ $sid may still BILL — destroy manually in the Hetzner console"; leftover=1; fi
  done < <(grep '^SERVER_ID ' "$STATE_FILE")
  if [ "$leftover" = 0 ]; then
    rm -f "$STATE_FILE"
    echo "✓ all frames destroyed + state file removed ($STATE_FILE)"
    exit 0
  fi
  echo "✗ some frames NOT confirmed gone — state file KEPT ($STATE_FILE) so you can re-run --teardown"
  exit 1
}

# ══════════════════════════════════════════════════════════════════════════════
# MODE: --status
# ══════════════════════════════════════════════════════════════════════════════
do_status() {
  [ -f "$STATE_FILE" ] || { echo "no kept-alive frames (no $STATE_FILE)."; exit 0; }
  echo "state file: $STATE_FILE"
  local sid
  while read -r _ sid; do
    [ -n "$sid" ] || continue
    if server_gone "$sid"; then echo "  server $sid: GONE (404)"
    else
      local ip status
      ip="$(hz "https://api.hetzner.cloud/v1/servers/$sid" | python3 -c 'import json,sys;print(json.load(sys.stdin)["server"]["public_net"]["ipv4"]["ip"])' 2>/dev/null)"
      status="$(hz "https://api.hetzner.cloud/v1/servers/$sid" | python3 -c 'import json,sys;print(json.load(sys.stdin)["server"]["status"])' 2>/dev/null)"
      echo "  server $sid: $status @ $ip (BILLING)"
    fi
  done < <(grep '^SERVER_ID ' "$STATE_FILE")
  echo "hiveId=$(state_get HIVE_ID)  A-member=$(state_frame_field FRAME a 4)  B-member=$(state_frame_field FRAME b 4)"
  echo "Reminder: VMs BILL until --teardown."
}

case "$MODE" in
  setup)    do_setup ;;
  hotpatch) do_hotpatch ;;
  teardown) do_teardown ;;
  status)   do_status ;;
esac
