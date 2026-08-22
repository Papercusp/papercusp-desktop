#!/usr/bin/env bash
# inno-uninstall-cleanup.selftest.sh — guards the Inno [Code] UNINSTALL cleanup
# in src-tauri/windows/inno/papercusp.iss (WI-39403).
#
# WHY THIS EXISTS
# A real 0.0.17 uninstall on a Windows 11 guest exited 0 and removed {app}
# entirely — and still left the login-autostart entry behind. The app registers
# auto-start at RUNTIME (tauri-plugin-autostart -> auto-launch writes an HKCU
# Run VALUE), so Inno has no record of it and cannot clean it up implicitly.
# Result: after a clean, successful uninstall every subsequent login tries to
# launch a deleted executable. Nothing tested the uninstall path at all.
#
# WHAT IT ASSERTS — and note that half the cases are the DANGEROUS direction:
#   1. the Run value for THIS role is deleted by the uninstall
#   2. the Run value for the OTHER role is SPARED               <- control
#   3. the StartupApproved\Run marker for THIS role is deleted
#   4. a Startup-folder shortcut named after the product is swept
#   5. SharedRuntimeStillNeeded = TRUE while the other product is installed
#   6. SharedRuntimeStillNeeded = FALSE once it is not
#   7. an empty role directory is removable, but a non-empty one is preserved
#   8. the real uninstall leaves neither the role root nor user config harmed
#
# Cases 2 and 5 are the falsifiability controls that matter most. Without (2) a
# cleanup that blanket-deleted by the shared binary name would pass while
# silently disabling the OTHER product's auto-start. Without (5) a cleanup that
# always offered to unregister the SHARED papercup-runtime distro would pass
# while proposing to delete multiple GB of the user's database out from under a
# still-installed sibling product.
#
# The WSL unregister prompt itself is deliberately NOT exercised end-to-end: it
# is gated on `not UninstallSilent`, and a silent uninstall is the only kind a
# headless test can drive — which is itself the property we want (a /VERYSILENT
# uninstall, the mode the auto-updater drives, must never destroy user data).
# Cases 5/6 test its GUARD, which is the part that can be wrong.
#
# HERMETIC-ish: no network, no docker, no ssh. It does need the Windows build
# toolchain (wine + Inno Setup's ISCC) that bin/build-windows-cross.sh already
# requires. Where that is not provisioned this SKIPS with exit 0 rather than
# failing, so it is safe in any gate; on a Windows-build box it runs for real.
#
#   bash bin/lib/inno-uninstall-cleanup.selftest.sh   # 0 = pass or skip, 1 = FAIL
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Overridable so scripts/mutation-probe.sh can point this at a MUTATED COPY
# outside the tree (its tier-2 copy-out mode) and prove the assertions below can
# actually fail. Mutating the real file in place is unsafe here: git-sync commits
# the whole working tree on a timer, so a probe that holds a mutation for the
# ~70s this suite runs can have that mutation swept into a commit.
ISS="${PAPERCUSP_ISS:-$DIR/../../src-tauri/windows/inno/papercusp.iss}"
WINEPREFIX_INNO="${PAPERCUSP_WINEPREFIX_INNO:-$HOME/.papercusp/wine-inno}"
ISCC_EXE="${PAPERCUSP_ISCC_EXE:-$WINEPREFIX_INNO/drive_c/InnoSetup6/ISCC.exe}"

# The role under test, and the sibling that must survive it untouched.
ROLE_NAME='Papercusp GUI'
ROLE_ID='com.papercusp.gui'
OTHER_NAME='Papercusp Server'
OTHER_ID='com.papercusp.server'

skip() { echo "SKIP inno-uninstall-cleanup: $1"; exit 0; }
fail() { echo "FAIL inno-uninstall-cleanup: $1"; exit 1; }

