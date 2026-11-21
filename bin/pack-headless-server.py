#!/usr/bin/env python3
"""Package a prepared Linux sidecar and its direct Node launcher as a relocatable archive."""

import argparse
import hashlib
import io
import json
import os
import posixpath
import tarfile
import tempfile
from pathlib import Path, PurePosixPath


ROOT = "papercusp-server"
SIDECAR = ROOT + "/sidecar"
OMITTED = {"source.tar.zst", "env-sidecars"}


def file_digest(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def portable_member(member):
    parts = PurePosixPath(member.name).parts
    if len(parts) >= 3 and parts[2] in OMITTED:
        return None
    if member.issym():
        target = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), member.linkname))
        if target != SIDECAR and not target.startswith(SIDECAR + "/"):
            raise ValueError(f"non-relocatable symlink: {member.name} -> {member.linkname}")
    if not (member.isdir() or member.isreg() or member.issym() or member.islnk()):
        raise ValueError(f"unexpected special file in sidecar: {member.name}")
    member.uid = member.gid = 0
    member.uname = member.gname = ""
    member.mode &= 0o777
    return member


def pack(sidecar, destination):
    sidecar = sidecar.resolve(strict=True)
    destination = destination.absolute()
    if destination.resolve().is_relative_to(sidecar):
        raise ValueError("place the output archive outside its input sidecar")
    if destination.exists():
        raise FileExistsError(destination)
    for name in ("bin/node", "serve.mjs", ".sidecar-build-stamp"):
        if not (sidecar / name).is_file():
            raise ValueError(f"prepared sidecar is missing {name}")
    stamp = json.loads((sidecar / ".sidecar-build-stamp").read_text())
    digest = file_digest(sidecar / "serve.mjs")
    if digest != stamp.get("serveSha256"):
        raise ValueError("serve.mjs does not match the sidecar build stamp")
    manifest = {
        "serveSha256": digest, "nodeSha256": file_digest(sidecar / "bin/node"),
        "gitHead": stamp.get("gitHead"), "entrypoint": "start-server",
        "omittedSidecarEntries": sorted(name for name in OMITTED if (sidecar / name).exists()),
        "includesVendorProjectSeed": False,
    }
    launcher = Path(__file__).with_name("start-headless-server.sh")
    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".headless-", suffix=".tmp") as temp:
        with tarfile.open(fileobj=temp, mode="w:gz", compresslevel=1) as archive:
            archive.add(sidecar, arcname=SIDECAR, filter=portable_member)
            info = archive.gettarinfo(str(launcher), arcname=ROOT + "/start-server")
            info.mode = 0o755
            with launcher.open("rb") as source:
                archive.addfile(portable_member(info), source)
            info = tarfile.TarInfo(ROOT + "/headless-manifest.json")
            encoded = (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode()
            info.size = len(encoded)
            archive.addfile(info, io.BytesIO(encoded))
        temp.flush()
        os.fsync(temp.fileno())
        os.link(temp.name, destination)
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sidecar", type=Path)
    parser.add_argument("output", type=Path, help="new .tar.gz archive")
    args = parser.parse_args()
    print(json.dumps(pack(args.sidecar, args.output), sort_keys=True))
