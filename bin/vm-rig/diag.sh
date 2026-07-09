#!/bin/bash
# diag.sh — tower + VM substrate-status side-by-side (the P-059 diagnosis
# view: booted harnesses, per-row health verdict, workspace summary on BOTH
# ends). `hive:status` is dead (retired verb); this uses
# `dev:dogfood_substrate_status`, which wraps the in-process substrate read
# directly — same reason the probes need the bg-host SUBSTRATE PRIMARY port,
# not the request-only cluster tier (see PAPERCUSP_HONO_PORT below).
# Rescued/parameterized from /tmp/p059-diag.sh. Deploy the driver first:
#   bin/vm-rig/deploy.sh
# Usage:  bin/vm-rig/diag.sh
# Env:    PCUSP_VM_SSH, PAPERCUSP_HONO_PORT (tower, default 3270 — the
#         bg-host substrate primary; :3070 is the request-only cluster tier
#         and won't reliably reflect true in-process substrate state)
VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TOWER_MCP="$ROOT/scripts/mcp-call.mjs"
TOWER_PORT="${PAPERCUSP_HONO_PORT:-3270}"
CLI_VM="--client su-live1-imac-probe --workspace papercusp-workspace --harness papercusp"
CLI_TW="--client vm-rig-tower-probe --workspace papercusp-workspace --harness papercusp"

echo "=== TOWER dev:dogfood_substrate_status ==="
PAPERCUSP_HONO_PORT=$TOWER_PORT node "$TOWER_MCP" dev:dogfood_substrate_status '{}' $CLI_TW 2>&1 | head -30

echo ""
echo "=== VM dev:dogfood_substrate_status ==="
ssh -o ConnectTimeout=10 $VM "/tmp/vmcall.sh dev:dogfood_substrate_status '{}' $CLI_VM" 2>&1 | head -30

echo ""
echo "=== TOWER swarm log (last 10min) ==="
journalctl --user -u papercup-dev-api.service --since "10 min ago" --no-pager 2>/dev/null | grep -iE "peer_connect|peer_disconnect|fed-event|replicat" | tail -15