[[ -f "$ISS" ]] || fail "papercusp.iss not found at $ISS"
command -v wine     >/dev/null 2>&1 || skip "wine not installed"
command -v xvfb-run >/dev/null 2>&1 || skip "xvfb-run not installed"
[[ -f "$ISCC_EXE" ]] || skip "ISCC not provisioned at $ISCC_EXE"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/inno-uninst-selftest.XXXXXX")" || fail "mktemp failed"
# A wine prefix must live somewhere WE own; wine refuses a prefix under a
# directory it does not own (a shared /tmp).
TESTPREFIX="$(mktemp -d "$HOME/.cache/inno-uninst-prefix.XXXXXX")" || fail "mktemp (prefix) failed"
cleanup() {
  WINEPREFIX="$TESTPREFIX" wineserver -k >/dev/null 2>&1 || true
  for _ in 1 2 3; do
    rm -rf "$WORK" "$TESTPREFIX" 2>/dev/null && break
    sleep 1
  done
}
trap cleanup EXIT

export WINEDEBUG=-all
# Keep this throwaway prefix from registering .desktop entries into the host's
# app grid (same reason build-windows-cross.sh run_iscc does it).
export WINEDLLOVERRIDES="mscoree,mshtml,winemenubuilder.exe="

# ── Build a harness from the REAL [Code] section ─────────────────────────────
# Extracted verbatim from papercusp.iss so this can never drift from shipping
# code. Unlike the legacy-reaper harness this one must be INSTALLABLE and
# UNINSTALLABLE, because the logic under test lives in CurUninstallStepChanged.
# The two #defines are the ones ISCC is normally invoked with.
CODE_LINE="$(grep -n '^\[Code\]' "$ISS" | head -1 | cut -d: -f1)"
[[ -n "$CODE_LINE" ]] || fail "no [Code] section in papercusp.iss"
{
  printf '#define AppName "%s"\n#define AppId "%s"\n' "$ROLE_NAME" "$ROLE_ID"
  printf '[Setup]\nAppId={#AppId}\nAppName={#AppName}\nAppVersion=0.0.0\n'
  printf 'DefaultDirName={localappdata}\\PapercuspUninstallSelftest\n'
  printf 'PrivilegesRequired=lowest\nDisableDirPage=yes\nDisableProgramGroupPage=yes\n'
  printf 'OutputDir=out\nOutputBaseFilename=uninst-harness\nUninstallable=yes\nCreateAppDir=yes\n'
  sed -n "${CODE_LINE},\$p" "$ISS"
  # Thin harness-only probe: publish the two pure helpers' verdicts so the
  # sharing guard can be asserted directly. The FUNCTIONS are the shipping
  # ones above; only this caller is test scaffolding.
  cat <<'PROBE'

function InitializeSetup(): Boolean;
var
  FixtureRoot: String;
  EmptyFixture: String;
  NonEmptyFixture: String;
  KeepFile: String;
begin
  { Publish the Startup folder as INNO resolves it. Guessing this path in bash
    means the test can seed a shortcut somewhere the uninstaller was never going
    to look and then report a false failure — or, if the guess drifted the other
    way, a false pass. Ask the thing under test. }
  RegWriteStringValue(HKCU, 'Software\PapercuspSelftest', 'UserStartup', ExpandConstant('{userstartup}'));
  RegWriteStringValue(HKCU, 'Software\PapercuspSelftest', 'OtherRoleAppId', OtherRoleAppId);
  if SharedRuntimeStillNeeded then
    RegWriteStringValue(HKCU, 'Software\PapercuspSelftest', 'SharedRuntimeStillNeeded', 'yes')
  else
    RegWriteStringValue(HKCU, 'Software\PapercuspSelftest', 'SharedRuntimeStillNeeded', 'no');

  { Recurrence fixture for the empty-role-directory fix. RemoveDir is the
    shipping helper's narrow contract: empty directories are removable, while
    a directory containing even one file is left alone. }
  FixtureRoot := ExpandConstant('{tmp}\papercusp-uninstall-cleanup-fixture');
  EmptyFixture := FixtureRoot + '\empty-role';
  NonEmptyFixture := FixtureRoot + '\non-empty-role';
  KeepFile := NonEmptyFixture + '\keep.txt';
  DeleteFile(KeepFile);
  RemoveDir(NonEmptyFixture);
  RemoveDir(EmptyFixture);
  RemoveDir(FixtureRoot);
  ForceDirectories(EmptyFixture);
  if RemoveEmptyDirectory(EmptyFixture) and (not DirExists(EmptyFixture)) then
    RegWriteStringValue(HKCU, 'Software\PapercuspSelftest', 'EmptyFixtureRemoved', 'yes')
  else
    RegWriteStringValue(HKCU, 'Software\PapercuspSelftest', 'EmptyFixtureRemoved', 'no');
  ForceDirectories(NonEmptyFixture);
  SaveStringToFile(KeepFile, 'fixture', False);
  if (not RemoveEmptyDirectory(NonEmptyFixture)) and FileExists(KeepFile) then
    RegWriteStringValue(HKCU, 'Software\PapercuspSelftest', 'NonEmptyFixturePreserved', 'yes')
  else
    RegWriteStringValue(HKCU, 'Software\PapercuspSelftest', 'NonEmptyFixturePreserved', 'no');
  Result := True;
end;
PROBE
} > "$WORK/harness.iss"

