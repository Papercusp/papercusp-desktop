#!/usr/bin/env bash
# P-012 (desktop-build-hardening-tri-platform-2026-07-11): release:install-and-relaunch-verify.
# The ONE canonical "did installing a new build ACTUALLY replace the running
# operator, in place, without losing its address?" check — the live proof that
# closes EI-9002 + WI-3783, so no agent re-hand-rolls it and mistakes a silent
# no-op update for a successful one.
#
# What it proves (the sequence, per platform):
#   1. BEFORE: snapshot the RUNNING operator — /api/health {sha,version} + its
#      sticky port (from operator.json). This is the pre-update operator.
#   2. PUSH: scp the new installer artifact to the VM.
#   3. INSTALL: run the installer. It replaces the app bytes on disk but the OLD
#      operator keeps serving (that is exactly the EI-9002 scenario).
#   4. RELAUNCH — WITHOUT TERMINATING. We DELIBERATELY never kill the app or the
#      operator. We only re-launch the (now newly-installed) app and let its
#      `serve --ensure` do the work: it must detect the build-identity mismatch,
#      terminate the stale foreign operator, and cold-start fresh. If we killed
#      the operator ourselves we would be testing a cold start, NOT the
#      adopt-vs-refuse decision that EI-9002 fixed. THIS IS LOAD-BEARING.
#   5. ASSERT FLIP (EI-9002): poll /api/health until sha (and version) FLIP from
#      the pre-update values to the installed artifact's own sha. If it never
#      flips, the install was a silent no-op update — the exact EI-9002 bug.
#   6. ASSERT STICKY-PORT-HOLD (WI-3783): the operator must come back on the SAME
#      port it held before. Pre-fix, every update moved the port (17043->18384)
#      because the sticky port was resolved before the stale operator was
#      terminated. A moved port fails long-lived pinned URLs (spawned members'
#      MCP configs, tutorial-runner --operator-url, dock CLIs).
#
# Verification standard (D-007; VMs unavailable + the Windows VM must NOT be
# touched — EI-9022): this script is `bash -n`-clean and exercised against a
# MOCK ssh/scp responder (PC_SSH / PC_SCP) that models the before->after flip.
# It performs NO live VM run here. The composed tool release:install-and-relaunch-verify
# wraps it and is dryRun-validated only (no VM contact).
#
# Usage:
#   install-and-relaunch-verify.sh --artifact PATH [options]
# Options:
#   --platform windows|mac|linux   (default windows — the EI-9002/WI-3783 platform)
#   --artifact PATH                the NEW installer to push+install (required)
#   --expected-sha SHA             the new build's sha; default: buildSha from a
#                                  build-provenance.json next to the artifact
#   --expected-version VER         optional; default: version from that provenance
#   --ssh-key / --ssh-port / --ssh-host / --distro / --app-image
#   --remote-dir DIR               where to scp the artifact (default per platform)
#   --install-cmd CMD              installer command; `__ARTIFACT__` -> remote path
#   --relaunch-cmd CMD             relaunch command (must NOT terminate the operator)
#   --flip-timeout SEC             how long to wait for the flip (default 180)
#   --install-timeout SEC          budget for the installer step (default 900);
#                                  a timeout FAILS the run (installer may still
#                                  be running detached on the VM — no relaunch)
#   --poll-interval SEC            poll cadence while waiting (default 5)
#   --json                         emit a machine-readable verdict
# Exit: 0 = flip happened AND port held (update genuinely replaced the operator
#       in place) · 1 = a verification assertion failed (no-flip / port-moved /
#       version-mismatch) · 2 = usage/setup (bad args, unreachable, nothing to flip).
set -uo pipefail

