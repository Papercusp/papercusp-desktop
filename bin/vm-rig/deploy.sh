#!/usr/bin/env bash
# deploy.sh — install the VM-side driver (vmcall.sh + mcp-call.mjs) on the rig VM.
#
# The exact checked-in helpers are hash-verified into ~/.papercusp/vm-rig, then
# copied into /tmp for legacy probe callers. The persistent copy survives VM
# reboot; probe-session.sh re-runs this installer when reboot clears /tmp.
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

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

vmcall_hash="$(hash_file "$HERE/vmcall.sh")"
mcp_hash="$(hash_file "$MCP_CALL")"
deploy_tag="$$"
remote_vmcall="/tmp/vmcall.sh.deploy-$deploy_tag"
remote_mcp="/tmp/mcp-call.mjs.deploy-$deploy_tag"

echo "deploy → $VM:~/.papercusp/vm-rig + /tmp compatibility copies"
scp -q -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$HERE/vmcall.sh" "$VM:$remote_vmcall"
scp -q -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$MCP_CALL" "$VM:$remote_mcp"

# Verify the bytes before either persistent or compatibility path is replaced.
# Hashes are lowercase hex, so interpolating them into the fixed grep patterns
# below cannot alter the remote command shape.
ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$VM" "
  set -e
  persistent=\"\$HOME/.papercusp/vm-rig\"
  mkdir -p \"\$persistent\"
  shasum -a 256 '$remote_vmcall' | grep -q '^$vmcall_hash '
  shasum -a 256 '$remote_mcp' | grep -q '^$mcp_hash '
  install -m 0755 '$remote_vmcall' \"\$persistent/vmcall.sh\"
  install -m 0644 '$remote_mcp' \"\$persistent/mcp-call.mjs\"
  install -m 0755 \"\$persistent/vmcall.sh\" /tmp/vmcall.sh
  install -m 0644 \"\$persistent/mcp-call.mjs\" /tmp/mcp-call.mjs
  rm -f '$remote_vmcall' '$remote_mcp'
  test \"\$(shasum -a 256 /tmp/vmcall.sh | awk '{print \$1}')\" = '$vmcall_hash'
  test \"\$(shasum -a 256 /tmp/mcp-call.mjs | awk '{print \$1}')\" = '$mcp_hash'
"

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
