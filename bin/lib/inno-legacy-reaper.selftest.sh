#!/usr/bin/env bash
# inno-legacy-reaper.selftest.sh — guards the Inno [Code] legacy-uninstall
# reaper in src-tauri/windows/inno/papercusp.iss (WI-4490).
#
# WHY THIS EXISTS
# The reaper deletes stale Add/Remove Programs keys left by the NSIS-era
# installer scheme, whose uninstall.exe no longer exists. It is guarded by
# UninstallTargetExists() so a LIVE install's entry is never deleted. Nothing
# tested any of it: no test file anywhere referenced papercusp.iss, and a real
# false-positive (an unquoted UninstallString containing a space — which every
# Papercusp path has — judged a live uninstaller "missing" and deleted a real
# install's entry) sat undetected for three weeks until it was found by hand
# (EI-19481728463683227). This is the detector that was missing.
#
# WHAT IT ASSERTS — both directions, both quoting styles:
#   ghost key (UninstallString target absent)  -> MUST be reaped
#   live  key (UninstallString target present) -> MUST be spared
# The "live is spared" case is the falsifiability control: without it a reaper
# that blanket-deletes by display name would pass.
#
# HERMETIC-ish: no network, no docker, no ssh. It does need the Windows build
# toolchain (wine + Inno Setup's ISCC) that bin/build-windows-cross.sh already
# requires. Where that is not provisioned this SKIPS with exit 0 rather than
# failing, so it is safe in any gate; on a Windows-build box it runs for real.
#
#   bash bin/lib/inno-legacy-reaper.selftest.sh   # 0 = pass or skip, 1 = FAIL
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ISS="$DIR/../../src-tauri/windows/inno/papercusp.iss"
WINEPREFIX_INNO="${PAPERCUSP_WINEPREFIX_INNO:-$HOME/.papercusp/wine-inno}"
ISCC_EXE="${PAPERCUSP_ISCC_EXE:-$WINEPREFIX_INNO/drive_c/InnoSetup6/ISCC.exe}"

skip() { echo "SKIP inno-legacy-reaper: $1"; exit 0; }
KEEP_WORK=0
fail() {
  echo "FAIL inno-legacy-reaper: $1" >&2
  if [[ -n "${WORK:-}" && -d "${WORK:-}" ]]; then
    KEEP_WORK=1
    echo "DIAGNOSTICS PRESERVED AT: $WORK" >&2
  fi
  exit 1
}

# Match the uninstall test's three-way registry result: 0 = present,
# 1 = confirmed absent, 2 = failed/unreadable instrument. A timeout or Wine
# failure must never count as evidence that the reaper deleted a ghost key.
key_exists() {
  local key=$1 output status line expected
  if output=$(WINEPREFIX="$TESTPREFIX" timeout 30 wine reg query "$key" 2>&1); then
    status=0
  else
    status=$?
  fi
  if [[ -n "${WORK:-}" ]]; then
    printf 'registry query %s (exit %s):\n%s\n' "$key" "$status" "$output" >>"$WORK/registry-queries.log"
  fi
  if [[ $status -eq 1 && ${output,,} == *"unable to find the specified registry key or value"* ]]; then
    return 1
  fi
  if [[ $status -eq 0 ]]; then
    expected=${key/#HKCU/HKEY_CURRENT_USER}
    while IFS= read -r line; do
      [[ ${line,,} != "${expected,,}" ]] || return 0
    done <<<"${output//$'\r'/}"
  fi
  printf 'registry query failed or was unreadable for %s (exit %s): %s\n' "$key" "$status" "$output" >&2
  return 2
}

require_key_present() {
  local key=$1 label=$2 status
  if key_exists "$key"; then
    return 0
  else
    status=$?
  fi
  [[ $status -ne 1 ]] || fail "$label: confirmed absent; fixture did not establish its precondition"
  fail "$label: registry query failed (status $status); case measured nothing"
}

assert_key_state() {
  local key=$1 expected=$2 pass_message=$3 fail_message=$4 actual status
  if key_exists "$key"; then
    actual=present
  else
    status=$?
    [[ $status -eq 1 ]] || fail "registry query failed for $key (status $status); case measured nothing"
    actual=absent
  fi
  if [[ $actual == "$expected" ]]; then
    echo "  $pass_message"
  else
    echo "  $fail_message"
    RC=1
  fi
}

# These fault controls run in the maintained shell suite even without Wine.
# Exercise the actual assertion, not only the query classifier: an unchecked
# nonzero result in the ghost branch would otherwise still falsely pass.
registry_contract_selftest() {
  local root mockbin output status mode
  root=$(mktemp -d "${TMPDIR:-/tmp}/inno-reaper-registry.XXXXXX") || fail "registry fixture mktemp failed"
  mockbin="$root/bin"
  mkdir -p "$mockbin" "$root/work" || fail "registry fixture mkdir failed"
  cat >"$mockbin/wine" <<'MOCK_REGISTRY'
#!/usr/bin/env bash
case "$MOCK_REGISTRY_MODE" in
  present) printf 'HKEY_CURRENT_USER\\Software\\PapercuspSelftest\r\n'; exit 0 ;;
  absent) printf 'reg: Unable to find the specified registry key or value\n' >&2; exit 1 ;;
  denied) printf 'ERROR: Access is denied.\n' >&2; exit 13 ;;
  timeout) printf 'reg: Unable to find the specified registry key or value\n' >&2; exit 124 ;;
  unreadable) printf 'unrecognized successful output\n'; exit 0 ;;
  wrong-key) printf 'HKEY_CURRENT_USER\\Software\\OtherKey\r\n'; exit 0 ;;
