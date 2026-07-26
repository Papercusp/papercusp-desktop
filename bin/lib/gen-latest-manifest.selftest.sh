#!/usr/bin/env bash
# gen-latest-manifest.selftest.sh — focused unit test for gen-latest-manifest.sh,
# the single-source-of-truth latest.json/latest-server.json generator shared by
# bin/release-local.sh (multi-leg) and bin/gen-latest-manifest.sh (single-leg CLI)
# (EI-18101626616739029). Proves, hermetically (synthetic files in a temp dir — NO
# real cut, NO cargo/tauri build, NO network, ~1s):
#   1. desktop_release_tag matches the operator's manifest classifier for all three
#      channels (alpha/beta/stable).
#   2. gen_latest_manifest writes a GUI latest.json with the right platform key +
#      signature + url for a Linux AppImage artifact.
#   3. a Server-role artifact (name-tokened "Server") produces latest-server.json,
#      and NEVER leaks into latest.json's platforms (WI-3696/WI-4404 separation).
#   4. no Server-role artifact in the set ⇒ latest-server.json is NOT written at all
#      (never an empty-platforms manifest that reads as false "up to date").
#   5. PAPERCUSP_UPDATE_BASE_URL unset ⇒ the emitted url carries the obviously-
#      invalid placeholder scheme, never a plausible-but-wrong url.
#
#   bash bin/lib/gen-latest-manifest.selftest.sh      # exit 0 = PASS, 1 = FAIL
#
# Why a bash self-test and not Vitest: the unit under test is bash + an embedded
# python3 block. The desktop package tests its sourced bash helpers this way (see
# release-artifacts.selftest.sh); this submodule is not part of the operator's
# hoisted vitest workspace.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=gen-latest-manifest.sh
source "$DIR/gen-latest-manifest.sh"
set +e   # this self-test owns its own exit codes (some asserts intentionally fail a call)

command -v python3 >/dev/null 2>&1 || { echo "SKIP: python3 unavailable"; exit 0; }

FAILS=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }

WORK="$(mktemp -d /tmp/genlatest-selftest.XXXXXX)"
VER="9.9.9"
cleanup() {
  rm -rf "$WORK"
  for ch in alpha beta stable; do
    local tag; tag="$(desktop_release_tag "$VER" "$ch" 2>/dev/null)"
    [[ -n "$tag" ]] || continue
    rm -f "$(gen_latest_manifest_json_path "$tag")" \
          "$(gen_latest_manifest_server_json_path "$tag")" \
          "$(gen_latest_manifest_notes_path "$tag")"
  done
}
trap cleanup EXIT

echo "gen-latest-manifest self-test (version=$VER)"

# 1) tag convention matches apps/operator/app/api/updates/manifest/route.ts.
[[ "$(desktop_release_tag "$VER" alpha)"  == "desktop-v${VER}-alpha" ]] && ok "alpha tag"  || bad "alpha tag mismatch"
[[ "$(desktop_release_tag "$VER" beta)"   == "desktop-v${VER}-beta"  ]] && ok "beta tag"   || bad "beta tag mismatch"
[[ "$(desktop_release_tag "$VER" stable)" == "desktop-v${VER}"       ]] && ok "stable tag" || bad "stable tag mismatch"
if desktop_release_tag "$VER" nightly >/dev/null 2>&1; then
  bad "an unknown channel should be rejected, but desktop_release_tag succeeded"
else
  ok "an unknown channel is rejected"
fi

# 2) GUI-only cut: one Linux AppImage + its .sig.
GUI_APPIMAGE="$WORK/papercusp-test_${VER}_amd64.AppImage"
GUI_SIG="$WORK/papercusp-test_${VER}_amd64.AppImage.sig"
: > "$GUI_APPIMAGE"; printf 'gui-signature' > "$GUI_SIG"

TAG_GUI="$(desktop_release_tag "$VER" alpha)"
PAPERCUSP_UPDATE_BASE_URL="https://example.com/releases" \
  gen_latest_manifest "$VER" alpha "$TAG_GUI" "$GUI_APPIMAGE" "$GUI_SIG" >/dev/null 2>&1

GUI_JSON="$(gen_latest_manifest_json_path "$TAG_GUI")"
GUI_SERVER_JSON="$(gen_latest_manifest_server_json_path "$TAG_GUI")"
if [[ -f "$GUI_JSON" ]]; then
  ok "latest.json written for a GUI-only cut"
  python3 - "$GUI_JSON" <<'PY' && ok "linux-x86_64 entry has the right signature+url" || bad "linux-x86_64 entry shape wrong"
import json, sys
m = json.load(open(sys.argv[1]))
p = m["platforms"]["linux-x86_64"]
assert p["signature"] == "gui-signature", p["signature"]
assert p["url"] == "https://example.com/releases/desktop-v9.9.9-alpha/papercusp-test_9.9.9_amd64.AppImage", p["url"]
PY
else
  bad "latest.json was not written for a GUI-only cut"
fi
[[ -f "$GUI_SERVER_JSON" ]] && bad "latest-server.json written despite no Server artifact (should not exist)" \
  || ok "no Server artifact ⇒ latest-server.json NOT written (4)"

# 3) mixed cut: GUI Linux AppImage + Server Linux AppImage ⇒ both manifests, no
#    cross-leak (WI-3696/WI-4404).
SRV_APPIMAGE="$WORK/Papercusp_Server_${VER}_amd64.AppImage"
SRV_SIG="$WORK/Papercusp_Server_${VER}_amd64.AppImage.sig"
: > "$SRV_APPIMAGE"; printf 'server-signature' > "$SRV_SIG"

