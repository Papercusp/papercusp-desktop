#!/usr/bin/env bash
# coord-p008-custody.sh — run P-008's RIG-CUSTODY legs (reconnect / catch-up /
# restart) against the REAL two-machine rig (tower <-> Mac VM).
#
# Third of the three P-008 drivers:
#   bin/vm-rig/coord-controlplane.sh    CC-1..CC-5   non-invasive
#   bin/vm-rig/coord-p008-remainder.sh  CR-1..CR-4   non-invasive
#   bin/vm-rig/coord-p008-custody.sh    CD-1..CD-7   ← INVASIVE, this one
#
# ⚠⚠ THIS DRIVER PERFORMS DAEMON LIFECYCLE EVENTS ON THE VM.
# It boots out and then re-bootstraps system/com.papercusp.server. Under D-028
# (plan p2p-coordination-public-release-2026-08-26) these legs require the rig
# custodian's release, because they corrupt any in-flight measurement on the
# endgame P-203 lane. Confirm the rig is free before running.
#
# It is NOT a deploy. No install, no app swap, no plist edit, no pgdata wipe. The
# VM comes back on the SAME pinned build it went down on. Verify that yourself:
# the driver prints the daemon's `program` path before and after.
#
# SOURCE ORDER IS LOAD-BEARING: bin/lib/deb-hetzner-rig.sh DEFINES its own container
# `drv_psql` (ssh to ${FRAME_IP[...]}). It must be sourced BEFORE the override below,
# never after, or every probe silently retargets a frame that does not exist here.
#
# ⚠ THE VM'S EMBEDDED PG PORT IS RANDOMIZED PER BOOT. A restart therefore INVALIDATES
# the port discovered at preflight. Every post-restart query must run against a
# RE-DISCOVERED port — otherwise each one fails to connect and the scenario reports
# "never arrived / durable loss", a false product verdict produced entirely by a
# stale port. cd_vm_healthy re-runs discover_vm for exactly this reason.
#
# Usage:  bin/vm-rig/coord-p008-custody.sh [--i-have-rig-custody]
# Env:    PCUSP_VM_SSH     ssh target   (default aviweiss@172.31.44.2)
#         PCUSP_TOWER_DSN  tower PG DSN (default harness_admin@127.0.0.1:5432)
#         PCUSP_RIG_HIVE   shared pot   (default papercusp)
# Exit:   0 all CD probes pass · 1 one or more red · 2 preflight failed (NO verdict)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$(cd "$HERE/../.." && pwd)"

VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
TOWER_DSN="${PCUSP_TOWER_DSN:-postgresql://harness_admin:harness_admin_pwd@127.0.0.1:5432/papercusp}"
RIG_HIVE_ID="${PCUSP_RIG_HIVE:-papercusp}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no)
DAEMON="system/com.papercusp.server"
PLIST="/Library/LaunchDaemons/com.papercusp.server.plist"

# ── custody acknowledgement ───────────────────────────────────────────────────
# Not a permission check — a speed bump, so this cannot be run by reflex alongside
# the two non-invasive drivers.
ACK=0
for arg in "$@"; do case "$arg" in --i-have-rig-custody) ACK=1 ;; esac; done
if [ "$ACK" != 1 ]; then
  cat >&2 <<'EOM'
REFUSING: this driver restarts the VM daemon (D-028 rig-custody legs).
Re-run with --i-have-rig-custody once you have confirmed:
  - the rig is free (no in-flight P-203 / endgame measurement),
  - no peer holds VM daemon restarts,
  - you are the rig custodian, or the custodian has released it.
EOM
  exit 2
fi

# shellcheck source=/dev/null
. "$DESKTOP/bin/lib/federation-asserts.sh"
# shellcheck source=/dev/null
. "$DESKTOP/bin/lib/deb-hetzner-rig.sh"
# shellcheck source=/dev/null
. "$DESKTOP/bin/lib/scenario-coord-p008-custody.sh"

