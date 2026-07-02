#!/usr/bin/env bash
# b5-restart.sh — Brief 13 matrix scenario for Brief 5 (LIVE restart durability).
#
# Sourced by bin/deb-hetzner-matrix.sh (NOT executable standalone — the standalone proof
# is bin/deb-hetzner-restart.sh). Thin adapter on the same one-source-of-truth pattern as
# reconnect_catchup.sh: sourcing the standalone script only DEFINES
# `scenario_restart_durability` (its run-if-main guard skips the entrypoint), then this
# file maps it onto the matrix scn_/matrix_register contract.
#
# INVASIVE: cold-restarts the member (b) sidecar. Registered order 80 so it runs late,
# just before reconnect_catchup(85)/revocation_kcut(90); it leaves both sidecars UP +
# re-joined for the later invasive scenarios.

source "$DESKTOP_DIR/bin/deb-hetzner-restart.sh"

scn_restart_durability() {
  local out rc
  out="$(scenario_restart_durability a b 2>&1)"; rc=$?
  if [ "$rc" = 0 ]; then
    echo "restart durability OK (cold sidecar restart lost nothing, re-emitted nothing)"
  else
    echo "restart durability FAIL — key lines:"
    printf '%s\n' "$out" | grep -E '✗|OVERALL:' | sed 's/^/      /'
  fi
  return "$rc"
}

matrix_register restart_durability 80 "restart durability (cold member restart)" scn_restart_durability
