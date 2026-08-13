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

# _rd_log_line_mark <inst> — exact current application-log line count, or "?"
# with a non-zero return when the remote log cannot be measured. Line offsets are
# used instead of timestamps because serve.log is not uniformly timestamped.
_rd_log_line_mark() {
  local inst="$1" n
  n="$(printf 'wc -l < %q 2>/dev/null\n' "$(drv_applog "$inst")" \
    | drv_exec "$inst" 2>/dev/null | tail -1 | tr -d '[:space:]')"
  case "${n:-}" in
    ''|*[!0-9]*) echo "?"; return 1 ;;
    *) echo "$n" ;;
  esac
}

# _rd_actual_rows <inst> <feature_id> — ALL rows at the destination, preserving
# the actual harness_slug|origin rather than filtering origin='remote' and then
# throwing the row away (the old _rd_poll_remote blind spot).
_rd_actual_rows() {
  local inst="$1" fid="$2" rows
  rows="$(drv_psql "$inst" "SELECT COALESCE(string_agg(harness_slug||'|'||origin, ',' ORDER BY harness_slug, origin), '<absent>') FROM harness_shared.harness_features_consolidated WHERE feature_id='$fid';" 2>/dev/null | tr -d '\r\n')"
  [ -n "$rows" ] && echo "$rows" || echo "<unavailable>"
}

# _rd_writer_outbox_row <inst> <feature_id> — raw
# "id|harness_slug|drained(Y/N)|drained_log_key" for the writer's target row.
# The drained_log_key is the exact own-log that accepted the outbox operation,
# which lets the announce high-water below be matched to the correct local log
# even when the process serves both a member and its -pot home log.
_rd_writer_outbox_row() {
  local inst="$1" fid="$2" row
  row="$(drv_psql "$inst" "SELECT id::text||'|'||harness_slug||'|'||CASE WHEN drained_at IS NULL THEN 'N' ELSE 'Y' END||'|'||COALESCE(drained_log_key, '<none>') FROM harness_shared.substrate_outbox WHERE table_name='harness_features_consolidated' AND key='$fid' ORDER BY id DESC LIMIT 1;" 2>/dev/null | tr -d '\r\n')"
  [ -n "$row" ] && echo "$row" || echo "<absent>"
}

# _rd_writer_log_high_water <inst> <start-line> <end-line> <full-log-key>
# Echo the latest env-gated sent-announce trace for the exact drained log in the
# failed leg's write→timeout window. swarm.ts now prints signed log_length on
# every sent/received announce, so this distinguishes never-appended from
# appended-but-not-delivered without a second matrix.
_rd_writer_log_high_water() {
  local inst="$1" start="$2" end="$3" log_key="$4" out cmd
  case "$start:$end" in *[!0-9:]*|:*|*:) echo "<window-unavailable>"; return 1 ;; esac
  if [ "$log_key" = "<none>" ] || [ "$log_key" = "<absent>" ] || [ -z "$log_key" ]; then
    echo "<not-appended>"; return 0
  fi
  cmd="$(printf 'sed -n %q %q 2>/dev/null | grep -F %q | grep -F %q | tail -1\n' \
    "$((start + 1)),${end}p" "$(drv_applog "$inst")" '[announce-debug] sent ' "log=${log_key:0:12}... ")"
  out="$(printf '%s' "$cmd" | drv_exec "$inst" 2>/dev/null | tr -d '\r')"
  [ -n "$out" ] && echo "$out" || echo "<missing-after-write>"
}

