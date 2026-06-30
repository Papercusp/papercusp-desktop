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
# IMAGE must match the .deb's target ABI: the bundled embedded-PG pgvector
# vector.so needs GLIBC_2.38, so ubuntu-22.04 (glibc 2.35) fails embedded-PG init
# with "type public.vector does not exist". The .deb targets ubuntu-24.04 (its apt
# Depends are all t64 packages); the linux-test-vm golden image is 24.04 too. (EI-503)
LOCS="ash,ash"; STYPE="cpx31"; DEB=""; KEEP_UP=0; IMAGE="ubuntu-24.04"
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
  PAPERCUSP_FLAG_PAPERCUSP_PLAN_PART_FEDERATION=1 \
  PAPERCUSP_HARNESS_DIR="$SIDE/harness" PAPERCUSP_PROMPTS_DIR="$SIDE/prompts" \
  PAPERCUSP_WORKSPACES_ROOT="$H/.papercusp-workspaces" \
  GH_TOKEN="${GH_TOKEN:-}" \
  setsid nohup ./bin/node ./serve.mjs --ensure > "$H/serve.log" 2>&1 < /dev/null &
sleep 1; echo "launched as pcusp"
EOF
}

# EI-504: relaunch a sidecar WITHOUT wiping pgdata/.papercusp — used after writing
# .papercusp/shared.json so boot-all re-reads it (defaultResolveSwarmBinding) and the
# substrate joins the gh-binding Hyperswarm topic. Preserves the registered project +
# embedded-PG so the harness + its shared.json survive the restart.
restart_sidecar() {  # <inst>
  local inst="$1" ip="${FRAME_IP[$inst]}"
  fed_log "[$inst] restart sidecar (preserve pgdata) → boot-all reads shared.json → swarm join"
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
  PAPERCUSP_SERVE_UI=0 PAPERCUSP_DESKTOP=1 \
  PAPERCUSP_FLAG_PAPERCUSP_PLAN_PART_FEDERATION=1 \
  PAPERCUSP_HARNESS_DIR="$SIDE/harness" PAPERCUSP_PROMPTS_DIR="$SIDE/prompts" \
  PAPERCUSP_WORKSPACES_ROOT="$H/.papercusp-workspaces" \
  GH_TOKEN="${GH_TOKEN:-}" \
  setsid nohup ./bin/node ./serve.mjs --ensure > "$H/serve.log" 2>&1 < /dev/null &
sleep 1; echo "relaunched as pcusp (no wipe)"
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
# hive-federation-cross-machine-merge D-002: the REAL merge test is the HIVE flow
# (from-repo publishes A's attestation binding + announces; join-link publishes B's
# binding + admits) run CROSS-MACHINE — the only config with BOTH the binding (admission)
# AND real holepunch (same-box can't punch; the shared.json shortcut lacked the binding).
REPO_URL="${HIVE_REPO_URL:-https://github.com/octocat/Hello-World}"
fed_log "A: POST hives/from-repo ($REPO_URL) → resolve the hive memberLink (handles create OR existing — the repo's hive persists gist-backed across runs)"
a_resp="$(drv_exec a <<EOF
curl -s -m 610 -X POST http://127.0.0.1:${FED_SC[a]}/api/harness/hives/from-repo -H 'content-type: application/json' -d '{"githubUrl":"$REPO_URL","visibility":"public","runTests":false,"shallow":true}'
EOF
)"
echo "A from-repo → $(printf '%s' "$a_resp" | head -c 200)"
A_LINK="$(printf '%s' "$a_resp" | python3 -c 'import json,sys
d=json.load(sys.stdin)
# memberLinks may live in: existing.hive.memberLinks (re-publish / directory offer),
# created.memberLinks (older shape), OR publish.memberLinks (WI-931: a freshly-created
# hives response is {created:{...}, publish:{memberLinks,hivePubkey}} — publish is a
# SIBLING of created, _create_from_repo.ts:120-125). Check all of them.
ml=(d.get("existing",{}).get("hive",{}).get("memberLinks")
    or d.get("created",{}).get("memberLinks")
    or d.get("publish",{}).get("memberLinks")
    or [])
