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
  # Resolve symlinks: a symlinked copy of this library (test fixtures and
  # assembled trees) still names the vendored bytes of the tree that owns the pin.
  lib_dir="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" || return 1
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

# ── papercusp_appimage_packer_* — the packer is PINNED too (EI-27158244411414674)
#
# THE DEFECT. build-appimage.sh packed with `ls ~/.cache/tauri/*plugin-appimage*
# .AppImage | sed -n 1p`: whichever linuxdeploy-plugin-appimage the Tauri CLI had
# cached, or whichever sorted first. Its bundled appimagetool and mksquashfs
# write every byte of the signed GUI AppImage after the runtime. Nothing pinned
# or recorded it, and that cache is mutable: the linuxdeploy-x86_64.AppImage
# beside it was rewritten at 2026-10-27T16:45Z (mtime) by an unrecorded writer.
#
# THE FIX. The packer is pinned by sha256 and resolved from a content-addressed
# store outside the tree. It is a 16 MB AppImage, too large to vendor. The store
# is seeded from the Tauri cache only with a file that hashes to the pin, and
# the stored file is hashed again on every resolution, just before use.
#
# THE PINNED BYTES packed every cut up to and including 0.0.32. They bundle
# appimagetool continuous build 295 (git 8c8c91f, built 2025-12-04). Upstream's
# 'continuous' asset moved on 2026-06-07, and no dated release has these bytes,
# so they can no longer be downloaded. Do not delete the store.
#
# BUMPING: choose an upstream asset that GitHub publishes with a sha256 `digest`
# (a dated release, or a reviewed 'continuous'). Download it and check the digest.
# Place it at "<store>/sha256/<sha256>/linuxdeploy-plugin-appimage.AppImage".
# Update the two constants below. Then cut a candidate and re-run the VM journey
# before publishing.

PAPERCUSP_APPIMAGE_PACKER_SHA256=b42404a077ba7e10db708a2fa334768e34cc3807eab562f8fb8e02be2aa24f49
PAPERCUSP_APPIMAGE_PACKER_UPSTREAM='linuxdeploy/linuxdeploy-plugin-appimage continuous (appimagetool build 295, git 8c8c91f, 2025-12-04; 16484856 bytes)'

# papercusp_appimage_packer_store_file — where the pinned packer lives.
# PAPERCUSP_RELEASE_TOOLS_DIR relocates the store. The sha256 path component
# keeps every pin in its own directory, so a bump never overwrites old bytes.
papercusp_appimage_packer_store_file() {
  printf '%s/sha256/%s/linuxdeploy-plugin-appimage.AppImage\n' \
    "${PAPERCUSP_RELEASE_TOOLS_DIR:-$HOME/.local/share/papercusp/release-tools}" \
    "$PAPERCUSP_APPIMAGE_PACKER_SHA256"
}

_papercusp_appimage_sha256_of() {
  sha256sum -- "$1" 2>/dev/null | cut -d' ' -f1
}

# papercusp_appimage_packer_verify FILE — fail unless FILE hashes to the pin.
papercusp_appimage_packer_verify() {
  local file="${1:?AppImage packer path required}" actual=""
  [ -f "$file" ] && actual="$(_papercusp_appimage_sha256_of "$file")"
  if [ "$actual" != "$PAPERCUSP_APPIMAGE_PACKER_SHA256" ]; then
    echo "FATAL: AppImage packer $file has sha256 '${actual:-unavailable}', pinned $PAPERCUSP_APPIMAGE_PACKER_SHA256 — refusing to pack with an unreviewed appimagetool (EI-27158244411414674)" >&2
    return 1
  fi
}

# papercusp_appimage_packer_path — print the verified packer path, or fail.
# PAPERCUSP_TAURI_TOOLS_DIR relocates the Tauri cache that seeding reads.
papercusp_appimage_packer_path() {
  local store dir candidate tmp
  store="$(papercusp_appimage_packer_store_file)" || return 1
  dir="$(dirname "$store")"
  if [ ! -f "$store" ]; then
    for candidate in "${PAPERCUSP_TAURI_TOOLS_DIR:-$HOME/.cache/tauri}"/*plugin-appimage*.AppImage; do
      [ -f "$candidate" ] || continue
      [ "$(_papercusp_appimage_sha256_of "$candidate")" = "$PAPERCUSP_APPIMAGE_PACKER_SHA256" ] || continue
      mkdir -p -- "$dir" || return 1
      tmp="$(mktemp "$dir/.seed.XXXXXX")" || return 1
      # Hash the copy, not the source: the cache can change under us.
      if cp -- "$candidate" "$tmp" && chmod 0555 -- "$tmp" \
          && [ "$(_papercusp_appimage_sha256_of "$tmp")" = "$PAPERCUSP_APPIMAGE_PACKER_SHA256" ] \
          && mv -f -- "$tmp" "$store"; then
        echo "   seeded the pinned AppImage packer from $candidate" >&2
        break
      fi
      rm -f -- "$tmp"
    done
  fi
  if [ ! -f "$store" ]; then
    echo "FATAL: pinned AppImage packer not found at $store, and no cached *plugin-appimage*.AppImage hashes to $PAPERCUSP_APPIMAGE_PACKER_SHA256 (EI-27158244411414674). See BUMPING in bin/lib/appimage-runtime.sh." >&2
    return 1
  fi
  papercusp_appimage_packer_verify "$store" || return 1
  printf '%s\n' "$store"
}
