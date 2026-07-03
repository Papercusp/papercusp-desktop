#!/bin/bash
# probe-fwd.sh — TOWER→VM federated-event probe (the P-059 forward leg).
#
# PASS = the tower-emitted [fed-event] key lands in the VM's coord:feed AND the
# VM's events:await fires. Rescued/parameterized from /tmp/p059-e1c.sh (P-002 of
# shared-hive-p2p-release-readiness-2026-07-03). Deploy the driver first:
#   bin/vm-rig/deploy.sh
# Usage:  bin/vm-rig/probe-fwd.sh
# Env:    PCUSP_VM_SSH (default aviweiss@172.31.44.2), PAPERCUSP_HONO_PORT
#         (tower operator, default 3070), PCUSP_PROBE_KEY (default unique/run)
VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TOWER_MCP="$ROOT/scripts/mcp-call.mjs"
TOWER_PORT="${PAPERCUSP_HONO_PORT:-3070}"
KEY="${PCUSP_PROBE_KEY:-p059:t2v:probe-$(date +%s)}"
CLI_VM="--client su-live1-imac-probe --workspace papercusp-workspace --harness papercusp"
CLI_TW="--client vm-rig-tower-probe --workspace papercusp-workspace --harness papercusp"

echo "=== tower swarm: recent peer connect/disconnect (last 8min) ==="
journalctl --user -u papercup-dev-api.service --since "8 min ago" --no-pager 2>/dev/null | grep -iE "peer_connect|peer_disconnect" | tail -8

echo ""
echo "=== fwd.1: VM register await $KEY (200s, backgrounded on VM) ==="
ssh -o ConnectTimeout=10 $VM "nohup /tmp/vmcall.sh events:await '{\"event\":\"$KEY\",\"timeout_sec\":200,\"note\":\"vm-rig fwd probe\"}' $CLI_VM > /tmp/vm-rig-await.out 2>&1 & echo await-registered"

sleep 3
echo ""
echo "=== fwd.2: TOWER emit $KEY scope:hive ==="
PAPERCUSP_HONO_PORT=$TOWER_PORT node "$TOWER_MCP" events:emit "{\"event\":\"$KEY\",\"summary\":\"vm-rig fwd probe tower->VM\",\"scope\":\"hive\"}" $CLI_TW

echo ""
echo "=== fwd.3: VM verify (sleep 10) coord:feed + await outcome ==="
ssh -o ConnectTimeout=10 $VM "sleep 10; echo '--- VM coord:feed (must contain the tower [fed-event] $KEY) ---'; /tmp/vmcall.sh coord:feed '{\"q\":\"$KEY\",\"limit\":5}' $CLI_VM; echo '--- VM await outcome (fired=PASS / timeout=FAIL) ---'; cat /tmp/vm-rig-await.out 2>/dev/null | tail -12; echo '--- VM events:status recent_wakes ---'; /tmp/vmcall.sh events:status '{}' $CLI_VM | head -25"
