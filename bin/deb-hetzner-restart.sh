#!/usr/bin/env bash
# deb-hetzner-restart.sh — federation-release-hardening Brief 5: LIVE restart durability.
#
# Proves (over REAL Hetzner VMs) that a FULL sidecar COLD restart loses nothing and
# re-emits nothing — the live reproduction of the in-process
# `federation-restart-durability-sidecar.repro.integration.test.ts`. The in-process
# repro asserts deep internals (own-log key/length, drained_at watermark equality,
# admitted-set re-admission); over SSH+psql we observe the BEHAVIORAL equivalents in
# PG state: origin=remote/local, exactly-one-row-per-feature (no dup), no undrained
# outbox re-emit, roster intact, new writes federate after restart.
#
# ── DUAL MODE (resolves the Brief-13 lead↔su-9c3f2 packaging conflict) ──────────
#   1. SOURCED (the lead/su-8b360 combined-matrix design): the matrix provisions
#      a(owner)+b(member) ONCE, joins them to one hive, then `source`s this file and
#      calls `scenario_restart_durability` against those SHARED frames. Sourcing only
#      DEFINES the function — it provisions/tears down NOTHING (the run-if-main guard).
#   2. STANDALONE (su-9c3f2's deb-hetzner-<scenario>.sh registry contract): run
#      directly — `bash deb-hetzner-restart.sh --deb=PATH` — and it does the full
#      rig_init → install-exit-trap (auto-destroy, servers=0) → provision → setup →
#      publish → join → scenario → exit-with-code dance. Exit 0 = PASS, non-zero =
#      FAIL/INCOMPLETE (the matrix scores on the exit code). Accepts the shared
#      --deb / --type / --locs / --keep-up args like deb-hetzner-multimember.sh.
#
# The scenario is a 2-FRAME run (owner + one member) — fits the permanent 2-server
# Hetzner cap. It is INVASIVE (restarts BOTH sidecars), so in the combined matrix it
# should run LATE (after the non-restart scenarios); it leaves both sidecars UP +
# re-joined so a later scenario can reuse the frames.
#
# Reuse the fixed .deb (forceReFold==4 in its bundled serve.mjs); do NOT rebuild.
# NOTE (flagged to lead/su-8b360): `default_deb` currently resolves an OLDER bundle
# whose serve.mjs is forceReFold==0 — the matrix/standalone caller MUST pass a --deb
# that carries the fix, else this tests the pre-fix code.
#
# Usage (standalone): bin/deb-hetzner-restart.sh [--locs=ash,ash] [--type=cpx31] [--deb=PATH] [--keep-up]
set -uo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/scripts/linux-test-vm/lib/common.sh"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"
source "$DESKTOP_DIR/bin/lib/deb-hetzner-rig.sh"
set +e
set +u

# ── scenario-local helpers (prefixed _rd_ so co-sourced scenario files don't clash) ─

# _rd_poll_remote <inst> <feature_id> [tries] — PASS (0) iff the row arrives with
# origin='remote' on <inst> within tries×3s (federation landed). Echoes the
# receiving harness_slug on success. The positive analog of rig_assert_absent.
_rd_poll_remote() {
  local inst="$1" fid="$2" tries="${3:-80}" i row
  for i in $(seq 1 "$tries"); do
    row="$(drv_psql "$inst" "SELECT harness_slug FROM harness_shared.harness_features_consolidated WHERE feature_id='$fid' AND origin='remote' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$row" ] && { echo "$row"; return 0; }
    sleep 3
  done
  return 1
}

# _rd_remote_loadavg <inst> — echo <inst>'s OWN /proc/loadavg (1/5/15min + runq/total
# + last-pid), best-effort ("?" on ssh/frame failure, never fatal). WI-5481 discriminator
# (su-c009b3b4 forensic pass, thread post 53109): the soak's failures correlate with
# HOST loadavg (this driver box), but that's a confound, not proof — this is the
# frame's-own-load reading needed to tell "real replicator-attach protocol bug"
# (frames genuinely idle when a leg fails) apart from "load-attach coupling" (the
# failing frame was itself starved). Cheap (<1s), safe to call every cycle.
_rd_remote_loadavg() {
  local inst="$1" out
  out="$(drv_exec "$inst" <<<'cat /proc/loadavg 2>/dev/null' 2>/dev/null | tr -d '\r' | head -1)"
  [ -n "$out" ] && echo "$out" || echo "?"
}

