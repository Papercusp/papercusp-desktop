#!/usr/bin/env bash
# deb-hetzner-coord-controlplane.sh — Brief 7 LIVE scenario: which coordination
# CONTROL-PLANE flows cross machines (federated) vs stay LOCAL to one operator.
#
# federation-release-hardening-relaunch-2026-07-01 P-007 / WI-1333.
#
# WHY: content/feature/plan/coord-DATA federation is already proven live. Brief 7
# asks the DIFFERENT question the owner raised — for a 2-machine hive, WHICH
# coordination flows actually work cross-machine? The code read (coord-ops +
# hyperbee substrate + the SQL capture triggers) gives this boundary:
#
#   FEDERATED — rides the per-harness Hyperbee peer-log:
#     • coord_event_log rows on surfaces {messages, handoffs, escalations} — BUT
#       ONLY when harness-scoped (harness_slug NOT NULL), non-fanout, origin=local
#       (capture trigger 150-coord-event-log-federation.sql:81-84). A row written
#       origin='local' on A arrives origin='remote' on B via the peer-log + the
#       coord-message projection.
#       ⚠ P-013 COMMS-TIER GATE (cross-machine-coord-parity-and-trust-2026-07-01,
#       receiver-side, coord-message.ts): the VERIFIED author resolves to a comms
#       tier (local override → owner-signed policy default → fallback 'message').
#       Below 'message' ⇒ the row QUARANTINES (coord_quarantine — visible +
#       grantable, never dropped); a HANDOFF below 'steer' likewise. There is NO
#       owner special-case — steer is a per-user LOCAL grant that never federates,
#       so even the hive owner's handoff quarantines until the member grants it.
#       The scenario probes BOTH legs: ungranted → quarantine; steer-granted →
#       applies.
#     • coord_conversations / coord_threads / coord_thread_posts (the ask rail).
#     • plan_item_assignments (durable assignment). NOT plan_item_claims (the
#       LEASED claim is authority-mediated, never federated).
#     • shared_presence — federated by a SEPARATE presence ANNOUNCE loop
#       (wire-presence.ts → presence-announce.ts → handle.append; 5s cadence), NOT
#       a CDC trigger. This is why coord:presence at scope=workspace/all DOES see
#       peers' sessions (presence-snapshot merges local coord_presence + federated
#       shared_presence as synthetic fed:<gh>@<machine> rows).
#
#   LOCAL-ONLY — never crosses machines (per-machine PG / in-process):
#     • coord_presence (the RAW per-session roster — distinct from shared_presence).
#     • coord_watermarks (per-agent read cursor).
#     • event_awaits (the events:await store, mig 163; the old coord_subscriptions
#       table was DROPPED in mig 127) & the pump — an events:emit on A CANNOT fire
#       an events:await registered on B (engine.ts over local org PG).
#     • plan_item_claims (leased claim), inbox fan-out delivery copies (each
#       machine regenerates deliveries from its OWN subscriptions).
#
#   WAKE (coord:send wake:'required' A→B) — a TWO-HOP, works iff harness-scoped:
#     (1) the send-side wake fires only A's LOCAL await store → woken:0 for a
#         B-homed recipient; but (2) the wake INTENT (body.wake) rides the
#         FEDERATED message row, and B's OWN coord-message projection re-fires the
#         wake locally on the origin='remote' insert (coord-message.ts:172-191,
#         EI-279). The re-invocation channel (PTY inject / psu socket / --resume)
#         is always local to B's box. No wake ever crosses the wire directly.
#
#   GAP (Brief 7 asks to file what SHOULD federate but doesn't): coord:handoff and
#   coord:escalate use the federation-CAPABLE {handoffs,escalations} surfaces but
#   do NOT stamp harness_slug (handoffs.ts / escalations.ts), so as-written they
#   stay workspace-scope → harness_slug NULL → LOCAL. A cross-machine fleet can't
#   hand off / escalate across machines until those tools stamp the harness scope.
#
# This scenario PROVES the data-layer boundary live over two real Hetzner machines:
#   POSITIVE (must FEDERATE): a harness-scoped coord message / escalation / handoff
#            row written on A arrives origin='remote' on B (the wire is capable);
#            a fed: presence row for A shows up in B's shared_presence.
#   NEGATIVE (must stay LOCAL): coord_presence (raw), coord_watermarks, and an
#            event_awaits (await) row written on A must NEVER appear on B —
#            each probe first proves its row LANDED on A (non-vacuousness guard).
#   BASELINE: a content feature federates A→B (so a NEGATIVE means "not federated",
#            not "wire down").
#
# ── DUAL MODE (the Brief-13 registry contract, same as deb-hetzner-restart.sh) ──
#   1. SOURCED: the matrix (bin/deb-hetzner-matrix.sh) provisions a(owner)+b(member)
#      ONCE, joins them to one hive, then `source`s this file (via
#      bin/lib/scenarios/b7-coord-controlplane.sh) and calls
#      `scenario_coord_controlplane a b` against those SHARED frames. Sourcing only
#      DEFINES the function + the _ctrl_* helpers — it provisions/tears down NOTHING
#      (the run-if-main guard).
#   2. STANDALONE: run directly — `bash deb-hetzner-coord-controlplane.sh --deb=PATH`
#      — full rig_init → install-exit-trap (auto-destroy, servers=0) → provision →
#      setup → publish → join → scenario. NOTE the historical standalone exit
#      contract is preserved: provisioning failures exit 1-6, but after the probes it
#      ALWAYS exits 0 (the matrix verdict is printed, not encoded) — the scenario
#      function's return code (0 = all flows matched, 1 = divergence) is what the
#      matrix runner scores.
#
# COST-SAFETY: identical to deb-hetzner-federation.sh — every provisioned server id
# is recorded BEFORE install, and the EXIT trap (rig_install_exit_trap → rig_cleanup)
# DELETEs every recorded id + confirms 404. 2 frames → fits the ~2-server quota.
# ⚠ Coordinate on the Hetzner-quota serialization lock (WI-1367) before running so
# two live rigs don't collide on the quota. Verify `servers = 0` after the run.
#
# Env / creds (same as deb-hetzner-federation.sh):
#   HCLOUD_TOKEN / HETZNER_SSH_KEY_ID / HETZNER_SSH_IDENTITY
#   gh auth: papercupai (owner=a) + aviynw (member=b)
#
# Usage: bin/deb-hetzner-coord-controlplane.sh [--locs=ash,ash] [--type=cpx31] [--deb=PATH] [--keep-up]
set -uo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/scripts/linux-test-vm/lib/common.sh"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"
source "$DESKTOP_DIR/bin/lib/deb-hetzner-rig.sh"
set +e   # this driver owns its own exit codes (the probes report the matrix)
set +u   # the FED_*/FRAME_* assoc arrays are nounset-hostile

