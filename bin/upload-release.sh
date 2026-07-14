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

# Size of an object in the bucket, or empty if it is not there. Used to prove the
# bytes landed without depending on the public hostname being bound yet.
s3api_head() {
  aws s3api head-object --endpoint-url "$ENDPOINT" \
    --bucket "$R2_BUCKET" --key "$1" \
    --query 'ContentLength' --output text 2>/dev/null || true
}

# ── What to upload ───────────────────────────────────────────────────────────
BUNDLE="${PAPERCUSP_BUNDLE_DIR:-${CARGO_TARGET_DIR:-$HOME/.cargo-target}/release/bundle}"
LATEST_JSON="/tmp/papercusp-latest-${TAG}.json"
# WI-4404: the Server product's own manifest. Optional — release-local.sh only
# writes it when the cut actually produced Server-role artifacts
# (PAPERCUSP_BUILD_ROLES="gui" skips it entirely), so its absence here is not
# an error; it just means this upload carries no Server update this time.
LATEST_SERVER_JSON="/tmp/papercusp-latest-server-${TAG}.json"

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
if [[ -f "$LATEST_SERVER_JSON" ]] && grep -q 'papercusp-update-base-unset://' "$LATEST_SERVER_JSON"; then
  echo "ERROR: $LATEST_SERVER_JSON still contains PLACEHOLDER urls — it was cut without" >&2
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
# Skip anything already in the bucket at exactly the local size. These artifacts
# are ~4 GB each, and the common reason to re-run this script is to complete the
# HTTPS verification after the custom domain was bound — re-pushing 11 GB to
# re-learn what we already know is pure waste. (Size, not mtime: a re-cut with the
# same version but different bytes is a size change in practice, and the manifest's
# minisign signature is the real integrity gate.)
for f in "${ARTIFACTS[@]}"; do
  name="$(basename "$f")"
  local_size="$(stat -c%s "$f")"
  if [[ "$(s3api_head "${KEY_PREFIX}/${TAG}/${name}")" == "$local_size" ]]; then
    echo "==> already uploaded, skipping $name"
    continue
  fi
  echo "==> uploading $name"
  s3 cp "$f" "s3://${R2_BUCKET}/${KEY_PREFIX}/${TAG}/${name}" --only-show-errors
done

echo "==> uploading latest.json (LAST — this is what publishes the update)"
s3 cp "$LATEST_JSON" "s3://${R2_BUCKET}/${KEY_PREFIX}/latest.json" \
  --content-type application/json --cache-control 'no-cache, max-age=0' --only-show-errors

if [[ -f "$LATEST_SERVER_JSON" ]]; then
  echo "==> uploading latest-server.json (publishes the Server product's update — WI-4404)"
  s3 cp "$LATEST_SERVER_JSON" "s3://${R2_BUCKET}/${KEY_PREFIX}/latest-server.json" \
    --content-type application/json --cache-control 'no-cache, max-age=0' --only-show-errors
else
  echo "==> no latest-server.json for this cut — Server product's manifest left as-is"
fi

# ── Verify what actually landed ──────────────────────────────────────────────
# Two INDEPENDENT checks, because they can fail for very different reasons and
# collapsing them hides which one broke:
#
#   1. STORAGE (S3 endpoint, authenticated) — did the bytes land, intact?
#      Always available; a failure here means the upload is genuinely broken.
#   2. PUBLIC READ PATH (https://<host>/…) — can an installed app actually
#      fetch them? This additionally requires the custom domain to be bound to
#      the bucket, which is a one-time Cloudflare setup, NOT a property of this
#      upload. An unbound domain is an expected pre-launch state, not corruption.
echo
echo "==> verifying storage (S3, authenticated)"
STORAGE_BAD=0
for f in "${ARTIFACTS[@]}"; do
  name="$(basename "$f")"
  local_size="$(stat -c%s "$f")"
  remote_size="$(s3api_head "${KEY_PREFIX}/${TAG}/${name}")"
  if [[ "$remote_size" == "$local_size" ]]; then
    printf '  ✓ %s (%.2f GB)\n' "$name" "$(echo "scale=4; $local_size/1000000000" | bc)"
  else
    echo "  ✗ $name — local ${local_size}B but remote '${remote_size}'" >&2
    STORAGE_BAD=1
  fi
done
if [[ "$STORAGE_BAD" != "0" ]]; then
  echo "ERROR: artifacts did not land intact — NOT a domain problem, the upload is broken." >&2
  exit 1
fi
echo "  ✓ all artifacts present in the bucket at full size"

