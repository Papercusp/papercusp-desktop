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

mapfile -t MEMBERS < <(ar t "$DEB_PATH")
[[ "${#MEMBERS[@]}" -eq 3 ]] || {
  echo "FATAL: expected exactly 3 deb members in $DEB_PATH, found ${#MEMBERS[@]}" >&2
  exit 4
}
[[ "${MEMBERS[0]}" == "debian-binary" ]] || { echo "FATAL: first deb member is not debian-binary" >&2; exit 4; }
[[ "${MEMBERS[1]}" == control.tar.* ]] || { echo "FATAL: second deb member is not control.tar.*" >&2; exit 4; }
[[ "${MEMBERS[2]}" == data.tar.* ]] || { echo "FATAL: third deb member is not data.tar.*" >&2; exit 4; }

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
if [[ -f "$DEB_PATH.sig" && -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  echo "FATAL: $DEB_PATH.sig exists but TAURI_SIGNING_PRIVATE_KEY is unset; refusing to create a stale signature" >&2
  exit 5
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/papercusp-deb-xz.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

ar p "$DEB_PATH" debian-binary > "$WORK/debian-binary"
ar p "$DEB_PATH" "${MEMBERS[1]}" > "$WORK/${MEMBERS[1]}"
ar p "$DEB_PATH" "${MEMBERS[2]}" \
  | "${DECOMPRESS[@]}" \
  | python3 "$SCRIPT_DIR/dedupe-env-sidecar-tar.py" \
  | xz -9 -T0 -c > "$WORK/data.tar.xz"

REPLACEMENT="$WORK/repacked.deb"
(cd "$WORK" && ar rc "$REPLACEMENT" debian-binary "${MEMBERS[1]}" data.tar.xz)
chmod --reference="$DEB_PATH" "$REPLACEMENT"

# Exercise both metadata and payload readers before replacing the known-good deb.
dpkg-deb --info "$REPLACEMENT" >/dev/null
dpkg-deb --contents "$REPLACEMENT" >/dev/null

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
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
  _key="$TAURI_SIGNING_PRIVATE_KEY"; [[ -f "$_key" ]] && _key="$(cat "$_key")"
  TAURI_SIGNING_PRIVATE_KEY="$_key" \
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
    npx --yes -p "@tauri-apps/cli@${PAPERCUSP_TAURI_CLI_VERSION:-2.11.0}" \
      tauri signer sign "$REPLACEMENT" >/dev/null
  [[ -s "$REPLACEMENT.sig" ]] || { echo "FATAL: Tauri signer produced no signature for the replacement package" >&2; exit 6; }
fi

# Publish only after every validation AND signing step succeeds. A signer
# failure must leave the known-good deb and its matching signature untouched.
mv -f "$REPLACEMENT" "$DEB_PATH"
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  mv -f "$REPLACEMENT.sig" "$DEB_PATH.sig"
fi

echo "✓ repacked data member as xz -9: $DEB_PATH"
