#!/usr/bin/env bash
#
# upload-release.sh — push a cut's artifacts + latest.json to the release host.
#
# This is the LAST STEP of a release, and it replaces hand-uploading to Google
# Drive (which cannot serve auto-update at all: files over ~100MB come back as an
# HTML virus-scan interstitial instead of bytes, so the updater's minisign check
# fails on a page of HTML).
#
# Plan: desktop-release-hosting-r2-2026-07-12 (D-001..D-003). Related: WI-4389
# (auto-update was dead on the local-only rail), WI-4364, WI-3875.
#
#   Usage:  bin/upload-release.sh <version> <channel>          # e.g. 0.0.8 alpha
#           DRY_RUN=1 bin/upload-release.sh 0.0.8 alpha        # print, upload nothing
#
# Layout it writes (object keys are relative to the bucket root, and the custom
# domain maps the bucket root to https://dl.papercusp.com/):
#
#   <secret>/latest.json                 ← the updater manifest. PERMANENT address.
#   <secret>/<tag>/<artifact>            ← installers + their .sig files
#
# The <secret> path segment (not a subdomain — D-002: a random subdomain is
# published to Certificate Transparency the moment it gets a cert) comes from
# ~/.papercusp/release-host.env and is PERMANENT (D-003): every shipped app has
# <base>/latest.json baked in, so changing it silently strands every install.
#
# Credentials live in ~/.papercusp/r2.env (never in git):
#   R2_ACCOUNT_ID=...
#   R2_BUCKET=...
#   AWS_ACCESS_KEY_ID=...          # an R2 API token's access key
#   AWS_SECRET_ACCESS_KEY=...
#
set -euo pipefail

VERSION="${1:-}"
CHANNEL="${2:-alpha}"
DRY_RUN="${DRY_RUN:-0}"

if [[ -z "$VERSION" ]]; then
  echo "usage: bin/upload-release.sh <version> [channel]    (e.g. 0.0.8 alpha)" >&2
  exit 2
fi

TAG="desktop-v${VERSION}"
[[ "$CHANNEL" != "stable" ]] && TAG="${TAG}-${CHANNEL}"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

# ── Config: where it goes ────────────────────────────────────────────────────
RELEASE_HOST_ENV="${HOME}/.papercusp/release-host.env"
if [[ ! -f "$RELEASE_HOST_ENV" ]]; then
  echo "ERROR: $RELEASE_HOST_ENV not found — no release host configured." >&2
  echo "       See plan desktop-release-hosting-r2-2026-07-12 (P-001)." >&2
  exit 1
fi
# shellcheck source=/dev/null
set -a; . "$RELEASE_HOST_ENV"; set +a
BASE="${PAPERCUSP_UPDATE_BASE_URL:-${PAPERCUSP_RELEASE_HOST:-}}"
if [[ -z "$BASE" ]]; then
  echo "ERROR: neither PAPERCUSP_UPDATE_BASE_URL nor PAPERCUSP_RELEASE_HOST set in $RELEASE_HOST_ENV" >&2
  exit 1
fi
# The object-key prefix is whatever path the base URL carries (the secret).
KEY_PREFIX="$(printf '%s' "$BASE" | sed -E 's#^https?://[^/]+/?##; s#/$##')"
if [[ -z "$KEY_PREFIX" ]]; then
  echo "ERROR: base URL '$BASE' has no path segment — the secret must live in the PATH (D-002)." >&2
  exit 1
fi

# ── Credentials ──────────────────────────────────────────────────────────────
R2_ENV="${HOME}/.papercusp/r2.env"
if [[ ! -f "$R2_ENV" ]]; then
  echo "ERROR: $R2_ENV not found — R2 credentials are owner-provisioned (P-002)." >&2
  echo "       Expected: R2_ACCOUNT_ID, R2_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY" >&2
  exit 1
fi
# shellcheck source=/dev/null
set -a; . "$R2_ENV"; set +a
: "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID in $R2_ENV}"
: "${R2_BUCKET:?set R2_BUCKET in $R2_ENV}"
: "${AWS_ACCESS_KEY_ID:?set AWS_ACCESS_KEY_ID in $R2_ENV}"
: "${AWS_SECRET_ACCESS_KEY:?set AWS_SECRET_ACCESS_KEY in $R2_ENV}"
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI not on PATH (R2 is S3-compatible)." >&2; exit 1; }

# R2 does not implement the trailing-checksum headers newer aws-cli v2 sends by
# default; without these it rejects the upload with an opaque 501/400.
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"

s3() { aws s3 --endpoint-url "$ENDPOINT" "$@"; }