# ── scenario-local helpers (prefixed _ctrl_ so co-sourced scenario files don't clash) ─

# coord DATA-plane probe (surface-parameterized fed_coord_merge_probe):
# _ctrl_coord_probe <src> <dst> <sslug> <surface> <tag> [tries] — insert a
# HARNESS-SCOPED coord_event_log row origin='local' on <src> for a given <surface>
# so the mig-150 capture trigger federates it (harness_slug=member slug satisfies
# the WHEN gate); poll <dst> for the same msg_id at origin='remote'. → "1"/"0".
_ctrl_coord_probe() {
  local src="$1" dst="$2" sslug="$3" surface="$4" tag="$5" tries="${6:-30}" i row mid ws
  mid="CTRL-${surface}-${tag}-$(date +%s)"
  # D-050 / WI-5399 iteration 2: rig_resolve_ws (pot_home_slug scoping) — works on
  # owner AND joiner, unlike origin='local'. See its definition for the mechanism.
  ws="$(rig_resolve_ws "$src")" || { echo 0; return 1; }
  drv_psql "$src" "INSERT INTO harness_shared.coord_event_log (workspace_id,surface,writer_key,msg_id,body,harness_slug,origin) VALUES ('$ws','$surface','ctrl-probe','$mid','{\"kind\":\"$surface\",\"text\":\"control-plane $surface probe\"}'::jsonb,'$sslug','local');" >/dev/null
  for i in $(seq 1 "$tries"); do
    row="$(drv_psql "$dst" "SELECT msg_id FROM harness_shared.coord_event_log WHERE msg_id='$mid' AND origin='remote' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$row" ] && { echo 1; return 0; }
    sleep 3
  done
  echo 0; return 1
}

