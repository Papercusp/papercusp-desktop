#!/usr/bin/env bash
# verify-sidecar-bundle.sh — release-bundle dependency verifier (WI-3315).
#
# WHY THIS EXISTS: every check a build runs on its own host is MASKED — the
# host has the dev dependencies installed, so `ldd` resolves, PATH finds
# tools, and `--version` passes even when the shipped artifact is a shim or
# its library never ships. Two real bugs shipped exactly this way (2026-07-07
# audit): the pg client tools were Debian pg_wrapper perl shims that only run
# on hosts with a full PostgreSQL client install (WI-3311), and kopia was
# never bundled at all (WI-3312) — both passed every build-host probe, and
# both failed SILENTLY on clean installs because the backup hook degrades
# softly and agents route around broken tools. Nobody notices a masked
# dependency until an end user has no backups.
#
# This gate verifies the BUNDLE against an explicit contract instead of
# against the build host:
#
#   [1] MANIFEST — every binary the runtime spawns by bare name must exist in
#       sidecar/bin and answer a probe AS INSTALLED (through its wrapper).
#       >>> When you add a spawn('tool') / execa('tool') of an external
#       >>> binary anywhere in the runtime, ADD THE TOOL to REQUIRED_TOOLS
#       >>> below and vendor it in build-desktop-sidecar.sh. This manifest
#       >>> is the contract; nothing else will catch a missing tool.
#   [2] NO SCRIPT SHIMS — a #!-file outside the allowlist fails the build
#       (the pg_wrapper bug class). Generated pg wrappers are allowed only
#       when their .pg-real/<tool> target exists and is a real binary.
#   [3] LINKAGE CLOSURE (Linux) — every bundled ELF's DT_NEEDED must resolve
#       from the bundle's own lib dirs or the BASE_LIBS allowlist below.
#       The build host's ld cache is deliberately NOT consulted — consulting
#       it is precisely the masking this gate kills.
#   [4] macOS — no bundled Mach-O may reference an absolute /opt/homebrew or
#       /usr/local path (brew-keg install-names that exist only on machines
#       with Homebrew). Fails with fix instructions (WI-3314).
#   [5] Windows — vendored .exe tools must have their dependency DLLs beside
#       them (exe-dir is first in the DLL search order); a missing libpq.dll
#       means the exe was resolving DLLs via the build host's PATH (WI-3313).
#
# Known limitation: glibc symbol-version requirements are not checked — a
# binary built on a newer glibc than the target's still passes. Build on the
# oldest supported baseline (Ubuntu 24.04) to stay safe.
#
# Usage: verify-sidecar-bundle.sh [SIDECAR_DIR]
#   default SIDECAR_DIR: <script-dir>/../src-tauri/sidecar
# Prints every violation, then exits non-zero if any. bash-3.2-compatible
# (macOS system bash) — no mapfile/associative arrays.
set -uo pipefail

SIDECAR="${1:-$(cd "$(dirname "$0")/.." && pwd)/src-tauri/sidecar}"
BIN="$SIDECAR/bin"
OS="$(uname -s)"
FAIL=0
fail() { echo "  ✗ $*"; FAIL=1; }
ok()   { echo "  ✓ $*"; }

[[ -d "$BIN" ]] || { echo "verify-sidecar-bundle: ERROR: no bin/ under $SIDECAR" >&2; exit 2; }
echo "→ verify-sidecar-bundle: $SIDECAR ($OS)"

_is_script() { [[ "$(head -c 2 "$1" 2>/dev/null)" == "#!" ]]; }
_is_elf()    { [[ "$(head -c 4 "$1" 2>/dev/null | od -An -tx1 | tr -d ' \n')" == "7f454c46" ]]; }

