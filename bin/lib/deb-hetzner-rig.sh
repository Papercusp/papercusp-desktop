#!/usr/bin/env bash
# deb-hetzner-rig.sh — REUSABLE Hetzner cross-machine federation rig lib.
#
# Extracted from bin/deb-hetzner-federation.sh (the 2-frame .deb federation proof)
# so the live-matrix scenarios (federation-release-hardening Briefs 2-7) can each be
# a SMALL scenario script that `source`s this lib + bin/lib/federation-asserts.sh,
# provisions N frames, joins them to ONE hive, then drives + asserts — WITHOUT
# copy-pasting the ~250 lines of provision/install/join machinery or colliding on a
# single shared file.
#
# Topology: this lib generalizes the old hardcoded a=owner + b=joiner to an
# ARBITRARY frame array RIG_FRAMES=(a b c …). Frame `a` is the OWNER (it runs
# hives/from-repo + surfaces the hiveId/hivePubkey/memberLink); every frame
# (owner included) then JOINs the SAME hive via POST /api/discovery/join-hive
# (joinHiveAsView re-keys it onto the owner's hive-pubkey topic — EI-681). A
# scenario picks the frame count + per-frame gh identity + region.
#
# ── COST-SAFETY (the load-bearing invariant — read before editing) ────────────
# A leaked Hetzner server BILLS REAL MONEY, so the teardown is belt-and-braces and
# MUST hold for ANY frame count:
#   • EVERY provisioned server id is appended to $RIG_SERVERS_FILE INSIDE
#     rig_create_server, BEFORE the create returns and BEFORE any install — so even
#     a crash between "POST /servers succeeded" and "frame fully set up" still
#     leaves a destroyable record on disk.
#   • rig_install_exit_trap installs an EXIT trap (rig_cleanup) that reads
#     $RIG_SERVERS_FILE line-by-line and DELETEs every id, retrying up to 6× and
#     confirming each is GONE (HTTP 404). It does NOT depend on RIG_FRAMES, the
#     FRAME_* arrays, or how far setup got — purely the on-disk id list. So N
#     frames cannot leak: each create wrote its id before doing anything billable,
#     and the trap destroys the whole file regardless of where a failure happened.
#   • A scenario MUST call rig_install_exit_trap EXACTLY ONCE, right after
#     rig_init, BEFORE rig_provision. (rig_init creates the empty servers file;
#     the trap is then armed before the first create can run.)
#
# ── nounset (`set +u`) regime ─────────────────────────────────────────────────
# The consuming rigs run under `set +u` (federation-asserts.sh + the dynamic
# assoc arrays are nounset-hostile). This lib is written to be SAFE under either
# -u or +u: every assoc-array read that might be unset uses ${arr[$k]:-}, and the
# globals are `declare`d up front. Do not introduce a bare ${arr[$k]} on a key that
# may be absent.
#
# ── What a scenario uses ──────────────────────────────────────────────────────
#   source common.sh; source federation-asserts.sh; source deb-hetzner-rig.sh
#   rig_init                              # creds, work dir, servers file, frame map
#   rig_install_exit_trap                 # ARM auto-destroy (once, before provision)
#   rig_gate_artifact "$DEB"             # extract + clobber + swarm-support gates
#   rig_set_identity a papercupai         # per-frame gh identity (resolves GH_TOKEN)
#   rig_set_identity b aviynw
#   rig_set_identity c aviynw
#   rig_provision                         # create all RIG_FRAMES servers (records ids)
#   rig_setup_frame <inst>                # install .deb + launch headless sidecar
#   rig_wait_frame_ready <inst>           # embedded-PG + sidecar API up
#   rig_owner_publish_hive a "$REPO_URL" # owner from-repo → RIG_HIVE_ID/PUBKEY/LINK
#   rig_join_hive <inst>                  # join a frame to the hive (sets MEMBER_SLUG)
#   rig_driver_run <inst> -- <cmd…>       # arbitrary SSH command on a frame
#   rig_write_content / rig_read_content / rig_read_roster
#   rig_kill_sidecar / rig_restart_sidecar
#   rig_assert_absent  (NEGATIVE assert: a row does NOT arrive within a timeout)
#   … plus the fed_* asserts from federation-asserts.sh (merge / plan-part / coord).
#
# This lib does NOT call rig_cleanup directly and never decides overall pass/fail —
# the scenario owns its exit code (behavior parity with the pre-refactor rigs).

# ── globals (declared once; safe under set -u) ────────────────────────────────
declare -gA FRAME_ID FRAME_IP FRAME_USER FRAME_TOKEN FRAME_MEMBER_SLUG
declare -ga RIG_FRAMES
declare -g RIG_TOKEN RIG_SSH_KEY_ID RIG_SSH_IDENTITY
declare -g RIG_STYPE RIG_IMAGE RIG_HONO_PORT RIG_PG_PORT
declare -g RIG_WORK RIG_PKG RIG_SLUG RIG_SERVERS_FILE RIG_KEEP_UP
declare -g RIG_HIVE_ID RIG_HIVE_PUBKEY RIG_HIVE_LINK RIG_REPO_URL
RIG_FRAMES=()
RIG_KEEP_UP="${RIG_KEEP_UP:-0}"

# ── rig_init [STYPE] [IMAGE] ──────────────────────────────────────────────────
# Resolve creds + ports, make the run work dir, create the (empty) servers file.
# Idempotent fields default to the historical rig values. Must run before anything
# else; rig_install_exit_trap must run immediately after (before rig_provision).
rig_init() {
  RIG_STYPE="${1:-${RIG_STYPE:-cpx31}}"
  # IMAGE must match the .deb's target ABI: bundled embedded-PG pgvector vector.so
  # needs GLIBC_2.38 → ubuntu-24.04 (ubuntu-22.04/glibc-2.35 fails embedded-PG init
  # with "type public.vector does not exist"). EI-503.
  RIG_IMAGE="${2:-${RIG_IMAGE:-ubuntu-24.04}}"
  RIG_HONO_PORT="${RIG_HONO_PORT:-39070}"
  RIG_PG_PORT="${RIG_PG_PORT:-39532}"

  RIG_TOKEN="${HCLOUD_TOKEN:-$(cat ~/.papercusp/hcloud-token 2>/dev/null)}"
  # BYO-frames mode (RIG_FRAME_IPS set) never touches the Hetzner API, so no token
  # is required — Hetzner access is GONE (owner 2026-07-03, D-001 of
  # shared-hive-p2p-release-readiness-2026-07-03); local frames are the proof of
  # record. bin/local-matrix.sh is the one-command local bring-up.
  if [ -z "$RIG_TOKEN" ] && [ -z "${RIG_FRAME_IPS:-}" ]; then
    echo "FATAL: no HCLOUD_TOKEN (or ~/.papercusp/hcloud-token) — Hetzner access is gone; for LOCAL frames set RIG_FRAME_IPS (one-command: bin/local-matrix.sh)" >&2; return 1
  fi
  RIG_SSH_KEY_ID="${HETZNER_SSH_KEY_ID:-113417406}"
  # BYO seam: an inherited RIG_SSH_IDENTITY (bin/local-matrix.sh exports the
  # local frames' key ~/.papercusp/local-rig-ssh) WINS — rig_init must NOT
  # clobber it back to the Hetzner default. The old unconditional overwrite +
  # IdentitiesOnly=yes in rig_ssh made every BYO run offer ONLY the wrong key
  # → auth-fail → "FATAL ssh" at the first rig_setup_frame (2026-07-03, P-004
  # soak runs #2/#3; masked before the IdentitiesOnly fix by a loaded ssh-agent
  # offering its whole keyring first).
  RIG_SSH_IDENTITY="${RIG_SSH_IDENTITY:-${HETZNER_SSH_IDENTITY:-$HOME/.ssh/papercusp-latitude-frame}}"

  RIG_WORK="$(mktemp -d /tmp/deb-hzfed.XXXXXX)"
  RIG_PKG="$RIG_WORK/pkg"
  RIG_SLUG="hzdeb${RIG_WORK##*.}"
  RIG_SERVERS_FILE="$RIG_WORK/servers"; : > "$RIG_SERVERS_FILE"
  RIG_KEEP_UP="${RIG_KEEP_UP:-0}"
  # WI-1442 fix (c) / WI-1628: stamp every server this run creates with the
  # CREATING AGENT's owner id (a Hetzner label — see rig_create_server below) so
  # the orphan-frame reaper can resolve whose coord:presence to check before ever
  # destroying a frame a hard-killed agent left running. Sanitized to Hetzner's
  # label-value charset ([a-zA-Z0-9_.-], <=63 chars) — PAPERCUSP_SID (su-<uuid>)
  # already fits; the fallback keeps rig_create_server working (unlabeled) for a
  # shell that isn't a papercusp agent session, at the cost of the reaper skipping
  # those frames (no owner to verify — see hetzner-orphan-frame-reaper.ts's safety model).
  RIG_OWNER_LABEL="$(printf '%s' "${PAPERCUSP_SID:-}" | tr -c 'a-zA-Z0-9_.-' '-' | cut -c1-63)"
  # Hetzner recycles the same public IPs run-to-run, so a persisted mux master
  # from a DESTROYED frame would poison the new frame's connections — start clean.
  rm -f /tmp/deb-hzfed-mux-* 2>/dev/null || true
  echo "rig_init: work=$RIG_WORK slug=$RIG_SLUG type=$RIG_STYPE image=$RIG_IMAGE" >&2
}

