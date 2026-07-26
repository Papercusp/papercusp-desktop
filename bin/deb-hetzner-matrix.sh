#!/usr/bin/env bash
# deb-hetzner-matrix.sh — federation-release-hardening Brief 13: the CONSOLIDATED
# live federation regression matrix.
#
# The Hetzner project is capped at 2 concurrent servers (PERMANENT, owner-confirmed),
# so on LIVE Hetzner we do NOT run one provision→teardown rig per brief (6 serialized
# = hours + 6× redundant setup) and never provision more than 2 frames there.
# Instead this runner provisions **2 frames ONCE** (a=owner, b=member), publishes +
# joins ONE hive, peers the swarm, then sources every bin/lib/scenarios/*.sh and runs
# each registered scenario in <order>, printing a PASS/FAIL matrix. One shared live
# run covers all of briefs 3-8's 2-frame scenarios.
#
# 3-frame mode (P-006 of p2p-rest-lanes-2026-07-09, umbrella P-010): when
# RIG_FRAME_IPS carries 3 ips (the local containerized rig only — see
# bin/local-matrix.sh --frames=3; live Hetzner's cap makes this unreachable there),
# a THIRD frame 'c' (2nd member, gh user P_C_USER) is auto-registered alongside
# a/b. The 8 registered scenarios still only exercise a/b (unmodified — the
# content-merge assertions are pairwise by design); frame c additionally joins the
# hive and is exercised by the standalone membership_churn scenario
# (bin/lib/scenarios/membership-churn.sh), which is auto-included in the run
# whenever a 3rd frame is present.
#
# It carries the SAME cost-safety the base rig has: every provisioned server id is
# recorded (rig_create_server) BEFORE anything billable, and the EXIT trap
# (rig_install_exit_trap → rig_cleanup) DESTROYs every recorded id + confirms 404 —
# so a crash anywhere still tears down to servers=0.
#
# ── Scenario contract (see bin/lib/scenarios/README.md for the full version) ──
#   Each scenario is one file bin/lib/scenarios/<id>.sh that, at its TOP LEVEL,
#   defines a scn_* function and registers it:
#       scn_myscenario() { …use rig_*/fed_* primitives…; echo "one result line"; }
#       matrix_register myscenario 40 "my scenario label" scn_myscenario
#   The matrix sources every *.sh, sorts by <order>, and calls each fn IN THE
#   CURRENT SHELL (so a scenario's rig_wait_frame_ready port re-discovery persists).
#   A fn returns 0=PASS / non-0=FAIL and echoes ONE result line (its last line).
#   Order convention: 10-40 non-destructive · 50-70 disruptive-but-restorative ·
#   90+ terminal/destructive (revocation/ban — runs LAST).
#
# ── Usage ─────────────────────────────────────────────────────────────────────
#   bin/deb-hetzner-matrix.sh --list                 # print registered scenarios, NO provision
#   bin/deb-hetzner-matrix.sh [--deb=PATH]           # full 2-frame live run (COSTS MONEY)
#   bin/deb-hetzner-matrix.sh --only=revocation_kcut,concurrent_lww   # run a subset
#   bin/deb-hetzner-matrix.sh --locs=ash,nbg1 --type=cpx31 --keep-up
#
# ⚠ COSTS REAL MONEY (provisions 2 Hetzner cpx31). Opt-in / manual only — NEVER wire
#   into automatic push CI. See the "CI / cron" note at the bottom of README.md.
#   npm alias: `npm run --prefix papercusp-desktop test:federation:live-matrix`.
set -uo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCEN_DIR="$DESKTOP_DIR/bin/lib/scenarios"

# ── args ──────────────────────────────────────────────────────────────────────
LOCS="ash,ash"; STYPE="cpx31"; DEB=""; KEEP_UP=0; IMAGE="ubuntu-24.04"; LIST=0; ONLY=""
for arg in "$@"; do case "$arg" in
  --list)    LIST=1 ;;
  --locs=*)  LOCS="${arg#--locs=}" ;;
  --type=*)  STYPE="${arg#--type=}" ;;
  --deb=*)   DEB="${arg#--deb=}" ;;
  --image=*) IMAGE="${arg#--image=}" ;;
  --only=*)  ONLY="${arg#--only=}" ;;
  --keep-up) KEEP_UP=1 ;;
  -h|--help) sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "unknown arg: $arg (try --help)" >&2; exit 2 ;;
