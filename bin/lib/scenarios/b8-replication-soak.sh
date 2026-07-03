#!/usr/bin/env bash
# b8-replication-soak.sh — matrix scenario for P-004 (WI-1840): the
# replication-liveness restart SOAK (shared-hive-p2p-release-readiness-2026-07-03).
#
# Sourced by bin/deb-hetzner-matrix.sh (NOT executable standalone — the standalone
# proof is `bin/deb-hetzner-restart.sh --soak`). Thin adapter on the same
# one-source-of-truth pattern as b5-restart.sh/reconnect_catchup.sh: sourcing the
# standalone restart script only DEFINES `scenario_replication_liveness_soak`
# (its run-if-main guard skips the entrypoint); this file maps it onto the matrix
# scn_/matrix_register contract.
#
# WHAT IT PINS (the WI-183 / P-059 class): after a kill/restart the swarm re-peers
# (peer_connected both ways) but peer-log replication can silently never resume —
# writes stop crossing with zero errors. The soak cold-restarts alternating frames
# RL_SOAK_CYCLES (default 5) times and asserts live replication re-establishes
# BOTH directions within RL_SOAK_SLA_S (default 90s) EVERY cycle, plus a negative
# detector-assert (no replication_stalled/replication_frozen events on a healthy
# soak — the detector must be quiet when replication is fine).
#
# INVASIVE: cold-restarts BOTH sidecars repeatedly. Registered order 87 so it runs
# late — after restart_durability(80)/reconnect_catchup(85), before
# revocation_kcut(90); it leaves both sidecars UP + re-joined.

# b5-restart.sh may already have sourced this (guard against double-source noise);
# sourcing is idempotent — it only defines functions.
source "$DESKTOP_DIR/bin/deb-hetzner-restart.sh"

scn_replication_soak() {
  local out rc
  out="$(scenario_replication_liveness_soak a b 2>&1)"; rc=$?
  if [ "$rc" = 0 ]; then
    echo "replication-liveness soak OK (${RL_SOAK_CYCLES:-5} kill/restart cycles: replication re-established both directions within SLA every cycle; detector quiet)"
  else
    echo "replication-liveness soak FAIL — key lines:"
    printf '%s\n' "$out" | grep -E '✗|OVERALL:' | sed 's/^/      /'
  fi
  return "$rc"
}

matrix_register replication_soak 87 "replication-liveness soak (5x kill/restart, both directions, SLA)" scn_replication_soak
