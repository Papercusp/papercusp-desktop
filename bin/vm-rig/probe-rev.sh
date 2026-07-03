#!/bin/bash
# probe-rev.sh — VM→TOWER federated-event probe (the P-059 reverse leg).
#
# PASS = the VM-emitted [fed-event] key lands in the TOWER's coord:feed AND the
# tower's events:await fires. Rescued/parameterized from /tmp/p059-rev2.sh
# (P-002 of shared-hive-p2p-release-readiness-2026-07-03). Deploy first:
#   bin/vm-rig/deploy.sh
# Usage:  bin/vm-rig/probe-rev.sh
# Env:    PCUSP_VM_SSH, PAPERCUSP_HONO_PORT (tower, default 3070), PCUSP_PROBE_KEY
VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TOWER_MCP="$ROOT/scripts/mcp-call.mjs"
TOWER_PORT="${PAPERCUSP_HONO_PORT:-3070}"
KEY="${PCUSP_PROBE_KEY:-p059:v2t:probe-$(date +%s)}"
CLI_VM="--client su-live1-imac-probe --workspace papercusp-workspace --harness papercusp"
CLI_TW="--client vm-rig-tower-probe --workspace papercusp-workspace --harness papercusp"

echo "=== tower swarm connects/disconnects last 5min ==="
journalctl --user -u papercup-dev-api.service --since "5 min ago" --no-pager 2>/dev/null | grep -iE "peer_connect|peer_disconnect" | tail -10

echo ""
echo "=== rev.1: TOWER register await $KEY (150s, backgrounded) ==="
AWAIT_OUT="$(mktemp /tmp/vm-rig-tower-await.XXXXXX)"
( PAPERCUSP_HONO_PORT=$TOWER_PORT node "$TOWER_MCP" events:await "{\"event\":\"$KEY\",\"timeout_sec\":150,\"note\":\"vm-rig rev probe\"}" $CLI_TW > "$AWAIT_OUT" 2>&1 ) &
AWAIT_PID=$!
sleep 3

echo ""
echo "=== rev.2: VM emit $KEY scope:hive (then remote sleep 7 for propagation) ==="
ssh -o ConnectTimeout=10 $VM "/tmp/vmcall.sh events:emit '{\"event\":\"$KEY\",\"summary\":\"vm-rig rev probe VM->tower\",\"scope\":\"hive\"}' $CLI_VM; sleep 7"

echo ""
echo "=== rev.3: tower verify coord:feed (must contain VM [fed-event] $KEY) ==="
PAPERCUSP_HONO_PORT=$TOWER_PORT node "$TOWER_MCP" coord:feed "{\"q\":\"$KEY\",\"limit\":5}" $CLI_TW | head -30

echo ""
echo "=== rev.4: tower await outcome (fired=PASS / timeout=FAIL) ==="
wait $AWAIT_PID 2>/dev/null
tail -12 "$AWAIT_OUT"

echo ""
echo "=== rev.5: tower events:status recent_wakes ==="
PAPERCUSP_HONO_PORT=$TOWER_PORT node "$TOWER_MCP" events:status "{}" $CLI_TW | head -20
