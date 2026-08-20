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
#   6. Linux incremental discovery prefers build-linux-local.sh's source-tree
#      collection destination, with Cargo's target retained only as a legacy fallback.
#   7. a missing/malformed cut-start stamp fails closed, and every artifact must
#      be strictly newer than the stamp (stale + fresh controls).
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
TAG_FRESH="desktop-v0.0.0-selftest-fresh-$$"
cleanup() {
  rm -rf "$WORK"
  rm -f "$(release_artifacts_manifest_path "$TAG")" "$(release_artifacts_manifest_path "$TAG_EMPTY")" "$(release_artifacts_manifest_path "$TAG_FRESH")" "$(release_artifacts_cut_start_path "$TAG_FRESH")"
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

# 0c) build-linux-local.sh collects successful output into the source-tree
# target even when Cargo itself writes under a global target-dir.  The
# incremental publisher must look at that post-collection destination first or
# it reports a successful build as absent (EI-20320547917563727).
DESKTOP_ROOT="$WORK/desktop"
CARGO_ROOT="$WORK/cargo-target"
COLLECTED_BUNDLE="$DESKTOP_ROOT/src-tauri/target/release/bundle"
mkdir -p "$COLLECTED_BUNDLE/appimage" "$CARGO_ROOT/release/bundle"
COLLECTED_APPIMAGE="$COLLECTED_BUNDLE/appimage/Papercusp_${VER}_amd64.AppImage"
: > "$COLLECTED_APPIMAGE"
SELECTED_LINUX_ROOT="$(release_artifacts_linux_bundle_root "$DESKTOP_ROOT" "$CARGO_ROOT" "$VER")"
if [[ "$SELECTED_LINUX_ROOT" == "$COLLECTED_BUNDLE" ]]; then
  ok "Linux publish prefers the post-build source-tree collection destination"
else
  bad "Linux publish selected '$SELECTED_LINUX_ROOT' instead of collected '$COLLECTED_BUNDLE'"
fi
rm -f "$COLLECTED_APPIMAGE"
LEGACY_BUNDLE="$CARGO_ROOT/release/bundle"
: > "$LEGACY_BUNDLE/Papercusp_${VER}_amd64.AppImage"
SELECTED_LINUX_ROOT="$(release_artifacts_linux_bundle_root "$DESKTOP_ROOT" "$CARGO_ROOT" "$VER")"
if [[ "$SELECTED_LINUX_ROOT" == "$LEGACY_BUNDLE" ]]; then
  ok "Linux publish falls back to Cargo's target for an uncollected legacy build"
else
  bad "Linux publish did not retain the legacy Cargo-target fallback"
fi

# SIGNING SEAM (EI-20595279927716716). Normalization now SIGNS the zip it builds,
# so every case below that calls papercusp_normalize_spanned_server would otherwise
# reach for the host's real key and npx — network, seconds, and a different answer
# on a keyless box. Point it at a stub instead: this file stays hermetic and ~1s,
# and the cases that care about the unsigned path opt out explicitly.
STUB_SIGNER="$WORK/stub-signer"
cat > "$STUB_SIGNER" <<'STUB'
#!/usr/bin/env bash
# Stand-in for `tauri signer sign <file>`: same contract, no crypto.
[[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]] || exit 3   # refuse without a key, like the real one
printf 'stub-signature\n' > "$1.sig"
STUB
chmod +x "$STUB_SIGNER"
export PAPERCUSP_SIGNER_CMD="$STUB_SIGNER"
export TAURI_SIGNING_PRIVATE_KEY="dGVzdC1rZXktY29udGVudA=="

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
# Strict mode (no reachability leg) so this stays hermetic and offline-safe.
LATEST_BAD="$WORK/latest-bad.json"
cat > "$LATEST_BAD" <<JSON
{ "version": "$VER", "platforms": {
    "windows-x86_64": { "signature": "x", "url": "https://h/secret/tag/Papercusp%20GUI_${VER}_x64-setup.exe" } } }
JSON
if RELEASE_ARTIFACTS_NO_REACHABILITY=1 \
   release_artifacts_assert_urls_covered "$TAG" "$LATEST_BAD" 2>/dev/null; then
  bad "guard passed a manifest advertising a NON-present artifact (LABELED!=PACKED not caught)"
else
  ok "guard catches an advertised-but-missing artifact before upload"
fi

# 5b) EI-20551860898590077 — same-version stale bytes are rejected per artifact,
# while a fresh control passes. The helper uses nanosecond mtimes, so a future
# cut cannot accidentally share a timestamp second with its predecessor.
FRESH="$WORK/fresh-artifact"
STALE="$WORK/stale-artifact"
: > "$STALE"
STAMP_NOW="$(release_artifacts_cut_start_now_ns)"
release_artifacts_cut_start_write "$TAG_FRESH" "$STAMP_NOW" >/dev/null
if release_artifacts_assert_fresh "$TAG_FRESH" "$STALE" 2>/dev/null; then
  bad "freshness guard accepted an artifact whose mtime predates the cut start"
else
  ok "freshness guard rejects a stale same-version artifact"
fi
sleep 0.01
: > "$FRESH"
if release_artifacts_assert_fresh "$TAG_FRESH" "$FRESH" 2>/dev/null; then
  ok "freshness guard accepts an artifact written after the cut start"
else
  bad "freshness guard rejected a fresh artifact"
fi
rm -f "$(release_artifacts_cut_start_path "$TAG_FRESH")"
if release_artifacts_assert_fresh "$TAG_FRESH" "$FRESH" >/dev/null 2>&1; then
  bad "freshness guard passed with a missing cut-start stamp"
else
  ok "freshness guard fails closed when the cut-start stamp is missing"
fi

# ── reachability leg (incremental publish) ───────────────────────────────────
# An artifact absent from THIS upload set but already live on the release host is
# covered: that is exactly what publish-platform-incremental.sh produces when it
# merges the live latest.json to add one platform. Judging those by local
# presence alone made the guard structurally unpassable on that path.
# The prober is injected so these cases are hermetic — no network, no live host.
PROBE_UP="$WORK/probe-up.sh";   printf '#!/bin/sh\nexit 0\n' > "$PROBE_UP";   chmod +x "$PROBE_UP"
PROBE_DOWN="$WORK/probe-down.sh"; printf '#!/bin/sh\nexit 1\n' > "$PROBE_DOWN"; chmod +x "$PROBE_DOWN"

# 6) an advertised-but-unpacked artifact that IS live on the host passes.
if RELEASE_ARTIFACTS_REACHABILITY_CMD="$PROBE_UP" \
   release_artifacts_assert_urls_covered "$TAG" "$LATEST_BAD" 2>/dev/null; then
  ok "guard passes an out-of-set artifact that is already live (incremental publish)"
else
  bad "guard blocked an already-live artifact — incremental publish is unpassable"
fi

# 7) CONTROL — the reachability leg must not blanket-pass. Same manifest, same
# code path, prober reporting NOT reachable: the guard must still catch it.
if RELEASE_ARTIFACTS_REACHABILITY_CMD="$PROBE_DOWN" \
   release_artifacts_assert_urls_covered "$TAG" "$LATEST_BAD" 2>/dev/null; then
  bad "guard passed an UNREACHABLE out-of-set artifact — the 404 class is no longer caught"
else
  ok "guard still catches an out-of-set artifact that is NOT reachable (fails closed)"
fi

# 8) CONTROL — a probe that ERRORS (non-executable / missing) must fail closed,
# not be mistaken for success.
if RELEASE_ARTIFACTS_REACHABILITY_CMD="$WORK/no-such-probe" \
   release_artifacts_assert_urls_covered "$TAG" "$LATEST_BAD" 2>/dev/null; then
  bad "a broken reachability probe was treated as reachable (fails OPEN)"
else
  ok "a broken reachability probe fails closed"
fi

# 9) CONTROL — a fully-covered manifest still passes with the leg enabled, and
# must not depend on the probe at all (nothing to probe).
if RELEASE_ARTIFACTS_REACHABILITY_CMD="$PROBE_DOWN" \
   release_artifacts_assert_urls_covered "$TAG" "$LATEST" 2>/dev/null; then
  ok "a fully-covered manifest passes without consulting the prober"
else
  bad "a fully-covered manifest was rejected when the prober reports down"
fi

# ── EI-20595279927716716: every published download must carry its .sig ───────
# The bug: signing followed the UPDATER pipeline, not the PUBLISHED set. `tauri
# build` signs what it bundles, so the Server zip — which WE assemble after the
# bundler — shipped with no signature in 0.0.16 AND 0.0.17 while every updater
# input beside it was signed. Nothing failed; a download simply could not be
# verified. Both halves are covered here: sign at creation, refuse at publish.

# 10) normalization SIGNS the zip it creates and publishes it through OUTPUTS —
# the array callers append. Naming the zip directly is how two of three call
# sites would silently drop a newly-added output.
if papercusp_normalize_spanned_server "$INNO" "$VER"; then
  [[ -n "$PAPERCUSP_SPANNED_SERVER_ZIP_SIG" && -s "$PAPERCUSP_SPANNED_SERVER_ZIP_SIG" ]] \
    && ok "normalization signs the zip it builds" \
    || bad "normalization produced no signature for the zip"
  if [[ ${#PAPERCUSP_SPANNED_SERVER_OUTPUTS[@]} -eq 2 \
        && "${PAPERCUSP_SPANNED_SERVER_OUTPUTS[0]}" == "$PAPERCUSP_SPANNED_SERVER_ZIP" \
        && "${PAPERCUSP_SPANNED_SERVER_OUTPUTS[1]}" == "$PAPERCUSP_SPANNED_SERVER_ZIP_SIG" ]]; then
    ok "OUTPUTS carries zip + signature in caller-append order"
  else
    bad "OUTPUTS did not carry zip+sig (${#PAPERCUSP_SPANNED_SERVER_OUTPUTS[@]} entries)"
  fi
  papercusp_spanned_server_artifact "$PAPERCUSP_SPANNED_SERVER_ZIP.sig" \
    && ok "shared matcher recognizes the zip signature (a re-scan cannot duplicate it)" \
    || bad "shared matcher missed the zip signature — a re-scan would double-add it"
else
  bad "spanned Server normalization failed unexpectedly under the signing seam"
fi

# 11) A KEYLESS build still yields a usable zip. Signing is best-effort at BUILD
# time; refusing to SHIP an unsigned download is the publish guard's job. Getting
# this backwards would break every local/dev cut on a box with no signing key.
if ( unset PAPERCUSP_SIGNER_CMD TAURI_SIGNING_PRIVATE_KEY
     export TAURI_SIGNING_PRIVATE_KEY_PATH="$WORK/no-such-key"
     papercusp_normalize_spanned_server "$INNO" "$VER" 2>/dev/null \
       && [[ -s "$PAPERCUSP_SPANNED_SERVER_ZIP" \
             && -z "$PAPERCUSP_SPANNED_SERVER_ZIP_SIG" \
             && ${#PAPERCUSP_SPANNED_SERVER_OUTPUTS[@]} -eq 1 ]] ); then
  ok "a keyless build still yields a valid zip, unsigned, OUTPUTS holding only it"
else
  bad "keyless normalization did not degrade gracefully to an unsigned zip"
fi

TAG_SIG="$TAG-signatures"
SIGDIR="$WORK/sigcut"; mkdir -p "$SIGDIR"
mk_sig_artifact() { : > "$SIGDIR/$1"; printf '%s\n' "$SIGDIR/$1"; }
S_DEB="$(mk_sig_artifact "Papercusp GUI_${VER}_amd64.deb")"
S_DEB_SIG="$(mk_sig_artifact "Papercusp GUI_${VER}_amd64.deb.sig")"
S_EXE="$(mk_sig_artifact "Papercusp GUI_${VER}_x64-setup.exe")"
S_EXE_SIG="$(mk_sig_artifact "Papercusp GUI_${VER}_x64-setup.exe.sig")"
S_ZIP="$(mk_sig_artifact "Papercusp Server_${VER}_x64-setup.zip")"
S_ZIP_SIG="$(mk_sig_artifact "Papercusp Server_${VER}_x64-setup.zip.sig")"
S_TGZ="$(mk_sig_artifact "Papercusp GUI.app.tar.gz")"
S_TGZ_SIG="$(mk_sig_artifact "Papercusp GUI.app.tar.gz.sig")"
S_DMG="$(mk_sig_artifact "Papercusp GUI_${VER}_universal-apple-darwin.dmg")"
S_DMG_SIG="$(mk_sig_artifact "Papercusp GUI_${VER}_universal-apple-darwin.dmg.sig")"

# 12) CONTROL — a fully-signed cut passes. Without this, case 13 cannot tell a
# working guard from one that rejects everything.
release_artifacts_write "$TAG_SIG" "$S_DEB" "$S_DEB_SIG" "$S_EXE" "$S_EXE_SIG" \
  "$S_ZIP" "$S_ZIP_SIG" "$S_TGZ" "$S_TGZ_SIG" "$S_DMG" "$S_DMG_SIG" >/dev/null
if release_artifacts_assert_signatures_present "$TAG_SIG" 2>/dev/null; then
  ok "signature guard passes a fully-signed cut"
else
  bad "signature guard rejected a fully-signed cut (false positive)"
fi

# 13) FALSIFIABILITY — the guard must FAIL the exact shape that actually shipped:
# Server zip present, its .sig absent, everything else signed. A guard that
# cannot fail here would have waved 0.0.16 and 0.0.17 through unchanged.
release_artifacts_write "$TAG_SIG" "$S_DEB" "$S_DEB_SIG" "$S_EXE" "$S_EXE_SIG" \
  "$S_ZIP" "$S_TGZ" "$S_TGZ_SIG" "$S_DMG" "$S_DMG_SIG" >/dev/null
if release_artifacts_assert_signatures_present "$TAG_SIG" 2>/dev/null; then
  bad "signature guard PASSED an unsigned Server zip — the shape 0.0.16/0.0.17 shipped"
else
  ok "signature guard fails the unsigned-Server-zip shape that actually shipped"
fi

# 14) DMGs are published downloads, so an unsigned .dmg must fail exactly like
# every other signable artifact. This prevents the old exemption from returning.
release_artifacts_write "$TAG_SIG" "$S_DEB" "$S_DEB_SIG" "$S_EXE" "$S_EXE_SIG" \
  "$S_ZIP" "$S_ZIP_SIG" "$S_DMG" >/dev/null
DMG_ERR="$(release_artifacts_assert_signatures_present "$TAG_SIG" 2>&1 >/dev/null)"
DMG_RC=$?
[[ "$DMG_RC" -ne 0 ]] \
  && ok "signature guard fails an unsigned .dmg" \
  || bad "signature guard passed an unsigned .dmg (exemption returned)"
case "$DMG_ERR" in
  *"Papercusp GUI_${VER}_universal-apple-darwin.dmg"*) ok "the unsigned .dmg is named on stderr" ;;
  *)                                                   bad "the unsigned .dmg was not named on stderr" ;;
esac

# 15) The documented escape is honoured, so a deliberate keyless cut is never
# hard-blocked even when it contains an unsigned DMG.
release_artifacts_write "$TAG_SIG" "$S_ZIP" "$S_DMG" >/dev/null
if RELEASE_ARTIFACTS_NO_SIGNATURE_CHECK=1 \
   release_artifacts_assert_signatures_present "$TAG_SIG" 2>/dev/null; then
  ok "RELEASE_ARTIFACTS_NO_SIGNATURE_CHECK=1 skips the check for keyless cuts"
else
  bad "the documented signature-check escape did not skip"
fi
rm -f "$(release_artifacts_manifest_path "$TAG_SIG")"

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "release-artifacts self-test: ALL PASS"
  exit 0
else
  echo "release-artifacts self-test: $FAILS FAILED"
  exit 1
fi
