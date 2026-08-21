#!/usr/bin/env bash
# Prove the configured extractor can read the Inno Setup format this build emits
# before cargo spends time compiling it. A version string is not enough: compile
# a tiny fixture with the exact ISCC binary used by the release, then require the
# exact extractor selected for the audit to list its payload.

innoextract_compat_preflight() (
  set -euo pipefail

  local extractor="${1:-${PAPERCUSP_INNOEXTRACT:-}}"
  local wine_prefix="${2:-${PAPERCUSP_WINE_INNO_PREFIX:-$HOME/.papercusp/wine-inno}}"
  local iscc_exe="${3:-${PAPERCUSP_ISCC_EXE:-$wine_prefix/drive_c/InnoSetup6/ISCC.exe}}"
  local work probe_iss probe_win probe_exe list_log

  if [[ -z "$extractor" ]]; then
    extractor="$(command -v innoextract 2>/dev/null || true)"
  elif [[ "$extractor" != */* ]]; then
    extractor="$(command -v "$extractor" 2>/dev/null || true)"
  fi
  [[ -x "$extractor" ]] || {
    echo "ERROR: configured Inno extractor is missing or not executable: ${extractor:-<unset>}" >&2
    return 1
  }
  for command_name in wine winepath xvfb-run timeout; do
    command -v "$command_name" >/dev/null 2>&1 || {
      echo "ERROR: $command_name is required for the Inno extractor compatibility preflight" >&2
      return 1
    }
  done
  [[ -f "$iscc_exe" ]] || {
    echo "ERROR: ISCC is missing for the Inno extractor compatibility preflight: $iscc_exe" >&2
    return 1
  }

  work="$(mktemp -d "${TMPDIR:-/tmp}/papercusp-innoextract-preflight.XXXXXX")"
  trap 'rm -rf "$work"' EXIT
  probe_iss="$work/innoextract-compat-probe.iss"
  # The payload name is asserted below, so an extractor that exits 0 without
  # actually listing the fixture cannot satisfy this preflight.
  printf '%s\n' \
    '[Setup]' \
    'AppName=Papercusp Inno Compatibility Probe' \
    'AppVersion=6.7.3' \
    'DefaultDirName={localappdata}\\PapercuspInnoCompatibilityProbe' \
    'DisableProgramGroupPage=yes' \
    'PrivilegesRequired=lowest' \
    'Uninstallable=no' \
    'CreateAppDir=no' \
    'Compression=none' \
    'OutputDir=out' \
    'OutputBaseFilename=innoextract-compat-probe' \
    '' \
    '[Files]' \
    'Source: "probe-payload.txt"; DestDir: "{app}"' \
    > "$probe_iss"
  printf 'inno 6.7 compatibility payload\n' > "$work/probe-payload.txt"

  probe_win="$(WINEPREFIX="$wine_prefix" winepath -w "$probe_iss" 2>"$work/winepath.log")" || {
    echo "ERROR: winepath could not map the Inno compatibility fixture" >&2
    cat "$work/winepath.log" >&2 || true
    return 1
  }
  if ! WINEPREFIX="$wine_prefix" WINEDEBUG=-all \
      WINEDLLOVERRIDES="mscoree=d;mshtml=d;winemenubuilder.exe=d" \
      timeout 120 xvfb-run -a wine "$iscc_exe" "$probe_win" \
      >"$work/iscc.log" 2>&1; then
    echo "ERROR: ISCC could not compile the Inno 6.7 compatibility fixture" >&2
    tail -40 "$work/iscc.log" >&2 || true
    return 1
  fi
  probe_exe="$work/out/innoextract-compat-probe.exe"
  [[ -s "$probe_exe" ]] || {
    echo "ERROR: ISCC reported success but produced no compatibility fixture: $probe_exe" >&2
    return 1
  }

  list_log="$work/innoextract-list.log"
  if ! "$extractor" -l "$probe_exe" >"$list_log" 2>&1; then
    echo "ERROR: configured Inno extractor cannot list an Inno 6.7 fixture" >&2
    echo "       extractor: $extractor" >&2
    echo "       ISCC: $iscc_exe" >&2
    tail -40 "$list_log" >&2 || true
    return 1
  fi
  grep -qi 'probe-payload\.txt' "$list_log" || {
    echo "ERROR: configured Inno extractor listed no probe payload for the Inno 6.7 fixture" >&2
    echo "       extractor: $extractor" >&2
    tail -40 "$list_log" >&2 || true
    return 1
  }
  echo "  Inno extractor compatibility preflight passed (Inno 6.7 fixture): $extractor"
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  innoextract_compat_preflight "$@"
fi
