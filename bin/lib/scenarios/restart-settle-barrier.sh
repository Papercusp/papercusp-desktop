#!/usr/bin/env bash
# restart-settle-barrier.sh — WI-5444: settle-or-repair barrier between order
# 80 (restart_durability) and the later invasive scenarios (85 reconnect_catchup,
# 87 replication_soak, 90 revocation_kcut).
#
# Repro this closes (WI-5444): b5-restart.sh deliberately leaves both sidecars
# up + re-joined after order 80 for the later invasive scenarios, but order 80
# can leave a real (if latent, sometimes self-healing) convergence backlog in
# flight — order 85 has started while still inside that recovery window and
# died at its OWN baseline step, before ever exercising its own partition/
# reconnect logic. That is test-harness contamination, not a reproduction of
# whatever 85/87/90 are meant to test on their own. There was no barrier
# between 80 and 85/87/90 that made the matrix wait for (or at least measure)
# settling first — this file is that barrier.
#
# Design (per fleet-leader su-4c73ae38's WI-5444 posts 52896/52901 — read
# those before touching the constants below): make the barrier an INSTRUMENT,
# not a mute. A barrier that silently blocks until convergence would let
# 85/87/90 go green over a system that still takes minutes to resync against
# a 90s SLA — hiding the defect instead of exposing it. So this scenario:
#   - re-polls the SAME canary write order 80 made (scenario_restart_durability
#     exports RD_LAST_CANARY_FID/RD_LAST_MEMBER/RD_LAST_CANARY_WRITE_TS) —
#     never invents a fresh one; the point is observing THAT restart's actual
#     convergence, tracked from the ORIGINAL write time;
#   - ALWAYS emits elapsed time as a first-class result line, never a silent
#     sleep — including a loud ⚠ once elapsed crosses RD_SETTLE_WARN_S even
#     when it still converges after that (a visible regression signal short
#     of an outright fail);
#   - hard-FAILs only past RD_SETTLE_FAIL_S. That deadline is deliberately
#     generous (default 900s) — run 214246/224336's own timings are confounded
#     by verified shared-host CPU contention (WI-5481, fix EI-16524 not yet
#     live) per WI-5444 posts 52926/52963, so hard-failing at ~2min would just
#     turn this into permanent, uninformative noise until that infra fix
#     lands. DO NOT tighten RD_SETTLE_FAIL_S (or flip RD_SETTLE_WARN_IS_FAIL)
#     without a clean post-EI-16524-fix run establishing the real SLA — every
#     knob here is env-overridable so that recalibration never needs a code
#     change, and su-d93ac1bf's post 52963 explicitly left this exact call
#     open ("leaving the barrier-threshold call to whoever's driving this").
#   - order 80 (scn_restart_durability) itself is UNCHANGED — its own
#     270s-bounded check on this same canary keeps failing on its own,
#     independent of this barrier. That is the "at least one scenario that
#     measures the SLA WITHOUT a barrier in front of it" leg the disposition
#     asked to keep — this file adds a second, later checkpoint; it does not
#     replace or soften the first one.
#
# No preceding restart_durability canary (e.g. a `--only` run excluded order
# 80) → nothing to settle → PASS (no-op), never a forced fail.

RD_SETTLE_WARN_S="${RD_SETTLE_WARN_S:-120}"     # leader's "~2min should be loud" bar (52896) — always a visible ⚠, not by itself a fail (see header)
RD_SETTLE_FAIL_S="${RD_SETTLE_FAIL_S:-900}"     # provisional hard deadline — comfortably above the observed ~12min self-heal (214246) and short of the confound-free "never converged" case (224336, 36+min) — retune only from a clean run
RD_SETTLE_WARN_IS_FAIL="${RD_SETTLE_WARN_IS_FAIL:-0}"  # set 1 to make crossing RD_SETTLE_WARN_S itself a hard fail, once calibration lands

