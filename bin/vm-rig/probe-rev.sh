#!/bin/bash
# probe-rev.sh — VM→TOWER federated-event probe (the P-059 reverse leg).
#
# PASS = the VM-emitted [fed-event] key lands in the TOWER's coord:feed AND
# the tower's events:status shows a wake record CREATED before the await
# window expired. Do NOT read PASS/FAIL off the await's own outcome alone: a
# headless probe client legitimately shows dropped/dead-waiter there until
# P-001 (wake-executor inbox-degrade fix) lands — that is the LAST delivery
# hop, not the federation rail this probe is testing. Rescued/parameterized
# from /tmp/p059-rev2.sh (P-002 of shared-hive-p2p-release-readiness-2026-07-03).
# Deploy first:
#   bin/vm-rig/deploy.sh
# Usage:  bin/vm-rig/probe-rev.sh
# Env:    PCUSP_VM_SSH, PAPERCUSP_HONO_PORT (tower, default 3270 — the bg-host
#         SUBSTRATE PRIMARY that actually holds the in-process events/coord
#         state; :3070 is the request-only cluster tier and gives
#         false-negative probe results), PCUSP_PROBE_KEY
VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TOWER_MCP="$ROOT/scripts/mcp-call.mjs"
TOWER_PORT="${PAPERCUSP_HONO_PORT:-3270}"
KEY="${PCUSP_PROBE_KEY:-p059:v2t:probe-$(date +%s)}"
CLI_VM="--client su-live1-imac-probe --workspace papercusp-workspace --harness papercusp"
CLI_TW="--client vm-rig-tower-probe --workspace papercusp-workspace --harness papercusp"

echo "=== tower swarm connects/disconnects last 5min ==="
journalctl --user -u papercup-dev-api.service --since "5 min ago" --no-pager 2>/dev/null | grep -iE "peer_connect|peer_disconnect" | tail -10

echo ""
echo "=== rev.1: TOWER register await $KEY (600s, backgrounded) ==="
AWAIT_OUT="$(mktemp /tmp/vm-rig-tower-await.XXXXXX)"
( PAPERCUSP_HONO_PORT=$TOWER_PORT node "$TOWER_MCP" events:await "{\"event\":\"$KEY\",\"timeout_sec\":600,\"note\":\"vm-rig rev probe\"}" $CLI_TW > "$AWAIT_OUT" 2>&1 ) &
AWAIT_PID=$!
sleep 3

echo ""
echo "=== rev.2: VM emit $KEY scope:hive (then remote sleep 7 for propagation) ==="
ssh -o ConnectTimeout=10 $VM "/tmp/vmcall.sh events:emit '{\"event\":\"$KEY\",\"summary\":\"vm-rig rev probe VM->tower\",\"scope\":\"hive\"}' $CLI_VM; sleep 7"

echo ""
echo "=== rev.3: tower verify coord:feed (must contain VM [fed-event] $KEY) ==="
PAPERCUSP_HONO_PORT=$TOWER_PORT node "$TOWER_MCP" coord:feed "{\"q\":\"$KEY\",\"limit\":5}" $CLI_TW | head -30

echo ""
echo "=== rev.4: tower await outcome (informational only — legitimately shows dropped/dead-waiter until P-001 lands; NOT the PASS signal) ==="
wait $AWAIT_PID 2>/dev/null
tail -12 "$AWAIT_OUT"

echo ""
echo "=== rev.5: tower events:status recent_wakes (PASS signal: a wake record for $KEY created before the 600s await window expired) ==="
PAPERCUSP_HONO_PORT=$TOWER_PORT node "$TOWER_MCP" events:status "{}" $CLI_TW | head -20

echo ""
echo "=== rev PASS criterion: rev.3 coord:feed above contains $KEY AND rev.5 events:status above shows a wake record for it created before the 600s await window expired. A dropped/dead-waiter line in rev.4 is the known P-001 delivery-hop gap, NOT a federation failure. ==="