# ── [1] required runtime tools ──────────────────────────────────────────────
# Everything the runtime spawns by bare name (sidecar/bin is on the operator
# PATH). Consumers, for the record:
#   pg_dump/psql/pg_dumpall/pg_restore — packages/backup/src/hook.ts,
#     seed baking, db-tools; kopia — packages/backup/src/workspace-backup.ts;
#   node — script runners; gh — git identity flows; omp/pui/zellij — chat
#   dock + agent ptys; papercup — operator console shim.
REQUIRED_TOOLS="pg_dump psql pg_dumpall pg_restore kopia node gh omp zellij pui papercup"
# Probe args per tool; blank = existence/exec check only (TUIs and agent CLIs
# whose flags we don't control are not executed).
probe_args() {
  case "$1" in
    pg_dump|psql|pg_dumpall|pg_restore|kopia|node|gh|zellij) echo "--version" ;;
    *) echo "" ;;
  esac
}

echo "[1/5] required runtime tools present + probing as-installed"
for t in $REQUIRED_TOOLS; do
  p="$BIN/$t"
  [[ -f "$p" || -f "$p.exe" ]] || { fail "$t: MISSING from sidecar/bin — the runtime spawns it by bare name"; continue; }
  [[ -f "$p.exe" && ! -f "$p" ]] && p="$p.exe"
  [[ -x "$p" ]] || { fail "$t: present but not executable"; continue; }
  args="$(probe_args "$t")"
  if [[ -n "$args" ]]; then
    if out="$("$p" $args 2>&1 | head -1)"; then
      ok "$t ($out)"
    else
      fail "$t: probe '$t $args' failed as-installed: $out"
    fi
  else
    ok "$t (present, probe skipped)"
  fi
done