# ── Hetzner API + SSH helpers ─────────────────────────────────────────────────
rig_hz()  { curl -s -m 40 -H "Authorization: Bearer $RIG_TOKEN" "$@"; }
# ControlMaster multiplexing: the rig fires DOZENS of short ssh/scp connections
# per run at the same 2 recycled IPs, and 3 consecutive 2026-07-01 runs died on
# transient port-22 connect timeouts mid-run (SYN throttling somewhere on the
# path). One persistent master per frame makes every later call ride an ALREADY-
# OPEN connection; ConnectionAttempts retries the initial TCP connect itself.
RIG_SSH_MUX_OPTS=(-o ControlMaster=auto -o ControlPath=/tmp/deb-hzfed-mux-%r@%h -o ControlPersist=900)
rig_ssh() { local ip="$1"; shift; ssh -i "$RIG_SSH_IDENTITY" -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=15 \
  -o ConnectionAttempts=3 "${RIG_SSH_MUX_OPTS[@]}" \
  -o ServerAliveInterval=15 "root@$ip" "$@"; }
# ^ IdentitiesOnly: without it a loaded ssh-agent offers its whole keyring before
# the -i identity and trips the server's MaxAuthTries ("Too many authentication
# failures") — found 2026-07-03 on the local containerized frames (P-002).
# dst spaces are safe UNquoted: OpenSSH ≥9 scp speaks SFTP (no remote shell), so
# the path arrives as one literal — and added quotes become literal characters
# (proven 2026-07-01: "dest open \"'/tmp/…'\"" failed a run). Install roots may
# contain a space since the 'Papercusp GUI' productName rename.
rig_scp() { local ip="$1" src="$2" dst="$3"; scp -i "$RIG_SSH_IDENTITY" -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=15 \
  -o ConnectionAttempts=3 "${RIG_SSH_MUX_OPTS[@]}" "$src" "root@$ip:$dst"; }
# rig_ssh_wait <ip> [tries] — re-probe connectivity until an ssh no-op succeeds.
# Fresh Hetzner VMs flap transiently (2026-07-01: a ConnectTimeout at the launch
# step killed a whole Brief-4 run AFTER the 986MB install had succeeded). A probe
# is retry-safe where rig_ssh itself is NOT (stdin-fed `bash -s` calls can't be
# blindly re-run), so callers insert this BEFORE each critical ssh step.
rig_ssh_wait() {
  local ip="$1" tries="${2:-12}" i
  for i in $(seq 1 "$tries"); do rig_ssh "$ip" true 2>/dev/null && return 0; sleep 5; done
  echo "FATAL: ssh $ip unreachable after $tries probes" >&2; return 1
}