# _rd_remote_cpu_pressure <inst> — echo <inst>'s OWN cgroup-v2 CPU PSI
# (/sys/fs/cgroup/cpu.pressure "some"/"full" avg10/avg60/avg300/total), best-effort
# ("?" on ssh/frame failure or a non-PSI kernel, never fatal).
#
# WI-5639 follow-up (bug-drain-200k, 2026-07-20): _rd_remote_loadavg above was
# introduced as the WI-5481 discriminator for "was the frame itself starved", but
# /proc/loadavg is NOT cgroup/PID-namespace-scoped in mainline Linux — reading it
# from INSIDE a container (local-matrix.sh's docker frames, which share the host
# kernel) surfaces the HOST-WIDE load average, not the frame's own reserved-core
# pressure, regardless of whether WI-5319/D-003's cpuset exclusivity actually
# succeeded for this run. Verified live on the shared dev box hosting this rig
# (2026-07-20): host /proc/loadavg read '39.13 36.77 35.74 26/41175 …' while a
# concurrently-running unrelated container's own cpu.pressure read 'avg60=0.00
# total=161593' against the host's 'avg60=0.19 total=49703324973' — three orders
# of magnitude apart, proving the two numbers measure entirely different things.
# This is very likely why WI-5481/WI-5634/WI-5639's "was cycle 2 A→B starved"
# question stayed open across three investigations despite loadavg readings of
# 86.03 at the failure: that number cannot distinguish "this frame's own 8
# reserved cores were pressured" from "the shared host's other ~100 unrelated
# containers were busy" — it is the same number either way. cgroup v2 CPU
# pressure (PSI), by contrast, IS genuinely cgroup-scoped (confirmed via the same
# live comparison above) and reads correctly from inside a container whose
# cgroup namespace exposes only its own delegated subtree — exactly what
# WI-5319/D-003's cpuset.cpus.exclusive partition sets up. A nonzero avg10/avg60
# here on the failing leg is the first REAL evidence of frame-local CPU
# starvation; an all-zero reading conclusively RULES IT OUT (unlike a loadavg
# reading, which can never rule it in or out).
_rd_remote_cpu_pressure() {
  local inst="$1" out
  out="$(drv_exec "$inst" <<<'cat /sys/fs/cgroup/cpu.pressure 2>/dev/null | tr "\n" ";"' 2>/dev/null | tr -d '\r')"
  [ -n "$out" ] && echo "$out" || echo "?"
}

# _rd_row_count <inst> <feature_id> — echo the number of PG rows for this feature_id
# on <inst> (across all slugs). The no-duplicate-rows census probe.
_rd_row_count() {
  local inst="$1" fid="$2"
  drv_psql "$inst" "SELECT count(*) FROM harness_shared.harness_features_consolidated WHERE feature_id='$fid';" 2>/dev/null | tr -d '[:space:]'
}

# _rd_assert_single <inst> <feature_id> <label> — assert exactly one PG row. Sets
# _RD_RC=1 on failure (no-dup guard). The fresh-cursor re-fold on a cold re-open
# re-applies federated ops; the PK + idempotent LWW upsert must dedup them.
_rd_assert_single() {
  local inst="$1" fid="$2" label="$3" n
  n="$(_rd_row_count "$inst" "$fid")"
  if [ "${n:-0}" = "1" ]; then echo "  ✓ no-dup: $label ($inst/$fid) = exactly 1 row"; else
    echo "  ✗ NO-DUP FAIL: $label ($inst/$fid) = '${n:-?}' rows (want 1)"; _RD_RC=1; fi
}

# _rd_origin <inst> <feature_id> — echo "<slug>|<origin>" for the row (empty if absent).
_rd_origin() { rig_read_content "$1" "$2"; }

