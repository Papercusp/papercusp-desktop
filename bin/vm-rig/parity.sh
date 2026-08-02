#!/usr/bin/env bash
# parity.sh — the LIVE-1 coordination parity runner (WI-7000).
#
# WHAT THIS IS
# ------------
# `bin/lib/federation-asserts.sh` defines five parity asserts, one per LIVE-1
# surface — and until this script, NOTHING CALLED ANY OF THEM:
#
#   1 fed_assert_wake_bridge            (P-002/P-003)
#   2 fed_assert_delivery_receipts      (P-008 + M5a)
#   3 fed_assert_federated_events       (P-009)
#   4 fed_assert_presence_gossip        (P-004/P-005)  — run BOTH directions
#   5 fed_assert_claim_spec_federation  (P-016 + M7)
#
# The LIVE-1 runbook's own follow-up asked for exactly this — "codify surfaces
# 1-5 into fed_assert_* helpers ... so the parity proof is a single green/red
# exit rather than manual PG inspection" — but the caller it named,
# deb-hetzner-federation.sh, is the RETIRED Hetzner scenario. The helpers
# shipped; their driver never did, so they became unreachable dead code and
# surfaces 1/2/4/5 stayed "unproven cross-machine, manual PG inspection".
#
# This is that missing driver, pointed at the rig that DOES exist: the
# tower <-> Mac VM pair (Linux tower <-> Avis-iMac.local), whose federated-event
# rail was hand-proven both directions on 2026-08-02.
#
# THE ASSERTS ARE NOT MODIFIED. All the work here is the ADAPTER: the five
# helpers call `drv_psql <inst> <sql>` against the RECEIVING machine's PG, and
# this script supplies a vm-rig implementation of that seam (local psql for the
# tower, psql-over-ssh into the packaged app's bundled binary for the Mac).
#
# FALSE-GREEN GUARD (the D-018 lesson, applied)
# ---------------------------------------------
# A drill whose legs can quietly SKIP produces a plausible, quotable, WRONG
# release reading. So this runner has NO skip path: preflight either proves it
# is talking to two real machines or the whole run ABORTS (exit 2) without
# emitting a verdict. A leg can only pass by observing a real row on the real
# receiving machine. Never report a LIVE-1 surface proven from a run whose
# banner does not name two distinct hosts.
#
# Usage:   bin/vm-rig/parity.sh [--only <leg,leg,...>] [--tries N]
#          legs: fedevents wakebridge receipts claimspec presence
#          (`presence` emits TWO verdict rows — `presence` = vm->tower and
#           `presence-rev` = tower->vm. WI-7029: a one-directional presence
#           green was being read as a cross-machine one.)
# Env:     PCUSP_VM_SSH     ssh target        (default aviweiss@172.31.44.2)
#          PCUSP_TOWER_DSN  tower PG DSN      (default harness_admin@127.0.0.1:5432)
#          PCUSP_TOWER_PORT tower operator    (default 3270 — the bg-host SUBSTRATE
#                           PRIMARY that holds in-process events/coord state;
#                           :3070 is request-only and gives false negatives)
#          PCUSP_VM_MACHINE_LABEL     override the derived Mac machine_label
#          PCUSP_TOWER_MACHINE_LABEL  override the derived tower machine_label
#                           (leg 5's tower->vm direction asserts against it)
# Exit:    0 all legs green · 1 one or more red · 2 preflight failed (NO verdict)
#
# Prereq:  bin/vm-rig/deploy.sh  — the VM's /tmp is wiped on reboot, which takes
#          the driver with it. Re-run deploy.sh after any VM reboot.

set -uo pipefail   # deliberately NOT -e: every leg runs, then one census.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

# shellcheck source=/dev/null
. "$HERE/../lib/federation-asserts.sh"

VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
TOWER_DSN="${PCUSP_TOWER_DSN:-postgresql://harness_admin:harness_admin_pwd@127.0.0.1:5432/papercusp}"
TOWER_PORT="${PCUSP_TOWER_PORT:-3270}"
TOWER_MCP="$ROOT/scripts/mcp-call.mjs"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no)

RUN="$(date +%s)"
CLI_TW="--client live1-parity-tower --workspace papercusp-workspace --harness papercusp"
CLI_VM="--client live1-parity-vm --workspace papercusp-workspace --harness papercusp"

TRIES=30
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only)  ONLY="${2:-}"; shift 2 ;;
    --tries) TRIES="${2:-30}"; shift 2 ;;
    -h|--help) sed -n '1,50p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
wants() { [ -z "$ONLY" ] || case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

# ── the vm-rig drv_psql seam (THE ADAPTER — the actual work of WI-7000) ──────
# The five asserts run parameterised SQL against the RECEIVING machine's PG via
# drv_psql. Two instances: `tower` (local) and `vm` (the Mac, over ssh).
VM_PG_PORT=""
VM_PSQL_BIN=""

parity_discover_vm() {
  local out
  # The Mac's embedded PG port is RANDOMIZED PER BOOT (and its data dir is not
  # the ~/.papercusp one), so it must be discovered from the live postmaster's
  # argv, never hardcoded. Same for psql: there is no psql on the Mac's PATH —
  # the only one is the copy bundled inside the packaged app.
  out="$(ssh "${SSH_OPTS[@]}" "$VM" '
    P=$(ps -axo args | grep "[e]mbedded-postgres" | grep -oE " -p [0-9]+" | grep -oE "[0-9]+" | head -1)
    B=""
    for c in /Applications/Papercusp*.app/Contents/Resources/sidecar/bin/psql; do
      [ -x "$c" ] && B="$c" && break
    done
    printf "%s\t%s\t%s\t%s" "$P" "$B" "$(hostname)" "$(whoami)"
  ' 2>/dev/null)" || return 1
  VM_PG_PORT="$(printf '%s' "$out" | cut -f1)"
  VM_PSQL_BIN="$(printf '%s' "$out" | cut -f2)"
  VM_HOSTNAME="$(printf '%s' "$out" | cut -f3)"
  VM_USER="$(printf '%s' "$out" | cut -f4)"
  [ -n "$VM_PG_PORT" ] && [ -n "$VM_PSQL_BIN" ]
}

drv_psql_rig() {
  local inst="$1" sql="$2"
  case "$inst" in
    tower)
      psql "$TOWER_DSN" -tA -c "$sql"
      ;;
    vm)
      # The assert SQL is full of single quotes and the Mac's psql path has a
      # space in it, so the statement is base64'd across the ssh boundary
      # rather than quote-escaped (base64's alphabet is shell-inert).
      local b64; b64="$(printf '%s' "$sql" | base64 | tr -d '\n')"
      ssh "${SSH_OPTS[@]}" "$VM" \
        "PSQLB='$VM_PSQL_BIN' DSN='postgresql://harness_admin:harness_admin_pwd@127.0.0.1:$VM_PG_PORT/papercusp' B64='$b64' bash -s" <<'EOS'
q="/tmp/parity-q-$$.sql"
printf '%s' "$B64" | base64 -d > "$q" || exit 9
"$PSQLB" "$DSN" -tA -f "$q"
rc=$?
rm -f "$q"
exit $rc
EOS
      ;;
    *) echo "drv_psql_rig: unknown instance '$inst'" >&2; return 1 ;;
  esac
}
drv_psql() { drv_psql_rig "$@"; }

# Capture "now" from the RECEIVING machine's own clock. The asserts compare
# fired_at (stamped by dst) against a caller-supplied epoch — taking that epoch
# from the sender would fold tower/Mac clock skew straight into the comparison
# and could red a healthy rail (or, worse, green a dead one).
dst_now_ms() { drv_psql "$1" "SELECT (extract(epoch from now())*1000)::bigint;" 2>/dev/null | tr -d '[:space:]'; }

