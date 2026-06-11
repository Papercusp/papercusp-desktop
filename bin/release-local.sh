#!/usr/bin/env bash
# Build + sign + publish a Papercusp desktop release WITHOUT GitHub
# Actions. Run on this Linux box; produces a Linux x86_64 build by
# default, with cross-compile hooks for other targets.
#
# Outputs go to a GitHub Release named after the tag. Auth uses your
# local `gh` CLI session (no PAT needed — this is interactive auth).
#
# Usage:
#   bin/release-local.sh 0.0.2 stable     # tag + channel
#   bin/release-local.sh 0.0.3 beta
#   bin/release-local.sh 0.0.4 alpha
#
# What it does:
#   1. Bumps version in package.json + Cargo.toml + tauri.conf.json
#   2. Builds the sidecar (papercup/apps/operator → src-tauri/sidecar/)
#   3. cargo + Tauri build (signs with ~/.papercusp/signing/papercusp.key)
#   4. Generates latest.json manifest
#   5. Pushes the version-bump commit + tag to origin
#   6. Creates GitHub Release with all artifacts attached
#
# Optional platform legs:
#   - macOS  : WITH_MAC=1 — drives the macOS build VM over SSH
#              (universal binary, UNSIGNED by Apple — D-002/D-006 of
#              mac-desktop-release-readiness-2026-06-11; updater
#              artifacts are still minisign-signed). VM must be up
#              (SSH :2222, see /internal/docs/build-system/vms).
#   - Windows: cross-compile is possible but requires setup; left as
#              an opt-in via WITH_WINDOWS=1
#   - arm64  : ditto via WITH_ARM64=1
#
# Re-run safety: idempotent. If a release for the tag exists, asset
# uploads use `gh release upload --clobber`.

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <version> <channel: alpha|beta|stable>"
  exit 1
fi

VERSION="$1"
CHANNEL="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
KEY_FILE="${HOME}/.papercusp/signing/papercusp.key"
KEY_PUB="${HOME}/.papercusp/signing/papercusp.key.pub"
WITH_WINDOWS="${WITH_WINDOWS:-0}"
WITH_ARM64="${WITH_ARM64:-0}"
WITH_MAC="${WITH_MAC:-0}"
MAC_VM_SSH=(ssh -i "${HOME}/.ssh/papercup-vm-mac" -p 2222 -o BatchMode=yes aviweiss@127.0.0.1)
MAC_VM_BUILD_DIR="papercup-build-mac/papercup"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.-]+)?$ ]]; then
  echo "ERROR: version must look like X.Y.Z or X.Y.Z-foo"
  exit 1
fi

case "$CHANNEL" in
  alpha|beta|stable) ;;
  *) echo "ERROR: channel must be alpha|beta|stable"; exit 1 ;;
esac

# Tag convention matches the operator's manifest classifier
# (apps/operator/app/api/updates/manifest/route.ts):
#   alpha  → desktop-vX.Y.Z-alpha
#   beta   → desktop-vX.Y.Z-beta
#   stable → desktop-vX.Y.Z
case "$CHANNEL" in
  alpha)  TAG="desktop-v${VERSION}-alpha" ;;
  beta)   TAG="desktop-v${VERSION}-beta" ;;
  stable) TAG="desktop-v${VERSION}" ;;
esac

echo "==> version=$VERSION channel=$CHANNEL tag=$TAG"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "ERROR: signing key not found at $KEY_FILE"
  echo "       Run bin/setup-signing-key.sh first."
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: 'gh' CLI not on PATH — install from cli.github.com"
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: 'gh' not authenticated — run 'gh auth login'"
  exit 1
fi

# Refuse to publish from a dirty tree on stable/beta. On alpha we
# allow it for fast iteration.
if [[ "$CHANNEL" != "alpha" ]]; then
  if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
    echo "ERROR: tree dirty — commit or stash before a $CHANNEL release"
    git -C "$ROOT" status --short
    exit 1
  fi
fi

echo "==> bumping version in manifests"
python3 - "$VERSION" "$ROOT" <<'PY'
import json, sys, re, pathlib
version, root = sys.argv[1], pathlib.Path(sys.argv[2])

pkg = root / "package.json"
if pkg.exists():
    d = json.loads(pkg.read_text())
    d["version"] = version
    pkg.write_text(json.dumps(d, indent=2) + "\n")
    print(f"  package.json → {version}")

tauri_conf = root / "src-tauri" / "tauri.conf.json"
d = json.loads(tauri_conf.read_text())
d["version"] = version
tauri_conf.write_text(json.dumps(d, indent=2) + "\n")
print(f"  tauri.conf.json → {version}")

cargo = root / "src-tauri" / "Cargo.toml"
text = cargo.read_text()
text = re.sub(r'(?m)^version = "[^"]+"', f'version = "{version}"', text, count=1)
cargo.write_text(text)
print(f"  Cargo.toml → {version}")
PY