TAG_MIX="$(desktop_release_tag "$VER" beta)"
PAPERCUSP_UPDATE_BASE_URL="https://example.com/releases" \
  gen_latest_manifest "$VER" beta "$TAG_MIX" "$GUI_APPIMAGE" "$GUI_SIG" "$SRV_APPIMAGE" "$SRV_SIG" >/dev/null 2>&1

MIX_JSON="$(gen_latest_manifest_json_path "$TAG_MIX")"
MIX_SERVER_JSON="$(gen_latest_manifest_server_json_path "$TAG_MIX")"
if [[ -f "$MIX_JSON" && -f "$MIX_SERVER_JSON" ]]; then
  ok "mixed GUI+Server cut writes both latest.json and latest-server.json"
  python3 - "$MIX_JSON" "$MIX_SERVER_JSON" <<'PY' && ok "no cross-leak between GUI/Server manifests" || bad "GUI/Server manifests leaked into each other"
import json, sys
gui = json.load(open(sys.argv[1]))
srv = json.load(open(sys.argv[2]))
assert "Server" not in gui["platforms"]["linux-x86_64"]["url"], gui["platforms"]["linux-x86_64"]["url"]
assert "Server" in srv["platforms"]["linux-x86_64"]["url"], srv["platforms"]["linux-x86_64"]["url"]
assert srv["platforms"]["linux-x86_64"]["signature"] == "server-signature"
PY
else
  bad "mixed cut did not write both manifests (gui=$([[ -f "$MIX_JSON" ]] && echo y || echo n), server=$([[ -f "$MIX_SERVER_JSON" ]] && echo y || echo n))"
fi

# 4) MERGE MODE (EI-18111560213741904): publishing a SECOND platform onto an
#    already-published manifest must overlay its own entry while carrying every
#    OTHER platform key through byte-for-byte untouched (never regenerated,
#    never re-signed) — this is what lets bin/publish-platform-incremental.sh
#    add mac onto an already-live linux release without touching linux's entry.
BASE_JSON="$WORK/base-latest.json"
cat > "$BASE_JSON" <<JSON
{ "version": "$VER", "channel": "alpha", "notes": "x", "pub_date": "2026-01-01T00:00:00Z",
  "platforms": { "linux-x86_64": { "signature": "ORIGINAL-linux-sig", "url": "https://example.com/releases/desktop-v${VER}-alpha/original-linux.AppImage" } } }
JSON
MAC_TARGZ="$WORK/Papercusp.app.tar.gz"
MAC_SIG="$WORK/Papercusp.app.tar.gz.sig"
: > "$MAC_TARGZ"; printf 'mac-signature' > "$MAC_SIG"

TAG_MERGE="$(desktop_release_tag "$VER" alpha)"   # SAME tag as test (2) — deliberately re-merges onto its own prior output too
GEN_LATEST_MANIFEST_MERGE_GUI_JSON="$BASE_JSON" \
PAPERCUSP_UPDATE_BASE_URL="https://example.com/releases" \
  gen_latest_manifest "$VER" alpha "$TAG_MERGE" "$MAC_TARGZ" "$MAC_SIG" >/dev/null 2>&1

MERGED_JSON="$(gen_latest_manifest_json_path "$TAG_MERGE")"
if [[ -f "$MERGED_JSON" ]]; then
  python3 - "$MERGED_JSON" <<'PY' && ok "merge mode: new platform added, base platform untouched" || bad "merge mode: base platform was NOT carried through byte-for-byte"
import json, sys
m = json.load(open(sys.argv[1]))
p = m["platforms"]
assert p["linux-x86_64"]["signature"] == "ORIGINAL-linux-sig", p["linux-x86_64"]
assert p["linux-x86_64"]["url"] == "https://example.com/releases/desktop-v9.9.9-alpha/original-linux.AppImage", p["linux-x86_64"]
assert "darwin-x86_64" in p and p["darwin-x86_64"]["signature"] == "mac-signature", p.get("darwin-x86_64")
assert "darwin-aarch64" in p, p
PY
else
  bad "merge mode: manifest was not written"
fi

# 5) PAPERCUSP_UPDATE_BASE_URL unset ⇒ obviously-invalid placeholder, never a
#    plausible-but-wrong url.
TAG_NOBASE="$(desktop_release_tag "$VER" stable)"
( unset PAPERCUSP_UPDATE_BASE_URL; gen_latest_manifest "$VER" stable "$TAG_NOBASE" "$GUI_APPIMAGE" "$GUI_SIG" >/dev/null 2>/dev/null )
NOBASE_JSON="$(gen_latest_manifest_json_path "$TAG_NOBASE")"
if [[ -f "$NOBASE_JSON" ]] && grep -q "papercusp-update-base-unset://SET-PAPERCUSP_UPDATE_BASE_URL" "$NOBASE_JSON"; then
  ok "unset PAPERCUSP_UPDATE_BASE_URL emits the obviously-invalid placeholder url"
else
  bad "unset PAPERCUSP_UPDATE_BASE_URL did not emit the expected placeholder"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "gen-latest-manifest self-test: ALL PASS"
  exit 0
else
  echo "gen-latest-manifest self-test: $FAILS FAILED"
  exit 1
fi
