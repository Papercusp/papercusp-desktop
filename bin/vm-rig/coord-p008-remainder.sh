#!/usr/bin/env bash
# coord-p008-remainder.sh — run the P-008 coordination legs that CC-1..CC-5 do
# NOT cover, against the REAL two-machine rig (tower <-> Mac VM).
#
# Sibling of bin/vm-rig/coord-controlplane.sh, same adapter, same preflight, same
# load guard. That driver runs scenario_coord_control_plane (CC-1..CC-5); this one
# runs scenario_coord_p008_remainder (CR-1..CR-4):
#
#   CR-1  a→b  conversation row (coord_conversations) federates
#   CR-2  a→b  conversation thread POST (coord_threads + coord_thread_posts) federates
#   CR-3  a→b→a  a DIRECTED REPLY reaches the ORIGIN with its related_msg_id linkage
#   CR-4  a→b  NEGATIVE: a row scoped to a harness b is not a member of must NOT cross
#
# A full P-008 coordination-only witness is BOTH drivers green. The rig-custody
# legs (reconnect / catch-up / restart) are NOT here — under D-028 they wait on the
# P-203 window because they SIGTERM/kickstart the VM daemon.
#
# NOT AN APP DEPLOY. No bootout, kickstart, launchctl, install or restart. Reads,
# plus INSERTs of rows tagged `ccp-probe`. Safe to run while a build's evidence
# window is open.
#
# SOURCE ORDER IS LOAD-BEARING: bin/lib/deb-hetzner-rig.sh DEFINES its own container
# `drv_psql` (ssh to ${FRAME_IP[...]}). It must be sourced BEFORE the override below,
# never after, or every probe silently retargets a frame that does not exist here.
#
# Usage:  bin/vm-rig/coord-p008-remainder.sh
# Env:    PCUSP_VM_SSH     ssh target   (default aviweiss@172.31.44.2)
#         PCUSP_TOWER_DSN  tower PG DSN (default harness_admin@127.0.0.1:5432)
#         PCUSP_RIG_HIVE   shared pot   (default papercusp)
# Exit:   0 all CR probes pass · 1 one or more red · 2 preflight failed (NO verdict)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# $HERE is bin/vm-rig, so the desktop root is TWO levels up, not one.
DESKTOP="$(cd "$HERE/../.." && pwd)"

VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
TOWER_DSN="${PCUSP_TOWER_DSN:-postgresql://harness_admin:harness_admin_pwd@127.0.0.1:5432/papercusp}"
RIG_HIVE_ID="${PCUSP_RIG_HIVE:-papercusp}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no)

# shellcheck source=/dev/null
. "$DESKTOP/bin/lib/federation-asserts.sh"
# shellcheck source=/dev/null
. "$DESKTOP/bin/lib/deb-hetzner-rig.sh"
# shellcheck source=/dev/null
. "$DESKTOP/bin/lib/scenario-coord-p008-remainder.sh"

# LOAD GUARD (the D-018 rule). A `.` of a missing path prints one line to stderr and
# KEEPS GOING under `set -uo pipefail`, so an unsourced scenario would reach the
# census and be reported as "one or more CR probes FAILED" — a verdict manufactured
# by a driver that never ran a probe. A run that cannot load its subject aborts with
# NO verdict (exit 2), never a red.
for _fn in scenario_coord_p008_remainder drv_psql fed_log _cr_ws _cr_wait_present _cr_wait_absent; do
  if [ "$(type -t "$_fn" 2>/dev/null)" != "function" ]; then
    echo "FATAL: '$_fn' is not defined after sourcing — the scenario/rig libraries did not load." >&2
    echo "  Refusing to emit a verdict from a run that cannot execute its probes." >&2
    exit 2
  fi
done

# ── the vm-rig adapter (mirrors parity.sh / coord-controlplane.sh) ────────────
VM_PG_PORT=""
VM_PSQL_BIN=""
VM_HOSTNAME=""

