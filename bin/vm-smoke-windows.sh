#!/usr/bin/env bash
# Windows-VM smoke for the installed Papercusp desktop app — the per-release
# gate (P-017 @ windows-desktop-release-readiness-2026-06-11). Run from the
# HOST with the VM booted (~/windows-vm/boot-windows.sh) and the app
# installed + launched (schtasks /run /tn papercusp-e2e).
#
# Checks, in dependency order:
#   1. VM reachable over ssh
#   2. papercup-runtime distro registered
#   3. app process alive
#   4. serve discovery file present (distro-side operator.json) + port
#   5. operator /api/health 200 (probed from inside the VM)
#   6. /api/backups 200 AND kopia detection ok (regression guard: the
#      WSLENV PATH/l clobber broke every distro-binary spawn — insight
#      windows-vm-desktop-testing-workflow §10)
#   7. agent-tools HTTP surface answers from true loopback (superuser
#      bearer; Windows→WSL traffic is NOT loopback — §"sharp edges")
#   8. zero PG ERROR lines in the boot log (fresh-DB schema gaps etc.)
#
# Exit 0 = all green; first failure exits 1 with the failing check named.

set -uo pipefail

VM_SSH_KEY="${VM_SSH_KEY:-$HOME/.ssh/papercup-vm-win}"
VM_SSH_PORT="${VM_SSH_PORT:-2223}"
VM_SSH_HOST="${VM_SSH_HOST:-user@127.0.0.1}"
DISTRO="${DISTRO:-papercup-runtime}"
SSH=(ssh -i "$VM_SSH_KEY" -p "$VM_SSH_PORT" -o ConnectTimeout=10 "$VM_SSH_HOST")

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; exit 1; }

wsl_exec() { timeout 60 "${SSH[@]}" "wsl -d $DISTRO --user papercup --exec $*" 2>/dev/null | tr -d '\r\0'; }

echo "==> 1. VM ssh"
"${SSH[@]}" 'cmd /c echo VM-OK' >/dev/null 2>&1 || fail "VM unreachable on :$VM_SSH_PORT"
pass "ssh ok"

echo "==> 2. distro registered"
"${SSH[@]}" 'wsl -l -v' 2>/dev/null | tr -d '\r\0' | grep -q "$DISTRO" || fail "distro $DISTRO not registered"
pass "$DISTRO registered"

echo "==> 3. app process"
"${SSH[@]}" 'tasklist /FI "IMAGENAME eq papercusp-desktop.exe" /FO csv /NH' 2>/dev/null \
  | grep -q papercusp-desktop || fail "papercusp-desktop.exe not running"
pass "app running"

echo "==> 4. serve discovery"
OPJSON="$(wsl_exec cat /home/papercup/.papercusp/operator.json)"
PORT="$(echo "$OPJSON" | grep -o '"port": *[0-9]*' | grep -o '[0-9]*' | head -1)"
[[ -n "$PORT" ]] || fail "no operator.json / port in the distro"
pass "operator.json names port $PORT"

echo "==> 5. operator health"
CODE="$("${SSH[@]}" "powershell -NoProfile -Command \"try { (Invoke-WebRequest -Uri http://127.0.0.1:$PORT/api/health -UseBasicParsing -TimeoutSec 15).StatusCode } catch { 0 }\"" 2>/dev/null | tr -d '\r[:space:]')"
[[ "$CODE" == "200" ]] || fail "/api/health returned '$CODE'"
pass "health 200"

echo "==> 6. backups + kopia detection"
BK="$("${SSH[@]}" "powershell -NoProfile -Command \"(Invoke-WebRequest -Uri http://127.0.0.1:$PORT/api/backups -UseBasicParsing -TimeoutSec 20).Content\"" 2>/dev/null | tr -d '\r')"
echo "$BK" | grep -q '"settings"' || fail "/api/backups gave no settings"
echo "$BK" | grep -q '"kopia":{"ok":true' || fail "kopia detection not ok: $(echo "$BK" | grep -o '"kopia":{[^}]*}')"
pass "backups 200, kopia ok"

echo "==> 7. agent-tools surface (true loopback)"
AT="$(wsl_exec sh -c "'tok=\$(cat /home/papercup/.papercusp/superuser-token); curl -s -m 20 -X POST -H \"Authorization: Bearer \$tok\" -H \"Content-Type: application/json\" -d {} http://127.0.0.1:$PORT/api/agent-tools/papercusp/list_workspaces'" )"
echo "$AT" | grep -q '"workspaces"' || fail "agent-tools list_workspaces failed: ${AT:0:160}"
pass "agent-tools dispatch ok"

echo "==> 8. PG errors in boot log"
NERR="$("${SSH[@]}" 'powershell -NoProfile -Command "((Get-Content C:\Users\user\papercusp-bk.log -ErrorAction SilentlyContinue) -match \"ERROR\" | Measure-Object).Count"' 2>/dev/null | tr -d '\r[:space:]')"
[[ "${NERR:-0}" == "0" ]] || fail "$NERR ERROR line(s) in papercusp-bk.log — read them before shipping"
pass "0 ERROR lines"

echo "ALL SMOKE CHECKS GREEN"