# _rd_detector_window <inst> <start-line> <end-line> <harness-a> <harness-b>
# Return only detector/repair evidence for this failed leg's exact log window.
_rd_detector_window() {
  local inst="$1" start="$2" end="$3" h1="$4" h2="$5" cmd
  case "$start:$end" in *[!0-9:]*|:*|*:) return 2 ;; esac
  cmd="$(printf 'sed -n %q %q 2>/dev/null | grep -E %q | grep -E %q || true\n' \
    "$((start + 1)),${end}p" "$(drv_applog "$inst")" \
    'replication_stalled|replication_frozen|repair-on-detect' \
    "harness=(${h1}|${h2})(-pot)?[[:space:]]")"
  printf '%s' "$cmd" | drv_exec "$inst" 2>/dev/null | tr -d '\r'
}

# _rd_project_receiver_liveness <harness> <log-key>
# Read dev:dogfood_substrate_status JSON on stdin and emit ONE compact row for
# the exact receiver harness + writer log. Keep the projection on the driver so
# a remote ptool failure cannot execute caller-controlled data as shell source.
_rd_project_receiver_liveness() {
  local target_harness="$1" target_log="$2"
  node -e '
    const fs = require("node:fs");
    const harnessSlug = process.argv[1];
    const requestedLogKey = process.argv[2];
    const emit = (value) => process.stdout.write(JSON.stringify(value));
    try {
      const status = JSON.parse(fs.readFileSync(0, "utf8"));
      const groups = Array.isArray(status?.replicationLiveness)
        ? status.replicationLiveness
        : [];
      const group = groups.find((row) => row?.harnessSlug === harnessSlug);
      if (!group) {
        emit({ status: "harness-missing", harnessSlug, logKey: requestedLogKey });
        process.exit(0);
      }
      const logs = Array.isArray(group.logs) ? group.logs : [];
      const log = logs.find((row) => row?.keyHex === requestedLogKey);
      if (!log) {
        emit({ status: "log-missing", harnessSlug, logKey: requestedLogKey });
        process.exit(0);
      }
      emit({
        status: "found",
        harnessSlug,
        logKey: log.keyHex,
        verdict: log.verdict ?? null,
        knownLength: log.knownLength ?? null,
        localLength: log.localLength ?? null,
        mergedPosition: log.mergedPosition ?? null,
        peersCount: log.peersCount ?? null,
        mergeQueueIndex: log.mergeQueueIndex ?? null,
        mergeQueueHeadKeyHex: log.mergeQueueHeadKeyHex ?? null,
        msSinceMergeQueueHead: log.msSinceMergeQueueHead ?? null,
      });
    } catch {
      emit({ status: "parse-error", harnessSlug, logKey: requestedLogKey });
    }
  ' "$target_harness" "$target_log"
}

# _rd_receiver_liveness_snapshot <receiver-frame> <receiver-harness> <writer-log-key>
# Invoke the RECEIVER'S packaged ptool under the same pcusp/HONO context as the
# sidecar, then project only the exact log locally. Best-effort diagnostic: an
# unavailable read is explicit JSON and never changes the scenario verdict.
_rd_receiver_liveness_snapshot() {
  local inst="$1" harness="$2" log_key="$3" sidecar_dir raw rc
  case "$log_key" in
    ''|'<absent>'|'<none>')
      echo '{"status":"log-key-unavailable"}'
      return 0
      ;;
  esac
  sidecar_dir="$(dirname "$(drv_appbundle "$inst")")"
  raw="$({
    printf 'sidecar_dir=%q\n' "$sidecar_dir"
    printf 'workspace=%q\n' "${RIG_WORKSPACE_ID:-unknown}"
    printf 'harness=%q\n' "$harness"
    cat <<'PCUSP'
node_bin="$sidecar_dir/bin/node"
ptool_cli="$sidecar_dir/scripts/ptool.mjs"
[ -x "$node_bin" ] && [ -f "$ptool_cli" ] || exit 41
printf '{}\n' | "$node_bin" "$ptool_cli" dev:dogfood_substrate_status \
  --url="http://127.0.0.1:$HONO" \
  --workspace="$workspace" --harness="$harness" --json - --raw
