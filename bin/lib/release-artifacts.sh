#!/usr/bin/env bash
# release-artifacts.sh — the SINGLE source of truth for "which files make up this
# desktop cut", shared by the two halves of the release pipeline (EI-12913).
#
# THE BUG THIS FIXES: release-local.sh (the BUILD half) and upload-release.sh
# (the PUBLISH half) each decided INDEPENDENTLY which files were "this cut's
# artifacts", and the two decisions DRIFTED:
#   - release-local.sh globs
#     $ROOT/src-tauri/target/windows-vm/bundle/inno/*_<ver>_* — the real Inno
#     output tree — catching the -setup.exe, its .sig, AND the DiskSpanning .bin
#     slices. (A Server installer's ~4 GB payload lives ENTIRELY in those .bin
#     slices: src-tauri/windows/inno/papercusp.iss sets DiskSpanning=yes, so the
#     .exe is a ~3.6 MB stub that is useless without the .bin files next to it.)
#   - upload-release.sh re-derived its OWN set with a `find` over
#     ~/.cargo-target/release/bundle/{deb,appimage,dmg,macos,nsis,msi} — which has
#     no `inno` dir at all and still names `nsis`, the retired packager — plus an
#     extension allowlist that EXCLUDED `.bin`. So it could not see the windows
#     artifacts, and even where it could it would have dropped every Server .bin
#     slice — publishing a stub whose payload is missing (Inno then prompts for
#     the absent slices and the install fails).
# Two scripts, two globs, one drifts → the LABELED != PACKED failure class. The
# durable fix is to STOP re-deriving: release-local.sh (which already computes the
# correct set) WRITES it here, and upload-release.sh READS it — one list, no drift.
# Fixing only the `.bin` regex would leave the wrong-tree gap armed for the next
# packager change; sharing the list closes the whole class.
#
# The manifest lives next to latest.json in /tmp (same TAG-scoped, same ephemeral
# lifecycle: if one is gone the other is, and you re-cut anyway).

# release_artifacts_manifest_path <tag> — the manifest file path for a cut.
release_artifacts_manifest_path() {
  printf '/tmp/papercusp-artifacts-%s.txt\n' "$1"
}

# release_artifacts_cut_start_path <tag> — the cut-start freshness stamp shared
# by release-local.sh, direct platform producers, incremental publishing, and
# upload.  Keep it beside the artifact manifest in /tmp: both are tag-scoped
# hand-off state, and a missing stamp must fail closed rather than silently
# accepting a same-version artifact left by a failed earlier cut.
release_artifacts_cut_start_path() {
  printf '/tmp/papercusp-cut-start-%s.txt\n' "$1"
}

release_artifacts_cut_start_now_ns() {
  local now
  now="$(date -u +%s%N 2>/dev/null || true)"
  if [[ "$now" =~ ^[0-9]{19}$ ]]; then
    printf '%s\n' "$now"
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import time; print(time.time_ns())'
    return $?
  fi
  # Last-resort portability fallback for a host with neither GNU date nor
  # Python.  It intentionally has second precision and therefore fails closed
  # for artifacts whose mtime lands in the same second as the cut start.
  now="$(date -u +%s 2>/dev/null || true)"
  [[ "$now" =~ ^[0-9]+$ ]] || {
    echo "release-artifacts: cannot obtain a UTC cut-start timestamp." >&2
    return 1
  }
  printf '%s000000000\n' "$now"
}

# release_artifacts_cut_start_write <tag> [epoch-ns] — atomically replace the
# tag's start stamp and print the value exported to child producers.
release_artifacts_cut_start_write() {
  local tag="${1:-}" stamp="${2:-}" path tmp
  [[ -n "$tag" ]] || { echo "release-artifacts: cut-start stamp requires a tag." >&2; return 2; }
  [[ -n "$stamp" ]] || stamp="$(release_artifacts_cut_start_now_ns)" || return 1
  [[ "$stamp" =~ ^[0-9]+$ ]] || {
    echo "release-artifacts: malformed cut-start timestamp '$stamp'." >&2
    return 2
  }
  path="$(release_artifacts_cut_start_path "$tag")"
  tmp="$(mktemp "${path}.tmp.XXXXXX")" || {
    echo "release-artifacts: could not create temporary cut-start stamp for $tag." >&2
    return 1
  }
  if ! printf '%s\n' "$stamp" > "$tmp" || ! mv -f "$tmp" "$path"; then
    rm -f "$tmp"
    echo "release-artifacts: could not persist cut-start stamp at $path." >&2
    return 1
  fi
  printf '%s\n' "$stamp"
}

