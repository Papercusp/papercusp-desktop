#!/usr/bin/env python3
"""Share identical immutable AppDir payloads without removing any runtime path."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys


def deduplicate(root):
    root = Path(root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError('AppDir must be a directory')
    groups = {}
    for base, directories, names in os.walk(root, followlinks=False):
        directories[:] = sorted(directories)
        for name in sorted(names):
            file = Path(base) / name
            meta = file.lstat()
            if not stat.S_ISREG(meta.st_mode) or not meta.st_size:
                continue
            attributes = tuple((key, os.getxattr(file, key)) for key in sorted(os.listxattr(file)))
            key = (meta.st_size, stat.S_IMODE(meta.st_mode), meta.st_uid, meta.st_gid, attributes)
            groups.setdefault(key, []).append(file)
    linked = 0
    saved = 0
    for key, files in groups.items():
        if len(files) < 2:
            continue
        canonical = {}
        for file in files:
            with file.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').digest()
            if digest not in canonical:
                canonical[digest] = file
                continue
            source = canonical[digest]
            if os.path.samefile(source, file):
                continue
            # AppDir is an owned assembly tree, never an installed writable tree.
            # Atomic replacement leaves every path present even on interruption.
            temporary = file.with_name(file.name + '.deduplicate-' + str(os.getpid()))
            try:
                os.link(source, temporary)
                os.replace(temporary, file)
            finally:
                temporary.unlink(missing_ok=True)
            linked += 1
            saved += key[0]
    return {'linkedFiles': linked, 'savedUniqueBytes': saved}


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: deduplicate-appdir.py APPDIR')
    print(json.dumps(deduplicate(sys.argv[1]), sort_keys=True))