tower_mcp() {
  PAPERCUSP_HONO_PORT="$TOWER_PORT" node "$TOWER_MCP" "$1" "$2" $CLI_TW 2>&1
}
vm_mcp_bg() {
  # fire-and-forget on the VM (used to register a standing await)
  ssh "${SSH_OPTS[@]}" "$VM" "nohup /tmp/vmcall.sh $1 '$2' $CLI_VM > /tmp/parity-$RUN-$3.out 2>&1 & echo ok" >/dev/null 2>&1
}

# ── census ──────────────────────────────────────────────────────────────────
declare -a RESULTS=()
PASSES=0; FAILS=0
record() { # record <leg> <PASS|FAIL> <detail>
  RESULTS+=("$1|$2|$3")
  if [ "$2" = "PASS" ]; then PASSES=$((PASSES+1)); else FAILS=$((FAILS+1)); fi
  printf '  %s %-12s %s\n' "$([ "$2" = PASS ] && echo '✓' || echo '✗')" "$1" "$3"
}

# ── preflight — proves TWO REAL MACHINES or aborts with no verdict ──────────
fed_log "preflight: proving a real two-machine rig"

[ -f "$TOWER_MCP" ] || { echo "FATAL: $TOWER_MCP not found" >&2; exit 2; }

TOWER_HOST="$(hostname)"
tower_ok="$(psql "$TOWER_DSN" -tA -c "SELECT 'ok';" 2>&1 | tr -d '[:space:]')"
if [ "$tower_ok" != "ok" ]; then
  echo "FATAL: tower PG unreachable via \$PCUSP_TOWER_DSN" >&2
  echo "  $tower_ok" >&2
  exit 2
fi
echo "  tower : $TOWER_HOST — PG ok"

if ! parity_discover_vm; then
  echo "FATAL: cannot reach the rig VM ($VM) or cannot locate its embedded PG / bundled psql." >&2
  echo "  Run bin/vm-rig/deploy.sh first (the VM's /tmp is wiped on reboot), and check the app is running." >&2
  exit 2
fi
vm_ok="$(drv_psql vm "SELECT 'ok';" 2>&1 | tr -d '[:space:]')"
if [ "$vm_ok" != "ok" ]; then
  echo "FATAL: rig VM PG unreachable (port $VM_PG_PORT)" >&2
  echo "  $vm_ok" >&2
  exit 2
fi
echo "  vm    : $VM_HOSTNAME — PG ok (embedded, port $VM_PG_PORT)"

# Distinctness is the whole point: a run where both halves resolve to the same
# host proves nothing cross-machine, and is exactly the false green to refuse.
if [ "$TOWER_HOST" = "$VM_HOSTNAME" ]; then
  echo "FATAL: tower and vm resolved to the SAME host ($TOWER_HOST) — that is a single-box run." >&2
  echo "  Refusing to emit a parity verdict. (WI-7000 / D-018 false-green guard.)" >&2
  exit 2
fi

VM_MACHINE_LABEL="${PCUSP_VM_MACHINE_LABEL:-$(printf '%s' "$VM_HOSTNAME" | tr '.' '_')-$VM_USER}"
# The tower's OWN label, derived by the same rule the operator uses (hostname
# with dots folded to underscores, then '-' + the owning unix user) so leg 5 can
# assert the tower->vm direction too. WI-7029: asserting only vm->tower let the
# reverse direction stay dead while the leg reported green.
TOWER_MACHINE_LABEL="${PCUSP_TOWER_MACHINE_LABEL:-$(printf '%s' "$TOWER_HOST" | tr '.' '_')-$(id -un)}"

echo ""
echo "  ══ LIVE-1 parity run $RUN ══"
echo "  src (tower) : $TOWER_HOST  [machine_label: $TOWER_MACHINE_LABEL]"
echo "  dst (vm)    : $VM_HOSTNAME  [machine_label: $VM_MACHINE_LABEL]"
echo "  tower operator port: $TOWER_PORT"

