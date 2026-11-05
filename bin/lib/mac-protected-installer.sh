#!/usr/bin/env bash
# Native packaging extension for mac-vm-build.sh. The request uses the existing
# independently signed update envelope; the package never invents approval keys.
make_protected_mac_package() ( # app, updater tar.gz, manifest.json, platform, output.pkg
  set -euo pipefail
  [[ $# -eq 5 ]] || { echo 'protected package requires app, archive, manifest, platform, output' >&2; exit 2; }
  local app="$1" archive="$2" manifest="$3" platform="$4" output="$5" work helper
  case "${MAC_INSTALLER_SIGNING_IDENTITY:-}" in
    'Developer ID Installer: '*) ;;
    *) echo 'protected package requires MAC_INSTALLER_SIGNING_IDENTITY (Developer ID Installer)' >&2; exit 1 ;;
  esac
  [[ -d "$app" && ! -L "$app" && -f "$archive" && ! -L "$archive" && -f "$manifest" && ! -L "$manifest" ]] \
    || { echo 'protected package inputs are missing or aliased' >&2; exit 1; }
  helper="$app/Contents/Library/HelperTools/com.papercusp.update-installer"
  [[ -f "$helper" && ! -L "$helper" ]] || { echo 'protected package helper is missing or aliased' >&2; exit 1; }
  for tool in codesign pkgbuild productsign pkgutil python3; do
    command -v "$tool" >/dev/null || { echo "protected package tool missing: $tool" >&2; exit 1; }
  done
  codesign --verify --deep --strict "$app"
  codesign --verify --strict -R 'anchor apple generic and identifier "com.papercusp.update-installer" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists' "$helper"
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  local payload="$work/root/Library/PrivilegedHelperTools" scripts="$work/scripts"
  mkdir -p "$payload/com.papercusp.update-installer.payload" "$scripts"
  install -m 755 "$helper" "$payload/com.papercusp.update-installer"
  python3 - "$app" "$archive" "$manifest" "$platform" "$payload/com.papercusp.update-installer.payload/approved-request" "$work/identity" <<'PY'
import base64, hashlib, json, pathlib, plistlib, struct, sys, tarfile
app, archive, manifest, platform, output, identity = map(pathlib.Path, sys.argv[1:])
platform = str(platform)
if platform not in ('darwin-x86_64', 'darwin-aarch64'):
    raise SystemExit('protected package requires an exact supported Mac platform')
with (app/'Contents/Info.plist').open('rb') as f:
    info = plistlib.load(f)
product, version = info['CFBundleIdentifier'], info['CFBundleShortVersionString']
if product not in ('com.papercusp.gui', 'com.papercusp.server', 'com.papercusp.gui.nightly'):
    raise SystemExit('unsupported protected package product')
if not isinstance(version, str) or not version or any(c not in '0123456789.' for c in version):
    raise SystemExit('invalid protected package version')
if archive.stat().st_size > 1024**3:
    raise SystemExit('protected package artifact is oversized')
artifact = archive.read_bytes()
data = json.loads(manifest.read_bytes())
envelope = data['updateAuthorization']
metadata = json.loads(base64.b64decode(envelope['payload'], validate=True))
if not envelope['signature'] or not envelope['approvalSignature'] or not metadata['authorIds']:
    raise SystemExit('protected package requires attributed independent approval')
expected = dict(product=product, version=version, platform=platform,
                artifactSha256=hashlib.sha256(artifact).hexdigest())
if any(metadata.get(k) != v for k, v in expected.items()):
    raise SystemExit('protected package approval does not match its artifact and identity')
# Bind the administrator-installed helper itself to the approved full archive.
# Never unpack archive paths in this build step.
with tarfile.open(archive, 'r:gz') as tar:
    members = [m for m in tar if m.name.endswith('/Contents/Library/HelperTools/com.papercusp.update-installer')]
    if len(members) != 1 or not members[0].isfile() or members[0].size > 64*1024*1024:
        raise SystemExit('protected package archive helper is missing, ambiguous or aliased')
    if tar.extractfile(members[0]).read() != (app/'Contents/Library/HelperTools/com.papercusp.update-installer').read_bytes():
        raise SystemExit('protected package helper differs from the approved artifact')
header = json.dumps(dict(manifest=data, version=version, product=product, platform=platform), separators=(',', ':')).encode()
if len(header) > 65536:
    raise SystemExit('protected package approval header is oversized')
pathlib.Path(output).write_bytes(struct.pack('>IQ', len(header), len(artifact)) + header + artifact)
pathlib.Path(identity).write_text(product + '\n' + version + '\n')
PY
  chmod 644 "$payload/com.papercusp.update-installer.payload/approved-request"
  # Installer scripts run on the supported 10.15 floor without Python or Node.
  cat >"$scripts/preinstall" <<'SH'
#!/bin/sh
set -eu
export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
[ "${3:-/}" = / ] || { echo 'protected Mac package requires the startup volume' >&2; exit 1; }
for p in /Library /Library/PrivilegedHelperTools /Library/PrivilegedHelperTools/com.papercusp.update-installer.payload; do
  [ ! -L "$p" ] || exit 1
  if [ -e "$p" ]; then
    [ -d "$p" ] && [ "$(/usr/bin/stat -f %u "$p")" = 0 ] || exit 1
    case "$(/usr/bin/stat -f %Lp "$p")" in 755|750|700) ;; *) exit 1 ;; esac
    if /bin/ls -lde "$p" | /usr/bin/grep -q ' allow '; then exit 1; fi
  fi
done
for p in /Library/PrivilegedHelperTools/com.papercusp.update-installer /Library/PrivilegedHelperTools/com.papercusp.update-installer.payload/approved-request; do
  [ ! -L "$p" ] || exit 1
  if [ -e "$p" ]; then
    [ -f "$p" ] && [ "$(/usr/bin/stat -f %u "$p")" = 0 ] && [ "$(/usr/bin/stat -f %l "$p")" = 1 ] || exit 1
    case "$(/usr/bin/stat -f %Lp "$p")" in 755|750|700|644|640|600) ;; *) exit 1 ;; esac
    if /bin/ls -lde "$p" | /usr/bin/grep -q ' allow '; then exit 1; fi
  fi
done
SH
  cat >"$scripts/postinstall" <<'SH'
#!/bin/sh
set -eu
export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
[ "${3:-/}" = / ] || exit 1
/Library/PrivilegedHelperTools/com.papercusp.update-installer --provision
/bin/rm /Library/PrivilegedHelperTools/com.papercusp.update-installer.payload/approved-request
SH
  chmod 755 "$scripts/preinstall" "$scripts/postinstall"
  local product version
  product="$(sed -n '1p' "$work/identity")"; version="$(sed -n '2p' "$work/identity")"
  pkgbuild --root "$work/root" --install-location / --ownership recommended \
    --scripts "$scripts" --identifier "$product.protected-installer" --version "$version" "$work/unsigned.pkg"
  productsign --sign "$MAC_INSTALLER_SIGNING_IDENTITY" "$work/unsigned.pkg" "$work/signed.pkg"
  pkgutil --check-signature "$work/signed.pkg"
  mkdir -p "$(dirname "$output")"
  cp "$work/signed.pkg" "$output"
)