# LOAD GUARD (the D-018 rule). A `.` of a missing path prints one line to stderr and
# KEEPS GOING under `set -uo pipefail`, so an unsourced scenario would reach the
# census and be reported as a red — a verdict manufactured by a driver that never
# ran a probe. A run that cannot load its subject aborts with NO verdict (exit 2).
for _fn in scenario_coord_p008_custody drv_psql fed_log _cd_ws _cd_insert _cd_arrives; do
  if [ "$(type -t "$_fn" 2>/dev/null)" != "function" ]; then
    echo "FATAL: '$_fn' is not defined after sourcing — the scenario/rig libraries did not load." >&2
    echo "  Refusing to emit a verdict from a run that cannot execute its probes." >&2
    exit 2
  fi
done

# ── the vm-rig adapter (mirrors coord-p008-remainder.sh) ──────────────────────
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
q="/tmp/cdp-q-$$.sql"
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

# ── VM daemon lifecycle (the seam the scenario calls) ─────────────────────────
# Deliberately launchctl, never pkill: a pattern kill from an agent shell can match
# the agent's OWN command line, and killing by name has twice taken down the wrong
# process on this fleet. launchctl addresses the job by label.
vm_daemon_program() {
  ssh "${SSH_OPTS[@]}" "$VM" "sudo -n launchctl print $DAEMON 2>/dev/null | awk '/program = /{print \$3; exit}'" 2>/dev/null
}

# ⚠ BOOTOUT IS ASYNCHRONOUS. `launchctl bootout` returns as soon as the request is
# accepted, NOT when the job has finished unloading — and a `bootstrap` issued into
# that window fails with "Bootstrap failed: 5: Input/output error". MEASURED on the
# first live run (2026-09-02T19:43Z): bootout succeeded, the immediate bootstrap
# silently failed, the job was absent from `launchctl list`, and the VM never came
# back. So this waits for the job to be genuinely GONE before returning.
cd_vm_down() {
  echo "    → launchctl bootout $DAEMON"
  ssh "${SSH_OPTS[@]}" "$VM" "sudo -n launchctl bootout $DAEMON" 2>&1 | sed 's/^/      /'
  # bootout exits non-zero when the job was already gone, so its status is not the
  # signal; the job's ACTUAL disappearance is. Wait for it, so the later bootstrap
  # is not issued into a half-torn-down job.
  local i
  for i in $(seq 1 20); do
    if ! ssh "${SSH_OPTS[@]}" "$VM" "sudo -n launchctl print $DAEMON >/dev/null 2>&1"; then
      echo "      job fully unloaded after ~$((i))s"
      return 0
    fi
    sleep 1
  done
  echo "      ⚠ job STILL loaded 20s after bootout — a bootstrap now would race it"
  return 1
}