esac
MOCK_REGISTRY
  chmod +x "$mockbin/wine"
  local PATH="$mockbin:$PATH" TESTPREFIX="$root/prefix" WORK="$root/work" RC=0
  local MOCK_REGISTRY_MODE=present
  export MOCK_REGISTRY_MODE
  require_key_present 'HKCU\Software\PapercuspSelftest' 'present control'
  assert_key_state 'HKCU\Software\PapercuspSelftest' present 'live entry spared' 'LIVE ENTRY DELETED'
  [[ $RC -eq 0 ]] || fail "present key control failed (diagnostics: $root)"
  MOCK_REGISTRY_MODE=absent
  assert_key_state 'HKCU\Software\PapercuspSelftest' absent 'ghost reaped' 'GHOST NOT REAPED'
  [[ $RC -eq 0 ]] || fail "absent key control failed (diagnostics: $root)"
  assert_key_state 'HKCU\Software\PapercuspSelftest' present 'live entry spared' 'LIVE ENTRY DELETED' >"$root/product-failure.log"
  [[ $RC -eq 1 ]] || fail "confirmed missing live key did not fail the product assertion (diagnostics: $root)"
  RC=0
  MOCK_REGISTRY_MODE=present
  assert_key_state 'HKCU\Software\PapercuspSelftest' absent 'ghost reaped' 'GHOST NOT REAPED' >>"$root/product-failure.log"
  [[ $RC -eq 1 ]] || fail "surviving ghost key did not fail the product assertion (diagnostics: $root)"
  for mode in denied timeout unreadable wrong-key; do
    MOCK_REGISTRY_MODE=$mode
    if output=$(assert_key_state 'HKCU\Software\PapercuspSelftest' absent 'ghost reaped' 'GHOST NOT REAPED' 2>&1); then
      fail "$mode query falsely reached a ghost verdict (diagnostics: $root)"
    fi
    [[ $output == *"case measured nothing"* && $output != *"ghost reaped"* && $output != *"GHOST NOT REAPED"* ]] \
      || fail "$mode query lost its instrument failure (diagnostics: $root)"
    if output=$(require_key_present 'HKCU\Software\PapercuspSelftest' 'seed control' 2>&1); then
      fail "$mode query falsely satisfied a seed precondition (diagnostics: $root)"
    fi
    [[ $output == *"case measured nothing"* ]] || fail "$mode seed failure was misclassified (diagnostics: $root)"
  done
  [[ -s "$WORK/registry-queries.log" ]] || fail "registry fault diagnostics missing (diagnostics: $root)"
  rm -rf "$root"
  echo "  ✓ registry controls distinguish present/absent from denied, timeout, unreadable and wrong-key results"
}