# release_artifacts_cut_start_read <tag> — read one valid epoch-ns stamp. A
# missing, multi-line, or malformed stamp is an error; callers must not mint a
# replacement while deciding whether an existing artifact is safe to publish.
release_artifacts_cut_start_read() {
  local tag="${1:-}" path stamp
  local -a lines=()
  [[ -n "$tag" ]] || { echo "release-artifacts: cut-start stamp requires a tag." >&2; return 2; }
  path="$(release_artifacts_cut_start_path "$tag")"
  [[ -f "$path" ]] || {
    echo "release-artifacts: no cut-start stamp at $path — refusing to trust same-version artifacts." >&2
    return 1
  }
  mapfile -t lines < "$path" || {
    echo "release-artifacts: could not read cut-start stamp at $path." >&2
    return 1
  }
  [[ ${#lines[@]} -eq 1 ]] || {
    echo "release-artifacts: malformed cut-start stamp at $path — expected one epoch-ns value." >&2
    return 1
  }
  stamp="${lines[0]}"
  [[ "$stamp" =~ ^[0-9]+$ ]] || {
    echo "release-artifacts: malformed cut-start stamp at $path — expected epoch nanoseconds." >&2
    return 1
  }
  printf '%s\n' "$stamp"
}

# release_artifacts_cut_start_ensure <tag> — preserve an existing valid cut
# start for incremental platform additions; create one only for a first-class
# direct producer/publish path that has no prior stamp. Never overwrite a
# malformed existing stamp: that would turn a fail-closed hand-off into a pass.
release_artifacts_cut_start_ensure() {
  local tag="${1:-}" path
  [[ -n "$tag" ]] || { echo "release-artifacts: cut-start stamp requires a tag." >&2; return 2; }
  path="$(release_artifacts_cut_start_path "$tag")"
  if [[ -e "$path" ]]; then
    release_artifacts_cut_start_read "$tag"
  else
    release_artifacts_cut_start_write "$tag"
  fi
}

# release_artifacts_assert_fresh <tag> [artifact...] — fail closed unless each
# supplied artifact was written STRICTLY AFTER this cut's start. With no
# explicit artifact list, inspect every path recorded in the tag manifest,
# including missing paths (release_artifacts_read intentionally filters those
# for its legacy caller contract). Incremental publishing passes only its NEW
# artifacts so already-live platforms remain valid against their original cut.
release_artifacts_assert_fresh() {
  local tag="${1:-}" stamp manifest line
  shift || true
  [[ -n "$tag" ]] || { echo "release-artifacts: freshness check requires a tag." >&2; return 2; }
  stamp="$(release_artifacts_cut_start_read "$tag")" || return 1

  local -a artifacts=("$@")
  if [[ ${#artifacts[@]} -eq 0 ]]; then
    manifest="$(release_artifacts_manifest_path "$tag")"
    [[ -f "$manifest" ]] || {
      echo "release-artifacts: no artifact manifest at $manifest to freshness-check." >&2
      return 1
    }
    while IFS= read -r line; do
      [[ -n "$line" ]] && artifacts+=("$line")
    done < "$manifest"
  fi
  [[ ${#artifacts[@]} -gt 0 ]] || {
    echo "release-artifacts: no artifacts to freshness-check for $tag." >&2
    return 1
  }

  python3 - "$stamp" "${artifacts[@]}" <<'PY'
import datetime
import os
import sys

start = int(sys.argv[1])
missing = []
stale = []
for path in sys.argv[2:]:
    try:
        mtime = os.stat(path).st_mtime_ns
    except FileNotFoundError:
        missing.append(path)
        continue
    except OSError as exc:
        missing.append(f"{path} ({exc})")
        continue
    if mtime <= start:
        stale.append((path, mtime))

def utc(ns):
    return datetime.datetime.fromtimestamp(ns / 1_000_000_000, datetime.timezone.utc).isoformat()

if missing or stale:
    print(f"release-artifacts: freshness check FAILED for cut start {utc(start)}", file=sys.stderr)
    for path in missing:
        print(f"  missing/unreadable: {path}", file=sys.stderr)
    for path, mtime in stale:
        print(f"  stale (mtime {utc(mtime)} is not after cut start): {path}", file=sys.stderr)
    raise SystemExit(1)

print(f"release-artifacts: freshness check passed ({len(sys.argv) - 2} artifact(s) after {utc(start)})")
PY
}

# release_artifacts_assert_baked_host_from_bytes <base> <artifact...> — derive
# the baked update prefix from the bytes being published. This is the proof leg
# that keeps a repack/re-publish honest: it does not need a fresh build and it
# never accepts a hand-written build-provenance record as evidence.
release_artifacts_assert_baked_host_from_bytes() {
  local base="${1:-}"; shift || true
  [[ -n "$base" && $# -gt 0 ]] || {
    echo "release-artifacts: byte host proof requires a publish base and artifacts." >&2
    return 2
  }

  base="${base%/}"
  local expected_fp expected_authority
  expected_fp="$(printf '%s' "$base" | sha256sum | cut -d' ' -f1)"
  expected_authority="$(printf '%s' "$base" | sed -En 's#^https?://([^/]+).*$#\1#p')"
  local expected_path
  expected_path="$(printf '%s' "$base" | sed -E 's#^https?://[^/]+##; s#/$##')"
  [[ "$base" =~ ^https?://[^/]+/.+ && -n "$expected_authority" && -n "$expected_path" ]] || {
    echo "release-artifacts: byte host proof requires an https/http publish base." >&2
    return 2
  }

  RELEASE_HOST_PROOF_EXPECTED_FP="$expected_fp" \
  RELEASE_HOST_PROOF_EXPECTED_AUTHORITY="$expected_authority" \
  RELEASE_HOST_PROOF_EXPECTED_PATH="$expected_path" \
    python3 - "$@" <<'PY'
import hashlib
import os
import re
import shutil
import subprocess
import sys
import zipfile
from urllib.parse import urlsplit

EXPECTED_FP = os.environ["RELEASE_HOST_PROOF_EXPECTED_FP"]
EXPECTED_AUTHORITY = os.environ["RELEASE_HOST_PROOF_EXPECTED_AUTHORITY"].lower()
EXPECTED_PATH = os.environ["RELEASE_HOST_PROOF_EXPECTED_PATH"].rstrip("/")
EXPECTED_HOST = (urlsplit(f"https://{EXPECTED_AUTHORITY}").hostname or "").lower()

URL_RE = re.compile(
    rb"https?://[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]{1,5})?"
    rb"(?:/[A-Za-z0-9._~!$&'()*+,;=:@%\-]+)+"
)
CHUNK = 1024 * 1024
CARRY = 4096


def release_host_prefix(raw):
    try:
        value = raw.decode("ascii")
    except UnicodeDecodeError:
        return None
    value = value.rstrip(".,;:)]}\"'")
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    path = parsed.path.rstrip("/")
    if path.endswith("/latest.json"):
        path = path[: -len("/latest.json")].rstrip("/")
    if not path:
        return None
    return f"{parsed.scheme.lower()}://{parsed.netloc}{path}"


def is_release_like(prefix):
    parsed = urlsplit(prefix)
    authority = parsed.netloc.lower()
    host = (parsed.hostname or "").lower()
    path = parsed.path.rstrip("/")
    return (
        authority == EXPECTED_AUTHORITY
        or host == EXPECTED_HOST
        or host.endswith(".r2.dev")
        or host.endswith(".r2.cloudflarestorage.com")
        or path == EXPECTED_PATH
        or path.startswith(f"{EXPECTED_PATH}/")
    )


def scan_stream(stream, found):
    carry = b""
    while True:
        chunk = stream.read(CHUNK)
        if not chunk:
            return
        data = carry + chunk
        for match in URL_RE.finditer(data):
            prefix = release_host_prefix(match.group(0))
            if prefix and is_release_like(prefix):
                found.add(prefix)
        carry = data[-CARRY:]


def scan_process(command, found):
    try:
        proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    except OSError:
        return False
    try:
        scan_stream(proc.stdout, found)
    finally:
        proc.stdout.close()
    return proc.wait() == 0


def scan_artifact(path):
    found = set()
    errors = []
    try:
        with open(path, "rb") as stream:
            scan_stream(stream, found)
    except OSError as exc:
        return found, [str(exc)]

    lower = path.lower()
    if lower.endswith(".deb"):
        if not shutil.which("dpkg-deb") or not shutil.which("tar"):
            errors.append("deb payload scanner unavailable")
        else:
            try:
                deb = subprocess.Popen(
                    ["dpkg-deb", "--fsys-tarfile", path],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                )
                tar = subprocess.Popen(
                    ["tar", "-xOf", "-", "--wildcards", "*"],
                    stdin=deb.stdout,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                )
                deb.stdout.close()
                scan_stream(tar.stdout, found)
                tar.stdout.close()
                tar_rc = tar.wait()
                deb_rc = deb.wait()
                if deb_rc != 0 or tar_rc != 0:
                    errors.append("deb payload stream failed")
            except OSError as exc:
                errors.append(str(exc))
    elif lower.endswith((
        ".tar", ".tar.gz", ".tgz", ".tar.xz", ".tar.bz2", ".tbz", ".tbz2", ".tar.zst",
    )):
        if not shutil.which("tar"):
            errors.append("tar payload scanner unavailable")
        elif not scan_process(["tar", "-xOf", path, "--wildcards", "*"], found):
            errors.append("tar payload stream failed")
    elif lower.endswith(".zip"):
        try:
            with zipfile.ZipFile(path) as archive:
                for entry in archive.infolist():
                    if entry.is_dir():
                        continue
                    with archive.open(entry) as stream:
                        scan_stream(stream, found)
        except OSError as exc:
            errors.append(str(exc))
        except (RuntimeError, zipfile.BadZipFile) as exc:
            errors.append(str(exc))
    elif lower.endswith(".appimage"):
        if not shutil.which("unsquashfs"):
            errors.append("AppImage payload scanner unavailable")
        elif not scan_process(["unsquashfs", "-cat", path, ".*"], found):
            errors.append("AppImage payload stream failed")
    elif lower.endswith(".dmg"):
        errors.append("dmg payload scanner unavailable")

    return found, errors


payloads = []
skipped_signatures = 0
for path in sys.argv[1:]:
    if path.lower().endswith(".sig"):
        skipped_signatures += 1
    else:
        payloads.append(path)

verified = []
mismatched = []
unverified = []
for path in payloads:
    found, errors = scan_artifact(path)
    fingerprints = {
        hashlib.sha256(prefix.encode("ascii")).hexdigest(): prefix
        for prefix in found
    }
    expected = EXPECTED_FP in fingerprints
    foreign = [fp for fp in fingerprints if fp != EXPECTED_FP]
    name = os.path.basename(path)
    if expected and not foreign and not errors:
        verified.append(path)
        print(f"release-host-bytes: ✓ {name} agrees (fp {EXPECTED_FP[:12]}…)")
    elif foreign:
        mismatched.append(path)
        print(f"release-host-bytes: ✗ {name} has {len(foreign)} foreign/mixed host fingerprint(s)")
    else:
        unverified.append(path)
        reason = "container scan unavailable" if errors else "no release-host bytes found"
        print(f"release-host-bytes: ? {name} unverified ({reason})")

print(
    "release-host-bytes: "
    f"checked={len(verified)} mismatched={len(mismatched)} "
    f"unverified={len(unverified)} skipped-signatures={skipped_signatures}"
)

raise SystemExit(1 if mismatched or unverified else (2 if not payloads else 0))
PY
}

# release_artifacts_resolve_root <path> — print the existing directory's
# physical path.  The dev box relocates cargo output and keeps
# src-tauri/target as a symlink; `find` does not descend a symlink supplied as
# its starting path unless `-L` is used.  A zero-row, zero-exit scan of the
# unresolved path is therefore not evidence that an artifact is absent.
release_artifacts_resolve_root() {
  local root="${1:-}"
  if [[ -z "$root" ]]; then
    echo "release-artifacts: missing directory root to resolve." >&2
    return 2
  fi
  if [[ ! -e "$root" && ! -L "$root" ]]; then
    echo "release-artifacts: directory root does not exist: $root" >&2
    return 1
  fi

  local resolved
  resolved="$(cd "$root" 2>/dev/null && pwd -P)" || {
    echo "release-artifacts: directory root is not accessible: $root" >&2
    return 1
  }
  [[ -d "$resolved" ]] || {
    echo "release-artifacts: resolved root is not a directory: $resolved" >&2
    return 1
  }
  printf '%s\n' "$resolved"
}

# release_artifacts_linux_bundle_root <desktop-root> <cargo-target-root> <version>
# — select the Linux artifact tree the incremental publisher must consume.
# build-linux-local.sh COLLECTS finished bundles into the source-tree target so
# every platform has one canonical location.  On hosts with Cargo's target-dir
# redirected elsewhere, the pre-collection Cargo tree is empty after that move;
# looking only there falsely reports a successful Linux build as absent.  Prefer
# the collection destination whenever it contains this version, retaining the
# Cargo target only as compatibility for older/direct builders that did not
# collect their output.
release_artifacts_linux_bundle_root() {
  local desktop_root="${1:-}" cargo_target_root="${2:-}" version="${3:-}"
  [[ -n "$desktop_root" && -n "$cargo_target_root" && -n "$version" ]] || {
    echo "release-artifacts: linux bundle selection requires desktop root, cargo target root, and version." >&2
    return 2
  }

  local collected="$desktop_root/src-tauri/target/release/bundle"
  local f
  for f in "$collected"/deb/*_"$version"_*.deb \
           "$collected"/deb/*_"$version"_*.deb.sig \
           "$collected"/appimage/*_"$version"_*.AppImage \
           "$collected"/appimage/*_"$version"_*.AppImage.sig; do
    if [[ -f "$f" ]]; then
      printf '%s\n' "$collected"
      return 0
    fi
  done

  printf '%s\n' "$cargo_target_root/release/bundle"
}

# release_artifacts_write <tag> <artifact>... — record the cut's artifact set.
# One ABSOLUTE path per line, sorted + de-duplicated, EXISTING files only (an
# unmatched glob expands to a literal pattern, and a vanished file is dropped —
# so a caller can pass raw globs/optional paths and only real files are recorded).
# Overwrites any prior manifest for the tag. Prints the manifest path.
release_artifacts_write() {
  local tag="$1"; shift
  local out; out="$(release_artifacts_manifest_path "$tag")"
  {
    local f
    for f in "$@"; do
      [[ -f "$f" ]] || continue
      # Absolute-ize so the reader (a different CWD) resolves it.
      [[ "$f" = /* ]] || f="$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"
      printf '%s\n' "$f"
    done
  } | sort -u > "$out"
  printf '%s\n' "$out"
}

# release_artifacts_read <tag> — print the cut's artifact paths (one per line),
# EXISTING files only. Returns non-zero (with a message on stderr) if the manifest
# is absent or resolves to zero present files. The caller MUST treat that as a
# hard error and NEVER fall back to a second, drifting glob — the divergence is
# the bug.
release_artifacts_read() {
  local tag="$1"
  local manifest; manifest="$(release_artifacts_manifest_path "$tag")"
  if [[ ! -f "$manifest" ]]; then
    echo "release-artifacts: no manifest at $manifest — run bin/release-local.sh <version> <channel> first (it writes this)." >&2
    return 1
  fi
  local -a present=()
  local line
  while IFS= read -r line; do
    [[ -n "$line" && -f "$line" ]] && present+=("$line")
  done < "$manifest"
  if [[ ${#present[@]} -eq 0 ]]; then
    echo "release-artifacts: manifest $manifest names no existing files — the cut's artifacts are gone; re-run bin/release-local.sh." >&2
    return 1
  fi
  printf '%s\n' "${present[@]}"
}

# release_artifacts_assert_urls_covered <tag> <latest_json>... — RECURRENCE GUARD.
# The property being defended: a manifest must never advertise a URL that would
# 404 for an updater client — the LABELED != PACKED failure the post-upload
# fetch-check catches only AFTER the lie is already live.
#
# An advertised URL is COVERED if EITHER
#   (a) its (url-decoded) basename is in this cut's artifact set — it is about to
#       be uploaded; or
#   (b) it is ALREADY LIVE on the release host — it was uploaded by an earlier
#       publish and is reachable right now.
#
# (b) exists because "present in the local upload set" is only a PROXY for the
# real property, and that proxy is correct for a WHOLE cut but wrong for an
# INCREMENTAL platform publish. bin/publish-platform-incremental.sh deliberately
# merges the LIVE latest.json so it can add one platform without disturbing the
# others; those other platforms are already uploaded and are legitimately absent
# from this upload set. Judging them by (a) alone made the guard structurally
# unpassable on the incremental path whenever any other platform was already
# published — it rejected manifests that were, in fact, entirely serviceable.
#
# Fails CLOSED: a non-2xx, a timeout, a missing curl, or any probe error leaves
# the artifact uncovered, so an unreachable URL is still caught. Reachability is
# probed ONLY for artifacts that already failed (a), so a whole cut makes no
# network calls at all.
#
# Probing uses curl, not urllib: Cloudflare r2.dev hard-403s the default
# Python-urllib User-Agent as a bot while serving curl/* normally, so a urllib
# probe would report every live artifact as missing.
#
# Env:
#   RELEASE_ARTIFACTS_NO_REACHABILITY=1   skip (b) entirely — strict local-set
#                                         checking, for offline/hermetic runs.
#   RELEASE_ARTIFACTS_REACHABILITY_CMD=P  use P <url> instead of curl; exit 0
#                                         means reachable (test seam).
#
# Returns 0 if every advertised url is covered, 1 (and prints the offenders on
# stderr) otherwise. Missing / empty latest_json arguments are skipped
# (latest-server.json is optional — only Server-role cuts produce it).
release_artifacts_assert_urls_covered() {
  local tag="$1"; shift
  local manifest; manifest="$(release_artifacts_manifest_path "$tag")"
  [[ -f "$manifest" ]] || { echo "release-artifacts: no manifest at $manifest to check against." >&2; return 1; }
  python3 - "$manifest" "$@" <<'PY'
import json, os, shutil, subprocess, sys
from urllib.parse import unquote, urlsplit
manifest = sys.argv[1]
have = set()
with open(manifest) as fh:
    for line in fh:
        line = line.strip()
        if line:
            have.add(os.path.basename(line))


def reachable(url):
    """True only on a positive 2xx read. Every failure path returns False."""
    if not url or os.environ.get("RELEASE_ARTIFACTS_NO_REACHABILITY"):
        return False
    probe = os.environ.get("RELEASE_ARTIFACTS_REACHABILITY_CMD")
    try:
        if probe:
            return subprocess.run([probe, url], capture_output=True,
                                  timeout=30).returncode == 0
        if not shutil.which("curl"):
            return False
        # Range-GET a single byte: cheaper than a full GET and, unlike HEAD,
        # not answered by an interstitial on large objects.
        out = subprocess.run(
            ["curl", "-s", "-o", os.devnull, "-w", "%{http_code}",
             "-r", "0-0", "-L", "--max-time", "15", url],
            capture_output=True, text=True, timeout=30).stdout.strip()
        return out in ("200", "206")
    except Exception:
        return False


advertised = []
for mpath in sys.argv[2:]:
    if not mpath or not os.path.isfile(mpath):
        continue
    m = json.load(open(mpath))
    for plat, entry in (m.get("platforms") or {}).items():
        url = (entry or {}).get("url") or ""
        name = os.path.basename(unquote(urlsplit(url).path))
        if not name:
            continue
        if name not in have:
            advertised.append((os.path.basename(mpath), plat, name, url))

missing, already_live = [], []
for mf, plat, name, url in advertised:
    (already_live if reachable(url) else missing).append((mf, plat, name))

if already_live:
    print("release-artifacts: advertised artifact(s) absent from this upload set "
          "but ALREADY LIVE on the release host (incremental publish — allowed):",
          file=sys.stderr)
    for mf, plat, name in already_live:
        print(f"  {mf} [{plat}] -> {name}", file=sys.stderr)
if missing:
    print("release-artifacts: manifest advertises artifact(s) NOT in the upload set "
          "and NOT reachable on the release host:", file=sys.stderr)
    for mf, plat, name in missing:
        print(f"  {mf} [{plat}] -> {name}", file=sys.stderr)
    sys.exit(1)
PY
}

# release_artifacts_assert_signatures_present <tag> — RECURRENCE GUARD.
# The property being defended: every user-facing artifact this cut publishes ships
# with its minisign (.sig) sibling, so a download can be verified against the
# embedded/published updater pubkey — by bin/verify-provenance.sh and by a human.
#
# THE BUG THIS FIXES (EI-20595279927716716): signing followed the UPDATER pipeline
# rather than the PUBLISHED-ARTIFACT set. `tauri build` signs what it bundles, so
# every updater input got a .sig for free — and every download assembled AFTER the
# bundler, or built for humans only, silently got none. Measured across the two
# recorded cuts: `Papercusp Server_<ver>_x64-setup.zip` had no .sig in 0.0.16 OR
# 0.0.17, while every .deb/.AppImage/-setup.exe/.app.tar.gz in the same manifests
# did. One cause, and it is invisible until someone tries to verify a download.
#
# DECISION D-019 (plan release-build-vm-dev-parity-audit-2026-08-13): human-only
# downloads ARE signed too — the alternative (rule that only updater inputs are
# minisigned) leaves the largest download we ship unverifiable. So this guard's
# subject is the PUBLISHED set, not the updater set.
#
# DMGs are part of the published set and must carry the same minisign sibling as
# every other user-facing download. WI-39600 closes the producer-side gap, so no
# artifact extension is exempted here.
#
# Env:
#   RELEASE_ARTIFACTS_NO_SIGNATURE_CHECK=1  skip entirely — for keyless local cuts,
#                                           which legitimately produce no .sig at all.
#
# Returns 0 when every signable artifact has its sibling .sig, 1 (offenders on
# stderr) otherwise.
release_artifacts_assert_signatures_present() {
  local tag="$1"
  if [[ -n "${RELEASE_ARTIFACTS_NO_SIGNATURE_CHECK:-}" ]]; then
    echo "release-artifacts: signature check SKIPPED (RELEASE_ARTIFACTS_NO_SIGNATURE_CHECK)." >&2
    return 0
  fi
  local manifest; manifest="$(release_artifacts_manifest_path "$tag")"
  [[ -f "$manifest" ]] || { echo "release-artifacts: no manifest at $manifest to check signatures against." >&2; return 1; }
  python3 - "$manifest" <<'PY'
import os, sys
manifest = sys.argv[1]
names = set()
with open(manifest) as fh:
    for line in fh:
        line = line.strip()
        if line:
            names.add(os.path.basename(line))

# A published, user-facing artifact. Longest suffix first so ".app.tar.gz" is not
# read as a bare archive. DiskSpanning ".bin" slices are absent on purpose: they are
# normalized into the zip and never published on their own.
SIGNABLE = (".app.tar.gz", ".AppImage", ".deb", ".dmg", ".msi", ".exe", ".zip")

missing = []
for name in sorted(names):
    if name.endswith(".sig"):
        continue
    ext = next((s for s in SIGNABLE if name.endswith(s)), None)
    if not ext:
        continue
    if name + ".sig" not in names:
        missing.append(name)

if missing:
    print("release-artifacts: artifact(s) in this cut have NO sibling .sig — a download "
          "nobody can verify (EI-20595279927716716):", file=sys.stderr)
    for name in missing:
        print(f"  {name} (expected {name}.sig in the same cut)", file=sys.stderr)
    sys.exit(1)
PY
}
