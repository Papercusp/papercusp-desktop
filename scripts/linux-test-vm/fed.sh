#!/usr/bin/env bash
# fed.sh — drive the 2-machine federation VMs (fed-a / fed-b) with PORT
# SELF-DISCOVERY (WI-754). The versioned, reliable replacement for the ad-hoc
# /tmp/fed.sh that hardcoded the VMs' DYNAMIC operator/PG ports — those go STALE on
# every operator restart (the packaged app picks a fresh dynamic port each boot;
# old listeners linger, so even "grep the latest [serve] line" is unreliable —
# EI-3409 / WI-559 burned time on exactly this). This script DISCOVERS the LIVE
# operator + PG port on each call by probing the VM, so it survives app/VM
# restarts with no edits.
#
# Usage:
#   fed.sh <a|b> ports                      # show the discovered operator/PG ports
#   fed.sh <a|b> sql  "<SQL>"               # psql against the VM's embedded PG
#        ⚠ HUMAN-FORMATTED output: aligned, with a COLUMN HEADER and a "(N rows)"
#        footer. NEVER BRANCH ON THIS. A MISS still emits a non-empty first line
#        (the header), so the natural assertion
#            row=$(fed.sh b sql "SELECT harness_slug ..." | grep -v '^$' \
#                  | grep -v 'row)' | head -1); [ -n "$row" ] && echo FEDERATED
#        prints the literal string `harness_slug` on a miss and reports success
#        UNCONDITIONALLY. The failure mode is a GREEN result, not an error — a
#        federation proof written this way passes with the link severed.
#        Demonstrate it:
#            printf ' harness_slug \n------\n(0 rows)\n' | grep -v '^$' \
#              | grep -v 'row)' | head -1        # → harness_slug  (non-empty!)
#        Use `sql` for eyeballing only; use `sqlt` for anything you test.
#   fed.sh <a|b> sqlt "<SQL>"               # tuples-only, unaligned (-tA) — USE
#        THIS FOR EVERY ASSERTION. A miss emits NOTHING, so empty is a true
#        negative and `[ -n "$out" ]` means what it says. (Belt-and-braces even
#        here: self-tag the value in the SQL and grep the tag rather than parsing
#        by line position — SELECT 'FOUND:'||harness_slug ... → grep -o 'FOUND:[^ ]*'
#        — which stays correct under either output mode.)
#        (uses the guest's psql if on PATH, else the app's bundled
#        sidecar/bin/psql — real client binaries ship with the app since
#        2026-07-07; installs built before that shipped a broken pg_wrapper
#        shim, so on those run a fresh `vmctl install`)
#   fed.sh <a|b> api  <METHOD> <path> [json-body]   # superuser HTTP route
#   fed.sh <a|b> mcp  <tool> [json-args]    # superuser MCP tool call
#   fed.sh <a|b> ssh  <cmd...>              # raw ssh into the VM
#   fed.sh <a|b> rediscover                 # force a fresh port probe (clear cache)
#   fed.sh <a|b> health                     # ssh + operator + PG precondition check
#                                           # (prints per-check lines; exit 0 healthy / 1 not)
#
# NO `restart` SUBCOMMAND — deliberately. Restarting a VM's app goes through
# `vmctl` (`vmctl status|verify|reset|down|up fed-<a|b>`), which auto-reaps the
# orphaned sidecar/operator that a naive relaunch would stack on top of (a
# documented mis-diagnosis source), and an operator restart DROPS that peer's gh
# auth (WI-757) leaving it silently local-only — so it must be coordinated with
# whoever owns the live federation work, not fired from a driver one-liner.
# Recovery procedures: /internal/docs/agent-insights/federation-rig-restart-runbook
#
# DISCOVERY: SSH in (stable host-forward port), gather candidate loopback ports
# (the app log's listening lines ∪ every LISTENing 127.0.0.1 port), and pick the
# operator = the one answering the sidecar-only GET /api/desktop/preflight with
# 2xx (the packaged app runs OTHER http listeners — code-server etc. — that 404
# it; and dead leftover listeners refuse), and PG = the listening port that
# accepts a harness_admin psql to `papercusp`. Cached per-VM for $FED_PORT_TTL
# seconds (default 600) under ~/.papercusp/fed-rig-ports.<vm>; auto-rediscovers
# when a call's target port stops answering.
#
# EI-3409: superuser MCP resolves ctx.workspaceId='*' while the HTTP routes/queue
# use 'default' → a hive created via `mcp` lands in the wrong workspace and the
# routes then return not_owner_swarm. The fix for a WORKSPACE-SCOPED WRITE tool
# (hive:create / hive:takedown / hive:report / hive:moderation_*) is to pass
# workspace:"default" in its args so create+route+queue agree. Set FED_MCP_WS to
# have fed.sh inject it for you:  FED_MCP_WS=default fed.sh a mcp hive:create '{…}'
# (OPT-IN, off by default — blanket injection breaks READ tools whose schema
# rejects an unknown "workspace" key, e.g. papercusp:list_workspaces). The DURABLE
# fix — superuser ctx resolving the concrete workspace — is tracked on EI-3409.
set -uo pipefail

