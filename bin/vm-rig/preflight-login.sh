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
# any headless password reset, so recovery needs a human GUI login
# (spice://127.0.0.1:5930). WI-4070 burned days on the wrong (network) hypothesis
# because nothing asserted this invariant up front.
#
# Usage:  bin/vm-rig/preflight-login.sh [user@vm-ip]
# Env:    PCUSP_VM_SSH   default ssh target (default aviweiss@172.31.44.2)
# Exit:   0 = rig login healthy (app already up, OR auto-login invariant intact)
#         2 = kcpassword DRIFT — auto-login WILL fail. NOT owner-blocking: recover
#             it yourself with bin/vm-rig/boot-headless-current.sh RUN ON THE VM
#             (the operator runs headless at the loginwindow). A GUI login is
#             needed only to repair AUTO-login, i.e. durability across a reboot.
#         3 = app down for a DIFFERENT reason (invariant OK / unverifiable)
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

if [ "${procs:-0}" -gt 0 ] 2>/dev/null; then
  echo "PREFLIGHT: OK — Papercusp app is running on the VM."
  exit 0
fi

# 3. app is DOWN — diagnose WHY via the auto-login invariant.
echo "PREFLIGHT: app is DOWN — verifying the unattended-login invariant…"
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

  A HUMAN IS NEEDED ONLY FOR DURABILITY, and only eventually: a GUI login at
  spice://127.0.0.1:5930 is what repairs macOS AUTO-LOGIN (Secure Token blocks
  any headless password reset), so until then the app does NOT come back by
  itself after a VM reboot and the headless boot above must be re-run by hand.
  ⚠ DO NOT BLOCK A LANE ON THAT. This text used to say only "a human must log in",
  which reads as "the rig cannot run without the owner" — it is false, and on
  2026-08-09 it cost multiple wakes of an agent's lane sitting idle behind an
  owner escalation that was never actually required (fact:
  rig-dark-is-recoverable-headless-no-gui-login).
  See EI-13010 for the durable fix (keep kcpassword in sync on any password change).
EOF
exit 2
