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
#   [6] NATIVE MODULES LOAD — every package the runtime require()s that dlopens
#       native code must actually load under the BUNDLED node, from the bundle.
#       >>> When you add a dependency that ships a *.node, ADD IT to
#       >>> REQUIRED_NATIVE_MODULES below. Like [1], this manifest is the
#       >>> contract; a packaged-but-unloadable native passes everything else.
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

# Usage: verify-sidecar-bundle.sh [SIDECAR_DIR] [--target-os OS] [--target-arch ARCH]
# WI-5651: --target-os/--target-arch let a CROSS build (baked on linux for
# darwin/windows) tell the verifier which platform the bundle is FOR — default is
# the build host, so every existing native caller is unchanged.
SIDECAR=""
TARGET_OS_ARG=""; TARGET_ARCH_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-os)   TARGET_OS_ARG="${2:-}"; shift 2 ;;
    --target-arch) TARGET_ARCH_ARG="${2:-}"; shift 2 ;;
    *) [[ -z "$SIDECAR" ]] && SIDECAR="$1"; shift ;;
  esac
done
SIDECAR="${SIDECAR:-$(cd "$(dirname "$0")/.." && pwd)/src-tauri/sidecar}"
# Normalize to ABSOLUTE. Callers pass a relative dir (mac-vm-build.sh:
# `verify-sidecar-bundle.sh src-tauri/sidecar`), and [6] cd's into the bundle to
# resolve modules as the sidecar does — after which a relative $BIN/node points
# nowhere and every native "fails to load". Phases [1]-[5] never cd, so they
# never noticed.
[[ -d "$SIDECAR" ]] && SIDECAR="$(cd "$SIDECAR" && pwd)"
BIN="$SIDECAR/bin"
OS="$(uname -s)"
FAIL=0
fail() { echo "  ✗ $*"; FAIL=1; }
ok()   { echo "  ✓ $*"; }

# WI-5651: this verifier historically assumed bundle-platform == build-host, so
# it exec-probes tools and dlopen-tests natives. A CROSS bundle ships FOREIGN
# binaries the host can't exec — normalize both sides and derive CROSS so those
# execution checks become STATIC format/presence assertions (a stronger check
# than a --version that a wrong-platform copy would fail anyway; the true runtime
# load-test happens when the app is exercised on-target).
case "$OS" in Linux*) _host_os_n=linux ;; Darwin*) _host_os_n=darwin ;; MINGW*|MSYS*|CYGWIN*) _host_os_n=windows ;; *) _host_os_n="$OS" ;; esac
case "$(uname -m)" in x86_64|amd64) _host_arch_n=x64 ;; arm64|aarch64) _host_arch_n=arm64 ;; *) _host_arch_n="$(uname -m)" ;; esac
TARGET_OS_N="${TARGET_OS_ARG:-$_host_os_n}"
TARGET_ARCH_N="${TARGET_ARCH_ARG:-$_host_arch_n}"
CROSS=0
[[ "$TARGET_OS_N" != "$_host_os_n" || "$TARGET_ARCH_N" != "$_host_arch_n" ]] && CROSS=1

[[ -d "$BIN" ]] || { echo "verify-sidecar-bundle: ERROR: no bin/ under $SIDECAR" >&2; exit 2; }
echo "→ verify-sidecar-bundle: $SIDECAR ($OS$([[ "$CROSS" == 1 ]] && echo " → cross ${TARGET_OS_N}-${TARGET_ARCH_N}"))"

_is_script() { [[ "$(head -c 2 "$1" 2>/dev/null)" == "#!" ]]; }
_is_elf()    { [[ "$(head -c 4 "$1" 2>/dev/null | od -An -tx1 | tr -d ' \n')" == "7f454c46" ]]; }
# Mach-O (thin LE/BE 32/64 + fat/universal both endians) and PE (MZ) magic.
_is_macho() {
  local m; m="$(head -c 4 "$1" 2>/dev/null | od -An -tx1 | tr -d ' \n')"
  case "$m" in cffaedfe|cefaedfe|feedface|feedfacf|cafebabe|bebafeca) return 0 ;; *) return 1 ;; esac
}
_is_pe() { [[ "$(head -c 2 "$1" 2>/dev/null)" == "MZ" ]]; }
# The expected machine-code format for the TARGET platform.
_is_target_format() {
  case "$TARGET_OS_N" in
    darwin)  _is_macho "$1" ;;
    windows) _is_pe "$1" ;;
    *)       _is_elf "$1" ;;
  esac
}