echo
echo "==> verifying the public read path (${BASE%/*}/<secret>/latest.json)"
TMP_MANIFEST="$(mktemp)"
trap 'rm -f "$TMP_MANIFEST"' EXIT
# NOTE: on a connection-level failure (DNS, TLS, timeout) curl writes "000" via
# -w AND exits non-zero. Do NOT add a `|| echo "000"` fallback here: that
# CONCATENATES a second "000" onto curl's, yielding "000000", which then matches
# neither the unreachable branch nor 200 — and an unbound domain gets reported as
# a hard failure, i.e. exactly the confusion this two-way split exists to remove.
HTTP_CODE="$(curl -sS -o "$TMP_MANIFEST" -w '%{http_code}' --max-time 30 "${BASE}/latest.json" 2>/dev/null)" || true

if [[ -z "$HTTP_CODE" || "$HTTP_CODE" == "000" ]]; then
  # Could not connect at all — almost always the custom domain is not bound yet
  # (the hostname does not resolve). The upload itself is fine and verified above.
  HOSTNAME_ONLY="$(printf '%s' "$BASE" | sed -E 's#^https?://([^/]+).*#\1#')"
  echo "  ⚠ ${HOSTNAME_ONLY} is not reachable — the artifacts ARE uploaded and intact," >&2
  echo "    but the R2 bucket is not yet published at this hostname, so installed apps" >&2
  echo "    cannot download them. One-time setup, in Cloudflare:" >&2
  echo "      R2 → ${R2_BUCKET} → Settings → Custom Domains → Connect Domain → ${HOSTNAME_ONLY}" >&2
  echo "    Re-run this script afterwards to complete the verification." >&2
  exit 2
fi

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "  ✗ GET latest.json returned HTTP $HTTP_CODE" >&2
  exit 1
fi
if ! diff -q "$LATEST_JSON" "$TMP_MANIFEST" >/dev/null; then
  echo "  ✗ served latest.json does NOT match what we uploaded" >&2
  exit 1
fi
echo "  ✓ latest.json served and byte-identical"

# Spot-check that each artifact URL the manifest ADVERTISES is actually fetchable
# (no full download — these are gigabytes). Verifying the bucket is not enough:
# what matters is that the exact url a client reads out of the manifest resolves
# to bytes. A manifest pointing at a 404 is the LABELED!=PACKED failure this
# whole rail exists to prevent.
#
# ⚠ MUST send a real User-Agent. Cloudflare's r2.dev public URL bot-blocks the
# default `Python-urllib/x.y` UA with a hard 403 (NOT a rate-limit, NOT
# transient — reproducible 100% of the time), while it serves `curl/*`,
# `reqwest` (what the tauri updater client actually uses), `Mozilla/*`, and any
# non-bot UA with 200. A probe using urllib's default UA therefore false-fails
# an upload that fully succeeded and that every real client can download. So set
# an explicit updater-like UA below; with that in place a 403/404 means a REAL
# permission/missing-object problem worth failing on. A short retry still guards
# a genuinely transient 429/5xx, but we do NOT retry a 403 (with a good UA it is
# real). Probe via range-GET — exactly what tauri-plugin-updater does.
python3 - "$TMP_MANIFEST" <<'PY'
import json, sys, time, urllib.request, urllib.error
m = json.load(open(sys.argv[1]))
# A real-client UA — r2.dev 403s the default Python-urllib bot UA (see comment).
UA = "Papercusp-Updater (release-verify; reqwest-compatible)"
ATTEMPTS = 3                 # total tries per url (only for transient 429/5xx)
BACKOFF  = [3, 9]            # seconds between transient retries

def probe(url):
    """Return (ok, detail, retryable). Range-GET, mirroring the updater client."""
    req = urllib.request.Request(
        url, method="GET",
        headers={"User-Agent": UA, "Range": "bytes=0-0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return True, f"{r.status} (range-GET ok)", False
    except urllib.error.HTTPError as e:
        # 429/5xx can be transient; 403/404 with a good UA is a real failure.
        return False, f"HTTP {e.code}", e.code == 429 or 500 <= e.code < 600
    except Exception as e:
        return False, str(e), True   # network-level blip: retryable

bad = 0
for key, entry in (m.get("platforms") or {}).items():
    url = entry.get("url", "")
    ok, detail, retryable = False, "no attempt", False
    for i in range(ATTEMPTS):
        ok, detail, retryable = probe(url)
        if ok:
            if i:
                detail += f" (after {i+1} tries)"
            break
        if not retryable or i == ATTEMPTS - 1:
            break
        time.sleep(BACKOFF[min(i, len(BACKOFF) - 1)])
    if ok:
        print(f"  ✓ {key}: {detail}")
    else:
        bad += 1
        print(f"  ✗ {key}: {url} -> {detail}")
if bad:
    sys.exit(f"\n{bad} advertised artifact url(s) are NOT fetchable — the manifest lies. Fix before shipping.")
PY

echo
echo "==> done — $TAG is LIVE at the release host."
echo "    Installed apps will see it on their next update check."
