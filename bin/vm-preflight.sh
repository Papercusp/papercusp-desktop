#!/usr/bin/env bash
# P-011 (desktop-build-hardening-tri-platform-2026-07-11): release:vm-preflight.
# The ONE canonical "is the VM's packaged operator actually alive + healthy?"
# check, so no agent re-hand-rolls the triad and misreads a HEALTHY operator as
# dead — the exact WI-3270 failure (Windows→WSL localhost-forward flake made
# supervision kill a healthy serve+PG, exhaust respawn caps, and let the distro
# die; recovery needed a manual app restart).
#
# The triad, in dependency order (WI-3270):
#   1. HOST: the VM process is running on the host (pgrep) — nothing else can be
#      true if the VM isn't booted.
#   2. VM: ssh reachable, and the desktop app process is alive (tasklist).
#   3. DISTRO: /api/health is 200 probed FROM INSIDE the WSL distro
#      (wsl -d <distro> --exec curl 127.0.0.1:<port>) — the AUTHORITATIVE operator
#      liveness signal. The outer Windows→WSL HTTP forward flakes (WI-3270); an
#      outer-probe failure must NEVER be read as operator death. This primitive
#      probes the inner path, and reports an inner-healthy/outer-failing split as
#      a NON-FATAL `forward-degraded` diagnostic (mirrors the main.rs fix:
#      effective reachable = inner || outer; repair the forward, don't kill).
#
# Verification standard (D-007, VMs unavailable + the Windows VM must NOT be
# touched — EI-9022 is gated on another session clearing 0.0.7): this script is
# `bash -n`-clean and exercised against a MOCK ssh/wsl responder covering every
# branch. It performs NO live VM run here.
#
# Usage:
#   vm-preflight.sh [options]
# Options:
#   --ssh-key PATH        (default $HOME/.ssh/papercup-vm-win)
#   --ssh-port PORT       (default 2223)
#   --ssh-host USER@HOST  (default user@127.0.0.1)
#   --distro NAME         (default papercup-runtime)
#   --app-image NAME      Windows image name for tasklist (default papercusp-desktop.exe)
#   --host-vm-pattern PAT pgrep -f pattern for the VM process on the host
#                         (default 'qemu.*(windows|win-|papercup-vm-win)')
#   --skip-host-pgrep     skip check 1 (e.g. VM launched outside this host's pgrep view)
#   --json                emit a machine-readable verdict to stdout
# Exit: 0 = operator genuinely healthy (forward-degraded still exits 0) ·
#       1 = a check failed (operator not verifiably healthy) · 2 = usage/setup.
set -uo pipefail

SSH_KEY="${VM_SSH_KEY:-$HOME/.ssh/papercup-vm-win}"
SSH_PORT="${VM_SSH_PORT:-2223}"
SSH_HOST="${VM_SSH_HOST:-user@127.0.0.1}"
DISTRO="${DISTRO:-papercup-runtime}"
APP_IMAGE="papercusp-desktop.exe"
HOST_VM_PATTERN='qemu.*(windows|win-|papercup-vm-win)'
SKIP_HOST_PGREP=0
JSON=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh-key) SSH_KEY="${2:-}"; shift 2 ;;
    --ssh-port) SSH_PORT="${2:-}"; shift 2 ;;
    --ssh-host) SSH_HOST="${2:-}"; shift 2 ;;
    --distro) DISTRO="${2:-}"; shift 2 ;;
    --app-image) APP_IMAGE="${2:-}"; shift 2 ;;
    --host-vm-pattern) HOST_VM_PATTERN="${2:-}"; shift 2 ;;
    --skip-host-pgrep) SKIP_HOST_PGREP=1; shift ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# The ssh binary is overridable (PC_SSH) so the check can be mock-driven without
# a live VM — the D-007 acceptance path while the Windows VM is untouchable.
SSH_BIN="${PC_SSH:-ssh}"
SSH=("$SSH_BIN" -i "$SSH_KEY" -p "$SSH_PORT" -o IdentitiesOnly=yes -o ConnectTimeout=10 -o BatchMode=yes "$SSH_HOST")
wsl_exec() { timeout 60 "${SSH[@]}" "wsl -d $DISTRO --user papercup --exec $*" 2>/dev/null | tr -d '\r\0'; }

FAILURES=()
NOTES=()
fail_check() { FAILURES+=("$1"); }
note() { NOTES+=("$1"); }

host_pgrep_ok=null
ssh_ok=null
app_ok=null
port=""
inner_code=""
outer_code=""
inner_ok=null
forward_degraded=false

# ── 1. HOST: VM process running ─────────────────────────────────────────────
if [[ "$SKIP_HOST_PGREP" == "1" ]]; then
  host_pgrep_ok=skipped
  note "host VM-process pgrep skipped (--skip-host-pgrep)"
else
  if pgrep -f "$HOST_VM_PATTERN" >/dev/null 2>&1; then
    host_pgrep_ok=true
  else
    host_pgrep_ok=false
    fail_check "host: no VM process matches /$HOST_VM_PATTERN/ (VM not booted?) — override with --host-vm-pattern or --skip-host-pgrep"
  fi
fi

# ── 2. VM: ssh reachable + app process alive ────────────────────────────────
if [[ "$host_pgrep_ok" == "false" ]]; then
  note "skipping VM/distro checks — host VM process not found"
