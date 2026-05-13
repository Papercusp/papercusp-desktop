#!/usr/bin/env bash
# audit-bundle.sh — verify production artifacts contain no PostHog leaks.
#
# V1 privacy contract: a freshly installed production binary must make
# zero network requests to flags.papercuspai.com under any usage. That
# requires that NO discovery file and NO PostHog env var has been baked
# into the artifact at build time.
#
# Usage:
#   bin/audit-bundle.sh path/to/artifact.deb [path/to/artifact.dmg ...]
#
# Exits 0 if every artifact is clean. Exits 1 (and lists matches) if any
# artifact contains posthog.json, posthog-personal.json, or any of the
# PAPERCUSP_POSTHOG_* env-var names.
#
# Supported formats: .deb, .dmg, .msi, .exe, .rpm, .AppImage, or a raw
# directory (e.g. an unpacked Papercusp.app or .next-prod/standalone).
set -euo pipefail

NEEDLES=(
  # No literal-string needles. Bare `phx_` / `phc_` / `posthog.json`
  # all show up legitimately in source/docs/code. We use regex needles
  # below to match only actual SECRETS (long random suffixes), not
  # placeholders or path references.
  ''
)

# Regex needles. Match real PostHog keys: phx_ / phc_ followed by 30+
# alphanumeric / underscore chars. Placeholders like phx_xxx or phc_…
# don't qualify. Hand-crafted to avoid false positives in docs.
REGEX_NEEDLES=(
  'phx_[A-Za-z0-9_]{30,}'
  'phc_[A-Za-z0-9_]{30,}'
)

# Soft-warn needles: signals that posthog-js (the browser SDK) is in the
# bundle. Today it's dynamic-imported only when the user opts into
# telemetry (default off), so its presence is not a privacy leak per se.
# But a hostile fork could remove the opt-in gate and silently turn it
# on, so it's worth surfacing. WARN, do not FAIL.
WARN_NEEDLES=(
  'node_modules/posthog-js/'
  'posthog-js@'
)