PLATFORM="windows"
ARTIFACT=""
EXPECTED_SHA=""
EXPECTED_VERSION=""
SSH_KEY="${VM_SSH_KEY:-$HOME/.ssh/papercup-vm-win}"
SSH_PORT="${VM_SSH_PORT:-2223}"
SSH_HOST="${VM_SSH_HOST:-user@127.0.0.1}"
DISTRO="${DISTRO:-papercup-runtime}"
APP_IMAGE="papercusp-desktop.exe"
REMOTE_DIR=""
INSTALL_CMD=""
RELAUNCH_CMD=""
OPJSON_PATH=""
FLIP_TIMEOUT="${FLIP_TIMEOUT:-180}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"
# 300s proved too short live (0.0.8: the 479M GUI installer needs ~5min; the
# 3.4GB Server payload far more) — and a timeout-killed ssh leaves the VM-side
# installer RUNNING detached, so the step must fail loudly, never barrel on.
INSTALL_TIMEOUT="${INSTALL_TIMEOUT:-900}"
JSON=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) PLATFORM="${2:-}"; shift 2 ;;
    --artifact) ARTIFACT="${2:-}"; shift 2 ;;
    --expected-sha) EXPECTED_SHA="${2:-}"; shift 2 ;;
    --expected-version) EXPECTED_VERSION="${2:-}"; shift 2 ;;
    --ssh-key) SSH_KEY="${2:-}"; shift 2 ;;
    --ssh-port) SSH_PORT="${2:-}"; shift 2 ;;
    --ssh-host) SSH_HOST="${2:-}"; shift 2 ;;
    --distro) DISTRO="${2:-}"; shift 2 ;;
    --app-image) APP_IMAGE="${2:-}"; shift 2 ;;
    --remote-dir) REMOTE_DIR="${2:-}"; shift 2 ;;
    --install-cmd) INSTALL_CMD="${2:-}"; shift 2 ;;
    --relaunch-cmd) RELAUNCH_CMD="${2:-}"; shift 2 ;;
    --flip-timeout) FLIP_TIMEOUT="${2:-}"; shift 2 ;;
    --install-timeout) INSTALL_TIMEOUT="${2:-}"; shift 2 ;;
    --poll-interval) POLL_INTERVAL="${2:-}"; shift 2 ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,55p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[[ -n "$ARTIFACT" ]] || { echo "need --artifact PATH (the new installer to push+install)" >&2; exit 2; }
[[ -f "$ARTIFACT" ]] || { echo "artifact not found: $ARTIFACT" >&2; exit 2; }
REMOTE_BASENAME="$(basename "$ARTIFACT")"

# ── JSON field extractors (health body + provenance) ────────────────────────
json_str() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -1; }
json_num() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" | head -1; }

# ── Per-platform defaults ───────────────────────────────────────────────────
# windows = the validated platform (EI-9002/WI-3783 live on the WSL operator).
# mac/linux command DEFAULTS are provided but their install/relaunch specifics
# are caller-overridable and validated by RENDER only (no live mac/linux VM here).
case "$PLATFORM" in
  windows)
    REMOTE_DIR="${REMOTE_DIR:-C:/Users/user}"
    OPJSON_PATH="/home/papercup/.papercusp/operator.json"        # distro-side (absolute)
    # The GUI must be CLOSED before a silent install: Inno's RestartManager
    # cannot close an app across sessions (ssh session vs console session ->
    # "Session Mismatch"), so with /SUPPRESSMSGBOXES the file-in-use box is
    # auto-answered Abort and the whole install rolls back (exit 5 — live-
    # diagnosed on the 0.0.8 GUI install, 2026-07-11). Killing the GUI does NOT
    # terminate the WSL-side operator: the stale operator surviving app exit is
    # exactly the EI-9002 scenario the flip assertion exists to test.
    INSTALL_CMD="${INSTALL_CMD:-taskkill /f /im $APP_IMAGE >nul 2>&1 & __ARTIFACT__ /VERYSILENT /SUPPRESSMSGBOXES /NORESTART}"
    RELAUNCH_CMD="${RELAUNCH_CMD:-schtasks /run /tn papercusp-e2e}"
    ;;
  mac)
    REMOTE_DIR="${REMOTE_DIR:-/tmp}"
    OPJSON_PATH="\$HOME/.papercusp/operator.json"                # remote shell expands $HOME
    INSTALL_CMD="${INSTALL_CMD:-installer -pkg __ARTIFACT__ -target CurrentUserHomeDirectory}"
    RELAUNCH_CMD="${RELAUNCH_CMD:-open -n \"/Applications/Papercusp GUI.app\"}"
    ;;
  linux)
    REMOTE_DIR="${REMOTE_DIR:-/tmp}"
    OPJSON_PATH="\$HOME/.papercusp/operator.json"
    INSTALL_CMD="${INSTALL_CMD:-sudo dpkg -i __ARTIFACT__}"
    RELAUNCH_CMD="${RELAUNCH_CMD:-systemctl --user restart papercusp-desktop.service}"
    ;;
  *) echo "unknown --platform: $PLATFORM (want windows|mac|linux)" >&2; exit 2 ;;
