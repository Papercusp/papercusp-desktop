#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=release-tag-pin.sh
source "$HERE/release-tag-pin.sh"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TMP_ROOT"' EXIT
REMOTE="$TMP_ROOT/origin.git"
WORK="$TMP_ROOT/work"
TAG="desktop-v9.9.9"

git init --bare -q "$REMOTE"
git init -q "$WORK"
git -C "$WORK" config user.name release-tag-pin-selftest
git -C "$WORK" config user.email release-tag-pin-selftest@example.invalid
git -C "$WORK" remote add origin "$REMOTE"

printf 'canonical\n' > "$WORK/source.txt"
git -C "$WORK" add source.txt
git -C "$WORK" commit -qm canonical
CANONICAL="$(git -C "$WORK" rev-parse HEAD)"
git -C "$WORK" tag "$TAG" "$CANONICAL"
git -C "$WORK" push -q origin "refs/tags/$TAG"

printf 'wrong\n' >> "$WORK/source.txt"
git -C "$WORK" commit -qam wrong
WRONG="$(git -C "$WORK" rev-parse HEAD)"
git -C "$WORK" tag -f "$TAG" "$WRONG" >/dev/null
git -C "$WORK" push -q --force origin "refs/tags/$TAG"

release_tag_repair_exact "$WORK" "$TAG" "$CANONICAL"
[[ "$(git -C "$WORK" rev-parse "refs/tags/$TAG")" == "$CANONICAL" ]]
[[ "$(release_tag_remote_sha "$WORK" "$TAG")" == "$CANONICAL" ]]

# A normal LOCAL-only cut may align its local ref, but MUST NOT write origin.
git -C "$WORK" tag -f "$TAG" "$WRONG" >/dev/null
release_tag_prepare_local_exact "$WORK" "$TAG" "$CANONICAL"
[[ "$(git -C "$WORK" rev-parse "refs/tags/$TAG")" == "$CANONICAL" ]]
[[ "$(release_tag_remote_sha "$WORK" "$TAG")" == "$CANONICAL" ]]

# A wrong remote tag is a hard refusal. The normal cut does not repair it.
git -C "$WORK" tag -f "$TAG" "$WRONG" >/dev/null
git -C "$WORK" push -q --force origin "refs/tags/$TAG"
git -C "$WORK" tag -f "$TAG" "$CANONICAL" >/dev/null
if release_tag_prepare_local_exact "$WORK" "$TAG" "$CANONICAL" >/dev/null 2>&1; then
  echo "FAIL: normal local-only pin accepted a wrong remote tag" >&2
  exit 1
fi
[[ "$(release_tag_remote_sha "$WORK" "$TAG")" == "$WRONG" ]]
[[ "$(git -C "$WORK" rev-parse "refs/tags/$TAG")" == "$CANONICAL" ]]

if release_tag_repair_exact "$WORK" "$TAG" deadbeef >/dev/null 2>&1; then
  echo "FAIL: short SHA was accepted" >&2
  exit 1
fi

echo "release-tag-pin selftest: PASS (repaired ${WRONG:0:12} -> ${CANONICAL:0:12})"
