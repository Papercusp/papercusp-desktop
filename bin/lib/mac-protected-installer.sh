#!/usr/bin/env bash
# Native packaging extension for mac-vm-build.sh. The request uses the existing
# independently signed update envelope; the package never invents approval keys.

# These ADMINISTRATOR operations must themselves be delivered through an already
# trusted management channel (for example MDM or authenticated administrator SSH).
# Never source this library from a candidate package, or obtain the expected
# hashes/Team ID from that package. The explicit arguments are administrator
# authorization, not a substitute for independently authenticated review records.
mac_protected_admin_directory() {
  local p="$1"
  [[ -d "$p" && ! -L "$p" && "$(/usr/bin/stat -f %u "$p")" == 0 ]] || return 1
  case "$(/usr/bin/stat -f %Lp "$p")" in 755|750|700) ;; *) return 1 ;; esac
  # On the 10.15 floor, reject ACL grants as well as POSIX write permission.
  local acl
  acl="$(/bin/ls -lde "$p")" || return 1
  ! /usr/bin/grep -q ' allow ' <<<"$acl"
}

mac_protected_admin_stage() {
  [[ "$(/usr/bin/uname -s)" == Darwin && "$(/usr/bin/id -u)" == 0 ]] || {
    echo 'protected Mac administration requires a trusted root management channel on macOS' >&2; return 1;
  }
  local p
  for p in / /private /private/var /private/var/root; do
    mac_protected_admin_directory "$p" || { echo "unprotected administrator ancestor: $p" >&2; return 1; }
  done
  /usr/bin/mktemp -d /private/var/root/papercusp-administrator.XXXXXXXX
}

mac_protected_admin_hash() {
  local actual
  [[ "$2" =~ ^[0-9a-f]{64}$ ]] || { echo 'an independently supplied exact SHA256 is required' >&2; return 1; }
  actual="$(/usr/bin/shasum -a 256 "$1")" || return 1
  [[ "${actual%% *}" == "$2" ]] || { echo 'administrator-approved SHA256 mismatch' >&2; return 1; }
}