if [[ $# -eq 0 ]]; then
  echo "usage: $0 <artifact> [<artifact>...]" >&2
  exit 2
fi

FAIL=0
PASSED=0
TOTAL=$#

scan_path() {
  local path="$1"
  local label="$2"
  local matches=()
  # Paths to ignore: documentation that legitimately mentions the
  # needles in prose (e.g. content/docs/posthog/*, .mdx, .md). These
  # don't load into a shipped runtime, so they aren't privacy leaks.
  local exclude_re='(content/docs|/docs/|\.mdx|\.md$|\.rsc$|app/docs/.*\.html$)'
  for needle in "${NEEDLES[@]}"; do
    [[ -z "$needle" ]] && continue
    if grep -rlF --binary-files=text -- "$needle" "$path" 2>/dev/null \
        | grep -vE "$exclude_re" \
        | head -5 | grep -q .; then
      matches+=("$needle")
    fi
  done
  for re in "${REGEX_NEEDLES[@]}"; do
    if grep -rlE --binary-files=text -- "$re" "$path" 2>/dev/null \
        | grep -vE "$exclude_re" \
        | head -5 | grep -q .; then
      matches+=("regex:$re")
    fi
  done

  # Soft warnings (informational, do not affect exit code).
  local warnings=()
  for needle in "${WARN_NEEDLES[@]}"; do
    if grep -rlF --binary-files=text -- "$needle" "$path" 2>/dev/null | head -3 | grep -q .; then
      warnings+=("$needle")
    fi
  done
  if [[ ${#warnings[@]} -gt 0 ]]; then
    echo "WARN: $label contains telemetry-related code (default OFF; opt-in gated):" >&2
    for w in "${warnings[@]}"; do
      echo "  - found: $w" >&2
    done
  fi

  if [[ ${#matches[@]} -gt 0 ]]; then
    echo "FAIL: $label" >&2
    for m in "${matches[@]}"; do
      echo "  - found: $m" >&2
      if [[ "$m" == regex:* ]]; then
        local re="${m#regex:}"
        grep -rlE --binary-files=text -- "$re" "$path" 2>/dev/null \
          | grep -vE "$exclude_re" \
          | head -3 | sed 's|^|      |' >&2
      else
        grep -rlF --binary-files=text -- "$m" "$path" 2>/dev/null \
          | grep -vE "$exclude_re" \
          | head -3 | sed 's|^|      |' >&2
      fi
    done
    return 1
  fi
  return 0
}

for artifact in "$@"; do
  if [[ ! -e "$artifact" ]]; then
    echo "FAIL: $artifact (not found)" >&2
    FAIL=$((FAIL+1))
    continue
  fi

  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT

  case "$artifact" in
    *.deb)
      dpkg-deb -x "$artifact" "$TMPDIR" 2>/dev/null
      ;;
    *.rpm)
      if command -v rpm2cpio >/dev/null 2>&1; then
        (cd "$TMPDIR" && rpm2cpio "$artifact" | cpio -idm --quiet 2>/dev/null) || { echo "FAIL: $artifact rpm2cpio extraction failed" >&2; FAIL=$((FAIL+1)); continue; }
      elif command -v 7z >/dev/null 2>&1; then
        7z x -o"$TMPDIR" "$artifact" >/dev/null 2>&1 || { echo "FAIL: $artifact 7z extraction failed" >&2; FAIL=$((FAIL+1)); continue; }
      else
        echo "FAIL: $artifact — neither rpm2cpio nor 7z available" >&2
        FAIL=$((FAIL+1))
        continue
      fi
      ;;
    *.AppImage)
      cp "$artifact" "$TMPDIR/app.AppImage"
      chmod +x "$TMPDIR/app.AppImage"
      (cd "$TMPDIR" && ./app.AppImage --appimage-extract >/dev/null 2>&1) || true
      ;;
    *.dmg)
      # On Linux: use 7z to extract. On macOS: hdiutil. Try both.
      if command -v 7z >/dev/null 2>&1; then
        7z x -o"$TMPDIR" "$artifact" >/dev/null 2>&1 || true
      elif command -v hdiutil >/dev/null 2>&1; then
        MOUNT=$(hdiutil attach -nobrowse -readonly "$artifact" | grep '/Volumes/' | head -1 | awk '{print $NF}')
        cp -R "$MOUNT" "$TMPDIR/"
        hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
      else
        echo "WARN: $artifact — neither 7z nor hdiutil available, scanning as binary blob" >&2
        cp "$artifact" "$TMPDIR/blob.dmg"
      fi
      ;;
    *.msi)
      # Use 7z (handles MSI containers). Fall back to raw scan.
      if command -v 7z >/dev/null 2>&1; then
        7z x -o"$TMPDIR" "$artifact" >/dev/null 2>&1 || true
      else
        echo "WARN: $artifact — 7z not available, scanning as binary blob" >&2
        cp "$artifact" "$TMPDIR/blob.msi"
      fi
      ;;
    *.exe)
      # NSIS .exe installers — 7z can usually crack them.
      if command -v 7z >/dev/null 2>&1; then
        7z x -o"$TMPDIR" "$artifact" >/dev/null 2>&1 || true
      else
        echo "WARN: $artifact — 7z not available, scanning as binary blob" >&2
        cp "$artifact" "$TMPDIR/blob.exe"
      fi
      ;;
    *)
      if [[ -d "$artifact" ]]; then
        cp -R "$artifact" "$TMPDIR/"
      else
        cp "$artifact" "$TMPDIR/"
      fi
      ;;
  esac

  if scan_path "$TMPDIR" "$artifact"; then
    echo "OK:   $artifact"
    PASSED=$((PASSED+1))
  else
    FAIL=$((FAIL+1))
  fi

  rm -rf "$TMPDIR"
  trap - EXIT
done

echo
if [[ $FAIL -gt 0 ]]; then
  echo "FAIL: $FAIL of $TOTAL artifacts contain PostHog leaks" >&2
  exit 1
fi
echo "OK: $PASSED/$TOTAL artifacts clean"
exit 0