# Reuse the private lifecycle used by inno-uninstall-cleanup.selftest.sh:
# the server must not shut its listener while flushing between client phases.
owned_display() { xvfb-run -a "$@"; }
start_wine_server() { WINEPREFIX="$TESTPREFIX" timeout 30 wineserver -p; }
stop_wine_server() {
  WINEPREFIX="$TESTPREFIX" timeout 30 wineserver -k || return
  WINEPREFIX="$TESTPREFIX" timeout 30 wineserver -w
}

# Registered with this maintained selftest, even when Wine is unavailable.
# The clients refuse a missing server or another display; the negative control
# proves that merely starting a display does not satisfy the lifecycle contract.
lifecycle_contract_selftest() {
  local root mockbin actual status
  root=$(mktemp -d "${TMPDIR:-/tmp}/inno-reaper-lifecycle.XXXXXX") || fail "lifecycle fixture mktemp failed"
  mockbin="$root/bin"
  mkdir -p "$mockbin"
  cat >"$mockbin/xvfb-run" <<'MOCK_DISPLAY'
#!/usr/bin/env bash
[[ "$1" == -a ]] || exit 70
shift
export DISPLAY=:owned-reaper-selftest
echo display-start >>"$MOCK_LIFECYCLE_LOG"
"$@"
status=$?
echo display-stop >>"$MOCK_LIFECYCLE_LOG"
exit "$status"
MOCK_DISPLAY
  cat >"$mockbin/wineserver" <<'MOCK_SERVER'
#!/usr/bin/env bash
[[ "$WINEPREFIX" == "$MOCK_PREFIX" ]] || exit 71
case "$1" in
  -p) echo server-persist >>"$MOCK_LIFECYCLE_LOG"
      [[ "${MOCK_NO_PERSIST:-0}" == 1 ]] || touch "$MOCK_SERVER_STATE" ;;
  -k) echo server-stop >>"$MOCK_LIFECYCLE_LOG"; rm -f "$MOCK_SERVER_STATE" ;;
  -w) echo server-wait >>"$MOCK_LIFECYCLE_LOG"; [[ "${MOCK_WAIT_FAIL:-0}" != 1 ]] || exit 73 ;;
  *) exit 72 ;;
esac
MOCK_SERVER
  cat >"$mockbin/wine" <<'MOCK_CLIENT'
#!/usr/bin/env bash
[[ "$WINEPREFIX" == "$MOCK_PREFIX" && "${DISPLAY:-}" == :owned-reaper-selftest && -f "$MOCK_SERVER_STATE" ]] || exit 74
echo client >>"$MOCK_LIFECYCLE_LOG"
MOCK_CLIENT
  chmod +x "$mockbin/xvfb-run" "$mockbin/wineserver" "$mockbin/wine"
  {
    printf '#!/usr/bin/env bash\nset -euo pipefail\n'
    declare -f start_wine_server stop_wine_server
    printf 'TESTPREFIX="$MOCK_PREFIX"\ntrap '\''stop_wine_server || exit 1'\'' EXIT\n'
    printf 'start_wine_server\nexport WINEPREFIX="$TESTPREFIX"\nwine boot\nwine compiler\nwine registry\n'
  } >"$root/probe.sh"
  actual=$(declare -f owned_display)
  for mode in no-persistence wait-failure persistent; do
    : >"$root/lifecycle.log"
    rm -f "$root/server-state"
    status=0
    PATH="$mockbin:$PATH" MOCK_PREFIX="$root/prefix" MOCK_SERVER_STATE="$root/server-state" \
      MOCK_LIFECYCLE_LOG="$root/lifecycle.log" MOCK_NO_PERSIST=$([[ "$mode" == no-persistence ]] && echo 1 || echo 0) \
      MOCK_WAIT_FAIL=$([[ "$mode" == wait-failure ]] && echo 1 || echo 0) \
      bash -c "$actual; owned_display bash \"\$1\"" _ "$root/probe.sh" >"$root/output.log" 2>&1 || status=$?
    if [[ "$mode" == persistent ]]; then
      [[ $status -eq 0 ]] || fail "persistent lifecycle control failed (diagnostics: $root)"
      [[ $(cat "$root/lifecycle.log") == $'display-start\nserver-persist\nclient\nclient\nclient\nserver-stop\nserver-wait\ndisplay-stop' ]] \
        || fail "private server/display lifecycle ordering failed (diagnostics: $root)"
    else
      [[ $status -ne 0 ]] || fail "$mode negative control falsely passed (diagnostics: $root)"
    fi
  done
  rm -rf "$root"
  echo "  ✓ lifecycle rejects nonpersistent server and failed shutdown; one display spans clients and wait"
}