bootstrap_protected_mac_verifier() ( # helper, policy, approved-helper-sha, approved-policy-sha, Apple Team ID
  set -euo pipefail
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
  umask 077
  [[ $# -eq 5 && "$5" =~ ^[A-Z0-9]{10}$ ]] || {
    echo 'bootstrap requires helper, policy, independently approved helper/policy SHA256 and pinned Apple Team ID' >&2; exit 2;
  }
  [[ -f "$1" && ! -L "$1" && -f "$2" && ! -L "$2" ]] || exit 1
  local work p helper=/Library/PrivilegedHelperTools/com.papercusp.update-installer
  local policy=/private/etc/papercusp/managed-policy.json
  work="$(mac_protected_admin_stage)"
  trap 'rm -rf "$work"' EXIT
  # Hash the private COPIES, then install those same bytes. Input paths may be
  # user-writable; a later swap cannot change what gets verified or installed.
  /bin/cat < "$1" > "$work/helper"
  /bin/cat < "$2" > "$work/policy"
  mac_protected_admin_hash "$work/helper" "$3"
  mac_protected_admin_hash "$work/policy" "$4"
  /bin/chmod 755 "$work/helper"
  /usr/bin/codesign --verify --strict -R "anchor apple generic and identifier \"com.papercusp.update-installer\" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"$5\"" "$work/helper"
  for p in /Library /private/etc; do
    mac_protected_admin_directory "$p" || { echo "unprotected bootstrap ancestor: $p" >&2; exit 1; }
  done
  for p in /Library/PrivilegedHelperTools /private/etc/papercusp; do
    if [[ ! -e "$p" && ! -L "$p" ]]; then /bin/mkdir -m 755 "$p"; fi
    mac_protected_admin_directory "$p" || { echo "unprotected bootstrap directory: $p" >&2; exit 1; }
  done
  [[ ! -e "$helper" && ! -L "$helper" && ! -e "$policy" && ! -L "$policy" ]] || {
    echo 'administrator baseline already exists; bootstrap never replaces trust' >&2; exit 1;
  }
  /bin/chmod 644 "$work/policy"
  # Exclusive links cannot overwrite a baseline installed concurrently. A
  # failed second link can leave only the approved policy, never an unapproved
  # verifier. A subsequent bootstrap refuses that partial baseline for repair.
  /bin/ln "$work/policy" "$policy"
  /bin/ln "$work/helper" "$helper"
  /bin/rm "$work/policy" "$work/helper"
  /bin/sync
  echo 'Administrator-approved initial verifier and policy provisioned.'
)

install_protected_mac_package() ( # package, independently approved package sha, Apple Team ID
  set -euo pipefail
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
  umask 077
  [[ $# -eq 3 && "$3" =~ ^[A-Z0-9]{10}$ ]] || {
    echo 'install requires package, independently approved outer-package SHA256 and pinned Apple Team ID' >&2; exit 2;
  }
  [[ -f "$1" && ! -L "$1" ]] || exit 1
  local work assessment
  work="$(mac_protected_admin_stage)"
  trap 'rm -rf "$work"' EXIT
  /bin/cat < "$1" > "$work/candidate.pkg"
  mac_protected_admin_hash "$work/candidate.pkg" "$2"
  /usr/sbin/pkgutil --check-signature "$work/candidate.pkg"
  assessment="$(/usr/sbin/spctl --assess --type install --verbose=2 "$work/candidate.pkg" 2>&1)" || {
    printf '%s\n' "$assessment" >&2; exit 1;
  }
  /usr/bin/grep -Eq "^origin=Developer ID Installer: .+ \\($3\\)$" <<<"$assessment" || {
    echo 'installer signature does not match the administrator-pinned Apple Team ID' >&2; exit 1;
  }
  # Approval binds the OUTER package, including root scripts. Inner archive
  # signatures alone cannot authorize an Installer script. Execute the same
  # private staged inode that was hashed and assessed, never the input path.
  /usr/sbin/installer -pkg "$work/candidate.pkg" -target /
)

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
  local scripts="$work/scripts"
  mkdir -p "$scripts"
  # No package payload may replace the verifier before independent approval.
  # The administrator establishes the first trusted helper separately, alongside
  # managed policy. This candidate package cannot establish its own trust root.
  python3 - "$app" "$archive" "$manifest" "$platform" "$scripts/approved-request" "$work/identity" <<'PY'
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
  chmod 644 "$scripts/approved-request"
  # Installer scripts run on the supported 10.15 floor without Python or Node.
  cat >"$scripts/preinstall" <<'SH'
#!/bin/sh
set -eu
export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
[ "${3:-/}" = / ] || { echo 'protected Mac package requires the startup volume' >&2; exit 1; }
for p in / /Library /Library/PrivilegedHelperTools; do
  [ ! -L "$p" ] || exit 1
  if [ -e "$p" ]; then
    [ -d "$p" ] && [ "$(/usr/bin/stat -f %u "$p")" = 0 ] || exit 1
    case "$(/usr/bin/stat -f %Lp "$p")" in 755|750|700) ;; *) exit 1 ;; esac
    if /bin/ls -lde "$p" | /usr/bin/grep -q ' allow '; then exit 1; fi
  fi
done
for p in /Library/PrivilegedHelperTools/com.papercusp.update-installer; do
  [ ! -L "$p" ] || exit 1
  if [ -e "$p" ]; then
    [ -f "$p" ] && [ "$(/usr/bin/stat -f %u "$p")" = 0 ] && [ "$(/usr/bin/stat -f %l "$p")" = 1 ] || exit 1
    case "$(/usr/bin/stat -f %Lp "$p")" in 755|750|700) ;; *) exit 1 ;; esac
    if /bin/ls -lde "$p" | /usr/bin/grep -q ' allow '; then exit 1; fi
  else
    echo 'Administrator must first provision the independently trusted Papercusp verifier and managed policy; a candidate package cannot bootstrap its own verifier.' >&2
    exit 1
  fi
done
SH
  cat >"$scripts/postinstall" <<'SH'
#!/bin/sh
set -eu
export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
[ "${3:-/}" = / ] || exit 1
# Installer supplies this script resource; it is data, never an executable.
# The installed verifier owns the current-trust lock through both replacements.
scripts=$(/usr/bin/dirname "$0")
/Library/PrivilegedHelperTools/com.papercusp.update-installer --provision < "$scripts/approved-request"
SH
  chmod 755 "$scripts/preinstall" "$scripts/postinstall"
  local product version
  product="$(sed -n '1p' "$work/identity")"; version="$(sed -n '2p' "$work/identity")"
  pkgbuild --nopayload \
    --scripts "$scripts" --identifier "$product.protected-installer" --version "$version" "$work/unsigned.pkg"
  productsign --sign "$MAC_INSTALLER_SIGNING_IDENTITY" "$work/unsigned.pkg" "$work/signed.pkg"
  pkgutil --check-signature "$work/signed.pkg"
  mkdir -p "$(dirname "$output")"
  cp "$work/signed.pkg" "$output"
)
