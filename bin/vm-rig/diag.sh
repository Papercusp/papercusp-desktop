#!/bin/bash
# diag.sh — tower + VM substrate-status side-by-side (the P-059 diagnosis
# view: booted harnesses, per-row health verdict, workspace summary on BOTH
# ends). `hive:status` is dead (retired verb); this uses
# `dev:dogfood_substrate_status`, which wraps the in-process substrate read
# directly — same reason the probes need the bg-host SUBSTRATE PRIMARY port,
# not the request-only cluster tier (see PAPERCUSP_HONO_PORT below).
# Rescued/parameterized from /tmp/p059-diag.sh. Deploy the driver once (and
# again when the checked-in helpers change); its persistent copy survives VM
# reboots:
#   bin/vm-rig/deploy.sh
# Usage:  bin/vm-rig/diag.sh
# Env:    PCUSP_VM_SSH, PAPERCUSP_HONO_PORT (tower, default 3270 — the
#         bg-host substrate primary; :3070 is the request-only cluster tier
#         and won't reliably reflect true in-process substrate state)
VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TOWER_MCP="$ROOT/scripts/mcp-call.mjs"
TOWER_PORT="${PAPERCUSP_HONO_PORT:-3270}"
CLI_TW="--client vm-rig-tower-probe --workspace papercusp-workspace --harness papercusp"

VM_DIAG_OUT="$(mktemp "${TMPDIR:-/tmp}/vm-rig-diag.XXXXXX")" || {
  echo "vm-rig diag: could not create a temporary VM output file" >&2
  exit 1
}
cleanup() { rm -f "$VM_DIAG_OUT"; }
trap cleanup EXIT

echo "=== TOWER dev:dogfood_substrate_status ==="
PAPERCUSP_HONO_PORT=$TOWER_PORT node "$TOWER_MCP" dev:dogfood_substrate_status '{}' $CLI_TW 2>&1 | head -30

echo ""
echo "=== VM dev:dogfood_substrate_status ==="
# OpenSSH sends a command string through the VM's login shell. On macOS that
# shell is commonly zsh, so a nested quoted command can be re-tokenized there
# and strip arguments (especially paths containing spaces). Send a static
# script over stdin instead: only the fixed `/bin/bash -s` command crosses the
# login-shell boundary, and bash receives each vmcall argument as written.
if ! ssh -o ConnectTimeout=10 "$VM" /bin/bash -s >"$VM_DIAG_OUT" 2>&1 <<'REMOTE'
set -e
VMCALL="$HOME/.papercusp/vm-rig/vmcall.sh"
if [ ! -x "$VMCALL" ] && [ -x /tmp/vmcall.sh ]; then
  VMCALL=/tmp/vmcall.sh
fi
if [ ! -x "$VMCALL" ]; then
  echo "FATAL: vm-rig driver missing; run bin/vm-rig/deploy.sh from the tower" >&2
  exit 1
fi
exec "$VMCALL" dev:dogfood_substrate_status '{}' \
  --client su-live1-imac-probe \
  --workspace papercusp-workspace \
  --harness papercusp
REMOTE
then
  head -30 "$VM_DIAG_OUT"
  exit 1
fi
head -30 "$VM_DIAG_OUT"

echo ""
echo "=== TOWER swarm log (last 10min) ==="
journalctl --user -u papercup-dev-api.service --since "10 min ago" --no-pager 2>/dev/null | grep -iE "peer_connect|peer_disconnect|fed-event|replicat" | tail -15
