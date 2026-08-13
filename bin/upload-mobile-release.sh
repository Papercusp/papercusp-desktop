#!/usr/bin/env bash
#
# upload-mobile-release.sh — push a cut's MOBILE artifacts (Android APK/AAB,
# iOS IPA) to the release host, under the synthesized versioned names the
# release registry records them as.
#
# Sibling of upload-release.sh (desktop artifacts + latest.json) — separate on
# purpose, same reason publish-release-history.sh is separate: mobile bytes must
# be publishable without a desktop bundle tree or a latest.json in /tmp (mobile
# has NO auto-update manifest — phones install manually from the release page),
# and a desktop re-cut must not depend on phone builds existing.
#
# The name mapping comes from record-release-cli --scan-mobile (TSV: the real
# on-disk file TAB the published name), so the candidate list — release-preferred-
# over-debug, ios/build recursion — lives in exactly one tested place. The bytes
# land at <secret>/<tag>/<published-name>, which is exactly the RELATIVE url the
# registry row carries, so the release-history page's links resolve.
#
#   Usage:  bin/upload-mobile-release.sh <version> [channel]    # e.g. 0.0.9 alpha
#           DRY_RUN=1 bin/upload-mobile-release.sh 0.0.9 alpha  # print, upload nothing
#
# Credentials + host config: same two owner-provisioned files as upload-release.sh
# (~/.papercusp/release-host.env, ~/.papercusp/r2.env).
set -euo pipefail

VERSION="${1:-}"
CHANNEL="${2:-alpha}"
DRY_RUN="${DRY_RUN:-0}"
SKIP_ANDROID="${PAPERCUSP_SKIP_ANDROID:-0}"

if [[ -z "$VERSION" ]]; then
  echo "usage: bin/upload-mobile-release.sh <version> [channel]    (e.g. 0.0.9 alpha)" >&2
  exit 2
fi

TAG="desktop-v${VERSION}"
[[ "$CHANNEL" != "stable" ]] && TAG="${TAG}-${CHANNEL}"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# ── Config: where it goes (same contract as upload-release.sh) ───────────────
RELEASE_HOST_ENV="${HOME}/.papercusp/release-host.env"
if [[ ! -f "$RELEASE_HOST_ENV" ]]; then
  echo "ERROR: $RELEASE_HOST_ENV not found — no release host configured." >&2
  exit 1
fi
# shellcheck source=/dev/null
set -a; . "$RELEASE_HOST_ENV"; set +a
BASE="${PAPERCUSP_UPDATE_BASE_URL:-${PAPERCUSP_RELEASE_HOST:-}}"
if [[ -z "$BASE" ]]; then
  echo "ERROR: neither PAPERCUSP_UPDATE_BASE_URL nor PAPERCUSP_RELEASE_HOST set in $RELEASE_HOST_ENV" >&2
  exit 1
fi
KEY_PREFIX="$(printf '%s' "$BASE" | sed -E 's#^https?://[^/]+/?##; s#/$##')"
if [[ -z "$KEY_PREFIX" ]]; then
  echo "ERROR: base URL '$BASE' has no path segment — the secret must live in the PATH (D-002)." >&2
  exit 1
fi

# ── Credentials ──────────────────────────────────────────────────────────────
R2_ENV="${HOME}/.papercusp/r2.env"
if [[ ! -f "$R2_ENV" ]]; then
  echo "ERROR: $R2_ENV not found — R2 credentials are owner-provisioned (P-002)." >&2
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
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"

s3() { aws s3 --endpoint-url "$ENDPOINT" "$@"; }
s3api_head() {
  aws s3api head-object --endpoint-url "$ENDPOINT" \
    --bucket "$R2_BUCKET" --key "$1" \
    --query 'ContentLength' --output text 2>/dev/null || true
}

# ── What to upload: src TAB published-name, from the ONE tested candidate list ─
# Android is required as a complete provenanced APK+AAB pair unless explicitly
# opted out. Capture the command status directly: process substitution would hide
# a provenance validation failure and make it look like an empty candidate list.
SCAN_ARGS=(--scan-mobile --version "$VERSION")
if [[ "$SKIP_ANDROID" == "1" ]]; then
  SCAN_ARGS+=(--skip-android)
  echo "==> Android explicitly skipped (PAPERCUSP_SKIP_ANDROID=1)"
