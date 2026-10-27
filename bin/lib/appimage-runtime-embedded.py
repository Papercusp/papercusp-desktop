#!/usr/bin/env python3
"""Prove an AppImage embeds the pinned type-2 runtime (EI-27096956663669253).

appimagetool writes the runtime verbatim at offset 0 and appends the squashfs
payload directly after it. It then fills some reserved ELF sections of the
runtime in place. It always writes .digest_md5, and it writes .upd_info,
.sha256_sig and .sig_key when update information or signing is requested.
Every other byte of the prefix must equal the pinned runtime, and the squashfs
magic must start exactly where the runtime ends. The section ranges come from
the pinned runtime's own section header table, so no offset is hard-coded.

Checking the packaged bytes, not just the --runtime-file argument, also catches
a packer that ignores the flag or downloads a runtime anyway.

Usage: appimage-runtime-embedded.py --expected-sha256 HEX RUNTIME APPIMAGE
Prints one JSON object. Exit 0 = the AppImage carries the pinned runtime,
1 = it does not, 2 = the inputs are unusable.
"""

import argparse
import hashlib
import json
import struct
import sys

PACKER_WRITABLE_SECTIONS = (".digest_md5", ".upd_info", ".sha256_sig", ".sig_key")
SQUASHFS_MAGIC = b"hsqs"


def packer_writable_ranges(elf):
    """Return {section name: (start, end)} for the sections appimagetool may fill."""
    if elf[:4] != b"\x7fELF" or elf[4] != 2 or elf[5] != 1:
        raise ValueError("pinned runtime is not a little-endian ELF64 file")
    (shoff,) = struct.unpack_from("<Q", elf, 0x28)
    shentsize, shnum, shstrndx = struct.unpack_from("<HHH", elf, 0x3A)
    if shentsize != 64 or shnum == 0 or shoff + shnum * shentsize > len(elf):
        raise ValueError("pinned runtime has no usable section header table")

    def header(index):
        return struct.unpack_from("<IIQQQQIIQQ", elf, shoff + index * shentsize)

    strtab_offset = header(shstrndx)[4]
    ranges = {}
    for index in range(shnum):
        name_offset, _, _, _, offset, size = header(index)[:6]
        start = strtab_offset + name_offset
        name = elf[start:elf.index(b"\0", start)].decode("ascii", "replace")
        if name in PACKER_WRITABLE_SECTIONS:
            if offset + size > len(elf):
                raise ValueError(f"section {name} lies outside the runtime file")
            ranges[name] = (offset, offset + size)
    return ranges


def verify(expected_sha256, runtime_path, appimage_path):
    with open(runtime_path, "rb") as fh:
        runtime = fh.read()
    result = {
        "pinnedSha256": expected_sha256,
        "runtimeSha256": hashlib.sha256(runtime).hexdigest(),
        "runtimeBytes": len(runtime),
    }
    if result["runtimeSha256"] != expected_sha256:
        result.update(embeddedMatchesPin=False, reason="runtime file does not match the pin")
        return result, 2
    try:
        ranges = packer_writable_ranges(runtime)
    except (ValueError, struct.error) as exc:
        result.update(embeddedMatchesPin=False, reason=str(exc))
        return result, 2
    if ".digest_md5" not in ranges:
        result.update(embeddedMatchesPin=False, reason="runtime has no .digest_md5 section")
        return result, 2

    with open(appimage_path, "rb") as fh:
        prefix = fh.read(len(runtime))
        magic = fh.read(len(SQUASHFS_MAGIC))
    expected = bytearray(runtime)
    actual = bytearray(prefix)
    for start, end in ranges.values():
        expected[start:end] = bytes(end - start)
        if len(actual) >= end:
            actual[start:end] = bytes(end - start)
    mismatched = sum(1 for a, b in zip(actual, expected) if a != b)
    mismatched += abs(len(actual) - len(expected))
    result.update(
        maskedSections=sorted(ranges),
        mismatchedBytes=mismatched,
        payloadMagicAtRuntimeEnd=magic == SQUASHFS_MAGIC,
    )
    if mismatched:
        result.update(embeddedMatchesPin=False, reason="embedded runtime differs from the pin")
        return result, 1
    if magic != SQUASHFS_MAGIC:
        result.update(
            embeddedMatchesPin=False,
            reason="squashfs payload does not start where the pinned runtime ends",
        )
        return result, 1
    result["embeddedMatchesPin"] = True
    return result, 0


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("runtime")
    parser.add_argument("appimage")
    args = parser.parse_args(argv)
    try:
        result, status = verify(args.expected_sha256.lower(), args.runtime, args.appimage)
    except OSError as exc:
        result, status = {"embeddedMatchesPin": False, "reason": str(exc)}, 2
    print(json.dumps(result, sort_keys=True))
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
