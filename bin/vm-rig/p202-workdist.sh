#!/usr/bin/env bash
# p202-workdist.sh — drive the LIVE-2 CROSS-MACHINE WORK-DISTRIBUTION acceptance
# against the REAL two-machine rig (tower <-> Mac VM).
#
#   plan p2p-public-release-endgame-2026-09-01  P-202
#   =    p2p-public-release-remaining-lanes-2026-07-16  P-205 / P-508  (evidence lands there)
#   authorized for fresh execution by D-073 (remaining-lanes, 2026-08-27)
#
# Fourth rig driver, and the first on the work-distribution lane:
#   bin/vm-rig/coord-controlplane.sh    CC-1..CC-5   coordination, non-invasive
#   bin/vm-rig/coord-p008-remainder.sh  CR-1..CR-4   coordination, non-invasive
#   bin/vm-rig/coord-p008-custody.sh    CD-1..CD-7   coordination, INVASIVE (daemon lifecycle)
#   bin/vm-rig/p202-workdist.sh         WD-1..WD-9   ← work distribution, this one
#
# ⚠ WHAT THIS DRIVER DOES TO THE RIG — read before running.
#   · It does NOT touch the daemon. No bootout, no bootstrap, no install, no app
#     swap, no plist edit, no pgdata wipe. The VM stays on the SAME pinned build
#     throughout, so no D-028/D-030 rig-custody gate applies to it.
#   · It DOES arm an owner-authority gate on the VM for the duration of the run:
#     the ACCEPT_DELEGATED_SEATS flag (papercusp-accept-delegated-seats, default
#     OFF / fail-closed). While armed, a remote fleet owner may spawn bounded
#     agents on the VM. The driver records the prior value and restores it from an
#     EXIT trap, so an interrupt cannot leave the gate open.
#   · It DOES cause ONE real bounded agent to be launched on the VM if every gate
#     passes — that is the leg P-202 exists to prove. The seat is the cheapest
#     available (haiku / effort low / count 1) precisely so the run is not a
#     meaningful draw on inference budget.
#   · It leaves behind one throwaway fleet + its offer rows, run-id suffixed, the
#     same way the matrix scenarios do.
#
# ⚠ SOURCE ORDER IS LOAD-BEARING. bin/lib/deb-hetzner-rig.sh DEFINES its own
# container `drv_psql` (ssh to ${FRAME_IP[...]}). It must be sourced BEFORE the
# override below, never after, or every probe silently retargets a frame that does
# not exist here.
#
# ⚠ THE VM'S EMBEDDED PG PORT IS RANDOMIZED PER BOOT, so it is discovered from the
# live postmaster's argv rather than hardcoded. This driver performs no restart, so
# one discovery at preflight is sound — but if you ever add one, re-discover after it.
#
# Usage:  bin/vm-rig/p202-workdist.sh --i-accept-live-spawn
# Env:    PCUSP_VM_SSH     ssh target   (default aviweiss@172.31.44.2)
#         PCUSP_TOWER_DSN  tower PG DSN (default harness_admin@127.0.0.1:5432)
#         PCUSP_TOWER_MCP  tower sidecar port (default 3070)
#         PCUSP_VM_MCP     VM sidecar port     (default 3070)
#         PCUSP_WS         workspace    (default papercusp-workspace)
# Exit:   0 all WD probes pass · 1 one or more red · 2 preflight/setup failed (NO verdict)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP="$(cd "$HERE/../.." && pwd)"

VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
TOWER_DSN="${PCUSP_TOWER_DSN:-postgresql://harness_admin:harness_admin_pwd@127.0.0.1:5432/papercusp}"
TOWER_MCP_PORT="${PCUSP_TOWER_MCP:-3070}"
VM_MCP_PORT="${PCUSP_VM_MCP:-3070}"
WS="${PCUSP_WS:-papercusp-workspace}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no)
GATE_FLAG='papercusp-accept-delegated-seats'

WD_RUNID="$(date -u +%Y%m%d%H%M%S)"
WD_FLEET="p202-physical-$WD_RUNID"
WD_PLAN="p2p-public-release-endgame-2026-09-01"
# WHICH shared hive the seat is advertised in. This workspace hosts more than one
# (papercusp and shared-hive-test-hive-2), and both resource:delegate and
# fleet:request_remote_spawn refuse to guess — resource:delegate answers
# `hive_required` outright. Passing the wrong one would publish the seat where the
# other host is not looking, which would surface as a federation red.
WD_HIVE="${PCUSP_RIG_HIVE:-papercusp}"

