#!/usr/bin/env bash
# deb-hetzner-federation.sh — the PACKAGED-.deb cross-machine federation proof
# (linux-test-vm-and-federation-2026-06-04 Phase 2, the .deb-specific variant of
# D-019). Where vm-federation.sh runs two .deb instances in same-HOST qemu VMs
# (which cannot holepunch — D-017/D-018), this runs the SHIPPED .deb's federating
# SIDECAR (serve.mjs + bundled embedded-pg + swarm) on TWO genuinely-separate
# Hetzner cloud VMs over the PUBLIC DHT — where the substrate Tier-3 already
# proved holepunch + merge complete (D-019). It reuses the SAME assert core the
# one-box smokes + vm-federation.sh use (bin/lib/federation-asserts.sh, D-003);
# only the driver (SSH to a Hetzner public IP) + the launch (headless serve.mjs,
# no Tauri GUI / no Xvfb — the GUI is irrelevant to federation) differ.
#
# Pass criteria (same as vm-federation.sh, now for the .deb's sidecar across the
# real internet): both sidecars boot embedded-pg + operator; share write-free;
# [swarm] peer_connected in both; a feature INSERTed on A lands in B's PG as
# origin='remote' within ~90s AND the reverse; teardown = DESTROY (ends billing).
#
# Cost-safety (belt-and-braces, mirrors bench-frames.ts): every provisioned
# server id is written to $WORK/servers BEFORE install; the EXIT trap DELETEs
# every one and confirms it is GONE (404). No frame is left billing.
#
# Env / creds:
#   HCLOUD_TOKEN            Hetzner API token (default: ~/.papercusp/hcloud-token)
#   HETZNER_SSH_KEY_ID      ssh key id registered in the project (default 113417406)
#   HETZNER_SSH_IDENTITY    matching private key (default ~/.ssh/papercusp-latitude-frame)
#   gh auth: papercupai + aviynw (per-frame GH_TOKEN identity, like vm-federation.sh)
#
# Usage: bin/deb-hetzner-federation.sh [--locs=ash,ash] [--type=cpx31] [--deb=PATH] [--keep-up]
set -uo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/scripts/linux-test-vm/lib/common.sh"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"
set +e   # this driver owns its own exit codes (the asserts report PASS/FAIL)
set +u   # federation-asserts.sh + the dynamic FED_*/FRAME_* assoc arrays are
         # nounset-hostile (e.g. a just-declared local referenced in the same
         # `local`); common.sh left -u on, which tripped provision→setup handoff.

# ── args / config ─────────────────────────────────────────────────────────────
LOCS="ash,ash"; STYPE="cpx31"; DEB=""; KEEP_UP=0; IMAGE="ubuntu-22.04"
for arg in "$@"; do case "$arg" in
  --locs=*) LOCS="${arg#--locs=}" ;;
  --type=*) STYPE="${arg#--type=}" ;;
  --deb=*)  DEB="${arg#--deb=}" ;;
  --image=*) IMAGE="${arg#--image=}" ;;
  --keep-up) KEEP_UP=1 ;;
  -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) die "unknown arg: $arg" ;;
esac; done
IFS=',' read -r LOC_A LOC_B <<<"$LOCS"
[ -n "$DEB" ] || DEB="$(default_deb)"
TOKEN="${HCLOUD_TOKEN:-$(cat ~/.papercusp/hcloud-token 2>/dev/null)}"
[ -n "$TOKEN" ] || die "no HCLOUD_TOKEN (or ~/.papercusp/hcloud-token)"
SSH_KEY_ID="${HETZNER_SSH_KEY_ID:-113417406}"
SSH_IDENTITY="${HETZNER_SSH_IDENTITY:-$HOME/.ssh/papercusp-latitude-frame}"
P_A_USER="${P_A_USER:-papercupai}"; P_B_USER="${P_B_USER:-aviynw}"
HONO_PORT=39070; PG_PORT=39532
WORK="$(mktemp -d /tmp/deb-hzfed.XXXXXX)"; PKG="$WORK/pkg"
SLUG="hzdeb${WORK##*.}"
SERVERS_FILE="$WORK/servers"; : > "$SERVERS_FILE"

declare -gA FRAME_ID FRAME_IP FRAME_USER FRAME_TOKEN

# ── Hetzner API + SSH helpers ─────────────────────────────────────────────────
hz() { curl -s -m 40 -H "Authorization: Bearer $TOKEN" "$@"; }
hssh() { local ip="$1"; shift; ssh -i "$SSH_IDENTITY" -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 \
  -o ServerAliveInterval=15 "root@$ip" "$@"; }
hscp() { local ip="$1" src="$2" dst="$3"; scp -i "$SSH_IDENTITY" -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR "$src" "root@$ip:$dst"; }