# ── the scenario (operates on already-provisioned+joined frames a=owner, b=member) ─
# Reads the rig globals FRAME_MEMBER_SLUG[a|b], FRAME_IP[*], FED_PG[*] (filled by
# rig_owner_publish_hive + rig_join_all + rig_wait_*). Returns 0 = PASS, 1 = FAIL.
# Self-contained: unique timestamped feature_ids → safe to run after other scenarios
# on the same shared frames. Leaves both sidecars UP + re-joined.
scenario_restart_durability() {
  local OWNER="${1:-a}" MEMBER="${2:-b}"
  local oslug="${FRAME_MEMBER_SLUG[$OWNER]:-}" mslug="${FRAME_MEMBER_SLUG[$MEMBER]:-}"
  local ts; ts="$(date +%s)"
  local FINIT="F-RD-INIT-$ts" MPRE="F-RD-MPRE-$ts" FPOST="F-RD-POST-$ts" FPOST2="F-RD-POST2-$ts"
  _RD_RC=0

  fed_log "═══ Brief 5: LIVE restart durability (owner=$OWNER member=$MEMBER) ═══"
  if [ -z "$oslug" ] || [ -z "$mslug" ]; then
    echo "✗ restart-durability: frames not joined (owner-slug='$oslug' member-slug='$mslug') — run rig_owner_publish_hive + rig_join_all first"
    echo "OVERALL: INCOMPLETE"; return 1
  fi
  echo "  owner-view slug=$oslug   member slug=$mslug"

  # ── STEP 1: federate an INITIAL owner feature → member; member authors a LOCAL one ──
  fed_log "[1] owner writes $FINIT (→ federate to member); member writes $MPRE (local)"
  rig_write_content "$OWNER" "$oslug" "$FINIT" "restart-durability initial owner feature" todo >/dev/null
  if rslug="$(_rd_poll_remote "$MEMBER" "$FINIT" 70)"; then
    echo "  ✓ baseline: $FINIT federated to member (origin=remote, slug=$rslug)"
  else
    echo "  ✗ BASELINE FAIL: $FINIT never federated to member pre-restart"
    fed_log "diag: member roster (empty roster drops every owner op):"; rig_read_roster "$MEMBER"
    _RD_RC=1
  fi
  rig_write_content "$MEMBER" "$mslug" "$MPRE" "restart-durability member-local feature" todo >/dev/null
  local mpre_pre; mpre_pre="$(_rd_origin "$MEMBER" "$MPRE")"
  case "$mpre_pre" in *"|local") echo "  ✓ member authored $MPRE (origin=local)";; *) echo "  ✗ member-local $MPRE not present pre-restart (got '$mpre_pre')"; _RD_RC=1;; esac

  local roster_member_pre; roster_member_pre="$(rig_read_roster "$MEMBER")"
  echo "  member roster pre-restart: $(printf '%s' "$roster_member_pre" | tr '\n' ' ')"

  # ── STEP 2: COLD-RESTART the MEMBER sidecar (preserve pgdata) ──
  fed_log "[2] COLD-RESTART member sidecar — pkill serve.mjs, relaunch (no wipe), boot-all re-reads state + swarm rejoin"
  rig_restart_sidecar "$MEMBER"
  rig_wait_frame_ready "$MEMBER" 60 || { echo "  ✗ member sidecar did not come back after restart"; _RD_RC=1; }
  rig_wait_swarm "$OWNER" "$MEMBER" 70 || echo "  ⚠ member did not re-peer within window (catch-up may still land below)"

  # (a) NO LOSS: pre-restart content survived (F-init remote + M-pre local).
  local finit_post_m; finit_post_m="$(_rd_origin "$MEMBER" "$FINIT")"
  case "$finit_post_m" in *"|remote") echo "  ✓ no-loss: $FINIT still present on member (origin=remote)";; *) echo "  ✗ NO-LOSS FAIL: $FINIT missing/wrong-origin on member after restart (got '$finit_post_m')"; _RD_RC=1;; esac
  local mpre_post_m; mpre_post_m="$(_rd_origin "$MEMBER" "$MPRE")"
  case "$mpre_post_m" in *"|local") echo "  ✓ no-loss: member-local $MPRE survived restart (origin=local)";; *) echo "  ✗ NO-LOSS FAIL: member-local $MPRE lost after restart (got '$mpre_post_m')"; _RD_RC=1;; esac

  # (b) ROSTER intact after restart.
  local roster_member_post; roster_member_post="$(rig_read_roster "$MEMBER")"
  if [ -n "$roster_member_post" ]; then echo "  ✓ roster intact on member after restart: $(printf '%s' "$roster_member_post" | tr '\n' ' ')"; else
    echo "  ✗ ROSTER FAIL: member roster EMPTY after restart (would drop all peer ops)"; _RD_RC=1; fi

  # (c) NO DUP: exactly one PG row per feature on the member.
  _rd_assert_single "$MEMBER" "$FINIT" "owner→member F-init"
  _rd_assert_single "$MEMBER" "$MPRE"  "member-local M-pre"

  # (d) NO RE-EMIT: the cold-reopened member must NOT re-emit its already-drained own
  #     op (drained_at watermark lives in PG). After the restart settles its outbox
  #     has NO undrained rows for the member slug (nothing pending a re-emit storm).
  local undrained
  undrained="$(drv_psql "$MEMBER" "SELECT count(*) FROM harness_shared.substrate_outbox WHERE harness_slug='$mslug' AND drained_at IS NULL;" 2>/dev/null | tr -d '[:space:]')"
  if [ "${undrained:-x}" = "0" ]; then echo "  ✓ no-re-emit: member outbox has 0 undrained rows after restart (drained_at watermark survived)"; else
    echo "  ✗ NO-RE-EMIT FAIL: member has '${undrained:-?}' undrained outbox rows after restart (re-emit storm)"; _RD_RC=1; fi

  # ── STEP 3: owner authors NEW content post member-restart → must federate to member ──
  fed_log "[3] owner writes $FPOST (post member-restart) → federate to member"
  rig_write_content "$OWNER" "$oslug" "$FPOST" "authored after member restart" todo >/dev/null
  if _rd_poll_remote "$MEMBER" "$FPOST" 90 >/dev/null; then echo "  ✓ new-write: $FPOST federated to member after its restart (origin=remote)"; else
    echo "  ✗ NEW-WRITE FAIL: $FPOST did not federate to member after member restart"; _RD_RC=1; fi
  _rd_assert_single "$MEMBER" "$FPOST" "owner→member F-post"

  # ── STEP 4: COLD-RESTART the OWNER sidecar — content/roster intact, new write federates ──
  fed_log "[4] COLD-RESTART owner sidecar — pkill serve.mjs, relaunch (no wipe), re-read state + swarm rejoin"
  rig_restart_sidecar "$OWNER"
  rig_wait_frame_ready "$OWNER" 60 || { echo "  ✗ owner sidecar did not come back after restart"; _RD_RC=1; }
  rig_wait_swarm "$OWNER" "$MEMBER" 70 || echo "  ⚠ owner↔member did not re-peer within window"

  # owner's own content (origin=local) + roster intact after its restart.
  local finit_owner; finit_owner="$(_rd_origin "$OWNER" "$FINIT")"
  case "$finit_owner" in *"|local") echo "  ✓ owner content $FINIT intact after owner restart (origin=local)";; *) echo "  ✗ OWNER-CONTENT FAIL: $FINIT missing on owner after restart (got '$finit_owner')"; _RD_RC=1;; esac
  local roster_owner; roster_owner="$(rig_read_roster "$OWNER")"
  if [ -n "$roster_owner" ]; then echo "  ✓ owner roster intact after restart: $(printf '%s' "$roster_owner" | tr '\n' ' ')"; else
    echo "  ✗ ROSTER FAIL: owner roster EMPTY after restart"; _RD_RC=1; fi
  _rd_assert_single "$OWNER" "$FINIT" "owner-local F-init"
  _rd_assert_single "$OWNER" "$FPOST" "owner-local F-post"

  # ── STEP 5: NEW write after the OWNER restart still federates to the member ──
  fed_log "[5] owner writes $FPOST2 (post owner-restart) → federate to member"
  # WI-5444: stamp the write time BEFORE issuing it, and export the canary's
  # identity below regardless of pass/fail, so the settle-barrier scenario
  # (order 82, bin/lib/scenarios/restart-settle-barrier.sh) can re-poll this
  # SAME row for a longer, instrumented window before 85/87/90 start — this
  # scenario's own check below stays bounded at 90 tries (~270s) on purpose
  # (it is the "measures the SLA with no barrier in front of it" leg the
  # WI-5444 disposition asked to keep unchanged); the barrier picks up from
  # here rather than this check being widened.
  RD_LAST_CANARY_WRITE_TS="$(date +%s)"
  rig_write_content "$OWNER" "$oslug" "$FPOST2" "authored after owner restart" todo >/dev/null
  if _rd_poll_remote "$MEMBER" "$FPOST2" 90 >/dev/null; then echo "  ✓ new-write: $FPOST2 federated to member after OWNER restart (origin=remote)"; else
    echo "  ✗ NEW-WRITE FAIL: $FPOST2 did not federate after owner restart"; _RD_RC=1; fi
  _rd_assert_single "$MEMBER" "$FPOST2" "owner→member F-post2"
  RD_LAST_MEMBER="$MEMBER"
  RD_LAST_CANARY_FID="$FPOST2"

  # ── report ──
  fed_log "RESULT Brief 5 (restart durability, 2-frame .deb sidecar, real public DHT)"
  if [ "$_RD_RC" = 0 ]; then
    echo "OVERALL: PASS — member+owner COLD restart: no content/roster loss, no duplicate rows, no outbox re-emit, new writes federate both before+after each restart"
    return 0
  fi
  echo "OVERALL: INCOMPLETE — restart durability had failures (see ✗ lines + /home/pcusp/serve.log on each frame)"
  return 1
}

