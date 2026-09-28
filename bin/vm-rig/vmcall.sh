#!/bin/bash
# vmcall.sh — VM-SIDE driver: discover the VM operator's Hono port (randomized
# per boot) then run an MCP verb against it via mcp-call.mjs.
#
# Deployed to the VM's /tmp by bin/vm-rig/deploy.sh (alongside /tmp/mcp-call.mjs).
# Rescued from the P-059 drill's hand-rolled /tmp/vmcall.sh (2026-07-03, P-002 of
# shared-hive-p2p-release-readiness-2026-07-03) — /tmp is wiped on reboot, which
# is exactly how the original got lost.
#
# Usage (ON the VM, usually via ssh):
#   /tmp/vmcall.sh <ns:verb> '<jsonArgs>' [--client X --workspace Y --harness Z]
#
# QUOTING-SAFE JSON — prefer these over the positional form for any payload
# carrying apostrophes or other shell-hostile text. An ssh-driven call puts the
# payload through TWO shells, and a quote lost between them does not fail loudly:
# it reaches mcp-call as a truncated fragment (`fleetSlug:p...`) and surfaces as a
# JSON parse error about a payload you believe you quoted correctly
# (EI-20320664768533929). Neither form needs a remote `jq` to assemble:
#   /tmp/vmcall.sh <ns:verb> --json-file /tmp/args.json [--client X ...]
#   printf '%s' "$payload" | /tmp/vmcall.sh <ns:verb> --json - [--client X ...]
# Every argument is forwarded to mcp-call.mjs verbatim — nothing here parses the
# payload — so these are exactly the flags mcp-call.mjs itself documents.
# Env:
#   PCUSP_VM_NODE      node binary (default: auto-detect the packaged sidecar's)
#   PCUSP_MCP_CALL     mcp-call.mjs path (default /tmp/mcp-call.mjs)
#   PAPERCUSP_HONO_PORT  skip discovery, use this port
#   PCUSP_OPERATOR_JSON  current-operator record (default ~/.papercusp/operator.json)

MCP="${PCUSP_MCP_CALL:-/tmp/mcp-call.mjs}"

# node: packaged sidecar first (mac app bundle, then linux .deb), else PATH
NODE="${PCUSP_VM_NODE:-}"
if [ -z "$NODE" ]; then
  # EI-7067: the deb install root's product-name segment has varied across builds
  # ('Papercusp' vs 'Papercusp GUI', per a tauri productName edit) — glob rather
  # than hardcode one shape so this resolves regardless of which build is installed.
  for cand in \
    '/Applications/Papercusp Server.app/Contents/Resources/sidecar/bin/node' \
    '/Applications/Papercusp.app/Contents/Resources/sidecar/bin/node' \
    /usr/lib/Papercusp*/sidecar/bin/node; do
    [ -x "$cand" ] && NODE="$cand" && break
  done
  [ -n "$NODE" ] || NODE="$(command -v node)"
fi
[ -n "$NODE" ] || { echo "NO_NODE"; exit 4; }

# port, in precedence order:
#   1. explicit PAPERCUSP_HONO_PORT;
#   2. ~/.papercusp/operator.json — the canonical record of WHICH operator is
#      current — when it names a numeric port and a pid that is still alive;
#   3. only then, scan every local listener for a 200 /api/health.
# WI-10003588: the scan alone binds the FIRST healthy listener. A VM routinely
# carries two operators (the current rig runtime plus the installed app's older
# staging env-sidecar), so a current runtime that answers /api/health slowly was
# silently swapped for the stale one, and every rig call returned a well-formed
# WRONG answer (a false 'no live content peer'). When operator.json names a live
# operator we bind it even if it is slow: a wedged current operator must fail
# loudly through MCP_RESULT_TIMEOUT below, never be replaced by another one.
# Liveness uses `ps -p`, not `kill -0`, which reports EPERM (i.e. "dead") for a
# live operator owned by another user, such as a root LaunchDaemon.
PORT="${PAPERCUSP_HONO_PORT:-}"
PORT_SOURCE=env
if [ -z "$PORT" ]; then
  OPJSON="${PCUSP_OPERATOR_JSON:-$HOME/.papercusp/operator.json}"
  PORT_SOURCE="scan (no $OPJSON)"
  if [ -r "$OPJSON" ]; then
    op=$("$NODE" -e '
      try {
        const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        const port = Number(j.port), pid = Number(j.pid);
        if (Number.isInteger(port) && port > 0 && port < 65536 && Number.isInteger(pid) && pid > 0) {
          process.stdout.write(port + " " + pid);
        }
      } catch {}
    ' "$OPJSON" 2>/dev/null)
    op_port="${op% *}"; op_pid="${op#* }"
    if [ -z "$op" ]; then
      PORT_SOURCE="scan ($OPJSON unparsable or lacks port/pid)"
    elif ps -p "$op_pid" -o pid= >/dev/null 2>&1; then
      PORT="$op_port"; PORT_SOURCE="operator.json pid=$op_pid"
    else
      PORT_SOURCE="scan (operator.json pid=$op_pid is dead)"
    fi
  fi
fi
if [ -z "$PORT" ]; then
  if command -v lsof >/dev/null 2>&1; then
    cands=$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -oE '127.0.0.1:[0-9]+' | grep -oE '[0-9]+$' | sort -u)
  else
    cands=$(ss -tlnH 2>/dev/null | awk '{print $4}' | grep -oE '[0-9]+$' | sort -u)
  fi
  for p in $cands; do
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$p/api/health" 2>/dev/null)
    if [ "$c" = "200" ]; then PORT=$p; break; fi
  done
