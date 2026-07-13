#!/usr/bin/env bash
#
# publish-release-history.sh — push the generated release-history site to the
# release host, alongside the installers it links to.
#
# WI-4446. Sibling of upload-release.sh (which ships the ARTIFACTS + latest.json);
# this ships the PAGE that beta testers actually read. Separate on purpose: a fix
# to the page must be publishable without re-uploading 11 GB of installers, and a
# re-cut must not depend on the page being regenerated.
#
#   Usage:  bin/publish-release-history.sh
#           DRY_RUN=1 bin/publish-release-history.sh     # gate + print, upload nothing
#
# Generate the site first (it reads the release registry in Postgres):
#   npx tsx apps/operator/lib/release/record-release-cli.ts --regenerate
#
# Layout it writes (relative to the bucket root):
#   <secret>/index.html            ← THE LINK WE SHARE WITH BETA TESTERS
#   <secret>/plans/<slug>.html     ← one page per plan that shipped
#
# It lands at the SAME secret path as the installers, which is what makes the
# page's relative download links resolve: index.html links `desktop-v0.0.8-alpha/…`,
# and upload-release.sh puts exactly that there. One secret, one blast radius, and
# the secret is never written into the HTML.
#
# ⛔ THE IDENTITY GATE IS THE POINT OF THIS SCRIPT, not a formality.
# The page is rendered from OUR OWN Postgres — work-item titles and plan bodies,
# written by agents running on the owner's machine. That content carries his home
# path, his name, and (via plan frontmatter) his personal email addresses. The
# renderer scrubs it; this gate re-reads the FINISHED BYTES and refuses to upload
# if anything got through. The scrub is the fix, the gate is the proof — and it has
# already caught two leaks the scrub missed. Never bypass it "just this once": an
# upload is public and irreversible, and the whole point of the page is that only
# people we hand the link to ever see it.
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"

HERE="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_ROOT="$(cd "$HERE/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_ROOT/.." && pwd)"

BUNDLE="${PAPERCUSP_BUNDLE_DIR:-${CARGO_TARGET_DIR:-$HOME/.cargo-target}/release/bundle}"
SITE_DIR="${PAPERCUSP_RELEASE_SITE_DIR:-${BUNDLE}/release-history}"

if [[ ! -f "$SITE_DIR/index.html" ]]; then
  echo "ERROR: no generated site at $SITE_DIR" >&2
  echo "       Generate it first:" >&2
  echo "         npx tsx apps/operator/lib/release/record-release-cli.ts --regenerate" >&2
  exit 1
fi

# ── Where it goes: the same secret path as the installers ────────────────────
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
  echo "ERROR: base URL has no path segment — the secret must live in the PATH (D-002)." >&2
  exit 1
fi

# ── THE GATE — run BEFORE anything is uploaded ───────────────────────────────
# Calls the SAME findIdentityLeaks() the renderer's scrub is built on (one
# implementation, one behaviour — a gate that re-implements the rule it is
# checking eventually disagrees with it, and then it is guarding nothing).
echo "==> identity gate: scanning the finished bytes in $SITE_DIR"
if ! npx tsx "${REPO_ROOT}/apps/operator/lib/release/gate-release-site.ts" "$SITE_DIR"; then
  echo >&2
  echo "⛔ REFUSING TO UPLOAD — this box's identity is present in the pages above." >&2
  echo "   Fix the SOURCE of the leak (the scrub / the renderer), regenerate, re-run." >&2
  echo "   Do not edit the generated HTML by hand: the next --regenerate would undo it" >&2
  echo "   and the leak would return silently." >&2
  exit 1
fi

# ── Credentials ──────────────────────────────────────────────────────────────
R2_ENV="${HOME}/.papercusp/r2.env"
if [[ ! -f "$R2_ENV" ]]; then
  echo "ERROR: $R2_ENV not found — R2 credentials are owner-provisioned." >&2
  exit 1