scn_restart_settle_barrier() {
  local fid="${RD_LAST_CANARY_FID:-}" member="${RD_LAST_MEMBER:-}" write_ts="${RD_LAST_CANARY_WRITE_TS:-}"
  if [ -z "$fid" ] || [ -z "$member" ] || [ -z "$write_ts" ]; then
    echo "settle-barrier: no preceding restart_durability canary (order 80 didn't run this session) — nothing to settle, skipping"
    return 0
  fi

  local now elapsed budget tries origin
  now="$(date +%s)"; elapsed=$(( now - write_ts ))
  fed_log "═══ WI-5444: restart-settle barrier — re-checking $fid on $member (${elapsed}s since write) ═══"

  # Already converged (order 80's own check may already have seen it land, or
  # it landed in the gap since) — report + done, no extra poll needed.
  origin="$(_rd_origin "$member" "$fid")"
  case "$origin" in
    *"|remote")
      if [ "$elapsed" -gt "$RD_SETTLE_WARN_S" ]; then
        echo "  ⚠ settle-barrier: $fid converged after ${elapsed}s — over the ${RD_SETTLE_WARN_S}s regression-warn bar (still under the ${RD_SETTLE_FAIL_S}s hard deadline)"
        if [ "$RD_SETTLE_WARN_IS_FAIL" = 1 ]; then
          echo "OVERALL: FAIL — RD_SETTLE_WARN_IS_FAIL=1: ${elapsed}s exceeds the ${RD_SETTLE_WARN_S}s bar"
          return 1
        fi
      else
        echo "  ✓ settle-barrier: $fid already converged (${elapsed}s since write, within the ${RD_SETTLE_WARN_S}s warn bar)"
      fi
      echo "OVERALL: PASS — settled after ${elapsed}s; 85/87/90 can start on a converged system"
      return 0
      ;;
  esac

  budget=$(( RD_SETTLE_FAIL_S - elapsed ))
  if [ "$budget" -le 0 ]; then
    echo "  ✗ settle-barrier FAIL: $fid still NOT converged at ${elapsed}s — past the ${RD_SETTLE_FAIL_S}s hard deadline"
    echo "OVERALL: FAIL — no convergence within ${RD_SETTLE_FAIL_S}s (provisional deadline, WI-5444 — do not retune without a clean post-EI-16524-fix run)"
    return 1
  fi

  tries=$(( (budget + 2) / 3 ))
  fed_log "settle-barrier: $fid not yet converged at ${elapsed}s — polling up to ${budget}s more (hard deadline ${RD_SETTLE_FAIL_S}s total since write)"
  if _rd_poll_remote "$member" "$fid" "$tries" >/dev/null; then
    now="$(date +%s)"; elapsed=$(( now - write_ts ))
    echo "  ⚠ settle-barrier: $fid converged after ${elapsed}s — over the ${RD_SETTLE_WARN_S}s warn bar (recovery was slow; not yet a hard fail)"
    if [ "$RD_SETTLE_WARN_IS_FAIL" = 1 ] && [ "$elapsed" -gt "$RD_SETTLE_WARN_S" ]; then
      echo "OVERALL: FAIL — RD_SETTLE_WARN_IS_FAIL=1: ${elapsed}s exceeds the ${RD_SETTLE_WARN_S}s bar"
      return 1
    fi
    echo "OVERALL: PASS — settled after ${elapsed}s (slow — see WI-5444 calibration note); 85/87/90 can start"
    return 0
  fi

  now="$(date +%s)"; elapsed=$(( now - write_ts ))
  echo "  ✗ settle-barrier FAIL: $fid still NOT converged after ${elapsed}s — past the ${RD_SETTLE_FAIL_S}s hard deadline"
  echo "OVERALL: FAIL — no convergence within ${RD_SETTLE_FAIL_S}s (provisional deadline, WI-5444 — do not retune without a clean post-EI-16524-fix run)"
  return 1
}
matrix_register restart_settle_barrier 82 "settle-or-repair barrier after restart durability (WI-5444)" scn_restart_settle_barrier
