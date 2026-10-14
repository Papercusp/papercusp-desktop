#!/usr/bin/env bash
# Recompress a Tauri-produced Debian package's data archive with xz -9.
#
# dpkg packages are ar archives whose member order is significant.  Tauri
# currently emits data.tar.gz; rebuilding the package tree with dpkg-deb would
# also rewrite control metadata, so this helper changes only the data member.
# The replacement is assembled beside the input and atomically renamed over it.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEB_PATH="${1:?usage: repack-deb-xz.sh <package.deb>}"
[[ -f "$DEB_PATH" ]] || { echo "FATAL: deb not found: $DEB_PATH" >&2; exit 2; }

for tool in ar xz gzip dpkg-deb; do
  command -v "$tool" >/dev/null 2>&1 || { echo "FATAL: required tool not found: $tool" >&2; exit 3; }
done

# `-T0` scales compression workers to every host core. On the release host that
# let one repack grow past 27 GiB private RSS and amplify system-wide reclaim
# pressure. Keep the release path parallel, but make its default resource cost
# independent of host size. Operators may tune either budget explicitly; xz
# automatically lowers its effective worker count if the memory cap requires it.
XZ_THREADS="${PAPERCUSP_XZ_THREADS:-4}"
XZ_MEMORY_LIMIT="${PAPERCUSP_XZ_MEMORY_LIMIT:-4GiB}"
[[ "$XZ_THREADS" =~ ^[1-9][0-9]*$ ]] || {
  echo "FATAL: PAPERCUSP_XZ_THREADS must be a positive integer, got: $XZ_THREADS" >&2
  exit 7
}
[[ "$XZ_MEMORY_LIMIT" =~ ^[1-9][0-9]*(KiB|MiB|GiB)$ ]] || {
  echo "FATAL: PAPERCUSP_XZ_MEMORY_LIMIT must be a non-zero KiB/MiB/GiB value, got: $XZ_MEMORY_LIMIT" >&2
  exit 7
}

# EI-20559353000427453: stage-source-tree.sh's identity scrub uses an external
# quarantine, so a Debian payload must never contain the old in-sidecar
# `.stage-scrub-*/` tree. Check the package before recompression (and also when
# it is already xz-packed) so a future regression fails at the Debian chokepoint
# instead of shipping duplicate redacted source files.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/papercusp-deb-xz-guard.XXXXXX")"
REPLACEMENT=""
REPLACEMENT_SIGNATURE=""
REPLACEMENT_DIR=""
cleanup() {
  rm -rf -- "$WORK"
  [[ -z "$REPLACEMENT_DIR" ]] || rm -rf -- "$REPLACEMENT_DIR"
}
trap cleanup EXIT

check_stage_scrub() {
  local deb="$1"
  set +e
  dpkg-deb --contents "$deb" | grep -E '(^|/)\.stage-scrub-[^/]*/' > "$WORK/stage-scrub-members.txt"
  local _stage_scrub_status=("${PIPESTATUS[@]}")
  set -e
  if [[ "${_stage_scrub_status[0]}" != "0" ]]; then
    echo "FATAL: could not inspect Debian payload for stale .stage-scrub members: $deb" >&2
    exit 8
  fi
  if [[ -s "$WORK/stage-scrub-members.txt" ]]; then
    echo "FATAL: Debian payload contains stale .stage-scrub members; refusing to ship duplicate scrub files: $deb" >&2
    sed -n '1,20p' "$WORK/stage-scrub-members.txt" >&2
    exit 8
  fi
}

# WI-6554700010012467: an ar member header holds its size in 10 decimal digits, so a
# member is capped at 9,999,999,999 bytes. Tauri writes a larger data member anyway
# (a seeded Server's data.tar.gz was 11,962,260,753 bytes); the 11-digit size shifts
# the header and every dpkg/ar reader then calls the package "corrupt - bad archive
# header magic". Audit the headers first so that case is NAMED, and read its intact
# member bytes by offset so xz can still bring the payload under the cap.
AR_AUDIT="$SCRIPT_DIR/ar-member-audit.py"
AR_MEMBER_CAP=9999999999
# Tests lower the cap to exercise the refusal without a 10 GB fixture; it can only shrink.
if [[ -n "${PAPERCUSP_DEB_MEMBER_CAP_BYTES:-}" ]]; then
  [[ "$PAPERCUSP_DEB_MEMBER_CAP_BYTES" =~ ^[1-9][0-9]{0,9}$ ]] || {
    echo "FATAL: PAPERCUSP_DEB_MEMBER_CAP_BYTES must be a positive integer of at most 10 digits, got: $PAPERCUSP_DEB_MEMBER_CAP_BYTES" >&2
    exit 7
  }
  AR_MEMBER_CAP="$PAPERCUSP_DEB_MEMBER_CAP_BYTES"
