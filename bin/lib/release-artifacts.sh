#!/usr/bin/env bash
# release-artifacts.sh — the SINGLE source of truth for "which files make up this
# desktop cut", shared by the two halves of the release pipeline (EI-12913).
#
# THE BUG THIS FIXES: release-local.sh (the BUILD half) and upload-release.sh
# (the PUBLISH half) each decided INDEPENDENTLY which files were "this cut's
# artifacts", and the two decisions DRIFTED:
#   - release-local.sh globs
#     $ROOT/src-tauri/target/windows-vm/bundle/inno/*_<ver>_* — the real Inno
#     output tree — catching the -setup.exe, its .sig, AND the DiskSpanning .bin
#     slices. (A Server installer's ~4 GB payload lives ENTIRELY in those .bin
#     slices: src-tauri/windows/inno/papercusp.iss sets DiskSpanning=yes, so the
#     .exe is a ~3.6 MB stub that is useless without the .bin files next to it.)
#   - upload-release.sh re-derived its OWN set with a `find` over
#     ~/.cargo-target/release/bundle/{deb,appimage,dmg,macos,nsis,msi} — which has
#     no `inno` dir at all and still names `nsis`, the retired packager — plus an
#     extension allowlist that EXCLUDED `.bin`. So it could not see the windows
#     artifacts, and even where it could it would have dropped every Server .bin
#     slice — publishing a stub whose payload is missing (Inno then prompts for
#     the absent slices and the install fails).
# Two scripts, two globs, one drifts → the LABELED != PACKED failure class. The
# durable fix is to STOP re-deriving: release-local.sh (which already computes the
# correct set) WRITES it here, and upload-release.sh READS it — one list, no drift.
# Fixing only the `.bin` regex would leave the wrong-tree gap armed for the next
# packager change; sharing the list closes the whole class.
#
# The manifest lives next to latest.json in /tmp (same TAG-scoped, same ephemeral
# lifecycle: if one is gone the other is, and you re-cut anyway).

# release_artifacts_manifest_path <tag> — the manifest file path for a cut.
release_artifacts_manifest_path() {
  printf '/tmp/papercusp-artifacts-%s.txt\n' "$1"
}

# release_artifacts_write <tag> <artifact>... — record the cut's artifact set.
# One ABSOLUTE path per line, sorted + de-duplicated, EXISTING files only (an
# unmatched glob expands to a literal pattern, and a vanished file is dropped —
# so a caller can pass raw globs/optional paths and only real files are recorded).
# Overwrites any prior manifest for the tag. Prints the manifest path.
release_artifacts_write() {
  local tag="$1"; shift
  local out; out="$(release_artifacts_manifest_path "$tag")"
  {
    local f
    for f in "$@"; do
      [[ -f "$f" ]] || continue
      # Absolute-ize so the reader (a different CWD) resolves it.
      [[ "$f" = /* ]] || f="$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"
      printf '%s\n' "$f"
    done
  } | sort -u > "$out"
  printf '%s\n' "$out"
}

# release_artifacts_read <tag> — print the cut's artifact paths (one per line),
# EXISTING files only. Returns non-zero (with a message on stderr) if the manifest
# is absent or resolves to zero present files. The caller MUST treat that as a
# hard error and NEVER fall back to a second, drifting glob — the divergence is
# the bug.
release_artifacts_read() {
  local tag="$1"
  local manifest; manifest="$(release_artifacts_manifest_path "$tag")"
  if [[ ! -f "$manifest" ]]; then
    echo "release-artifacts: no manifest at $manifest — run bin/release-local.sh <version> <channel> first (it writes this)." >&2
    return 1
  fi
  local -a present=()
  local line
  while IFS= read -r line; do
    [[ -n "$line" && -f "$line" ]] && present+=("$line")
  done < "$manifest"
  if [[ ${#present[@]} -eq 0 ]]; then
    echo "release-artifacts: manifest $manifest names no existing files — the cut's artifacts are gone; re-run bin/release-local.sh." >&2
    return 1
  fi
  printf '%s\n' "${present[@]}"
}

# release_artifacts_assert_urls_covered <tag> <latest_json>... — RECURRENCE GUARD.
# Every artifact URL a manifest ADVERTISES must have its (url-decoded) basename
# present in the cut's artifact set. This catches the whole drift class BEFORE
# upload: a latest.json that names a file the upload set does not carry would 404
# for every updater client — the exact LABELED != PACKED failure the post-upload
# fetch-check catches only AFTER the lie is already live. Returns 0 if every
# advertised url is covered, 1 (and prints the offenders on stderr) otherwise.
# Missing / empty latest_json arguments are skipped (latest-server.json is
# optional — only Server-role cuts produce it).
release_artifacts_assert_urls_covered() {
  local tag="$1"; shift
  local manifest; manifest="$(release_artifacts_manifest_path "$tag")"
  [[ -f "$manifest" ]] || { echo "release-artifacts: no manifest at $manifest to check against." >&2; return 1; }
  python3 - "$manifest" "$@" <<'PY'
import json, os, sys
from urllib.parse import unquote, urlsplit
manifest = sys.argv[1]
have = set()
with open(manifest) as fh:
    for line in fh:
        line = line.strip()
        if line:
            have.add(os.path.basename(line))
missing = []
for mpath in sys.argv[2:]:
    if not mpath or not os.path.isfile(mpath):
        continue
    m = json.load(open(mpath))
    for plat, entry in (m.get("platforms") or {}).items():
        url = (entry or {}).get("url") or ""
        name = os.path.basename(unquote(urlsplit(url).path))
        if not name:
            continue
        if name not in have:
            missing.append((os.path.basename(mpath), plat, name))
if missing:
    print("release-artifacts: manifest advertises artifact(s) NOT in the upload set:", file=sys.stderr)
    for mf, plat, name in missing:
        print(f"  {mf} [{plat}] -> {name}", file=sys.stderr)
    sys.exit(1)
PY
}
