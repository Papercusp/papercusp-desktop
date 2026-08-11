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
#   <secret>/<channel>/latest.json       ← the per-channel feed (additive)
#   <secret>/<tag>/<artifact>            ← installers + their .sig files
#
# The per-channel feed is ADDITIVE and changes nothing for an existing install:
# every shipped binary polls the permanent root address, which is still written
# exactly as before. A side-by-side channel (nightly — its own bundle id, name
# and data home) writes ONLY its own feed and never the root, because the root
# is polled by every installed copy of the MAIN app.
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
# NOTE: there is deliberately no $BUNDLE here. Since EI-12913 this script consumes
# the ONE artifact list the builder wrote (release_artifacts_read, below) and hard-
# fails when it is missing or empty — it never globs a bundle dir. A vestigial
# BUNDLE=${CARGO_TARGET_DIR:-$HOME/.cargo-target}/release/bundle sat here unused
# until EI-18103803991060000; it was removed rather than repointed, because reading
# it implied this path depends on a bundle root that it does not.
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

# EI-12913: consume the ONE artifact set release-local.sh already computed
# (bin/lib/release-artifacts.sh) instead of re-deriving it here with a second
# glob. The old glob scanned $BUNDLE/{deb,appimage,dmg,macos,nsis,msi} — which has
# NO `inno` dir (where the windows artifacts actually land) and still named the
# retired `nsis` packager — and its extension allowlist EXCLUDED `.bin`, so it
# could not see the windows installer at all AND would have dropped every Server
# DiskSpanning .bin slice (the ~4 GB payload; the .exe alone is a ~3.6 MB stub).
# One list, written by the builder, read here — no drift.
# shellcheck source=lib/release-artifacts.sh
. "$HERE/lib/release-artifacts.sh"
# desktop_channel_feed_paths — which manifest keys this channel publishes.
# shellcheck source=lib/gen-latest-manifest.sh
. "$HERE/lib/gen-latest-manifest.sh"
mapfile -t ARTIFACTS < <(release_artifacts_read "$TAG") || {
  echo "ERROR: could not resolve this cut's artifacts for $TAG — run bin/release-local.sh $VERSION $CHANNEL first (it writes the manifest this reads)." >&2
  exit 1
}