fi
set +e
python3 "$AR_AUDIT" audit "$DEB_PATH" > "$WORK/ar-audit.txt" 2>&1
AR_AUDIT_STATUS=$?
set -e
OVER_CAP=0
case "$AR_AUDIT_STATUS" in
  0) ;;
  3)
    OVER_CAP=1
    echo "==> $DEB_PATH has an ar member above the 9,999,999,999-byte member cap (dpkg reads it as corrupt);" >&2
    echo "    reading its members by offset and recompressing (WI-6554700010012467):" >&2
    sed 's/^/    /' "$WORK/ar-audit.txt" >&2
    ;;
  *)
    echo "FATAL: $DEB_PATH is not a readable ar archive:" >&2
    sed 's/^/    /' "$WORK/ar-audit.txt" >&2
    exit 8
    ;;
esac

if (( OVER_CAP )); then
  # The stage-scrub check reads the payload through dpkg, which cannot open this
  # archive; it runs on the repacked replacement instead, before publication.
  mapfile -t MEMBERS < <(python3 "$AR_AUDIT" names "$DEB_PATH")
  member_cat() { python3 "$AR_AUDIT" extract "$DEB_PATH" "$1"; }
else
  check_stage_scrub "$DEB_PATH"
  mapfile -t MEMBERS < <(ar t "$DEB_PATH")
  member_cat() { ar p "$DEB_PATH" "$1"; }
fi
[[ "${#MEMBERS[@]}" -eq 3 ]] || {
  echo "FATAL: expected exactly 3 deb members in $DEB_PATH, found ${#MEMBERS[@]}" >&2
  exit 4
}
[[ "${MEMBERS[0]}" == "debian-binary" ]] || { echo "FATAL: first deb member is not debian-binary" >&2; exit 4; }
[[ "${MEMBERS[1]}" == control.tar.* ]] || { echo "FATAL: second deb member is not control.tar.*" >&2; exit 4; }
[[ "${MEMBERS[2]}" == data.tar.* ]] || { echo "FATAL: third deb member is not data.tar.*" >&2; exit 4; }

# WI-10006665: guard-only mode keeps every check above (stale .stage-scrub members, the
# 3-member layout) and leaves the package bytes and any .sig untouched. It exists for TEST
# artifacts (build-and-archive-deb.sh --test-artifact), which dpkg installs on a throwaway VM
# and reads data.tar.gz natively. There xz -9 cost ~55 min to save 0.68 GB of a 3.66 GB
# package (c1007, 2026-10-06); at the tower's measured ~1.3 MB/s GCS upload those 0.68 GB
# cost ~9 min, so skipping saves ~46 min per test build. Release builds never set it.
GUARD_ONLY="${PAPERCUSP_DEB_REPACK_GUARD_ONLY:-0}"
[[ "$GUARD_ONLY" == 0 || "$GUARD_ONLY" == 1 ]] || {
  echo "FATAL: PAPERCUSP_DEB_REPACK_GUARD_ONLY must be 0 or 1, got: $GUARD_ONLY" >&2
  exit 7
}
if (( OVER_CAP )) && [[ "$GUARD_ONLY" == 1 || "${MEMBERS[2]}" == "data.tar.xz" ]]; then
  # Guard-only keeps the data member as-is, and an xz member is already at its
  # smallest here: either way the over-cap member would ship, and no dpkg can read it.
  echo "FATAL: $DEB_PATH carries ${MEMBERS[2]} above the ar member cap and this mode cannot shrink it; no Debian package can carry it (WI-6554700010012467)" >&2
  exit 11
fi