# P-013 comms-tier gate (cross-machine-coord-parity-and-trust-2026-07-01): an
# UNGRANTED author's handoff must cross the wire but land QUARANTINED on <dst>
# (coord_quarantine, reason='handoff-below-steer') — visible + grantable, never
# silently dropped and never applied. The author resolves to the conservative
# 'message' tier (attestation → no local override → no policy default →
# FALLBACK_COMMS_TIER), and handoffs need 'steer'.
# _ctrl_handoff_ungranted_probe <src> <dst> <sslug> <tag> [tries] — insert the
# handoff on <src>; poll <dst>. Echoes "1 <author_github_user_id>" on quarantine,
# "2" if it APPLIED (gate did not fire), "0" if neither landed.
_ctrl_handoff_ungranted_probe() {
  local src="$1" dst="$2" sslug="$3" tag="$4" tries="${5:-30}" i mid q applied ws
  mid="CTRL-handoffs-${tag}-$(date +%s)"
  # D-050 / WI-5399 iteration 2: rig_resolve_ws (pot_home_slug scoping).
  ws="$(rig_resolve_ws "$src")" || { echo 0; return 1; }
  drv_psql "$src" "INSERT INTO harness_shared.coord_event_log (workspace_id,surface,writer_key,msg_id,body,harness_slug,origin) VALUES ('$ws','handoffs','ctrl-probe','$mid','{\"kind\":\"handoffs\",\"text\":\"control-plane handoffs probe (ungranted)\"}'::jsonb,'$sslug','local');" >/dev/null
  for i in $(seq 1 "$tries"); do
    q="$(drv_psql "$dst" "SELECT author_github_user_id FROM harness_shared.coord_quarantine WHERE msg_id='$mid' AND reason='handoff-below-steer' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$q" ] && { echo "1 $q"; return 0; }
    applied="$(drv_psql "$dst" "SELECT 1 FROM harness_shared.coord_event_log WHERE msg_id='$mid' AND origin='remote' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$applied" ] && { echo 2; return 1; }
    sleep 3
  done
  echo 0; return 1
}

# _ctrl_roster_empty <inst> — true (0) iff <inst>'s hive_members roster has NO rows
# (the WI-1378 no-restart symptom that drops every peer op). Mirrors _rv_roster_empty
# in deb-hetzner-revocation.sh — used as the baseline-miss diagnostic.
_ctrl_roster_empty() {
  local n; n="$(drv_psql "$1" "SELECT count(*) FROM harness_shared.pot_members;" 2>/dev/null | tr -d '[:space:]')"
  [ "${n:-0}" = "0" ]
}

# matrix-report formatters
_ctrl_verdict() { [ "$1" = "$2" ] && echo "PASS" || echo "FAIL"; }
_ctrl_fmt() { [ "$1" = 1 ] && printf '%-11s' "$2" || printf '%-11s' "$3"; }