# ── What to upload ───────────────────────────────────────────────────────────
BUNDLE="${PAPERCUSP_BUNDLE_DIR:-${CARGO_TARGET_DIR:-$HOME/.cargo-target}/release/bundle}"
LATEST_JSON="/tmp/papercusp-latest-${TAG}.json"

if [[ ! -f "$LATEST_JSON" ]]; then
  echo "ERROR: $LATEST_JSON not found — run bin/release-local.sh $VERSION $CHANNEL first." >&2
  exit 1
fi

# Refuse to publish a manifest that names a download location that does not
# exist. Serving this is worse than serving nothing: the updater would offer an
# update and then fail to fetch it. (WI-4364; the operator refuses it too.)
if grep -q 'papercusp-update-base-unset://' "$LATEST_JSON"; then
  echo "ERROR: $LATEST_JSON still contains PLACEHOLDER urls — it was cut without" >&2
  echo "       PAPERCUSP_UPDATE_BASE_URL. Regenerate it before uploading (WI-4364)." >&2
  exit 1
fi

mapfile -t ARTIFACTS < <(
  find "$BUNDLE/deb" "$BUNDLE/appimage" "$BUNDLE/dmg" "$BUNDLE/macos" "$BUNDLE/nsis" "$BUNDLE/msi" \
    -maxdepth 1 -type f \( -name "*${VERSION}*" -o -name "*.sig" \) 2>/dev/null \
    | grep -E '\.(deb|AppImage|dmg|tar\.gz|exe|msi)(\.sig)?$' \
    | grep -F "$VERSION" \
    | sort
)

if [[ ${#ARTIFACTS[@]} -eq 0 ]]; then
  echo "ERROR: no artifacts for $VERSION found under $BUNDLE" >&2
  exit 1
fi

echo "==> release host : ${BASE%/*}/<secret>"
echo "==> bucket       : s3://${R2_BUCKET}/${KEY_PREFIX}/"
echo "==> tag          : $TAG"
echo "==> artifacts    : ${#ARTIFACTS[@]}"
for f in "${ARTIFACTS[@]}"; do
  printf '      %10.2f GB  %s\n' "$(echo "scale=2; $(stat -c%s "$f")/1000000000" | bc)" "$(basename "$f")"
done
echo

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN=1 — nothing uploaded."
  exit 0
fi

# ── Upload artifacts FIRST, manifest LAST ────────────────────────────────────
# Order matters: latest.json is what makes an update VISIBLE to every installed
# app. Publishing it before the bytes it points at exist would advertise an
# update that 404s for anyone who checks in the meantime.
for f in "${ARTIFACTS[@]}"; do
  name="$(basename "$f")"
  echo "==> uploading $name"
  s3 cp "$f" "s3://${R2_BUCKET}/${KEY_PREFIX}/${TAG}/${name}" --only-show-errors
done

echo "==> uploading latest.json (LAST — this is what publishes the update)"
s3 cp "$LATEST_JSON" "s3://${R2_BUCKET}/${KEY_PREFIX}/latest.json" \
  --content-type application/json --cache-control 'no-cache, max-age=0' --only-show-errors

# ── Verify what actually landed ──────────────────────────────────────────────
# Trust the served bytes, not the upload's exit code.
echo
echo "==> verifying over HTTPS"
TMP_MANIFEST="$(mktemp)"
trap 'rm -f "$TMP_MANIFEST"' EXIT
if ! curl -fsS "${BASE}/latest.json" -o "$TMP_MANIFEST"; then
  echo "  ✗ GET ${BASE%/*}/<secret>/latest.json FAILED — is the custom domain bound to the bucket?" >&2
  exit 1
fi
if ! diff -q "$LATEST_JSON" "$TMP_MANIFEST" >/dev/null; then
  echo "  ✗ served latest.json does NOT match what we uploaded" >&2
  exit 1
fi
echo "  ✓ latest.json served and byte-identical"

# Spot-check that each artifact URL the manifest advertises is actually fetchable
# (HEAD only — these are gigabytes). A manifest pointing at a 404 is the exact
# failure this whole rail exists to prevent.
python3 - "$TMP_MANIFEST" <<'PY'
import json, sys, urllib.request
m = json.load(open(sys.argv[1]))
bad = 0
for key, entry in (m.get("platforms") or {}).items():
    url = entry.get("url", "")
    req = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            size = int(r.headers.get("content-length") or 0)
            print(f"  ✓ {key}: {r.status} {size/1e9:.2f} GB")
    except Exception as e:
        bad += 1
        print(f"  ✗ {key}: {url} -> {e}")
if bad:
    sys.exit(f"\n{bad} advertised artifact url(s) are NOT fetchable — the manifest lies. Fix before shipping.")
PY

echo
echo "==> done — $TAG is LIVE at the release host."
echo "    Installed apps will see it on their next update check."