# rig_create_server <name> <loc> → echo "<id> <ip>"
# COST-SAFETY: appends <id> to $RIG_SERVERS_FILE the instant the POST succeeds,
# BEFORE waiting for boot or doing anything billable. The EXIT trap destroys every
# id in that file, so a crash anywhere after this point still cleans up.
rig_create_server() {
  local name="$1" loc="$2" resp id try
  # The create POST can return an EMPTY body while the server IS created
  # (observed 2026-07-02: empty response, then 409 "name is already used" on
  # retry). So: retry the create up to 3×, and on ANY attempt also try to
  # RECOVER the id by name — covering both the transient-empty and the
  # created-but-unreported cases without double-provisioning.
  # WI-1628: label body fragment — empty ({}) when no owner is resolvable (a shell
  # outside a papercusp agent session), so create() behaves exactly as before.
  local labels_json="{}"
  [ -n "${RIG_OWNER_LABEL:-}" ] && labels_json="{\"pcusp-owner\":\"$RIG_OWNER_LABEL\"}"
  for try in 1 2 3; do
    resp="$(rig_hz -X POST 'https://api.hetzner.cloud/v1/servers' -H 'content-type: application/json' \
      -d "{\"name\":\"$name\",\"server_type\":\"$RIG_STYPE\",\"image\":\"$RIG_IMAGE\",\"location\":\"$loc\",\"ssh_keys\":[$RIG_SSH_KEY_ID],\"labels\":$labels_json}")"
    id="$(printf '%s' "$resp" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("server",{}).get("id") or "")' 2>/dev/null)"
    [ -n "$id" ] && break
    id="$(rig_hz "https://api.hetzner.cloud/v1/servers?name=$name" | python3 -c 'import json,sys;s=json.load(sys.stdin).get("servers",[]);print(s[0]["id"] if s else "")' 2>/dev/null)"
    [ -n "$id" ] && { echo "  (recovered $name by name after an empty create response)" >&2; break; }
    [ "$try" = 3 ] && { echo "FATAL create $name: $resp" >&2; return 1; }
    sleep 5
  done
  echo "$id" >> "$RIG_SERVERS_FILE"   # cost-safety: record BEFORE waiting/installing
  local i ip status
  for i in $(seq 1 60); do
    resp="$(rig_hz "https://api.hetzner.cloud/v1/servers/$id")"
    status="$(printf '%s' "$resp" | python3 -c 'import json,sys;print(json.load(sys.stdin)["server"]["status"])' 2>/dev/null)"
    ip="$(printf '%s' "$resp" | python3 -c 'import json,sys;print(json.load(sys.stdin)["server"]["public_net"]["ipv4"]["ip"])' 2>/dev/null)"
    [ "$status" = "running" ] && [ -n "$ip" ] && { echo "$id $ip"; return 0; }
    sleep 5
  done
  echo "FATAL $name not running" >&2; return 1
}
rig_delete_server() { rig_hz -X DELETE "https://api.hetzner.cloud/v1/servers/$1" >/dev/null 2>&1; }
rig_server_gone()   { local code; code="$(rig_hz -o /dev/null -w '%{http_code}' "https://api.hetzner.cloud/v1/servers/$1")"; [ "$code" = "404" ]; }

# ── teardown: the EXIT-trap auto-destroy (N-frame correct) ────────────────────
# Reads ONLY $RIG_SERVERS_FILE — never RIG_FRAMES / the FRAME_* arrays — so it
# destroys every server that was ever created, regardless of how many frames there
# are or where setup failed. Each id is DELETEd (retry ×6) and confirmed GONE (404).
rig_cleanup() {
  fed_log "cleanup — DESTROY all frames (ends billing)"
  local id i
  if [ "${RIG_KEEP_UP:-0}" = 1 ]; then
    echo "  --keep-up: leaving $(tr '\n' ' ' < "$RIG_SERVERS_FILE" 2>/dev/null)" >&2
  else
    while read -r id; do [ -n "$id" ] || continue
      for i in 1 2 3 4 5 6; do rig_delete_server "$id"; rig_server_gone "$id" && { echo "  destroyed $id"; break; }; sleep 5; done
      rig_server_gone "$id" || echo "  ⚠ $id may still BILL — destroy manually (DELETE /v1/servers/$id)"
    done < "$RIG_SERVERS_FILE"
  fi
  rm -rf "$RIG_WORK" 2>/dev/null
  # EI-5884 / WI-1442 fix (b): release the quota mutex UNCONDITIONALLY (even
  # under --keep-up, and even on a killed run — this runs from the EXIT trap)
  # so the next queued run can attempt its own provision. A real Hetzner
  # server_limit conflict (e.g. --keep-up left both slots occupied) still
  # surfaces as a genuine resource_limit_exceeded from the API — this mutex
  # only serializes the CREATE race, it does not model ongoing server count.
  rig_quota_release
}

# rig_install_exit_trap — ARM the auto-destroy. Call ONCE, right after rig_init,
# BEFORE rig_provision, so the trap is live before the first server is created.
rig_install_exit_trap() { trap rig_cleanup EXIT; }

# ── quota mutex: ops/hetzner-federation-quota (EI-5884 / WI-1442 fix b) ───────
# The Hetzner project's PERMANENT 2-server cap is shared across EVERY live-brief
# rig run. Before this fix the "acquire before provisioning" protocol was PROSE
# ONLY — ops/hetzner-federation-quota was never a registered resource, so
# locks:acquire_resource returned unknown_resource and concurrent runs raced
# rig_provision directly (2026-07-01: Brief 3 checked servers=0, then lost the
# create race to a concurrent run that grabbed both slots in the gap). Now
# registered (packages/locks/src/sql/016-*.sql); rig_provision acquires it
# EXCLUSIVELY (retrying while contended) before creating any server, and
# rig_cleanup releases it unconditionally — a bounded TTL (below) is the
# liveness backstop: even a hard-killed holder's lease lapses on its own
# rather than leaving a phantom hold forever.
RIG_QUOTA_RESOURCE="ops/hetzner-federation-quota"
RIG_QUOTA_LOCK_ID=""
OPERATOR_MCP_URL="${OPERATOR_MCP_URL:-http://127.0.0.1:3070/api/mcp}"

# rig_mcp_call <tool-name> <json-args> → echoes the raw JSON-RPC response.
# Thin curl-JSONRPC helper — same shape live-federation-gate.sh /
# two-instance-hive-*-smoke.sh already use to reach the operator from bash.
rig_mcp_call() {
  local tool="$1" args="$2" client="${RIG_SLUG:-hetzner-rig}-quota"
  curl -s -m 30 -X POST "${OPERATOR_MCP_URL}?superuser=1&client=$client" \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}" \
    2>/dev/null
}

# rig_quota_acquire — poll (fixed interval) until this run holds
# ops/hetzner-federation-quota exclusively, or give up after
# RIG_QUOTA_MAX_WAIT_SEC (default 30 min — long enough to queue behind a
# couple of concurrent live briefs without hanging a stuck rig forever). Sets
# RIG_QUOTA_LOCK_ID on success. `mode:exclusive` with no `wait` is a no-wait
# check-and-take (locks:acquire_resource's drain-wait is for a SHARED holder
# draining, not another exclusive holder — irrelevant here since this resource
# is never taken shared) — so the retry loop lives in bash, not the tool call.
# BEST-EFFORT: a curl/parse failure logs a WARNING and proceeds unlocked
# rather than hanging the whole rig forever on an operator hiccup — the
# per-create fail-fast + exit-trap teardown remain the hard cost-safety net
# either way.
rig_quota_acquire() {
  local max_wait="${RIG_QUOTA_MAX_WAIT_SEC:-1800}" poll="${RIG_QUOTA_POLL_SEC:-20}" waited=0 resp ok lock_id
  fed_log "quota: acquiring exclusive($RIG_QUOTA_RESOURCE) (queueing behind any concurrent rig run)…"
  while [ "$waited" -lt "$max_wait" ]; do
    resp="$(rig_mcp_call locks:acquire_resource "{\"resource\":\"$RIG_QUOTA_RESOURCE\",\"mode\":\"exclusive\",\"reason\":\"rig run $RIG_SLUG\",\"ttl_sec\":3600}")"
    ok="$(printf '%s' "$resp" | python3 -c '
import json, sys
try:
    env = json.load(sys.stdin)
    d = json.loads(env["result"]["content"][0]["text"])
    print("1" if d.get("ok") and d.get("status") == "held" else "0")
except Exception:
    print("0")' 2>/dev/null)"
    if [ "$ok" = "1" ]; then
      lock_id="$(printf '%s' "$resp" | python3 -c '
import json, sys
env = json.load(sys.stdin)
d = json.loads(env["result"]["content"][0]["text"])
print(d.get("lock_id", ""))' 2>/dev/null)"
      RIG_QUOTA_LOCK_ID="$lock_id"
      fed_log "quota: acquired ($RIG_QUOTA_LOCK_ID)"
      return 0
    fi
    fed_log "quota: contended or unreachable (waited ${waited}s/${max_wait}s) — retrying in ${poll}s…"
    sleep "$poll"
    waited=$((waited + poll))
  done
  fed_log "quota: WARNING — could not acquire $RIG_QUOTA_RESOURCE within ${max_wait}s (operator unreachable, or genuinely contended). Proceeding WITHOUT the mutex."
  return 1
}

# rig_quota_release — best-effort; call from rig_cleanup so it fires even on a
# killed run (the EXIT trap runs it unconditionally). No-ops quietly if we
# never acquired (RIG_QUOTA_LOCK_ID unset — e.g. rig_quota_acquire timed out
# and we proceeded unlocked, or the caller never called it at all).
rig_quota_release() {
  [ -n "$RIG_QUOTA_LOCK_ID" ] || return 0
  rig_mcp_call locks:release_resource "{\"lock_id\":\"$RIG_QUOTA_LOCK_ID\"}" >/dev/null 2>&1
  fed_log "quota: released ($RIG_QUOTA_LOCK_ID)"
  RIG_QUOTA_LOCK_ID=""
}

