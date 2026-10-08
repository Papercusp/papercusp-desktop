#!/usr/bin/env bash
# Reuse libdmg-hfsplus; cache the minimal 64-bit allocator repair rather than
# replacing a shared installation. Every use qualifies the actual binary.
set -euo pipefail
[[ $# -eq 3 ]] || { echo 'usage: prepare-hfsplus-tool.sh TOOL PREFLIGHT DIAGNOSTICS' >&2; exit 2; }
candidate="$1" preflight="$2" diagnostics="$3"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$diagnostics"
if python3 "$preflight" --tool "$candidate" --mkfs "$(command -v mkfs.hfsplus)" \
    --work-root "$diagnostics" >"$diagnostics/allocation-preflight.log" 2>&1; then
  printf '%s\n' "$candidate"
  exit 0
fi
cat "$diagnostics/allocation-preflight.log" >&2
revision=7ac55ec64c96f7800d9818ce64c79670e7f02b67
archive_sha=56fbdc48ec110966342f0ecddd6f8f89202f4143ed2a3336e42bbf88f940850c
patch_file="$here/hfsplus-64bit-allocation.patch"
cache_root="${PAPERCUSP_HFSPLUS_TOOL_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/papercusp/mac-cross-tools}"
identity="$(sha256sum "$patch_file" "$preflight" | sha256sum | cut -d' ' -f1)"
cache="$cache_root/$revision-$identity"
mkdir -p "$cache"
# Serialize only this exact tool recipe, independently of other release builds.
exec 9>"$cache/build.lock"
flock 9
if [[ ! -x "$cache/hfsplus" ]]; then
  build="$(mktemp -d "$cache/build.XXXXXX")"
  curl --fail --location --silent --show-error --max-time 120 \
    "https://codeload.github.com/planetbeing/libdmg-hfsplus/tar.gz/$revision" \
    --output "$build/source.tar.gz"
  printf '%s  %s\n' "$archive_sha" "$build/source.tar.gz" | sha256sum -c - >&2
  mkdir "$build/source"
  tar -xzf "$build/source.tar.gz" --strip-components=1 -C "$build/source"
  patch --batch --fuzz=0 -p1 -d "$build/source" <"$patch_file" >&2
  cmake -S "$build/source" -B "$build/compiled" >"$diagnostics/tool-configure.log" 2>&1
  cmake --build "$build/compiled" --target hfsplus --parallel 2 >"$diagnostics/tool-build.log" 2>&1
  tool="$build/compiled/hfs/hfsplus"
  [[ -x "$tool" ]] || { echo "HFS tool build produced no executable: $build" >&2; exit 1; }
  python3 "$preflight" --tool "$tool" --mkfs "$(command -v mkfs.hfsplus)" \
    --work-root "$diagnostics" >"$diagnostics/allocation-preflight-fixed.log" 2>&1
  cp "$tool" "$cache/hfsplus.tmp.$$"
  chmod 755 "$cache/hfsplus.tmp.$$"
  mv "$cache/hfsplus.tmp.$$" "$cache/hfsplus"
fi
python3 "$preflight" --tool "$cache/hfsplus" --mkfs "$(command -v mkfs.hfsplus)" \
  --work-root "$diagnostics" >"$diagnostics/allocation-preflight-fixed.log" 2>&1
printf '%s\n' "$cache/hfsplus"
