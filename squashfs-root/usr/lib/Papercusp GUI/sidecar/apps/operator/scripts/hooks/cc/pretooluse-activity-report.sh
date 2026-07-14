#!/usr/bin/env bash
# PreToolUse hook — report a psu worker's native tool call to the cross-CLI
# ACTIVITY BRIDGE (papercusp-worker-integration-2026-06-04, D-003) at the
# START of the call, mirroring posttooluse-activity-report.sh (which reports
# at the END). Fires after EVERY tool call is DISPATCHED (matcher "*"), before
# it runs.
#
# WHY THIS EXISTS (EI-8997): the D-003 activity-driven plan-item claim
# renewal (plan-items/activity-claim-renewal.ts) rides the SAME bus this
# reports to. Before this hook, the bus only fired on tool COMPLETION
# (PostToolUse) — so a single long-running tool call (a slow Bash
# build/test/diagnostic command) produced ZERO renewal signal for its entire
# duration, and a claim could lapse while its holder was demonstrably mid-
# call on that exact item. Reporting at DISPATCH time too means a renewal
# fires at both ends of a long call, not just the trailing one — halving the
# worst-case gap for a sequence of calls and giving one extra renewal right
# as a long call begins. (It does not fully cover a SINGLE call that outlives
# a whole TTL window on its own — plan_items:heartbeat {kind:'extend'} remains
# the manual backstop for a known-long single op.)
#
# SHARED shape with posttooluse-activity-report.sh (D-002): same JSON-on-
# stdin contract, same scope guard, same fire-and-forget contract. Kept as a
# near-duplicate (not a sourced common lib) so each hook stays a single,
# independently-reviewable file matching the CC hook install pattern — see
# posttooluse-activity-report.sh's own header for the shared-shape rationale.
#
# Precedent: OMP's in-process coord-hook.ts already reports phase:'pre' at its
# tool_call event (D-003) — this brings the Claude/Codex shell-hook chain to
# parity with what OMP has done all along, rather than inventing a new shape.
# Codex-specific caveat (D-006, same as the post-hook's own note): Codex's
# PreToolUse doesn't reliably fire on EDITS, so this degrades to a no-op for
# that subset there; Codex PostToolUse (already wired) still covers it.

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
    'phase': 'pre',
    'tool_name': tool_name,
    'tool_use_id': tool_use_id,
    'session_id': session_id,
    'cwd': cwd,
    # No status / todos / tool_response on a pre-report — the call hasn't run yet.
    'tool_input': {k: cap(v) for k, v in tool_input.items()},
}
if agent:
    args['agent'] = agent

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