discover_vm() {
  local out
  # The Mac's embedded PG port is randomized per boot and there is no psql on its
  # PATH — the only one is inside the packaged app — so both are discovered from
  # the live postmaster's argv rather than hardcoded.
  out="$(ssh "${SSH_OPTS[@]}" "$VM" '
    P=$(ps -axo args | grep "[e]mbedded-postgres" | grep -oE " -p [0-9]+" | grep -oE "[0-9]+" | head -1)
    B=""
    for c in /Applications/Papercusp*.app/Contents/Resources/sidecar/bin/psql; do
      [ -x "$c" ] && B="$c" && break
    done
    printf "%s\t%s\t%s" "$P" "$B" "$(hostname)"
  ' 2>/dev/null)" || return 1
  VM_PG_PORT="$(printf '%s' "$out" | cut -f1)"
  VM_PSQL_BIN="$(printf '%s' "$out" | cut -f2)"
  VM_HOSTNAME="$(printf '%s' "$out" | cut -f3)"
  [ -n "$VM_PG_PORT" ] && [ -n "$VM_PSQL_BIN" ]
}

drv_psql_rig() {
  local inst="$1" sql="$2"
  case "$inst" in
    tower)
      psql "$TOWER_DSN" -tA -c "$sql"
      ;;
    vm)
      # base64 across the ssh boundary: the Mac's psql path contains a space and
      # the assert SQL is full of single quotes.
      local b64; b64="$(printf '%s' "$sql" | base64 | tr -d '\n')"
      ssh "${SSH_OPTS[@]}" "$VM" \
        "PSQLB='$VM_PSQL_BIN' DSN='postgresql://harness_admin:harness_admin_pwd@127.0.0.1:$VM_PG_PORT/papercusp' B64='$b64' bash -s" <<'EOS'
q="/tmp/crp-q-$$.sql"
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
# THE OVERRIDE. Must come after the deb-hetzner-rig.sh source above.
drv_psql() { drv_psql_rig "$@"; }

# ── preflight: two real machines, or abort with NO verdict (the D-018 rule) ───
fed_log "preflight: proving a real two-machine rig for the P-008 remainder legs"

TOWER_HOST="$(hostname)"
tower_ok="$(psql "$TOWER_DSN" -tA -c "SELECT 'ok';" 2>&1 | tr -d '[:space:]')"
if [ "$tower_ok" != "ok" ]; then
  echo "FATAL: tower PG unreachable via \$PCUSP_TOWER_DSN" >&2
  echo "  $tower_ok" >&2
  exit 2
fi
echo "  tower : $TOWER_HOST — PG ok"

if ! discover_vm; then
  echo "FATAL: could not discover the VM's embedded PG port / bundled psql over ssh ($VM)" >&2
  echo "  Check the app is running on the VM." >&2
  exit 2
fi
vm_ok="$(drv_psql vm "SELECT 'ok';" 2>&1 | tr -d '[:space:]')"
if [ "$vm_ok" != "ok" ]; then
  echo "FATAL: VM PG unreachable (port $VM_PG_PORT via $VM_PSQL_BIN)" >&2
  echo "  $vm_ok" >&2
  exit 2
fi
echo "  vm    : $VM_HOSTNAME — PG ok (embedded, port $VM_PG_PORT)"

if [ "$TOWER_HOST" = "$VM_HOSTNAME" ]; then
  echo "FATAL: tower and vm resolved to the SAME host ($TOWER_HOST) — not a two-machine rig" >&2
  exit 2
fi

for inst in tower vm; do
  n="$(drv_psql "$inst" "SELECT count(*) FROM harness_shared.pot_members WHERE pot_home_slug='$RIG_HIVE_ID';" 2>/dev/null | tr -d '[:space:]')"
  if [ -z "$n" ] || [ "$n" = "0" ]; then
    echo "FATAL: $inst has no pot_members row for pot '$RIG_HIVE_ID' — the scenario could not resolve a real workspace_id" >&2
    exit 2
  fi
  echo "  $inst pot '$RIG_HIVE_ID' members: $n"
done

declare -A FRAME_MEMBER_SLUG=( [tower]="papercusp" [vm]="papercusp" )
export RIG_HIVE_ID

echo
echo "  ══ P-008 remainder legs on the REAL rig ══"
echo "  owner (a) : tower = $TOWER_HOST"
echo "  member (b): vm    = $VM_HOSTNAME"
echo "  hive: $RIG_HIVE_ID   harness slug: ${FRAME_MEMBER_SLUG[tower]}"
echo

scenario_coord_p008_remainder tower vm
rc=$?

echo
if [ "$rc" = 0 ]; then
  echo "RESULT: ALL CR probes PASS on the real two-machine rig ($TOWER_HOST <-> $VM_HOSTNAME)"
else
  echo "RESULT: one or more CR probes FAILED on the real two-machine rig ($TOWER_HOST <-> $VM_HOSTNAME)"
fi
exit "$rc"