# ── deliberate speed bump ─────────────────────────────────────────────────────
# Not a permission check. This run arms a gate that lets a remote owner spawn on
# the VM and then boots a real agent there, so it must not be startable by reflex
# alongside the three coordination drivers.
ACK=0
for arg in "$@"; do case "$arg" in --i-accept-live-spawn) ACK=1 ;; esac; done
if [ "$ACK" != 1 ]; then
  cat >&2 <<'EOM'
REFUSING: this driver arms the VM's accept-delegated-seats gate and launches one
real bounded agent there (haiku/low, count 1).
Re-run with --i-accept-live-spawn once you have confirmed:
  - the rig is free (no in-flight coordination/endgame measurement),
  - you accept ONE cheap agent booting on the VM,
  - you accept the gate being ON for the duration (it is restored on exit).
It performs NO daemon lifecycle event, so no rig-custody release is required.
EOM
  exit 2
fi

# shellcheck source=/dev/null
. "$DESKTOP/bin/lib/federation-asserts.sh"
# shellcheck source=/dev/null
. "$DESKTOP/bin/lib/deb-hetzner-rig.sh"
# shellcheck source=/dev/null
. "$DESKTOP/bin/lib/scenario-p202-workdist.sh"

# LOAD GUARD (the D-018 rule). A `.` of a missing path prints one line to stderr and
# KEEPS GOING under `set -uo pipefail`, so an unsourced scenario would fall through
# to the verdict and be reported as a red — a verdict manufactured by a driver that
# never ran a probe. A run that cannot load its subject aborts with NO verdict.
for _fn in scenario_p202_workdist wd_verdict drv_psql _wd_wait _wd_mcp; do
  if [ "$(type -t "$_fn" 2>/dev/null)" != "function" ]; then
    echo "FATAL: '$_fn' is not defined after sourcing — the scenario/rig libraries did not load." >&2
    echo "  Refusing to emit a verdict from a run that cannot execute its probes." >&2
    exit 2
  fi
done

# ── the vm-rig adapter (mirrors coord-p008-custody.sh) ────────────────────────
VM_PG_PORT=""
VM_PSQL_BIN=""
VM_BUNDLE=""
VM_HOSTNAME=""

discover_vm() {
  local out
  # The Mac's embedded PG port is randomized per boot and there is no psql on its
  # PATH — the only one is inside the packaged app — so both are discovered from
  # the live postmaster/operator rather than hardcoded. Bind the bundle to the
  # UNIQUE process that owns the MCP port. A plain /Applications/Papercusp*.app
  # glob is not provenance: when GUI + Server are both installed it selects GUI
  # first even while Server owns :3070 (EI-22368619345712144).
  out="$({
    ssh "${SSH_OPTS[@]}" "$VM" "PORT='$VM_MCP_PORT' bash -s" <<'EOS'
    P=$(ps -axo args | grep "[e]mbedded-postgres" | grep -oE " -p [0-9]+" | grep -oE "[0-9]+" | head -1)
    L=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | sort -u)
    [ -n "$L" ] || exit 1
    [ "$(printf '%s\n' "$L" | wc -l | tr -d ' ')" = 1 ] || exit 1
    CMD=$(ps -o command= -p "$L" 2>/dev/null | sed 's/^[[:space:]]*//')
    # Between candidates the rig serves the P-007 rig-sidecar bundle
    # (~/rig-sidecar-current/serve.mjs) under the packaged app's node, so accept
    # that bundle too — still bound to the argv of the process owning the port.
    S=""
    for c in /Applications/Papercusp*.app/Contents/Resources/sidecar/serve.mjs "$HOME/rig-sidecar-current/serve.mjs"; do
      [ -f "$c" ] || continue
      case "$CMD" in *"$c"*) S="$c"; break ;; esac
    done
    [ -n "$S" ] || exit 1
    # psql ships beside the node that is actually running, in the same app.
    B=""
    for n in /Applications/Papercusp*.app/Contents/Resources/sidecar/bin/node; do
      case "$CMD" in "$n "*) B="${n%/node}/psql"; break ;; esac
    done
    [ -n "$B" ] || B="${S%/serve.mjs}/bin/psql"
    [ -x "$B" ] || exit 1
    printf "%s\t%s\t%s\t%s" "$P" "$B" "$S" "$(hostname)"