else
  if "${SSH[@]}" 'cmd /c echo VM-OK' 2>/dev/null | tr -d '\r' | grep -q 'VM-OK'; then
    ssh_ok=true
    # app process (tasklist)
    if "${SSH[@]}" "tasklist /FI \"IMAGENAME eq $APP_IMAGE\" /FO csv /NH" 2>/dev/null | grep -q "$APP_IMAGE"; then
      app_ok=true
    else
      app_ok=false
      fail_check "vm: app process $APP_IMAGE not running (tasklist)"
    fi
    # ── serve discovery: operator.json + port (distro-side) ──
    opjson="$(wsl_exec cat /home/papercup/.papercusp/operator.json)"
    port="$(printf '%s' "$opjson" | grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*' | head -1)"
    if [[ -z "$port" ]]; then
      fail_check "distro: no operator.json / port inside $DISTRO (operator not started?)"
    fi
  else
    ssh_ok=false
    fail_check "vm: ssh unreachable on :$SSH_PORT ($SSH_HOST)"
  fi
fi

# ── 3. DISTRO: /api/health probed INSIDE the distro (WI-3270 authoritative) ──
if [[ -n "$port" ]]; then
  # Probe curl DIRECTLY (space-free args survive wsl_exec's $* flattening; a
  # `bash -c "quoted script"` would NOT). Mirrors the main.rs WI-3270 fix, which
  # runs `wsl --exec curl` in the distro. Output-based (not exit-code, which is
  # unreliable through ssh→cmd→wsl): a healthy 200 returns the /api/health JSON
  # body ({"sha":..,"version":..}); anything else is unhealthy/down.
  inner_out="$(wsl_exec curl -sS -m 5 http://127.0.0.1:$port/api/health)"
  if printf '%s' "$inner_out" | grep -qE '"sha"|"version"'; then
    inner_ok=true
    inner_code=200
  else
    inner_ok=false
    inner_code="err"
    fail_check "distro: /api/health did not return a healthy body probed INSIDE $DISTRO — operator genuinely unhealthy/down (NOT a forward flake)"
  fi

  # Outer Windows→WSL forward probe — DIAGNOSTIC ONLY. A failure here with a
  # healthy inner probe is `forward-degraded`, never operator death (WI-3270).
  outer_code="$("${SSH[@]}" "powershell -NoProfile -Command \"try { (Invoke-WebRequest -Uri http://127.0.0.1:$port/api/health -UseBasicParsing -TimeoutSec 10).StatusCode } catch { 0 }\"" 2>/dev/null | tr -d '\r[:space:]')"
  if [[ "$inner_ok" == "true" && "$outer_code" != "200" ]]; then
    forward_degraded=true
    note "forward-degraded: inner /api/health is 200 but the outer Windows→WSL probe returned '$outer_code' — REPAIR THE FORWARD, do NOT kill the operator (WI-3270)"
  fi
fi

ok=$([[ ${#FAILURES[@]} -eq 0 ]] && echo true || echo false)

if [[ "$JSON" == "1" ]]; then
  # Emit a compact JSON verdict (hand-built to avoid a python dep on the VM host path).
  printf '{\n'
  printf '  "ok": %s,\n' "$ok"
  printf '  "hostPgrep": "%s",\n' "$host_pgrep_ok"
  printf '  "ssh": "%s",\n' "$ssh_ok"
  printf '  "appProcess": "%s",\n' "$app_ok"
  printf '  "operatorPort": "%s",\n' "$port"
  printf '  "innerHealthCode": "%s",\n' "$inner_code"
  printf '  "innerHealthy": "%s",\n' "$inner_ok"
  printf '  "outerHealthCode": "%s",\n' "$outer_code"
  printf '  "forwardDegraded": %s,\n' "$forward_degraded"
  printf '  "failures": ['
  for i in "${!FAILURES[@]}"; do [[ $i -gt 0 ]] && printf ', '; printf '%s' "$(printf '%s' "${FAILURES[$i]}" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "${FAILURES[$i]}")"; done
  printf '],\n'
  printf '  "notes": ['
  for i in "${!NOTES[@]}"; do [[ $i -gt 0 ]] && printf ', '; printf '%s' "$(printf '%s' "${NOTES[$i]}" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "${NOTES[$i]}")"; done
  printf ']\n}\n'
else
  echo "vm-preflight: $([[ "$ok" == "true" ]] && echo PASS || echo FAIL)  distro=$DISTRO port=${port:-<none>}"
  echo "  host VM process: $host_pgrep_ok"
  echo "  vm ssh: $ssh_ok   app process ($APP_IMAGE): $app_ok"
  echo "  operator /api/health INSIDE distro: code=${inner_code:-<none>} healthy=$inner_ok"
  echo "  operator /api/health OUTER forward: code=${outer_code:-<none>} forwardDegraded=$forward_degraded"
  for n in "${NOTES[@]:-}"; do [[ -n "$n" ]] && echo "  note: $n"; done
  for f in "${FAILURES[@]:-}"; do [[ -n "$f" ]] && echo "  FAIL: $f"; done
fi

[[ "$ok" == "true" ]] && exit 0 || exit 1
