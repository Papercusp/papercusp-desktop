#!/usr/bin/env bash
# seed-resource-root.sh — resolve the installer seed from the bundle layout.
#
# A packaged Server.app/deb stores `seed/` beside `sidecar/`, while older rig
# launchers pointed at either a guessed `/Applications/Papercusp` directory or
# `<sidecar>/seed`.  Those guesses are harmless only when they are checked: a
# manifest-less directory must never become the seed for a boot.  Keep the
# candidate ordering in one tiny shell helper so the headless macOS, WSL, and
# composed-current launchers cannot drift apart.
#
# Source this file and call:
#   resolve_seed_resource_dir <sidecar-dir> [additional-root ...]
#
# The function prints exactly one directory and returns 0 only when that
# directory contains a non-empty, parseable manifest for the requested pot.
# A missing/empty/foreign candidate returns 1 and callers should leave
# PAPERCUSP_SEED_DIR unset so the operator takes its normal cold path.

seed_manifest_is_valid() {
  local manifest="${1:-}" expected_pot="${2:-${PAPERCUSP_SEED_POT_ID:-papercusp}}"
  local checker="${PAPERCUSP_SEED_MANIFEST_CHECKER:-node}"
  [[ -s "$manifest" ]] || return 1
  command -v "$checker" >/dev/null 2>&1 || return 1
  "$checker" -e '
    const fs = require("node:fs");
    const m = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const pot = process.argv[2];
    if (!m || m.seedFormatVersion !== 1 || m.potId !== pot || !Array.isArray(m.stores) ||
        !m.stores.some((s) => s && s.kind === "corestore")) process.exit(1);
  ' "$manifest" "$expected_pot" >/dev/null 2>&1
}

resolve_seed_resource_dir() {
  local sidecar_dir="${1:-}"
  shift || true
  local explicit="${PAPERCUSP_SEED_DIR:-}"
  local candidate root
  local -a candidates=()

  # An explicit value is a hint, not a veto.  If it is stale, continue to the
  # canonical sibling roots below (the first seeded .deb shipped this exact
  # mismatch).
  if [[ -n "$explicit" ]]; then
    candidates+=("$explicit")
  fi

  if [[ -n "$sidecar_dir" ]]; then
    # Canonical packaged layout: <resource-root>/sidecar + <resource-root>/seed.
    root="$(cd "$sidecar_dir/.." 2>/dev/null && pwd -P || true)"
    [[ -n "$root" ]] && candidates+=("$root/seed")
    # Dev/legacy layout retained for old composed payloads.
    candidates+=("$sidecar_dir/seed")
  fi

  # Additional roots let the WSL/current rig launcher try both the installed
  # Server.app and its tower-composed sidecar without hard-coding either one.
  for root in "$@"; do
    [[ -n "$root" ]] || continue
    candidates+=("$root/seed")
    if [[ "$(basename "$root")" == "sidecar" ]]; then
      candidate="$(cd "$root/.." 2>/dev/null && pwd -P || true)/seed"
      [[ -n "$candidate" ]] && candidates+=("$candidate")
    fi
  done

  for candidate in "${candidates[@]}"; do
    seed_manifest_is_valid "$candidate/manifest.json" || continue
    # Resolve symlinks where possible, but preserve the caller-visible path if
    # realpath is unavailable on a minimal guest image.
    if command -v realpath >/dev/null 2>&1; then
      realpath "$candidate" 2>/dev/null || printf '%s\n' "$candidate"
    else
      printf '%s\n' "$candidate"
    fi
    return 0
  done
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if [[ "${1:-}" != "--self-test" ]]; then
    echo "usage: source $0; resolve_seed_resource_dir <sidecar-dir> [additional-root ...]" >&2
    exit 2
  fi
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/papercusp-seed-root.XXXXXX")" || exit 1
  trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/app/sidecar" "$tmp/app/seed" "$tmp/wrong"
  printf '%s\n' '{"seedFormatVersion":1,"potId":"papercusp","stores":[{"kind":"corestore"}]}' > "$tmp/app/seed/manifest.json"
  resolved="$(PAPERCUSP_SEED_DIR="$tmp/wrong" resolve_seed_resource_dir "$tmp/app/sidecar")"
  [[ "$resolved" == "$tmp/app/seed" ]] || {
    echo "SELF-TEST FAIL: canonical sibling seed was not selected" >&2
    exit 1
  }
  echo "SELF-TEST PASS: manifest-checked resource-root resolution"
fi
