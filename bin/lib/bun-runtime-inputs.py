#!/usr/bin/env python3
"""Internal sidecar input: checksum-pinned Bun; never selects the active runtime.

Pins are the published oven-sh/bun bun-v1.3.14 release asset SHA-256 digests.
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

VERSION = "1.3.14"
RELEASE = "https://github.com/oven-sh/bun/releases/download/bun-v" + VERSION
PINS = {
    ("linux", "x64"): ("bun-linux-x64-baseline", "a063908ae08b7852ca10939bbdc6ceed3ddabce8fb9402dce83d65d73b36e6c7"),
    ("linux", "arm64"): ("bun-linux-aarch64", "a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b"),
    ("darwin", "x64"): ("bun-darwin-x64-baseline", "3e35ad6f53971a9834bf9e6786e2adf72b5f1921cc9a9c5fde073d2972944076"),
    ("darwin", "arm64"): ("bun-darwin-aarch64", "d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620"),
    ("windows", "x64"): ("bun-windows-x64-baseline", "538f9c846355d9e847b2671bc00c47da4229a0befb24df3282b739770f3b475f"),
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


def stage(target_os, target_arch, cache_dir, output_dir):
    asset, expected = pin_for(target_os, target_arch)
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
    member = asset + ("/bun.exe" if target_os == "windows" else "/bun")
    return stage_archive(archive, output_dir, expected, member, target_os, target_arch)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("stage", "verify"))
    parser.add_argument("--target-os", required=True)
    parser.add_argument("--target-arch", required=True)
    parser.add_argument("--cache-dir")
    parser.add_argument("--output-dir")
    parser.add_argument("--binary")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    try:
        if args.action == "stage":
            if not args.cache_dir or not args.output_dir:
                parser.error("stage requires --cache-dir and --output-dir")
            result = stage(args.target_os, args.target_arch, args.cache_dir, args.output_dir)
        else:
            if not args.binary:
                parser.error("verify requires --binary")
            result = verify_binary(args.binary, args.target_os, args.target_arch, args.execute)
        print(json.dumps(result, sort_keys=True))
    except (ValueError, OSError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        parser.exit(1, "Bun input rejected: " + str(error) + "\n")


if __name__ == "__main__":
    main()