EOS
  } 2>/dev/null)" || return 1
  VM_PG_PORT="$(printf '%s' "$out" | cut -f1)"
  VM_PSQL_BIN="$(printf '%s' "$out" | cut -f2)"
  VM_BUNDLE="$(printf '%s' "$out" | cut -f3)"
  VM_HOSTNAME="$(printf '%s' "$out" | cut -f4)"
  [ -n "$VM_PG_PORT" ] && [ -n "$VM_PSQL_BIN" ] && [ -n "$VM_BUNDLE" ]
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
q="/tmp/p202-q-$$.sql"
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

# ── the product MCP seam ──────────────────────────────────────────────────────
# Mirrors scenarios/fleet-directory.sh's _fdir_mcp_call, re-homed onto the two
# physical hosts: same superuser-token read-or-generate (the sidecar re-reads the
# file per request, so a fresh write is honored), same ?workspace= scoping.
rig_mcp() {
  local inst="$1" tool="$2" args="$3"
  local body="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}"
  case "$inst" in
    tower)
      local f="$HOME/.papercusp/superuser-token" tok
      [ -s "$f" ] || { mkdir -p "$HOME/.papercusp"; head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40 > "$f"; chmod 600 "$f"; }
      tok="$(cat "$f" 2>/dev/null)"
      [ -n "$tok" ] || { echo "MCP_ERROR NO_TOKEN on tower"; return 1; }
      curl -s -m 90 -X POST "http://127.0.0.1:$TOWER_MCP_PORT/api/mcp?superuser=1&client=p202-workdist&workspace=$WS" \
        -H 'content-type: application/json' \
        -H 'accept: application/json, text/event-stream' \
        -H "authorization: Bearer $tok" -d "$body"
      ;;
    vm)
      local b64; b64="$(printf '%s' "$body" | base64 | tr -d '\n')"
      ssh "${SSH_OPTS[@]}" "$VM" "PORT='$VM_MCP_PORT' WS='$WS' B64='$b64' bash -s" <<'EOS'
f="$HOME/.papercusp/superuser-token"
[ -s "$f" ] || { mkdir -p "$HOME/.papercusp"; head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40 > "$f"; chmod 600 "$f"; }
TOK="$(cat "$f" 2>/dev/null)"
[ -n "$TOK" ] || { echo "MCP_ERROR NO_TOKEN on vm"; exit 1; }
d="/tmp/p202-mcp-$$.json"
printf '%s' "$B64" | base64 -d > "$d" || exit 9
curl -s -m 90 -X POST "http://127.0.0.1:$PORT/api/mcp?superuser=1&client=p202-workdist&workspace=$WS" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H "authorization: Bearer $TOK" -d @"$d"
rc=$?
rm -f "$d"
exit $rc
EOS
      ;;
    *) echo "MCP_ERROR unknown instance '$inst'"; return 1 ;;
  esac
}

# ── the artifact oracle ───────────────────────────────────────────────────────
# The shipped bundle is TREE-SHAKEN, so a symbol no production path reaches is
# ABSENT from the file: absence is signal, not noise. This interrogates THE
# ARTIFACT UNDER TEST, never the repo and never a human's memory of it.
wd_bundle_has() {
  local inst="$1" sym="$2"
  case "$inst" in
    vm)
      ssh "${SSH_OPTS[@]}" "$VM" "grep -qF -- '$sym' '$VM_BUNDLE'" >/dev/null 2>&1
      ;;
    *) return 1 ;;
  esac
}

