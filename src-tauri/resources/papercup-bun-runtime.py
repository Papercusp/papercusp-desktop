#!/usr/bin/env python3
"""Shared sidecar/WSL input: checksum-pinned Bun; never selects the active runtime.

Pins are the published oven-sh/bun bun-v1.4.4 release asset SHA-256 digests.
Use baseline x64 binaries so packaging does not introduce an AVX2 requirement.
WSL consumes the Linux input, independently of the Windows native input.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import stat
import struct
import subprocess
import tempfile
import urllib.request
import zipfile

VERSION = "1.4.4"
RELEASE = "https://github.com/oven-sh/bun/releases/download/bun-v" + VERSION
PINS = {
    ("linux", "x64"): ("bun-linux-x64-baseline", "e0446eb55995772eb9894bebae9a6be368d985a8b9271ee124486f9946eedd76"),
    ("linux", "arm64"): ("bun-linux-aarch64", "baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e"),
    ("darwin", "x64"): ("bun-darwin-x64-baseline", "d4a155adfbfd09155eb3ba05c9e3a544f39297d7a68616d3c7759f67ab5c47dc"),
    ("darwin", "arm64"): ("bun-darwin-aarch64", "c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510"),
    ("windows", "x64"): ("bun-windows-x64-baseline", "0f20ce6674d4f2dbcc8c5d59fdf99f7ba45f8c3b367e0f5781cbfa30a1c78d99"),
}
MAX_BYTES = 512 * 1024 * 1024


def digest(path):
    value = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def pin_for(target_os, target_arch):
    try:
        return PINS[(target_os, target_arch)]
    except KeyError as error:
        raise ValueError("unsupported Bun target: " + target_os + "-" + target_arch) from error


def verify_archive(archive, target_os, target_arch):
    _, expected = pin_for(target_os, target_arch)
    archive = Path(archive)
    if archive.is_symlink() or not archive.is_file() or digest(archive) != expected:
        raise ValueError("Bun archive checksum mismatch or nonregular input")
    return {"version": VERSION, "target": target_os + "-" + target_arch,
            "archiveSha256": expected}


def verify_rootfs(resource_dir, target_arch, recipe_sha256):
    """Read-only package gate: one rootfs, recipe and pinned Linux input."""
    resource_dir = Path(resource_dir)
    paths = {name: resource_dir / name for name in (
        ".rootfs-build-stamp", "papercup-rootfs-recipe",
        "papercup-runtime.tar.gz", "papercup-bun-linux.zip")}
    for name, path in paths.items():
        if path.is_symlink() or not path.is_file():
            raise ValueError("rootfs input must be a regular file: " + name)
    stamp = json.loads(paths[".rootfs-build-stamp"].read_text())
    if not isinstance(stamp, dict):
        raise ValueError("rootfs receipt must be an object")
    platform_name = {"x64": "linux/amd64", "arm64": "linux/arm64"}.get(target_arch)
    if platform_name is None or stamp.get("platform") != platform_name:
        raise ValueError("rootfs platform differs from the requested target")
    for key in ("recipeSha256", "rootfsSha256", "bunArchiveSha256"):
        value = stamp.get(key)
        if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
            raise ValueError("rootfs receipt lacks a valid " + key)
    if (stamp["recipeSha256"] != recipe_sha256 or
            paths["papercup-rootfs-recipe"].read_text().strip() != recipe_sha256):
        raise ValueError("rootfs recipe is stale")
    _, expected = pin_for("linux", target_arch)
    if stamp["bunArchiveSha256"] != expected:
        raise ValueError("rootfs Bun archive receipt differs from the current pin")
    verify_archive(paths["papercup-bun-linux.zip"], "linux", target_arch)
    if digest(paths["papercup-runtime.tar.gz"]) != stamp["rootfsSha256"]:
        raise ValueError("rootfs archive checksum differs from its receipt")
    return {key: stamp[key] for key in (
        "platform", "recipeSha256", "rootfsSha256", "bunArchiveSha256")}


def verify_binary(binary, target_os, target_arch, execute=False):
    pin_for(target_os, target_arch)
    binary = Path(binary)
    if binary.is_symlink() or not binary.is_file():
        raise ValueError("Bun must be a regular binary file")
    with binary.open("rb") as stream:
        header = stream.read(64)
        valid = False
        if target_os == "linux" and len(header) >= 20:
            valid = (header[:6] == b"\x7fELF\x02\x01" and
                     struct.unpack_from("<H", header, 18)[0] == {"x64": 62, "arm64": 183}[target_arch])
        elif target_os == "darwin" and len(header) >= 8:
            valid = (header[:4] == b"\xcf\xfa\xed\xfe" and
                     struct.unpack_from("<I", header, 4)[0] == {"x64": 0x1000007, "arm64": 0x100000C}[target_arch])
        elif target_os == "windows" and len(header) >= 64 and header[:2] == b"MZ":
            offset = struct.unpack_from("<I", header, 60)[0]
            if 64 <= offset <= 1024 * 1024:
                stream.seek(offset)
                pe = stream.read(26)
                valid = (len(pe) == 26 and pe[:4] == b"PE\0\0" and
                         struct.unpack_from("<H", pe, 4)[0] == 0x8664 and
                         struct.unpack_from("<H", pe, 24)[0] == 0x20B)
    if not valid:
        raise ValueError("Bun binary architecture mismatch: " + target_os + "-" + target_arch)
    if not os.access(binary, os.X_OK):
        raise ValueError("Bun binary is not executable")
    if execute:
        host_os = {"Linux": "linux", "Darwin": "darwin", "Windows": "windows"}.get(platform.system())
        host_arch = {"x86_64": "x64", "AMD64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(platform.machine())
        if (target_os, target_arch) != (host_os, host_arch):
            raise ValueError("cannot execute a foreign Bun target")
        env = {key: value for key, value in os.environ.items()
               if key not in ("BUN_OPTIONS", "NODE_OPTIONS", "NODE_PATH")}
        result = subprocess.run([str(binary.resolve()), "--version"], env=env,
                                check=True, capture_output=True, text=True, timeout=15)
        if result.stdout.strip() != VERSION:
            raise ValueError("Bun version differs from pinned " + VERSION)
    return {"version": VERSION, "target": target_os + "-" + target_arch,
            "binarySha256": digest(binary), "executed": execute}


def stage_archive(archive, output_dir, expected_sha256, member, target_os, target_arch):
    """Validate before atomic replacement. CLI callers always use PINS above."""
    archive, output_dir = Path(archive), Path(output_dir)
    if archive.is_symlink() or not archive.is_file() or digest(archive) != expected_sha256:
        raise ValueError("Bun archive checksum mismatch or nonregular cache input")
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / ("bun.exe" if target_os == "windows" else "bun")
    temporary = None
    try:
        with zipfile.ZipFile(archive) as zipped:
            names = set()
            total = 0
            for entry in zipped.infolist():
                name = entry.filename
                parts = PurePosixPath(name).parts
                mode = entry.external_attr >> 16
                if (name in names or not parts or name.startswith("/") or
                        "\\" in name or "\0" in name or ":" in name or
                        any(part in (".", "..") for part in name.rstrip("/").split("/")) or
                        stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR))):
                    raise ValueError("unsafe or duplicate Bun archive member")
                names.add(name)
                total += entry.file_size
                if total > MAX_BYTES:
                    raise ValueError("Bun archive exceeds size limit")
            if member not in names or zipped.getinfo(member).is_dir():
                raise ValueError("expected Bun binary member is missing")
            with tempfile.NamedTemporaryFile(prefix=".bun-", dir=output_dir, delete=False) as stream:
                temporary = Path(stream.name)
                with zipped.open(member) as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        stream.write(chunk)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.chmod(0o755)
            receipt = verify_binary(temporary, target_os, target_arch)
            os.replace(temporary, destination)
            receipt.update({"archiveSha256": expected_sha256, "path": str(destination)})
            return receipt
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def publish_archive(archive, destination, expected):
    """Export the verified download for installed/offline WSL upgrades."""
    archive, destination = Path(archive), Path(destination)
    if archive.resolve() == destination.resolve():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".bun-archive-", dir=destination.parent,
                                         delete=False) as stream:
            temporary = Path(stream.name)
            with archive.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    stream.write(chunk)
            stream.flush()
            os.fsync(stream.fileno())
        if digest(temporary) != expected:
            raise ValueError("Bun archive changed during export")
        temporary.chmod(0o644)
        os.replace(temporary, destination)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def stage(target_os, target_arch, cache_dir, output_dir, archive=None, archive_output=None):
    asset, expected = pin_for(target_os, target_arch)
    member = asset + ("/bun.exe" if target_os == "windows" else "/bun")
    # An explicit shipped input is authoritative: absent/corrupt/foreign bytes
    # fail closed, without consulting the host cache or the network.
    if archive is not None:
        return stage_archive(archive, output_dir, expected, member, target_os, target_arch)
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    archive = cache_dir / ("bun-v" + VERSION + "-" + asset + ".zip")
    # A corrupt cache is a failed input, not permission to silently trust a new one.
    if not archive.exists() and not archive.is_symlink():
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(prefix=".bun-download-", dir=cache_dir, delete=False) as stream:
                temporary = Path(stream.name)
                with urllib.request.urlopen(RELEASE + "/" + asset + ".zip", timeout=60) as response:
                    size = 0
                    for chunk in iter(lambda: response.read(1024 * 1024), b""):
                        size += len(chunk)
                        if size > MAX_BYTES:
                            raise ValueError("Bun download exceeds size limit")
                        stream.write(chunk)
            if digest(temporary) != expected:
                raise ValueError("downloaded Bun archive checksum mismatch")
            os.replace(temporary, archive)
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()
    receipt = stage_archive(archive, output_dir, expected, member, target_os, target_arch)
    if archive_output is not None:
        publish_archive(archive, archive_output, expected)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("stage", "verify", "verify-archive", "verify-rootfs"))
    parser.add_argument("--target-os", required=True)
    parser.add_argument("--target-arch", required=True)
    parser.add_argument("--cache-dir")
    parser.add_argument("--output-dir")
    parser.add_argument("--archive", help="required shipped ZIP; never downloads or uses a cache")
    parser.add_argument("--archive-output", help="export the verified build input for offline installation")
    parser.add_argument("--binary")
    parser.add_argument("--resource-dir")
    parser.add_argument("--recipe-sha256")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    try:
        if args.action == "stage":
            if not args.output_dir or (not args.archive and not args.cache_dir):
                parser.error("stage requires --output-dir and either --archive or --cache-dir")
            if args.archive and args.archive_output:
                parser.error("--archive and --archive-output are mutually exclusive")
            result = stage(args.target_os, args.target_arch, args.cache_dir, args.output_dir,
                           args.archive, args.archive_output)
        elif args.action == "verify-archive":
            if not args.archive:
                parser.error("verify-archive requires --archive")
            result = verify_archive(args.archive, args.target_os, args.target_arch)
        elif args.action == "verify-rootfs":
            if args.target_os != "linux" or not args.resource_dir or not args.recipe_sha256:
                parser.error("verify-rootfs requires Linux --resource-dir and --recipe-sha256")
            result = verify_rootfs(args.resource_dir, args.target_arch, args.recipe_sha256)
        else:
            if not args.binary:
                parser.error("verify requires --binary")
            result = verify_binary(args.binary, args.target_os, args.target_arch, args.execute)
        print(json.dumps(result, sort_keys=True))
    except (ValueError, OSError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        parser.exit(1, "Bun input rejected: " + str(error) + "\n")


if __name__ == "__main__":
    main()