if [[ "$GUARD_ONLY" == 1 ]]; then
  dpkg-deb --info "$DEB_PATH" >/dev/null
  echo "==> guard-only: checked $DEB_PATH; data member left as ${MEMBERS[2]} (no recompression)"
  exit 0
fi

if [[ "${MEMBERS[2]}" == "data.tar.xz" ]]; then
  dpkg-deb --info "$DEB_PATH" >/dev/null
  dpkg-deb --contents "$DEB_PATH" >/dev/null
  echo "==> already xz-packed: $DEB_PATH"
  exit 0
fi

case "${MEMBERS[2]}" in
  data.tar.gz)  DECOMPRESS=(gzip -dc) ;;
  data.tar.zst) DECOMPRESS=(zstd -dc) ;;
  data.tar.bz2) DECOMPRESS=(bzip2 -dc) ;;
  data.tar)     DECOMPRESS=(cat) ;;
  *) echo "FATAL: unsupported data member ${MEMBERS[2]} in $DEB_PATH" >&2; exit 4 ;;
esac
command -v "${DECOMPRESS[0]}" >/dev/null 2>&1 || {
  echo "FATAL: decompressor not found for ${MEMBERS[2]}: ${DECOMPRESS[0]}" >&2
  exit 3
}

# Never invalidate a Tauri updater signature without being able to replace it.
if [[ -f "$DEB_PATH.sig" && -z "${TAURI_SIGNING_PRIVATE_KEY:-${TAURI_SIGNING_PRIVATE_KEY_PATH:-}}" ]]; then
  echo "FATAL: $DEB_PATH.sig exists but TAURI_SIGNING_PRIVATE_KEY is unset; refusing to create a stale signature" >&2
  exit 5
fi

# Validate the actual signer contract before expensive compression. Resolve once,
# then expose only key content in the child; retain the caller's path setting.
_signing_key="${TAURI_SIGNING_PRIVATE_KEY:-${TAURI_SIGNING_PRIVATE_KEY_PATH:-}}"
if [[ -n "$_signing_key" && -f "$_signing_key" ]]; then
  _signing_key="$(cat "$_signing_key")"
fi
sign_repack_file() (
  unset TAURI_SIGNING_PRIVATE_KEY_PATH
  TAURI_SIGNING_PRIVATE_KEY="$_signing_key" \
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
    npx --yes -p "@tauri-apps/cli@${PAPERCUSP_TAURI_CLI_VERSION:-2.11.0}" \
      tauri signer sign "$1" >/dev/null
)
if [[ -n "$_signing_key" ]]; then
  : > "$WORK/signing-probe"
  if ! sign_repack_file "$WORK/signing-probe" || [[ ! -s "$WORK/signing-probe.sig" ]]; then
    echo "FATAL: updater signer preflight failed; refusing to compress or replace $DEB_PATH" >&2
    exit 6
  fi
fi

member_cat debian-binary > "$WORK/debian-binary"
member_cat "${MEMBERS[1]}" > "$WORK/${MEMBERS[1]}"

# A pipefail exit alone identifies none of the four components. That made a
# real release build terminate with status 1 immediately after Tauri emitted
# its bundle, with no repack diagnostic and no way to distinguish ar,
# decompression, dedupe, or xz (EI-21564012530779610). Capture PIPESTATUS
# immediately and name every component on failure. The original deb remains
# untouched because publication is still the atomic mv below.
set +e
member_cat "${MEMBERS[2]}" \
  | "${DECOMPRESS[@]}" \
  | python3 "$SCRIPT_DIR/dedupe-env-sidecar-tar.py" \
  | xz -9 "-T${XZ_THREADS}" "--memlimit-compress=${XZ_MEMORY_LIMIT}" -c > "$WORK/data.tar.xz"
REPACK_PIPESTATUS=("${PIPESTATUS[@]}")
set -e
if (( REPACK_PIPESTATUS[0] != 0 || REPACK_PIPESTATUS[1] != 0 || REPACK_PIPESTATUS[2] != 0 || REPACK_PIPESTATUS[3] != 0 )); then
  echo "FATAL: Debian data repack pipeline failed for $DEB_PATH" >&2
  echo "       component statuses: $( (( OVER_CAP )) && echo member-read-by-offset || echo ar )=${REPACK_PIPESTATUS[0]} decompress(${DECOMPRESS[0]})=${REPACK_PIPESTATUS[1]} dedupe-python=${REPACK_PIPESTATUS[2]} xz=${REPACK_PIPESTATUS[3]}" >&2
  exit 9
