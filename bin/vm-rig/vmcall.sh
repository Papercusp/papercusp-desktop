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
# Env:
#   PCUSP_VM_NODE      node binary (default: auto-detect the packaged sidecar's)
#   PCUSP_MCP_CALL     mcp-call.mjs path (default /tmp/mcp-call.mjs)
#   PAPERCUSP_HONO_PORT  skip discovery, use this port

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

# port: explicit env wins; else probe every local listener for /api/health
PORT="${PAPERCUSP_HONO_PORT:-}"
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
echo "[vmcall port=$PORT]" >&2

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

PAPERCUSP_HONO_PORT="$PORT" "$NODE" "$MCP" "$@" >"$OUT"
rc=$?

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