# ── P-004 (WI-1840, WI-183 class): replication-liveness RESTART SOAK ────────────
# shared-hive-p2p-release-readiness-2026-07-03 P-004. The WI-183/P-059 failure is
# a peer that RE-CONNECTS after a restart (peer_connected both ways) while
# peer-log replication silently never resumes. One restart passing proves little
# — the class is intermittent. This soak does N kill/restart cycles (alternating
# member/owner) and asserts LIVE replication re-establishes EVERY cycle, BOTH
# directions, within a stated SLA — plus a negative detector-assert: the
# replication-liveness detector must NOT have fired (no replication_stalled /
# replication_frozen in serve.log) during a healthy soak.
#
# Knobs: RL_SOAK_CYCLES (default 5) · RL_SOAK_SLA_S (default 90 — seconds each
# direction's probe write may take to land AFTER the restarted frame is ready).
#
# Runs on any rig that fills the shared frame globals (Hetzner, RIG_FRAME_IPS
# local sshd containers, libvirt VM) — the LOCAL rigs are the proof of record
# per plan decision D-001 (Hetzner access gone).
scenario_replication_liveness_soak() {
  local OWNER="${1:-a}" MEMBER="${2:-b}"
  local cycles="${RL_SOAK_CYCLES:-5}" sla_s="${RL_SOAK_SLA_S:-90}"
  local tries=$(( (sla_s + 2) / 3 ))   # _rd_poll_remote polls every 3s
  local oslug="${FRAME_MEMBER_SLUG[$OWNER]:-}" mslug="${FRAME_MEMBER_SLUG[$MEMBER]:-}"
  local ts; ts="$(date +%s)"
  local rc=0 i target t0 t1 load_o load_m psi_o psi_m

  fed_log "═══ P-004: replication-liveness soak — $cycles kill/restart cycles, SLA ${sla_s}s/leg ═══"
  if [ -z "$oslug" ] || [ -z "$mslug" ]; then
    echo "✗ replication-soak: frames not joined (owner-slug='$oslug' member-slug='$mslug')"
    echo "OVERALL: INCOMPLETE"; return 1
  fi

  for i in $(seq 1 "$cycles"); do
    # Alternate the restart target: odd cycles restart the MEMBER, even the OWNER
    # (WI-183's repro killed the member; P-059 was dead BOTH directions).
    if [ $((i % 2)) = 1 ]; then target="$MEMBER"; else target="$OWNER"; fi
    fed_log "[cycle $i/$cycles] COLD-RESTART frame '$target' → re-peer → probe BOTH directions (SLA ${sla_s}s)"
    rig_restart_sidecar "$target"
    if ! rig_wait_frame_ready "$target" 60; then
      echo "  ✗ cycle $i: frame '$target' did not come back after restart"; rc=1; continue
    fi
    rig_wait_swarm "$OWNER" "$MEMBER" 70 \
      || echo "  ⚠ cycle $i: swarm not re-peered within window (probes below still enforce the SLA)"

    # WI-5481 discriminator (baseline, post-repeer/pre-probe): both frames' OWN
    # loadavg for this cycle, so a later FAIL can be read against "were the
    # frames idle at cycle start" even if it later spikes mid-probe.
    load_o="$(_rd_remote_loadavg "$OWNER")"; load_m="$(_rd_remote_loadavg "$MEMBER")"
    echo "  ⚙ cycle $i remote loadavg (post-repeer, pre-probe) — '$OWNER': $load_o   '$MEMBER': $load_m"

    # Leg A: owner → member.
    local fid_am="F-RLSOAK-${ts}-${i}-AM"
    t0="$(date +%s)"
    rig_write_content "$OWNER" "$oslug" "$fid_am" "replication soak c$i owner→member" todo >/dev/null
    if _rd_poll_remote "$MEMBER" "$fid_am" "$tries" >/dev/null; then
      t1="$(date +%s)"
      echo "  ✓ cycle $i A→B: $fid_am landed on member in $((t1 - t0))s (SLA ${sla_s}s)"
    else
      # Precise-at-failure capture (WI-5481 discriminator): $MEMBER is the frame
      # that should have RECEIVED + re-attached the replicator — its load right
      # now is the most direct read on "was it starved". $OWNER too, since either
      # side stalling the swarm/replicator could explain a one-direction miss.
      # WI-5639 follow-up: loadavg alone can never answer this (see
      # _rd_remote_cpu_pressure's comment) — pair it with each frame's own
      # cgroup CPU-pressure (PSI) reading, which IS frame-scoped.
      load_o="$(_rd_remote_loadavg "$OWNER")"; load_m="$(_rd_remote_loadavg "$MEMBER")"
      psi_o="$(_rd_remote_cpu_pressure "$OWNER")"; psi_m="$(_rd_remote_cpu_pressure "$MEMBER")"
      echo "  ✗ cycle $i A→B FAIL: $fid_am did not land on member within ${sla_s}s — replication NOT re-established (WI-183 class) — loadavg at failure: '$OWNER'=$load_o '$MEMBER'=$load_m — cpu.pressure (frame-scoped): '$OWNER'=$psi_o '$MEMBER'=$psi_m"
      rc=1
    fi

    # Leg B: member → owner (the reverse direction P-059 also lost).
    local fid_ma="F-RLSOAK-${ts}-${i}-MA"
    t0="$(date +%s)"
    rig_write_content "$MEMBER" "$mslug" "$fid_ma" "replication soak c$i member→owner" todo >/dev/null
    if _rd_poll_remote "$OWNER" "$fid_ma" "$tries" >/dev/null; then
      t1="$(date +%s)"
      echo "  ✓ cycle $i B→A: $fid_ma landed on owner in $((t1 - t0))s (SLA ${sla_s}s)"
    else
      load_o="$(_rd_remote_loadavg "$OWNER")"; load_m="$(_rd_remote_loadavg "$MEMBER")"
      psi_o="$(_rd_remote_cpu_pressure "$OWNER")"; psi_m="$(_rd_remote_cpu_pressure "$MEMBER")"
      echo "  ✗ cycle $i B→A FAIL: $fid_ma did not land on owner within ${sla_s}s — replication NOT re-established (WI-183 class) — loadavg at failure: '$OWNER'=$load_o '$MEMBER'=$load_m — cpu.pressure (frame-scoped): '$OWNER'=$psi_o '$MEMBER'=$psi_m"
      rc=1
    fi
  done

  # Negative detector-assert: a HEALTHY soak must not have tripped the
  # replication-liveness detector on either frame. (If a leg above failed, the
  # detector firing is EXPECTED and this check is skipped — the failure is
  # already scored; the detector doing its job must not double-count.)
  if [ "$rc" = 0 ]; then
    local frame hits
    for frame in "$OWNER" "$MEMBER"; do
      # $(drv_applog "$frame") resolves LOCALLY to the frame's app-log path
      # (/home/pcusp/serve.log on the rig driver); the grep runs remotely.
      hits="$(printf '%s\n' "grep -c 'replication_stalled\|replication_frozen' '$(drv_applog "$frame")' 2>/dev/null; true" \
        | drv_exec "$frame" 2>/dev/null | tail -1 | tr -d '[:space:]')"
      if [ -n "${hits:-}" ] && [ "${hits}" != "0" ]; then
        echo "  ✗ detector-noise: frame '$frame' logged $hits replication stall event(s) during a soak whose probes all passed — false positive, fix the detector"
        rc=1
      else
        echo "  ✓ detector quiet on frame '$frame' (no stall events during healthy soak)"
      fi
    done
  fi

  fed_log "RESULT P-004 replication-liveness soak"
  if [ "$rc" = 0 ]; then
    echo "OVERALL: PASS — $cycles kill/restart cycles: live replication re-established BOTH directions within ${sla_s}s every cycle; detector quiet"
    return 0
  fi
  echo "OVERALL: INCOMPLETE — replication-liveness soak had failures (see ✗ lines + serve.log on each frame)"
  return 1
}