# ── LEG 1 — federated events (P-009). THE POSITIVE CONTROL. ────────────────
# Deliberately first: this surface was independently hand-proven on the same
# rig on 2026-08-02, so if THIS leg reds, the fault is in the runner/adapter,
# not in the feature. A harness with no self-check is how you get D-018.
if wants fedevents; then
  fed_log "LEG 1/5 — federated events (P-009)  [POSITIVE CONTROL]"
  KEY="live1:parity:fedevt-$RUN"
  vm_mcp_bg "events:await" "{\"event\":\"$KEY\",\"timeout_sec\":600,\"note\":\"LIVE-1 parity fed-event\"}" "await"
  sleep 3
  SINCE="$(dst_now_ms vm)"
  if [ -z "$SINCE" ]; then
    record fedevents FAIL "could not read dst clock"
  else
    emit_out="$(tower_mcp events:emit "{\"event\":\"$KEY\",\"summary\":\"LIVE-1 parity fed-event tower->VM\",\"scope\":\"hive\"}")"
    echo "$emit_out" | tail -3 | scn_diag "emit: "
    if [ "$(fed_assert_federated_events vm "$KEY" "$SINCE" "$TRIES")" = "1" ]; then
      record fedevents PASS "$KEY fired exactly once on $VM_HOSTNAME"
    else
      record fedevents FAIL "$KEY never fired (or re-fired) on $VM_HOSTNAME"
    fi
  fi
fi

