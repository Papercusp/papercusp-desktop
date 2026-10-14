#!/usr/bin/env python3
"""Read a Debian package's ar members by offset, including one whose size overflowed its header.

An ar member header stores the member size in a 10-character decimal field, so a member
can be at most 9,999,999,999 bytes. Tauri's deb writer does not bound it: an 11-digit
size is written anyway, which shifts the rest of that header by one byte. Every dpkg/ar
reader then reports "bad archive header magic", naming neither the member nor the cause
(WI-6554700010012467: a seeded Linux Server .deb whose data.tar.gz was 11,962,260,753
bytes). The member bytes themselves are intact; only the header is shifted, so this
reader parses the over-long size field and keeps going.

An overflowed header is accepted only when the whole archive stays self-consistent: every
later header parses and the last member ends exactly at the end of the file (or one pad
byte short of it). Anything else is reported as corruption, never guessed around.

Usage:
  ar-member-audit.py audit   <package.deb>          one MEMBER line per member
  ar-member-audit.py names   <package.deb>          member names, one per line
  ar-member-audit.py extract <package.deb> <name>   stream that member's bytes to stdout

Exit status: audit exits 0 when every member is within the cap and 3 when the archive is
self-consistent but at least one member is over it; names/extract exit 0 on success either
way (the cap is audit's report, not a read failure). Every command exits 2 when the file
is not a readable ar archive, or when the requested member is absent.
"""
import os
import re
import sys

AR_MAGIC = b'!<arch>\n'
HEADER_LEN = 60
SIZE_FIELD_START = 48
SIZE_FIELD_WIDTH = 10
FMAG = b'`\n'
MEMBER_CAP = 10 ** SIZE_FIELD_WIDTH - 1
OVERFLOWED_SIZE = re.compile(rb'(\d{%d,})`\n' % (SIZE_FIELD_WIDTH + 1))
EXIT_OK, EXIT_CORRUPT, EXIT_OVER_CAP = 0, 2, 3


class Corrupt(Exception):
    pass


def parse(path):
    """Return [(name, data_offset, size, over_cap)] for every member of the archive."""
    total = os.path.getsize(path)
    members = []
    with open(path, 'rb') as f:
        if f.read(len(AR_MAGIC)) != AR_MAGIC:
            raise Corrupt('missing the !<arch> global header')
        off = len(AR_MAGIC)
        while off < total:
            f.seek(off)
            raw = f.read(HEADER_LEN + 8)
            if len(raw) < HEADER_LEN:
                raise Corrupt(f'truncated member header at offset {off}')
            name = raw[:16].rstrip(b' ').rstrip(b'/').decode('ascii', 'replace')
            if raw[SIZE_FIELD_START + SIZE_FIELD_WIDTH:HEADER_LEN] == FMAG:
                field = raw[SIZE_FIELD_START:SIZE_FIELD_START + SIZE_FIELD_WIDTH].strip()
                if not field.isdigit():
                    raise Corrupt(f'member {name!r} at offset {off} has a non-numeric size field {field!r}')
                size, header_len = int(field), HEADER_LEN
            else:
                m = OVERFLOWED_SIZE.match(raw, SIZE_FIELD_START)
                if not m:
                    raise Corrupt(f'member header at offset {off} has bad magic and no overflowed size field')
                size, header_len = int(m.group(1)), m.end()
            data_off = off + header_len
            end = data_off + size
            if end > total:
                raise Corrupt(f'member {name!r} claims {size} bytes but the file ends {end - total} bytes early')
            members.append((name, data_off, size, size > MEMBER_CAP))
            off = end + (size & 1)
        if off not in (total, total + 1):
            raise Corrupt(f'archive does not end on a member boundary (parsed to {off}, file is {total} bytes)')
    if not members:
        raise Corrupt('archive has no members')
    return members


def main(argv):
    if len(argv) < 3 or argv[1] not in ('audit', 'names', 'extract') or (argv[1] == 'extract') != (len(argv) == 4):
        print(__doc__.split('Usage:')[1].split('Exit status')[0].rstrip(), file=sys.stderr)
        return EXIT_CORRUPT
    cmd, path = argv[1], argv[2]
    try:
        members = parse(path)
    except (Corrupt, OSError) as e:
        print(f'AR_AUDIT_CORRUPT {path}: {e}', file=sys.stderr)
        return EXIT_CORRUPT
    if cmd == 'audit':
        for i, (name, data_off, size, over) in enumerate(members):
            print(f'MEMBER index={i} name={name} size={size} offset={data_off} '
                  f'status={"over-cap" if over else "ok"} cap={MEMBER_CAP}')
        return EXIT_OVER_CAP if any(m[3] for m in members) else EXIT_OK
    if cmd == 'names':
        for name, *_ in members:
            print(name)
    else:
        wanted = [m for m in members if m[0] == argv[3]]
        if not wanted:
            print(f'AR_AUDIT_CORRUPT {path}: no member named {argv[3]!r}', file=sys.stderr)
            return EXIT_CORRUPT
        _, data_off, size, _ = wanted[0]
        out = sys.stdout.buffer
        with open(path, 'rb') as f:
            f.seek(data_off)
            left = size
            while left:
                chunk = f.read(min(left, 1 << 20))
                if not chunk:
                    print(f'AR_AUDIT_CORRUPT {path}: short read in {argv[3]!r}', file=sys.stderr)
                    return EXIT_CORRUPT
                out.write(chunk)
                left -= len(chunk)
        out.flush()
    return EXIT_OK


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv))
    except BrokenPipeError:
        sys.exit(EXIT_CORRUPT)