# ── the scenario (operates on already-provisioned+joined frames a=owner, b=member) ─
# Reads the rig globals FRAME_MEMBER_SLUG[a|b], FRAME_IP[*], FED_PG[*], FED_SC[*]
# (filled by rig_owner_publish_hive + rig_join_* + the boot waits). Returns 0 = every
# flow matched the code-derived expectation, 1 = at least one diverged. NON-INVASIVE
# on the happy path (the probes only INSERT throwaway timestamped rows) — EXCEPT a
# BASELINE first-poll miss, which triggers ONE adaptive MEMBER-sidecar restart
# re-fold + retry (the WI-1378 no-restart window; same pattern as
# deb-hetzner-revocation.sh STEP 1).
# NOTE: the FIRST baseline probe uses the FIXED feature_id F-CTRL-BASE, so the
# scenario is one-shot per provisioned rig — a re-run on the SAME frames would
# PK-collide the baseline row (the adaptive RETRY uses a fresh timestamped id).
# (Prose labels "A"/"B" assume the canonical `... a b` call.)
scenario_coord_controlplane() {
  local OWNER="${1:-a}" MEMBER="${2:-b}"
  local MEMBER_SLUG="${FRAME_MEMBER_SLUG[$OWNER]}"   # the owner-side slug the probes write under
  local disc probe_base base FBASE_RETRY p_msg p_esc p_ho p_hoq p_hoq_raw HO_AUTHOR WS_B NOWMS sp_rows sp_fed
  local PWS NTS PRES_OWNER WM_OWNER SUB_MID n_pres n_wm n_sub ALLPASS v

  echo "--- A [swarm]/drain diag ---"; drv_exec "$OWNER" <<<"grep -aE '\[swarm\]|joined topic|peer_connected|drain|federate' /home/pcusp/serve.log | tail -6"
  echo "--- B [swarm]/drain diag ---"; drv_exec "$MEMBER" <<<"grep -aE '\[swarm\]|joined topic|peer_connected|drain|federate' /home/pcusp/serve.log | tail -6"
  fed_log "wait swarm peer discovery over the PUBLIC DHT"
  disc="$(fed_wait_discovery "$OWNER" "$MEMBER" strict 70 || true)"
  case "$disc" in
    1)    echo "✓ sidecar data path proven across machines (bytes crossed)" ;;
    skip) echo "⊘ discovery SKIPPED — this build predates the peer_data_path_up emitter (N/A, not a failure; EI-18687938054040755). The LOCAL verdicts below stand on their own; the wire state is simply unmeasured." ;;
    *)    echo "⚠ no data path proven in ~210s (probes still run; a LOCAL verdict below could be a false negative if the wire never came up — read the BASELINE)" ;;
  esac

  # ── BASELINE: content feature federates A→B (proves the wire is live) ──────
  # ADAPTIVE (WI-1378, ported from deb-hetzner-revocation.sh STEP 1): on a fresh
  # 2-frame join the member's FIRST baseline poll often misses (the no-restart
  # window). A miss triggers ONE member-sidecar restart re-fold, a swarm re-peer
  # wait, then a retry write+poll under a NEW timestamped feature id. Only if the
  # RETRY also misses is the baseline called failed.
  fed_log "BASELINE content merge A→B (slug-agnostic hive probe)"
  probe_base="$(fed_hive_merge_probe "$OWNER" "$MEMBER" "$MEMBER_SLUG" F-CTRL-BASE 80 || true)"
  base=0; [ "${probe_base%% *}" = 1 ] && base=1
  if [ "$base" = 1 ]; then
    echo "✓ BASELINE: content federated A→B (wire live)"
  else
    if _ctrl_roster_empty "$MEMBER"; then
      echo "⚠ baseline miss on F-CTRL-BASE — $MEMBER roster EMPTY (the WI-1378 no-restart gap)"
    else
      echo "⚠ baseline miss on F-CTRL-BASE — $MEMBER roster non-empty; re-folding anyway (adaptive retry)"
    fi
    echo "↻ re-folding via MEMBER ($MEMBER) sidecar restart, then retrying baseline with a NEW feature id"
    rig_restart_sidecar "$MEMBER"
    if rig_wait_frame_ready "$MEMBER" 60; then
      rig_wait_swarm "$OWNER" "$MEMBER" 70 || echo "⚠ $OWNER↔$MEMBER did not re-peer (retry poll may still land)"
      FBASE_RETRY="F-CTRL-BASE-R$(date +%s)"
      probe_base="$(fed_hive_merge_probe "$OWNER" "$MEMBER" "$MEMBER_SLUG" "$FBASE_RETRY" 80 || true)"
      [ "${probe_base%% *}" = 1 ] && base=1
    else
      echo "✗ $MEMBER did not come back after the re-fold restart — baseline retry skipped"
    fi
    if [ "$base" = 1 ]; then
      echo "✓ BASELINE (post re-fold): content federated A→B via $FBASE_RETRY (wire live)"
    else
      echo "✗ BASELINE: content did NOT federate — a LOCAL verdict below may be a false negative (wire down)"
    fi
  fi

  # ── POSITIVE probes — the federation-CAPABLE surfaces must cross (harness-scoped)
  fed_log "CONTROL-PLANE POSITIVE probes (harness-scoped coord_event_log surfaces must federate A→B)"
  p_msg="$(_ctrl_coord_probe "$OWNER" "$MEMBER" "$MEMBER_SLUG" messages m1 60 || true)"
  [ "$p_msg" = 1 ] && echo "✓ coord MESSAGE (harness-scoped) federated A→B (origin=remote)" || echo "✗ coord MESSAGE did NOT federate A→B"
  p_esc="$(_ctrl_coord_probe "$OWNER" "$MEMBER" "$MEMBER_SLUG" escalations e1 60 || true)"
  [ "$p_esc" = 1 ] && echo "✓ coord ESCALATION surface (harness-scoped) federated A→B" || echo "✗ coord ESCALATION surface did NOT federate A→B"
  # ── handoffs: the P-013 comms-tier gate makes this TWO probes ──────────────
  # (h1) UNGRANTED author → the row crosses the wire but B QUARANTINES it
  #      (handoff-below-steer): the author resolves to the conservative 'message'
  #      tier and a handoff needs 'steer'. Applying would be the FAILURE.
  # (h2) B grants the author 'steer' (a LOCAL comms-trust override — the grant
  #      never federates, by design) → a fresh handoff must APPLY (origin=remote).
  # Rerun-safety: a PRIOR run's h2 steer grant persists in B's PG (comms_trust_list
  # is workspace-scoped, not hive-scoped — a hive re-publish does not clear it) and
  # would make the ungranted probe falsely APPLY. Drop our own marker rows first.
  drv_psql "$MEMBER" "DELETE FROM harness_shared.comms_trust_list WHERE note = 'ctrl-probe steer grant';" >/dev/null 2>&1
  p_hoq_raw="$(_ctrl_handoff_ungranted_probe "$OWNER" "$MEMBER" "$MEMBER_SLUG" h1 30 || true)"
  p_hoq=0; HO_AUTHOR=""
  case "$p_hoq_raw" in
    "1 "*) p_hoq=1; HO_AUTHOR="${p_hoq_raw#1 }"
           echo "✓ coord HANDOFF (ungranted author) crossed the wire and QUARANTINED on B (handoff-below-steer, author gh=$HO_AUTHOR)" ;;
    2)     echo "✗ coord HANDOFF from an UNGRANTED author APPLIED on B — the P-013 steer gate did not fire" ;;
    *)     echo "✗ coord HANDOFF (ungranted) neither quarantined nor applied on B — wire or capture problem" ;;
  esac
  p_ho=0
  if [ "$p_hoq" = 1 ]; then
    # D-050 / WI-5399 iteration 2: rig_resolve_ws (pot_home_slug scoping) — $MEMBER
    # is the joiner here, where origin='local' structurally never matches.
    if WS_B="$(rig_resolve_ws "$MEMBER")"; then
      NOWMS="$(( $(date +%s) * 1000 ))"
      drv_psql "$MEMBER" "INSERT INTO harness_shared.comms_trust_list (workspace_id,trusted_github_user_id,tier,note,created_ts,updated_ts) VALUES ('$WS_B',$HO_AUTHOR,'steer','ctrl-probe steer grant',$NOWMS,$NOWMS) ON CONFLICT (workspace_id,trusted_github_user_id) DO UPDATE SET tier='steer', updated_ts=$NOWMS;" >/dev/null
      echo "  granted steer to gh=$HO_AUTHOR on B (local override) — waiting out the 30s tier cache (comms-tier-gate.ts CACHE_TTL_MS)"
      sleep 35
      p_ho="$(_ctrl_coord_probe "$OWNER" "$MEMBER" "$MEMBER_SLUG" handoffs h2 60 || true)"
      [ "$p_ho" = 1 ] && echo "✓ coord HANDOFF (steer-granted author) federated A→B and APPLIED (origin=remote)" || echo "✗ coord HANDOFF did NOT apply on B even after the steer grant"
    else
      echo "  ✗ could not resolve a real workspace_id on B — skipping steer grant (D-050/WI-5399 class)"
    fi
  else
    echo "  (skipping the steer-grant leg — no quarantine row to resolve the author id from)"
  fi
  echo "  NOTE: the coord:escalate/coord:handoff TOOLS do NOT stamp harness_slug (handoffs.ts/escalations.ts),"
  echo "  so despite the surface being federation-capable, the TOOL flows stay LOCAL as-written — the Brief 7 gap."

  # shared_presence (announce-loop federation) — does B see A's presence as a fed: row?
  # INFORMATIONAL: the announce loop publishes the operator's own sessions; a headless
  # sidecar may announce nothing, so this reports rather than hard-asserts.
  fed_log "SHARED-PRESENCE federation (announce loop) — does B's shared_presence carry a fed:* row from A?"
  sp_rows="$(drv_psql "$MEMBER" "SELECT count(*) FROM harness_shared.shared_presence;" 2>/dev/null | tr -d '[:space:]')"
  sp_fed="$(drv_psql "$MEMBER" "SELECT count(DISTINCT machine_label) FROM harness_shared.shared_presence;" 2>/dev/null | tr -d '[:space:]')"
  echo "  B shared_presence rows=${sp_rows:-?} (distinct machine_labels=${sp_fed:-?}) — ≥2 distinct machines ⇒ presence DOES cross machines (coord:presence merges these into the snapshot)."

  # ── NEGATIVE probes — RAW control state must stay LOCAL (never on B) ───────
  fed_log "CONTROL-PLANE NEGATIVE probes (raw presence/watermark/await must stay LOCAL to A)"
  # D-050 / WI-5399 iteration 2: rig_resolve_ws (pot_home_slug scoping).
  PWS="$(rig_resolve_ws "$OWNER")" || { echo "  ✗ could not resolve a real workspace_id on A — negative probes below may be unreliable (D-050/WI-5399 class)"; PWS="__unresolved__"; }
  NTS="$(date +%s)"

  # _ctrl_row_on_a <pred> — echoes 1 iff the probe row EXISTS on A. The
  # non-vacuousness guard (2026-07-03, WI-1510 residual): an absence-assert on B
  # proves NOTHING when the write on A silently failed (rig_assert_row_absent
  # swallows query errors, so even a dropped table "passes").
  _ctrl_row_on_a() { drv_psql "$OWNER" "SELECT 1 FROM $1 LIMIT 1;" 2>/dev/null | tr -d '[:space:]'; }

  # coord_presence: the RAW per-session roster (distinct from shared_presence). Table-local.
  PRES_OWNER="ctrl-presence-$NTS"
  drv_psql "$OWNER" "INSERT INTO harness_shared.coord_presence (owner_id,owner_label,workspace_id,source,intent) VALUES ('$PRES_OWNER','ctrl','$PWS','ctrl-probe','control-plane presence probe');" >/dev/null
  if [ "$(_ctrl_row_on_a "harness_shared.coord_presence WHERE owner_id='$PRES_OWNER'")" != 1 ]; then
    n_pres=0; echo "✗ PRESENCE probe row never landed on A (schema drift?) — refusing a vacuous verdict"
  else
    n_pres="$(rig_assert_row_absent "$MEMBER" "harness_shared.coord_presence WHERE owner_id='$PRES_OWNER'" 18 || true)"
    [ "$n_pres" = 1 ] && echo "✓ coord_presence (raw) stayed LOCAL to A — cross-machine visibility comes via shared_presence, not this table" || echo "✗ coord_presence leaked to B (unexpected)"
  fi

  # coord_watermarks: per-agent read cursor. Local-only by design.
  WM_OWNER="ctrl-wm-$NTS"
  drv_psql "$OWNER" "INSERT INTO harness_shared.coord_watermarks (workspace_id,owner_id,surfaces) VALUES ('$PWS','$WM_OWNER','{\"messages\":\"$NTS\"}'::jsonb);" >/dev/null
  if [ "$(_ctrl_row_on_a "harness_shared.coord_watermarks WHERE owner_id='$WM_OWNER'")" != 1 ]; then
    n_wm=0; echo "✗ WATERMARK probe row never landed on A (schema drift?) — refusing a vacuous verdict"
  else
    n_wm="$(rig_assert_row_absent "$MEMBER" "harness_shared.coord_watermarks WHERE owner_id='$WM_OWNER'" 18 || true)"
    [ "$n_wm" = 1 ] && echo "✓ WATERMARK stayed LOCAL to A — read cursors are per-machine" || echo "✗ WATERMARK leaked to B (unexpected)"
  fi

  # event_awaits: the events:await registry (harness_shared.event_awaits, mig 163)
  # ⇒ emit@A cannot fire await@B. The pre-2026-07-03 probe INSERTed into
  # coord_subscriptions — DROPPED in mig 127 — so the INSERT errored and the
  # absence-assert "passed" against a nonexistent table: a VACUOUS verdict
  # (WI-1510 residual). Class fix: every negative probe must prove its row
  # LANDED on A before asserting absence on B (_ctrl_row_on_a below).
  SUB_KEY="ctrl:await:$NTS"
  drv_psql "$OWNER" "INSERT INTO harness_shared.event_awaits (workspace_id,subscriber_id,event_key,policy,note,expires_ts) VALUES ('$PWS','ctrl-await','$SUB_KEY','notify','control-plane negative probe',now() + interval '15 minutes');" >/dev/null
  if [ "$(_ctrl_row_on_a "harness_shared.event_awaits WHERE event_key='$SUB_KEY'")" != 1 ]; then
    n_sub=0
    echo "✗ AWAIT probe row never landed on A (schema drift?) — refusing a vacuous verdict"
  else
    n_sub="$(rig_assert_row_absent "$MEMBER" "harness_shared.event_awaits WHERE event_key='$SUB_KEY'" 18 || true)"
    [ "$n_sub" = 1 ] && echo "✓ AWAIT-SUBSCRIPTION (event_awaits) stayed LOCAL to A — emit@A cannot fire await@B" || echo "✗ AWAIT-SUBSCRIPTION leaked to B (unexpected)"
  fi

  # ── MATRIX report ────────────────────────────────────────────────────────
  fed_log "BRIEF 7 COORD CONTROL-PLANE MATRIX (live, 2 machines)"
  cat <<MATRIX
  flow                          expected     live-result   verdict
  ----------------------------  -----------  -----------   -------
  baseline content A→B          FEDERATED    $(_ctrl_fmt "$base" FEDERATED 'not-fed')  $(_ctrl_verdict "$base" 1)
  coord message (hscoped)       FEDERATED    $(_ctrl_fmt "$p_msg" FEDERATED LOCAL)  $(_ctrl_verdict "$p_msg" 1)
  escalation surface (hscoped)  FEDERATED    $(_ctrl_fmt "$p_esc" FEDERATED LOCAL)  $(_ctrl_verdict "$p_esc" 1)
  handoff, ungranted author     QUARANTINE   $(_ctrl_fmt "$p_hoq" QUARANTINE other)  $(_ctrl_verdict "$p_hoq" 1)
  handoff, steer-granted        FEDERATED    $(_ctrl_fmt "$p_ho" FEDERATED LOCAL)  $(_ctrl_verdict "$p_ho" 1)
  coord_presence (raw roster)   LOCAL-ONLY   $(_ctrl_fmt "$n_pres" LOCAL FEDERATED)  $(_ctrl_verdict "$n_pres" 1)
  watermark (read cursor)       LOCAL-ONLY   $(_ctrl_fmt "$n_wm" LOCAL FEDERATED)  $(_ctrl_verdict "$n_wm" 1)
  await subscription            LOCAL-ONLY   $(_ctrl_fmt "$n_sub" LOCAL FEDERATED)  $(_ctrl_verdict "$n_sub" 1)
  shared_presence on B          (informational) fed-rows=${sp_fed:-?} / total=${sp_rows:-?}

  READING THE MATRIX (code-derived, confirmed by the probes):
  • coord:send / message DATA  → FEDERATED when harness-scoped (workspace-scope stays LOCAL).
  • coord:send WAKE (A→B)      → WORKS as a two-hop: the wake intent rides the federated
                                 message row; B's own operator re-fires the local wake
                                 (coord-message.ts:172-191). Only for harness-scoped sends.
  • coord:presence             → FEDERATED (merges local coord_presence + federated
                                 shared_presence → sees peers as fed:<gh>@<machine>).
  • fleet:assignments          → MIXED: assignment/work-queue legs FEDERATE; the live-
                                 presence + leased-claim legs are LOCAL.
  • events:emit → events:await → LOCAL-ONLY (emit@A cannot fire await@B).
  • coord:handoff / escalate   → GAP: federation-capable surface, but the tools don't stamp
                                 harness_slug → LOCAL as-written. FILE A FIX.
  • handoff trust boundary     → a handoff row APPLIES on the receiver only from a
                                 'steer'-granted author (P-013); ungranted authors'
                                 handoffs quarantine (visible + grantable) — even the
                                 hive owner's, until the member grants steer locally.
  • watermarks / inbox fan-out → LOCAL-ONLY by design (per-machine).
