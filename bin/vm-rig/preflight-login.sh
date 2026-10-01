#!/usr/bin/env bash
# preflight-login.sh — assert the rig VM's UNATTENDED-LOGIN invariant BEFORE a
# drill relies on it, so a silently-dark rig fails LOUD with the real diagnosis
# instead of masquerading as a network/DHT wedge (the WI-4070 / EI-13010 class).
#
# THE TRAP THIS GUARDS: macOS auto-login SILENTLY stops firing when
# /etc/kcpassword drifts from the account password. The Mac then sits at the
# loginwindow, the Papercusp LaunchAgent never starts, and the whole federation
# rig goes dark (procs=0, zero origin='remote' rows on the tower) — with NO crash
# and NO error, so it reads EXACTLY like a swarm/DHT failure. Secure Token blocks
# a headless password RESET, but no reset is needed when the CURRENT password is
# known: re-encoding /etc/kcpassword from it over `ssh … sudo -n` repairs
# auto-login with no GUI (done 2026-10-01, WI-10004800 — see the FAIL(2) text).
# WI-4070 burned days on the wrong (network) hypothesis because nothing asserted
# this invariant up front.
#
# Usage:  bin/vm-rig/preflight-login.sh [user@vm-ip]
# Env:    PCUSP_VM_SSH   default ssh target (default aviweiss@172.31.44.2)
# Exit:   0 = rig login healthy (the Hono operator's /api/health is healthy)
#         2 = kcpassword DRIFT — auto-login WILL fail. NOT owner-blocking: recover
#             it yourself with bin/vm-rig/boot-headless-current.sh RUN ON THE VM
#             (the operator runs headless at the loginwindow). A GUI login is
#             needed only to repair AUTO-login, i.e. durability across a reboot.
#         3 = no healthy operator endpoint (invariant OK / unverifiable, or a
#             Papercusp process exists without a ready Hono listener)
#         4 = VM unreachable over SSH
#
# NB: never prints the decoded password — only PASS/FAIL of the invariant.
set -uo pipefail
VM="${1:-${PCUSP_VM_SSH:-aviweiss@172.31.44.2}}"
VM_USER="${VM%@*}"
SSH=(ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$VM")

# 1. reachability
if ! "${SSH[@]}" true 2>/dev/null; then
  echo "PREFLIGHT: FAIL(4) — VM $VM unreachable over SSH" >&2
  exit 4
fi

# 2. current state (console user + app process count)
state="$("${SSH[@]}" 'printf "%s %s" "$(stat -f %Su /dev/console 2>/dev/null)" "$(pgrep -f "Papercusp|serve.mjs" 2>/dev/null | wc -l | tr -d " ")"' 2>/dev/null)"
console="${state%% *}"; procs="${state##* }"; procs="${procs:-0}"
echo "PREFLIGHT: console=$console papercusp_procs=$procs"

# 3. prove operator readiness from the VM itself. A process-name match is not
# enough: the GUI/sidecar, a stale child, or a root/console ownership split can
# leave Papercusp processes present while the Hono server has no usable port.
# The health body identifies the Papercusp operator, so an unrelated local HTTP
# service cannot make this preflight green. Discovery files are diagnostic only;
# the listener + /api/health response is the readiness signal.
operator_port="$("${SSH[@]}" '
  set -u
  if command -v lsof >/dev/null 2>&1; then
    cands=$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null \
      | grep -oE "127\\.0\\.0\\.1:[0-9]+|\\*:[0-9]+" \
      | grep -oE "[0-9]+$" | sort -u)
  elif command -v ss >/dev/null 2>&1; then
    cands=$(ss -tlnH 2>/dev/null | awk "{print \$4}" \
      | grep -oE "[0-9]+$" | sort -u)
  else
    cands=""
  fi
  printf "%s\n" "$cands" | while IFS= read -r p; do
    case "$p" in ""|*[!0-9]*) continue ;; esac
    health=$(curl -fsS -m 2 "http://127.0.0.1:$p/api/health" 2>/dev/null || true)
    if printf "%s" "$health" \
      | grep -qE "\"service\"[[:space:]]*:[[:space:]]*\"papercusp-operator\""; then
      printf "%s\\n" "$p"
      exit 0
    fi
  done
  exit 1
' 2>/dev/null | head -1 || true)"
case "$operator_port" in
  ""|*[!0-9]*) operator_port="" ;;
esac

if [ -n "$operator_port" ]; then
  echo "PREFLIGHT: OK — Hono operator /api/health is healthy on :$operator_port (Papercusp processes=$procs)."
  exit 0
fi