print(ml[0] if ml else "")' 2>/dev/null)"
[ -n "$A_LINK" ] || { echo "✗ A could not resolve a hive memberLink — FULL body: $(printf '%s' "$a_resp" | head -c 1500)"; exit 6; }
echo "✓ A resolved hive link ${A_LINK:0:56}…"
# Both peers JOIN the SAME hive via A's EXACT memberLink — guarantees the same hive-pubkey
# topic (no rediscovery ambiguity / stale-hive split) AND publishes BOTH bindings (admission).
A_MEMBER_SLUG="amem-$SLUG"; B_MEMBER_SLUG="bmem-$SLUG"
fed_log "A + B both join the same hive (A=$A_MEMBER_SLUG, B=$B_MEMBER_SLUG)"
a_join="$(drv_exec a <<EOF
curl -s -m 310 -X POST http://127.0.0.1:${FED_SC[a]}/api/harness/join-link -H 'content-type: application/json' -d '{"slug":"$A_MEMBER_SLUG","harnessLinkUrl":"$A_LINK"}'
EOF
)"
printf '%s' "$a_join" | grep -q '"ok":true' && echo "✓ A joined as $A_MEMBER_SLUG" || echo "✗ A join failed: $(printf '%s' "$a_join" | head -c 200)"
b_join="$(drv_exec b <<EOF
curl -s -m 310 -X POST http://127.0.0.1:${FED_SC[b]}/api/harness/join-link -H 'content-type: application/json' -d '{"slug":"$B_MEMBER_SLUG","harnessLinkUrl":"$A_LINK"}'
EOF
)"
printf '%s' "$b_join" | grep -q '"ok":true' && echo "✓ B joined as $B_MEMBER_SLUG" || echo "✗ B join failed: $(printf '%s' "$b_join" | head -c 200)"
MEMBER_SLUG="$A_MEMBER_SLUG"

# NO RESTART (EI-521 isolation): join-link's boot_federate step already boots the
# federation substrate (drain + read-merge + swarm) at join time. A restart KILLS that
# substrate and boot-all does NOT re-boot joined members (attempted=0) — that was the
# run5 failure. So just give boot_federate's swarm a moment to peer-connect + drain.
fed_log "boot_federate booted the substrate at join — wait for peer_connect + drain (NO restart)"
sleep 12
echo "--- A [swarm]/drain diag ---"; drv_exec a <<<"grep -aE '\[swarm\]|joined topic|peer_connected|drain|federate|attempted=' /home/pcusp/serve.log | tail -8"
echo "--- B [swarm]/drain diag ---"; drv_exec b <<<"grep -aE '\[swarm\]|joined topic|peer_connected|drain|federate|attempted=' /home/pcusp/serve.log | tail -8"

fed_log "wait swarm peer discovery over the PUBLIC DHT (~210s — sidecar-process swarm boot adds latency; longer window rules out DHT timing vs a real peering bug, D-043)"
disc="$(fed_wait_discovery a b strict 70 || true)"
[ "$disc" = 1 ] && echo "✓ sidecars peer_connected across machines" || echo "⚠ no peer_connected in ~210s"
if [ "$disc" != 1 ]; then
  # D-043 DISC-DIAG: the sidecar JOINED its topic but did not peer. Dump the swarm/DHT
  # detail (announce/lookup/holepunch/bootstrap/flush) on BOTH frames to settle
  # 'joined-but-not-peering' = real sidecar-process transport bug vs public-DHT timing.
  # Slugs + transport tokens only; no credentials.
  fed_log "DISC-DIAG (D-043): sidecar swarm/DHT state — why joined-but-not-peering"
  for inst in a b; do
    echo "--- $inst: swarm/dht detail (serve.log) ---"
    drv_exec "$inst" <<<"grep -aE '\[swarm\]|joined topic|peer_connected|announce|lookup|holepunch|dht|bootstrap|flush|server|client' /home/pcusp/serve.log 2>/dev/null | tail -35"
  done
fi

fed_log "A→B MERGE (hive, slug-agnostic probe; A member='$MEMBER_SLUG')"
probe_ab="$(fed_hive_merge_probe a b "$MEMBER_SLUG" F-A2B 80 || true)"
ab=0; [ "${probe_ab%% *}" = 1 ] && ab=1
[ "$ab" = 1 ] && echo "✓ A→B: F-A2B federated into B as origin=remote (landed slug='${probe_ab#* }')" || echo "✗ A→B failed (probe=$probe_ab)"
fed_log "B→A MERGE (hive, slug-agnostic probe; B member='$B_MEMBER_SLUG')"
probe_ba="$(fed_hive_merge_probe b a "$B_MEMBER_SLUG" F-B2A 80 || true)"
ba=0; [ "${probe_ba%% *}" = 1 ] && ba=1
[ "$ba" = 1 ] && echo "✓ B→A: F-B2A federated into A as origin=remote (landed slug='${probe_ba#* }')" || echo "✗ B→A failed (probe=$probe_ba)"