# ── gate arming + guaranteed restore ─────────────────────────────────────────
#
# ⚠ RESTORING IS NOT "SET IT BACK TO FALSE". flag-override-store.ts layers TWO rows
# in harness_shared.operator_flag_overrides: the reserved '@global' row and a LEGACY
# per-workspace row, and "the EXISTENCE of the global row is the cutover marker —
# even an empty {} row supersedes every legacy workspace row". flags:set writes
# '@global'. So a key that is ABSENT from '@global' resolves to the CODE DEFAULT,
# and restoring it with `enabled:false` would not restore anything — it would PIN a
# brand-new override row where none existed, silently converting a default into a
# permanent decision on a machine that is a pinned-artifact rig.
# `enabled:null` is the documented CLEAR ("NOT the same as `false`"), and clearing
# is the correct restore whenever the key was absent to begin with.
# Measured on this VM at preflight time: '@global' does NOT carry this key (so the
# gate resolves to its code default OFF), while the legacy papercusp-workspace row
# DOES carry a stale `true` — inert, superseded, and left exactly as found.
GATE_PRIOR=""          # resolved value before the run (true|false)
GATE_PRIOR_PRESENT=0   # was the key present in the '@global' override row?
GATE_ARMED=0

# Read the AUTHORITATIVE override state straight from the VM's own PG, not from the
# resolved flags:get value — only the row tells us present-vs-absent, and that is the
# distinction restore turns on.
gate_global_state() {
  drv_psql vm "SELECT (payload ? '$GATE_FLAG')::text||':'||coalesce(payload->>'$GATE_FLAG','-') FROM harness_shared.operator_flag_overrides WHERE workspace_id='@global';" 2>/dev/null | tr -d '[:space:]'
}

restore_gate() {
  [ "$GATE_ARMED" = 1 ] || return 0
  local want_desc after resolved attempt
  if [ "$GATE_PRIOR_PRESENT" = 1 ]; then
    want_desc="enabled=$GATE_PRIOR (it had an explicit override before this run)"
    echo; echo "── restoring the VM's accept-delegated-seats override to $want_desc ──"
  else
    want_desc="CLEARED (no '@global' override existed before this run; the code default governs)"
    echo; echo "── restoring the VM's accept-delegated-seats override: $want_desc ──"
  fi

  # EI-22368854625222938: one flags:set clear returned without restoring the
  # authoritative row, and the EXIT trap walked away with the owner-authority
  # gate pinned ON. Restoration is a safety boundary, not best-effort cleanup:
  # retry the idempotent write and prove BOTH stored shape + resolved value.
  for attempt in $(seq 1 5); do
    if [ "$GATE_PRIOR_PRESENT" = 1 ]; then
      rig_mcp vm 'flags:set' \
        "{\"key\":\"$GATE_FLAG\",\"enabled\":$GATE_PRIOR,\"reason\":\"P-202 LIVE-2 drill $WD_RUNID: restoring the prior explicit override (attempt $attempt)\"}" >/dev/null 2>&1 || true
    else
      rig_mcp vm 'flags:set' \
        "{\"key\":\"$GATE_FLAG\",\"enabled\":null,\"reason\":\"P-202 LIVE-2 drill $WD_RUNID: clearing the temporary drill override (attempt $attempt)\"}" >/dev/null 2>&1 || true
    fi
    after="$(gate_global_state)"
    resolved="$(rig_mcp vm 'flags:get' "{\"key\":\"$GATE_FLAG\"}" 2>/dev/null | grep -oE 'true|false' | tail -1)"
    if [ "$GATE_PRIOR_PRESENT" = 1 ]; then
      if [ "$after" = "true:$GATE_PRIOR" ] && [ "$resolved" = "$GATE_PRIOR" ]; then
        echo "    restored (resolved=$resolved, @global row: $after, attempt=$attempt)"
        GATE_ARMED=0
        return 0
      fi
    elif [ "$after" = "false:-" ] && [ "$resolved" = "false" ]; then
      echo "    restored (override CLEARED from @global; resolved=$resolved, attempt=$attempt)"
      GATE_ARMED=0
      return 0
    fi
    echo "    restore attempt $attempt not yet verified (@global='$after', resolved='$resolved')" >&2
    sleep 2
  done

  echo "    ⚠⚠ GATE NOT RESTORED after 5 attempts — @global row reads '$after', resolved='$resolved'."
  echo "    The VM may still be accepting delegated seats. Fix it by hand on the VM:"
  echo "      flags:set { key:'$GATE_FLAG', enabled:null, reason:'restore after P-202 drill' }"
  return 1
}
trap restore_gate EXIT INT TERM