if [[ ${#ARTIFACTS[@]} -eq 0 ]]; then
  echo "ERROR: no artifacts recorded for $TAG" >&2
  exit 1
fi

# Recurrence guard (EI-12913): every artifact URL the manifest(s) ADVERTISE must
# be in the set we are about to upload. Fail BEFORE uploading — the post-upload
# fetch-check below catches an advertised-but-missing artifact only once the
# manifest lie is already live. latest-server.json is optional (only Server cuts
# emit it) and skipped if absent.
if ! release_artifacts_assert_urls_covered "$TAG" "$LATEST_JSON" "$LATEST_SERVER_JSON"; then
  echo "ERROR: latest.json advertises artifact(s) not in this cut's upload set — the manifest would lie. Fix the cut before shipping (EI-12913)." >&2
  exit 1
fi

echo "==> release host : ${BASE%/*}/<secret>"
# NEVER print the raw KEY_PREFIX — it is the unguessable path segment that keeps
# the bucket unlisted (D-002/D-003), so it is a masked secret (must never reach a
# transcript / PG / a shared log). This preview is meant to be safe to paste into
# a status update, INCLUDING under DRY_RUN, so it masks the prefix the same way
# line 161 masks the host path. (An agent's mask-sed around DRY_RUN output missed
# it here on 2026-07-17 because there is no KEY_PREFIX env var to grep — it is
# derived from PAPERCUSP_UPDATE_BASE_URL — so the preview must self-mask.)
echo "==> bucket       : s3://${R2_BUCKET}/<secret>/"
echo "==> tag          : $TAG"
echo "==> artifacts    : ${#ARTIFACTS[@]}"
for f in "${ARTIFACTS[@]}"; do
  printf '      %10.2f GB  %s\n' "$(echo "scale=2; $(stat -c%s "$f")/1000000000" | bc)" "$(basename "$f")"
done
echo

# ── GUARD (WI-37738): do the BINARIES point at the prefix we are publishing to? ──
# The failure this exists to stop, which shipped for real on 2026-07-28:
# the release host is baked into the binary at COMPILE time (option_env!
# PAPERCUSP_RELEASE_HOST → baked_release_host() in main.rs), while the publish
# target below is read from the environment at UPLOAD time. Re-point the host
# between build and upload — or build on a box with a stale release-host.env —
# and you produce binaries that ask the OLD prefix forever, then upload them to
# the NEW one. Nothing errors. Every install from that build is permanently
# stranded: the old prefix keeps answering 200 with a frozen manifest, so the
# app is told it is current and never updates again. It took ~2 weeks and a
# real-VM verification pass to notice.
#
# Fails on a PROVEN mismatch; warns (never blocks) when it cannot see inside the
# artifacts, because a compressed artifact yielding no strings is not evidence of
# anything. Set ALLOW_HOST_MISMATCH=1 to override deliberately.
BASE_HOST="$(printf '%s' "$BASE" | sed -E 's#^https?://([^/]+).*#\1#')"
echo "==> verifying baked release host in artifacts (expect prefix: <secret>)"
host_checked=0
host_bad=0
for f in "${ARTIFACTS[@]}"; do
  # Only uncompressed artifacts expose the baked string; a .tar.gz/.zip legitimately
  # yields nothing and is SKIPPED rather than counted as agreement.
  found="$(strings -a "$f" 2>/dev/null \
    | grep -oE "https?://${BASE_HOST}/[A-Za-z0-9_-]+" \
    | sed -E "s#^https?://${BASE_HOST}/##" | sort -u)" || true
  [[ -z "$found" ]] && continue
  host_checked=$((host_checked + 1))
  while IFS= read -r prefix; do
    [[ -z "$prefix" ]] && continue
    if [[ "$prefix" != "$KEY_PREFIX" ]]; then
      host_bad=$((host_bad + 1))
      echo "    ✗ $(basename "$f") is baked to a DIFFERENT prefix than we are publishing to" >&2
    fi
  done <<< "$found"
done

if [[ "$host_bad" -gt 0 ]]; then
  if [[ "${ALLOW_HOST_MISMATCH:-0}" == "1" ]]; then
    echo "    ⚠ baked-host mismatch OVERRIDDEN by ALLOW_HOST_MISMATCH=1 — every install from this build will be stranded on the wrong prefix." >&2
  else
    echo >&2
    echo "ERROR: these binaries ask a DIFFERENT release prefix than the one being published to." >&2
    echo "       Shipping them strands every install from this build PERMANENTLY: the prefix they" >&2
    echo "       ask keeps answering, so the app is told it is up to date and never updates again." >&2
    echo "       Rebuild with the CURRENT ~/.papercusp/release-host.env in the environment, so the" >&2
    echo "       baked host matches the upload target. (WI-37738. ALLOW_HOST_MISMATCH=1 to override.)" >&2
    exit 1
  fi
elif [[ "$host_checked" -gt 0 ]]; then
  echo "    ✓ ${host_checked} artifact(s) carry the prefix being published to"
fi
# NOTE: the host_checked==0 case is NOT decided here any more — it is decided by
# the combined verdict below, after the provenance leg has had its say.

# ── GUARD leg 2 (WI-37746): the DECISIVE, non-heuristic host check ────────────
# The strings scan above is necessary but NOT sufficient, and its blind spot is
# the WORSE half of the failure class. It greps for the CURRENT host
# (${BASE_HOST}), so an artifact baked to a DIFFERENT HOST matches nothing, is
# `continue`d rather than counted, and falls through to "could not read a baked
# host" — which, before this leg existed, was a warning that SHIPPED.
#
# Measured on fixtures 2026-08-11, publishing to host H prefix P:
#   baked H/P        -> verified OK
#   baked H/OTHER    -> BLOCKS (exit 1)      <- the scan works for prefix drift
#   baked OTHER/...  -> WARNS ONLY, SHIPS    <- the silent stranding path
# Compressed artifacts (.tar.gz/.dmg) reach that same warning for an unrelated
# reason, so on a mac-only cut the scan can verify NOTHING at all.
#
# Hence the evidence cannot come from the shipped bytes; it comes from the BUILD,
# where the baked value is known for certain. emit-build-provenance.sh records it
# as `releaseHostSha256` — a fingerprint, never the URL, because this file ships
# next to the artifacts and the URL's path segment is the masked secret.
EXPECTED_HOST_FP="$(printf '%s' "${BASE%/}" | sha256sum | cut -d' ' -f1)"
prov_checked=0; prov_bad=0; prov_legacy=0
while IFS= read -r pdir; do
  prov="$pdir/build-provenance.json"
  [[ -f "$prov" ]] || continue
  got="$(python3 -c "
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: print('__UNREADABLE__'); raise SystemExit(0)
if 'releaseHostSha256' not in d: print('__MISSING__')
elif d['releaseHostSha256'] is None: print('__NULL__')
else: print(d['releaseHostSha256'])
" "$prov" 2>/dev/null || printf '__UNREADABLE__')"
  case "$got" in
    __MISSING__|__NULL__|__UNREADABLE__|'')
      # MISSING = a pre-WI-37746 emitter; NULL = nothing was baked. Neither is
      # evidence of agreement, so neither counts as a check.
      prov_legacy=$((prov_legacy + 1)) ;;
    *)
      prov_checked=$((prov_checked + 1))
      if [[ "$got" != "$EXPECTED_HOST_FP" ]]; then
        prov_bad=$((prov_bad + 1))
        # Print only a truncated fingerprint: it is a hash of the secret base URL.
        echo "    ✗ $(basename "$pdir")/build-provenance.json: built for release host ${got:0:12}… but publishing to ${EXPECTED_HOST_FP:0:12}…" >&2
      fi ;;
  esac
done < <(printf '%s\n' "${ARTIFACTS[@]}" | xargs -r -n1 dirname | sort -u)