echo "==> building sidecar"
bash "$ROOT/bin/build-desktop-sidecar.sh"

echo "==> building Tauri Linux x86_64 (signed)"
export TAURI_SIGNING_PRIVATE_KEY_PATH="$KEY_FILE"
# Empty passphrase by default. If the user set one at keygen time
# they should `export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=...` before
# running this script.
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

# Tauri CLI does the platform-native bundling + signing in one shot.
(cd "$ROOT" && npx --yes -p @tauri-apps/cli@latest tauri build)

LINUX_BUNDLE="$ROOT/src-tauri/target/release/bundle"
if [[ ! -d "$LINUX_BUNDLE" ]]; then
  echo "ERROR: expected bundles at $LINUX_BUNDLE — Tauri build failed?"
  exit 1
fi

ARTIFACTS=()
for f in "$LINUX_BUNDLE"/deb/*.deb "$LINUX_BUNDLE"/appimage/*.AppImage \
         "$LINUX_BUNDLE"/appimage/*.AppImage.sig "$LINUX_BUNDLE"/deb/*.deb.sig; do
  [[ -f "$f" ]] && ARTIFACTS+=("$f")
done

if [[ "$WITH_WINDOWS" == "1" ]]; then
  echo "==> building Windows x86_64 (cross via cross-rs)"
  (cd "$ROOT" && npx --yes -p @tauri-apps/cli@latest tauri build --target x86_64-pc-windows-gnu)
  for f in "$ROOT"/src-tauri/target/x86_64-pc-windows-gnu/release/bundle/{msi,nsis}/*.{msi,exe,sig}; do
    [[ -f "$f" ]] && ARTIFACTS+=("$f")
  done
fi
if [[ "$WITH_ARM64" == "1" ]]; then
  echo "==> building Linux arm64 (cross)"
  (cd "$ROOT" && npx --yes -p @tauri-apps/cli@latest tauri build --target aarch64-unknown-linux-gnu)
  for f in "$ROOT"/src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/{deb,appimage}/*; do
    [[ -f "$f" ]] && ARTIFACTS+=("$f")
  done
fi
if [[ "$WITH_MAC" == "1" ]]; then
  echo "==> building macOS universal on the build VM"
  if ! "${MAC_VM_SSH[@]}" 'true' 2>/dev/null; then
    echo "ERROR: mac VM unreachable on :2222 — boot it first (see /internal/docs/build-system/vms)"
    exit 1
  fi
  PAPERCUP_TREE="$(cd "$ROOT/.." && pwd)"
  echo "    rsync tree → VM:$MAC_VM_BUILD_DIR"
  rsync -az --delete --exclude '.git' --exclude 'node_modules' --exclude 'target' \
    --exclude '.turbo' --exclude '.next' \
    -e "ssh -i ${HOME}/.ssh/papercup-vm-mac -p 2222 -o BatchMode=yes" \
    "$PAPERCUP_TREE/" "aviweiss@127.0.0.1:$MAC_VM_BUILD_DIR/"
  scp -i "${HOME}/.ssh/papercup-vm-mac" -P 2222 -o BatchMode=yes \
    "$KEY_FILE" aviweiss@127.0.0.1:.papercusp-updater.key
  "${MAC_VM_SSH[@]}" 'chmod 600 .papercusp-updater.key; bash -lc "
    cd '"$MAC_VM_BUILD_DIR"'/papercusp-desktop || exit 1
    npm install --legacy-peer-deps >/tmp/mac-release-install.log 2>&1 || { tail -20 /tmp/mac-release-install.log; exit 1; }
    export TAURI_SIGNING_PRIVATE_KEY_PATH=\$HOME/.papercusp-updater.key
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
    bash bin/mac-vm-build.sh
  "'
  MAC_BUNDLE_VM="$MAC_VM_BUILD_DIR/papercusp-desktop/src-tauri/target/universal-apple-darwin/release/bundle"
  MAC_OUT="$ROOT/src-tauri/target/universal-apple-darwin/release/bundle"
  mkdir -p "$MAC_OUT/dmg" "$MAC_OUT/macos"
  scp -i "${HOME}/.ssh/papercup-vm-mac" -P 2222 -o BatchMode=yes \
    "aviweiss@127.0.0.1:$MAC_BUNDLE_VM/dmg/*.dmg" "$MAC_OUT/dmg/" || true
  scp -i "${HOME}/.ssh/papercup-vm-mac" -P 2222 -o BatchMode=yes \
    "aviweiss@127.0.0.1:$MAC_BUNDLE_VM/macos/*.app.tar.gz" \
    "aviweiss@127.0.0.1:$MAC_BUNDLE_VM/macos/*.app.tar.gz.sig" "$MAC_OUT/macos/" || true
  mac_found=0
  for f in "$MAC_OUT"/dmg/*.dmg "$MAC_OUT"/macos/*.app.tar.gz "$MAC_OUT"/macos/*.app.tar.gz.sig; do
    [[ -f "$f" ]] && ARTIFACTS+=("$f") && mac_found=1
  done
  if [[ "$mac_found" != "1" ]]; then
    echo "ERROR: WITH_MAC=1 but no mac artifacts came back from the VM"
    exit 1
  fi
  bash "$ROOT/bin/audit-bundle.sh" "$MAC_OUT"/dmg/*.dmg
fi

echo "==> generating latest.json"
LATEST_JSON="/tmp/papercusp-latest-${TAG}.json"
NOTES_FILE="/tmp/papercusp-notes-${TAG}.md"

python3 - "$VERSION" "$CHANNEL" "$TAG" "$LATEST_JSON" "$NOTES_FILE" "${ARTIFACTS[@]}" <<'PY'
import json, sys, pathlib, hashlib
version, channel, tag, out_path, notes_path = sys.argv[1:6]
artifacts = [pathlib.Path(p) for p in sys.argv[6:]]

def repo_url(name: str) -> str:
    return f"https://github.com/Papercusp/papercusp-desktop/releases/download/{tag}/{name}"

# Map (platform, arch, ext) → (url, signature). The operator's
# /api/updates/manifest already converts this latest.json to the
# Tauri updater's wire format, so what we publish here is the
# canonical truth.
platforms = {}
def add(platform_key, bin_path, sig_path):
    sig = sig_path.read_text().strip() if sig_path.exists() else ""
    platforms[platform_key] = {
        "signature": sig,
        "url": repo_url(bin_path.name),
    }

# Linux x86_64 — pick AppImage as the updater format
for art in artifacts:
    if art.suffix == ".AppImage":
        sig = art.with_suffix(art.suffix + ".sig")
        add("linux-x86_64", art, sig)
    if art.name.endswith("-amd64.msi"):
        sig = art.with_suffix(".msi.sig")
        add("windows-x86_64", art, sig)
    if "aarch64" in str(art) and art.suffix == ".AppImage":
        sig = art.with_suffix(".AppImage.sig")
        add("linux-aarch64", art, sig)
    # macOS universal .app.tar.gz serves BOTH darwin arches (D-006)
    if art.name.endswith(".app.tar.gz"):
        sig = pathlib.Path(str(art) + ".sig")
        add("darwin-x86_64", art, sig)
        add("darwin-aarch64", art, sig)

manifest = {
    "version": version,
    "channel": channel,
    "notes": f"Papercusp desktop {version} ({channel}). See release notes.",
    "pub_date": __import__("datetime").datetime.utcnow().isoformat(timespec="seconds") + "Z",
    "platforms": platforms,
}
pathlib.Path(out_path).write_text(json.dumps(manifest, indent=2) + "\n")

# Brief release notes
lines = [
    f"# Papercusp desktop {version} — {channel}",
    "",
    f"Channel: **{channel}**",
    "",
    "## Artifacts",
]
for a in artifacts:
    sha = hashlib.sha256(a.read_bytes()).hexdigest()[:12] if a.is_file() else ""
    lines.append(f"- `{a.name}`  ({a.stat().st_size // 1024} KB, sha256:{sha}…)")
pathlib.Path(notes_path).write_text("\n".join(lines) + "\n")
print(f"manifest: {out_path}")
print(f"notes:    {notes_path}")
PY

echo "==> committing version bump"
git -C "$ROOT" add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git -C "$ROOT" commit -m "release: $TAG" 2>&1 | tail -3 || echo "(nothing to commit)"

echo "==> tagging $TAG"
git -C "$ROOT" tag -f "$TAG"
git -C "$ROOT" push origin HEAD "$TAG"

echo "==> creating GitHub Release $TAG"
# Use --prerelease for alpha + beta so the manifest classifier can
# scope subscribers correctly.
PRERELEASE_FLAG=""
if [[ "$CHANNEL" != "stable" ]]; then
  PRERELEASE_FLAG="--prerelease"
fi

if gh release view "$TAG" --repo Papercusp/papercusp-desktop >/dev/null 2>&1; then
  echo "    release exists; uploading artifacts with --clobber"
  gh release upload "$TAG" "${ARTIFACTS[@]}" "$LATEST_JSON" --repo Papercusp/papercusp-desktop --clobber
else
  gh release create "$TAG" "${ARTIFACTS[@]}" "$LATEST_JSON" \
    --repo Papercusp/papercusp-desktop \
    --title "Papercusp desktop $VERSION ($CHANNEL)" \
    --notes-file "$NOTES_FILE" \
    $PRERELEASE_FLAG
fi

echo
echo "==> done"
echo "    tag:     $TAG"
echo "    release: https://github.com/Papercusp/papercusp-desktop/releases/tag/$TAG"
echo "    artifacts: ${#ARTIFACTS[@]}"