esac
REMOTE_ARTIFACT="$REMOTE_DIR/$REMOTE_BASENAME"
# Real artifacts have spaces ("Papercusp GUI_0.0.7_x64-setup.exe"). Quoting is
# needed ONLY where a remote SHELL parses the path (install/relaunch via ssh —
# double quotes: cmd.exe-safe on Windows AND bash-safe on mac/linux). The scp
# TARGET must stay UNQUOTED: modern OpenSSH scp defaults to SFTP mode (no remote
# shell), so embedded quotes are literal and fail `dest open ""C:/...""`
# (live-repro'd on the 0.0.8 windows verify, 2026-07-11).
REMOTE_Q="\"$REMOTE_ARTIFACT\""

# ── Resolve expected sha/version from the artifact's own provenance ─────────
# (D-002 spirit: the target of the flip is the INSTALLED artifact's own build sha,
# not "the latest release" — so a rollback install is verified the same way.)
if [[ -z "$EXPECTED_SHA" || -z "$EXPECTED_VERSION" ]]; then
  PROV="$(dirname "$ARTIFACT")/build-provenance.json"
  if [[ -f "$PROV" ]]; then
    [[ -z "$EXPECTED_SHA" ]] && EXPECTED_SHA="$(json_str buildSha < "$PROV")"
    [[ -z "$EXPECTED_VERSION" ]] && EXPECTED_VERSION="$(json_str version < "$PROV")"
  fi
fi
[[ -n "$EXPECTED_SHA" ]] || { echo "need --expected-sha (or a build-provenance.json next to the artifact naming buildSha)" >&2; exit 2; }

# ── ssh/scp transport (PC_SSH / PC_SCP overridable for the D-007 mock path) ─
SSH_BIN="${PC_SSH:-ssh}"
SCP_BIN="${PC_SCP:-scp}"
SSH=("$SSH_BIN" -i "$SSH_KEY" -p "$SSH_PORT" -o IdentitiesOnly=yes -o ConnectTimeout=10 -o BatchMode=yes "$SSH_HOST")

# op_exec: run a command in the operator's network namespace. On Windows the
# operator lives INSIDE the WSL distro, so wrap in `wsl --exec` (space-free args
# survive $* flattening — a quoted `bash -c` would not; mirrors vm-preflight.sh);
# on mac/linux it runs directly on the VM host.
op_exec() {
  if [[ "$PLATFORM" == "windows" ]]; then
    timeout 60 "${SSH[@]}" "wsl -d $DISTRO --user papercup --exec $*" 2>/dev/null | tr -d '\r\0'
  else
    timeout 60 "${SSH[@]}" "$*" 2>/dev/null | tr -d '\r\0'
  fi
}
discover_port() { op_exec cat "$OPJSON_PATH" | json_num port; }
# Retry a few times: a single `wsl --exec` flap (transient, empty output) must
# not abort the whole verify as "no healthy pre-update operator".
read_health() {
  local _port="$1" _body="" _i
  for _i in 1 2 3; do
    _body="$(op_exec curl -sS -m 5 "http://127.0.0.1:$_port/api/health")"
    [[ -n "$_body" ]] && break
    sleep 2
  done
  printf '%s' "$_body"
}

FAILURES=()
NOTES=()
fail_check() { FAILURES+=("$1"); }
note() { NOTES+=("$1"); }

# ── Reachability ────────────────────────────────────────────────────────────
if [[ "$PLATFORM" == "windows" ]]; then
  REACH_CMD='cmd /c echo VM-OK'
else
  REACH_CMD='echo VM-OK'
fi
if ! "${SSH[@]}" "$REACH_CMD" 2>/dev/null | tr -d '\r' | grep -q 'VM-OK'; then
  echo "vm unreachable on :$SSH_PORT ($SSH_HOST) — cannot establish the pre-update baseline" >&2
  exit 2