# ── LEGS 2+3 — wake bridge (P-002/P-003) + delivery receipts (P-008/M5a) ───
# ONE directed wake:'required' scope:'hive' send feeds both asserts: the wake
# must fire on the RECEIVER, and exactly one receipt must come back to the
# SENDER (0 = dead receipt rail; 2 = the M5a N-1 false-delivered bug).
if wants wakebridge || wants receipts; then
  fed_log "LEGS 2+3 — wake bridge (P-002/P-003) + delivery receipts (P-008 + M5a)"
  # Target a DEDICATED probe identity homed on the VM — never an ambient agent
  # that merely happens to have an inbox-wake row. An ambient row is usually a
  # DEAD session's leftover (they are created at session start and are not
  # expired on death): sending to one reds this leg with "wake never fired"
  # while proving nothing about the bridge, because nothing was ever going to
  # service that corpse. Measured 2026-08-02: the only inbox-wake awaits that
  # have EVER fired on the Mac belong to `su-live1-imac-probe`, the LIVE-1
  # drill's own registered probe client — this mirrors that precedent.
  #
  # The watch is always-armed at session start (turn-lifecycle-control);
  # coord:await-inbox refreshes that same standing row, which is what an MCP
  # call under a fresh --client identity needs to materialise it.
  # Discover the target from the TOWER'S OWN ROSTER, not from the VM's await
  # rows. Two hard-won reasons:
  #  · Addressability. coord:send resolves recipients against the SENDER's
  #    roster, so an identity that exists only on the Mac is refused
  #    `unknown_recipient` — a dedicated probe armed VM-side cannot be messaged
  #    from the tower at all (measured 2026-08-02 with su-live1-parity-probe).
  #  · Liveness. A CRASHED session's standing inbox-wake await is never
  #    cancelled, so picking "whoever has an await row" reliably selects a
  #    false-wakeable zombie. Federated presence freshness is the better signal.
  # Note heartbeat freshness is NOT sessionState — a warm-dead session still
  # gossips fresh rows — so this narrows the target, it does not guarantee it.
  AGENT="${PCUSP_PARITY_PROBE_AGENT:-$(psql "$TOWER_DSN" -tA -c "SELECT owner_id FROM harness_shared.shared_session_presence WHERE machine_label='$VM_MACHINE_LABEL' AND last_seen_at > now() - interval '180 seconds' ORDER BY last_seen_at DESC LIMIT 1;" 2>/dev/null | tr -d '[:space:]')}"
  if [ -z "$AGENT" ]; then
    wants wakebridge && record wakebridge FAIL "no roster-visible VM-homed session on $VM_HOSTNAME to address (runner/infra, not the bridge)"
    wants receipts   && record receipts   FAIL "not attempted — no addressable VM-homed target"
  else
    echo "  target (roster-visible, homed on $VM_HOSTNAME): $AGENT" | scn_diag
    SINCE_W="$(dst_now_ms vm)"
    # coord:send REQUIRES `summary` and `expects` (there is deliberately no
    # default for expects — an FYI must say 'none' explicitly), and `body` is an
    # ARRAY of sections; a plain string is refused. Getting this wrong reds BOTH
    # legs 2 and 3 for a runner reason that looks exactly like a dead wake rail.
    send_out="$(tower_mcp coord:send "{\"to\":[\"$AGENT\"],\"summary\":\"LIVE-1 parity wake-bridge probe $RUN\",\"body\":[{\"text\":\"Automated LIVE-1 cross-machine parity probe (WI-7000). No action needed — this message exists to prove the wake bridge and the delivery-receipt rail.\"}],\"expects\":\"none\",\"wake\":\"required\",\"scope\":\"hive\"}")"
    MSG_ID="$(printf '%s' "$send_out" | grep -oE '"msg_id"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed 's/.*: *"//; s/"$//')"
    # On success a 3-line tail is plenty; on FAILURE it swallowed the actual
    # error line (`unknown_recipient`) and cost a whole diagnostic round-trip,
    # so a failed send dumps every error-bearing line instead.
    if [ -n "$MSG_ID" ]; then
      echo "$send_out" | tail -3 | scn_diag "send: "
    else
      echo "$send_out" | grep -iE '"(error|message|reason)"|unknown_recipient|failed' | head -8 | scn_diag "send-ERR: "
    fi

    if wants wakebridge; then
      if [ "$(fed_assert_wake_bridge vm "$AGENT" "$SINCE_W" "$TRIES")" = "1" ]; then
        record wakebridge PASS "inbox-wake delivered on $VM_HOSTNAME for $AGENT"
      else
        record wakebridge FAIL "no delivered inbox-wake on $VM_HOSTNAME for $AGENT (see wake-bridge: line above for the statuses actually observed)"
      fi
    fi
    if wants receipts; then
      if [ -z "$MSG_ID" ]; then
        record receipts FAIL "coord:send returned no msg_id (see send: above)"
      elif [ "$(fed_assert_delivery_receipts tower "$MSG_ID" "$TRIES")" = "1" ]; then
        record receipts PASS "exactly 1 delivered receipt back on $TOWER_HOST for $MSG_ID"
      else
        record receipts FAIL "receipt count != 1 (or delivered!=true) for $MSG_ID — 0=dead rail, 2=M5a N-1 bug"
      fi
    fi
  fi
fi

# ── LEG 4 — claim-spec federation (P-016 + M7) ─────────────────────────────
# A scope:'hive' claim spec set on the tower must land on the Mac with
# origin='remote' AND both HLC stamps present (M7 / mig 439 regression guard).
if wants claimspec; then
  fed_log "LEG 4/5 — claim-spec federation (P-016 + M7)"
  BEE="live1-parity-bee-$RUN"
  SPEC='{"specVersion":"1.0","specId":"live1-parity-'"$RUN"'","revision":1,"view":{"filter":{"all":[{"op":"=","field":"kind","value":"bug"}]}},"rank":{"mode":"lexicographic","terms":[{"dir":"asc","expr":"severity_rank"}]},"limits":{"maxConcurrentClaims":1}}'
  spec_out="$(tower_mcp scheduler:set_claim_spec "{\"cupId\":\"$BEE\",\"spec\":$SPEC}")"
  echo "$spec_out" | tail -3 | scn_diag "spec: "
  if [ "$(fed_assert_claim_spec_federation vm "$BEE" "$TRIES")" = "1" ]; then
    record claimspec PASS "spec for $BEE landed on $VM_HOSTNAME origin=remote with fed_hlc+fed_ts"
  else
    record claimspec FAIL "spec for $BEE absent/unstamped on $VM_HOSTNAME (see spec: above)"
  fi