if [[ "$prov_bad" -gt 0 ]]; then
  if [[ "${ALLOW_HOST_MISMATCH:-0}" == "1" ]]; then
    echo "    ⚠ provenance host mismatch OVERRIDDEN by ALLOW_HOST_MISMATCH=1 — every install from this build will be stranded on the wrong host." >&2
  else
    echo >&2
    echo "ERROR: this cut's BUILD PROVENANCE says these binaries were built for a DIFFERENT release host" >&2
    echo "       than the one being published to. Shipping them strands every install from this build" >&2
    echo "       PERMANENTLY: the host they ask keeps answering with a frozen manifest, so the app is" >&2
    echo "       told it is up to date and never updates again — the WI-37738 failure, which took ~2" >&2
    echo "       weeks and a real-VM pass to notice. Rebuild with the CURRENT ~/.papercusp/release-host.env" >&2
    echo "       in the environment. (WI-37746. ALLOW_HOST_MISMATCH=1 to override deliberately.)" >&2
    exit 1
  fi
elif [[ "$prov_checked" -gt 0 ]]; then
  echo "    ✓ ${prov_checked} build-provenance record(s) confirm these bytes were built for this exact host"
fi

# Combined verdict: NEITHER leg could establish agreement ⇒ REFUSE.
#
# This used to be a warning that shipped, and measurement is what changed it.
# Running this script against the REAL, already-published 0.0.15 cut on
# 2026-08-11 produced host_checked=0 AND prov_checked=0: all 16 artifacts are
# compressed (AppImage/.deb/.dmg/.tar.gz/.exe/.zip), so `strings` exposed no
# baked host in ANY of them, and the one provenance record predated
# releaseHostSha256. So "UNVERIFIED" was not a rare corner — it was the ROUTINE
# outcome on the release that actually shipped, which is exactly how a warning
# gets waved through and how WI-37738 stranded every install for ~2 weeks.
#
# Now that emit-build-provenance.sh always records releaseHostSha256, a cut
# built through the normal path ALWAYS has decisive evidence, so reaching here
# means something genuinely unusual: artifacts assembled outside the build, or a
# provenance file that never made it next to them. Fail closed and make the
# operator say so out loud, rather than letting the routine case stay silent.
if [[ "$host_checked" -eq 0 && "$prov_checked" -eq 0 ]]; then
  if [[ "${ALLOW_HOST_MISMATCH:-0}" == "1" ]]; then
    echo "    ⚠ UNVERIFIED host/target agreement OVERRIDDEN by ALLOW_HOST_MISMATCH=1 — nothing proves these binaries point at this prefix." >&2
  else
    echo >&2
    echo "ERROR: host/target agreement is UNVERIFIED for this cut, so this upload is REFUSED." >&2
    echo "       The artifacts expose no baked host to \`strings\` (all compressed is normal), AND no" >&2
    echo "       build-provenance record carries releaseHostSha256 (${prov_legacy} legacy/absent record(s))." >&2
    echo "       Nothing here proves these binaries poll the prefix being published to — and shipping a" >&2
    echo "       build that polls the WRONG one strands every install from it permanently (WI-37738)." >&2
    echo "       Re-cut so bin/emit-build-provenance.sh records the baked host, or, if you are" >&2
    echo "       deliberately re-uploading a pre-WI-37746 cut whose host you have confirmed by hand," >&2
    echo "       re-run with ALLOW_HOST_MISMATCH=1. (WI-37746.)" >&2
    exit 1
  fi
fi
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

# The manifest goes to EVERY feed path this channel publishes:
#   <secret>/<channel>/latest.json   ← the per-channel feed (always)
#   <secret>/latest.json             ← the PERMANENT address, for update lanes only
#
# The per-channel feed is written FIRST and the root LAST, deliberately: if this
# dies partway, the address every installed app polls forever is still pointing
# at the previous, known good release rather than at a half-published one.
#
# The root leg is exactly what this script has always done — it is preserved
# byte-for-byte so no existing install is affected. The per-channel legs are
# purely additive: nothing reads them until a build ships that knows to.
upload_manifest() {
  local src="$1" manifest_name="$2" label="$3" path
  while IFS= read -r path; do
    if [[ "$path" == "$manifest_name" ]]; then
      echo "==> uploading ${label} to the PERMANENT root address (LAST — this is what publishes the update)"
    else
      echo "==> uploading ${label} to the ${CHANNEL} channel feed (${path})"
    fi
    s3 cp "$src" "s3://${R2_BUCKET}/${KEY_PREFIX}/${path}" \
      --content-type application/json --cache-control 'no-cache, max-age=0' --only-show-errors
  done < <(desktop_channel_feed_paths "$CHANNEL" "$manifest_name")
}

upload_manifest "$LATEST_JSON" "latest.json" "latest.json"

if [[ -f "$LATEST_SERVER_JSON" ]]; then
  echo "==> publishing the Server product's manifest (WI-4404)"
  upload_manifest "$LATEST_SERVER_JSON" "latest-server.json" "latest-server.json"
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