K="${FED_SSH_KEY:-$HOME/.ssh/papercup-vm-linux}"
SSHOPT=(-i "$K" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes)
SSH_USER="${FED_SSH_USER:-tester}"
SSH_HOST="${FED_SSH_HOST:-127.0.0.1}"
FED_PORT_TTL="${FED_PORT_TTL:-600}"
CACHE_DIR="$HOME/.papercusp"

vm="${1:-}"; cmd="${2:-}"; shift 2 2>/dev/null || true
case "$vm" in
  a) sshp="${FED_SSH_A:-2225}" ;;
  b) sshp="${FED_SSH_B:-2226}" ;;
  *) echo "usage: fed.sh <a|b> <ports|sql|sqlt|api|mcp|ssh|rediscover|health> ..." >&2; exit 2 ;;
esac

_ssh() { ssh "${SSHOPT[@]}" -p "$sshp" "$SSH_USER@$SSH_HOST" "$@"; }

# _discover — echo "OP PG" (the live operator + PG ports) by probing the VM.
# Runs entirely inside the VM in one round-trip.
_discover() {
  _ssh 'bash -s' <<'REMOTE'
set -uo pipefail
# psql: guest PATH first, else the app's bundled client (ships since 2026-07-07)
PSQL="$(command -v psql || echo '/usr/lib/Papercusp GUI/sidecar/bin/psql')"
# candidate operator ports: the app log's listening lines, then every LISTENing
# loopback port (catch a port the log missed / a stale log).
cands="$(
  { grep -oE '(\[serve\]|hono-host\]) listening on http://127\.0\.0\.1:[0-9]+' papercusp-app.log 2>/dev/null | grep -oE '[0-9]+$'
    ss -tlnH 2>/dev/null | awk '{print $4}' | grep -oE '[0-9]+$'
  } | awk 'NF' | awk '!s[$0]++'
)"
op=""
for p in $cands; do
  code=$(curl -s -o /dev/null -m 4 -w '%{http_code}' "http://127.0.0.1:$p/api/desktop/preflight" 2>/dev/null || echo 000)
  case "$code" in 2??) op="$p"; break ;; esac
done
pg=""
for p in $(ss -tlnH 2>/dev/null | awk '{print $4}' | grep -oE '[0-9]+$' | sort -u); do
  [ "$p" = "$op" ] && continue
  if "$PSQL" "postgresql://harness_admin:harness_admin_pwd@127.0.0.1:$p/papercusp?connect_timeout=3" -tAc 'select 1' >/dev/null 2>&1; then
    pg="$p"; break
  fi
done
echo "$op $pg"
REMOTE
}

# _resolve — populate $op/$pg from cache or a fresh discovery. $1=force(1).
op=""; pg=""
_resolve() {
  local force="${1:-0}" cache="$CACHE_DIR/fed-rig-ports.$vm" now age line
  mkdir -p "$CACHE_DIR" 2>/dev/null || true
  if [ "$force" != 1 ] && [ -f "$cache" ]; then
    now=$(date +%s 2>/dev/null || echo 0)
    age=$(( now - $(stat -c %Y "$cache" 2>/dev/null || echo 0) ))
    if [ "$age" -ge 0 ] && [ "$age" -lt "$FED_PORT_TTL" ]; then
      read -r op pg < "$cache" 2>/dev/null || true
    fi
  fi
  if [ -z "$op" ] || [ -z "$pg" ]; then
    line="$(_discover)"; op="${line%% *}"; pg="${line##* }"
    [ -n "$op" ] && [ -n "$pg" ] && printf '%s %s\n' "$op" "$pg" > "$cache" 2>/dev/null || true
  fi
  [ -n "$op" ] && [ -n "$pg" ] || { echo "fed.sh: could not discover live operator/PG ports on VM $vm (is the app up? \`fed.sh $vm ssh 'tail papercusp-app.log'\`)" >&2; return 1; }
}

