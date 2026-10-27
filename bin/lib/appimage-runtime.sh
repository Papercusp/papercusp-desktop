#!/usr/bin/env bash
# papercusp_appimage_runtime_* — the AppImage type-2 runtime is PINNED, VENDORED
# and VERIFIED (EI-27096956663669253).
#
# THE DEFECT. The runtime is the ELF stub that executes first on every launch of
# the signed GUI AppImage. appimagetool fetches it from AppImage/type2-runtime's
# moving 'continuous' tag whenever --runtime-file is absent, and the release
# cuts never passed one. Each cut therefore embedded whatever that tag held at
# build time. Nothing reviewed or recorded it, two cuts of the same source could
# embed different runtimes, a GitHub outage failed the cut, and a compromised tag
# would have shipped silently. The updater .sig covers the final bytes, but
# nothing tied those bytes to a reviewed runtime.
#
# THE FIX. The reviewed bytes live in vendor/appimage-runtime/runtime-x86_64,
# with their provenance in the README there, and their sha256 is pinned below.
# build-appimage.sh resolves the runtime through papercusp_appimage_runtime_path
# before any build work and always passes it with --runtime-file. Before the
# AppImage is signed, appimage-runtime-embedded.py proves the packaged bytes
# carry exactly that runtime.
#
# The vendored file is resolved from the tree this library lives in, never from
# a target-source override. The pin constant and the bytes it describes
# therefore always come from the same checkout.
#
# BUMPING: follow vendor/appimage-runtime/README.md. Do not point this at the
# 'continuous' URL.

PAPERCUSP_APPIMAGE_RUNTIME_SHA256=617aa77314d57c8b8e4fae9c3f0b35af7b30d5529cb69e98f64f92510ed98a46
PAPERCUSP_APPIMAGE_RUNTIME_UPSTREAM='AppImage/type2-runtime@fedfad5 continuous/runtime-x86_64 (published 2026-10-19T20:37:20Z)'

# papercusp_appimage_runtime_default_file — the vendored runtime in this tree.
papercusp_appimage_runtime_default_file() {
  local lib_dir
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || return 1
  printf '%s\n' "$lib_dir/../../vendor/appimage-runtime/runtime-x86_64"
}

# papercusp_appimage_runtime_path — print the verified runtime path, or fail.
# LDAI_RUNTIME_FILE (appimagetool's own knob) is still honoured, but it must
# hash to the pin. It can relocate the reviewed bytes, never replace them.
papercusp_appimage_runtime_path() {
  local file actual=""
  file="${LDAI_RUNTIME_FILE:-$(papercusp_appimage_runtime_default_file)}" || return 1
  if [ ! -f "$file" ]; then
    echo "FATAL: pinned AppImage runtime not found at $file (EI-27096956663669253)" >&2
    return 1
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | cut -d' ' -f1)" || actual=""
  fi
  if [ "$actual" != "$PAPERCUSP_APPIMAGE_RUNTIME_SHA256" ]; then
    echo "FATAL: AppImage runtime $file has sha256 '${actual:-unavailable}', pinned $PAPERCUSP_APPIMAGE_RUNTIME_SHA256 — refusing to package an unreviewed runtime (EI-27096956663669253)" >&2
    return 1
  fi
  printf '%s\n' "$file"
}