fi

# ── 1. BEFORE snapshot ──────────────────────────────────────────────────────
PORT_BEFORE="$(discover_port)"
SHA_BEFORE=""; VERSION_BEFORE=""
if [[ -n "$PORT_BEFORE" ]]; then
  BODY_BEFORE="$(read_health "$PORT_BEFORE")"
  SHA_BEFORE="$(printf '%s' "$BODY_BEFORE" | json_str sha)"
  VERSION_BEFORE="$(printf '%s' "$BODY_BEFORE" | json_str version)"
fi
if [[ -z "$PORT_BEFORE" || -z "$SHA_BEFORE" ]]; then
  echo "no healthy pre-update operator (port='$PORT_BEFORE' sha='$SHA_BEFORE') — nothing to update in place" >&2
  exit 2
fi
if [[ "$SHA_BEFORE" == "$EXPECTED_SHA" ]]; then
  echo "pre-update operator already reports the target sha $EXPECTED_SHA — nothing to flip (stale target or already-updated)" >&2
  exit 2
fi

# ── 2. PUSH ─────────────────────────────────────────────────────────────────
if ! "$SCP_BIN" -i "$SSH_KEY" -P "$SSH_PORT" -o IdentitiesOnly=yes -o BatchMode=yes "$ARTIFACT" "$SSH_HOST:$REMOTE_ARTIFACT"; then
  fail_check "push: scp of $REMOTE_BASENAME to $REMOTE_ARTIFACT failed"
fi

