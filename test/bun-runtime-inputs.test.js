const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const helper = path.resolve(__dirname, '../bin/lib/bun-runtime-inputs.py');
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