MATRIX

  ALLPASS=1
  for v in "$base:1" "$p_msg:1" "$p_esc:1" "$p_hoq:1" "$p_ho:1" "$n_pres:1" "$n_wm:1" "$n_sub:1"; do
    [ "${v%%:*}" = "${v##*:}" ] || ALLPASS=0
  done
  if [ "$ALLPASS" = 1 ]; then
    echo "✅ BRIEF 7 MATRIX: all data-layer flows matched the code-derived expectation"
    return 0
  fi
  echo "⚠ BRIEF 7 MATRIX: at least one flow diverged from expectation — inspect above"
  return 1
}

# ── STANDALONE entrypoint (deb-hetzner-<scenario>.sh registry contract) — only when run directly ──
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  # ── args / config ─────────────────────────────────────────────────────────────
  LOCS="ash,ash"; STYPE="cpx31"; DEB=""; KEEP_UP=0; IMAGE="ubuntu-24.04"
  for arg in "$@"; do case "$arg" in
    --locs=*) LOCS="${arg#--locs=}" ;;
    --type=*) STYPE="${arg#--type=}" ;;
    --deb=*)  DEB="${arg#--deb=}" ;;
    --image=*) IMAGE="${arg#--image=}" ;;
    --keep-up) KEEP_UP=1 ;;
    -h|--help) sed -n '2,83p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown arg: $arg" ;;
  esac; done
  IFS=',' read -r LOC_A LOC_B <<<"$LOCS"
  [ -n "$DEB" ] || DEB="$(default_deb)"
  P_A_USER="${P_A_USER:-papercupai}"; P_B_USER="${P_B_USER:-aviynw}"

  # ── init the reusable rig + ARM auto-destroy (BEFORE any provision) ────────────
  RIG_KEEP_UP="$KEEP_UP"
  rig_init "$STYPE" "$IMAGE" || exit 1
  rig_install_exit_trap        # EXIT-trap auto-destroy live BEFORE the first create
  RIG_DEB="$DEB"

  # ── 1. artifact gate (the fixed forceReFold .deb) ─────────────────────────────
  rig_gate_artifact "$DEB" || exit 2

  # ── 2. identities (a=owner, b=joiner) ─────────────────────────────────────────
  rig_set_identity a "$P_A_USER" || exit 1
  rig_set_identity b "$P_B_USER" || exit 1

  # ── 3. provision both frames (records ids BEFORE install) ─────────────────────
  rig_provision "$LOC_A" "$LOC_B" || exit 3

  # ── 4. install .deb + launch the headless sidecar on each frame ───────────────
  rig_setup_frame a || exit 4
  rig_setup_frame b || exit 4

  # ── 5. boot + api ────────────────────────────────────────────────────────────
  fed_log "wait embedded-PG + operator in both sidecars"
  fed_wait_boot a 50 || { echo "A boot failed: $FED_BOOT_ERR"; drv_exec a <<<"tail -25 /home/pcusp/serve.log"; exit 5; }
  fed_wait_boot b 50 || { echo "B boot failed: $FED_BOOT_ERR"; drv_exec b <<<"tail -25 /home/pcusp/serve.log"; exit 5; }
  echo "✓ isolated by construction (separate cloud machines)"
  fed_log "A: PG=${FED_PG[a]} sc=${FED_SC[a]} | B: PG=${FED_PG[b]} sc=${FED_SC[b]}"
  fed_wait_api a || echo "⚠ A api not ready"; fed_wait_api b || echo "⚠ B api not ready"

  # ── 6. REAL hive join (both peers via /api/discovery/join-hive) ───────────────
  REPO_URL="${HIVE_REPO_URL:-https://github.com/octocat/Hello-World}"
  rig_owner_publish_hive a "$REPO_URL" || exit 6
  rig_join_hive a
  rig_join_hive b
  fed_log "join-hive booted + re-keyed the substrate at join — wait for peer_connect + drain (NO restart)"
  sleep 12

  # ── 7. the scenario (swarm wait + baseline + positive/negative probes + matrix) ─
  scenario_coord_controlplane a b
  # Pre-refactor behavior preserved: after the probes the standalone ALWAYS exits 0
  # (the matrix verdict is PRINTED, not encoded in the exit code) — the scenario's
  # return code (0 = all matched, 1 = divergence) is scored by the matrix runner only.
  # EXIT trap (rig_cleanup) tears down all frames + confirms servers=0.
  exit 0
fi