create_server() {  # <name> <loc> → echo "<id> <ip>"
  local name="$1" loc="$2" resp id
  resp="$(hz -X POST 'https://api.hetzner.cloud/v1/servers' -H 'content-type: application/json' \
    -d "{\"name\":\"$name\",\"server_type\":\"$STYPE\",\"image\":\"$IMAGE\",\"location\":\"$loc\",\"ssh_keys\":[$SSH_KEY_ID]}")"
  id="$(printf '%s' "$resp" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("server",{}).get("id") or "")' 2>/dev/null)"
  [ -n "$id" ] || { echo "FATAL create $name: $resp" >&2; return 1; }
  echo "$id" >> "$SERVERS_FILE"   # cost-safety: record BEFORE waiting/installing
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
server_gone() { local code; code="$(hz -o /dev/null -w '%{http_code}' "https://api.hetzner.cloud/v1/servers/$1")"; [ "$code" = "404" ]; }

cleanup() {
  fed_log "cleanup — DESTROY all frames (ends billing)"
  local id i
  if [ "$KEEP_UP" = 1 ]; then log "--keep-up: leaving $(tr '\n' ' ' < "$SERVERS_FILE")"; else
    while read -r id; do [ -n "$id" ] || continue
      for i in 1 2 3 4 5 6; do delete_server "$id"; server_gone "$id" && { echo "  destroyed $id"; break; }; sleep 5; done
      server_gone "$id" || echo "  ⚠ $id may still BILL — destroy manually"
    done < "$SERVERS_FILE"
  fi
  rm -rf "$WORK" 2>/dev/null
}
trap cleanup EXIT

# ── 1. artifact gates (reuse the assert core) ─────────────────────────────────
fed_log "artifact: $DEB"
fed_extract_deb "$DEB" "$PKG" || exit 2
fed_clobber_check "$PKG" || exit 2
fed_assert_deb_swarm_support "$PKG" || exit 2

# ── 2. identities ─────────────────────────────────────────────────────────────
FRAME_USER[a]="$P_A_USER"; FRAME_USER[b]="$P_B_USER"
FRAME_TOKEN[a]="$(gh auth token --user "$P_A_USER" 2>/dev/null)"
FRAME_TOKEN[b]="$(gh auth token --user "$P_B_USER" 2>/dev/null)"
[ -n "${FRAME_TOKEN[a]}" ] && [ -n "${FRAME_TOKEN[b]}" ] || { echo "FATAL: need gh tokens for $P_A_USER + $P_B_USER"; exit 1; }

# ── 3. provision both frames ──────────────────────────────────────────────────
fed_log "provision 2 Hetzner $STYPE ($LOC_A + $LOC_B)"
read -r FRAME_ID[a] FRAME_IP[a] <<<"$(create_server "$SLUG-a" "$LOC_A")" || exit 3
read -r FRAME_ID[b] FRAME_IP[b] <<<"$(create_server "$SLUG-b" "$LOC_B")" || exit 3
echo "  a=${FRAME_ID[a]}@${FRAME_IP[a]}  b=${FRAME_ID[b]}@${FRAME_IP[b]}"

# ── 4. driver vtable: SSH into each frame by public IP ────────────────────────
drv_exec()   { hssh "${FRAME_IP[$1]}" 'bash -s'; }
drv_applog() { echo "/home/pcusp/serve.log"; }
drv_psql()   { printf '%s\n' "$2" | hssh "${FRAME_IP[$1]}" \
                 "psql 'postgresql://harness_admin:harness_admin_pwd@localhost:${FED_PG[$1]}/papercusp' -tA"; }

# ── 5. install .deb + prereqs + launch the headless sidecar on each frame ──────
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
  # embedded-postgres REFUSES to initdb as root (Hetzner's ubuntu image logs in
  # as root); the .deb is a desktop app that runs as a normal user, so launch the
  # sidecar under a dedicated `pcusp` user via runuser — faithful to real usage.
  # The proven headless recipe (main.rs spawn_serve, validated locally): bundled
  # node on PATH, PG+harness+prompts env, SERVE_UI=0, no PAPERCUSP_DHT_BOOTSTRAP
  # (real public DHT). Fresh data dir each run.
  printf 'GH_TOKEN=%s\n' "${FRAME_TOKEN[$inst]}" \
    | hssh "$ip" 'id pcusp >/dev/null 2>&1 || useradd -m -s /bin/bash pcusp
        umask 077; cat > /home/pcusp/fed.env; chown pcusp:pcusp /home/pcusp/fed.env'
  hssh "$ip" "HONO=$HONO_PORT PG=$PG_PORT runuser -u pcusp -- bash -s" <<'EOF'
set -e
H=/home/pcusp   # explicit — don't trust runuser's HOME handling
pkill -u pcusp -f 'serve.mjs --ensure' 2>/dev/null || true; sleep 1
rm -rf "$H/pgdata" "$H/.papercusp" "$H/.papercusp-workspaces"; mkdir -p "$H/pgdata" "$H/fed"
SIDE=/usr/lib/Papercusp/sidecar
set -a; . "$H/fed.env"; set +a
cd "$SIDE"
env PATH="$SIDE/bin:/usr/bin:/bin" HOME="$H" USERPROFILE="$H" NODE_ENV=production \
  PAPERCUSP_HONO_PORT="$HONO" PAPERCUSP_BIND_HOST=127.0.0.1 HOSTNAME=127.0.0.1 \
  PAPERCUSP_PG_PORT="$PG" PAPERCUSP_PG_DATA_DIR="$H/pgdata" PAPERCUSP_PG_SQL_DIR="$SIDE/db-sql" \
  PAPERCUSP_SERVE_UI=0 PAPERCUSP_DESKTOP=1 \
  PAPERCUSP_HARNESS_DIR="$SIDE/harness" PAPERCUSP_PROMPTS_DIR="$SIDE/prompts" \
  PAPERCUSP_WORKSPACES_ROOT="$H/.papercusp-workspaces" \
  GH_TOKEN="${GH_TOKEN:-}" \
  setsid nohup ./bin/node ./serve.mjs --ensure > "$H/serve.log" 2>&1 < /dev/null &
sleep 1; echo "launched as pcusp"
EOF
}
setup_frame a || exit 4
setup_frame b || exit 4

# ── 6. boot + share + discovery + merge (the assert core, over SSH) ───────────
fed_log "wait embedded-PG + operator in both sidecars"
fed_wait_boot a 50 || { echo "A boot failed: $FED_BOOT_ERR"; drv_exec a <<<"tail -25 /home/pcusp/serve.log"; exit 5; }
fed_wait_boot b 50 || { echo "B boot failed: $FED_BOOT_ERR"; drv_exec b <<<"tail -25 /home/pcusp/serve.log"; exit 5; }
echo "✓ isolated by construction (separate cloud machines)"
fed_log "A: PG=${FED_PG[a]} sc=${FED_SC[a]} | B: PG=${FED_PG[b]} sc=${FED_SC[b]}"

fed_wait_api a || echo "⚠ A api not ready"; fed_wait_api b || echo "⚠ B api not ready"
TOPIC=$(printf 'papercusp-substrate-v1:gh:918273645' | sha256sum | cut -d' ' -f1)
STATE="{\"topic\":\"$TOPIC\",\"github_repository_id\":918273645,\"github_remote\":\"https://github.com/${FRAME_USER[a]}/$SLUG\",\"privacy\":\"shared-private\"}"
fed_log "register + share write-free on both (topic=${TOPIC:0:16}…)"
drv_exec a <<<'runuser -u pcusp -- mkdir -p /home/pcusp/fed' ; drv_exec b <<<'runuser -u pcusp -- mkdir -p /home/pcusp/fed'
fed_register_project a "$SLUG" /home/pcusp/fed proj-a
fed_register_project b "$SLUG" /home/pcusp/fed proj-b
echo "A: $(fed_share_finalize a "$SLUG" "$STATE" | grep -oE '"state":"[a-z-]+"|"bindingPublished":[a-z]+' | tr '\n' ' ')"
echo "B: $(fed_share_finalize b "$SLUG" "$STATE" | grep -oE '"state":"[a-z-]+"|"bindingPublished":[a-z]+' | tr '\n' ' ')"

fed_log "wait swarm peer discovery over the PUBLIC DHT (~90s)"
disc="$(fed_wait_discovery a b strict 30 || true)"
[ "$disc" = 1 ] && echo "✓ .deb sidecars peer_connected across machines" || echo "⚠ no peer_connected in ~90s"

fed_log "A→B MERGE"
ab="$(fed_merge_assert a b "$SLUG" F-A2B "from ${FRAME_USER[a]}" todo 30 || true)"
[ "$ab" = 1 ] && echo "✓ A→B: F-A2B federated into B as origin=remote" || echo "✗ A→B failed"
fed_log "B→A MERGE"
ba="$(fed_merge_assert b a "$SLUG" F-B2A "from ${FRAME_USER[b]}" in-progress 30 || true)"
[ "$ba" = 1 ] && echo "✓ B→A: F-B2A federated into A as origin=remote" || echo "✗ B→A failed"

# ── 7. report ─────────────────────────────────────────────────────────────────
fed_log "RESULT (.deb sidecar, Hetzner $STYPE $LOC_A+$LOC_B, public DHT)"
if [ "$disc" != 1 ] || [ "$ab" != 1 ] || [ "$ba" != 1 ]; then
  for inst in a b; do echo "[$inst] $(drv_exec "$inst" <<<"grep -E '\[swarm\]' /home/pcusp/serve.log 2>/dev/null | tail -5")"; done
fi
echo "discovery=$([ "$disc" = 1 ] && echo PASS || echo FAIL)  A→B=$([ "$ab" = 1 ] && echo PASS || echo FAIL)  B→A=$([ "$ba" = 1 ] && echo PASS || echo FAIL)"
if [ "$disc" = 1 ] && [ "$ab" = 1 ] && [ "$ba" = 1 ]; then
  echo "OVERALL: PASS — the SHIPPED .deb federates cross-machine (2 separate Hetzner VMs, real public DHT)"; exit 0
fi
echo "OVERALL: INCOMPLETE — see [swarm] diagnostics + /home/pcusp/serve.log on each frame"; exit 6