PCUSP
  } | rig_pcusp_run "$inst" 2>/dev/null)"
  rc=$?
  if [ "$rc" != 0 ] || [ -z "$raw" ]; then
    echo '{"status":"unavailable","reason":"packaged-ptool-call-failed"}'
    return 0
  fi
  if ! printf '%s' "$raw" | _rd_project_receiver_liveness "$harness" "$log_key"; then
    echo '{"status":"unavailable","reason":"projection-failed"}'
  fi
}

# _rd_emit_failed_leg_diagnostics <cycle> <leg> <writer> <receiver> <fid>
#   <writer-start> <owner-start> <member-start> <owner> <member> <oslug> <mslug>
# Emits one machine-readable verdict per FAILED LEG. b8-replication-soak.sh uses
# these verdicts instead of grepping cumulative serve.log, so an earlier cycle's
# detector fire can never false-pass a later blind failure.
_rd_emit_failed_leg_diagnostics() {
  local cycle="$1" leg="$2" writer="$3" receiver="$4" fid="$5" writer_start="$6"
  local owner_start="$7" member_start="$8" owner="$9" member="${10}" h1="${11}" h2="${12}"
  local owner_end member_end actual outbox outbox_id outbox_slug outbox_drained outbox_log high
  local receiver_harness receiver_snapshot frame start end evidence stalls repairs detector_total=0 measurable=1

  owner_end="$(_rd_log_line_mark "$owner")" || owner_end="?"
  member_end="$(_rd_log_line_mark "$member")" || member_end="?"
  actual="$(_rd_actual_rows "$receiver" "$fid")"
  outbox="$(_rd_writer_outbox_row "$writer" "$fid")"
  if [ "$outbox" = "<absent>" ]; then
    outbox_id="<absent>"; outbox_slug="<absent>"; outbox_drained="N"; outbox_log="<absent>"
  else
    IFS='|' read -r outbox_id outbox_slug outbox_drained outbox_log <<<"$outbox"
  fi
  high="$(_rd_writer_log_high_water "$writer" "$writer_start" \
    "$([ "$writer" = "$owner" ] && echo "$owner_end" || echo "$member_end")" "$outbox_log")"
  echo "  ⚙ failed-leg row/outbox/high-water cycle=$cycle leg=$leg fid=$fid receiver=$receiver actual_rows=$actual writer=$writer writer_outbox=id=$outbox_id,harness=$outbox_slug,drained=$outbox_drained,log=$outbox_log writer_announce=$high"

  if [ "$receiver" = "$owner" ]; then receiver_harness="$h1"
  elif [ "$receiver" = "$member" ]; then receiver_harness="$h2"
  else receiver_harness="<unknown>"
  fi
  receiver_snapshot="$(_rd_receiver_liveness_snapshot "$receiver" "$receiver_harness" "$outbox_log")"
  echo "  ⚙ RECEIVER-LIVENESS-SNAPSHOT cycle=$cycle leg=$leg receiver=$receiver harness=$receiver_harness log=$outbox_log snapshot=$receiver_snapshot"

  for frame in "$owner" "$member"; do
    if [ "$frame" = "$owner" ]; then start="$owner_start"; end="$owner_end"; else start="$member_start"; end="$member_end"; fi
    if evidence="$(_rd_detector_window "$frame" "$start" "$end" "$h1" "$h2")"; then
      stalls="$(printf '%s\n' "$evidence" | grep -cE 'replication_stalled|replication_frozen')"
      repairs="$(printf '%s\n' "$evidence" | grep -c 'repair-on-detect')"
      detector_total=$((detector_total + stalls))
      echo "  ⚙ DETECTOR-CYCLE-WINDOW cycle=$cycle leg=$leg frame=$frame lines=$start-$end detector_events=$stalls repair_events=$repairs"
      [ -z "$evidence" ] || printf '%s\n' "$evidence" | sed 's/^/       /'
    else
      measurable=0
      echo "  ⚙ DETECTOR-CYCLE-WINDOW cycle=$cycle leg=$leg frame=$frame lines=$start-$end detector_events=? repair_events=?"
    fi
  done
  if [ "$measurable" != 1 ]; then
    echo "  ⚙ DETECTOR-CYCLE-VERDICT cycle=$cycle leg=$leg detector_events=? result=inconclusive"
  elif [ "$detector_total" = 0 ]; then
    echo "  ⚙ DETECTOR-CYCLE-VERDICT cycle=$cycle leg=$leg detector_events=0 result=blind"
  else
    echo "  ⚙ DETECTOR-CYCLE-VERDICT cycle=$cycle leg=$leg detector_events=$detector_total result=observed"
  fi
}

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
  # WI-5772: mark that order 80 was genuinely INVOKED this session, unconditionally
  # and before any possible early-return below — so the settle-barrier (order 82)
  # can tell "order 80 never ran" (RD_LAST_RAN_AT unset) apart from "order 80 ran
  # but failed/bailed before reaching its final canary write" (RD_LAST_RAN_AT set,
  # RD_LAST_CANARY_FID/MEMBER/WRITE_TS still unset). Previously both looked
  # identical to the barrier (all four vars unset), so a genuine mid-run FAILURE
  # was misreported by the barrier as "didn't run this session" — PASS.
  RD_LAST_RAN_AT="$(date +%s)"

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
# directions, within a stated SLA — plus a negative detector-assert: on a soak
# whose probes ALL passed, the replication-liveness detector must not have left
# an UNRECOVERED stall for this soak's own harness inside this soak's own window
# (WI-5715, 2026-07-25 — see the long note on that assert below). Stalls that
# recover are expected: the scenario cold-restarts sidecars 5 times by design.
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

  # ── WI-5715 (2026-07-25): detector-window marks ──────────────────────────────
  # The negative detector-assert below must only see events THIS soak produced.
  # serve.log is cumulative across the whole matrix pass, and the scenarios that
  # run before us (restart_durability@80, reconnect_catchup@85) legitimately kill
  # frames on the SAME harness slugs — their stall events were being counted
  # against us. Record each frame's serve.log line count now; the assert reads
  # only lines after this mark. (A line offset, not a timestamp: serve.log lines
  # are not uniformly timestamped, and the offset is exact.)
  local -A logmark=()
  local frame
  for frame in "$OWNER" "$MEMBER"; do
    logmark[$frame]="$(printf '%s\n' "wc -l < $(printf %q "$(drv_applog "$frame")") 2>/dev/null || echo 0" \
      | drv_exec "$frame" 2>/dev/null | tail -1 | tr -d '[:space:]')"
    case "${logmark[$frame]:-}" in ''|*[!0-9]*) logmark[$frame]=0 ;; esac
  done
  echo "  ⚙ detector window opens at serve.log line — '$OWNER': ${logmark[$OWNER]}  '$MEMBER': ${logmark[$MEMBER]}"

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
    local -A legmark=()
    for frame in "$OWNER" "$MEMBER"; do
      legmark[$frame]="$(_rd_log_line_mark "$frame")" || legmark[$frame]="?"
    done
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
      _rd_emit_failed_leg_diagnostics "$i" "A-to-B" "$OWNER" "$MEMBER" "$fid_am" \
        "${legmark[$OWNER]}" "${legmark[$OWNER]}" "${legmark[$MEMBER]}" \
        "$OWNER" "$MEMBER" "$oslug" "$mslug"
      rc=1
    fi

    # Leg B: member → owner (the reverse direction P-059 also lost).
    local fid_ma="F-RLSOAK-${ts}-${i}-MA"
    for frame in "$OWNER" "$MEMBER"; do
      legmark[$frame]="$(_rd_log_line_mark "$frame")" || legmark[$frame]="?"
    done
    t0="$(date +%s)"
    rig_write_content "$MEMBER" "$mslug" "$fid_ma" "replication soak c$i member→owner" todo >/dev/null
    if _rd_poll_remote "$OWNER" "$fid_ma" "$tries" >/dev/null; then
      t1="$(date +%s)"
      echo "  ✓ cycle $i B→A: $fid_ma landed on owner in $((t1 - t0))s (SLA ${sla_s}s)"
    else
      load_o="$(_rd_remote_loadavg "$OWNER")"; load_m="$(_rd_remote_loadavg "$MEMBER")"
      psi_o="$(_rd_remote_cpu_pressure "$OWNER")"; psi_m="$(_rd_remote_cpu_pressure "$MEMBER")"
      echo "  ✗ cycle $i B→A FAIL: $fid_ma did not land on owner within ${sla_s}s — replication NOT re-established (WI-183 class) — loadavg at failure: '$OWNER'=$load_o '$MEMBER'=$load_m — cpu.pressure (frame-scoped): '$OWNER'=$psi_o '$MEMBER'=$psi_m"
      _rd_emit_failed_leg_diagnostics "$i" "B-to-A" "$MEMBER" "$OWNER" "$fid_ma" \
        "${legmark[$MEMBER]}" "${legmark[$OWNER]}" "${legmark[$MEMBER]}" \
        "$OWNER" "$MEMBER" "$oslug" "$mslug"
      rc=1
    fi
  done

  # ── Negative detector-assert (WI-5715, rewritten 2026-07-25) ─────────────────
  # Only runs when every probe leg passed (rc=0), so replication is DEMONSTRABLY
  # working; its sole job is catching the detector CRYING WOLF. It skips entirely
  # on a red soak — the detector firing there is expected and already scored by
  # the fire-path pin in lib/scenarios/b8-replication-soak.sh.
  #
  # It used to be `grep -c 'replication_stalled|replication_frozen' serve.log`:
  # unscoped by harness, unscoped in time, and blind to recovery. That assert
  # could never pass, which is why P-402 first-green was never once reached (the
  # ENTIRE history of this gate, per BRIEF-p2p-release-verify-2026-07-25):
  #   1. NOT TIME-SCOPED — serve.log is cumulative over the whole matrix pass, so
  #      restart_durability@80 / reconnect_catchup@85, which legitimately kill
  #      frames, charged their stalls to us. Fixed by the logmark window above.
  #   2. NOT HARNESS-SCOPED — the same false-positive class WI-5665 already fixed
  #      for the fire-path pin (which scopes to oslug/mslug), never applied here.
  #   3. BLIND TO RECOVERY — the real bug. This scenario COLD-RESTARTS a sidecar
  #      5 times by design. A restart legitimately produces a ~15s
  #      connected-but-no-replicator window; the detector fires (correctly — that
  #      IS the WI-183 zombie-connection class it exists to catch), self-repair
  #      re-attaches the replica session, and the log records `recovered … after
  #      16s`. Scoring that as "noise" asserts the detector must stay silent
  #      during the exact event it was built to detect, and directly contradicts
  #      the fire-path pin's assert that it MUST fire. Evidence (run 143908,
  #      banked triage serve-{a,b}-151804.log): every one of the 13 stall events
  #      is followed by `repair-on-detect: re-attached replica session` for the
  #      same log, and all 10 probe legs landed in 3-4s (SLA 90s).
  #
  # So a stall is NOISE only if it NEVER RECOVERED: a detector claiming a log is
  # dead, with no re-attach/recovery, while this soak's probes crossed fine. That
  # keeps the true signal (WI-183: connected, silently never replicating again)
  # and stops failing on detect→repair→recover, which is the system working.
  if [ "$rc" = 0 ]; then
    local _rl_noise_awk det total
    # Per (harness,log): count stalls, zero the counter on a recovery/re-attach.
    # Anything still >0 at EOF stalled and never came back.
    read -r -d '' _rl_noise_awk <<'RL_AWK_EOF' || true
