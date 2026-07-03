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
ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$VM" 'chmod +x /tmp/vmcall.sh && /tmp/vmcall.sh coord:presence "{}" --client vm-rig-deploy-probe --workspace papercusp-workspace --harness papercusp >/dev/null 2>&1; rc=$?; echo "deployed; driver self-test rc=$rc (0=operator reachable; 3=NO_OPERATOR_PORT — is the VM app running?)"'