fi
# shellcheck source=/dev/null
set -a; . "$R2_ENV"; set +a
: "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID in $R2_ENV}"
: "${R2_BUCKET:?set R2_BUCKET in $R2_ENV}"
: "${AWS_ACCESS_KEY_ID:?set AWS_ACCESS_KEY_ID in $R2_ENV}"
: "${AWS_SECRET_ACCESS_KEY:?set AWS_SECRET_ACCESS_KEY in $R2_ENV}"
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI not on PATH." >&2; exit 1; }

# R2 rejects the trailing-checksum headers newer aws-cli v2 sends by default.
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"

PAGES="$(find "$SITE_DIR" -name '*.html' | wc -l)"
echo
echo "==> release host : ${BASE%/*}/<secret>"
echo "==> bucket       : s3://${R2_BUCKET}/${KEY_PREFIX}/"
echo "==> pages        : $PAGES"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN=1 — gate passed, nothing uploaded."
  exit 0
fi

# Upload the plan pages FIRST, index.html LAST. index.html is what a tester opens;
# publishing it before the pages it links to would serve a page whose links 404.
# (Same ordering rule as upload-release.sh: the thing that ADVERTISES goes last.)
echo
echo "==> uploading plan pages"
aws s3 sync "$SITE_DIR/plans" "s3://${R2_BUCKET}/${KEY_PREFIX}/plans" \
  --endpoint-url "$ENDPOINT" \
  --content-type 'text/html; charset=utf-8' \
  --cache-control 'no-cache, max-age=0' \
  --delete --only-show-errors

echo "==> uploading index.html (LAST — this is the page we share)"
aws s3 cp "$SITE_DIR/index.html" "s3://${R2_BUCKET}/${KEY_PREFIX}/index.html" \
  --endpoint-url "$ENDPOINT" \
  --content-type 'text/html; charset=utf-8' \
  --cache-control 'no-cache, max-age=0' --only-show-errors

# ── Verify what actually landed ──────────────────────────────────────────────
# Fetch the page back over the PUBLIC path — the same way a beta tester will — and
# re-run the gate on what the host actually serves. Verifying the local file proves
# nothing about the bytes now sitting on a CDN.
echo
echo "==> verifying the public read path"
TMP_PAGE="$(mktemp -d)"
trap 'rm -rf "$TMP_PAGE"' EXIT
HTTP_CODE="$(curl -sS -o "$TMP_PAGE/index.html" -w '%{http_code}' --max-time 30 "${BASE}/index.html" 2>/dev/null)" || true

if [[ -z "$HTTP_CODE" || "$HTTP_CODE" == "000" ]]; then
  HOSTNAME_ONLY="$(printf '%s' "$BASE" | sed -E 's#^https?://([^/]+).*#\1#')"
  echo "  ⚠ ${HOSTNAME_ONLY} is not reachable — the pages ARE uploaded, but the bucket is" >&2
  echo "    not published at this hostname yet, so nobody can open the link." >&2
  exit 2
fi
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "  ✗ GET index.html returned HTTP $HTTP_CODE" >&2
  exit 1
fi
if ! diff -q "$SITE_DIR/index.html" "$TMP_PAGE/index.html" >/dev/null; then
  echo "  ✗ the served page does NOT match what we uploaded" >&2
  exit 1
fi
echo "  ✓ index.html served and byte-identical"

# The gate again, on the SERVED bytes. Belt and braces, and it is nearly free:
# what we uploaded and what the host serves are two different facts.
if ! npx tsx "${REPO_ROOT}/apps/operator/lib/release/gate-release-site.ts" "$TMP_PAGE"; then
  echo "  ✗ the SERVED page contains identity — it is live. Take it down NOW." >&2
  exit 1
fi

echo
echo "==> done — the release-history page is LIVE."
echo "    Share the link (the base URL + /index.html) ONLY with beta testers."
echo "    Visits are recorded with their REFERRER, so a leak shows up as a visit"
echo "    arriving from a page we never shared the link with."
