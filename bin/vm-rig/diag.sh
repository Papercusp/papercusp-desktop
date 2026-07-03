#!/bin/bash
# diag.sh — tower + VM hive:status side-by-side (the P-059 diagnosis view:
# admittedLogCount, roster, replication watermarks on BOTH ends).
# Rescued/parameterized from /tmp/p059-diag.sh. Deploy the driver first:
#   bin/vm-rig/deploy.sh
# Usage:  bin/vm-rig/diag.sh
# Env:    PCUSP_VM_SSH, PAPERCUSP_HONO_PORT (tower, default 3070)
VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TOWER_MCP="$ROOT/scripts/mcp-call.mjs"
TOWER_PORT="${PAPERCUSP_HONO_PORT:-3070}"
CLI_VM="--client su-live1-imac-probe --workspace papercusp-workspace --harness papercusp"
CLI_TW="--client vm-rig-tower-probe --workspace papercusp-workspace --harness papercusp"

echo "=== TOWER hive:status (papercusp) ==="
PAPERCUSP_HONO_PORT=$TOWER_PORT node "$TOWER_MCP" hive:status '{"harness":"papercusp"}' $CLI_TW 2>&1 | head -30

echo ""
echo "=== VM hive:status (papercusp) ==="
ssh -o ConnectTimeout=10 $VM "/tmp/vmcall.sh hive:status '{\"harness\":\"papercusp\"}' $CLI_VM" 2>&1 | head -30

echo ""
echo "=== TOWER swarm log (last 10min) ==="
journalctl --user -u papercup-dev-api.service --since "10 min ago" --no-pager 2>/dev/null | grep -iE "peer_connect|peer_disconnect|fed-event|replicat" | tail -15
