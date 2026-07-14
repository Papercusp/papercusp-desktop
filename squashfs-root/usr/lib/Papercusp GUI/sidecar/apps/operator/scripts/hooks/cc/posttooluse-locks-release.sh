#!/usr/bin/env bash
# PostToolUse hook — release the lock the matching PreToolUse hook
# acquired. SHARED by Claude Code and Codex (same hook wire format).
#
# Reads the cached lock_id from
#   $PAPERCUSP_LOCKS_CACHE_DIR/<tool_use_id>.lock
# and calls locks:release. If the cache is missing (Pre didn't run, or
# already released) we no-op. Always exit 0 — surfacing release noise to
# the agent changes nothing, and the lock's TTL covers any missed
# release anyway.

set -euo pipefail

OPERATOR_URL="${PAPERCUSP_OPERATOR_URL:-http://localhost:3070}"
# Managed sessions may receive either the operator origin or its full MCP
# endpoint. Normalize to the origin because the hook appends /api/mcp below.
OPERATOR_URL="${OPERATOR_URL%%/api/mcp*}"
TOKEN_PATH="${HOME}/.papercusp/superuser-token"
AGENT_ID_PATH="${HOME}/.papercusp/su-agent-id"
CACHE_DIR="${PAPERCUSP_LOCKS_CACHE_DIR:-${HOME}/.papercusp/locks-cache}"

if [ ! -s "$TOKEN_PATH" ] || [ ! -s "$AGENT_ID_PATH" ]; then
  exit 0
fi

TOKEN=$(cat "$TOKEN_PATH")
AGENT_ID=$(cat "$AGENT_ID_PATH")
INPUT=$(cat)

# Fail-open backstop: release is best-effort (TTL covers a missed one), so
# never let a Python error exit non-zero from this hook.
python3 - "$INPUT" "$OPERATOR_URL" "$TOKEN" "$AGENT_ID" "$CACHE_DIR" <<'PYEOF' || exit 0
import json, os, re, sys, time, urllib.request, urllib.parse
urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))  # localhost operator: never via egress http(s)_proxy (502s the local call -> false fail-open)

raw, operator_url, token, agent_id, cache_dir = sys.argv[1:6]


def write_marker(name, value):
    try:
        path = os.path.join(cache_dir, name)
        tmp = path + '.tmp-' + str(os.getpid())
        with open(tmp, 'w') as f:
            f.write(json.dumps(value))
        os.replace(tmp, path)
    except Exception:
        pass


def now_iso():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


try:
    payload = json.loads(raw)
except Exception:
    sys.exit(0)

tool_use_id = payload.get('tool_use_id', '')
if not isinstance(tool_use_id, str) or not tool_use_id:
    sys.exit(0)

# Identity MUST match the acquirer (the release owner-check requires
# owner == acquirer). PreToolUse resolves PAPERCUSP_SID → session_id →
# agent_id, in that order; mirror it exactly so release matches acquire.
env_sid = os.environ.get('PAPERCUSP_SID')
lock_sid = os.environ.get('PAPERCUSP_LOCK_SID')
session_id = payload.get('session_id')


def diagnostic_lock_sid():
    try:
        codex_home = os.environ.get('CODEX_HOME')
        if not codex_home:
            return None
        with open(os.path.join(codex_home, 'papercusp-diagnostics.json')) as f:
            value = json.load(f).get('lockOwnerSid')
        return value if isinstance(value, str) and value else None
    except Exception:
        return None


owner = (
    lock_sid if isinstance(lock_sid, str) and lock_sid
    else diagnostic_lock_sid() or (
    env_sid if isinstance(env_sid, str) and env_sid
    else session_id if isinstance(session_id, str) and session_id
    else agent_id)
)


def owner_marker_name(kind):
    safe = re.sub(r'[^A-Za-z0-9._-]', '_', owner)[:160] or 'unknown'
    return 'owner-' + safe + '-last-' + kind + '.json'

cache_path = os.path.join(cache_dir, tool_use_id + '.lock')
if not os.path.exists(cache_path):
    sys.exit(0)

try:
    with open(cache_path) as f:
        lock_id = f.read().strip()
except Exception:
    sys.exit(0)

if not lock_id:
    try:
        os.remove(cache_path)
    except Exception:
        pass
    sys.exit(0)

body = json.dumps({
    'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
    'params': {'name': 'locks:release', 'arguments': {'lock_id': lock_id}},
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
    urllib.request.urlopen(req, timeout=10).read()
    value = {'ts': now_iso(), 'owner': owner}
    write_marker('last-success.json', value)
    write_marker(owner_marker_name('success'), value)
except Exception as e:
    # Best-effort; TTL covers a missed release. Record for /coord health.
    value = {
        'ts': now_iso(), 'handler': 'posttooluse', 'phase': 'connect',
        'detail': str(e)[:200], 'operator_url': operator_url,
        'owner': owner,
    }
    write_marker('last-error.json', value)
    write_marker(owner_marker_name('error'), value)

try:
    os.remove(cache_path)
except Exception:
    pass

sys.exit(0)
PYEOF