# ── artifact gates (reuse the assert core) ────────────────────────────────────
# rig_gate_artifact <deb> — extract + clobber + swarm-support; sets RIG_PKG.
rig_gate_artifact() {
  local deb="$1"
  fed_log "artifact: $deb"
  fed_extract_deb "$deb" "$RIG_PKG" || return 2
  fed_clobber_check "$RIG_PKG" || return 2
  fed_assert_deb_swarm_support "$RIG_PKG" || return 2
}

# ── identities ────────────────────────────────────────────────────────────────
# rig_set_identity <inst> <gh-user> — register a frame in RIG_FRAMES (idempotent),
# set its gh identity + resolve its GH_TOKEN. Multiple frames MAY share a gh user
# (e.g. two members both on aviynw) — that's a real multi-device topology.
rig_set_identity() {
  local inst="$1" ghuser="$2" tok
  case " ${RIG_FRAMES[*]} " in *" $inst "*) : ;; *) RIG_FRAMES+=("$inst") ;; esac
  FRAME_USER[$inst]="$ghuser"
  tok="$(gh auth token --user "$ghuser" 2>/dev/null)"
  [ -n "$tok" ] || { echo "FATAL: need a gh token for '$ghuser' (frame $inst)" >&2; return 1; }
  FRAME_TOKEN[$inst]="$tok"
}

# ── provision ─────────────────────────────────────────────────────────────────
# rig_provision <loc1> [loc2 …] — create one server per frame in RIG_FRAMES, in
# order. Each loc maps positionally to RIG_FRAMES[i]; if fewer locs than frames
# are given, the LAST loc is reused for the rest (so `rig_provision ash` puts every
# frame in ash). Records each id (rig_create_server) before doing anything billable.
rig_provision() {
  local locs=("$@") i inst loc out
  [ "${#RIG_FRAMES[@]}" -gt 0 ] || { echo "FATAL: no frames — call rig_set_identity first" >&2; return 1; }
  # BYO-frames seam (WI-1544): RIG_FRAME_IPS="ipA ipB …" maps pre-provisioned
  # hosts (e.g. local sshd containers when Hetzner can't create servers)
  # positionally onto RIG_FRAMES and skips the Hetzner API entirely. Nothing is
  # recorded in RIG_SERVERS_FILE, so rig_cleanup destroys nothing — the caller
  # owns the frames' lifecycle. Pair with RIG_DHT_BOOTSTRAP for same-box frames
  # (public-DHT NAT hairpinning between co-located peers is not reliable).
  if [ -n "${RIG_FRAME_IPS:-}" ]; then
    local ips=($RIG_FRAME_IPS)
    [ "${#ips[@]}" -ge "${#RIG_FRAMES[@]}" ] || { echo "FATAL: RIG_FRAME_IPS has ${#ips[@]} ips for ${#RIG_FRAMES[@]} frames" >&2; return 1; }
    fed_log "provision SKIPPED — BYO frames (${RIG_FRAMES[*]}) ← $RIG_FRAME_IPS"
    for i in "${!RIG_FRAMES[@]}"; do
      inst="${RIG_FRAMES[$i]}"
      FRAME_ID[$inst]="byo"; FRAME_IP[$inst]="${ips[$i]}"
      echo "  $inst=byo@${ips[$i]}"
    done
    return 0
  fi
  [ "${#locs[@]}" -gt 0 ] || locs=("ash")
  # EI-5884 / WI-1442 fix (b): serialize real Hetzner provisioning against every
  # OTHER concurrent rig run via the registered quota mutex — best-effort (a
  # timeout/operator-hiccup logs a WARNING and proceeds unlocked, per
  # rig_quota_acquire; the per-create fail-fast + exit-trap teardown are the
  # unconditional cost-safety net regardless).
  rig_quota_acquire || true
  fed_log "provision ${#RIG_FRAMES[@]} Hetzner $RIG_STYPE (frames: ${RIG_FRAMES[*]})"
  for i in "${!RIG_FRAMES[@]}"; do
    inst="${RIG_FRAMES[$i]}"
    loc="${locs[$i]:-${locs[$(( ${#locs[@]} - 1 ))]}}"
    out="$(rig_create_server "$RIG_SLUG-$inst" "$loc")" || return 3
    read -r FRAME_ID[$inst] FRAME_IP[$inst] <<<"$out"
    echo "  $inst=${FRAME_ID[$inst]}@${FRAME_IP[$inst]} ($loc)"
  done
}

# ── driver vtable: SSH into each frame by public IP ───────────────────────────
# These are the THREE federation-asserts.sh primitives, overridden for the Hetzner
# SSH driver. A scenario sources this lib AFTER federation-asserts.sh so these win.
drv_exec()   { rig_ssh "${FRAME_IP[$1]}" 'bash -s'; }
drv_applog() { echo "/home/pcusp/serve.log"; }
drv_psql()   { printf '%s\n' "$2" | rig_ssh "${FRAME_IP[$1]}" \
                 "psql 'postgresql://harness_admin:harness_admin_pwd@localhost:${FED_PG[$1]}/papercusp' -tA"; }

# ── generic SSH "driver" helper (the primitive briefs 2-7 build on) ───────────
# rig_driver_run <inst> -- <cmd> [args…]   run an arbitrary command on a frame as
#   root (the install/system context). Everything after `--` is the command.
# rig_driver_run <inst> <<<'script'       (no `--`) run a bash script from stdin
#   as root (same as drv_exec but explicit). Use rig_pcusp_run for the pcusp user.
rig_driver_run() {
  local inst="$1"; shift
  if [ "${1:-}" = "--" ]; then shift; rig_ssh "${FRAME_IP[$inst]}" "$@";
  else rig_ssh "${FRAME_IP[$inst]}" 'bash -s'; fi
}
# rig_pcusp_run <inst> — run a bash script (stdin) as the pcusp user with the
# sidecar env loaded (HONO/PG ports exported). The faithful context for sidecar ops.
rig_pcusp_run() {
  local inst="$1"
  rig_ssh "${FRAME_IP[$inst]}" "HONO=$RIG_HONO_PORT PG=$RIG_PG_PORT runuser -u pcusp -- bash -s"
}