fi

# ── LEG 5 — presence gossip (P-004/P-005) — BOTH DIRECTIONS ────────────────
# Read-only: no flag flip needed. PRESENCE_GOSSIP GRADUATED 2026-07-16 (LIVE-1
# P-059 cutover) and is default-ON — the runbook-era "flip it on both machines
# first" step is obsolete.
#
# ⚠ WI-7029 — WHY THIS LEG ASSERTS TWICE, AND MUST NEVER GO BACK TO ONCE.
# fed_assert_presence_gossip takes <dst> <src_machine_label> and proves only
# that DST can see SRC. A single invocation therefore proves ONE direction, but
# the leg's name ("presence gossip") and its green get read as "presence gossip
# works cross-machine" — the D-018 / WI-7012 / WI-6680 failure class, where the
# instrument does not measure what its green is read to mean. Measured
# 2026-08-02: the tower carried ZERO rows for the Mac while the Mac carried
# fresh tower rows in both tables, and this leg had been reported green
# cross-machine (runbook run 1785661381) with the reverse direction dead the
# whole time.
#
# So: two recorded rows, each a hard red/green (no skip path — D-018). Both are
# selected by `--only presence`; a one-directional green is no longer expressible.
if wants presence; then
  fed_log "LEG 5/5 — presence gossip (P-004/P-005), both directions"

  # vm -> tower: the tower's roster must carry the Mac. This is the direction
  # target discovery (legs 2+3, parity.sh:254) depends on, so its red also
  # explains a "no roster-visible VM-homed session" wakebridge/receipts red.
  if [ "$(fed_assert_presence_gossip tower "$VM_MACHINE_LABEL" "$TRIES")" = "1" ]; then
    record presence PASS "vm->tower: $TOWER_HOST carries fresh presence+session rows for $VM_MACHINE_LABEL"
  else
    record presence FAIL "vm->tower: no fresh (<120s) rows for machine_label '$VM_MACHINE_LABEL' on $TOWER_HOST"
  fi

  # tower -> vm: the Mac's roster must carry the tower. Never assume this from
  # the leg above — they are independent rails and were observed disagreeing.
  if [ "$(fed_assert_presence_gossip vm "$TOWER_MACHINE_LABEL" "$TRIES")" = "1" ]; then
    record presence-rev PASS "tower->vm: $VM_HOSTNAME carries fresh presence+session rows for $TOWER_MACHINE_LABEL"
  else
    record presence-rev FAIL "tower->vm: no fresh (<120s) rows for machine_label '$TOWER_MACHINE_LABEL' on $VM_HOSTNAME"
  fi
fi

# ── verdict ─────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════"
echo " LIVE-1 PARITY VERDICT — run $RUN"
echo " rig: $TOWER_HOST (src)  <->  $VM_HOSTNAME (dst)   [two real machines]"
echo "════════════════════════════════════════════════════════════════"
for r in "${RESULTS[@]}"; do
  IFS='|' read -r leg st detail <<< "$r"
  printf ' %-4s %-12s %s\n' "$st" "$leg" "$detail"
done
echo "----------------------------------------------------------------"
echo " green=$PASSES  red=$FAILS"
if [ "$FAILS" -eq 0 ] && [ "$PASSES" -gt 0 ]; then
  echo " RESULT: GREEN"
  exit 0
fi
echo " RESULT: RED"
exit 1