esac; done

# The rig lib + scenarios run under set +u (assoc arrays, optional globals).
set +u

# ── sources: common → asserts → rig (rig's drv_* override the asserts' generic) ─
# shellcheck disable=SC1091
source "$DESKTOP_DIR/scripts/linux-test-vm/lib/common.sh" 2>/dev/null || true
# shellcheck disable=SC1091
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"
# shellcheck disable=SC1091
source "$DESKTOP_DIR/bin/lib/deb-hetzner-rig.sh"

# ── the matrix registry (scenario files call matrix_register at source time) ───
# <minframes> (5th arg, default 2) DECLARES a scenario's frame requirement so the
# runner can exclude it GENERICALLY and VISIBLY. It replaces a hardcoded
# `[ "$id" = membership_churn ] && [ "$FRAME3" != 1 ] && continue` in the run-set
# resolver, which excluded that one scenario with NO output at all: it did not
# appear as PASS, FAIL, or skip, so a 2-frame run's log gave no indication that a
# registered scenario had not executed (EI-18660392396897977). matrix_register is
# exactly what made it look covered. Declaring the requirement here means a future
# 3-frame scenario needs no new runner code and cannot be silently dropped.
MATRIX_IDS=(); declare -A MATRIX_ORDER MATRIX_LABEL MATRIX_FN MATRIX_MINFRAMES
matrix_register() {  # <id> <order> <label> <fn> [minframes]
  local id="$1" order="${2:-50}" label="${3:-$1}" fn="${4:-scn_$1}" minframes="${5:-2}"
  case " ${MATRIX_IDS[*]} " in *" $id "*)
    echo "⚠ matrix_register: duplicate scenario id '$id' — later wins" >&2 ;;
  esac
  MATRIX_IDS+=("$id")
  MATRIX_ORDER[$id]="$order"; MATRIX_LABEL[$id]="$label"; MATRIX_FN[$id]="$fn"
  MATRIX_MINFRAMES[$id]="$minframes"
}

# emit registered ids sorted by numeric <order> (stable), one per line
matrix_sorted_ids() {
  local id
  [ "${#MATRIX_IDS[@]}" -gt 0 ] || return 0
  for id in "${MATRIX_IDS[@]}"; do printf '%s\t%s\n' "${MATRIX_ORDER[$id]}" "$id"; done \
    | sort -n -s -k1,1 | cut -f2-
}

