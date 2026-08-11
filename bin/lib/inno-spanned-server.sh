#!/usr/bin/env bash
# inno-spanned-server.sh — normalize an Inno DiskSpanning Server installer.
#
# Inno emits a small `*-setup.exe` stub plus `*-setup-N.bin` payload disks when
# the Server bundle exceeds its single-exe ceiling.  The stub is not a usable
# download by itself, and the payload disks are not updater artifacts.  Keep
# the detection and zip operation shared by every Windows release entry point;
# otherwise a direct cross-build can disagree with the full release cut or an
# incremental publisher.

PAPERCUSP_SPANNED_SERVER_STUB=""
PAPERCUSP_SPANNED_SERVER_ZIP=""
PAPERCUSP_SPANNED_SERVER_SLICES=()

# papercusp_normalize_spanned_server <inno_dir> <version>
#
# Return codes:
#   0 — a Server stub + slices were found and a non-empty zip was produced.
#   1 — no spanned Server set was found (also used for a single-file Server).
#   2 — a spanned set was found but normalization failed; callers must refuse
#       to publish the raw stub/slices.
#
# The raw files remain on disk.  Callers replace them in their artifact arrays
# with PAPERCUSP_SPANNED_SERVER_ZIP, which keeps provenance/debugging intact
# while ensuring upload and manifest inputs contain one usable bundle.
papercusp_normalize_spanned_server() {
  local inno_dir="$1" version="$2" f
  PAPERCUSP_SPANNED_SERVER_STUB=""
  PAPERCUSP_SPANNED_SERVER_ZIP=""
  PAPERCUSP_SPANNED_SERVER_SLICES=()

  [[ -d "$inno_dir" ]] || return 1

  local -a stubs=()
  shopt -s nullglob
  stubs=( "$inno_dir"/*Server*_"$version"_*-setup.exe )
  shopt -u nullglob
  for f in "${stubs[@]}"; do
    [[ -f "$f" ]] && PAPERCUSP_SPANNED_SERVER_STUB="$f"
  done
  [[ -n "$PAPERCUSP_SPANNED_SERVER_STUB" ]] || return 1

  local base="${PAPERCUSP_SPANNED_SERVER_STUB%.exe}"
  shopt -s nullglob
  PAPERCUSP_SPANNED_SERVER_SLICES=( "$base"-*.bin )
  shopt -u nullglob
  local -a existing_slices=()
  for f in "${PAPERCUSP_SPANNED_SERVER_SLICES[@]}"; do
    [[ -f "$f" ]] && existing_slices+=("$f")
  done
  PAPERCUSP_SPANNED_SERVER_SLICES=( "${existing_slices[@]}" )
  # A Server setup without slices is a valid single-file build, not a span.
  (( ${#PAPERCUSP_SPANNED_SERVER_SLICES[@]} > 0 )) || return 1

  PAPERCUSP_SPANNED_SERVER_ZIP="${base}.zip"
  if ! command -v zip >/dev/null 2>&1 \
     || ! rm -f "$PAPERCUSP_SPANNED_SERVER_ZIP" \
     || ! zip -0 -j "$PAPERCUSP_SPANNED_SERVER_ZIP" \
          "$PAPERCUSP_SPANNED_SERVER_STUB" \
          "${PAPERCUSP_SPANNED_SERVER_SLICES[@]}" >/dev/null 2>&1 \
     || [[ ! -s "$PAPERCUSP_SPANNED_SERVER_ZIP" ]]; then
    return 2
  fi
  return 0
}

# papercusp_spanned_server_artifact <path> — true when PATH is one of the raw
# span inputs (including its orphanable signature) or the normalized zip.
papercusp_spanned_server_artifact() {
  local artifact="$1" slice
  [[ -n "$PAPERCUSP_SPANNED_SERVER_STUB" ]] || return 1
  [[ "$artifact" == "$PAPERCUSP_SPANNED_SERVER_STUB" \
     || "$artifact" == "$PAPERCUSP_SPANNED_SERVER_STUB.sig" \
     || "$artifact" == "$PAPERCUSP_SPANNED_SERVER_ZIP" ]] && return 0
  for slice in "${PAPERCUSP_SPANNED_SERVER_SLICES[@]}"; do
    [[ "$artifact" == "$slice" ]] && return 0
  done
  return 1
}