fi

# The ar format cannot carry a member above the cap however it is written, so a
# payload that stays too big even under xz -9 is refused here, by name, instead of
# producing a package dpkg calls corrupt (WI-6554700010012467).
XZ_MEMBER_BYTES="$(stat -c %s "$WORK/data.tar.xz")"
if (( XZ_MEMBER_BYTES > AR_MEMBER_CAP )); then
  echo "FATAL: the xz data member is $XZ_MEMBER_BYTES bytes, above the ar member cap of $AR_MEMBER_CAP bytes; no Debian package can carry this payload. Shrink it, or ship the largest component (e.g. the release seed) outside this package (WI-6554700010012467)." >&2
  exit 12
fi

PUBLISH_DIR="$(dirname -- "$DEB_PATH")"
PUBLISH_NAME="$(basename -- "$DEB_PATH")"
# Keep the complete archive on the destination filesystem. A cross-filesystem
# mv becomes copy+unlink, which can expose a partial package and is not the
# atomic replacement promised by this helper's contract.
REPLACEMENT_DIR="$(mktemp -d "$PUBLISH_DIR/.$PUBLISH_NAME.repacked.XXXXXX")"
REPLACEMENT="$REPLACEMENT_DIR/repacked.deb"
(cd "$WORK" && ar rc "$REPLACEMENT" debian-binary "${MEMBERS[1]}" data.tar.xz)
chmod --reference="$DEB_PATH" "$REPLACEMENT"

# Exercise both metadata and payload readers before replacing the known-good deb.
dpkg-deb --info "$REPLACEMENT" >/dev/null
dpkg-deb --contents "$REPLACEMENT" >/dev/null
if (( OVER_CAP )); then
  check_stage_scrub "$REPLACEMENT"
fi

SIGNATURE_STATUS="UNSIGNED"
if [[ -n "$_signing_key" ]]; then
  # WI-3823 (again, here): `tauri signer sign` accepts ONLY the key CONTENT (base64)
  # in TAURI_SIGNING_PRIVATE_KEY, while `tauri build` accepts contents OR a path — so
  # the conventional callers legitimately export a PATH (build-linux-local.sh:98 and
  # build-and-archive-deb.sh:63 both do, unconditionally) and only THIS call site
  # breaks. Symptom when unresolved, after a full compile + multi-GB bundle:
  #   failed to decode base64 secret key: ... Invalid symbol 45, offset 11
  # (symbol 45 is '-', and the offset lands on the first '-' of the key's own
  # pathname — i.e. the decoder was handed the path itself, not a key). The offset
  # therefore varies by machine; the "Invalid symbol 45" is the stable signature.
  # Resolve a path to its contents and hand the
  # secret over via the CLI's own env fallback, never on argv: `npm run`/npx echo the
  # resolved command line, which would print the private key into the build log and
  # expose it in `ps` for the life of the process.
  REPLACEMENT_SIGNATURE="$REPLACEMENT.sig"
  sign_repack_file "$REPLACEMENT"
  [[ -s "$REPLACEMENT_SIGNATURE" ]] || { echo "FATAL: Tauri signer produced no signature for the replacement package" >&2; exit 6; }
  SIGNATURE_STATUS="signed"
fi

# Publish only after every validation AND signing step succeeds. A signer
# failure must leave the known-good deb and its matching signature untouched.
mv -f "$REPLACEMENT" "$DEB_PATH"
REPLACEMENT=""
if [[ "$SIGNATURE_STATUS" == "signed" ]]; then
  mv -f "$REPLACEMENT_SIGNATURE" "$DEB_PATH.sig"
  REPLACEMENT_SIGNATURE=""
fi

echo "✓ repacked data member as xz -9: $DEB_PATH ($SIGNATURE_STATUS)"
if [[ "$SIGNATURE_STATUS" == "UNSIGNED" ]]; then
  echo "⚠ UNSIGNED: no TAURI_SIGNING_PRIVATE_KEY supplied; $DEB_PATH has no .sig" >&2
fi
