#!/usr/bin/env bash
# release-artifacts.selftest.sh — focused unit test for release-artifacts.sh, the
# single-source-of-truth artifact set the two halves of the release pipeline share
# (EI-12913). It proves, hermetically (synthetic files in a temp dir — NO real cut,
# NO VM, NO network, ~1s):
#   1. write -> read carries every DiskSpanning Server `.bin` slice (gap 2: the old
#      upload glob's extension allowlist EXCLUDED `.bin`, dropping the ~4 GB payload)
#      AND the inno-tree .exe/.sig (gap 1: the old glob scanned the WRONG tree with
#      no `inno` dir) — i.e. the windows artifacts flow through the manifest, not a
#      second, drifting glob.
#   2. read drops a vanished file and de-duplicates.
#   3. read FAILS HARD when there is no manifest — it never silently falls back to a
#      re-derived glob (that fallback IS the drift this fix removes).
#   4. the recurrence guard PASSES when latest.json only advertises covered artifacts.
#   5. the recurrence guard FAILS when latest.json advertises an artifact the upload
#      set does not carry (the LABELED != PACKED class, caught BEFORE upload).
#
#   bash bin/lib/release-artifacts.selftest.sh      # exit 0 = PASS, 1 = FAIL
#
# Why a bash self-test and not Vitest: the unit under test is bash. The desktop
# package tests its sourced bash helpers this way (see federation-asserts.selftest.sh);
# the four canonical TS/Cargo/LLM frameworks don't host shell units, and this
# submodule is not part of the operator's hoisted vitest workspace.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=release-artifacts.sh
source "$DIR/release-artifacts.sh"
# shellcheck source=inno-spanned-server.sh
source "$DIR/inno-spanned-server.sh"
set +e   # this self-test owns its own exit codes (some asserts intentionally fail a call)

command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 unavailable"; exit 0; }

FAILS=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }

WORK="$(mktemp -d /tmp/relart-selftest.XXXXXX)"
# Unique tags so the /tmp manifests can't collide with a real cut or a parallel run.
TAG="desktop-v0.0.0-selftest-$$"
TAG_EMPTY="desktop-v0.0.0-selftest-empty-$$"
cleanup() {
  rm -rf "$WORK"
  rm -f "$(release_artifacts_manifest_path "$TAG")" "$(release_artifacts_manifest_path "$TAG_EMPTY")"
}
trap cleanup EXIT

VER="9.9.9"
INNO="$WORK/inno"; LINUX="$WORK/linux"
mkdir -p "$INNO" "$LINUX"
# The Server installer + its DiskSpanning slices (the shape that broke): a stub .exe
# plus TWO .bin slices carrying the payload, plus the .sig; and a linux .deb.
EXE="$INNO/Papercusp Server_${VER}_x64-setup.exe"
SIG="$INNO/Papercusp Server_${VER}_x64-setup.exe.sig"
BIN1="$INNO/Papercusp Server_${VER}_x64-setup-1.bin"
BIN2="$INNO/Papercusp Server_${VER}_x64-setup-2.bin"
DEB="$LINUX/Papercusp_${VER}_amd64.deb"
for f in "$EXE" "$SIG" "$BIN1" "$BIN2" "$DEB"; do : > "$f"; done

echo "release-artifacts self-test (tag=$TAG)"

# 0a) all three Windows entry points source and invoke the same helper. This is
# a static wiring guard: a green helper unit alone would not catch a caller
# silently bypassing it again.
for script in \
  "$DIR/../build-windows-cross.sh" \
  "$DIR/../publish-platform-incremental.sh" \
  "$DIR/../release-local.sh"; do
  if grep -Fq 'source "$HERE/lib/inno-spanned-server.sh"' "$script" \
     && grep -Fq 'papercusp_normalize_spanned_server' "$script"; then
    ok "$(basename "$script") uses shared Server span normalization"
  else
    bad "$(basename "$script") bypasses shared Server span normalization"
  fi