# plan-federation-regrain P-008/D-004: the NEW per-part plan-federation table
# (flag papercusp-plan-part-federation ON in both sidecars) must federate
# cross-machine over the same wire. A→B then B→A, distinct plan slugs per dir.
fed_log "PLAN-PART MERGE (per-part plan federation, flag ON) A→B + B→A (hive member slugs)"
ppab="$(fed_plan_part_merge_assert a b "$MEMBER_SLUG" 80 || true)"
[ "$ppab" = 1 ] && echo "✓ plan-part A→B: item:P-001 federated into B as origin=remote" || echo "✗ plan-part A→B failed (probe=$ppab)"
ppba="$(fed_plan_part_merge_assert b a "$B_MEMBER_SLUG" 80 || true)"
[ "$ppba" = 1 ] && echo "✓ plan-part B→A: item:P-001 federated into A as origin=remote" || echo "✗ plan-part B→A failed (probe=$ppba)"

# D-042 COMMS: the cross-machine COMMUNICATION system (coord feed / coord_event_log)
# must federate over the SAME peer-log wire as content. A→B then B→A, harness-scoped.
fed_log "COORD-COMMS MERGE (coord_event_log feed) A→B + B→A (hive member slugs)"
cab="$(fed_coord_merge_probe a b "$MEMBER_SLUG" A2B 80 || true)"
[ "$cab" = 1 ] && echo "✓ coord A→B: comm event federated into B as origin=remote" || echo "✗ coord A→B failed (probe=$cab)"
cba="$(fed_coord_merge_probe b a "$B_MEMBER_SLUG" B2A 80 || true)"
[ "$cba" = 1 ] && echo "✓ coord B→A: comm event federated into A as origin=remote" || echo "✗ coord B→A failed (probe=$cba)"

# EI-521 WS-DIAG: on merge-fail, dump workspace_ids to settle product-bug vs probe-artifact —
# does the undrained outbox row's workspace_id match the member's boot workspace (the drain's
# WHERE workspace_id = handle.workspaceId)?
if [ "$ab" != 1 ] || [ "$ba" != 1 ] || [ "$ppab" != 1 ] || [ "$ppba" != 1 ] || [ "${cab:-0}" != 1 ] || [ "${cba:-0}" != 1 ]; then
  fed_log "WS-DIAG (EI-521): workspace_id alignment between capture + drain"
  echo "--- A: undrained outbox (id|table_name|harness_slug|workspace_id|drained_at) ---"; drv_psql a "SELECT id||'|'||table_name||'|'||COALESCE(harness_slug,'∅')||'|'||workspace_id||'|d='||COALESCE(drained_at::text,'NULL') FROM harness_shared.substrate_outbox ORDER BY id;" 2>/dev/null
  echo "--- A: booted-harness workspaceId/slug (the drain's WHERE key — does it match the outbox above?) ---"; drv_exec a <<<"grep -aoE 'bootHarness[^ ]* (ws|workspace)[=:][^ ]+ (slug|harness)[=:][^ ]+|wireOutbox.*slug[=:][^ ]+|startOutboxDrain.*[a-z]' /home/pcusp/serve.log 2>/dev/null | tail -10; echo '(drain-wiring lines:)'; grep -aE 'ensureRelocatedSendSideWired|wireOutbox|outbox wiring|startOutboxDrain|\[outbox-drain\]|relocated send-side|drain wired' /home/pcusp/serve.log 2>/dev/null | tail -15"
  echo "--- A: feature rows (harness_slug|workspace_id|origin) ---"; drv_psql a "SELECT harness_slug||'|'||workspace_id||'|'||origin FROM harness_shared.harness_features_consolidated;" 2>/dev/null
  echo "--- A: registry (slug|workspace_id) ---"; drv_psql a "SELECT slug||'|'||workspace_id FROM harness_shared.harness_registry;" 2>/dev/null
  # D-051: send-side drain now WORKS (A content rows get drained_at). Does the content REACH B?
  # Dump B's received content (origin=remote = federated). If present → federation works (probe
  # window was just too short); if absent → receive-side (replicate/merge/project) is the gap.
  echo "--- B: received content (table|harness_slug|workspace_id|origin) — origin=remote means federated ---"; drv_psql b "SELECT table_name||'|'||harness_slug||'|'||workspace_id||'|'||origin FROM (SELECT 'features' table_name, harness_slug, workspace_id, origin FROM harness_shared.harness_features_consolidated UNION ALL SELECT 'plan_parts', harness_slug, workspace_id, origin FROM harness_shared.harness_plan_parts UNION ALL SELECT 'coord_event', COALESCE(harness_slug,'∅'), workspace_id, origin FROM harness_shared.coord_event_log WHERE harness_slug IS NOT NULL) x ORDER BY 1;" 2>/dev/null
  echo "--- B: undrained-or-not outbox (id|table|harness_slug|workspace_id|drained) ---"; drv_psql b "SELECT id||'|'||table_name||'|'||COALESCE(harness_slug,'∅')||'|'||workspace_id||'|d='||COALESCE(drained_at::text,'NULL') FROM harness_shared.substrate_outbox ORDER BY id;" 2>/dev/null
  # RECEIVE-SIDE DIAG (from-repo-seed root cause, run20): the joiner applies 0 origin=remote rows
  # because its hive_directory_cache is empty → ownerDeviceForTopic null → no owner-log bootstrap-
  # admit → 0 hive_members roster → decideMemberContentOp drops/defers every peer op. Dump the three
  # receive-side states on BOTH frames so a fail is unambiguous (cache empty? roster empty? announce
  # never processed?). hive_directory_cache may be encrypted (payload_ct) — report row-existence +
  # column-non-null flags + (if plaintext) hive count, so the dump is encryption-agnostic.
  for inst in a b; do
    echo "--- $inst: hive_members roster (github_user_id|binding_status|#device_attest) ---"; drv_psql "$inst" "SELECT github_user_id||'|'||binding_status||'|'||COALESCE(jsonb_array_length(device_attestations),0) FROM harness_shared.hive_members ORDER BY github_user_id;" 2>/dev/null
    echo "--- $inst: hive_directory_cache (workspace_id|plain?|ct?|#hives) — empty = root cause ---"; drv_psql "$inst" "SELECT workspace_id||'|plain='||(payload IS NOT NULL)||'|ct='||(payload_ct IS NOT NULL)||'|hives='||COALESCE(jsonb_array_length(payload->'hives'),-1) FROM harness_shared.hive_directory_cache;" 2>/dev/null
    echo "--- $inst: announce/directory/bootstrap-admit activity (serve.log; counts+slugs only, no creds) ---"; drv_exec "$inst" <<<"grep -aoE 'verifyHiveAnnounce|hive-announce|hiveDirectory|hive_directory|ownerDeviceForTopic|bootstrap.?admit|loadHiveOwnerDevice|resolveSameHiveMember|\[announce\]' /home/pcusp/serve.log 2>/dev/null | sort | uniq -c | tail -20"
  done
  # (boot workspace = the registry workspace_id above; no serve.log token-grep — avoids
  #  echoing credential-shaped strings to diagnostic logs, security review MEDIUM)
  # EI-521 drain-loop diag (D-031): the SEND-side drain is wired (substrate-sidecar-host
  #  handleBootHarness → wireOutboxForHarness → startOutboxDrain) but the outbox is undrained.
  #  These prefixed lines carry NO credentials (slugs + counts only) — safe to echo.
  for inst in a b; do
    echo "--- $inst: outbox-drain / sidecar-host wiring lines (serve.log) ---"
    drv_exec "$inst" <<<"grep -aE '\[outbox-drain\]|\[substrate-sidecar-host\]|wireOutbox|startOutboxDrain|boot_federate|drain' /home/pcusp/serve.log 2>/dev/null | tail -25"
  done
