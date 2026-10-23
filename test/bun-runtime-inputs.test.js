const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const helper = path.resolve(__dirname, '../src-tauri/resources/papercup-bun-runtime.py');
const fixture = String.raw`
import hashlib, importlib.util, io, json, os, pathlib, stat, struct, sys, zipfile
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('bun_inputs', sys.argv[1])
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
root = pathlib.Path(sys.argv[2])

def header(target_os, arch):
    value = bytearray(128)
    if target_os == 'linux':
        value[:6] = b'\x7fELF\x02\x01'
        struct.pack_into('<H', value, 18, 62 if arch == 'x64' else 183)
    elif target_os == 'darwin':
        value[:4] = b'\xcf\xfa\xed\xfe'
        struct.pack_into('<I', value, 4, 0x1000007 if arch == 'x64' else 0x100000c)
    else:
        value[:2] = b'MZ'
        struct.pack_into('<I', value, 60, 64)
        value[64:68] = b'PE\0\0'
        struct.pack_into('<H', value, 68, 0x8664)
        struct.pack_into('<H', value, 88, 0x20b)
    return bytes(value)

def archive(entries, name='fixture.zip'):
    result = root / name
    with zipfile.ZipFile(result, 'w') as z:
        for member, data in entries:
            z.writestr(member, data)
    return result, b.digest(result)

def rejected(action, message):
    try:
        action()
    except ValueError as error:
        assert message in str(error), str(error)
    else:
        raise AssertionError('unsafe input was accepted')

out = root / 'bin'
out.mkdir()
(out / 'node').write_bytes(b'retained Node')
`;