NR <= start { next }
{
  if (!match($0, /log=[0-9a-f]+/)) next
  id = substr($0, RSTART + 4, RLENGTH - 4)
  # Keyed by LOG, and RECOVERY IS EVALUATED HARNESS-AGNOSTICALLY — deliberately.
  # One hypercore is reported under BOTH the harness and its -pot sibling label,
  # so a stall logged as harness=X and the re-attach for the SAME log logged as
  # harness=X-pot are one log recovering. Applying the harness filter to recovery
  # lines too would drop that clear and strand the stall as "unrecovered" forever
  # — reintroducing the exact false-positive class this assert exists to remove.
  # This is not theoretical: banked stamp 115441 has stall harness=hello-world
  # log=9da47acbbd86 whose re-attach is logged under harness=hello-world-pot, and
  # in production oslug==mslug=="hello-world" (both frames join the same member
  # slug), so the -pot recovery would have been filtered out. A recovery for a
  # log always resolves that log; only STALLS are scoped to the soak's harness.
  if ($0 ~ /re-attached replica session/ || $0 ~ /\] recovered \(/) { pend[id] = 0; next }
  if ($0 !~ /replication_stalled|replication_frozen/) next
  if (!match($0, /harness=[A-Za-z0-9_.-]+/)) next
  hs = substr($0, RSTART + 8, RLENGTH - 8)
  if (hs != h1 && hs != h2) next
  pend[id]++; where[id] = hs
}
END {
  n = 0
  for (id in pend) if (pend[id] > 0) {
    n += pend[id]
    printf "UNRECOVERED %s log=%s x%d\n", where[id], id, pend[id]
  }
  printf "UNRECOVERED_TOTAL=%d\n", n
}
RL_AWK_EOF
    for frame in "$OWNER" "$MEMBER"; do
      # $(drv_applog "$frame") resolves LOCALLY to the frame's app-log path
      # (/home/pcusp/serve.log on the rig driver); the awk runs remotely.
      det="$(printf 'awk -v start=%q -v h1=%q -v h2=%q %q %q 2>/dev/null; true\n' \
              "${logmark[$frame]:-0}" "$oslug" "$mslug" "$_rl_noise_awk" "$(drv_applog "$frame")" \
            | drv_exec "$frame" 2>/dev/null)"
      total="$(printf '%s\n' "$det" | sed -n 's/^UNRECOVERED_TOTAL=//p' | tail -1 | tr -d '[:space:]')"
      # A probe that could not RUN must never read as clean. The old grep -c
      # returned "" on a missing/failed remote command and "" is falsy here, so
      # any breakage (no awk on the frame, unreadable serve.log, ssh hiccup)
      # would have silently scored the assert GREEN. "Couldn't measure" is a
      # FAILURE, not a pass — the one discipline this whole lane turns on.
      if [ -z "${total:-}" ]; then
        echo "  ✗ detector-assert INCONCLUSIVE on frame '$frame': the remote probe returned no UNRECOVERED_TOTAL line (awk missing, serve.log unreadable, or exec failed) — scoring FAIL, because an unmeasurable assert is not a passing assert. Raw: $(printf '%s' "$det" | head -3 | tr '\n' '|')"
        rc=1
      elif [ "$total" != "0" ]; then
        echo "  ✗ detector-noise: frame '$frame' logged $total UNRECOVERED replication stall event(s) for this soak's own harness ($oslug/$mslug), inside its own window, while every probe passed — a genuine detector false-positive:"
        printf '%s\n' "$det" | grep '^UNRECOVERED ' | sed 's/^/       /'
        rc=1
      else
        echo "  ✓ detector clean on frame '$frame' — no unrecovered stall for $oslug/$mslug in this soak's window (detect→repair→recover cycles are expected during 5 cold restarts and do not count as noise)"
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