case "$cmd" in
  ports)
    _resolve "${1:-0}" || exit 1
    echo "vm=$vm ssh=$sshp operator=$op pg=$pg"
    ;;

  rediscover)
    rm -f "$CACHE_DIR/fed-rig-ports.$vm" 2>/dev/null || true
    _resolve 1 || exit 1
    echo "vm=$vm rediscovered: operator=$op pg=$pg"
    ;;

  sql|sqlt)
    _resolve || exit 1
    b64=$(printf '%s' "${1:-}" | base64 -w0)
    psql_output_args="-P pager=off"
    [ "$cmd" = sqlt ] && psql_output_args="-tA -P pager=off"
    _ssh "P=\$(command -v psql || echo '/usr/lib/Papercusp GUI/sidecar/bin/psql'); echo $b64 | base64 -d | \"\$P\" 'postgresql://harness_admin:harness_admin_pwd@127.0.0.1:$pg/papercusp' $psql_output_args 2>&1"
    ;;

  api)
    _resolve || exit 1
    method="${1:-GET}"; path="${2:-/}"; body="${3:-}"
    bb=$(printf '%s' "$body" | base64 -w0)
    _ssh "TOK=\$(cat ~/.papercusp/superuser-token); B=\$(echo $bb | base64 -d); curl -s --max-time 120 -X $method -H \"Authorization: Bearer \$TOK\" -H 'Content-Type: application/json' $([ -n "$body" ] && echo --data-binary @-) http://127.0.0.1:$op$path 2>/dev/null <<<\"\$B\""
    ;;

  mcp)
    _resolve || exit 1
    tool="${1:-}"; args="${2:-'{}'}"
    # EI-3409 mitigation, OPT-IN: only when FED_MCP_WS is set, inject it as the
    # workspace for a tool whose args lack one (jq merge; pass-through if jq absent
    # or args already name a workspace). Off by default so a READ tool that rejects
    # an unknown "workspace" key is never broken.
    if [ -n "${FED_MCP_WS:-}" ] && command -v jq >/dev/null 2>&1; then
      if ! printf '%s' "$args" | jq -e 'has("workspace")' >/dev/null 2>&1; then
        args="$(printf '%s' "$args" | jq -c --arg ws "$FED_MCP_WS" '. + {workspace:$ws}' 2>/dev/null || printf '%s' "$args")"
      fi
    fi
    payload=$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$tool" "$args")
    bb=$(printf '%s' "$payload" | base64 -w0)
    _ssh "TOK=\$(cat ~/.papercusp/superuser-token); echo $bb | base64 -d | curl -s --max-time 120 -X POST -H \"Authorization: Bearer \$TOK\" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' --data-binary @- 'http://127.0.0.1:$op/api/mcp?superuser=1' 2>/dev/null" | grep '^data:' | sed 's/^data: //'
    ;;

  ssh)
    _ssh "$@"
    ;;

  health)
    # Precondition check for fed.sh's OWN driver path — the three hops every
    # sql/api/mcp call depends on: ssh reachable → operator answering → PG
    # accepting. Exits 0/1 so a smoke can gate on it. This is NOT the
    # VM-lifecycle check: for "is the VM/app up, reset it, relaunch it" use
    # `vmctl status|verify fed-$vm` (see the header note on `restart`).
    rc=0
    if _ssh true >/dev/null 2>&1; then
      echo "ok   ssh       vm=$vm port=$sshp"
    else
      echo "FAIL ssh       vm=$vm port=$sshp — VM down or key rejected (\`vmctl status fed-$vm\`)"
      echo "vm=$vm UNHEALTHY (see /internal/docs/agent-insights/federation-rig-restart-runbook)"
      exit 1
    fi
    if _resolve; then
      # curl already emits 000 on refuse/timeout via -w; don't append a second one
      code=$(_ssh "curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:$op/api/desktop/preflight 2>/dev/null")
      [ -n "$code" ] || code=000
      case "$code" in
        2*) echo "ok   operator  port=$op (preflight $code)" ;;
        *)  echo "FAIL operator  port=$op (preflight $code) — try \`fed.sh $vm rediscover\`"; rc=1 ;;
      esac
      out=$(_ssh "P=\$(command -v psql || echo '/usr/lib/Papercusp GUI/sidecar/bin/psql'); \"\$P\" 'postgresql://harness_admin:harness_admin_pwd@127.0.0.1:$pg/papercusp' -tAc 'select 1' 2>&1")
      if [ "$(printf '%s' "$out" | tr -d '[:space:]')" = "1" ]; then
        echo "ok   postgres  port=$pg"
      else
        echo "FAIL postgres  port=$pg — $(printf '%s' "$out" | head -1)"; rc=1
      fi
    else
      rc=1   # _resolve already explained the failure on stderr
    fi
    if [ "$rc" = 0 ]; then
      echo "vm=$vm HEALTHY (operator=$op pg=$pg)"
    else
      echo "vm=$vm UNHEALTHY (see /internal/docs/agent-insights/federation-rig-restart-runbook)"
    fi
    exit "$rc"
    ;;

  *)
    echo "fed.sh: unknown cmd '$cmd' (ports|sql|sqlt|api|mcp|ssh|rediscover|health)" >&2; exit 2 ;;
esac