# ── 3. INSTALL (does NOT terminate the operator) ────────────────────────────
if [[ ${#FAILURES[@]} -eq 0 ]]; then
  INSTALL_RUN="${INSTALL_CMD//__ARTIFACT__/$REMOTE_Q}"
  # Capture (don't discard) installer output — a swallowed exit code cost a full
  # diagnose cycle on 0.0.8 (locked-file Abort looked like a silent no-op).
  INSTALL_RC=0
  INSTALL_OUT="$(timeout "$INSTALL_TIMEOUT" "${SSH[@]}" "$INSTALL_RUN" 2>&1 | tr -d '\r\0')" || INSTALL_RC=$?
  if [[ "$INSTALL_RC" -eq 124 ]]; then
    # timeout(1) killed the SSH SESSION, not the VM-side installer — it is very
    # likely STILL RUNNING detached. Relaunching now re-locks the app files under
    # it (live-hit on 0.0.8 attempt-4: relaunch mid-install recreated the exact
    # file-in-use race the taskkill exists to prevent). Fail loudly instead.
    fail_check "install: timed out after ${INSTALL_TIMEOUT}s (ssh killed; the VM-side installer may still be running detached) — NOT relaunching; re-probe VM process/disk state before any retry, or raise --install-timeout"
  elif [[ "$INSTALL_RC" -ne 0 ]]; then
    note "installer exit was non-zero ($INSTALL_RC; some silent installers do this; the flip assertion is authoritative)${INSTALL_OUT:+ — output: ${INSTALL_OUT:0:400}}"
  fi
fi

# ── 4. RELAUNCH — WITHOUT TERMINATING (serve --ensure must do the replacement) ─
if [[ ${#FAILURES[@]} -eq 0 ]]; then
  timeout 60 "${SSH[@]}" "$RELAUNCH_CMD" >/dev/null 2>&1 || note "relaunch command exit was non-zero"
fi

# ── 5+6. Poll for the FLIP, then assert sticky-port-hold ────────────────────
FLIPPED=false
PORT_AFTER=""
SHA_AFTER=""
VERSION_AFTER=""
if [[ ${#FAILURES[@]} -eq 0 ]]; then
  DEADLINE=$(( $(date +%s) + FLIP_TIMEOUT ))
  while :; do
    PORT_AFTER="$(discover_port)"
    if [[ -n "$PORT_AFTER" ]]; then
      BODY_AFTER="$(read_health "$PORT_AFTER")"
      SHA_AFTER="$(printf '%s' "$BODY_AFTER" | json_str sha)"
      VERSION_AFTER="$(printf '%s' "$BODY_AFTER" | json_str version)"
    fi
    if [[ -n "$SHA_AFTER" && "$SHA_AFTER" == "$EXPECTED_SHA" ]]; then FLIPPED=true; break; fi
    [[ $(date +%s) -ge $DEADLINE ]] && break
    sleep "$POLL_INTERVAL"
  done

  # FLIP (EI-9002): sha must have moved from the pre-update value to the artifact's own.
  if [[ "$FLIPPED" != "true" ]]; then
    fail_check "EI-9002: /api/health sha did NOT flip to $EXPECTED_SHA within ${FLIP_TIMEOUT}s (still '$SHA_AFTER', was '$SHA_BEFORE') — the install did not replace the running operator (silent no-op update)"
  fi
  # VERSION (when known): must reach the expected version too.
  if [[ "$FLIPPED" == "true" && -n "$EXPECTED_VERSION" && "$VERSION_AFTER" != "$EXPECTED_VERSION" ]]; then
    fail_check "version did not reach $EXPECTED_VERSION after the flip (got '$VERSION_AFTER')"
  fi
  # STICKY-PORT-HOLD (WI-3783): the operator must return on the SAME port.
  if [[ "$FLIPPED" == "true" && "$PORT_AFTER" != "$PORT_BEFORE" ]]; then
    fail_check "WI-3783: operator port moved $PORT_BEFORE -> $PORT_AFTER across the update — the sticky port was not preserved (long-lived pinned URLs break)"
  fi
fi

ok=$([[ ${#FAILURES[@]} -eq 0 ]] && echo true || echo false)

if [[ "$JSON" == "1" ]]; then
  jstr() { printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$1"; }
  printf '{\n'
  printf '  "ok": %s,\n' "$ok"
  printf '  "platform": %s,\n' "$(jstr "$PLATFORM")"
  printf '  "expectedSha": %s,\n' "$(jstr "$EXPECTED_SHA")"
  printf '  "expectedVersion": %s,\n' "$(jstr "$EXPECTED_VERSION")"
  printf '  "shaBefore": %s,\n' "$(jstr "$SHA_BEFORE")"
  printf '  "versionBefore": %s,\n' "$(jstr "$VERSION_BEFORE")"
  printf '  "portBefore": %s,\n' "$(jstr "$PORT_BEFORE")"
  printf '  "shaAfter": %s,\n' "$(jstr "$SHA_AFTER")"
  printf '  "versionAfter": %s,\n' "$(jstr "$VERSION_AFTER")"
  printf '  "portAfter": %s,\n' "$(jstr "$PORT_AFTER")"
  printf '  "flipped": %s,\n' "$FLIPPED"
  printf '  "portHeld": %s,\n' "$([[ -n "$PORT_AFTER" && "$PORT_AFTER" == "$PORT_BEFORE" ]] && echo true || echo false)"
  printf '  "failures": ['
  for i in "${!FAILURES[@]}"; do [[ $i -gt 0 ]] && printf ', '; printf '%s' "$(jstr "${FAILURES[$i]}")"; done
  printf '],\n'
  printf '  "notes": ['
  for i in "${!NOTES[@]}"; do [[ $i -gt 0 ]] && printf ', '; printf '%s' "$(jstr "${NOTES[$i]}")"; done
  printf ']\n}\n'
else
  echo "install-and-relaunch-verify: $([[ "$ok" == "true" ]] && echo PASS || echo FAIL)  platform=$PLATFORM"
  echo "  before: sha=$SHA_BEFORE version=$VERSION_BEFORE port=$PORT_BEFORE"
  echo "  after:  sha=$SHA_AFTER version=$VERSION_AFTER port=$PORT_AFTER  (target sha=$EXPECTED_SHA)"
  echo "  flipped=$FLIPPED  port-held=$([[ -n "$PORT_AFTER" && "$PORT_AFTER" == "$PORT_BEFORE" ]] && echo yes || echo no)"
  for n in "${NOTES[@]:-}"; do [[ -n "$n" ]] && echo "  note: $n"; done
  for f in "${FAILURES[@]:-}"; do [[ -n "$f" ]] && echo "  FAIL: $f"; done
fi

[[ "$ok" == "true" ]] && exit 0 || exit 1