function python(t, body, args = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-input-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = spawnSync('python3', ['-B', '-c', fixture + '\n' + body, helper, root, ...args], {
    encoding: 'utf8', timeout: 20_000,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test('rootfs receipt binds the offline Bun archive to current pins, recipe and target without mutation', t => {
  python(t, String.raw`
recipe = 'a' * 64
image = root / 'papercup-runtime.tar.gz'
image.write_bytes(b'prepared rootfs fixture')
zip_input, sha = archive([('release/bun', header('linux', 'x64'))], 'papercup-bun-linux.zip')
stamp_path = root / '.rootfs-build-stamp'
recipe_path = root / 'papercup-rootfs-recipe'
recipe_path.write_text(recipe + '\n')
stamp = {'platform': 'linux/amd64', 'recipeSha256': recipe, 'rootfsSha256': b.digest(image), 'bunArchiveSha256': sha}
def save():
    stamp_path.write_text(json.dumps(stamp))
save()
with patch.dict(b.PINS, {('linux', 'x64'): ('release', sha)}), patch.object(b.urllib.request, 'urlopen', side_effect=AssertionError('network forbidden')), patch.object(b.subprocess, 'run', side_effect=AssertionError('execution forbidden')):
    before = {p.name: p.read_bytes() for p in root.iterdir() if p.is_file()}
    result = b.verify_rootfs(root, 'x64', recipe)
    assert result['bunArchiveSha256'] == sha and result['rootfsSha256'] == b.digest(image)
    assert before == {p.name: p.read_bytes() for p in root.iterdir() if p.is_file()}
    rejected(lambda: b.verify_rootfs(root, 'arm64', recipe), 'platform')
    rejected(lambda: b.verify_rootfs(root, 'x64', 'b' * 64), 'recipe')
    for key in ('rootfsSha256', 'bunArchiveSha256', 'recipeSha256'):
        original = stamp.pop(key)
        save()
        rejected(lambda: b.verify_rootfs(root, 'x64', recipe), key)
        stamp[key] = original
        save()
    original_zip = zip_input.read_bytes()
    zip_input.write_bytes(b'changed archive')
    rejected(lambda: b.verify_rootfs(root, 'x64', recipe), 'checksum')
    stamp['bunArchiveSha256'] = b.digest(zip_input)
    save()
    rejected(lambda: b.verify_rootfs(root, 'x64', recipe), 'pin')
    stamp['bunArchiveSha256'] = sha
    zip_input.write_bytes(original_zip)
    save()
    image.write_bytes(b'changed rootfs')
    rejected(lambda: b.verify_rootfs(root, 'x64', recipe), 'rootfs')
    image.write_bytes(b'prepared rootfs fixture')
    recipe_path.write_text('b' * 64)
    rejected(lambda: b.verify_rootfs(root, 'x64', recipe), 'recipe')
    recipe_path.write_text(recipe)
    for source in (zip_input, image, recipe_path, stamp_path):
        stored = source.read_bytes()
        source.unlink()
        rejected(lambda: b.verify_rootfs(root, 'x64', recipe), 'regular')
        actual = root / ('actual-' + source.name)
        actual.write_bytes(stored)
        source.symlink_to(actual)
        rejected(lambda: b.verify_rootfs(root, 'x64', recipe), 'regular')
        source.unlink()
        actual.rename(source)
`);
});

for (const [target, arch] of [
  ['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'x64'], ['darwin', 'arm64'], ['windows', 'x64'],
]) {
  test(`stages ${target}/${arch} atomically beside retained Node without executing it`, (t) => {
    python(t, String.raw`
target, arch = sys.argv[3:5]
member = 'release/bun.exe' if target == 'windows' else 'release/bun'
payload = header(target, arch)
source, sha = archive([(member, payload)])
with patch.object(b.subprocess, 'run', side_effect=AssertionError('cross input executed')):
    receipt = b.stage_archive(source, out, sha, member, target, arch)
destination = out / ('bun.exe' if target == 'windows' else 'bun')
assert destination.read_bytes() == payload
assert (out / 'node').read_bytes() == b'retained Node'
assert receipt['archiveSha256'] == sha
assert receipt['binarySha256'] == hashlib.sha256(payload).hexdigest()
assert receipt['target'] == target + '-' + arch
assert receipt['executed'] is False
assert not list(out.glob('.bun-*'))
`, [target, arch]);
  });
}

for (const member of ['../escape', '/escape', 'release/../escape', 'release\\escape', 'C:/escape', 'release/./escape']) {
  test(`rejects unsafe ZIP member ${JSON.stringify(member)} before replacing the binary`, (t) => {
    python(t, String.raw`
(out / 'bun').write_bytes(b'old candidate')
source, sha = archive([('release/bun', header('linux', 'x64')), (sys.argv[3], b'bad')])
rejected(lambda: b.stage_archive(source, out, sha, 'release/bun', 'linux', 'x64'), 'unsafe')
assert (out / 'bun').read_bytes() == b'old candidate'
assert not list(out.glob('.bun-*'))
`, [member]);
  });
}

test('rejects duplicate entries and symlink entries, including unrelated members', (t) => {
  python(t, String.raw`
link = zipfile.ZipInfo('release/link')
link.create_system = 3
link.external_attr = (stat.S_IFLNK | 0o777) << 16
for index, extra in enumerate([('release/bun', b'duplicate'), (link, b'../../escape')]):
    source, sha = archive([('release/bun', header('linux', 'x64')), extra], str(index) + '.zip')
    rejected(lambda: b.stage_archive(source, out, sha, 'release/bun', 'linux', 'x64'), 'unsafe')
assert not (out / 'bun').exists()
`);
});

test('requires the expected regular member and rejects an oversized archive', (t) => {
  python(t, String.raw`
for entries in [[('other/bun', b'wrong')], [('release/bun/', b'')]]:
    source, sha = archive(entries)
    rejected(lambda: b.stage_archive(source, out, sha, 'release/bun', 'linux', 'x64'), 'missing')
source, sha = archive([('release/bun', header('linux', 'x64'))])
with patch.object(b, 'MAX_BYTES', 16):
    rejected(lambda: b.stage_archive(source, out, sha, 'release/bun', 'linux', 'x64'), 'size limit')
assert not (out / 'bun').exists()
`);
});

test('checks cached archive bytes before opening them and rejects a cache symlink', (t) => {
  python(t, String.raw`
cache = root / 'cache'
cache.mkdir()
asset, sha = b.pin_for('linux', 'x64')
cached = cache / ('bun-v' + b.VERSION + '-' + asset + '.zip')
cached.write_bytes(b'corrupt')
with patch.object(b.urllib.request, 'urlopen', side_effect=AssertionError('cache failure retried')):
    rejected(lambda: b.stage('linux', 'x64', cache, out), 'checksum')
cached.unlink()
cached.symlink_to(root / 'missing')
with patch.object(b.urllib.request, 'urlopen', side_effect=AssertionError('symlink followed')):
    rejected(lambda: b.stage('linux', 'x64', cache, out), 'checksum')
assert not (out / 'bun').exists()
`);
});

test('rejects corrupt or oversized downloads without caching or replacing the old candidate', (t) => {
  python(t, String.raw`
(out / 'bun').write_bytes(b'old candidate')
cache = root / 'cache'
for limit, message in [(b.MAX_BYTES, 'checksum'), (4, 'size limit')]:
    with patch.object(b, 'MAX_BYTES', limit), patch.object(b.urllib.request, 'urlopen', return_value=io.BytesIO(b'corrupt download')):
        rejected(lambda: b.stage('linux', 'x64', cache, out), message)
    assert not list(cache.iterdir())
    assert (out / 'bun').read_bytes() == b'old candidate'
`);
});

test('downloads a matching pinned input once and revalidates the cached bytes', (t) => {
  python(t, String.raw`
asset, _ = b.pin_for('linux', 'x64')
source, sha = archive([(asset + '/bun', header('linux', 'x64'))])
cache = root / 'cache'
pins = dict(b.PINS)
pins[('linux', 'x64')] = (asset, sha)
with patch.object(b, 'PINS', pins):
    with patch.object(b.urllib.request, 'urlopen', return_value=io.BytesIO(source.read_bytes())) as download:
        first = b.stage('linux', 'x64', cache, out)
        assert download.call_count == 1
        assert download.call_args.args[0] == b.RELEASE + '/' + asset + '.zip'
    with patch.object(b.urllib.request, 'urlopen', side_effect=AssertionError('cache unexpectedly downloaded')):
        second = b.stage('linux', 'x64', cache, out)
    assert first == second
    cached = next(cache.iterdir())
    cached.write_bytes(cached.read_bytes() + b'corruption')
    rejected(lambda: b.stage('linux', 'x64', cache, out), 'checksum')
`);
});

for (const target of ['linux', 'darwin', 'windows']) {
  test(`rejects ${target} wrong architecture and preserves the previous candidate`, (t) => {
    python(t, String.raw`
target = sys.argv[3]
bad = bytearray(header(target, 'x64'))
struct.pack_into('<H' if target != 'darwin' else '<I', bad, {'linux':18, 'darwin':4, 'windows':68}[target], 0)
member = 'release/bun.exe' if target == 'windows' else 'release/bun'
destination = out / ('bun.exe' if target == 'windows' else 'bun')
destination.write_bytes(b'old candidate')
source, sha = archive([(member, bytes(bad))])
rejected(lambda: b.stage_archive(source, out, sha, member, target, 'x64'), 'architecture mismatch')
assert destination.read_bytes() == b'old candidate'
assert not list(out.glob('.bun-*'))
`, [target]);
  });
}

test('native version probe strips interpreter injection options and rejects a version mismatch', (t) => {
  python(t, String.raw`
binary = out / 'bun'
binary.write_bytes(header('linux', 'x64'))
binary.chmod(0o755)
from types import SimpleNamespace
with patch.object(b.platform, 'system', return_value='Linux'), patch.object(b.platform, 'machine', return_value='x86_64'), patch.dict(os.environ, {'BUN_OPTIONS':'bad', 'NODE_OPTIONS':'bad', 'NODE_PATH':'bad'}):
    with patch.object(b.subprocess, 'run', return_value=SimpleNamespace(stdout=b.VERSION + '\n')) as run:
        assert b.verify_binary(binary, 'linux', 'x64', True)['executed'] is True
        assert run.call_args.args[0] == [str(binary.resolve()), '--version']
        assert not {'BUN_OPTIONS', 'NODE_OPTIONS', 'NODE_PATH'} & run.call_args.kwargs['env'].keys()
    with patch.object(b.subprocess, 'run', return_value=SimpleNamespace(stdout='wrong')):
        rejected(lambda: b.verify_binary(binary, 'linux', 'x64', True), 'version differs')
with patch.object(b.platform, 'system', return_value='Darwin'), patch.object(b.subprocess, 'run', side_effect=AssertionError('foreign binary executed')):
    rejected(lambda: b.verify_binary(binary, 'linux', 'x64', True), 'foreign')
`);
});

test('rejects unsupported targets, nonexecutables, and binary symlinks', (t) => {
  python(t, String.raw`
rejected(lambda: b.pin_for('windows', 'arm64'), 'unsupported')
binary = out / 'bun'
binary.write_bytes(header('linux', 'x64'))
binary.chmod(0o644)
with patch.object(b.os, 'access', return_value=False):
    rejected(lambda: b.verify_binary(binary, 'linux', 'x64'), 'not executable')
binary.rename(out / 'actual')
binary.symlink_to(out / 'actual')
rejected(lambda: b.verify_binary(binary, 'linux', 'x64'), 'regular')
`);
});

test('exports the validated build input and stages it with no cache or network', t => {
  python(t, String.raw`
asset, _ = b.pin_for('linux', 'x64')
payload = header('linux', 'x64')
source, sha = archive([(asset + '/bun', payload)])
shipped = root / 'resources/papercup-bun-linux.zip'
pins = dict(b.PINS)
pins[('linux', 'x64')] = (asset, sha)
with patch.object(b, 'PINS', pins):
    with patch.object(b.urllib.request, 'urlopen', return_value=io.BytesIO(source.read_bytes())):
        b.stage('linux', 'x64', root / 'build-cache', out, archive_output=shipped)
    assert shipped.read_bytes() == source.read_bytes()
    (out / 'bun').unlink()
    with patch.object(b.urllib.request, 'urlopen', side_effect=AssertionError('offline install downloaded')):
        receipt = b.stage('linux', 'x64', None, out, archive=shipped)
    assert (out / 'bun').read_bytes() == payload
    assert receipt['archiveSha256'] == sha
    assert not list(shipped.parent.glob('.bun-archive-*'))
    assert (out / 'node').read_bytes() == b'retained Node'
`);
});

test('missing, corrupt, wrong-target or symlink shipped ZIP never downloads or replaces the runtime', t => {
  python(t, String.raw`
(out / 'bun').write_bytes(b'previous candidate')
foreign, _ = archive([('bun-windows-x64-baseline/bun.exe', header('windows', 'x64'))])
missing = root / 'missing.zip'
link = root / 'link.zip'
link.symlink_to(foreign)
with patch.object(b.urllib.request, 'urlopen', side_effect=AssertionError('shipped failure downloaded')):
    for source in [missing, foreign, link]:
        rejected(lambda: b.stage('linux', 'x64', root / 'unused-cache', out, archive=source), 'checksum')
        assert (out / 'bun').read_bytes() == b'previous candidate'
    assert not (root / 'unused-cache').exists()
`);
});

test('a corrupt download or export-time change preserves the previous shipped archive', t => {
  python(t, String.raw`
shipped = root / 'resources/papercup-bun-linux.zip'
shipped.parent.mkdir()
shipped.write_bytes(b'previous shipped archive')
with patch.object(b.urllib.request, 'urlopen', return_value=io.BytesIO(b'bad download')):
    rejected(lambda: b.stage('linux', 'x64', root / 'cache', out, archive_output=shipped), 'checksum')
source = root / 'changed.zip'
source.write_bytes(b'changed after validation')
rejected(lambda: b.publish_archive(source, shipped, '0' * 64), 'changed during export')
assert shipped.read_bytes() == b'previous shipped archive'
assert not list(shipped.parent.glob('.bun-archive-*'))
`);
});

for (const [target, failure] of [
  ['linux', 'download'], ['darwin', 'download'], ['windows', 'download'],
  ['linux', 'empty-extraction'], ['darwin', 'empty-extraction'],
  ['windows', 'empty-extraction'], ['linux', 'empty-cache'],
  ['linux', 'unverified-cache'], ['darwin', 'unverified-cache'], ['windows', 'unverified-cache'],
]) {
  test(`retained Node producer handles ${target} ${failure} without using host Node`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'node-producer-failure-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const tools = path.join(root, 'tools');
    const output = path.join(root, 'bin');
    fs.mkdirSync(tools);
    fs.mkdirSync(output);
    // A previous output must not disguise failure to produce this generation.
    fs.writeFileSync(path.join(output, target === 'windows' ? 'node.exe' : 'node'), 'old runtime');
    const cache = path.join(root, `cache/node-v24.18.1-${target}-x64`);
    if (failure === 'empty-cache' || failure === 'unverified-cache') {
      fs.mkdirSync(cache, { recursive: true });
      fs.writeFileSync(path.join(cache, target === 'windows' ? 'node.exe' : 'node'),
        failure === 'empty-cache' ? '' : 'cached runtime fixture');
    }
    fs.writeFileSync(path.join(tools, 'curl'), failure !== 'empty-extraction'
      ? '#!/bin/sh\nexit 22\n'
      : '#!/bin/sh\nwhile [ "$1" != -o ]; do shift; done\nprintf fixture > "$2"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(tools, 'tar'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    // An archive without a top-level directory must never expand an empty
    // inner path into a host-root glob. The stub prevents any such move.
    fs.writeFileSync(path.join(tools, 'unzip'), '#!/bin/sh\ntouch "$4/README"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(tools, 'mv'), '#!/bin/sh\ntouch "$MOVE_MARKER"\nexit 97\n', { mode: 0o755 });
    const producer = fs.readFileSync(path.resolve(__dirname, '../bin/build-desktop-sidecar.sh'), 'utf8');
    const start = producer.indexOf('NODE_VERSION=', producer.indexOf('# Node.js — vendor'));
    const end = producer.indexOf('# Bun is a packaged candidate', start);
    assert.ok(start > 0 && end > start, 'maintained Node producer section exists');
    const section = producer.slice(start, end).replace('node_tarball="/tmp/$node_archive"', 'node_tarball="$TMPDIR/$node_archive"');
    const result = spawnSync('bash', ['-c', 'set -euo pipefail\n' + section], {
      encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, PATH: tools + path.delimiter + process.env.PATH,
        target_os: target, target_arch: 'x64', DISTRIBUTION_PROFILE: 'dogfood',
        SIDECAR_BIN_CACHE: path.join(root, 'cache'), OMP_DIR: output,
        NODE_VERSION: 'v24.18.1', TMPDIR: root, MOVE_MARKER: path.join(root, 'unsafe-move') },
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /ERROR:.*Node/);
    assert.equal(fs.existsSync(path.join(root, 'unsafe-move')), false);
    assert.equal(fs.readFileSync(path.join(output, target === 'windows' ? 'node.exe' : 'node'), 'utf8'),
      'old runtime');
  });
}