# ── STANDALONE entrypoint (su-9c3f2 registry contract) — only when run directly ──
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  LOCS="ash,ash"; STYPE="cpx31"; DEB=""; KEEP_UP=0; IMAGE="ubuntu-24.04"; RUN_SOAK=0
  for arg in "$@"; do case "$arg" in
    --locs=*) LOCS="${arg#--locs=}" ;;
    --type=*) STYPE="${arg#--type=}" ;;
    --deb=*)  DEB="${arg#--deb=}" ;;
    --image=*) IMAGE="${arg#--image=}" ;;
    --keep-up) KEEP_UP=1 ;;
    --soak) RUN_SOAK=1 ;;   # P-004: run the replication-liveness restart soak too
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown arg: $arg" ;;
  esac; done
  IFS=',' read -r LOC_A LOC_B <<<"$LOCS"
  [ -n "$LOC_B" ] || LOC_B="$LOC_A"
  [ -n "$DEB" ] || DEB="$(default_deb)"
  P_A_USER="${P_A_USER:-papercupai}"   # owner
  P_B_USER="${P_B_USER:-aviynw}"       # member

  RIG_KEEP_UP="$KEEP_UP"
  rig_init "$STYPE" "$IMAGE" || exit 1
  rig_install_exit_trap          # ARM auto-destroy BEFORE any provision (servers=0)
  RIG_DEB="$DEB"
  rig_gate_artifact "$DEB" || exit 2

  rig_set_identity a "$P_A_USER" || exit 1
  rig_set_identity b "$P_B_USER" || exit 1
  rig_provision "$LOC_A" "$LOC_B" || exit 3
  rig_setup_all || exit 4

  fed_log "wait embedded-PG + operator on both sidecars"
  rig_wait_all_ready 50 || exit 5

  REPO_URL="${HIVE_REPO_URL:-https://github.com/octocat/Hello-World}"
  rig_owner_publish_hive a "$REPO_URL" || exit 6
  rig_join_all a   # a (owner self-join) + b

  fed_log "joined — wait for peer_connect + initial drain"
  sleep 12
  rig_wait_swarm a b 70 || echo "⚠ a↔b not yet peered before scenario (scenario polls/restarts will retry)"

  scenario_restart_durability a b
  rc=$?
  # P-004: optional replication-liveness soak on the same frames (worst-wins exit).
  if [ "$RUN_SOAK" = 1 ]; then
    scenario_replication_liveness_soak a b || rc=1
  fi
  [ "$rc" = 0 ] && echo "OVERALL: PASS" || echo "OVERALL: INCOMPLETE"
  exit "$rc"
fi