# Bring the daemon back, and VERIFY it actually loaded. Returns non-zero when it
# did not, so the caller can report a SETUP failure instead of a product verdict.
#
# ⚠ THIS FUNCTION USED TO `return 0` UNCONDITIONALLY. That is precisely the
# setup-failure-disguised-as-a-finding defect this scenario file warns about in its
# header and guards against for INSERTs via _cd_insert — reproduced here in the
# lifecycle seam. A failed bring-back then surfaced as "CD-2 FAIL — vm did not come
# back", which reads exactly like a catch-up/product defect, when in fact no probe
# had been exercised at all. A bring-back that fails is a SETUP FAIL, never a CD verdict.
cd_vm_up() {
  local attempt out
  for attempt in 1 2 3; do
    echo "    → launchctl bootstrap/kickstart $DAEMON (attempt $attempt)"
    out="$(ssh "${SSH_OPTS[@]}" "$VM" "
      if sudo -n launchctl print $DAEMON >/dev/null 2>&1; then
        sudo -n launchctl kickstart -k $DAEMON 2>&1
      else
        sudo -n launchctl bootstrap system $PLIST 2>&1
      fi
    " 2>&1)"
    [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/      /'

    # The command's exit status is not trustworthy across ssh here; ask launchd what
    # it actually holds.
    if ssh "${SSH_OPTS[@]}" "$VM" "sudo -n launchctl print $DAEMON >/dev/null 2>&1"; then
      echo "      job is loaded"
      return 0
    fi
    echo "      job did NOT load (launchd does not know it) — settling before retry"
    sleep 5
  done
  echo "      ✗ could not bring $DAEMON back after 3 attempts"
  return 1
}

# Wait for the VM to be genuinely serving again, and RE-DISCOVER its embedded PG
# port — it is randomized per boot, so the preflight value is stale from here on.
cd_vm_healthy() {
  local secs="${1:-180}" waited=0 code=""
  while [ "$waited" -lt "$secs" ]; do
    code="$(ssh "${SSH_OPTS[@]}" "$VM" 'curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3070/api/health' 2>/dev/null)"
    if [ "$code" = "200" ] && discover_vm && [ "$(drv_psql vm "SELECT 'ok';" 2>/dev/null | tr -d '[:space:]')" = "ok" ]; then
      echo "      health=200, embedded PG re-discovered on port $VM_PG_PORT"
      return 0
    fi
    sleep 5; waited=$((waited + 5))
  done
  echo "      never became healthy within ${secs}s (last health='${code:-none}')"
  return 1
}

# ── preflight: two real machines, or abort with NO verdict (the D-018 rule) ───
fed_log "preflight: proving a real two-machine rig for the P-008 custody legs"

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

PROGRAM_BEFORE="$(vm_daemon_program)"
if [ -z "$PROGRAM_BEFORE" ]; then
  echo "FATAL: could not read $DAEMON's program path on the VM — refusing to restart a daemon whose identity I cannot confirm" >&2
  exit 2
fi
echo "  vm daemon program (before): $PROGRAM_BEFORE"

declare -A FRAME_MEMBER_SLUG=( [tower]="papercusp" [vm]="papercusp" )
export RIG_HIVE_ID

echo
echo "  ══ P-008 RIG-CUSTODY legs on the REAL rig ══"
echo "  owner (a) : tower = $TOWER_HOST   (stays up)"
echo "  member (b): vm    = $VM_HOSTNAME  (gets booted out + brought back)"
echo "  hive: $RIG_HIVE_ID   harness slug: ${FRAME_MEMBER_SLUG[tower]}"
echo

scenario_coord_p008_custody tower vm
rc=$?

# ── post-run: the VM must be UP, and on the SAME build it went down on ────────
echo
echo "── post-run rig state ──"
if cd_vm_healthy 120; then
  echo "  vm is UP and serving"
else
  echo "  ⚠⚠ VM IS NOT HEALTHY AFTER THIS RUN — the rig is left DOWN. Investigate before anything else."
  rc=1
fi
PROGRAM_AFTER="$(vm_daemon_program)"
echo "  vm daemon program (after) : ${PROGRAM_AFTER:-<unreadable>}"
if [ -n "$PROGRAM_AFTER" ] && [ "$PROGRAM_AFTER" != "$PROGRAM_BEFORE" ]; then
  echo "  ⚠ the daemon's program path CHANGED across this run — this driver does not install, so investigate before trusting any artifact claim."
  rc=1
elif [ -n "$PROGRAM_AFTER" ]; then
  echo "  ✓ same program path as before — the pinned build is unchanged by this run"
fi

echo
# rc=2 means the run could not EXERCISE its probes (setup/lifecycle failure). Reporting
# that as "probes FAILED" would manufacture a product verdict out of a rig problem, so
# the three outcomes stay distinct all the way to the exit status.
case "$rc" in
  0) echo "RESULT: ALL CD probes PASS on the real two-machine rig ($TOWER_HOST <-> $VM_HOSTNAME)" ;;
  2) echo "RESULT: NO VERDICT — the run could not exercise its probes (setup/lifecycle failure). This is NOT a federation finding; nothing about P-008 is proved or disproved." ;;
  *) echo "RESULT: one or more CD probes FAILED on the real two-machine rig ($TOWER_HOST <-> $VM_HOSTNAME)" ;;
esac
exit "$rc"
