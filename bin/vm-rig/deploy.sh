#!/usr/bin/env bash
# deploy.sh — push the VM-side driver (vmcall.sh + mcp-call.mjs) onto the rig VM.
#
# The VM's /tmp is wiped on reboot, so RE-RUN THIS AFTER EVERY VM REBOOT before
# using the probes. Idempotent.
#
# Usage:  bin/vm-rig/deploy.sh [user@vm-ip]
# Env:    PCUSP_VM_SSH  default ssh target (default aviweiss@172.31.44.2 — the
#         tower↔VM rig over the macbr0 bridge; see bin/vm-rig/README.md)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
VM="${1:-${PCUSP_VM_SSH:-aviweiss@172.31.44.2}}"

MCP_CALL="$ROOT/scripts/mcp-call.mjs"
[ -f "$MCP_CALL" ] || { echo "FATAL: $MCP_CALL not found" >&2; exit 1; }

echo "deploy → $VM:/tmp/{vmcall.sh,mcp-call.mjs}"
scp -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$HERE/vmcall.sh" "$VM:/tmp/vmcall.sh"
scp -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$MCP_CALL" "$VM:/tmp/mcp-call.mjs"
selftest="$(ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$VM" 'chmod +x /tmp/vmcall.sh && /tmp/vmcall.sh coord:presence "{}" --client vm-rig-deploy-probe --workspace papercusp-workspace --harness papercusp >/dev/null 2>&1; echo rc=$?')"
rc="${selftest##*rc=}"
echo "deployed; driver self-test rc=${rc} (0=operator reachable; 3=NO_OPERATOR_PORT — VM app not running)"

# If the operator is unreachable, the #1 silent cause is the rig VM sitting at
# the loginwindow because macOS auto-login broke (kcpassword drifted). Auto-run
# the login preflight so a dark rig fails LOUD with the real diagnosis instead
# of masquerading as a swarm/DHT wedge (WI-4070 / EI-13010). Non-fatal.
if [ "${rc:-0}" != "0" ]; then
  echo ""
  echo "⚠ VM operator not reachable — running login preflight to diagnose the cause…"
  "$HERE/preflight-login.sh" "$VM" || true
fi