# ── [2] script shims ────────────────────────────────────────────────────────
echo "[2/5] script-shim scan of sidecar/bin"
for f in "$BIN"/*; do
  [[ -f "$f" ]] || continue
  _is_script "$f" || continue
  b="$(basename "$f")"
  case "$b" in
    papercup|papercup-status.mjs)
      ok "$b (allowlisted script)" ;;
    psql|pg_dump|pg_dumpall|pg_restore)
      # generated LD_LIBRARY_PATH wrappers (Linux); must front a real binary
      if [[ "$OS" == "Linux" && -f "$BIN/.pg-real/$b" ]] && ! _is_script "$BIN/.pg-real/$b"; then
        ok "$b (generated wrapper → .pg-real/$b)"
      else
        fail "$b: #!-script without a real .pg-real/$b binary behind it (pg_wrapper bug class, WI-3311)"
      fi ;;
    *)
      fail "$b: unexpected #!-script in sidecar/bin — a shim copied off the build host only works there" ;;
  esac
done

# ── [3] linkage closure (Linux) ─────────────────────────────────────────────
echo "[3/5] ELF linkage closure (bundle libs + base allowlist only)"
if [[ "$OS" == "Linux" ]]; then
  if ! command -v objdump >/dev/null 2>&1; then
    fail "objdump not on build host — cannot verify linkage (apt install binutils)"
  else
    # Libraries assumed present on ANY Ubuntu-24.04-baseline install. Every
    # entry needs a reason; do not grow this list to make a failure go away —
    # bundle the lib instead.
    #   loader/libc family: always present
    #   libgcc_s/libstdc++: shipped in ubuntu-minimal (apt depends on them)
    #   libz/libzstd/liblz4: apt/dpkg dependency closure on every install
    #   libcrypto.so.3/libssl.so.3: openssl base (ca-certificates/curl chain)
    #   libresolv/libutil: glibc components
    #   libasound.so.2: pui links it; present wherever the GUI stack installs
    #     (pulled via webkit2gtk→gstreamer alsa on the .deb dependency chain)
    BASE_LIBS=" ld-linux-x86-64.so.2 libc.so.6 libm.so.6 libpthread.so.0 libdl.so.2 librt.so.1 libutil.so.1 libresolv.so.2 libgcc_s.so.1 libstdc++.so.6 libz.so.1 libzstd.so.1 liblz4.so.1 libcrypto.so.3 libssl.so.3 libasound.so.2 "
    # Bundle lib dirs a NEEDED may resolve from (plus the scanned file's own dir)
    LIBDIRS="$BIN/.pg-real/lib"
    for d in "$SIDECAR"/node_modules/@papercusp/embedded-postgres-server/node_modules/@embedded-postgres/*/native/lib; do
      [[ -d "$d" ]] && LIBDIRS="$LIBDIRS $d"
    done
    # Files to scan: everything we vendor as executable machine code
    SCAN=""
    for f in "$BIN"/* "$BIN"/.pg-real/*; do
      [[ -f "$f" ]] && _is_elf "$f" && SCAN="$SCAN $f"
    done
    for d in "$SIDECAR"/node_modules/@papercusp/embedded-postgres-server/node_modules/@embedded-postgres/*/native/bin \
             "$SIDECAR"/node_modules/@papercusp/embedded-postgres-server/node_modules/@embedded-postgres/*/native/lib; do
      [[ -d "$d" ]] || continue
      for f in "$d"/*; do
        [[ -f "$f" && ! -L "$f" ]] && _is_elf "$f" && SCAN="$SCAN $f"
      done
    done
    scanned=0; bad=0
    for f in $SCAN; do
      scanned=$((scanned + 1))
      for need in $(objdump -p "$f" 2>/dev/null | awk '/NEEDED/{print $2}'); do
        case "$BASE_LIBS" in *" $need "*) continue ;; esac
        found=""
        for d in "$(dirname "$f")" $LIBDIRS; do
          [[ -e "$d/$need" ]] && found=1 && break
        done
        if [[ -z "$found" ]]; then
          fail "$(basename "$f") needs $need — not in the bundle and not on the base-system allowlist (host-masked dependency)"
          bad=1
        fi
      done
    done
    [[ "$bad" == 0 ]] && ok "all $scanned bundled ELFs close over bundle libs + base allowlist"
  fi
else
  echo "  (skipped — not Linux)"
fi

# ── [4] macOS: brew-keg absolute install-names ──────────────────────────────
echo "[4/5] darwin keg-path scan"
if [[ "$OS" == "Darwin" ]]; then
  if ! command -v otool >/dev/null 2>&1; then
    fail "otool not on build host — cannot verify Mach-O linkage (xcode-select --install)"
  else
    for f in "$BIN"/*; do
      [[ -f "$f" ]] || continue
      _is_script "$f" && continue
      refs="$(otool -L "$f" 2>/dev/null | awk 'NR>1{print $1}' | grep -E '^(/opt/homebrew|/usr/local)/' || true)"
      if [[ -n "$refs" ]]; then
        fail "$(basename "$f") references brew-keg paths that only exist on Homebrew machines (WI-3314):"
        echo "$refs" | sed 's/^/      /'
        echo "      fix: bundle the dylib + install_name_tool -change to @executable_path-relative"
      fi
    done
    [[ "$FAIL" == 0 ]] && ok "no bundled Mach-O references /opt/homebrew or /usr/local"
  fi
else
  echo "  (skipped — not Darwin)"
fi

# ── [5] Windows: sibling DLLs for vendored exes ─────────────────────────────
echo "[5/5] windows DLL presence"
case "$OS" in
  MINGW*|MSYS*|CYGWIN*)
    if [[ -f "$BIN/psql.exe" && ! -f "$BIN/libpq.dll" ]]; then
      fail "psql.exe present without libpq.dll beside it — DLLs were resolving via the build host's PATH (WI-3313)"
    else
      ok "pg tool DLLs present (or no .exe tools bundled)"
    fi ;;
  *) echo "  (skipped — not Windows)" ;;
esac

echo
if [[ "$FAIL" != 0 ]]; then
  echo "verify-sidecar-bundle: FAILED — the bundle depends on build-host state that will not ship." >&2
  exit 1
fi
echo "verify-sidecar-bundle: OK"