HARNESS_WIN="$(WINEPREFIX="$WINEPREFIX_INNO" winepath -w "$WORK/harness.iss" 2>/dev/null)"
[[ -n "$HARNESS_WIN" ]] || fail "winepath could not map $WORK/harness.iss"

if ! WINEPREFIX="$WINEPREFIX_INNO" timeout 300 xvfb-run -a wine "$ISCC_EXE" "$HARNESS_WIN" \
     > "$WORK/iscc.log" 2>&1; then
  echo "--- ISCC output ---"; tail -30 "$WORK/iscc.log"
  fail "the [Code] section did not compile (a syntax/identifier error in papercusp.iss)"
fi
HARNESS_EXE="$WORK/out/uninst-harness.exe"
[[ -f "$HARNESS_EXE" ]] || fail "ISCC reported success but produced no harness exe"
echo "  [Code] section compiles ✓"

# ── Boot the throwaway prefix ────────────────────────────────────────────────
WINEPREFIX="$TESTPREFIX" timeout 300 xvfb-run -a wineboot -i >"$WORK/wineboot.log" 2>&1
[[ -d "$TESTPREFIX/drive_c" ]] || { tail -5 "$WORK/wineboot.log"; fail "could not boot a test wine prefix"; }

RUN_KEY='HKCU\Software\Microsoft\Windows\CurrentVersion\Run'
APPROVED_KEY='HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
UNINST_ROOT='HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall'
PROBE_KEY='HKCU\Software\PapercuspSelftest'

wreg()  { WINEPREFIX="$TESTPREFIX" xvfb-run -a wine reg "$@" >/dev/null 2>&1; }
# Prints the value's data, or nothing when the value is absent.
# Two things make the naive `awk '$1 == name { print $3 }'` wrong here, and both
# fail in the direction that reads as "value absent" — i.e. as a PASS for a
# cleanup that did nothing:
#   - `wine reg query` emits CRLF, so the last field carries a trailing \r and
#     every string comparison against it fails;
#   - the value names under test are the product names, which CONTAIN SPACES
#     ("Papercusp GUI"), so they span $1..$2 and never equal $1.
# Match on the name as a prefix of the trimmed line and take everything after
# the REG_* type column instead.
rvalue() {
  WINEPREFIX="$TESTPREFIX" xvfb-run -a wine reg query "$1" /v "$2" 2>/dev/null \
    | tr -d '\r' \
    | awk -v name="$2" '
        {
          line = $0
          sub(/^[ \t]+/, "", line)
          if (index(line, name) == 1) {
            rest = substr(line, length(name) + 1)
            if (match(rest, /REG_[A-Z_]+[ \t]+/)) {
              print substr(rest, RSTART + RLENGTH)
              exit
            }
          }
        }'
}

