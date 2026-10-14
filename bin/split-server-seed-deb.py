#!/usr/bin/env python3
"""Split the offline pot seed out of a Papercusp Server .deb into a companion package.

Why (p2p-public-release-endgame-2026-09-01#D-236, WI-6554700010012560): a Debian package
is an ar archive, and an ar member header stores its size in 10 decimal digits, so no
member may exceed 9,999,999,999 bytes. The seeded dogfood Server's data member was
11,290,740,252 bytes even under xz -9 (WI-6554700010012467): the full-history Git seed
and the corestore are already-compressed bytes that xz cannot shrink. So the seed ships
as its own package, `<Package>-seed_<Version>_all.deb`, which the Server package
Recommends.

The input is read member-by-offset (bin/ar-member-audit.py), so this works on the
over-cap package that dpkg itself calls corrupt. The data member is streamed ONCE and
every tar entry goes to exactly one output:

  * entries at or under SEED_ROOT (default `usr/lib/Papercusp Server/seed`) go to the
    seed package, preceded by their ancestor directory entries (copied from the input
    when it emits them first, otherwise synthesized as root:root 0755);
  * everything else goes to the Server package, unchanged.

Every regular file's md5 is computed while it streams and checked against the input's
md5sums, so a corrupt or mis-routed byte fails the split instead of shipping. The Server
keeps its maintainer scripts and fields, its md5sums minus the seed lines, an
Installed-Size reduced by the seed's share, and gains `Recommends: <Package>-seed
(= <Version>)`. The seed package has no maintainer scripts and declares `Replaces:
<Package> (<= <Version>)`, so it can take over seed files from an older seeded Server
during an upgrade, whichever package dpkg unpacks first.

Both outputs carry a `data.tar.gz` (gzip -1, the cheap intermediate) and are meant to go
through bin/repack-deb-xz.sh next (dedupe, xz -9, scrub check, updater signature).

Usage:
  split-server-seed-deb.py info  <server.deb> [--seed-root PATH]
      Print Package<TAB>Version<TAB>Architecture<TAB>SeedFiles, SeedFiles being the number of
      md5sums entries under SEED_ROOT (0: nothing to split). Reads only the control member.
  split-server-seed-deb.py split <server.deb> (--out-dir DIR | --in-place) [--seed-root PATH]
      Write the Server package (same file name) and the seed package into DIR, or replace
      the input in place (its now-stale .sig is removed) and write the seed beside it.
      Prints `server<TAB><path>` and `seed<TAB><path>` on stdout.

Exit status:
   0  success
   2  the input is not a readable Debian package (bad ar archive, layout or control)
   7  usage error, or a malformed PAPERCUSP_DEB_MEMBER_CAP_BYTES
   9  a decompressor or compressor subprocess failed
  10  the package has no entries under SEED_ROOT: nothing to split
  13  an output member is above the ar member cap (the seed alone no longer fits one
      package; D-236 follow-up: split the seed across packages)
  14  a hardlink crosses the Server/seed boundary
  15  the payload does not match the input's md5sums
  16  unsupported data or control compression
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import io
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SEED_ROOT = 'usr/lib/Papercusp Server/seed'
BUF = 1 << 20

EXIT_CORRUPT, EXIT_USAGE, EXIT_PIPE = 2, 7, 9
EXIT_NO_SEED, EXIT_OVER_CAP, EXIT_CROSS_LINK, EXIT_MD5, EXIT_COMPRESSION = 10, 13, 14, 15, 16

DECOMPRESSORS = {
    'data.tar.gz': ['gzip', '-dc'],
    'data.tar.xz': ['xz', '-dc'],
    'data.tar.zst': ['zstd', '-dc'],
    'data.tar.bz2': ['bzip2', '-dc'],
    'data.tar': None,
}


class SplitError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code


def _load_ar_audit():
    spec = importlib.util.spec_from_file_location('ar_member_audit', os.path.join(HERE, 'ar-member-audit.py'))
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


AR = _load_ar_audit()


def member_cap() -> int:
    """The ar member cap; tests may lower it (never raise it) to exercise the refusal."""
    raw = os.environ.get('PAPERCUSP_DEB_MEMBER_CAP_BYTES', '')
    if not raw:
        return AR.MEMBER_CAP
    if not re.fullmatch(r'[1-9][0-9]{0,9}', raw):
        raise SplitError(EXIT_USAGE, f'PAPERCUSP_DEB_MEMBER_CAP_BYTES must be a positive integer of at most 10 digits, got: {raw}')
    return min(int(raw), AR.MEMBER_CAP)


def normalized(name: str) -> str:
    """tarfile strips trailing slashes; drop the leading './' so paths compare like md5sums."""
    if name in ('.', './', ''):
        return ''
    return name[2:] if name.startswith('./') else name


def root_dir_info(name: str, mtime: int) -> tarfile.TarInfo:
    info = root_file_info(name, 0o755, mtime)
    info.type = tarfile.DIRTYPE
    return info


def root_file_info(name: str, mode: int, mtime: int) -> tarfile.TarInfo:
    info = tarfile.TarInfo(name)
    info.mode, info.mtime, info.uid, info.gid = mode, mtime, 0, 0
    info.uname = info.gname = 'root'
    return info


# ── the input package ────────────────────────────────────────────────────────


class Control:
    """One deb822 paragraph, field order and continuation lines preserved."""

    def __init__(self, fields: list[list[str]]) -> None:
        self.fields = fields

    @classmethod
    def parse(cls, text: str) -> 'Control':
        fields: list[list[str]] = []
        for line in text.splitlines():
            if not line.strip():
                if fields:
                    break
                continue
            if line[0] in ' \t':
                if not fields:
                    raise SplitError(EXIT_CORRUPT, f'control starts with a continuation line: {line!r}')
                fields[-1][1] += '\n' + line
                continue
            name, sep, value = line.partition(':')
            if not sep:
                raise SplitError(EXIT_CORRUPT, f'control line is not a field: {line!r}')
            fields.append([name.strip(), value.strip()])
        return cls(fields)

    def get(self, name: str) -> str | None:
        for field, value in self.fields:
            if field.lower() == name.lower():
                return value
        return None

    def set(self, name: str, value: str, after: str | None = None) -> None:
        for field in self.fields:
            if field[0].lower() == name.lower():
                field[1] = value
                return
        index = len(self.fields)
        if after is not None:
            for i, (field, _) in enumerate(self.fields):
                if field.lower() == after.lower():
                    index = i + 1
        self.fields.insert(index, [name, value])

    def render(self) -> bytes:
        return ''.join(f'{name}: {value}\n' for name, value in self.fields).encode('utf-8')


class Package:
    def __init__(self, path: str) -> None:
        self.path = path
        try:
            members = AR.parse(path)
        except (AR.Corrupt, OSError) as error:
            raise SplitError(EXIT_CORRUPT, f'{path} is not a readable ar archive: {error}') from error
        names = [m[0] for m in members]
        if len(members) != 3 or names[0] != 'debian-binary' or not names[1].startswith('control.tar') \
                or not names[2].startswith('data.tar'):
            raise SplitError(EXIT_CORRUPT, f'{path}: expected debian-binary, control.tar.*, data.tar.*; found {names}')
        self.members = {m[0]: (m[1], m[2]) for m in members}
        self.control_name, self.data_name = names[1], names[2]
        if self.data_name not in DECOMPRESSORS:
            raise SplitError(EXIT_COMPRESSION, f'{path}: unsupported data member {self.data_name}')
        self.debian_binary = self.read_member('debian-binary')
        self.control_entries = self._read_control_tar()
        control = self.control_entries.get('control')
        if control is None or control[1] is None:
            raise SplitError(EXIT_CORRUPT, f'{path}: the control member has no control file')
        self.control = Control.parse(control[1].decode('utf-8'))
        for field in ('Package', 'Version', 'Architecture'):
            if not self.control.get(field):
                raise SplitError(EXIT_CORRUPT, f'{path}: control has no {field}')

    def read_member(self, name: str) -> bytes:
        offset, size = self.members[name]
        with open(self.path, 'rb') as f:
            f.seek(offset)
            data = f.read(size)
        if len(data) != size:
            raise SplitError(EXIT_CORRUPT, f'{self.path}: short read in {name}')
        return data

    def _read_control_tar(self) -> dict[str, tuple[tarfile.TarInfo, bytes | None]]:
        """Ordered {normalized name: (TarInfo, bytes or None)} for the control member."""
        raw = self.read_member(self.control_name)
        try:
            with tarfile.open(fileobj=io.BytesIO(raw), mode='r:*') as tar:
                entries: dict[str, tuple[tarfile.TarInfo, bytes | None]] = {}
                for info in tar:
                    payload = tar.extractfile(info).read() if info.isfile() else None  # type: ignore[union-attr]
                    entries[normalized(info.name)] = (info, payload)
        except (tarfile.TarError, EOFError, OSError) as error:
            raise SplitError(EXIT_COMPRESSION, f'{self.path}: cannot read {self.control_name}: {error}') from error
        return entries

    def md5sums(self) -> list[tuple[str, str]]:
        entry = self.control_entries.get('md5sums')
        if entry is None or entry[1] is None:
            return []
        lines = []
        for number, line in enumerate(entry[1].decode('utf-8').splitlines(), 1):
            if not line.strip():
                continue
            m = re.fullmatch(r'([0-9a-f]{32}) [ *](.+)', line)
            if not m:
                raise SplitError(EXIT_CORRUPT, f'{self.path}: md5sums line {number} is malformed: {line!r}')
            lines.append((m.group(1), normalized(m.group(2))))
        return lines


# ── streaming ────────────────────────────────────────────────────────────────


class HashingReader:
    def __init__(self, source) -> None:
        self.source = source
        self.digest = hashlib.md5()

    def read(self, size: int = -1) -> bytes:
        data = self.source.read(size)
        self.digest.update(data)
        return data


class Region:
    """A read-only window onto one ar member (used when the data member is a bare tar)."""

    def __init__(self, path: str, offset: int, size: int) -> None:
        self.file = open(path, 'rb')
        self.file.seek(offset)
        self.left = size

    def read(self, size: int = -1) -> bytes:
        if self.left <= 0:
            return b''
        size = self.left if size < 0 else min(size, self.left)
        data = self.file.read(size)
        self.left -= len(data)
        return data

    def close(self) -> None:
        self.file.close()


def compressor_command() -> list[str]:
    if shutil.which('pigz'):
        return ['pigz', '-1', '-n', '-p', os.environ.get('PAPERCUSP_SPLIT_GZIP_THREADS', '4')]
    return ['gzip', '-1', '-n']


class TarSink:
    """A GNU-format tar stream gzip-compressed into one file.

    GNU_FORMAT, never PAX: dpkg's install walker refuses PAX 'x' headers (WI-39357).
    """

    def __init__(self, path: str) -> None:
        self.path = path
        self.out = open(path, 'wb')
        self.proc = subprocess.Popen(compressor_command(), stdin=subprocess.PIPE, stdout=self.out)
        self.tar = tarfile.open(fileobj=self.proc.stdin, mode='w|', format=tarfile.GNU_FORMAT,
                                bufsize=BUF, copybufsize=BUF)
        self.entries = 0

    def add(self, info: tarfile.TarInfo, payload=None) -> None:
        self.tar.addfile(info, payload)
        self.entries += 1

    def close(self) -> None:
        self.tar.close()
        assert self.proc.stdin is not None
        self.proc.stdin.close()
        rc = self.proc.wait()
        self.out.close()
        if rc != 0:
            raise SplitError(EXIT_PIPE, f'compressor {compressor_command()[0]} exited {rc} writing {self.path}')

    def kill(self) -> None:
        if self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait()
        self.out.close()


class Router:
    """Routes one data stream into the Server and seed sinks and collects the evidence."""

    def __init__(self, seed_root: str, md5sums: list[tuple[str, str]], server: TarSink, seed: TarSink) -> None:
        self.seed_root = seed_root.strip('/')
        parts = self.seed_root.split('/')
        # '' is the archive root ('.'); the seed root's parents follow, outermost first.
        self.ancestors = [''] + ['/'.join(parts[:i]) for i in range(1, len(parts))]
        self.ancestors_written: set[str] = set()
        self.expected_md5 = {path: digest for digest, path in md5sums}
        if len(self.expected_md5) != len(md5sums):
            raise SplitError(EXIT_MD5, 'the input md5sums lists a path more than once')
        self.server, self.seed = server, seed
        self.dot_prefix = True
        self.mtime = int(time.time())
        self.file_md5: dict[str, str] = {}
        self.seed_md5: list[tuple[str, str]] = []
        self.input_entries = self.seed_entries = self.seed_files = self.seed_bytes = self.seed_kib = 0

    def in_seed(self, path: str) -> bool:
        return path == self.seed_root or path.startswith(self.seed_root + '/')

    def tar_name(self, path: str) -> str:
        if not path:
            return '.'
        return f'./{path}' if self.dot_prefix else path

    def ensure_ancestors(self, before: str | None = None) -> None:
        """Synthesize every not-yet-written seed ancestor (outermost first), up to `before`."""
        stop = self.ancestors.index(before) if before is not None else len(self.ancestors)
        for ancestor in self.ancestors[:stop]:
            if ancestor not in self.ancestors_written:
                self.seed.add(root_dir_info(self.tar_name(ancestor), self.mtime))
                self.ancestors_written.add(ancestor)

    def check_md5(self, path: str, digest: str) -> None:
        expected = self.expected_md5.get(path)
        if expected is not None and expected != digest:
            raise SplitError(EXIT_MD5, f'{path}: md5 {digest} does not match md5sums {expected}')
        self.file_md5[path] = digest

    def route(self, source: tarfile.TarFile) -> None:
        for member in source:
            path = normalized(member.name)
            if self.input_entries == 0:
                self.dot_prefix = member.name.startswith('./') or member.name == '.'
                self.mtime = int(member.mtime)
            self.input_entries += 1
            to_seed = self.in_seed(path)

            digest = None
            if member.islnk():
                target = normalized(member.linkname)
                if self.in_seed(target) != to_seed:
                    raise SplitError(EXIT_CROSS_LINK, f'hardlink {member.name!r} -> {member.linkname!r} '
                                                      f'crosses the seed boundary {self.seed_root!r}')
                digest = self.file_md5.get(target)
                if digest is not None:
                    self.check_md5(path, digest)

            sink = self.seed if to_seed else self.server
            if to_seed:
                self.ensure_ancestors()
            if member.isfile():
                reader = HashingReader(source.extractfile(member))
                sink.add(member, reader)
                digest = reader.digest.hexdigest()
                self.check_md5(path, digest)
            else:
                sink.add(member)

            if to_seed:
                self.seed_entries += 1
                if member.isfile():
                    self.seed_files += 1
                    self.seed_bytes += member.size
                    self.seed_kib += (member.size + 1023) // 1024
                else:
                    self.seed_kib += 1
                if digest is not None:
                    self.seed_md5.append((digest, path))
            elif member.isdir() and path in self.ancestors and path not in self.ancestors_written:
                # A shared parent directory: dpkg allows two packages to own one directory.
                self.ensure_ancestors(before=path)
                self.seed.add(member)
                self.ancestors_written.add(path)

    def check_complete(self) -> None:
        if self.seed_entries == 0:
            raise SplitError(EXIT_NO_SEED, f'no entries under {self.seed_root!r}: nothing to split')
        missing = sorted(set(self.expected_md5) - set(self.file_md5))
        if missing:
            raise SplitError(EXIT_MD5, f'md5sums lists {len(missing)} path(s) absent from the payload, e.g. {missing[:3]}')


def stream_data(pkg: Package, router: Router) -> None:
    offset, size = pkg.members[pkg.data_name]
    command = DECOMPRESSORS[pkg.data_name]
    if command is None:
        region = Region(pkg.path, offset, size)
        try:
            with tarfile.open(fileobj=region, mode='r|', bufsize=BUF) as source:
                router.route(source)
        finally:
            region.close()
        return

    if not shutil.which(command[0]):
        raise SplitError(EXIT_COMPRESSION, f'decompressor not found for {pkg.data_name}: {command[0]}')
    proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    feed_error: list[BaseException] = []

    def feed() -> None:
        assert proc.stdin is not None
        try:
            with open(pkg.path, 'rb') as f:
                f.seek(offset)
                left = size
                while left:
                    chunk = f.read(min(left, BUF))
                    if not chunk:
                        raise SplitError(EXIT_CORRUPT, f'{pkg.path}: short read in {pkg.data_name}')
                    proc.stdin.write(chunk)
                    left -= len(chunk)
        except BrokenPipeError:
            pass
        except BaseException as error:  # re-raised on the main thread below
            feed_error.append(error)
        finally:
            try:
                proc.stdin.close()
            except BrokenPipeError:
                pass

    feeder = threading.Thread(target=feed, daemon=True)
    feeder.start()
    try:
        assert proc.stdout is not None
        with tarfile.open(fileobj=proc.stdout, mode='r|', bufsize=BUF) as source:
            router.route(source)
        # Drain the tar's trailing record padding so the decompressor can finish.
        while proc.stdout.read(BUF):
            pass
    except BaseException:
        proc.kill()
        raise
    finally:
        feeder.join()
        rc = proc.wait()
    if feed_error:
        raise feed_error[0]
    if rc != 0:
        raise SplitError(EXIT_PIPE, f'{command[0]} exited {rc} decompressing {pkg.data_name}')


# ── the outputs ──────────────────────────────────────────────────────────────


def control_tar(entries: list[tuple[tarfile.TarInfo, bytes | None]]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w:gz', format=tarfile.GNU_FORMAT, compresslevel=9) as tar:
        for info, payload in entries:
            info = copy.copy(info)
            if payload is None:
                tar.addfile(info)
            else:
                info.size = len(payload)
                tar.addfile(info, io.BytesIO(payload))
    return buf.getvalue()


def md5sums_bytes(lines: list[tuple[str, str]]) -> bytes:
    return ''.join(f'{digest}  {path}\n' for digest, path in lines).encode('utf-8')


def write_ar(path: str, members: list[tuple[str, bytes | str]], cap: int, mtime: int) -> None:
    sizes = [len(src) if isinstance(src, bytes) else os.path.getsize(src) for _, src in members]
    for (name, _), size in zip(members, sizes):
        if size > cap:
            raise SplitError(EXIT_OVER_CAP, f'{os.path.basename(path)}: member {name} would be {size} bytes, above the ar '
                                            f'member cap of {cap}; no Debian package can carry it '
                                            '(D-236 follow-up: split the seed across packages)')
    with open(path, 'wb') as out:
        out.write(b'!<arch>\n')
        for (name, src), size in zip(members, sizes):
            header = f'{name:<16}{mtime:<12}{0:<6}{0:<6}{"100644":<8}{size:<10}`\n'.encode('ascii')
            assert len(header) == 60, header
            out.write(header)
            if isinstance(src, bytes):
                out.write(src)
            else:
                with open(src, 'rb') as f:
                    shutil.copyfileobj(f, out, BUF)
            if size & 1:
                out.write(b'\n')


def server_control_entries(pkg: Package, router: Router, seed_package: str) -> tuple[list, Control]:
    """Same scripts and fields; md5sums minus the seed; smaller Installed-Size; Recommends the seed."""
    version = pkg.control.get('Version') or ''
    control = Control([list(field) for field in pkg.control.fields])
    original_kib = control.get('Installed-Size')
    if original_kib and original_kib.isdigit():
        control.set('Installed-Size', str(max(1, int(original_kib) - router.seed_kib)))
    recommendation = f'{seed_package} (= {version})'
    existing = control.get('Recommends')
    control.set('Recommends', f'{existing}, {recommendation}' if existing else recommendation, after='Depends')
    md5 = [(digest, path) for digest, path in pkg.md5sums() if not router.in_seed(path)]
    entries = []
    for name, (info, payload) in pkg.control_entries.items():
        if name == 'control':
            payload = control.render()
        elif name == 'md5sums':
            payload = md5sums_bytes(md5)
        entries.append((info, payload))
    return entries, control


def seed_control_entries(pkg: Package, router: Router, seed_package: str, mtime: int) -> list:
    package = pkg.control.get('Package') or ''
    version = pkg.control.get('Version') or ''
    fields = [['Package', seed_package], ['Version', version], ['Architecture', 'all']]
    for field in ('Maintainer', 'Section', 'Homepage'):
        value = pkg.control.get(field)
        if value:
            fields.append([field, value])
    fields += [
        ['Installed-Size', str(router.seed_kib)],
        ['Priority', 'optional'],
        ['Enhances', package],
        ['Replaces', f'{package} (<= {version})'],
        ['Description', f'Offline pot seed for {package}\n'
                        f' The first-boot pot seed (Git history and corestore) that {package}\n'
                        ' restores from when it starts without network access. It ships as its\n'
                        ' own package because, together with the Server, it exceeds the Debian\n'
                        ' archive member size limit.'],
    ]
    dot = './' if router.dot_prefix else ''
    return [
        (root_dir_info('.', mtime), None),
        (root_file_info(f'{dot}control', 0o644, mtime), Control(fields).render()),
        (root_file_info(f'{dot}md5sums', 0o644, mtime), md5sums_bytes(router.seed_md5)),
    ]


def split(path: str, out_dir: str, in_place: bool, seed_root: str) -> tuple[str, str]:
    cap = member_cap()
    pkg = Package(path)
    package = pkg.control.get('Package') or ''
    version = pkg.control.get('Version') or ''
    seed_package = f'{package}-seed'
    server_out = os.path.join(out_dir, os.path.basename(path))
    seed_out = os.path.join(out_dir, f'{seed_package}_{re.sub(r"^[0-9]+:", "", version)}_all.deb')
    if not in_place and os.path.realpath(server_out) == os.path.realpath(path):
        raise SplitError(EXIT_USAGE, f'--out-dir {out_dir} would overwrite the input; use --in-place for that')

    work = tempfile.mkdtemp(prefix='.seed-split.', dir=out_dir)
    sinks: list[TarSink] = []
    try:
        server_sink = TarSink(os.path.join(work, 'server-data.tar.gz'))
        sinks.append(server_sink)
        seed_sink = TarSink(os.path.join(work, 'seed-data.tar.gz'))
        sinks.append(seed_sink)
        router = Router(seed_root, pkg.md5sums(), server_sink, seed_sink)
        stream_data(pkg, router)
        router.check_complete()
        server_sink.close()
        seed_sink.close()
        sinks.clear()

        mtime = int(os.environ.get('SOURCE_DATE_EPOCH') or router.mtime)
        server_entries, server_control = server_control_entries(pkg, router, seed_package)
        server_tmp = os.path.join(work, 'server.deb')
        seed_tmp = os.path.join(work, 'seed.deb')
        write_ar(server_tmp, [('debian-binary', pkg.debian_binary), ('control.tar.gz', control_tar(server_entries)),
                              ('data.tar.gz', server_sink.path)], cap, mtime)
        write_ar(seed_tmp, [('debian-binary', pkg.debian_binary),
                            ('control.tar.gz', control_tar(seed_control_entries(pkg, router, seed_package, mtime))),
                            ('data.tar.gz', seed_sink.path)], cap, mtime)
        if shutil.which('dpkg-deb'):
            for built in (server_tmp, seed_tmp):
                result = subprocess.run(['dpkg-deb', '--info', built], capture_output=True, text=True)
                if result.returncode != 0:
                    raise SplitError(EXIT_CORRUPT, f'dpkg-deb cannot read the {os.path.basename(built)} just written: {result.stderr.strip()}')
        mode = os.stat(path).st_mode & 0o777
        os.chmod(server_tmp, mode)
        os.chmod(seed_tmp, mode)

        # Publish the seed first, so the seedless Server never appears without its seed.
        os.replace(seed_tmp, seed_out)
        os.replace(server_tmp, server_out)
        if in_place and os.path.exists(path + '.sig'):
            os.unlink(path + '.sig')
            print(f'split-server-seed-deb: removed the now-stale updater signature {path}.sig '
                  '(repack-deb-xz.sh signs the new package)', file=sys.stderr)
        print(f'SEED_SPLIT_RESULT package={package} version={version} input_entries={router.input_entries} '
              f'server_entries={server_sink.entries} seed_entries={router.seed_entries} '
              f'seed_files={router.seed_files} seed_bytes={router.seed_bytes} '
              f'seed_installed_kib={router.seed_kib} server_installed_kib={server_control.get("Installed-Size")} '
              f'md5_verified={len(set(router.file_md5) & set(router.expected_md5))}', file=sys.stderr)
        return server_out, seed_out
    finally:
        for sink in sinks:
            sink.kill()
        shutil.rmtree(work, ignore_errors=True)


def main(argv: list[str]) -> int:
    usage = (__doc__ or '').split('Usage:')[1].split('Exit status')[0].rstrip()
    if len(argv) < 3 or argv[1] not in ('info', 'split'):
        print(usage, file=sys.stderr)
        return EXIT_USAGE
    command, path, rest = argv[1], argv[2], argv[3:]
    out_dir, in_place, seed_root = None, False, DEFAULT_SEED_ROOT
    while rest:
        flag = rest.pop(0)
        if flag == '--in-place' and command == 'split':
            in_place = True
        elif flag == '--out-dir' and command == 'split' and rest:
            out_dir = rest.pop(0)
        elif flag == '--seed-root' and rest:
            seed_root = rest.pop(0).strip('/')
        else:
            print(usage, file=sys.stderr)
            return EXIT_USAGE
    if command == 'info':
        pkg = Package(path)
        seed_files = sum(1 for _, p in pkg.md5sums() if p == seed_root or p.startswith(seed_root + '/'))
        print('\t'.join([*(pkg.control.get(f) or '' for f in ('Package', 'Version', 'Architecture')), str(seed_files)]))
        return 0
    if in_place == (out_dir is not None) or not seed_root:
        print(usage, file=sys.stderr)
        return EXIT_USAGE
    if in_place:
        out_dir = os.path.dirname(os.path.abspath(path))
    assert out_dir is not None
    if not os.path.isdir(out_dir):
        print(f'split-server-seed-deb: --out-dir {out_dir} does not exist', file=sys.stderr)
        return EXIT_USAGE
    server_out, seed_out = split(path, out_dir, in_place, seed_root)
    print(f'server\t{server_out}')
    print(f'seed\t{seed_out}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv))
    except SplitError as error:
        print(f'FATAL: split-server-seed-deb: {error}', file=sys.stderr)
        sys.exit(error.code)
    except (tarfile.TarError, OSError) as error:
        print(f'FATAL: split-server-seed-deb: {error}', file=sys.stderr)
        sys.exit(EXIT_CORRUPT)