# ═════════════════════════════════════════════════════════════════════════════
echo "════════════════════════════════════════════════════════"
echo "P-202 LIVE-2 cross-machine work-distribution acceptance"
echo "  run id : $WD_RUNID"
echo "  fleet  : $WD_FLEET"
echo "  started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "════════════════════════════════════════════════════════"

echo
echo "── WD-0  PREFLIGHT (failures here are NO VERDICT, never a red) ──"

if ! psql "$TOWER_DSN" -tA -c 'SELECT 1;' >/dev/null 2>&1; then
  echo "  ⚠ SETUP FAIL: tower PG does not answer at $TOWER_DSN"; echo "RESULT: NO VERDICT"; exit 2
fi
TOWER_HOST="$(hostname)"
echo "    tower PG ok (host $TOWER_HOST)"

if ! discover_vm; then
  echo "  ⚠ SETUP FAIL: could not discover the VM's embedded PG port / psql / bundle over ssh ($VM)"
  echo "RESULT: NO VERDICT"; exit 2
fi
echo "    vm discovered: host=$VM_HOSTNAME pgport=$VM_PG_PORT"
echo "    vm bundle    : $VM_BUNDLE"

if ! drv_psql vm 'SELECT 1;' >/dev/null 2>&1; then
  echo "  ⚠ SETUP FAIL: VM PG does not answer on the discovered port $VM_PG_PORT"
  echo "RESULT: NO VERDICT"; exit 2
fi
echo "    vm PG ok"

VM_HEALTH="$(ssh "${SSH_OPTS[@]}" "$VM" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$VM_MCP_PORT/api/health" 2>/dev/null)"
if [ "$VM_HEALTH" != "200" ]; then
  echo "  ⚠ SETUP FAIL: VM operator health is '$VM_HEALTH', not 200"; echo "RESULT: NO VERDICT"; exit 2
fi
echo "    vm operator health 200"

# Both hosts must be in the SAME workspace, or every ?workspace= scoped call and
# every federation assertion below is about two unrelated partitions.
T_WS="$(drv_psql tower "SELECT DISTINCT workspace_id FROM harness_shared.pot_members WHERE pot_home_slug='papercusp' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
V_WS="$(drv_psql vm    "SELECT DISTINCT workspace_id FROM harness_shared.pot_members WHERE pot_home_slug='papercusp' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
if [ -z "$T_WS" ] || [ "$T_WS" != "$V_WS" ] || [ "$T_WS" != "$WS" ]; then
  echo "  ⚠ SETUP FAIL: workspace mismatch — tower='$T_WS' vm='$V_WS' expected='$WS'"
  echo "RESULT: NO VERDICT"; exit 2
fi
echo "    both hosts in workspace $WS, pot papercusp"

# The honor hook must SHIP on the VM, or the central leg of this drill cannot exist
# and a red would be meaningless.
if ! wd_bundle_has vm 'honorSpawnRequestFromProjection'; then
  echo "  ⚠ SETUP FAIL: honorSpawnRequestFromProjection is ABSENT from the VM's shipped bundle."
  echo "    The honor path does not ship on this build, so WD-5/WD-6 have no subject."
  echo "RESULT: NO VERDICT"; exit 2
fi
echo "    vm bundle ships honorSpawnRequestFromProjection"

# Prove BOTH MCP seams answer before any write, so a transport failure mid-run
# cannot be mistaken for a product refusal.
if ! rig_mcp tower 'flags:get' "{\"key\":\"$GATE_FLAG\"}" 2>/dev/null | grep -q 'result'; then
  echo "  ⚠ SETUP FAIL: the tower MCP seam did not answer on :$TOWER_MCP_PORT"; echo "RESULT: NO VERDICT"; exit 2
fi
GATE_READ="$(rig_mcp vm 'flags:get' "{\"key\":\"$GATE_FLAG\"}" 2>/dev/null)"
GATE_PRIOR="$(printf '%s' "$GATE_READ" | grep -oE 'true|false' | tail -1)"
if [ "$GATE_PRIOR" != "true" ] && [ "$GATE_PRIOR" != "false" ]; then
  echo "  ⚠ SETUP FAIL: could not read the VM's $GATE_FLAG value (got '$GATE_PRIOR')"; echo "RESULT: NO VERDICT"; exit 2