# ── install .deb + launch the headless sidecar on each frame ──────────────────
# rig_setup_frame <inst> — wait sshd, install the gated .deb + driver prereqs,
# create the pcusp user, write its fed.env (GH_TOKEN), launch serve.mjs headless on
# the PUBLIC DHT (fresh data dir). Identical recipe to the 2-frame rig's setup_frame.
# Requires: rig_gate_artifact ran (the .deb path is the gated DEB); RIG_DEB set.
declare -g RIG_DEB
rig_setup_frame() {
  local inst="$1"; local ip="${FRAME_IP[$inst]}"
  [ -n "${RIG_DEB:-}" ] || { echo "FATAL: RIG_DEB unset — set it to the gated .deb path before rig_setup_frame" >&2; return 1; }
  fed_log "[$inst] wait sshd @ $ip"
  local i; for i in $(seq 1 40); do rig_ssh "$ip" true 2>/dev/null && break; sleep 5; done
  # Final probe WITHOUT the stderr swallow — when it fails, the actual ssh error
  # (e.g. "Permission denied (publickey)" vs a timeout) must land in the log;
  # 3 soak runs were mis-diagnosed off a bare "FATAL ssh" (2026-07-03).
  rig_ssh "$ip" true 2>/dev/null \
    || { echo "FATAL ssh $inst (identity=$RIG_SSH_IDENTITY) — last error:"; rig_ssh "$ip" true; return 1; }
  fed_log "[$inst] install .deb (fresh-install dep resolution) + driver prereqs"
  rig_scp "$ip" "$RIG_DEB" /tmp/Papercusp.deb || return 1
  rig_ssh "$ip" "SIDECAR_DIR='$(fed_sidecar_dir)' bash -s" <<'INSTEOF' | grep -q deb-ok || { echo "FATAL install $inst"; return 1; }
export DEBIAN_FRONTEND=noninteractive; apt-get update -qq
apt-get install -y -qq /tmp/Papercusp.deb >/dev/null 2>&1 || apt-get install -y -qq --fix-broken >/dev/null 2>&1
command -v gh >/dev/null && command -v psql >/dev/null && command -v git >/dev/null || apt-get install -y -qq gh postgresql-client git >/dev/null 2>&1
test -f "$SIDECAR_DIR/serve.mjs" && echo deb-ok
INSTEOF
  # RIG_SERVE_HOTPATCH=<local serve.mjs>: overwrite the installed sidecar bundle
  # BEFORE launch — the "live re-verify via rig hotpatch" lever (WI-1378/Brief-3
  # flow): rebuild ONLY serve.mjs from the current tree (bin/build-desktop-sidecar.sh's
  # esbuild step) instead of a full .deb rebuild, and test the fix live.
  if [ -n "${RIG_SERVE_HOTPATCH:-}" ]; then
    fed_log "[$inst] HOTPATCH sidecar serve.mjs ← $RIG_SERVE_HOTPATCH"
    rig_ssh_wait "$ip" || { echo "FATAL ssh $inst (pre-hotpatch)"; return 1; }
    rig_scp "$ip" "$RIG_SERVE_HOTPATCH" "$(fed_sidecar_dir)/serve.mjs" || { echo "FATAL hotpatch $inst"; return 1; }
    # WI-1544 schema-drift guard: a hotpatched serve.mjs runs CURRENT-tree code
    # against the .deb's FROZEN db-sql migrations (the launch pins
    # PAPERCUSP_PG_SQL_DIR at the sidecar's db-sql), so any migration added
    # since the .deb build silently never applies on the frames. Sync the
    # tree's top-level *.sql (the same set build-desktop-sidecar.sh copies)
    # alongside the hotpatched bundle. Override source: RIG_DBSQL_HOTPATCH.
    local dbsql="${RIG_DBSQL_HOTPATCH:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/libs/papercusp/libs/db/sql}"
    if [ -d "$dbsql" ]; then
      fed_log "[$inst] HOTPATCH sidecar db-sql ← $dbsql"
      (cd "$dbsql" && tar -cf - ./*.sql) \
        | rig_ssh "$ip" "tar -C \"$(fed_sidecar_dir)/db-sql\" -xf -" \
        || { echo "FATAL db-sql hotpatch $inst"; return 1; }
    else
      fed_log "[$inst] db-sql hotpatch SKIPPED — $dbsql not found"
    fi
  fi
  fed_log "[$inst] launch headless serve.mjs as non-root pcusp (PUBLIC DHT, identity ${FRAME_USER[$inst]})"
  rig_ssh_wait "$ip" || { echo "FATAL ssh $inst (pre-launch)"; return 1; }
  # embedded-postgres REFUSES to initdb as root (Hetzner's ubuntu image logs in as
  # root); the .deb is a desktop app that runs as a normal user, so launch the
  # sidecar under a dedicated `pcusp` user via runuser — faithful to real usage.
  printf 'GH_TOKEN=%s\n' "${FRAME_TOKEN[$inst]}" \
    | rig_ssh "$ip" 'id pcusp >/dev/null 2>&1 || useradd -m -s /bin/bash pcusp
        umask 077; cat > /home/pcusp/fed.env; chown pcusp:pcusp /home/pcusp/fed.env'
  rig_ssh "$ip" "HONO=$RIG_HONO_PORT PG=$RIG_PG_PORT DHTB='${RIG_DHT_BOOTSTRAP:-}' PGB='${RIG_PGBOUNCER:-0}' SIDE_DIR='$(fed_sidecar_dir)' runuser -u pcusp -- bash -s" <<'EOF'
set -e
H=/home/pcusp   # explicit — don't trust runuser's HOME handling
pkill -u pcusp -f 'serve.mjs --ensure' 2>/dev/null || true; sleep 1
rm -rf "$H/pgdata" "$H/.papercusp" "$H/.papercusp-workspaces"; mkdir -p "$H/pgdata" "$H/fed"
SIDE="${SIDE_DIR:-/usr/lib/Papercusp/sidecar}"
set -a; . "$H/fed.env"; set +a
cd "$SIDE"
env PATH="$SIDE/bin:/usr/bin:/bin" HOME="$H" USERPROFILE="$H" NODE_ENV=production \
  PAPERCUSP_HONO_PORT="$HONO" PAPERCUSP_BIND_HOST=127.0.0.1 HOSTNAME=127.0.0.1 \
  PAPERCUSP_PG_PORT="$PG" PAPERCUSP_PG_DATA_DIR="$H/pgdata" PAPERCUSP_PG_SQL_DIR="$SIDE/db-sql" \
  PAPERCUSP_SERVE_UI=0 PAPERCUSP_DESKTOP=1 \
  PAPERCUSP_FLAG_PAPERCUSP_PLAN_PART_FEDERATION=1 PAPERCUSP_A003_TRACE=1 \
  PAPERCUSP_ANNOUNCE_DEBUG=1 \
  PAPERCUSP_DHT_BOOTSTRAP="${DHTB:-}" \
  PAPERCUSP_PGBOUNCER="${PGB:-0}" \
  PAPERCUSP_HARNESS_DIR="$SIDE/harness" PAPERCUSP_PROMPTS_DIR="$SIDE/prompts" \
  PAPERCUSP_WORKSPACES_ROOT="$H/.papercusp-workspaces" \
  GH_TOKEN="${GH_TOKEN:-}" \
  setsid nohup ./bin/node ./serve.mjs --ensure >> "$H/serve.log" 2>&1 < /dev/null &
sleep 1; echo "launched as pcusp"
EOF
}

# rig_setup_all — rig_setup_frame for EVERY frame in RIG_FRAMES (in order).
rig_setup_all() {
  local inst
  for inst in "${RIG_FRAMES[@]}"; do rig_setup_frame "$inst" || return 4; done
}

# ── kill / restart sidecar (the offline/restart primitives, Briefs 4+5) ───────
# rig_kill_sidecar <inst> — stop the pcusp serve.mjs WITHOUT wiping pgdata (the
# "take this member offline" primitive: reconnect/catch-up + restart-durability).
rig_kill_sidecar() {
  local inst="$1"; local ip="${FRAME_IP[$inst]}"
  fed_log "[$inst] kill sidecar (preserve pgdata — member goes offline)"
  # Kill node AND the embedded-postgres children: pkill by 'serve.mjs' matches
  # only the node process; the postgres backends sometimes survive the parent
  # and then hold pgdata/postmaster.pid + the PG port, so the NEXT boot dies
  # with EMBEDDED_PG_FAILED (seen live: m1783106818 cycles 3/5 on frame b).
  # A real desktop quit takes PG down with it — emulate that, preserve pgdata.
  rig_ssh "$ip" "runuser -u pcusp -- bash -lc \"pkill -u pcusp -f 'serve.mjs' 2>/dev/null || true; sleep 1; pkill -u pcusp -f 'bin/postgres' 2>/dev/null || true; sleep 2; pgrep -u pcusp -f 'serve.mjs|bin/postgres' >/dev/null && echo 'STILL-RUNNING' || echo 'sidecar stopped'\""
}

# rig_restart_sidecar <inst> — relaunch serve.mjs WITHOUT wiping pgdata/.papercusp
# (EI-504): boot-all re-reads the registered project + shared.json + the hive join
# and rejoins the swarm. Used after a kill (Brief 4) and as the cold-restart probe
# (Brief 5). Same env block as rig_setup_frame, minus the rm -rf.
rig_restart_sidecar() {
  local inst="$1"; local ip="${FRAME_IP[$inst]}"
  fed_log "[$inst] restart sidecar (preserve pgdata) → boot-all reads state → swarm rejoin"
  rig_ssh "$ip" "HONO=$RIG_HONO_PORT PG=$RIG_PG_PORT DHTB='${RIG_DHT_BOOTSTRAP:-}' PGB='${RIG_PGBOUNCER:-0}' SIDE_DIR='$(fed_sidecar_dir)' runuser -u pcusp -- bash -s" <<'EOF'
set -e
H=/home/pcusp
pkill -u pcusp -f 'serve.mjs' 2>/dev/null || true; sleep 1
pkill -u pcusp -f 'bin/postgres' 2>/dev/null || true; sleep 2
# stale-lock hygiene: an orphaned/killed PG can leave postmaster.pid behind;
# with no live postgres for this pgdata, clear it or the boot dies EMBEDDED_PG_FAILED
pgrep -u pcusp -f 'bin/postgres' >/dev/null || rm -f "$H/pgdata/postmaster.pid"
SIDE="${SIDE_DIR:-/usr/lib/Papercusp/sidecar}"
set -a; . "$H/fed.env"; set +a
cd "$SIDE"
env PATH="$SIDE/bin:/usr/bin:/bin" HOME="$H" USERPROFILE="$H" NODE_ENV=production \
  PAPERCUSP_HONO_PORT="$HONO" PAPERCUSP_BIND_HOST=127.0.0.1 HOSTNAME=127.0.0.1 \
  PAPERCUSP_PG_PORT="$PG" PAPERCUSP_PG_DATA_DIR="$H/pgdata" PAPERCUSP_PG_SQL_DIR="$SIDE/db-sql" \
  PAPERCUSP_SERVE_UI=0 PAPERCUSP_DESKTOP=1 \
  PAPERCUSP_FLAG_PAPERCUSP_PLAN_PART_FEDERATION=1 PAPERCUSP_A003_TRACE=1 \
  PAPERCUSP_ANNOUNCE_DEBUG=1 \
  PAPERCUSP_DHT_BOOTSTRAP="${DHTB:-}" \
  PAPERCUSP_PGBOUNCER="${PGB:-0}" \
  PAPERCUSP_HARNESS_DIR="$SIDE/harness" PAPERCUSP_PROMPTS_DIR="$SIDE/prompts" \
  PAPERCUSP_WORKSPACES_ROOT="$H/.papercusp-workspaces" \
  GH_TOKEN="${GH_TOKEN:-}" \
  setsid nohup ./bin/node ./serve.mjs --ensure >> "$H/serve.log" 2>&1 < /dev/null &
sleep 1; echo "relaunched as pcusp (no wipe)"
EOF
}

# ── boot / API readiness (thin wrappers over the assert core) ─────────────────
# rig_wait_frame_ready <inst> [boot_tries] — embedded-PG + sidecar up (fed_wait_boot),
# then API answering 2xx (fed_wait_api). fed_wait_boot/fed_wait_api MUST be called
# directly (not in $(…)) so their FED_PG/FED_SC fills survive — this wrapper does so.
rig_wait_frame_ready() {
  local inst="$1" tries="${2:-50}"
  fed_wait_boot "$inst" "$tries" || { echo "✗ $inst boot failed: ${FED_BOOT_ERR:-?}"; drv_exec "$inst" <<<"tail -25 /home/pcusp/serve.log"; return 5; }
  echo "  $inst: PG=${FED_PG[$inst]} sc=${FED_SC[$inst]}"
  fed_wait_api "$inst" || echo "⚠ $inst api not ready"
}
# rig_wait_all_ready [boot_tries] — rig_wait_frame_ready for every frame.
rig_wait_all_ready() {
  local inst; for inst in "${RIG_FRAMES[@]}"; do rig_wait_frame_ready "$inst" "${1:-50}" || return 5; done
}

# ── owner publishes the hive (from-repo) → resolve hiveId/pubkey/memberLink ───
# rig_owner_publish_hive <owner-inst> <repo_url> — POST hives/from-repo on the
# owner, then resolve the THREE fields /api/discovery/join-hive needs
# ({ hiveId, hivePubkey, memberLinks }) from whichever response shape came back
# (fresh-create vs existing). Sets RIG_HIVE_ID / RIG_HIVE_PUBKEY / RIG_HIVE_LINK.
rig_owner_publish_hive() {
  local owner="$1" repo="${2:-https://github.com/octocat/Hello-World}" a_resp fields
  RIG_REPO_URL="$repo"
  fed_log "[$owner=OWNER] POST hives/from-repo ($repo, force) → resolve hive memberLink + hiveId + hivePubkey"
  # WI-1331 (Brief 5 live run): force:true is REQUIRED. The test repo
  # (octocat/Hello-World) already has a hive registered in the shared PUBLIC
  # directory from prior runs, so a non-forced from-repo hits the paste-time
  # lookup (_create_from_repo.ts:345 `if (!opts.force) return {existing}`) and
  # returns the `existing` JOIN-OFFER shape. For a source:"directory" hit that
  # shape carries ONLY {hiveId,title,ownerGithubLogin} — NO memberLinks / NO
  # hivePubkey (those come from the owner, not directory gossip) — so a joiner
  # can't join it and the rig FATALs "could not resolve a hive memberLink".
  # force:true skips the early-return and CREATES a FRESH isolated hive per run
  # (own slug + own hivePubkey → own federation topic), returning the
  # {created,publish:{memberLinks,hivePubkey}} shape the parse below expects.
  a_resp="$(drv_exec "$owner" <<EOF
curl -s -m 610 -X POST http://127.0.0.1:${FED_SC[$owner]}/api/harness/hives/from-repo -H 'content-type: application/json' -d '{"githubUrl":"$repo","force":true,"visibility":"public","runTests":false,"shallow":true}'
EOF
)"
  echo "[$owner] from-repo → $(printf '%s' "$a_resp" | head -c 200)"
  # The fields live in different shapes:
  #   fresh-create → {created:{hiveSlug}, publish:{memberLinks,hivePubkey}} (WI-931)
  #   existing     → {existing:{hive:{hiveId}}} (directory hit: NO memberLinks —
  #                  unreachable now that we always force-create fresh)
  fields="$(printf '%s' "$a_resp" | python3 -c 'import json,sys
d=json.load(sys.stdin)
ex=d.get("existing",{}).get("hive",{}) or {}
cr=d.get("created",{}) or {}
pub=d.get("publish",{}) or {}
ml=(ex.get("memberLinks") or cr.get("memberLinks") or pub.get("memberLinks") or [])
print(ml[0] if ml else "")
print(ex.get("hiveId") or cr.get("hiveSlug") or "")
print(ex.get("hivePubkey") or pub.get("hivePubkey") or "")
print(cr.get("memberSlug") or "")' 2>/dev/null)"
  { read -r RIG_HIVE_LINK; read -r RIG_HIVE_ID; read -r RIG_HIVE_PUBKEY; read -r RIG_OWNER_MEMBER_SLUG; } <<<"$fields"
  [ -n "$RIG_HIVE_LINK" ] || { echo "✗ $owner could not resolve a hive memberLink — body: $(printf '%s' "$a_resp" | head -c 1200)"; return 6; }
  [ -n "$RIG_HIVE_ID" ]   || { echo "✗ $owner could not resolve hiveId — body: $(printf '%s' "$a_resp" | head -c 1200)"; return 6; }
  echo "✓ $owner resolved hive link ${RIG_HIVE_LINK:0:56}… hiveId=$RIG_HIVE_ID hivePubkey=${RIG_HIVE_PUBKEY:0:12}…"
  [ -n "$RIG_HIVE_PUBKEY" ] || echo "⚠ $owner surfaced NO hivePubkey — joiners will skip identity-materialize (no re-key → no federation)."
}

# join-hive member-slug reader (first ok member's slug).
rig_join_member_slug() {
  printf '%s' "$1" | python3 -c 'import json,sys
d=json.load(sys.stdin)
ms=[m for m in d.get("members",[]) if m.get("ok") and m.get("slug")]
print(ms[0]["slug"] if ms else "")' 2>/dev/null
}

# rig_join_hive <inst> — JOIN <inst> to the published hive via /api/discovery/join-hive
# (joinHiveAsView: boots the member substrate AND re-keys it onto the owner's
# hive-pubkey topic — EI-681). Sets FRAME_MEMBER_SLUG[$inst]. hivePubkey is passed
# EXPLICITLY (a joiner's local discovery is empty). Requires rig_owner_publish_hive.
rig_join_hive() {
  local inst="$1" resp slug try
  [ -n "${RIG_HIVE_ID:-}" ] || { echo "FATAL: no hive published — call rig_owner_publish_hive first" >&2; return 1; }
  fed_log "[$inst] JOIN hive via /api/discovery/join-hive (hiveId=$RIG_HIVE_ID)"
  # 2 attempts with a reconnect probe between: an EMPTY resp means the SSH leg
  # died (transient flap — hit twice on 2026-07-01), not that the API refused.
  # Safe to retry: re-join is idempotent (existing view reused, members skipped,
  # owner self-join is a self_hive no-op).
  for try in 1 2; do
    resp="$(drv_exec "$inst" <<EOF
curl -s -m 610 -X POST http://127.0.0.1:${FED_SC[$inst]}/api/discovery/join-hive -H 'content-type: application/json' -d '{"hiveId":"$RIG_HIVE_ID","hivePubkey":"$RIG_HIVE_PUBKEY","memberLinks":["$RIG_HIVE_LINK"]}'
EOF
)"
    [ -n "$resp" ] && break
    [ "$try" = 1 ] && { echo "  ⚠ $inst join-hive got an empty response (ssh flap?) — re-probing + retrying once"; rig_ssh_wait "${FRAME_IP[$inst]}" 24 || break; }
  done
  slug="$(rig_join_member_slug "$resp")"
  # WI-1422 self-echo guard: the OWNER's self-join is now a NO-OP
  # ({ok:true, self_hive:true, members:[]}) — the owner's member harness was
  # already created by from-repo. Take its slug from the publish response.
  if [ -z "$slug" ] && printf '%s' "$resp" | grep -q '"self_hive":true'; then
    slug="${RIG_OWNER_MEMBER_SLUG:-}"
    [ -n "$slug" ] && echo "✓ $inst is the hive OWNER (self-join no-op; member=$slug)"
  fi
  FRAME_MEMBER_SLUG[$inst]="$slug"
  if printf '%s' "$resp" | grep -q '"ok":true' && [ -n "$slug" ]; then
    printf '%s' "$resp" | grep -q '"self_hive":true' || echo "✓ $inst joined hive (member=$slug)"
    return 0
  fi
  echo "✗ $inst join-hive failed: $(printf '%s' "$resp" | head -c 300)"; return 1
}

# rig_join_all <owner-inst> — join every NON-owner frame to the hive. The owner
# NEVER self-joins: its member harness already exists from the from-repo publish
# (RIG_OWNER_MEMBER_SLUG), and the old self-join-as-a-VIEW call was exactly the
# WI-1422 self-echo trigger — on a pre-guard .deb it minted a phantom
# '<hive>-2' remote view and rebound the owner's member harness to it, silently
# splitting owner→joiner federation (Brief-3 attempts 1-2, 2026-07-01). On a
# guarded .deb the call is a no-op anyway. Returns non-zero if any join fails.
rig_join_all() {
  local owner="$1" inst rc=0
  FRAME_MEMBER_SLUG[$owner]="${RIG_OWNER_MEMBER_SLUG:-}"
  if [ -n "${FRAME_MEMBER_SLUG[$owner]}" ]; then
    echo "✓ $owner is the hive OWNER (publish-time member=${FRAME_MEMBER_SLUG[$owner]}; no self-join)"
  else
    echo "⚠ $owner: no memberSlug in the publish response — falling back to self-join"
    rig_join_hive "$owner" || rc=1
  fi
  for inst in "${RIG_FRAMES[@]}"; do
    [ "$inst" = "$owner" ] && continue
    rig_join_hive "$inst" || rc=1
  done
  return "$rc"
}

# rig_wait_swarm <instA> <instB> [tries] — wait for [swarm] peer_connected between
# two frames over the public DHT (thin fed_wait_discovery strict wrapper). The
# sidecar-process swarm boot adds latency, so the default window is generous.
rig_wait_swarm() {
  local a="$1" b="$2" tries="${3:-70}" disc
  fed_log "wait swarm peer discovery $a↔$b over the PUBLIC DHT (~$(( tries * 3 ))s)"
  disc="$(fed_wait_discovery "$a" "$b" strict "$tries" || true)"
  [ "$disc" = 1 ] && { echo "✓ $a↔$b peer_connected across machines"; return 0; }
  echo "⚠ no $a↔$b peer_connected in ~$(( tries * 3 ))s"; return 1
}

# ── scenario content primitives (write / read) ────────────────────────────────
# These give scenario scripts a uniform way to author + read federated rows under
# the operator's REAL workspace (the harness drains WHERE workspace_id = its boot
# workspace — a bare INSERT defaulting to 'default' never drains; D-050).

# rig_write_content <inst> <harness_slug> <feature_id> [title] [status]
# INSERT a feature row origin='local' on <inst> (the capture trigger federates it).
# Echoes the feature_id written. The analog the fed_*_merge probes also use.
rig_write_content() {
  local inst="$1" slug="$2" fid="$3" title="${4:-rig write}" status="${5:-todo}" ts
  ts="$(date +%s)000"
  drv_psql "$inst" "INSERT INTO harness_shared.harness_features_consolidated (workspace_id,harness_slug,feature_id,title,summary,status,attempts,origin,ts,created_ts,updated_ts) VALUES (COALESCE((SELECT workspace_id FROM harness_shared.hive_members LIMIT 1),'default'),'$slug','$fid','$title','rig write','$status',0,'local',$ts,$ts,$ts);" >/dev/null
  echo "$fid"
}

# rig_read_content <inst> <feature_id> — echo "<harness_slug>|<origin>" for the
# row with this feature_id on <inst> (empty if absent). origin='remote' = federated.
rig_read_content() {
  local inst="$1" fid="$2"
  drv_psql "$inst" "SELECT harness_slug||'|'||origin FROM harness_shared.harness_features_consolidated WHERE feature_id='$fid' LIMIT 1;" 2>/dev/null | tr -d '[:space:]'
}

# rig_read_roster <inst> — echo the hive_members roster on <inst>, one row per
# line as "<github_user_id>|<binding_status>|<#device_attestations>". The decisive
# receive-side state (empty roster → decideMemberContentOp drops every peer op).
rig_read_roster() {
  local inst="$1"
  drv_psql "$inst" "SELECT github_user_id||'|'||binding_status||'|'||COALESCE(jsonb_array_length(device_attestations),0) FROM harness_shared.hive_members ORDER BY github_user_id;" 2>/dev/null
}

# ── revoke / ban (the Brief 3 revocation primitive) ───────────────────────────
# rig_github_id <gh-login> — resolve a GitHub login to its numeric user id via the
# public API (driver-side gh; the rig host is gh-authed). The revoke route keys on
# the STABLE numeric id (not the login), so a scenario turns FRAME_USER[b] into the
# id to ban. Echoes the id, or nothing on failure.
rig_github_id() { gh api "users/$1" --jq '.id' 2>/dev/null; }

# rig_ban_member <owner-inst> <target-github-id> [scope]
#   scope="hive" (DEFAULT) — Hive-wide revoke: POST /api/admin/substrate/revoke-contributor
#         {hiveSlug=RIG_HIVE_ID}. Authority = the Swarm holding the Hive key (the owner
#         frame that ran hives/from-repo). Drives revokeHiveContributor → the
#         revoked_pubkeys admission blocklist AND (once the C-001 re-key advances the
#         epoch EXCLUDING the target) the epoch K-cut READ cut-off. revoke.live is FALSE
#         until the next re-key lands — the owner must WRITE post-ban content to trigger
#         the re-key before the read cut-off bites (see deb-hetzner-revocation.sh).
#   scope="harness" — single-harness revoke {harnessSlug=owner member slug}, authority =
#         repo-admin token.
# Resolves workspaceId from the owner's hive_members. Echoes the raw JSON response
# ({ok:true,revokedPubkeys,live} on success).
#
# AUTH (verified live 2026-07-01): the route is auth:{trust:['verified','trusted']}. A bare
# localhost curl resolves to 'unverified-loopback' and is REJECTED (403 "trust
# unverified-loopback not in allowlist"). principalFromSuperuserToken grants trust:'trusted'
# for a LOOPBACK request carrying `Authorization: Bearer <token>` matching
# ~/.papercusp/superuser-token. The sidecar runs as user pcusp, so we resolve/ensure
# /home/pcusp/.papercusp/superuser-token ON the owner frame (as pcusp; generate one mode 0600
# if absent — the sidecar validates the bearer against the file PER-REQUEST, so a fresh write
# is honored, and an existing token is reused, never clobbered) and present it as the bearer.
# The token is never echoed/logged.
rig_ban_member() {
  local owner="$1" target_id="$2" scope="${3:-hive}" ws field val resp token
  [ -n "$target_id" ] || { echo "FATAL rig_ban_member: no target github id" >&2; return 1; }
  ws="$(drv_psql "$owner" "SELECT workspace_id FROM harness_shared.hive_members LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$ws" ] || ws="default"
  if [ "$scope" = "harness" ]; then field="harnessSlug"; val="${FRAME_MEMBER_SLUG[$owner]:-}"
  else field="hiveSlug"; val="${RIG_HIVE_ID:-}"; fi
  [ -n "$val" ] || { echo "FATAL rig_ban_member: no $field resolved (run rig_owner_publish_hive + rig_join_hive first)" >&2; return 1; }
  # trust:'trusted' bearer — read (or generate, as pcusp) the sidecar's superuser token so
  # principalFromSuperuserToken admits the revoke (loopback + matching bearer). Never clobber
  # an existing token; the sidecar re-reads the file per request so a fresh write is honored.
  token="$(rig_pcusp_run "$owner" <<'PCUSP' 2>/dev/null | tr -d '[:space:]'
f=/home/pcusp/.papercusp/superuser-token
[ -s "$f" ] || { mkdir -p /home/pcusp/.papercusp; head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40 > "$f"; chmod 600 "$f"; }
cat "$f"
PCUSP
)"
  [ -n "$token" ] || { echo "FATAL rig_ban_member: could not resolve/create the owner superuser-token (the revoke route needs trust:'trusted')" >&2; return 1; }
  fed_log "[$owner] BAN github_id=$target_id ($scope scope: $field=$val ws=$ws) [su-bearer]"
  resp="$(drv_exec "$owner" <<EOF
curl -s -m 120 -X POST "http://127.0.0.1:${FED_SC[$owner]}/api/admin/substrate/revoke-contributor" -H 'content-type: application/json' -H "Authorization: Bearer $token" -d '{"workspaceId":"$ws","$field":"$val","githubUserId":$target_id}'
EOF
)"
  echo "$resp"
}

# ── NEGATIVE assertion (the Brief 3 revocation / security primitive) ──────────
# rig_assert_absent <inst> <feature_id> [tries] — assert a feature row does NOT
# arrive on <inst> within tries×3s. The inverse of fed_*_merge_assert: it WAITS
# the full window and PASSES iff the row never shows up (a revoked/banned member
# must NOT receive post-revoke content). Echoes 1 (correctly absent) or 0 (it
# arrived — a leak). Because a negative is only meaningful after enough time, this
# always waits the full window before declaring absence (no early-out on success).
rig_assert_absent() {
  local inst="$1" fid="$2" tries="${3:-20}" i row
  for i in $(seq 1 "$tries"); do
    row="$(drv_psql "$inst" "SELECT 1 FROM harness_shared.harness_features_consolidated WHERE feature_id='$fid' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
    if [ "$row" = "1" ]; then echo 0; return 1; fi   # arrived → negative assert FAILS
    sleep 3
  done
  echo 1; return 0   # never arrived within the window → correctly absent
}

# rig_assert_row_absent <inst> <sql-predicate> [tries] — generic negative assert:
# PASS iff `SELECT 1 FROM … WHERE <predicate>` stays empty for the full window.
# <predicate> is a complete SQL boolean over any harness_shared table joined inline,
# e.g. "harness_shared.coord_event_log WHERE msg_id='X' AND origin='remote'". Lets
# briefs negative-assert coord/plan-part rows too, not just features.
rig_assert_row_absent() {
  local inst="$1" pred="$2" tries="${3:-20}" i row
  for i in $(seq 1 "$tries"); do
    row="$(drv_psql "$inst" "SELECT 1 FROM $pred LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
    if [ "$row" = "1" ]; then echo 0; return 1; fi
    sleep 3
  done
  echo 1; return 0
}
