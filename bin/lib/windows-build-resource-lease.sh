#!/usr/bin/env bash
# windows-build-resource-lease.sh — one cross-agent authority for the Windows
# VM + VM_BUILD_DIR build lane (WI-4642 / P-021).
#
# Source this from the Linux-side producer, then call:
#   windows_build_lease_acquire "$VM_SSH_HOST" "$VM_SSH_PORT" "$VM_BUILD_DIR" \
#     "Windows desktop build" 7200
#   ...work...
#   windows_build_lease_release
#
# The lease is an existing Papercusp named-resource lock, not a second mutex:
# locks:list exposes its owner, reason (purpose + ETA), and expiry. A declared
# events:emit gate supplies the latched release event. TTL is crash-only
# backstop; a heartbeat keeps a healthy long build alive and EXIT/INT/TERM
# cleanup releases explicitly and verifies that this owner disappeared.

if [[ -n "${__PAPERCUSP_WINDOWS_BUILD_LEASE_LIB:-}" ]]; then return 0; fi
__PAPERCUSP_WINDOWS_BUILD_LEASE_LIB=1

_WINDOWS_BUILD_LEASE_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
_WINDOWS_BUILD_LEASE_MCP_CALL="${PAPERCUSP_WINDOWS_LEASE_MCP_CALL:-$_WINDOWS_BUILD_LEASE_REPO_ROOT/scripts/mcp-call.mjs}"
_WINDOWS_BUILD_LEASE_TTL_SEC="${PAPERCUSP_WINDOWS_LEASE_TTL_SEC:-900}"
_WINDOWS_BUILD_LEASE_HEARTBEAT_SEC="${PAPERCUSP_WINDOWS_LEASE_HEARTBEAT_SEC:-60}"
# WI-5600 (2026-07-20): a SINGLE transient mcp-call/network blip on one
# heartbeat tick used to nuke an ~85min build outright. These bound the
# retry-before-terminate behavior: MAX_RETRIES/RETRY_DELAY govern in-tick
# short-backoff retries for a momentary blip; the overall stale-writer
# terminate decision (below, in _windows_build_lease_start_heartbeat) is
# additionally keyed on a budget derived from the lease TTL, so only a
# SUSTAINED renewal failure — not one flaky call — kills the build.
_WINDOWS_BUILD_LEASE_HEARTBEAT_MAX_RETRIES="${PAPERCUSP_WINDOWS_LEASE_HEARTBEAT_MAX_RETRIES:-3}"
_WINDOWS_BUILD_LEASE_HEARTBEAT_RETRY_DELAY_SEC="${PAPERCUSP_WINDOWS_LEASE_HEARTBEAT_RETRY_DELAY_SEC:-5}"

PAPERCUSP_WINDOWS_BUILD_LEASE_HELD=0
PAPERCUSP_WINDOWS_BUILD_LEASE_LOCK_ID=""
PAPERCUSP_WINDOWS_BUILD_LEASE_EVENT=""
PAPERCUSP_WINDOWS_BUILD_LEASE_RESOURCE=""
PAPERCUSP_WINDOWS_BUILD_LEASE_OWNER=""
PAPERCUSP_WINDOWS_BUILD_LEASE_HEARTBEAT_PID=""
PAPERCUSP_WINDOWS_BUILD_LEASE_ETA=""

_windows_build_lease_mcp() {
  local tool="$1" args="$2"
  PAPERCUSP_HONO_PORT="${PAPERCUSP_WINDOWS_LEASE_HONO_PORT:-${PAPERCUSP_HONO_PORT:-3070}}" \
    node "$_WINDOWS_BUILD_LEASE_MCP_CALL" "$tool" "$args" \
      --client "$PAPERCUSP_WINDOWS_BUILD_LEASE_OWNER" \
      --workspace "${PAPERCUSP_WINDOWS_LEASE_WORKSPACE:-papercusp-workspace}" \
      --harness "${PAPERCUSP_WINDOWS_LEASE_HARNESS:-papercusp}"
}

_windows_build_json_field() {
  local path="$1"
  node -e '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      try {
        let value = JSON.parse(raw);
        for (const key of process.argv[1].split(".")) value = value?.[key];
        if (value === undefined || value === null) process.exit(2);
        process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
      } catch { process.exit(2); }
    });
  ' "$path"
}