if [[ "${1:-}" != --owned-wine-session ]]; then
  lifecycle_contract_selftest
  registry_contract_selftest
fi

[[ -f "$ISS" ]] || fail "papercusp.iss not found at $ISS"
command -v wine     >/dev/null 2>&1 || skip "wine not installed"
command -v xvfb-run >/dev/null 2>&1 || skip "xvfb-run not installed"
command -v wineserver >/dev/null 2>&1 || skip "wineserver not installed"
[[ -f "$ISCC_EXE" ]] || skip "ISCC not provisioned at $ISCC_EXE"

if [[ "${1:-}" != --owned-wine-session ]]; then
  owned_display bash "$0" --owned-wine-session
  exit "$?"
fi

# Scratch + a throwaway wine prefix. Both must live somewhere WE own: wine
# refuses to create a prefix under a directory it does not own (a shared /tmp).
WORK="$(mktemp -d "${TMPDIR:-/tmp}/inno-reaper-selftest.XXXXXX")" || fail "mktemp failed"
TESTPREFIX="$(mktemp -d "$HOME/.cache/inno-reaper-prefix.XXXXXX")" || fail "mktemp (prefix) failed"
# A wine prefix is ~200MB+, so leaking one per run is not a cosmetic wart. The
# wineserver for THIS prefix keeps writing during teardown, which is what makes
# a plain rm -rf fail with "Directory not empty" — so kill it first and retry.
# `wineserver -k` is WINEPREFIX-scoped: it cannot touch a peer's wine session
# (and is emphatically not a pkill).
cleanup() {
  if ! stop_wine_server >"$WORK/wineserver-cleanup.log" 2>&1; then
    echo "FAIL inno-legacy-reaper: owned Wine server did not settle; diagnostics/prefix retained at $WORK / $TESTPREFIX" >&2
    exit 1
  fi
  for _ in 1 2 3; do
    if [[ $KEEP_WORK -eq 1 ]]; then
      rm -rf "$TESTPREFIX" 2>/dev/null && break
    else
      rm -rf "$WORK" "$TESTPREFIX" 2>/dev/null && break
    fi
    sleep 1
  done
}
trap cleanup EXIT

export WINEDEBUG=-all
# winemenubuilder: keep this throwaway TESTPREFIX from registering .desktop
# entries into the host's GNOME app grid (see build-windows-cross.sh run_iscc).
export WINEDLLOVERRIDES="mscoree,mshtml,winemenubuilder.exe="

# ── Build a standalone harness from the REAL [Code] section ──────────────────
# Extracted verbatim from papercusp.iss so this can never drift from shipping
# code; the [Setup] header is minimal because only the [Code] logic is under
# test.
CODE_LINE="$(grep -n '^\[Code\]' "$ISS" | head -1 | cut -d: -f1)"
[[ -n "$CODE_LINE" ]] || fail "no [Code] section in papercusp.iss"
{
  # The shipping [Code] reads the AppName/AppId PREPROCESSOR defines (its own
  # #ifndef/#error block at the top of papercusp.iss proves ISCC is never
  # invoked without them), so the harness must define them too — a [Setup]
  # AppName= directive is a different thing entirely and does not satisfy
  # {#AppName}. Without these the harness fails to compile the moment any
  # [Code] routine references a define, which is exactly what happened when the
  # uninstall-cleanup routines landed (WI-39403).
  printf '#define AppName "Papercusp GUI"\n#define AppId "com.papercusp.gui"\n'
  printf '[Setup]\nAppName=Inno Reaper Selftest\nAppVersion=0.0.0\n'
  printf 'DefaultDirName={autopf}\\InnoReaperSelftest\nOutputDir=out\n'
  printf 'OutputBaseFilename=reaper-harness\nUninstallable=no\nCreateAppDir=no\n'
  sed -n "${CODE_LINE},\$p" "$ISS"
} > "$WORK/harness.iss"