done

# 0b) target roots may be symlinks. Resolve the root before any manual
# artifact scan and follow links explicitly; a bare find over the link returns
# no rows with exit 0 on the affected host, which is indistinguishable from a
# genuine empty tree.
REAL_TARGET="$WORK/target-real"
LINK_TARGET="$WORK/target-link"
mkdir -p "$REAL_TARGET/release/bundle/appimage"
SYMLINK_APPIMAGE="$REAL_TARGET/release/bundle/appimage/Papercusp_${VER}_amd64.AppImage"
: > "$SYMLINK_APPIMAGE"
ln -s "$REAL_TARGET" "$LINK_TARGET"
EXPECTED_ROOT="$(cd "$REAL_TARGET" && pwd -P)"
RESOLVED_ROOT="$(release_artifacts_resolve_root "$LINK_TARGET")"
if [[ "$RESOLVED_ROOT" == "$EXPECTED_ROOT" ]]; then
  ok "resolves a symlinked target root to its physical directory"
else
  bad "symlinked target root resolved to '$RESOLVED_ROOT' (expected '$EXPECTED_ROOT')"
fi
mapfile -t FOLLOWED_APPIMAGES < <(find -L "$LINK_TARGET" -type f -name '*.AppImage' -print)
FOUND_APPIMAGE=""
if [[ "${#FOLLOWED_APPIMAGES[@]}" -eq 1 ]]; then
  FOUND_APPIMAGE="$(cd "$(dirname "${FOLLOWED_APPIMAGES[0]}")" && pwd -P)/$(basename "${FOLLOWED_APPIMAGES[0]}")"
fi
EXPECTED_APPIMAGE="$(cd "$(dirname "$SYMLINK_APPIMAGE")" && pwd -P)/$(basename "$SYMLINK_APPIMAGE")"
if [[ "$FOUND_APPIMAGE" == "$EXPECTED_APPIMAGE" ]]; then
  ok "symlink-safe artifact scan follows the target root"
else
  bad "symlink-safe artifact scan missed the AppImage under the target root"
fi

# 0) every Windows entry point shares the DiskSpan normalization decision. The
# raw stub + slices are replaced by one zip for artifact selection, while the
# original files remain available for provenance/debugging.
if papercusp_normalize_spanned_server "$INNO" "$VER"; then
  ZIP="${PAPERCUSP_SPANNED_SERVER_ZIP}"
  [[ -s "$ZIP" ]] && ok "normalizes a spanned Server into a non-empty zip" \
    || bad "normalization reported success without a non-empty zip"
  if python3 - "$ZIP" "$EXE" "$BIN1" "$BIN2" <<'PY'
import sys, zipfile
archive, *files = sys.argv[1:]
with zipfile.ZipFile(archive) as z:
    names = set(z.namelist())
for path in files:
    assert path.rsplit('/', 1)[-1] in names, (path, sorted(names))
PY
  then
    ok "normalized zip contains the stub and every DiskSpan slice"
  else
    bad "normalized zip omitted a stub or DiskSpan slice"
  fi
  if papercusp_spanned_server_artifact "$EXE" \
     && papercusp_spanned_server_artifact "$SIG" \
     && papercusp_spanned_server_artifact "$BIN1" \
     && papercusp_spanned_server_artifact "$ZIP"; then
    ok "shared matcher identifies raw span inputs and normalized zip"
  else
    bad "shared matcher missed a raw span input or normalized zip"
  fi
else
  bad "spanned Server normalization failed unexpectedly"
fi

NO_SPAN="$WORK/no-span"
mkdir -p "$NO_SPAN"
: > "$NO_SPAN/Papercusp Server_${VER}_x64-setup.exe"
if papercusp_normalize_spanned_server "$NO_SPAN" "$VER"; then
  bad "single-file Server was incorrectly classified as spanned"
else
  ok "single-file Server is not classified as spanned"