_windows_build_heartbeat_extended() {
  local lock_id="$1"
  node -e '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      try {
        const o = JSON.parse(raw);
        process.stdout.write(o?.results?.[0]?.extended === true ? "true" : "false");
      } catch {
        // Trimmed MCP responses use TOON. The heartbeat row schema is
        // results{ok,lock_id,extended,expires_ts}; match our exact lock id so a
        // different row can never make this lease look healthy.
        const expected = "true," + process.argv[1] + ",true,";
        process.stdout.write(raw.split(/\r?\n/).some(line => line.trimStart().startsWith(expected)) ? "true" : "false");
      }
    });
  ' "$lock_id"
}

_windows_build_lease_release_raw() {
  local args
  args="$(node -e 'process.stdout.write(JSON.stringify({lock_id:process.argv[1]}))' "$PAPERCUSP_WINDOWS_BUILD_LEASE_LOCK_ID")"
  _windows_build_lease_mcp locks:release_resource "$args"
}

_windows_build_lease_heartbeat_once() {
  # One heartbeat renewal, with bounded IN-TICK retries (short backoff) so a
  # single transient mcp-call/network blip doesn't immediately read as lease
  # loss. Returns 0 if the lease was extended, 1 if every attempt this tick
  # failed. Logs each failed attempt to stderr (last failure's detail included).
  local local_args heartbeat_out attempt=1
  local max_retries="$_WINDOWS_BUILD_LEASE_HEARTBEAT_MAX_RETRIES"
  local retry_delay="$_WINDOWS_BUILD_LEASE_HEARTBEAT_RETRY_DELAY_SEC"
  local_args="$(node -e 'process.stdout.write(JSON.stringify({lock_id:process.argv[1],ttl_sec:Number(process.argv[2])}))' \
    "$PAPERCUSP_WINDOWS_BUILD_LEASE_LOCK_ID" "$_WINDOWS_BUILD_LEASE_TTL_SEC")"
  while (( attempt <= max_retries )); do
    if heartbeat_out="$(_windows_build_lease_mcp locks:heartbeat_resource "$local_args" 2>&1)" \
      && [[ "$(printf '%s' "$heartbeat_out" | _windows_build_heartbeat_extended "$PAPERCUSP_WINDOWS_BUILD_LEASE_LOCK_ID" 2>/dev/null || true)" == "true" ]]; then
      return 0
    fi
    echo "WARN: Windows VM build lease heartbeat attempt $attempt/$max_retries failed (transient?): $heartbeat_out" >&2
    attempt=$(( attempt + 1 ))
    (( attempt <= max_retries )) && sleep "$retry_delay"
  done
  return 1
}

_windows_build_lease_start_heartbeat() {
  local parent_pid="$$"
  (
    trap - INT TERM
    local last_success_epoch now elapsed budget_sec
    last_success_epoch=$(date +%s)
    # Keep retrying across ticks until roughly HALF the lease TTL has elapsed
    # with NO successful renewal — the other half is buffer against the
    # actual server-side expiry while we terminate + drain. A lone failed
    # tick (WI-5600: one transient "fetch failed") never trips this; only a
    # SUSTAINED renewal failure does.
    budget_sec=$(( _WINDOWS_BUILD_LEASE_TTL_SEC / 2 ))
    (( budget_sec < 1 )) && budget_sec=1
    while sleep "$_WINDOWS_BUILD_LEASE_HEARTBEAT_SEC"; do
      if _windows_build_lease_heartbeat_once; then
        last_success_epoch=$(date +%s)
        continue
      fi
      now=$(date +%s)
      elapsed=$(( now - last_success_epoch ))
      if (( elapsed >= budget_sec )); then
        echo "ERROR: Windows VM build lease heartbeat has failed continuously for ${elapsed}s (>= ${budget_sec}s retry budget, half of the ${_WINDOWS_BUILD_LEASE_TTL_SEC}s TTL) — lease is genuinely at risk of loss; terminating before this process can become a stale writer." >&2
        kill -TERM "$parent_pid" 2>/dev/null || true
        exit 1
      fi
      echo "WARN: Windows VM build lease heartbeat tick failed (failed continuously for ${elapsed}s of a ${budget_sec}s retry budget) — will keep retrying next tick." >&2
    done
  ) &
  PAPERCUSP_WINDOWS_BUILD_LEASE_HEARTBEAT_PID="$!"
}

