#!/usr/bin/env python3
"""Reject libdmg-hfsplus allocators that wrap physical writes above 4 GiB.

Use a sparse, disposable HFS+ volume and force its next allocation to a block
whose truncated 32-bit byte offset aliases the first catalog block. A file
round trip alone misses this corruption: the normal data write uses size_t,
while the allocator's zero-fill used uint32_t multiplication (EI-25395743635811411).
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import tempfile


def run(command):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            timeout=60, check=False)
    if result.returncode:
        raise RuntimeError(f"command failed ({result.returncode}): {command[0]}\n"
                           + result.stdout.decode(errors="replace")[-8000:])
    return result.stdout


def qualify(tool, mkfs, work_root):
    with tempfile.TemporaryDirectory(prefix="hfs-allocation-", dir=work_root) as root:
        root = Path(root)
        image = root / "boundary.raw"
        with image.open("wb") as stream:
            stream.truncate(5 * 1024 ** 3)
        run([mkfs, "-v", "AllocationPreflight", str(image)])
        with image.open("r+b") as stream:
            stream.seek(1024)
            header = stream.read(512)
            if header[:2] not in (b"H+", b"HX"):
                raise RuntimeError("mkfs did not produce an HFS+ volume")
            block_size, total_blocks = struct.unpack_from(">II", header, 40)
            catalog_block = struct.unpack_from(">I", header, 288)[0]
            bitmap_block = struct.unpack_from(">I", header, 128)[0]
            if not block_size or (1 << 32) % block_size or not catalog_block:
                raise RuntimeError("unsupported allocation-preflight volume geometry")
            target_block = (1 << 32) // block_size + catalog_block
            if target_block >= total_blocks:
                raise RuntimeError("allocation preflight did not reach the 4 GiB boundary")
            stream.seek(bitmap_block * block_size + target_block // 8)
            used = stream.read(1)
            if not used or used[0] & (1 << (7 - target_block % 8)):
                raise RuntimeError("allocation-preflight target block is already in use")
            stream.seek(catalog_block * block_size)
            before = stream.read(block_size)
            if len(before) != block_size or not any(before):
                raise RuntimeError("allocation preflight has no catalog positive control")
            stream.seek(1024 + 52)
            stream.write(struct.pack(">I", target_block))
        payload = bytes(range(256)) * 16
        input_file, output_file = root / "input.bin", root / "output.bin"
        input_file.write_bytes(payload)
        run([tool, str(image), "add", str(input_file), "/allocation-preflight.bin"])
        with image.open("rb") as stream:
            stream.seek(catalog_block * block_size)
            after = stream.read(block_size)
        # Adding a catalog record legitimately updates B-tree header counters.
        # The header node descriptor is invariant; a wrapped zero-fill destroys
        # it. Comparing the entire block would falsely reject a correct tool.
        if before[:14] != after[:14]:
            raise RuntimeError("HFS allocator corrupted its catalog at the 4 GiB boundary; "
                               "use a tool built with hfsplus-64bit-allocation.patch")
        run([tool, str(image), "extract", "/allocation-preflight.bin", str(output_file)])
        if output_file.read_bytes() != payload:
            raise RuntimeError("HFS boundary payload did not round trip")
        return {"status": "passed", "toolSha256": hashlib.sha256(Path(tool).read_bytes()).hexdigest(),
                "blockSize": block_size, "allocationBlock": target_block,
                "physicalOffset": target_block * block_size,
                "catalogBeforeSha256": hashlib.sha256(before).hexdigest(),
                "catalogAfterSha256": hashlib.sha256(after).hexdigest(),
                "catalogDescriptorPreserved": before[:14] == after[:14]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tool", required=True)
    parser.add_argument("--mkfs", required=True)
    parser.add_argument("--work-root", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(qualify(args.tool, args.mkfs, args.work_root), sort_keys=True))
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        parser.exit(1, f"HFS allocation preflight failed: {error}\n")
