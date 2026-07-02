#!/usr/bin/env bash
# deb-hetzner-matrix.sh — federation-release-hardening Brief 13: the CONSOLIDATED
# live federation regression matrix.
#
# The Hetzner project is capped at 2 concurrent servers (PERMANENT, owner-confirmed),
# so we do NOT run one provision→teardown rig per brief (6 serialized = hours + 6×
# redundant setup). Instead this runner provisions **2 frames ONCE** (a=owner,
# b=member), publishes + joins ONE hive, peers the swarm, then sources every
# bin/lib/scenarios/*.sh and runs each registered scenario in <order>, printing a
# PASS/FAIL matrix. One shared live run covers all of briefs 3-8's 2-frame scenarios.
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
MATRIX_IDS=(); declare -A MATRIX_ORDER MATRIX_LABEL MATRIX_FN
matrix_register() {  # <id> <order> <label> <fn>
  local id="$1" order="${2:-50}" label="${3:-$1}" fn="${4:-scn_$1}"
  case " ${MATRIX_IDS[*]} " in *" $id "*)
    echo "⚠ matrix_register: duplicate scenario id '$id' — later wins" >&2 ;;
  esac
  MATRIX_IDS+=("$id")
  MATRIX_ORDER[$id]="$order"; MATRIX_LABEL[$id]="$label"; MATRIX_FN[$id]="$fn"
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
      printf "  [%3s] %-26s %s   (fn: %s)\n" \
        "${MATRIX_ORDER[$id]}" "$id" "${MATRIX_LABEL[$id]}" "${MATRIX_FN[$id]}"
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

# init + ARM auto-destroy BEFORE any provision (cost-safety)
RIG_KEEP_UP="$KEEP_UP"
rig_init "$STYPE" "$IMAGE" || exit 1
rig_install_exit_trap
RIG_DEB="$DEB"

rig_gate_artifact "$DEB" || exit 2

# identities: a=owner, b=member (2-frame — fits the permanent 2-server cap)
rig_set_identity a "$P_A_USER" || exit 1
rig_set_identity b "$P_B_USER" || exit 1

rig_provision "$LOC_A" "$LOC_B" || exit 3
rig_setup_all || exit 4

fed_log "wait embedded-PG + operator on both sidecars"
rig_wait_all_ready 50 || exit 5

# owner publishes the hive; both frames join it (owner self-joins as a VIEW)
REPO_URL="${HIVE_REPO_URL:-https://github.com/octocat/Hello-World}"
rig_owner_publish_hive a "$REPO_URL" || exit 6
rig_join_all a

# join-hive boots + re-keys the substrate; give the swarm time to peer.
fed_log "joined — wait for peer_connect (NO restart)"
sleep 12
rig_wait_swarm a b 70 || echo "⚠ a↔b peer_connected NOT confirmed — scenarios may fail"

# unique-per-run tag: scenarios suffix their feature_ids/msg_ids with this.
MATRIX_RUN_ID="m$(date +%s)"
export MATRIX_RUN_ID
echo "✓ frames healthy — MATRIX_RUN_ID=$MATRIX_RUN_ID  (a=owner b=member, 2 machines, public DHT)"

# source scenarios NOW (frames are live). Registration is top-level; scn_* run below.
source_scenarios

# resolve the run set (all registered, or the --only subset), in order.
declare -a RUN_IDS=()
while read -r id; do
  if [ -n "$ONLY" ]; then case ",$ONLY," in *",$id,"*) RUN_IDS+=("$id") ;; esac
  else RUN_IDS+=("$id"); fi
done < <(matrix_sorted_ids)

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
  if [ "$rc" -eq 0 ]; then echo "  ✓ PASS $id — ${SCN_LINE[$id]}"
  else
    echo "  ✗ FAIL $id (rc=$rc) — ${SCN_LINE[$id]}"
    echo "    ── last 12 lines of $id ──"; tail -12 "$out" 2>/dev/null | sed 's/^/    /'
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
echo "  ── $passes passed, $fails failed of ${#RUN_IDS[@]} ──"
if [ "$fails" -eq 0 ]; then
  echo "OVERALL: PASS — every live federation scenario green across 2 real Hetzner VMs"
  exit 0
fi
echo "OVERALL: FAIL — see per-scenario logs in $RIG_WORK (kept if --keep-up; else torn down)"
exit 1