# A process without a healthy endpoint is an operator readiness failure, not a
# healthy app. Do not let this path fall through to kcpassword: auto-login is
# irrelevant while a process is already running, and the actionable diagnosis
# is the sidecar/startup/port ownership path.
if [ "${procs:-0}" -gt 0 ] 2>/dev/null; then
  echo "PREFLIGHT: FAIL(3) — Papercusp process(es) present ($procs), but no local Hono /api/health endpoint returned 200. Process presence is not operator readiness; inspect operator.json, sidecar startup/logs, and console/root ownership." >&2
  exit 3
fi

# 4. app is DOWN — diagnose WHY via the auto-login invariant.
echo "PREFLIGHT: app is DOWN — no healthy Hono /api/health endpoint; verifying the unattended-login invariant…"
hex="$("${SSH[@]}" 'sudo od -An -tx1 /etc/kcpassword 2>/dev/null' 2>/dev/null | tr -d ' \n')"
if [ -z "$hex" ]; then
  echo "PREFLIGHT: FAIL(3) — app down and /etc/kcpassword unreadable (no auto-login configured, or sudo blocked). Human GUI login likely needed." >&2
  exit 3
fi
# decode kcpassword on the TOWER (standard XOR cipher); never echo the result.
pw="$(python3 - "$hex" <<'PY'
import sys
key=[0x7D,0x89,0x52,0x23,0xD2,0xBC,0xDD,0xEA,0xA3,0xB9,0x1F]
b=bytes.fromhex(sys.argv[1])
out=[]
for i,ch in enumerate(b):
    x=ch^key[i%len(key)]
    if x==0: break
    out.append(x)
sys.stdout.write(bytes(out).decode('latin1'))
PY
)"
if [ -z "$pw" ]; then
  echo "PREFLIGHT: FAIL(3) — /etc/kcpassword decoded empty; auto-login unverifiable. Human GUI login likely needed." >&2
  exit 3
fi
# verify the decoded password authenticates the account — password via stdin so
# it never lands in a process arg or the terminal.
if printf '%s\n' "$pw" | "${SSH[@]}" "IFS= read -r p; dscl . -authonly '$VM_USER' \"\$p\" >/dev/null 2>&1 && echo AUTH_OK || echo AUTH_FAIL" 2>/dev/null | grep -q AUTH_OK; then
  echo "PREFLIGHT: app down but the auto-login invariant is INTACT (kcpassword authenticates '$VM_USER')." >&2
  echo "PREFLIGHT: FAIL(3) — cause is NOT kcpassword drift; investigate the LaunchAgent / boot path." >&2
  exit 3
fi
cat >&2 <<EOF
PREFLIGHT: FAIL(2) — kcpassword DRIFT DETECTED.
  /etc/kcpassword no longer authenticates the '$VM_USER' account, so macOS
  auto-login will NOT fire: the VM sits at the loginwindow and the entire
  federation rig stays DARK (procs=0, no origin='remote' rows on the tower).
  This is the WI-4070 / EI-13010 silent-death class — NOT a network/DHT wedge.

  RECOVERY (you can do this YOURSELF — no human, no GUI, ~40s):
      scp bin/vm-rig/boot-headless-current.sh $VM:/tmp/
      ssh $VM 'bash /tmp/boot-headless-current.sh'
  The operator runs headless over ssh even while the VM sits at the loginwindow;
  that is what this rig actually needs. Verified 2026-08-09: this preflight went
  2 -> 0 and the tower's open-channel samples went 0/4086 to 57/1597.
  ⚠ RUN IT ON THE VM, NOT THE TOWER. From the tower it dies "FATAL: missing
  /Applications/Papercusp Server.app/.../bin/node" — it is checking the TOWER's
  Linux filesystem. That FATAL looks like a broken rig and is not.

  DURABILITY (auto-login across reboots) is ALSO repairable headlessly when the
  account's CURRENT password is known (agent memory: the Mac VM GUI password).
  Verify it first, read-only:  ssh \$VM 'dscl . -authonly $VM_USER <password>'
  then re-encode /etc/kcpassword from it (back up the old file; sudo -n works on
  the rig): XOR <password>+NUL with 7D 89 52 23 D2 BC DD EA A3 B9 1F (cycled),
  zero-pad to a multiple of 12 bytes, write root:wheel 0600. Reboot to confirm
  the console reaches $VM_USER. Done 2026-10-01 (WI-10004800): the file had
  drifted to encode the USERNAME. Only an UNKNOWN password needs a human GUI
  login at spice://127.0.0.1:5930 (Secure Token blocks a headless RESET).
  ⚠ DO NOT BLOCK A LANE ON THAT. This text used to say only "a human must log in",
  which reads as "the rig cannot run without the owner" — it is false, and on
  2026-08-09 it cost multiple wakes of an agent's lane sitting idle behind an
  owner escalation that was never actually required (fact:
  rig-dark-is-recoverable-headless-no-gui-login).
  See EI-13010 for the durable fix (keep kcpassword in sync on any password change).
EOF
exit 2