RC=0
ok()  { echo "  ✓ $1"; }
bad() { echo "  ✗ $1"; RC=1; }

run_install() {
  WINEPREFIX="$TESTPREFIX" timeout 300 xvfb-run -a wine "$HARNESS_EXE" \
    /VERYSILENT /NORESTART /SUPPRESSMSGBOXES >"$WORK/install-$1.log" 2>&1
}

# ── Cases 5/6: the SHARED-DISTRO guard, measured at install time ─────────────
# 5) sibling product present => the runtime is still needed => never offered.
wreg add "$UNINST_ROOT\\${OTHER_ID}_is1" /v UninstallString /d 'C:\whatever\unins000.exe' /f
wreg delete "$PROBE_KEY" /f
run_install with-sibling
[[ "$(rvalue "$PROBE_KEY" OtherRoleAppId)" == "$OTHER_ID" ]] \
  && ok "resolves the sibling role id ($OTHER_ID)" \
  || bad "OtherRoleAppId resolved to '$(rvalue "$PROBE_KEY" OtherRoleAppId)', expected $OTHER_ID"
[[ "$(rvalue "$PROBE_KEY" SharedRuntimeStillNeeded)" == "yes" ]] \
  && ok "shared papercup-runtime is kept while the sibling product is installed (data-safety control)" \
  || bad "SHARED DISTRO WOULD BE OFFERED FOR DELETION while $OTHER_NAME is still installed"

# 6) sibling gone => this is the last Papercusp product => the offer is allowed.
wreg delete "$UNINST_ROOT\\${OTHER_ID}_is1" /f
wreg delete "$PROBE_KEY" /f
run_install no-sibling
[[ "$(rvalue "$PROBE_KEY" SharedRuntimeStillNeeded)" == "no" ]] \
  && ok "shared papercup-runtime becomes removable once no sibling product remains" \
  || bad "the runtime is never offered for removal even as the last product — DEFECT 2 unfixed"
[[ "$(rvalue "$PROBE_KEY" EmptyFixtureRemoved)" == "yes" ]] \
  && ok "empty role directory is removed by the narrow helper (recurrence fixture)" \
  || bad "empty role directory helper did not remove the empty fixture"
[[ "$(rvalue "$PROBE_KEY" NonEmptyFixturePreserved)" == "yes" ]] \
  && ok "non-empty role directory is preserved by the narrow helper" \
  || bad "directory helper would remove a non-empty payload/config directory"

# ── Seed the state a real uninstall must clean (and must NOT) ────────────────
# The role under test AND its sibling both have autostart registered.
wreg add "$RUN_KEY"      /v "$ROLE_NAME"  /d 'C:\gone\papercusp-desktop.exe' /f
wreg add "$RUN_KEY"      /v "$OTHER_NAME" /d 'C:\still-here\papercusp-desktop.exe' /f
wreg add "$APPROVED_KEY" /v "$ROLE_NAME"  /d 'marker' /f

STARTUP_WIN="$(rvalue "$PROBE_KEY" UserStartup)"
[[ -n "$STARTUP_WIN" ]] || fail "the harness did not publish {userstartup} — cannot locate the Startup folder Inno uses"
STARTUP_DIR="$(WINEPREFIX="$TESTPREFIX" winepath -u "$STARTUP_WIN" 2>/dev/null)"
[[ -n "$STARTUP_DIR" ]] || fail "winepath could not map $STARTUP_WIN to a unix path"
mkdir -p "$STARTUP_DIR" 2>/dev/null
printf 'stub' > "$STARTUP_DIR/$ROLE_NAME.lnk"

[[ -n "$(rvalue "$RUN_KEY" "$ROLE_NAME")" ]] || fail "seeding failed: this role's Run value absent before the uninstall"
[[ -f "$STARTUP_DIR/$ROLE_NAME.lnk" ]]       || fail "seeding failed: startup shortcut absent before the uninstall"

