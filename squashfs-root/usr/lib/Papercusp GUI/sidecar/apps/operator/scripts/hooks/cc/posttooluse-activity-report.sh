#!/usr/bin/env bash
# PostToolUse hook — report a psu worker's native tool call to the cross-CLI
# ACTIVITY BRIDGE (papercusp-worker-integration-2026-06-04, D-003). Fires after
# EVERY tool call (matcher "*"), so each worker's native tool stream (Edit / Write
# / Bash / Read / apply_patch / Task-todos) is mirrored into harness_shared.
# agent_activity → the pui fleet-status view + the curator.
#
# SHARED by Claude AND Codex (D-002): the same `cc/` shell contract. Claude
# PostToolUse and Codex PostToolUse both deliver JSON on stdin with `tool_name` /
# `tool_input` / `tool_use_id` (or `tool_call_id`) / `session_id` / `cwd`; we read
# whichever shape is present. (Codex PreToolUse doesn't fire on edits — D-006 — but
# PostToolUse DOES, so the activity push works on both.)
#
# FIRE-AND-FORGET (the Risk note: "keep it cheap, non-blocking, payload-capped"):
# unlike the coord-inbox hook this NEVER injects context and NEVER needs a response,
# so by default it POSTs in a DETACHED background process and returns immediately —
# zero added latency on the agent's tool stream. Set PAPERCUSP_ACTIVITY_SYNC=1 to
# POST synchronously (tests). Output is ALWAYS empty (exit 0, no stdout) so the tool
# result stands untouched.
#
# Scope guard: runs ONLY in a psu session (PAPERCUSP_SID set + su-token present),
# exactly like the coord-inbox hook. A plain `claude`/`codex` elsewhere has no
# PAPERCUSP_SID and bails instantly. owner == PAPERCUSP_SID (the same id baked into
# the agent's MCP `?client=`), so activity is grouped by the worker's coord identity.

set -euo pipefail

OPERATOR_URL="${PAPERCUSP_OPERATOR_URL:-http://localhost:3070}"
TOKEN_PATH="${HOME}/.papercusp/superuser-token"

# psu-session gate + install gate (mirror posttooluse-coord-inbox.sh).
if [ -z "${PAPERCUSP_SID:-}" ] || [ ! -s "$TOKEN_PATH" ]; then
  exit 0
fi

TOKEN=$(cat "$TOKEN_PATH")
INPUT=$(cat)
AGENT="${PAPERCUSP_AGENT:-}"

# The reporter: build the activity:report args from the hook stdin and POST. Kept in
# a function so the SYNC and DETACHED paths share one body. Any crash inside fails
# open (the `|| true` at the call sites) — a reporting blip must never affect a tool.
report() {
  python3 - "$INPUT" "$OPERATOR_URL" "$TOKEN" "$PAPERCUSP_SID" "$AGENT" <<'PYEOF'
import json, sys, urllib.request, urllib.parse
urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))  # localhost operator: never via egress http(s)_proxy (502s the local call -> false fail-open)

raw, operator_url, token, owner, agent = sys.argv[1:6]
HTTP_TIMEOUT = 3
STR_CAP = 500

try:
    ev = json.loads(raw)
except Exception:
    sys.exit(0)
if not isinstance(ev, dict):
    sys.exit(0)


def first(*keys):
    for k in keys:
        v = ev.get(k)
        if v not in (None, ''):
            return v
    return None


tool_name = first('tool_name', 'toolName') or ''
tool_input = first('tool_input', 'toolInput')
if not isinstance(tool_input, dict):
    tool_input = {}
tool_use_id = first('tool_use_id', 'toolCallId', 'tool_call_id') or ''
session_id = first('session_id', 'sessionId') or ''
cwd = first('cwd') or ''
tool_response = first('tool_response', 'toolResponse')

# Best-effort status from the tool response (shape is tool-specific; only set when
# clearly determinable so we never mislabel).
status = None
if isinstance(tool_response, dict):
    if tool_response.get('is_error') is True or tool_response.get('error'):
        status = 'error'
    else:
        status = 'ok'

# A todo snapshot (Claude TodoWrite / TaskCreate-TaskUpdate, OMP todo_write) rides in
# tool_input.todos — forward it as `todos` so the server summarises it as kind=todos.
todos = tool_input.get('todos') if isinstance(tool_input.get('todos'), list) else None


def cap(v):
    if isinstance(v, str):
        return v if len(v) <= STR_CAP else v[:STR_CAP] + '…'
    if isinstance(v, list):
        return '[%d items]' % len(v)
    if isinstance(v, dict):
        return '[object]'
    return v


args = {
    'owner': owner,
    'phase': 'post',
    'tool_name': tool_name,
    'tool_use_id': tool_use_id,
    'session_id': session_id,
    'cwd': cwd,
}
if agent:
    args['agent'] = agent
if status:
    args['status'] = status
if todos is not None:
    args['todos'] = todos[:100]
else:
    # Cap string fields so a full Write `content` / patch body never bloats the POST.
    args['tool_input'] = {k: cap(v) for k, v in tool_input.items()}

body = json.dumps({
    'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
    'params': {'name': 'activity:report', 'arguments': args},
}).encode()
req = urllib.request.Request(
    operator_url.rstrip('/') + '/api/mcp?superuser=1&client='
    + urllib.parse.quote(owner, safe=''),
    data=body,
    headers={
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
    },
    method='POST',
)
try:
    urllib.request.urlopen(req, timeout=HTTP_TIMEOUT).read()
except Exception:
    sys.exit(0)  # operator unreachable / slow → fail open; a missed report is harmless.
PYEOF
}

if [ -n "${PAPERCUSP_ACTIVITY_SYNC:-}" ]; then
  report >/dev/null 2>&1 || true
else
  # Detached fire-and-forget: ( cmd & ) reparents the POST to init and returns now,
  # and the >/dev/null on the subshell releases the hook's stdout pipe immediately.
  ( report >/dev/null 2>&1 & ) >/dev/null 2>&1 || true
fi
exit 0