# Compilation shares the test's private prefix, never the provisioned Wine server.
start_wine_server >"$WORK/wineserver-start.log" 2>&1 || fail "owned Wine persistence failed (diagnostics: $WORK/wineserver-start.log)"
WINEPREFIX="$TESTPREFIX" timeout 300 wineboot -i >"$WORK/wineboot.log" 2>&1 \
  || { tail -5 "$WORK/wineboot.log"; fail "could not boot a test wine prefix"; }
[[ -d "$TESTPREFIX/drive_c" ]] || { tail -5 "$WORK/wineboot.log"; fail "could not boot a test wine prefix"; }
WORK_WIN="$(WINEPREFIX="$TESTPREFIX" winepath -w "$WORK/harness.iss" 2>/dev/null)"
[[ -n "$WORK_WIN" ]] || fail "winepath could not map $WORK/harness.iss"

if ! WINEPREFIX="$TESTPREFIX" timeout 300 wine "$ISCC_EXE" "$WORK_WIN" \
     > "$WORK/iscc.log" 2>&1; then
  echo "--- ISCC output ---"; tail -30 "$WORK/iscc.log"
  fail "ISCC invocation failed; case measured nothing (diagnostics: $WORK/iscc.log)"
fi
HARNESS_EXE="$WORK/out/reaper-harness.exe"
[[ -f "$HARNESS_EXE" ]] || fail "ISCC reported success but produced no harness exe"

REG_ROOT='HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall'
wreg() { WINEPREFIX="$TESTPREFIX" timeout 30 wine reg "$@" >/dev/null 2>&1; }

RC=0
# The product's real directory names contain spaces — that is the whole point
# of the unquoted case, so keep them.
for MODE in quoted unquoted; do
  DRIVE_C="$TESTPREFIX/drive_c"
  mkdir -p "$DRIVE_C/Papercusp Server"
  printf 'not-a-real-exe' > "$DRIVE_C/Papercusp Server/unins-live.exe"
  rm -rf "$DRIVE_C/Papercusp GUI"            # ghost's target must NOT exist

  if [[ "$MODE" == "quoted" ]]; then
    LIVE_VAL='"C:\Papercusp Server\unins-live.exe"'
  else
    LIVE_VAL='C:\Papercusp Server\unins-live.exe'
  fi

  wreg add "$REG_ROOT\\Papercusp GUI"    /v UninstallString /d '"C:\Papercusp GUI\uninstall.exe"' /f || fail "[$MODE] ghost registry write failed"
  wreg add "$REG_ROOT\\Papercusp Server" /v UninstallString /d "$LIVE_VAL" /f || fail "[$MODE] live registry write failed"

  require_key_present "$REG_ROOT\\Papercusp GUI" "[$MODE] seeding ghost key"
  require_key_present "$REG_ROOT\\Papercusp Server" "[$MODE] seeding live key"

  WINEPREFIX="$TESTPREFIX" timeout 300 wine "$HARNESS_EXE" \
    /VERYSILENT /NORESTART /SUPPRESSMSGBOXES >"$WORK/install-$MODE.log" 2>&1 \
    || { tail -30 "$WORK/install-$MODE.log"; fail "[$MODE] installer failed; case measured nothing"; }

  assert_key_state "$REG_ROOT\\Papercusp GUI" absent "[$MODE] ghost reaped ✓" \
    "[$MODE] GHOST NOT REAPED — a dead entry the user cannot remove survives (WI-4490)"
  assert_key_state "$REG_ROOT\\Papercusp Server" present "[$MODE] live entry spared ✓" \
    "[$MODE] LIVE ENTRY DELETED — the guard destroyed a real install's uninstall entry (EI-19481728463683227)"
done

if [[ $RC -eq 0 ]]; then
  echo "PASS inno-legacy-reaper: ghosts reaped and live entries spared, quoted and unquoted"
else
  echo "FAIL inno-legacy-reaper: see the assertions above"
fi
exit $RC