windows_build_lease_acquire() {
  local vm_host="$1" vm_port="$2" vm_dir="$3"
  local purpose="${4:-Windows desktop build}" eta_sec="${5:-7200}"
  local resource acquire_args acquire_out status announce_args announce_out expires_sec

  if [[ "$PAPERCUSP_WINDOWS_BUILD_LEASE_HELD" == "1" ]]; then
    echo "ERROR: Windows VM build lease is already held by this process" >&2
    return 70
  fi

  resource="${PAPERCUSP_WINDOWS_BUILD_RESOURCE:-windows-vm-build:${vm_host}:${vm_port}:${vm_dir}}"
  PAPERCUSP_WINDOWS_BUILD_LEASE_OWNER="${PAPERCUSP_WINDOWS_BUILD_LEASE_OWNER_OVERRIDE:-windows-build-$(hostname | tr -c 'A-Za-z0-9_-' '-')-$$}"
  PAPERCUSP_WINDOWS_BUILD_LEASE_RESOURCE="$resource"
  PAPERCUSP_WINDOWS_BUILD_LEASE_ETA="$(date -u -d "@$(( $(date +%s) + eta_sec ))" +%Y-%m-%dT%H:%M:%SZ)"

  acquire_args="$(node -e '
    process.stdout.write(JSON.stringify({
      resource: process.argv[1], mode: "exclusive",
      reason: `purpose=${process.argv[2]}; eta=${process.argv[3]}; pid=${process.argv[4]}`,
      ttl_sec: Number(process.argv[5]), wait: { max_drain_sec: 0 }
    }));
  ' "$resource" "$purpose" "$PAPERCUSP_WINDOWS_BUILD_LEASE_ETA" "$$" "$_WINDOWS_BUILD_LEASE_TTL_SEC")"

  if ! acquire_out="$(_windows_build_lease_mcp locks:acquire_resource "$acquire_args" 2>&1)"; then
    echo "ERROR: could not acquire the Windows VM build lease before mutation: $acquire_out" >&2
    return 73
  fi
  status="$(printf '%s' "$acquire_out" | _windows_build_json_field status 2>/dev/null || true)"
  PAPERCUSP_WINDOWS_BUILD_LEASE_LOCK_ID="$(printf '%s' "$acquire_out" | _windows_build_json_field lock_id 2>/dev/null || true)"
  if [[ "$status" != "held" || -z "$PAPERCUSP_WINDOWS_BUILD_LEASE_LOCK_ID" ]]; then
    echo "ERROR: Windows VM build resource is busy; refusing before preflight/extract/build. Resource=$resource ETA=$PAPERCUSP_WINDOWS_BUILD_LEASE_ETA response=$acquire_out" >&2
    PAPERCUSP_WINDOWS_BUILD_LEASE_LOCK_ID=""
    return 73
  fi

  expires_sec=$(( eta_sec + _WINDOWS_BUILD_LEASE_TTL_SEC ))
  announce_args="$(node -e '
    process.stdout.write(JSON.stringify({
      event: `windows-vm-build-released:${process.argv[1]}`,
      announce: true, announceScope: "global", expiresSec: Number(process.argv[2]),
      summary: `Windows VM build lease release: resource=${process.argv[3]} owner=${process.argv[4]} eta=${process.argv[5]}`
    }));
  ' "$PAPERCUSP_WINDOWS_BUILD_LEASE_LOCK_ID" "$expires_sec" "$resource" "$PAPERCUSP_WINDOWS_BUILD_LEASE_OWNER" "$PAPERCUSP_WINDOWS_BUILD_LEASE_ETA")"
  if ! announce_out="$(_windows_build_lease_mcp events:emit "$announce_args" 2>&1)"; then
    echo "ERROR: acquired the Windows VM build lease but could not declare its latched release event; releasing fail-closed: $announce_out" >&2
    _windows_build_lease_release_raw >/dev/null 2>&1 || true
    PAPERCUSP_WINDOWS_BUILD_LEASE_LOCK_ID=""
    return 74
  fi
  PAPERCUSP_WINDOWS_BUILD_LEASE_EVENT="$(printf '%s' "$announce_out" | _windows_build_json_field event 2>/dev/null || true)"
  if [[ -z "$PAPERCUSP_WINDOWS_BUILD_LEASE_EVENT" ]]; then
    echo "ERROR: release-event declaration returned no event key; releasing fail-closed: $announce_out" >&2
    _windows_build_lease_release_raw >/dev/null 2>&1 || true
    PAPERCUSP_WINDOWS_BUILD_LEASE_LOCK_ID=""
    return 74
  fi

  PAPERCUSP_WINDOWS_BUILD_LEASE_HELD=1
  _windows_build_lease_start_heartbeat
  echo "==> Windows VM build lease HELD: resource=$resource owner=$PAPERCUSP_WINDOWS_BUILD_LEASE_OWNER eta=$PAPERCUSP_WINDOWS_BUILD_LEASE_ETA release_event=$PAPERCUSP_WINDOWS_BUILD_LEASE_EVENT"
}