# ── [1] required runtime tools ──────────────────────────────────────────────
# Everything the runtime spawns by bare name (sidecar/bin is on the operator
# PATH). Consumers, for the record:
#   pg_dump/psql/pg_dumpall/pg_restore — packages/backup/src/hook.ts,
#     seed baking, db-tools; kopia — packages/backup/src/workspace-backup.ts;
#   node — script runners; gh — git identity flows; pui/zellij — chat dock
#   + agent ptys; papercup — operator console shim.
#   omp is deliberately NOT required here: WI-3343 retired the bundled omp
#   sidecar dependency, and the desktop app resolves the user's installed omp.
REQUIRED_TOOLS="pg_dump psql pg_dumpall pg_restore kopia node gh zellij pui papercup"
# Probe args per tool; blank = existence/exec check only (TUIs and agent CLIs
# whose flags we don't control are not executed).
probe_args() {
  case "$1" in
    pg_dump|psql|pg_dumpall|pg_restore|kopia|node|gh|zellij) echo "--version" ;;
    *) echo "" ;;
  esac
}

echo "[1/6] required runtime tools present + probing as-installed"
for t in $REQUIRED_TOOLS; do
  p="$BIN/$t"
  [[ -f "$p" || -f "$p.exe" ]] || { fail "$t: MISSING from sidecar/bin — the runtime spawns it by bare name"; continue; }
  [[ -f "$p.exe" && ! -f "$p" ]] && p="$p.exe"
  [[ -x "$p" ]] || { fail "$t: present but not executable"; continue; }
  if [[ "$CROSS" == "1" ]]; then
    # Can't exec a foreign-platform binary on this host — assert the shipped file
    # is the RIGHT FORMAT for the target (proves we shipped the TARGET's binary,
    # not the host's). Scripts (papercup) are allowlisted wrappers. The real
    # runtime probe happens when the app is exercised on-target (the VMs remain
    # for testing — owner directive 2026-07-20).
    if _is_script "$p"; then
      ok "$t (script wrapper; exec-probe skipped — cross ${TARGET_OS_N}-${TARGET_ARCH_N})"
    elif _is_target_format "$p"; then
      ok "$t (${TARGET_OS_N}/${TARGET_ARCH_N} binary; exec-probe skipped — cross)"
    else
      fail "$t: not a ${TARGET_OS_N} binary — a ${TARGET_OS_N} bundle must ship the target's binary here, not the build host's"
    fi
    continue
  fi
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
echo "[2/6] script-shim scan of sidecar/bin"
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
echo "[3/6] ELF linkage closure (bundle libs + base allowlist only)"
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
echo "[4/6] darwin keg-path scan"
if [[ "$TARGET_OS_N" == "darwin" ]]; then
  # WI-5651: gate on the TARGET, not the host — a darwin bundle cross-baked on
  # linux needs this scan too. Native mac uses otool; the linux cross host uses
  # llvm-otool-<N>. Also catch the Homebrew bottle placeholder TOKENS
  # (@@HOMEBREW_CELLAR@@/@@HOMEBREW_PREFIX@@) a cross vendor must have rewritten,
  # not just the resolved /opt/homebrew|/usr/local keg paths. Scan bin/ AND
  # bin/.pg-lib/ (vendored dylibs).
  _otool=""
  for _c in otool llvm-otool-18 llvm-otool; do command -v "$_c" >/dev/null 2>&1 && _otool="$_c" && break; done
  if [[ -z "$_otool" ]]; then
    fail "no otool/llvm-otool on build host — cannot verify Mach-O linkage (xcode-select --install, or apt install llvm)"
  else
    _keg_bad=0
    for f in "$BIN"/* "$BIN"/.pg-lib/*; do
      [[ -f "$f" ]] || continue
      _is_script "$f" && continue
      _is_macho "$f" || continue
      refs="$("$_otool" -L "$f" 2>/dev/null | awk 'NR>1{print $1}' | grep -E '^(/opt/homebrew|/usr/local)/|@@HOMEBREW' || true)"
      if [[ -n "$refs" ]]; then
        fail "$(basename "$f") references brew-keg paths/tokens that only exist on Homebrew machines (WI-3314):"
        echo "$refs" | sed 's/^/      /'
        echo "      fix: bundle the dylib + (llvm-)install-name-tool -change to @executable_path-relative"
        _keg_bad=1
      fi
    done
    [[ "$_keg_bad" == 0 ]] && ok "no bundled Mach-O references /opt/homebrew, /usr/local, or @@HOMEBREW tokens (via $_otool)"

    # ── dangling @loader_path linkage (WI-5651) ──────────────────────────────
    # A darwin Mach-O that references @loader_path/../lib/<name> which does NOT
    # resolve to a bundled file makes dyld ABORT the instant the app exec's it
    # ("Library not loaded: @loader_path/../lib/libzstd.1.dylib") — a failure the
    # linux build host is otherwise blind to (it cannot exec a Mach-O; the keg
    # scan above only checks bin/ + bin/.pg-lib/, never the embedded-postgres
    # native tree where the pg server binaries live). This is the exact class that
    # shipped a broken embedded Postgres: the @embedded-postgres/darwin-x64 npm
    # cross-fetch drops the short→versioned dylib compat symlinks a Homebrew keg
    # carries (libzstd.1.dylib → libzstd.1.5.7.dylib), so postgres's @loader_path
    # refs pointed at nothing. Resolve every @loader_path ref against the Mach-O's
    # OWN dir and FAIL on any missing target — so this fails HERE on linux, not
    # on-device. (@rpath refs need LC_RPATH resolution and are NOT covered — pg
    # uses @loader_path; keeping scope tight avoids false positives.)
    _dangle_bad=0; _dangle_checked=0
    _macho_set=( "$BIN"/* "$BIN"/.pg-lib/* )
    while IFS= read -r _m; do _macho_set+=( "$_m" ); done < <(
      find "$SIDECAR" \( -path '*@embedded-postgres/darwin-*/native/bin/*' \
                       -o -path '*@embedded-postgres/darwin-*/native/lib/*.dylib' \) \
                      -type f 2>/dev/null )
    # Optional PG modules embedded PG NEVER auto-loads under papercusp's usage
    # (local/trust auth, no xml2 extension): dyld only resolves their deps on an
    # explicit dlopen that never happens here, so an unresolved @loader_path dep of
    # THESE is benign. Everything ALWAYS loaded (postgres/initdb/pg_ctl, libpq,
    # pgvector, libxml2 for the core xml type, the wired client tools) is still
    # hard-checked. Referrer-scoped (not dep-name-scoped) so a dangling libcurl/
    # libxslt in an actually-loaded binary would STILL fail. Verified unused:
    #   libpq-oauth-*.dylib → libcurl.4.dylib  (OAuth; macOS ships no libcurl file)
    #   pgxml.dylib         → libxslt.1.dylib  (xml2 contrib; grep-confirmed unused)
    _is_optional_pg_module() {
      case "$(basename "$1")" in libpq-oauth-*.dylib|pgxml.dylib) return 0 ;; *) return 1 ;; esac
    }
    for f in "${_macho_set[@]}"; do
      [[ -f "$f" ]] || continue
      _is_script "$f" && continue
      _is_macho "$f" || continue
      _is_optional_pg_module "$f" && continue
      _fdir="$(dirname "$f")"
      while IFS= read -r _ref; do
        [[ -n "$_ref" ]] || continue
        # @loader_path resolves relative to the referencing Mach-O's own directory.
        _resolved="${_ref/@loader_path/$_fdir}"
        [[ -e "$_resolved" ]] && continue
        fail "$(basename "$f"): dangling @loader_path linkage → $_ref (missing $_resolved) — dyld aborts at exec (WI-5651)"
        echo "      fix: bundle the dylib, or restore its short→versioned compat symlink in native/lib"
        _dangle_bad=1
      done < <("$_otool" -L "$f" 2>/dev/null | awk 'NR>1{print $1}' | grep -E '^@loader_path/' || true)
      _dangle_checked=$((_dangle_checked + 1))
    done
    [[ "$_dangle_bad" == 0 ]] && ok "no dangling @loader_path linkage across $_dangle_checked Mach-O ($_otool)"
  fi
else
  echo "  (skipped — target is not darwin)"
fi

# ── [5] Windows: sibling DLLs for vendored exes ─────────────────────────────
echo "[5/6] windows DLL presence"
case "$OS" in
  MINGW*|MSYS*|CYGWIN*)
    if [[ -f "$BIN/psql.exe" && ! -f "$BIN/libpq.dll" ]]; then
      fail "psql.exe present without libpq.dll beside it — DLLs were resolving via the build host's PATH (WI-3313)"
    else
      ok "pg tool DLLs present (or no .exe tools bundled)"
    fi ;;
  *) echo "  (skipped — not Windows)" ;;
esac

# ── [6] native modules load under the BUNDLED node ──────────────────────────
# WHY: [1]-[5] verify BINARIES and their linkage. Nothing here ever `require()`d
# a native NODE MODULE — and that is exactly how 0.0.9 shipped dead on all three
# platforms. copy_pkg_closure walked only `dependencies`, but napi packages ship
# their platform binaries as optionalDependencies, and every hop of sharp's chain
# is optional (sharp → @img/sharp-linux-x64 → @img/sharp-libvips-linux-x64). So
# the bundle packaged sharp's JavaScript and NONE of its native code: it passed
# every check above, installed cleanly, and died at boot with
# `Could not load the "sharp" module using the linux-x64 runtime`.
#
# ⚠ THE CONTRACT IS A STATIC LIST — deliberately. Do NOT "improve" this by
# scanning node_modules for *.node and testing what you find: a gate that derives
# its expectations from the artifact it is checking CANNOT FAIL ON A MISSING FILE.
# Had @img/sharp-linux-x64 been absent (i.e. the actual bug), a scan-driven gate
# would have found nothing to test and passed. Same cannot-fail defect as a boot
# probe that reads a refused connection as UP. Assert POSITIVELY, from a list.
#
# Windows note: the win sidecar is this same LINUX closure, run under WSL
# (main.rs make_sidecar_command → `wsl.exe --exec node`), so verifying it here on
# the linux build host is verifying the bytes Windows actually loads.
REQUIRED_NATIVE_MODULES="
sharp
better-sqlite3
@lydell/node-pty
sodium-native
udx-native
rocksdb-native
quickbit-native
rabin-native
simdle-native
fs-native-extensions
"
# ADVISORY (reported, never fatal): natives that are LAZILY imported, so a missing
# one degrades a feature instead of killing boot — and which upstream does not ship
# for every arch we build on.
#   onnxruntime-node: upstream ships bin/napi-v6/darwin/**arm64 only** — there is NO
#   darwin-x64 binding, so on the Intel mac build VM it CANNOT load, ever. It is also
#   deliberately kept off the boot path (voice-node/kokoro-local.ts: "Dynamic import
#   keeps onnxruntime-node's native load OFF the operator boot path"). Requiring it
#   would red every mac cut forever for a condition that is upstream's shape, not our
#   defect. Report it; never fail on it.
OPTIONAL_NATIVE_MODULES="
onnxruntime-node
"
echo "[6/6] native modules load under the bundled node"
if [[ "$CROSS" == "1" ]]; then
  # WI-5651: can't exec the target's node here — assert STATICALLY that every
  # required native ships a TARGET-format *.node in the bundle. This catches the
  # 0.0.9 missing-native / dead-on-boot class POSITIVELY, from the static list
  # (never derived from the artifact — see the contract note above). The real
  # dlopen load-test runs when the app is exercised on-target (the mac/windows
  # VMs remain for testing — owner directive 2026-07-20).
  _nat_target_present() {
    local m="$1" d nf
    local dirs="$SIDECAR/node_modules/$m"
    # Some natives ship their binary in a SIBLING per-platform package, not in
    # the JS package dir — include the target's platform package for those.
    case "$m" in
      sharp) dirs="$dirs $SIDECAR/node_modules/@img/sharp-${TARGET_OS_N}-${TARGET_ARCH_N} $SIDECAR/node_modules/@img/sharp-libvips-${TARGET_OS_N}-${TARGET_ARCH_N}" ;;
      @lydell/node-pty) dirs="$dirs $SIDECAR/node_modules/@lydell/node-pty-${TARGET_OS_N}-${TARGET_ARCH_N}" ;;
    esac
    for d in $dirs; do
      [[ -d "$d" ]] || continue
      while IFS= read -r nf; do _is_target_format "$nf" && return 0; done < <(find "$d" -name '*.node' 2>/dev/null)
    done
    return 1
  }
  for _m in $REQUIRED_NATIVE_MODULES; do
    if [[ ! -d "$SIDECAR/node_modules/$_m" ]]; then
      fail "$_m: package MISSING from the bundle closure"
    elif _nat_target_present "$_m"; then
      ok "$_m (${TARGET_OS_N}/${TARGET_ARCH_N} native present; dlopen load-test deferred to on-target)"
    else
      fail "$_m: no ${TARGET_OS_N}-${TARGET_ARCH_N} *.node in the bundle — the target's native binding is missing (0.0.9 dead-on-boot class); cross-fetch it in build-desktop-sidecar.sh"
    fi
  done
  for _m in $OPTIONAL_NATIVE_MODULES; do
    if _nat_target_present "$_m"; then
      ok "$_m (advisory; ${TARGET_OS_N} native present)"
    else
      echo "  ⚠ $_m (advisory): no ${TARGET_OS_N}-${TARGET_ARCH_N} native in the bundle — lazily imported, so boot is unaffected; the feature that uses it degrades"
    fi
  done
else
  NODE_BIN=""
for _c in "$BIN/node" "$BIN/node.exe"; do [[ -x "$_c" ]] && NODE_BIN="$_c" && break; done
if [[ -z "$NODE_BIN" ]]; then
  fail "no bundled node at bin/{node,node.exe} — cannot prove the shipped natives load"
elif [[ ! -d "$SIDECAR/node_modules" ]]; then
  fail "no node_modules/ in the sidecar — the dependency closure was never copied"
else
  # ⚠ A PLAIN `require()` HERE IS VACUOUS — it cannot fail. NODE RESOLVES UPWARD:
  # the sidecar sits inside the repo, so a native MISSING from the bundle is found
  # in an ancestor node_modules (papercusp-desktop/node_modules, …) and the broken
  # bundle greens. Verified: with the bundle's @img/ deleted — the exact 0.0.9
  # defect — a bare require('sharp') SUCCEEDED from the repo's copy. A user's
  # machine has no ancestor node_modules, so it dies there instead.
  #
  # So enforce the REAL contract — THE BUNDLE IS SELF-CONTAINED — by failing any
  # resolution that escapes it. This catches the missing native AND the upward
  # escape, in place, with no isolation copy.
  # NB: template ends in X's with NO suffix — BSD/macOS mktemp rejects a suffix
  # after the X's (GNU allows it), and this script runs on the mac build VM.
  # Extensionless is fine: node runs it as CommonJS (no package.json in TMPDIR).
  _guard_js="$(mktemp "${TMPDIR:-/tmp}/pc-nat-guard-XXXXXX")"
  cat >"$_guard_js" <<'GUARD_EOF'
const Module = require('module');
const path = require('path');
const fs = require('fs');
const ROOT = fs.realpathSync(process.env.PC_SIDECAR_ROOT) + path.sep;
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  const p = orig.call(this, request, parent, ...rest);
  // Builtins resolve to a bare specifier ("fs", "node:fs") — never absolute.
  if (path.isAbsolute(p) && !fs.realpathSync(p).startsWith(ROOT)) {
    const e = new Error('ESCAPED_BUNDLE: "' + request + '" resolved OUTSIDE the bundle -> ' + p);
    e.code = 'ESCAPED_BUNDLE';
    throw e;
  }
  return p;
};
// Resolve AS THE SIDECAR DOES — from inside the bundle. A bare `require()` here
// would resolve relative to THIS guard file (it lives in TMPDIR), not the cwd.
Module.createRequire(path.join(ROOT, 'serve.mjs'))(process.argv[2]);
GUARD_EOF
  _nat_ok=0
  for _m in $REQUIRED_NATIVE_MODULES; do
    if _err="$(cd "$SIDECAR" && PC_SIDECAR_ROOT="$SIDECAR" "$NODE_BIN" "$_guard_js" "$_m" 2>&1)"; then
      _nat_ok=$((_nat_ok+1))
    else
      case "$_err" in
        *ESCAPED_BUNDLE*)
          fail "$_m: resolved OUTSIDE the bundle — it is MISSING from the closure and only 'works' here because node walked up into the repo. On a clean install it dies." ;;
        *)
          fail "$_m: does NOT load from the bundle — it will die at boot on a clean install" ;;
      esac
      echo "$_err" | grep -m2 -E 'ESCAPED_BUNDLE|Error|Could not load|dlopen' | cut -c1-160 | sed 's/^/      /'
    fi
  done
  for _m in $OPTIONAL_NATIVE_MODULES; do
    if (cd "$SIDECAR" && PC_SIDECAR_ROOT="$SIDECAR" "$NODE_BIN" "$_guard_js" "$_m") >/dev/null 2>&1; then
      ok "$_m (advisory) loads"
    else
      echo "  ⚠ $_m (advisory): does not load from this bundle — lazily imported, so boot is unaffected; the feature that uses it degrades"
    fi
  done
  rm -f "$_guard_js"
  # Vacuity guard: a run where nothing loaded is a broken CHECK, not a clean bundle.
  [[ "$_nat_ok" -gt 0 ]] || fail "not one native module loaded — the check itself is broken"
  [[ "$FAIL" == 0 ]] && ok "all $_nat_ok required native modules load from INSIDE the bundle under $(basename "$NODE_BIN")"
fi
fi

echo
if [[ "$FAIL" != 0 ]]; then
  echo "verify-sidecar-bundle: FAILED — the bundle depends on build-host state that will not ship." >&2
  exit 1
fi
echo "verify-sidecar-bundle: OK"
