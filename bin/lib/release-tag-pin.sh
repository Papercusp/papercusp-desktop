#!/usr/bin/env bash
# Exact-SHA release tag operations shared by the desktop cutter and its
# containment/repair path. This file is sourced; callers choose their own
# `set -e` policy.

release_tag_remote_sha() { # <repo> <tag>
  local repo="$1" tag="$2"
  git -C "$repo" ls-remote --refs --tags origin "refs/tags/$tag" 2>/dev/null \
    | awk 'NR == 1 { print $1 }'
}

release_tag_repair_exact() { # <repo> <tag> <expected-40-char-commit-sha>
  local repo="$1" tag="$2" expected_sha="$3"
  local resolved_sha remote_before remote_after local_after

  if [[ ! "$expected_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ERROR: release tag repair requires an exact 40-character lowercase commit SHA" >&2
    return 2
  fi
  if [[ ! "$tag" =~ ^desktop-v[0-9A-Za-z.-]+$ ]]; then
    echo "ERROR: refusing to repair non-desktop release tag '$tag'" >&2
    return 2
  fi

  resolved_sha="$(git -C "$repo" rev-parse --verify "${expected_sha}^{commit}" 2>/dev/null)" || {
    echo "ERROR: expected release source $expected_sha is not a commit in $repo" >&2
    return 2
  }
  if [[ "$resolved_sha" != "$expected_sha" ]]; then
    echo "ERROR: expected release source resolved to $resolved_sha, not exact $expected_sha" >&2
    return 2
  fi

  remote_before="$(release_tag_remote_sha "$repo" "$tag")"
  if [[ -z "$remote_before" ]]; then
    echo "ERROR: origin has no refs/tags/$tag; repair only moves an existing release tag" >&2
    return 2
  fi

  echo "==> repairing release tag $tag: ${remote_before:0:12} -> ${expected_sha:0:12}"
  # The explicit force-with-lease makes the read above an ownership check: a
  # concurrent release writer wins by causing this repair to fail, never by
  # being silently overwritten. Push the exact object before moving the local
  # ref, so a credential/network failure leaves both refs at their old value.
  git -C "$repo" push \
    "--force-with-lease=refs/tags/$tag:$remote_before" \
    origin "$expected_sha:refs/tags/$tag"

  remote_after="$(release_tag_remote_sha "$repo" "$tag")"
  if [[ "$remote_after" != "$expected_sha" ]]; then
    echo "ERROR: origin refs/tags/$tag is $remote_after after repair, expected $expected_sha" >&2
    return 1
  fi

  git -C "$repo" tag -f "$tag" "$expected_sha" >/dev/null
  local_after="$(git -C "$repo" rev-parse --verify "refs/tags/$tag" 2>/dev/null)"
  if [[ "$local_after" != "$expected_sha" ]]; then
    echo "ERROR: local refs/tags/$tag is $local_after after repair, expected $expected_sha" >&2
    return 1
  fi

  echo "    ✓ local+origin refs/tags/$tag = $expected_sha"
}
