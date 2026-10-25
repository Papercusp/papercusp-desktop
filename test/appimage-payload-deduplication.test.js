const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const helper = path.join(__dirname, '../bin/lib/deduplicate-appdir.py');
test('AppDir deduplication preserves URLs, bytes, modes and links while merging only identical payloads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appdir-dedup-'));
  try {
    const runtime = Buffer.from('immutable wasm runtime');
    for (const name of ['spa', 'spa/wake-runtime', 'spa/vad-runtime']) {
      fs.mkdirSync(path.join(root, name), { recursive: true });
      fs.writeFileSync(path.join(root, name, 'runtime.wasm'), runtime);
    }
    fs.writeFileSync(path.join(root, 'different.wasm'), Buffer.alloc(runtime.length, 65));
    fs.writeFileSync(path.join(root, 'executable'), runtime, { mode: 0o755 });
    fs.symlinkSync('spa/runtime.wasm', path.join(root, 'alias'));
    const run = () => {
      const result = spawnSync('python3', [helper, root], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    assert.deepEqual(run(), { linkedFiles: 2, savedUniqueBytes: runtime.length * 2 });
    const first = fs.statSync(path.join(root, 'spa/runtime.wasm'));
    for (const name of ['spa/wake-runtime/runtime.wasm', 'spa/vad-runtime/runtime.wasm']) {
      assert.equal(fs.statSync(path.join(root, name)).ino, first.ino);
      assert.deepEqual(fs.readFileSync(path.join(root, name)), runtime);
    }
    assert.notEqual(fs.statSync(path.join(root, 'different.wasm')).ino, first.ino);
    assert.notEqual(fs.statSync(path.join(root, 'executable')).ino, first.ino);
    assert.equal(fs.statSync(path.join(root, 'executable')).mode & 0o777, 0o755);
    assert.equal(fs.readlinkSync(path.join(root, 'alias')), 'spa/runtime.wasm');
    assert.deepEqual(run(), { linkedFiles: 0, savedUniqueBytes: 0 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('AppImage assembly shares duplicate payloads and audits distribution before signing', () => {
  const source = fs.readFileSync(path.join(__dirname, '../bin/build-appimage.sh'), 'utf8');
  const dedup = source.indexOf('python3 "$ORCHESTRATOR_HERE/lib/deduplicate-appdir.py" "$APPDIR"');
  const pack = source.indexOf('run_appimage_tool_isolated "$PLUGIN" "$OUT" "$APPDIR"');
  const audit = source.indexOf('python3 "$AUDIT_PY" --distribution-census gui linux "$OUT"');
  const sign = source.indexOf('# 5. Sign for the Tauri updater');
  assert.ok(dedup >= 0 && dedup < pack, 'deduplicate immutable payload before SquashFS packing');
  assert.ok(pack < audit && audit < sign, 'the final bytes must satisfy the contract before signing');
  assert.match(source, /"\$packer" --comp zstd/);
});

test('a failed final distribution audit prevents the signing continuation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../bin/build-appimage.sh'), 'utf8');
  const start = source.indexOf('# Compression defaults can change');
  const end = source.indexOf('# 5. Sign for the Tauri updater', start);
  assert.ok(start >= 0 && end > start);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-final-census-'));
  try {
    const auditor = path.join(root, 'auditor.py');
    const artifact = path.join(root, 'normal.AppImage');
    fs.writeFileSync(artifact, 'final artifact bytes');
    for (const status of [0, 1]) {
      fs.writeFileSync(auditor, `import sys\nassert sys.argv[1:] == ['--distribution-census', 'gui', 'linux', ${JSON.stringify(artifact)}]\nsys.exit(${status})\n`);
      const result = spawnSync('bash', ['-c', source.slice(start, end) + '\nprintf SIGNING_ALLOWED'], {
        encoding: 'utf8', env: { ...process.env, AUDIT_PY: auditor, OUT: artifact },
      });
      assert.equal(result.status, status, result.stdout + result.stderr);
      if (status === 0) assert.equal(result.stdout, 'SIGNING_ALLOWED');
      else {
        assert.doesNotMatch(result.stdout, /SIGNING_ALLOWED/);
        assert.match(result.stderr, /refusing to sign or retain/);
      }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
