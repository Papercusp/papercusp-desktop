#!/usr/bin/env bash
# release-identity-env.sh — give a desktop release cut the owner's FULL identity literals.
#
# WHY THIS EXISTS (WI-10004349)
# -----------------------------
# The finished-byte identity audit (audit-release-bundle.py) and the sidecar docs scrub
# redact exactly the owner literals they are handed in PAPERCUSP_RELEASE_OWNER_NAME and
# PAPERCUSP_RELEASE_OWNER_EMAIL, and nothing else. A desktop cut got those two values
# ONLY from whoever launched it: release:cut takes them as tool arguments, and a manual
# `bin/release-local.sh` run inherits whatever the invoking shell exported.
#
# Measured 2026-09-30: every release:cut call over the previous five days passed a single
# hand-typed name and, with one exception, no email. The owner-provisioned
# ~/.papercusp/release-identity.env holds two names and two addresses. So 0.0.25 (published)
# and 0.0.26 (signed) both shipped six docs files carrying the SECOND name unscrubbed, while
# the audit printed "✓ CLEAN" beside a "PARTIAL COVERAGE: EMAIL not covered" caveat. A caller
# value that was merely INCOMPLETE silently shadowed the complete one.
#
# WHAT IT DOES
# ------------
# papercusp_union_release_identity_env  UNIONS the file's literals with whatever the
#   environment already carries. Union, not "fill the gap" (the rule loadOwnerIdentityEnv
#   uses for the record/gate CLIs): for a redaction list more literals are strictly safer,
#   and a partial explicit value must never hide the rest. Values are parsed with Node's
#   util.parseEnv, the same parser owner-identity-env.ts uses; the file is never executed.
# papercusp_require_release_owner_identity  refuses (return 2) unless BOTH a name and an
#   email literal resolved. The email class has no shape rule in the audit, so an absent
#   email means ZERO email coverage behind a CLEAN verdict; a release cut must not proceed
#   on that.
#
# It prints counts only. Owner literals are never echoed, logged or written to a file:
# runtime-only is the rule that keeps the audit from manufacturing the leak it hunts.
#
# Path: $PAPERCUSP_RELEASE_IDENTITY_ENV, else $HOME/.papercusp/release-identity.env
# (the same override owner-identity-env.ts and workspace-host-release-cut-cli.ts honour).

# Split every argument on comma/semicolon (the audit's own separators: names contain
# spaces, so whitespace is NOT a separator), trim, drop empties, de-duplicate keeping the
# first occurrence, and print the result comma-joined. No globbing, no word splitting.
__pc_identity_union() {
  local out="" seen=$'\n' arg item
  local -a parts
  for arg in "$@"; do
    IFS=',;' read -r -a parts <<<"$arg"
    for item in "${parts[@]}"; do
      item="${item//$'\r'/}"
      item="${item#"${item%%[![:space:]]*}"}"
      item="${item%"${item##*[![:space:]]}"}"
      [[ -n "$item" ]] || continue
      case "$seen" in *$'\n'"$item"$'\n'*) continue ;; esac
      seen+="$item"$'\n'
      out+="${out:+,}$item"
    done
  done
  printf '%s' "$out"
}

# Number of literals in a comma-joined list (0 for empty).
__pc_identity_count() {
  local list="$1" commas
  [[ -n "$list" ]] || { printf '0'; return; }
  commas="${list//[^,]/}"
  printf '%s' "$(( ${#commas} + 1 ))"
}

# Print KEY's value from an env file using Node's util.parseEnv (never sourcing the file).
__pc_identity_file_value() {
  node -e '
    const fs = require("node:fs");
    const { parseEnv } = require("node:util");
    const parsed = parseEnv(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(parsed[process.argv[2]] ?? "").trim());
  ' "$1" "$2"
}

papercusp_release_identity_env_path() {
  printf '%s' "${PAPERCUSP_RELEASE_IDENTITY_ENV:-${HOME:-}/.papercusp/release-identity.env}"
}

papercusp_union_release_identity_env() {
  local file key from_file merged
  file="$(papercusp_release_identity_env_path)"
  if [[ ! -e "$file" ]]; then
    echo "[identity] no $file — owner identity comes from the environment alone" >&2
    return 0
  fi
  if [[ ! -r "$file" ]]; then
    echo "ERROR: $file exists but is not readable; refusing to cut with a partial owner identity." >&2
    return 2
  fi
  for key in PAPERCUSP_RELEASE_OWNER_NAME PAPERCUSP_RELEASE_OWNER_EMAIL; do
    if ! from_file="$(__pc_identity_file_value "$file" "$key")"; then
      echo "ERROR: could not parse $file; refusing to cut with a partial owner identity." >&2
      return 2
    fi
    merged="$(__pc_identity_union "${!key:-}" "$from_file")"
    export "$key=$merged"
  done
  echo "[identity] $file unioned: $(__pc_identity_count "$PAPERCUSP_RELEASE_OWNER_NAME") owner-name literal(s), $(__pc_identity_count "$PAPERCUSP_RELEASE_OWNER_EMAIL") owner-email literal(s)" >&2
}

papercusp_require_release_owner_identity() {
  local name="${PAPERCUSP_RELEASE_OWNER_NAME:-}" email="${PAPERCUSP_RELEASE_OWNER_EMAIL:-}"
  if [[ -z "${name//[[:space:],;]/}" ]]; then
    echo "ERROR: release cut requires PAPERCUSP_RELEASE_OWNER_NAME at run time before any seed/build work." >&2
    echo "       Provide it in $(papercusp_release_identity_env_path) or pass it through release:cut; never write it into a tracked file." >&2
    return 2
  fi
  if [[ -z "${email//[[:space:],;]/}" ]]; then
    echo "ERROR: release cut requires PAPERCUSP_RELEASE_OWNER_EMAIL at run time before any seed/build work (WI-10004349)." >&2
    echo "       Without it the identity audit hunts NO owner address and still prints CLEAN." >&2
    echo "       Provide it in $(papercusp_release_identity_env_path) or pass ownerEmail through release:cut." >&2
    return 2
  fi
}