fi
GATE_GLOBAL_BEFORE="$(gate_global_state)"
# A freshly wiped rig DB (the P-007 fresh-join runs) has NO override rows at all, so
# the '@global' read returns zero rows. With no legacy rows either, the code default
# governs, exactly as when '@global' lacks the key — and the restore below leaves an
# empty '@global' row, which resolves identically. With legacy rows present, arming
# would be a real cutover, so that case still refuses.
if [ -z "$GATE_GLOBAL_BEFORE" ] &&
   [ "$(drv_psql vm "SELECT count(*) FROM harness_shared.operator_flag_overrides;" 2>/dev/null | tr -d '[:space:]')" = 0 ]; then
  GATE_GLOBAL_BEFORE="false:-"
  echo "    VM has no flag override rows at all; treating the key as absent from '@global'"
fi
case "$GATE_GLOBAL_BEFORE" in
  true:*)  GATE_PRIOR_PRESENT=1 ;;
  false:*) GATE_PRIOR_PRESENT=0 ;;
  *)
    echo "  ⚠ SETUP FAIL: could not read the VM's '@global' override row (got '$GATE_GLOBAL_BEFORE')."
    echo "    Without it, restore cannot tell CLEAR from PIN-false and could leave the gate wrong."
    echo "RESULT: NO VERDICT"; exit 2 ;;
esac
echo "    both MCP seams answer; VM gate resolves to enabled=$GATE_PRIOR"
echo "    VM '@global' override row for this key: $GATE_GLOBAL_BEFORE (present=$GATE_PRIOR_PRESENT)"

# ARM THE GATE — and arm it NOW, before WD-3 authors the spawn-request.
# delegated-spawn-honor.ts: "There is NO re-trigger on a later ACCEPT_DELEGATED_SEATS
# flip — a request that arrived while the gate was off just sits un-disposed and
# EXPIRES." Arming after the request federates would produce a false "honor leg broken".
if [ "$GATE_PRIOR" = "true" ]; then
  echo "    gate already resolves ON — leaving it as found"
  GATE_ARMED=1
else
  if ! rig_mcp vm 'flags:set' \
      "{\"key\":\"$GATE_FLAG\",\"enabled\":true,\"reason\":\"P-202 LIVE-2 cross-machine work-distribution acceptance drill $WD_RUNID (temporary; restored on exit)\"}" >/dev/null 2>&1; then
    echo "  ⚠ SETUP FAIL: flags:set could not arm $GATE_FLAG on the VM"; echo "RESULT: NO VERDICT"; exit 2
  fi
  # Mark ARMED before the read-back: if the write landed but the verify errored, the
  # trap must still run. Arming and failing to record it is the one ordering that
  # could leave the gate open.
  GATE_ARMED=1
  GATE_NOW="$(rig_mcp vm 'flags:get' "{\"key\":\"$GATE_FLAG\"}" 2>/dev/null | grep -oE 'true|false' | tail -1)"
  if [ "$GATE_NOW" != "true" ]; then
    echo "  ⚠ SETUP FAIL: armed $GATE_FLAG but it read back '$GATE_NOW' — the gate is not actually on,"
    echo "    so a silent honor hook below would be a rig artefact, not a finding."
    echo "RESULT: NO VERDICT"; exit 2
  fi
  echo "    gate ARMED on the VM (verified by read-back) — restore on exit will CLEAR it"
fi

echo "  ✓ WD-0 preflight complete — the run can exercise its probes"

# ═════════════════════════════════════════════════════════════════════════════
scenario_p202_workdist
SCEN_RC=$?

# A non-zero early return from the scenario is already accounted for in its
# counters; wd_verdict is the single place that turns counters into a verdict, so
# the driver and the scenario can never disagree about what a run MEANT.
wd_verdict
VERDICT_RC=$?

echo
echo "  rig: tower=$TOWER_HOST  vm=$VM_HOSTNAME  fleet=$WD_FLEET  finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$SCEN_RC" = 2 ] && [ "$VERDICT_RC" != 2 ]; then
  echo "  (scenario returned 2 — treating as NO VERDICT)"
  exit 2
fi
exit $VERDICT_RC