# source every bin/lib/scenarios/*.sh (defines scn_* + calls matrix_register)
source_scenarios() {
  local f found=0
  shopt -s nullglob
  for f in "$SCEN_DIR"/*.sh; do
    found=1
    # shellcheck disable=SC1090
    source "$f" || echo "⚠ scenario source failed: $f" >&2
  done
  shopt -u nullglob
  [ "$found" = 1 ] || echo "⚠ no scenario files in $SCEN_DIR" >&2
}

# ── --list: register + print, NO provision (authors validate registration) ─────
if [ "$LIST" = 1 ]; then
  source_scenarios
  echo "Registered live-matrix scenarios ($SCEN_DIR, sorted by order):"
  if [ "${#MATRIX_IDS[@]}" -gt 0 ]; then
    while read -r id; do
      printf "  [%3s] %-26s %s   (fn: %s, needs %s frames)\n" \
        "${MATRIX_ORDER[$id]}" "$id" "${MATRIX_LABEL[$id]}" "${MATRIX_FN[$id]}" \
        "${MATRIX_MINFRAMES[$id]:-2}"
    done < <(matrix_sorted_ids)
  else
    echo "  (none — drop bin/lib/scenarios/<id>.sh files that call matrix_register)"
  fi
  exit 0
fi

# ── full live run ──────────────────────────────────────────────────────────────
set +e
[ -n "$DEB" ] || DEB="$(default_deb)"
IFS=',' read -r LOC_A LOC_B <<<"$LOCS"
[ -n "$LOC_B" ] || LOC_B="$LOC_A"
P_A_USER="${P_A_USER:-papercupai}"   # owner
P_B_USER="${P_B_USER:-aviynw}"       # member
P_C_USER="${P_C_USER:-$P_B_USER}"    # 2nd member (3-frame mode only; may share b's gh identity — a real multi-device topology)

# 3-frame mode auto-detects off RIG_FRAME_IPS (BYO local rig only — see header).
FRAME3=0
if [ -n "${RIG_FRAME_IPS:-}" ]; then
  read -r -a _BYO_IPS <<<"$RIG_FRAME_IPS"
  [ "${#_BYO_IPS[@]}" -ge 3 ] && FRAME3=1
fi

# init + ARM auto-destroy BEFORE any provision (cost-safety)
RIG_KEEP_UP="$KEEP_UP"
rig_init "$STYPE" "$IMAGE" || exit 1
rig_install_exit_trap
RIG_DEB="$DEB"

rig_gate_artifact "$DEB" || exit 2

# identities: a=owner, b=member (2-frame — fits the permanent 2-server cap on
# live Hetzner); +c=2nd member when FRAME3=1 (BYO local rig only).
rig_set_identity a "$P_A_USER" || exit 1
rig_set_identity b "$P_B_USER" || exit 1
[ "$FRAME3" = 1 ] && { rig_set_identity c "$P_C_USER" || exit 1; }

if [ "$FRAME3" = 1 ]; then
  rig_provision "$LOC_A" "$LOC_B" "$LOC_B" || exit 3
else
  rig_provision "$LOC_A" "$LOC_B" || exit 3
fi
rig_setup_all || exit 4

fed_log "wait embedded-PG + operator on every sidecar"
# WI-5509 (2026-07-19): the old 50-tries/150s boot window washed out an entire
# local-matrix run (frame B never came up; 0/13 scenarios attempted) after two
# LOAD_GATE-skipped cycles left the host with a cold page cache. Every frame's
# embedded-PG boot APPLIES THE FULL migration set (508 files at HEAD and
# growing over time) and, in local-matrix's 2-frame mode, ALL frames do this
# CONCURRENTLY on ONE shared host (rig_setup_all backgrounds each frame's
# serve.mjs and returns immediately, so the migration-apply windows overlap in
# full) — real disk-I/O + page-cache contention that per-frame cpuset pinning
# (local-matrix.sh) does not isolate. 150s already left near-zero margin for
# that contention plus continued migration-count growth; every OTHER 2-frame
# smoke in this codebase already budgets 60-80 tries for a lighter boot. Bump
# to 100 tries/300s so ordinary contention no longer washes out the whole run
# — still fails loudly (and fast, since fed_wait_boot returns as soon as both
# markers appear) on a genuinely wedged boot.
rig_wait_all_ready 100 || exit 5

# WI-6043 (2026-07-26): explicitly ARM the epoch re-key (K-cut) flag on every frame
# BEFORE hive creation, so the owner's epoch initializes with the re-key on from the
# start — see rig_arm_hive_rekey's doc comment (deb-hetzner-rig.sh) for why relying on
# the flag's compiled DEFAULT-ON alone left revocation_kcut's cut-off never actually
# engaged on this rig (epoch stuck at 0 for entire runs; the two prior clean passes were
# very likely a propagation-lag race, not a real cut-off).
rig_arm_hive_rekey a
rig_arm_hive_rekey b
[ "$FRAME3" = 1 ] && rig_arm_hive_rekey c

# owner publishes the hive; every frame joins it (owner self-joins as a VIEW)
REPO_URL="${HIVE_REPO_URL:-https://github.com/octocat/Hello-World}"
rig_owner_publish_hive a "$REPO_URL" || exit 6
rig_join_all a

# join-hive boots + re-keys the substrate; give the swarm time to peer.
fed_log "joined — wait for peer_connect (NO restart)"
sleep 12
# EI-18687938054040755: rig_wait_swarm is TRI-STATE — 0 = data path proven, 1 = not
# proven, 2 = N/A (this build predates the peer_data_path_up emitter). A bare
# `|| echo` collapses 2 into 1 and prints a NEGATIVE FINDING for something that was
# never measured — and in the exact `peer_connected` vocabulary this bug exists to
# purge. rig_wait_swarm already prints the verdict line itself; all this adds is the
# CONSEQUENCE, which is only warranted when the path was measured and genuinely
# failed. On N/A we add nothing: "not measured" carries no scenario prediction.
_matrix_swarm_consequence() { # <rc> <a> <b> <consequence>
  case "$1" in
    0|2) : ;;
    *) echo "⚠ $2↔$3 data path NOT proven — $4" ;;
  esac
}
rig_wait_swarm a b 70; _matrix_swarm_consequence $? a b "scenarios may fail"
if [ "$FRAME3" = 1 ]; then
  rig_wait_swarm a c 70; _matrix_swarm_consequence $? a c "scenarios may fail"
  rig_wait_swarm b c 70; _matrix_swarm_consequence $? b c "membership_churn may fail"
fi

# ── WS-DIAG (WI-5672, 2026-07-21): one-shot live DB dump right after peer_connect, ──
# BEFORE any scenario can fail/teardown. BYO frames are destroyed at run end, so this
# is the only window to see live state for the "does joiner B ever get an epoch key /
# does A ever see B's device_attestations" hypothesis. Best-effort + non-fatal — a
# failure here (e.g. FED_PG not yet populated) must never fail or slow the run; output
# goes to stdout, which the caller (live-federation-gate.sh) already captures to
# $WORK/local-matrix.out alongside the rest of this run's evidence.
{
  echo "── WS-DIAG (WI-5672) start — home-harness-slug=${RIG_HOME_HARNESS_SLUG:-unset} ──"
  echo "── pot_epoch_keys (frame a) ── (WI-5672 fix: table renamed hive_epoch_keys->pot_epoch_keys by mig 557; harness_slug column NOT renamed)"
  drv_psql a "SELECT harness_slug, epoch, member_device_pubkey, origin, fed_ts FROM harness_shared.pot_epoch_keys ORDER BY epoch, member_device_pubkey;"
  echo "── pot_members device_attestations, as seen by frame a (owner) ── (WI-5672 fix: column renamed username->github_username by mig 185/557)"
  drv_psql a "SELECT github_username, pot_home_slug, origin, fed_ts, device_attestations FROM harness_shared.pot_members;"
  echo "── pot_members device_attestations, as seen by frame b (joiner, own view) ──"
  drv_psql b "SELECT github_username, pot_home_slug, origin, fed_ts, device_attestations FROM harness_shared.pot_members;"
  # WI-5672 (2026-07-25): if A is still missing B's attestation/epoch-key at this
  # checkpoint (the shape seen in 3 of 4 banked runs today, vs. the ~18s-convergence
  # "143908 control"), the open question is WHETHER that op is even enqueued yet on
  # B's outbox — distinguishes "not yet admitted locally on B" from "admitted on B,
  # but undrained/unmerged to A" (a genuine drain-race) from "drained but rejected/
  # quarantined". drained_at IS NULL = pending; quarantined_at IS NOT NULL = rejected.
  echo "── substrate_outbox pending/quarantined rows, frame b (pot_members/pot_epoch_keys only) ──"
  drv_psql b "SELECT table_name, op, key, ts, drained_at, quarantined_at FROM harness_shared.substrate_outbox WHERE table_name IN ('pot_members','pot_epoch_keys') ORDER BY ts;"
  echo "── WS-DIAG (WI-5672) end ──"
} 2>&1 || fed_log "⚠ WS-DIAG (WI-5672) dump failed — non-fatal, continuing run"

# ── pre-scenario CONVERGENCE barrier (EI-18661870528779127) ──────────────────
# rig_wait_swarm above only proves `peer_connected` fired once — in run
# 20260725-183831 that event fired ~85x per frame while EVERY connection died at a
# fixed ~13.0s, so scenarios 10/20/30/40 ran on an unconverged link and failed for
# reasons unrelated to what they test (orders 50-90 then passed 11 straight on the
# same capability). The WS-DIAG dump directly above already showed frame b's
# pot_members EMPTY at exactly this point — it was printed and never gated on.
# This is that gate. Deliberately placed AFTER WS-DIAG so a failure still has the
# live diagnostic dump above it in the log. Unlike the peer_connected checks this
# is FATAL: starting the matrix on an unconverged link produces misattributed
# failures, which is strictly worse than not running.
# exit 8, not 7 — 7 already means "no scenarios to run" (below); a convergence
# failure must stay distinguishable from an empty run-set in the caller's rc.
rig_wait_converged b || exit 8
if [ "$FRAME3" = 1 ]; then
  rig_wait_converged c || exit 8
fi

# unique-per-run tag: scenarios suffix their feature_ids/msg_ids with this.
MATRIX_RUN_ID="m$(date +%s)"
export MATRIX_RUN_ID
if [ "$FRAME3" = 1 ]; then
  echo "✓ frames healthy — MATRIX_RUN_ID=$MATRIX_RUN_ID  (a=owner b=member c=member, 3 machines, public DHT)"
else
  echo "✓ frames healthy — MATRIX_RUN_ID=$MATRIX_RUN_ID  (a=owner b=member, 2 machines, public DHT)"
fi

# source scenarios NOW (frames are live). Registration is top-level; scn_* run below.
source_scenarios

# resolve the run set (all registered, or the --only subset), in order.
# EVERY registered scenario is accounted for here: it lands in RUN_IDS, or in
# SKIP_IDS with a stated reason. Nothing is dropped silently — see the roll-call
# reconciliation at the end of the run, which fails loudly if that stops holding.
HAVE_FRAMES=2; [ "$FRAME3" = 1 ] && HAVE_FRAMES=3
declare -a RUN_IDS=() SKIP_IDS=(); declare -A SKIP_REASON
while read -r id; do
  need="${MATRIX_MINFRAMES[$id]:-2}"
  if [ "$need" -gt "$HAVE_FRAMES" ]; then
    SKIP_IDS+=("$id"); SKIP_REASON[$id]="needs $need frames, have $HAVE_FRAMES (run with --frames=$need)"
    continue
  fi
  if [ -n "$ONLY" ]; then
    case ",$ONLY," in
      *",$id,"*) RUN_IDS+=("$id") ;;
      *) SKIP_IDS+=("$id"); SKIP_REASON[$id]="not in --only=$ONLY" ;;
    esac
  else RUN_IDS+=("$id"); fi
done < <(matrix_sorted_ids)

# Announce exclusions BEFORE the run, so a reader of the live log knows what this
# run is NOT going to cover rather than having to infer it from an absence.
for id in "${SKIP_IDS[@]}"; do
  printf "  ⊘ SKIP %-26s [order %3s] — %s\n" "$id" "${MATRIX_ORDER[$id]}" "${SKIP_REASON[$id]}"
done

if [ "${#RUN_IDS[@]}" -eq 0 ]; then
  echo "✗ no scenarios to run (registered=${#MATRIX_IDS[@]}, only='$ONLY') — nothing to matrix." >&2
  exit 7
fi

# ── run each scenario IN THE CURRENT SHELL (redirect, not subshell) ────────────
# A subshell ($(...)/pipe) would lose a scenario's rig_wait_frame_ready port
# re-discovery (FED_PG/FED_SC globals), so we redirect stdout to a per-scn log and
# read its last line back — the fn itself runs in this shell.
declare -A SCN_RC SCN_LINE
for id in "${RUN_IDS[@]}"; do
  fn="${MATRIX_FN[$id]}"
  if ! declare -F "$fn" >/dev/null 2>&1; then
    echo "  ✗ FAIL $id — registered fn '$fn' is not defined" >&2
    SCN_RC[$id]=127; SCN_LINE[$id]="fn '$fn' not defined"; continue
  fi
  fed_log "▶ scenario $id (${MATRIX_LABEL[$id]})  [order ${MATRIX_ORDER[$id]}]"
  out="$RIG_WORK/scn.$id.log"
  "$fn" >"$out" 2>&1; rc=$?
  SCN_RC[$id]=$rc
  SCN_LINE[$id]="$(grep -v '^[[:space:]]*$' "$out" 2>/dev/null | tail -1)"
  if [ "$rc" -eq 0 ]; then
    echo "  ✓ PASS $id — ${SCN_LINE[$id]}"
    # WI-6057: a PASS used to surface ONLY the last non-blank line, so a scenario's
    # INTENTIONAL diagnostics were discarded on exactly the runs that need them. The
    # discriminating value (e.g. b3-revocation.sh's "· revocation: revoke.live=…",
    # which tells you whether the K-cut was genuinely ARMED or the cut merely appeared
    # to work) is not the last line, so it was visible only on FAIL — backwards, since
    # a PASSING run is what you need to confirm a fix. $RIG_WORK/scn.$id.log holds it
    # but is torn down without --keep-up, so it was genuinely lost. Surface the marked
    # lines on PASS too. Additive: no assertion or exit-code semantics change.
    grep -a '^[[:space:]]*·' "$out" 2>/dev/null | sed 's/^[[:space:]]*/    /' || true
  else
    echo "  ✗ FAIL $id (rc=$rc) — ${SCN_LINE[$id]}"
    echo "    ── last 12 lines of $id ──"; tail -12 "$out" 2>/dev/null | sed 's/^/    /'
    # EI-18660101091813036: serve.log is cumulative across the whole run and
    # rig_bank_logs() (lib/deb-hetzner-rig.sh) otherwise only fires once, in the
    # EXIT trap, at run end — so bank it NOW too, tagged with this scenario id,
    # so a serve-<frame>-<HHMMSS>-<id>.log exists at the moment of THIS failure
    # specifically (survives a later scenario overwriting the picture, and a
    # run that's later killed before reaching a clean exit). Best-effort/
    # non-fatal, same contract as the end-of-run bank; never blocks the matrix.
    rig_bank_logs "$id" 2>/dev/null || true
  fi
done

# ── the PASS/FAIL matrix ───────────────────────────────────────────────────────
echo
echo "════════ LIVE FEDERATION MATRIX ════════"
echo "  rig: Hetzner $STYPE ($LOC_A + $LOC_B), 2-frame, real public DHT   run=$MATRIX_RUN_ID"
fails=0; passes=0
for id in "${RUN_IDS[@]}"; do
  if [ "${SCN_RC[$id]}" -eq 0 ]; then st="PASS"; passes=$((passes+1))
  else st="FAIL"; fails=$((fails+1)); fi
  printf "  %-4s  %-26s %s\n" "$st" "$id" "${SCN_LINE[$id]}"
done
# Skipped scenarios appear in the SAME table as pass/fail. A reader must be able to
# see this run's real coverage from its verdict alone, without cross-referencing the
# registry — an omission is only honest if it is stated where the results are read.
for id in "${SKIP_IDS[@]}"; do
  printf "  %-4s  %-26s %s\n" "SKIP" "$id" "${SKIP_REASON[$id]}"
done
echo "  ── $passes passed, $fails failed, ${#SKIP_IDS[@]} skipped of ${#MATRIX_IDS[@]} registered ──"

# ── roll-call reconciliation (EI-18660392396897977) ───────────────────────────
# Every registered scenario must be accounted for as either run or explicitly
# skipped. This is deliberately a GENERIC invariant rather than a check on the one
# exclusion mechanism that caused the bug: it catches any future filter — a new
# frame tier, a capability gate, an early `continue` — that drops a scenario
# without saying so. A suite that quietly runs a subset of itself while reporting
# a clean verdict is the failure this guards.
accounted=$(( ${#RUN_IDS[@]} + ${#SKIP_IDS[@]} ))
if [ "$accounted" -ne "${#MATRIX_IDS[@]}" ]; then
  echo "OVERALL: FAIL — ROLL-CALL MISMATCH: ${#MATRIX_IDS[@]} scenarios registered but only $accounted accounted for (${#RUN_IDS[@]} run + ${#SKIP_IDS[@]} skipped). Some registered scenario was dropped without a stated reason — that is a runner bug, and this run's verdict cannot be trusted to describe its own coverage." >&2
  exit 1
fi

if [ "$fails" -eq 0 ]; then
  if [ "${#SKIP_IDS[@]}" -gt 0 ]; then
    echo "OVERALL: PASS — all $passes EXECUTED scenarios green, but ${#SKIP_IDS[@]} of ${#MATRIX_IDS[@]} registered were SKIPPED (see table): this is NOT full-matrix coverage"
  else
    echo "OVERALL: PASS — every live federation scenario green across 2 real Hetzner VMs"
  fi
  exit 0
fi
echo "OVERALL: FAIL — see per-scenario logs in $RIG_WORK (kept if --keep-up; else torn down)"
exit 1
