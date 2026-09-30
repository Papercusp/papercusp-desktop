# shellcheck shell=bash
# bg-host-fence.sh — hold a SHARED lease on the tower's `bg-host` named resource
# for the lifetime of a physical hive-git drill (WI-10004352).
#
# P-521 0.0.26 drill run 2 (20260930T181202Z-2639644) died in phase B when a
# peer's dev:restart { target:'bg-host' } restarted papercusp-bg-host.service
# mid-run: the git-sync re-fire on :3271 got ECONNREFUSED and set -e aborted the
# phase. dev:restart drains bg-host through an EXCLUSIVE acquire of this
# resource and refuses with resource_drain_timeout while a live SHARED holder
# remains (dead-holder reclaim applies only to exclusive holders), so a
# heartbeated shared lease is a real fence. `bg-host` is a host-global resource
# (HOST_GLOBAL_RESOURCES in packages/operator-core/lib/agent-tools/locks/
# coordination-domain.ts), so a lease taken through either operator fences a
# restart served by the other.
#
# Lifetime: the caller releases in its EXIT handler (bg_host_fence_release). A
# watcher subshell heartbeats the lease and releases it itself once the
# caller's PID is gone, so a SIGKILLed drill does not pin bg-host until the TTL
# expires. The TTL is the last backstop.
#
# The caller sets BG_HOST_FENCE_CALL to a ptool-compatible CLI (`<verb> --json -`
# reading args on stdin). Nothing is printed on stdout; progress goes to stderr
# as BG_HOST_FENCE_* marker lines so the drill's stderr log records the lease.

BG_HOST_FENCE_LOCK_ID=""
BG_HOST_FENCE_WATCHER_PID=""

# One tower call: $1 = verb, stdin = JSON args. Prints the answer on stdout.
bg_host_fence_call() {
  "$BG_HOST_FENCE_CALL" "$1" --json - --workspace="${BG_HOST_FENCE_WORKSPACE:-papercusp-workspace}"
}

# Prints the lock_id of a granted locks:acquire_resource answer read from stdin,
# or nothing (a refusal, a queue position, or unparseable output). ptool
# pretty-prints its JSON, so this parses rather than greps.
bg_host_fence_lock_id() {
  node -e '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let value = null;
      try { value = JSON.parse(raw); } catch {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start >= 0 && end > start) { try { value = JSON.parse(raw.slice(start, end + 1)); } catch {} }
      }
      const id = value && value.ok !== false && typeof value.lock_id === "string" ? value.lock_id : "";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) process.stdout.write(id);
    });
  '
}

# Releases one lease; $2 names who released it (caller | watcher).
bg_host_fence_release_id() {
  local id="$1" who="$2" out rc=0
  out="$(printf '{"lock_id":"%s"}\n' "$id" | bg_host_fence_call locks:release_resource 2>&1)" || rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "bg-host-fence: BG_HOST_FENCE_RELEASED lock_id=$id by=$who $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
  else
    echo "bg-host-fence: release of $id by $who failed (rc=$rc; the lease still expires at its TTL): $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)" >&2
  fi
}

# $1 = the PID whose exit ends the lease, $2 = the TTL each heartbeat renews.
bg_host_fence_start_watcher() {
  local parent="$1" ttl="$2" id="$BG_HOST_FENCE_LOCK_ID"
  local heartbeat_sec="${BG_HOST_FENCE_HEARTBEAT_SEC:-120}" tick_sec="${BG_HOST_FENCE_TICK_SEC:-5}"
  (
    # The caller stands the watcher down with TERM after releasing the lease
    # itself, so TERM exits WITHOUT a second release. HUP/INT belong to the
    # caller, whose own handler releases.
    trap 'exit 0' TERM
    trap '' HUP INT
    last=$SECONDS
    while kill -0 "$parent" 2>/dev/null; do
      sleep "$tick_sec"
      if [ $((SECONDS - last)) -ge "$heartbeat_sec" ]; then
        last=$SECONDS
        if printf '{"lock_id":"%s","ttl_sec":%s}\n' "$id" "$ttl" \
          | bg_host_fence_call locks:heartbeat_resource >/dev/null 2>&1; then
          echo "bg-host-fence: BG_HOST_FENCE_HEARTBEAT lock_id=$id $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
        else
          echo "bg-host-fence: heartbeat for $id failed (the lease still expires at its TTL)" >&2
        fi
      fi
    done
    bg_host_fence_release_id "$id" watcher
  ) </dev/null >/dev/null &
  BG_HOST_FENCE_WATCHER_PID=$!
}

# Takes the shared lease; $1 = the reason recorded on it. Retries while it is
# not granted (an exclusive restart drain may be in progress) for up to
# BG_HOST_FENCE_WAIT_SEC, then returns 1: starting a drill while a restart is
# draining bg-host is exactly the collision this fence exists to prevent.
bg_host_fence_acquire() {
  local reason="$1"
  local ttl="${BG_HOST_FENCE_TTL_SEC:-900}" wait_sec="${BG_HOST_FENCE_WAIT_SEC:-300}" poll_sec="${BG_HOST_FENCE_POLL_SEC:-15}"
  local deadline=$((SECONDS + wait_sec)) args out id="" attempt=0
  if [ -z "${BG_HOST_FENCE_CALL:-}" ]; then
    echo "bg-host-fence: BG_HOST_FENCE_CALL is not set" >&2
    return 2
  fi
  args="$(node -e 'process.stdout.write(JSON.stringify({ resource: "bg-host", mode: "shared", ttl_sec: Number(process.argv[1]), reason: process.argv[2] }))' "$ttl" "$reason")"
  while :; do
    attempt=$((attempt + 1))
    out="$(printf '%s\n' "$args" | bg_host_fence_call locks:acquire_resource)" || true
    id="$(printf '%s' "$out" | bg_host_fence_lock_id)"
    [ -z "$id" ] || break
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "bg-host-fence: could not take a shared bg-host lease after $attempt attempt(s) in ${wait_sec}s; last answer: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-400)" >&2
      return 1
    fi
    echo "bg-host-fence: bg-host lease not granted (attempt $attempt; a restart may be draining it); retrying in ${poll_sec}s" >&2
    sleep "$poll_sec"
  done
  BG_HOST_FENCE_LOCK_ID="$id"
  echo "bg-host-fence: BG_HOST_FENCE_ACQUIRED lock_id=$id ttl=${ttl}s attempts=$attempt $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
  bg_host_fence_start_watcher "$$" "$ttl"
}

# Stands the watcher down and releases the lease. Safe to call more than once
# and when nothing was acquired, so it belongs in an EXIT handler.
bg_host_fence_release() {
  [ -n "$BG_HOST_FENCE_LOCK_ID" ] || return 0
  local id="$BG_HOST_FENCE_LOCK_ID"
  BG_HOST_FENCE_LOCK_ID=""
  if [ -n "$BG_HOST_FENCE_WATCHER_PID" ]; then
    kill "$BG_HOST_FENCE_WATCHER_PID" 2>/dev/null || true
    BG_HOST_FENCE_WATCHER_PID=""
  fi
  bg_host_fence_release_id "$id" caller
}
