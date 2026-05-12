#!/usr/bin/env bash
# Bump version + tag a release. Drives the Tauri updater's channel
# classification — the operator's /api/updates/manifest route reads the
# tag suffix to decide which channel a release belongs to:
#
#   desktop-vX.Y.Z          → stable channel
#   desktop-vX.Y.Z-beta.N   → beta channel
#   desktop-vX.Y.Z-rc.N     → beta channel (treated as release-candidate)
#   desktop-vX.Y.Z-alpha.N  → alpha channel
#   desktop-vX.Y.Z-test.N   → ignored (filtered out of GH releases workflow)
#
# Usage:
#   bin/cut-release.sh 0.1.0              # cut stable v0.1.0
#   bin/cut-release.sh 0.1.0 alpha 3      # cut v0.1.0-alpha.3
#   bin/cut-release.sh 0.1.0 beta 1       # cut v0.1.0-beta.1
#
# The script:
#   1. Validates the version + channel.
#   2. Updates package.json + src-tauri/Cargo.toml + src-tauri/tauri.conf.json.
#   3. Commits ("chore(release): vX.Y.Z[-channel.N]").
#   4. Tags ("desktop-vX.Y.Z[-channel.N]").
#   5. Prints the next commands (review + push).
#
# Push is intentionally NOT automated — review the diff and run
# `git push origin main desktop-vX.Y.Z[-channel.N]` yourself.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
cd "$root"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <version> [alpha|beta|rc] [build-number]" >&2
  echo "examples:" >&2
  echo "  $0 0.1.0" >&2
  echo "  $0 0.1.0 alpha 3" >&2
  echo "  $0 0.1.0 beta 1" >&2
  exit 1
fi

version="$1"
channel="${2:-stable}"
build="${3:-}"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "ERROR: version must be X.Y.Z (got '$version')" >&2
  exit 1
fi

case "$channel" in
  stable)
    suffix=""
    ;;
  alpha|beta|rc)
    if [[ -z "$build" ]]; then
      echo "ERROR: channel '$channel' requires a build number (3rd arg)" >&2
      exit 1
    fi
    if [[ ! "$build" =~ ^[0-9]+$ ]]; then
      echo "ERROR: build number must be a non-negative integer (got '$build')" >&2
      exit 1
    fi
    suffix="-${channel}.${build}"
    ;;
  *)
    echo "ERROR: channel must be one of: stable, alpha, beta, rc (got '$channel')" >&2
    exit 1
    ;;
esac

full="${version}${suffix}"
tag="desktop-v${full}"

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "ERROR: tag $tag already exists" >&2
  exit 1
fi

if ! git diff-index --quiet HEAD --; then
  echo "ERROR: working tree has uncommitted changes; commit or stash first" >&2
  git status --short >&2
  exit 1
fi

echo "→ bumping to $full"

# package.json
node -e "
const fs=require('node:fs');
const p=JSON.parse(fs.readFileSync('package.json','utf8'));
p.version='$full';
fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');
"

# src-tauri/Cargo.toml — only the [package] block's version line.
python3 -c "
import re,sys
p='src-tauri/Cargo.toml'
t=open(p).read()
t2=re.sub(r'(^\[package\][^\[]*?\nversion *= *\")[^\"]+(\")', lambda m: m.group(1)+'$full'+m.group(2), t, flags=re.MULTILINE|re.DOTALL, count=1)
if t==t2:
  print('ERROR: failed to bump src-tauri/Cargo.toml version', file=sys.stderr); sys.exit(1)
open(p,'w').write(t2)
"

# src-tauri/Cargo.lock — bump our package only (re-run cargo so transitive
# version bumps don't ride along).
( cd src-tauri && cargo update -p papercusp-desktop --offline 2>/dev/null || cargo update -p papercusp-desktop ) || true

# src-tauri/tauri.conf.json
node -e "
const fs=require('node:fs');
const p=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
p.version='$full';
fs.writeFileSync('src-tauri/tauri.conf.json',JSON.stringify(p,null,2)+'\n');
"

git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "chore(release): v$full"
git tag -a "$tag" -m "Papercusp Desktop v$full ($channel)"

echo
echo "✓ Tagged $tag on $(git rev-parse HEAD)"
echo
echo "Next:"
echo "  git show HEAD                                  # review the bump commit"
echo "  git push origin main $tag                      # triggers desktop-release workflow"
echo "  gh run watch                                   # follow the matrix build"
echo
if [[ "$channel" != "stable" ]]; then
  echo "Channel: $channel"
  echo "  → users on the '$channel' (or laxer) update channel will see this release"
  echo "    via /api/updates/manifest within 60s of GH releases publishing it."
fi