# ── Run the real uninstaller ─────────────────────────────────────────────────
APPDIR="$(printf '%s' "$TESTPREFIX"/drive_c/users/*/AppData/Local/PapercuspUninstallSelftest)"
UNINST="$APPDIR/unins000.exe"
[[ -f "$UNINST" ]] || fail "the harness produced no unins000.exe at $UNINST (install did not complete)"
# A sibling user-config directory is intentionally outside {app}; it must
# survive uninstall even when the role root cleanup is exercised.
CONFIG_SENTINEL="$(dirname "$APPDIR")/Papercusp/uninstall-preserve-sentinel.txt"
mkdir -p "$(dirname "$CONFIG_SENTINEL")" 2>/dev/null
printf 'keep-user-config' > "$CONFIG_SENTINEL"
UNINST_LOG_WIN="$(WINEPREFIX="$TESTPREFIX" winepath -w "$WORK" 2>/dev/null)\\inno-uninstall.log"
WINEPREFIX="$TESTPREFIX" timeout 300 xvfb-run -a wine "$UNINST" \
  /VERYSILENT /NORESTART /SUPPRESSMSGBOXES "/LOG=$UNINST_LOG_WIN" >"$WORK/uninstall.log" 2>&1

# AN INNO UNINSTALLER RETURNS BEFORE IT HAS FINISHED. unins000.exe copies itself
# to %TEMP% and relaunches from there (so it can delete its own directory), and
# the process we launched exits immediately. Asserting here without waiting reads
# every not-yet-run cleanup as "the cleanup did not happen" — which is a FALSE
# FAILURE, and, worse, the same shape would be a false PASS for any assertion
# phrased as "the value is still present". Wait for the real completion signal:
# the install directory being gone.
for _ in $(seq 1 60); do
  [[ -d "$APPDIR" ]] || break
  sleep 1
done
[[ ! -d "$APPDIR" ]] || fail "the uninstaller left the empty role install directory at $APPDIR"
# The registry writes happen in usPostUninstall, i.e. after the directory goes.
sleep 2

# ── Cases 1-4 ────────────────────────────────────────────────────────────────
[[ -z "$(rvalue "$RUN_KEY" "$ROLE_NAME")" ]] \
  && ok "login-autostart Run value removed (WI-39403 DEFECT 1)" \
  || bad "RUN VALUE SURVIVED — every login still launches a deleted exe (WI-39403 regression)"

[[ -n "$(rvalue "$RUN_KEY" "$OTHER_NAME")" ]] \
  && ok "the sibling product's Run value is spared (falsifiability control)" \
  || bad "CROSS-ROLE DELETE — uninstalling $ROLE_NAME disabled $OTHER_NAME's auto-start"

[[ -z "$(rvalue "$APPROVED_KEY" "$ROLE_NAME")" ]] \
  && ok "StartupApproved\\Run marker removed (no orphan Task Manager row)" \
  || bad "StartupApproved marker survived — Task Manager still lists a program that is gone"

[[ ! -f "$STARTUP_DIR/$ROLE_NAME.lnk" ]] \
  && ok "dangling Startup shortcut swept" \
  || bad "Startup shortcut survived the uninstall"

[[ -f "$CONFIG_SENTINEL" ]] \
  && ok "user config outside the role directory survived uninstall" \
  || bad "uninstall removed user config outside the role directory"

if [[ $RC -ne 0 && -f "$WORK/inno-uninstall.log" ]]; then
  echo "--- Inno uninstall log (tail) ---"
  tr -d '\r' < "$WORK/inno-uninstall.log" | tail -25
  echo "---------------------------------"
fi

echo
if [[ $RC -eq 0 ]]; then
  echo "PASS inno-uninstall-cleanup: autostart cleaned, sibling role and shared runtime protected"
else
  echo "FAIL inno-uninstall-cleanup: see the assertions above"
fi
exit $RC