fi
if [ -z "$PORT" ]; then echo "NO_OPERATOR_PORT"; exit 3; fi
echo "[vmcall port=$PORT source=$PORT_SOURCE]" >&2

# A 200 /api/health response proves only that something is listening. Bound the
# actual MCP child as well, so a selected operator whose event loop is wedged
# fails closed instead of leaving read-only VM diagnostics running forever.
MCP_TIMEOUT_SEC="${PCUSP_VM_CALL_TIMEOUT_SEC:-30}"
case "$MCP_TIMEOUT_SEC" in
  ''|*[!0-9]*) echo "MCP_TIMEOUT_INVALID: PCUSP_VM_CALL_TIMEOUT_SEC must be a positive integer" >&2; exit 2 ;;
esac
[ "$MCP_TIMEOUT_SEC" -gt 0 ] || {
  echo "MCP_TIMEOUT_INVALID: PCUSP_VM_CALL_TIMEOUT_SEC must be a positive integer" >&2
  exit 2
}
MCP_TIMEOUT_SEC=$((10#$MCP_TIMEOUT_SEC))

# Keep the result visible to the caller, but do not trust the child's exit code
# alone.  The VM-rig deploy self-test historically saw rc=0 even when the
# operator returned no MCP result at all: a silent child stdout is not proof of
# reachability, and a non-JSON result is not proof that the call completed.
# Capture stdout so we can validate the actual result before returning success.
OUT="$(mktemp "${TMPDIR:-/tmp}/vmcall.XXXXXX")" || {
  echo "MCP_RESULT_CAPTURE_FAILED" >&2
  exit 5
}
cleanup() { rm -f "$OUT"; }
trap cleanup EXIT HUP INT TERM

# `--json -` tells mcp-call.mjs to read the payload from stdin (fd 0), but the MCP
# child below is BACKGROUNDED (`&`) so the deadline loop can bound it — and bash
# redirects a background command's stdin from /dev/null whenever job control is
# off, which is always the case in the non-interactive ssh invocation this script
# exists to serve. Left alone, the stdin form reads an EMPTY payload and fails as
# a confusing parse error rather than as "no input", i.e. it fails in the same
# silent direction as the lost-quoting bug the flag was reached for to avoid.
# Duplicate stdin onto fd 3 while it is still the caller's, and hand the child
# fd 3 explicitly. Harmless when there is no stdin: fd 3 is then the inherited
# empty/closed stdin and the child sees EOF instead of blocking.
exec 3<&0

run_mcp_with_timeout() {
  PAPERCUSP_HONO_PORT="$PORT" "$NODE" "$MCP" "$@" >"$OUT" <&3 &
  local child_pid=$!
  local deadline=$((SECONDS + MCP_TIMEOUT_SEC))

  while kill -0 "$child_pid" 2>/dev/null; do
    if (( SECONDS >= deadline )); then
      # Re-check after the deadline comparison to avoid turning a just-finished
      # child into a false timeout. SIGKILL is the backstop for a child that
      # ignores TERM; either way, wait reaps it before the temp file is removed.
      if kill -0 "$child_pid" 2>/dev/null; then
        echo "MCP_RESULT_TIMEOUT: MCP call did not complete within ${MCP_TIMEOUT_SEC}s; the selected operator listener may be alive but unresponsive" >&2
        kill -TERM "$child_pid" 2>/dev/null || true
        sleep 0.1
        kill -KILL "$child_pid" 2>/dev/null || true
        wait "$child_pid" 2>/dev/null || true
        return 124
      fi
      break
    fi
    sleep 0.1
  done
  wait "$child_pid"
}

run_mcp_with_timeout "$@"
rc=$?

if [ "$rc" -eq 124 ]; then
  cat "$OUT"
  exit "$rc"
fi

if [ "$rc" -ne 0 ]; then
  cat "$OUT"
  exit "$rc"
fi

# mcp-call.mjs unwraps the JSON-RPC response to the tool result before writing
# stdout.  Require that unwrapped result to be non-empty JSON; this catches both
# an empty body and a stale/incorrect driver that exits 0 without a result.
if ! "$NODE" -e '
  const fs = require("node:fs");
  const body = fs.readFileSync(process.argv[1], "utf8").trim();
  if (!body) process.exit(1);
  try { JSON.parse(body); } catch { process.exit(1); }
' "$OUT"; then
  cat "$OUT"
  echo "MCP_RESULT_INVALID: expected a non-empty JSON result" >&2
  exit 5
fi

cat "$OUT"