fi
if ! scan_output="$(cd "$ROOT" && npx tsx apps/operator/lib/release/record-release-cli.ts "${SCAN_ARGS[@]}")"; then
  echo "ERROR: mobile artifact provenance validation failed" >&2
  exit 1
fi
PAIRS=()
while IFS= read -r pair; do
  [[ -n "$pair" ]] && PAIRS+=("$pair")
done <<<"$scan_output"

if [[ ${#PAIRS[@]} -eq 0 ]]; then
  echo "ERROR: no mobile artifacts found (record-release-cli --scan-mobile --version $VERSION" >&2
  echo "       returned nothing). Build the apps first — android: gradlew assembleDebug/Release;" >&2
  echo "       ios: an .ipa under papercup-rust-mobile/ios/build/." >&2
  exit 1
fi

if [[ "$SKIP_ANDROID" != "1" ]]; then
  android_apk_count="$(printf '%s\n' "${PAIRS[@]}" | awk -F '\t' '$2 ~ /_android\.apk$/ { n++ } END { print n+0 }')"
  android_aab_count="$(printf '%s\n' "${PAIRS[@]}" | awk -F '\t' '$2 ~ /_android\.aab$/ { n++ } END { print n+0 }')"
  if [[ "$android_apk_count" != "1" || "$android_aab_count" != "1" ]]; then
    echo "ERROR: upload requires exactly one provenanced Android APK and AAB" >&2
    echo "       found apk=$android_apk_count aab=$android_aab_count; use PAPERCUSP_SKIP_ANDROID=1 only for an explicit non-Android upload" >&2
    exit 1
  fi
fi

echo "==> release host : ${BASE%/*}/<secret>"
# NEVER print the raw KEY_PREFIX — it is the unguessable path segment that keeps
# the bucket unlisted (D-002/D-003), so it is a masked secret (must never reach a
# transcript / PG / a shared log). This preview must be safe to paste into a
# status update, INCLUDING under DRY_RUN, so it self-masks the same way
# upload-release.sh's preview does (EI-15305: this sibling script had the same
# unmasked echo — relying on an operator's own mask-sed is not reliable here,
# since KEY_PREFIX is derived from PAPERCUSP_UPDATE_BASE_URL, not a grep-able
# env var).
echo "==> bucket       : s3://${R2_BUCKET}/<secret>/"
echo "==> tag          : $TAG"
echo "==> mobile artifacts: ${#PAIRS[@]}"
for pair in "${PAIRS[@]}"; do
  src="${pair%%$'\t'*}"; name="${pair##*$'\t'}"
  printf '      %8.1f MB  %s  ←  %s\n' "$(echo "scale=1; $(stat -c%s "$src")/1000000" | bc)" "$name" "$src"
done
echo

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN=1 — nothing uploaded."
  exit 0
fi

# ── Upload (skip-if-same-size, same rationale as upload-release.sh) ──────────
for pair in "${PAIRS[@]}"; do
  src="${pair%%$'\t'*}"; name="${pair##*$'\t'}"
  local_size="$(stat -c%s "$src")"
  if [[ "$(s3api_head "${KEY_PREFIX}/${TAG}/${name}")" == "$local_size" ]]; then
    echo "==> already uploaded, skipping $name"
    continue
  fi
  echo "==> uploading $name"
  s3 cp "$src" "s3://${R2_BUCKET}/${KEY_PREFIX}/${TAG}/${name}" --only-show-errors
done

# ── Verify storage ───────────────────────────────────────────────────────────
echo
echo "==> verifying storage (S3, authenticated)"
BAD=0
for pair in "${PAIRS[@]}"; do
  src="${pair%%$'\t'*}"; name="${pair##*$'\t'}"
  local_size="$(stat -c%s "$src")"
  remote_size="$(s3api_head "${KEY_PREFIX}/${TAG}/${name}")"
  if [[ "$remote_size" == "$local_size" ]]; then
    printf '  ✓ %s (%.1f MB)\n' "$name" "$(echo "scale=1; $local_size/1000000" | bc)"
  else
    echo "  ✗ $name — local ${local_size}B but remote '${remote_size}'" >&2
    BAD=1
  fi
done
if [[ "$BAD" != "0" ]]; then
  echo "ERROR: mobile artifacts did not land intact." >&2
  exit 1
fi
echo "  ✓ all mobile artifacts present in the bucket at full size"
echo
echo "Next: re-record the release with --mobile-root so the page links them"
echo "  (record-release-cli), then publish-release-history.sh."