fi

# 1) write -> read round-trip carries the .bin slices AND the inno .exe/.sig.
release_artifacts_write "$TAG" "$EXE" "$SIG" "$BIN1" "$BIN2" "$DEB" >/dev/null
mapfile -t GOT < <(release_artifacts_read "$TAG")
have_in_got() { local needle="$1" g; for g in "${GOT[@]}"; do [[ "$g" == "$needle" ]] && return 0; done; return 1; }
[[ ${#GOT[@]} -eq 5 ]] && ok "read returns all 5 artifacts" || bad "read returned ${#GOT[@]} artifacts, expected 5"
have_in_got "$BIN1" && ok "carries Server .bin slice 1 (gap 2)"        || bad ".bin slice 1 was dropped (gap 2 regression)"
have_in_got "$BIN2" && ok "carries Server .bin slice 2 (gap 2)"        || bad ".bin slice 2 was dropped (gap 2 regression)"
have_in_got "$EXE"  && ok "carries the inno -setup.exe (gap 1)"        || bad "inno .exe missing (gap 1 regression)"
have_in_got "$SIG"  && ok "carries the inno .sig"                      || bad "inno .sig missing"

# 2) read drops a vanished file and de-duplicates a repeated path.
release_artifacts_write "$TAG" "$EXE" "$EXE" "$SIG" "$BIN1" "$BIN2" "$DEB" >/dev/null  # $EXE twice
rm -f "$BIN2"
mapfile -t GOT2 < <(release_artifacts_read "$TAG")
[[ ${#GOT2[@]} -eq 4 ]] && ok "read skips a vanished file and de-dups (4 remain)" \
  || bad "read returned ${#GOT2[@]} after removing 1 + dup, expected 4"
# restore for the guard tests
: > "$BIN2"
release_artifacts_write "$TAG" "$EXE" "$SIG" "$BIN1" "$BIN2" "$DEB" >/dev/null

# 3) read FAILS HARD when there is no manifest — never a silent glob fallback.
if release_artifacts_read "$TAG_EMPTY" >/dev/null 2>&1; then
  bad "read of an unknown tag should fail, but succeeded (silent-fallback risk)"
else
  ok "read of an unknown tag returns non-zero (no drifting fallback)"
fi

# 4) recurrence guard PASSES when latest.json only advertises covered artifacts.
# URLs are percent-encoded exactly as release-local.sh emits them (spaces -> %20).
LATEST="$WORK/latest.json"
cat > "$LATEST" <<JSON
{ "version": "$VER", "platforms": {
    "windows-x86_64": { "signature": "x", "url": "https://h/secret/tag/Papercusp%20Server_${VER}_x64-setup.exe" },
    "linux-x86_64":   { "signature": "x", "url": "https://h/secret/tag/Papercusp_${VER}_amd64.deb" } } }
JSON
if release_artifacts_assert_urls_covered "$TAG" "$LATEST" 2>/dev/null; then
  ok "guard passes when every advertised url is in the upload set"
else
  bad "guard failed on a fully-covered manifest"
fi

# 5) recurrence guard FAILS when latest.json advertises an artifact NOT in the set.
LATEST_BAD="$WORK/latest-bad.json"
cat > "$LATEST_BAD" <<JSON
{ "version": "$VER", "platforms": {
    "windows-x86_64": { "signature": "x", "url": "https://h/secret/tag/Papercusp%20GUI_${VER}_x64-setup.exe" } } }
JSON
if release_artifacts_assert_urls_covered "$TAG" "$LATEST_BAD" 2>/dev/null; then
  bad "guard passed a manifest advertising a NON-present artifact (LABELED!=PACKED not caught)"
else
  ok "guard catches an advertised-but-missing artifact before upload"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "release-artifacts self-test: ALL PASS"
  exit 0
else
  echo "release-artifacts self-test: $FAILS FAILED"
  exit 1
fi