windows_build_lease_release() {
  local release_out list_args list_out lingering emit_args emit_out rc=0
  if [[ "$PAPERCUSP_WINDOWS_BUILD_LEASE_HELD" != "1" ]]; then return 0; fi

  if [[ -n "$PAPERCUSP_WINDOWS_BUILD_LEASE_HEARTBEAT_PID" ]]; then
    kill "$PAPERCUSP_WINDOWS_BUILD_LEASE_HEARTBEAT_PID" 2>/dev/null || true
    wait "$PAPERCUSP_WINDOWS_BUILD_LEASE_HEARTBEAT_PID" 2>/dev/null || true
    PAPERCUSP_WINDOWS_BUILD_LEASE_HEARTBEAT_PID=""
  fi

  if ! release_out="$(_windows_build_lease_release_raw 2>&1)"; then
    echo "ERROR: Windows VM build lease release call failed: $release_out" >&2
    rc=1
  fi

  list_args="$(node -e 'process.stdout.write(JSON.stringify({resource:process.argv[1]}))' "$PAPERCUSP_WINDOWS_BUILD_LEASE_RESOURCE")"
  if ! list_out="$(_windows_build_lease_mcp locks:list "$list_args" 2>&1)"; then
    echo "ERROR: could not verify Windows VM build lease cleanup: $list_out" >&2
    rc=1
  else
    lingering="$(printf '%s' "$list_out" | node -e '
      let raw=""; process.stdin.setEncoding("utf8"); process.stdin.on("data",c=>raw+=c);
      process.stdin.on("end",()=>{
        try {
          const o=JSON.parse(raw); const hs=o.holders ?? o.data?.holders ?? [];
          process.stdout.write(hs.some(h=>h.owner===process.argv[1])?"true":"false");
        } catch {
          // locks:list is payload-tier shaped as TOON in trimmed MCP sessions.
          // Its empty-holder sentinel is exact; otherwise the owner value is a
          // dedicated holder column, so an exact line field is authoritative.
          if (/^holders:\s*\[\]\s*$/m.test(raw)) process.stdout.write("false");
          else if (raw.split(/\r?\n/).some(line => line.trimStart().startsWith(process.argv[1] + ","))) process.stdout.write("true");
          else process.exit(2);
        }
      });
    ' "$PAPERCUSP_WINDOWS_BUILD_LEASE_OWNER" 2>/dev/null || true)"
    if [[ "$lingering" != "false" ]]; then
      echo "ERROR: Windows VM build lease cleanup verification found a lingering/unknown holder for owner=$PAPERCUSP_WINDOWS_BUILD_LEASE_OWNER: $list_out" >&2
      rc=1
    fi
  fi

  if [[ "$rc" == "0" ]]; then
    emit_args="$(node -e '
      process.stdout.write(JSON.stringify({event:process.argv[1],
        summary:`Windows VM build lease released: resource=${process.argv[2]} owner=${process.argv[3]}`,
        payload:{resource:process.argv[2],owner:process.argv[3],lock_id:process.argv[4]}}));
    ' "$PAPERCUSP_WINDOWS_BUILD_LEASE_EVENT" "$PAPERCUSP_WINDOWS_BUILD_LEASE_RESOURCE" "$PAPERCUSP_WINDOWS_BUILD_LEASE_OWNER" "$PAPERCUSP_WINDOWS_BUILD_LEASE_LOCK_ID")"
    if ! emit_out="$(_windows_build_lease_mcp events:emit "$emit_args" 2>&1)"; then
      echo "ERROR: resource was released but its latched release event failed to fire: $emit_out" >&2
      rc=1
    fi
  fi

  if [[ "$rc" == "0" ]]; then
    echo "==> Windows VM build lease RELEASED + verified: resource=$PAPERCUSP_WINDOWS_BUILD_LEASE_RESOURCE event=$PAPERCUSP_WINDOWS_BUILD_LEASE_EVENT"
  fi
  PAPERCUSP_WINDOWS_BUILD_LEASE_HELD=0
  return "$rc"
}