fi

# ── 7. report ─────────────────────────────────────────────────────────────────
fed_log "RESULT (.deb sidecar, Hetzner $STYPE $LOC_A+$LOC_B, public DHT)"
if [ "$disc" != 1 ] || [ "$ab" != 1 ] || [ "$ba" != 1 ]; then
  for inst in a b; do echo "[$inst] $(drv_exec "$inst" <<<"grep -E '\[swarm\]' /home/pcusp/serve.log 2>/dev/null | tail -5")"; done
fi
echo "discovery=$([ "$disc" = 1 ] && echo PASS || echo FAIL)  A→B=$([ "$ab" = 1 ] && echo PASS || echo FAIL)  B→A=$([ "$ba" = 1 ] && echo PASS || echo FAIL)  plan-part A→B=$([ "$ppab" = 1 ] && echo PASS || echo FAIL)  plan-part B→A=$([ "$ppba" = 1 ] && echo PASS || echo FAIL)  coord A→B=$([ "${cab:-0}" = 1 ] && echo PASS || echo FAIL)  coord B→A=$([ "${cba:-0}" = 1 ] && echo PASS || echo FAIL)"
if [ "$disc" = 1 ] && [ "$ab" = 1 ] && [ "$ba" = 1 ] && [ "$ppab" = 1 ] && [ "$ppba" = 1 ] && [ "${cab:-0}" = 1 ] && [ "${cba:-0}" = 1 ]; then
  echo "OVERALL: PASS — the .deb federates cross-machine incl. per-part plans AND coord COMMUNICATION (2 separate Hetzner VMs, real public DHT)"; exit 0
fi
echo "OVERALL: INCOMPLETE — see [swarm] diagnostics + /home/pcusp/serve.log on each frame"; exit 6
