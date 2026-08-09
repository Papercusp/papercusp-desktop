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
# detector-assert: on a soak whose probes all passed, no UNRECOVERED stall for the
# soak's own harness within the soak's own window (WI-5715, 2026-07-25). Stalls
# that fire and then recover are EXPECTED — a cold restart legitimately produces a
# ~15s connected-but-no-replicator window that self-repair re-attaches — and the
# fire-path pin below asserts the detector MUST fire on a genuinely red soak, so
# demanding blanket silence contradicted it and made this scenario unpassable.
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
  # WI-5481/WI-5355 investigation gap: the outer matrix harness redirects THIS
  # function's stdout to $RIG_WORK/scn.replication_soak.log, but until now every
  # line of $out (the per-cycle PASS/FAIL detail, the rig_wait_swarm "swarm not
  # re-peered within window" warnings, timings) was captured into this local var
  # and then discarded — only a grep-filtered ✗/OVERALL subset on FAIL ever
  # reached that log, so the ⚠ pairing-warning line (needed to correlate a
  # failed probe with a failed post-restart re-pair) was never persisted
  # anywhere. Always echo the FULL raw output first so it lands in the
  # per-scenario log regardless of outcome; the summary/filtered lines below
  # are kept for the terse local-matrix.out report.
  echo "── full replication-liveness soak output (for post-hoc correlation) ──"
  printf '%s\n' "$out"
  echo "── end full output ──"
  if [ "$rc" = 0 ]; then
    echo "replication-liveness soak OK (${RL_SOAK_CYCLES:-5} kill/restart cycles: replication re-established both directions within SLA every cycle; detector quiet)"
  else
    echo "replication-liveness soak FAIL — key lines:"
    printf '%s\n' "$out" | grep -E '✗|OVERALL:' | sed 's/^/      /'
    # ── detector fire-path pin (WI-1840, proven live 2026-07-04 run on kept-up
    # m1783120511 frames): when the SLA FAILS — replication genuinely dead past
    # the 90s window — the connected_never_replicated axis MUST have fired on at
    # least one frame within its 3min grace + the scenario's wait. A silent
    # detector on a red soak is a DETECTOR regression (the m1783120511 round-1
    # incident: per-join liveConnectionCount counter blind to pre-join sockets →
    # swarmConnections=0 → axis disarmed; fixed by reading swarm.connections
    # .size). This assert makes that class self-announcing instead of needing a
    # by-hand serve.log autopsy. Grace(180s) < SLA-wait accumulation across both
    # directions, so by scenario exit the line must exist on a true stall.
    local frame hit=0 oslug mslug
    oslug="${FRAME_MEMBER_SLUG[a]:-}"; mslug="${FRAME_MEMBER_SLUG[b]:-}"
    # WI-5665/WI-5639 follow-up (bug-drain-200k, 2026-07-20): this pin used to
    # grep for ANY "replication_stalled" line anywhere in serve.log, unscoped
    # to harness — on a shared matrix pass, earlier scenarios (content_bidir
    # etc.) federate a DIFFERENT fixed harness (e.g. hello-world/hello-world-
    # pot) whose own transient stalls make this assert a false PASS even when
    # the detector never fired for the harness THIS soak's F-RLSOAK probes
    # actually replicate through (oslug/mslug). Verified live on run
    # stamp=140846 (WI-5665, cycles 1-2 both-direction SLA miss, cpu.pressure
    # all-zero on both frames): frame 'a's only connected_never_replicated/
    # no_replicator events in the ENTIRE serve.log were for
    # harness=hello-world/hello-world-pot, all logged BEFORE
    # replication_soak's own cycles began (leftover from
    # restart_durability/reconnect_catchup) — i.e. this pin was passing on
    # coincidental unrelated noise, not real evidence the detector saw the
    # soak's own stall. Scoping to the soak's own harness slugs makes the pin
    # mean what it claims to mean. Falls back to the old unscoped check only
    # if oslug/mslug somehow never resolved (shouldn't happen post-join).
    #
    # WI-5833 follow-up (2026-07-25): the scoped match above still missed a
    # REAL stall on a genuinely-failing soak (banked stamp=153415) because it
    # required a literal trailing space after the slug — but one hypercore is
    # reported under BOTH "harness=<slug>" and its "-pot" sibling label (the
    # same aliasing deb-hetzner-restart.sh:391-401 documents and handles for
    # its own detector-noise assert; oslug==mslug=="hello-world" in
    # production, and the real stall line logged harness=hello-world-pot).
    # The old space-anchored regex never matches the "-pot" spelling, so a
    # genuine fire was scored as a false "DETECTOR REGRESSION". Allow an
    # optional "-pot" suffix before the word boundary so both label spellings
    # count as the detector having seen the soak's own stall. Offline-verified
    # against serve-a-153415.log: 0 matches under the old pattern, 1 (the real
    # stall line) under this one.
    for frame in a b; do
      if [ -n "$oslug$mslug" ]; then
        if drv_exec "$frame" <<<"grep -qE 'replication_stalled.*harness=(${oslug}|${mslug})(-pot)?[[:space:]]' /home/pcusp/serve.log" 2>/dev/null; then
          hit=1
        fi
      elif drv_exec "$frame" <<<'grep -q "replication-liveness.*replication_stalled" /home/pcusp/serve.log' 2>/dev/null; then
        hit=1
      fi
    done
    if [ "$hit" = 1 ]; then
      echo "      ✓ detector fire-path pin: replication_stalled present in serve.log for this soak's own harness (WI-1840 detector saw the stall)"
    else
      echo "      ✗ DETECTOR REGRESSION: soak failed its SLA but NO replication_stalled line for this soak's own harness (oslug=$oslug mslug=$mslug) on either frame — the WI-1840 detector was blind to a real stall (check lastSwarmConnections via substrate:getReplicationLiveness RPC)"
    fi
    # ── EI-19940993365684927: THE LAST LINE MUST BE THE VERDICT ──────────────
    # A gate artifact's final line must BE its verdict, or be MORE alarming than
    # it — never less. Readers (human and agent) read the tail.
    #
    # The detector pin above is a SUB-ASSERTION about the WI-1840 detector, not
    # about this soak. On the ✓ branch it is true on its own terms and reads as
    # reassuring, and it used to be the FINAL line this function emitted on a
    # FAILED soak. So `tail -1` on scn.replication_soak.log showed a ✓ for a
    # scenario that had just FAILED its SLA: a peer read exactly that tail and
    # concluded "all 18 scenarios green" while this one was INCOMPLETE.
    #
    # Re-emit the verdict LAST so the reassuring sub-assertion can never be the
    # tail. Unconditional and self-authored on purpose: replaying $out's own
    # OVERALL: line would print NOTHING when the soak died before emitting one,
    # which silently restores the very bug this fixes.
    # SAFE BY CONSTRUCTION: local-matrix.sh takes this scenario's verdict from
    # the RETURN CODE (return "$rc"), never by parsing this log, so this line
    # changes only what a reader sees. It also cannot be mistaken for a pass by
    # the unanchored `grep -qaE 'OVERALL: PASS'` in live-federation-gate.sh.
    echo "OVERALL: INCOMPLETE — replication-liveness soak FAILED (rc=$rc). The ✓/✗ line above is a sub-assertion about the DETECTOR, not this scenario's verdict."
  fi
  return "$rc"
}

matrix_register replication_soak 87 "replication-liveness soak (5x kill/restart, both directions, SLA)" scn_replication_soak
