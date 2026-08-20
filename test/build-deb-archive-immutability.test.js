// EI-20951841751487606 — archived debs must not share an inode with the
// fixed-path live bundle that a later Tauri/dpkg build may rewrite in place.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'bin/build-and-archive-deb.sh');

function runRealArchiveBlock(source, archive) {
  const full = fs.readFileSync(scriptPath, 'utf8');
  const start = full.indexOf('mkdir -p "$ARCHIVE_DIR"');
  const end = full.indexOf('# Prune to the last $KEEP archived builds', start);
  assert.ok(start > 0, 'archive block start not found — did it move or get renamed?');
  assert.ok(end > start, 'archive block end not found — did it move or get renamed?');

  const harness = [
    'set -euo pipefail',
    `DEB_PATH=${JSON.stringify(source)}`,
    `ARCHIVED_PATH=${JSON.stringify(archive)}`,
    `ARCHIVE_DIR=${JSON.stringify(path.dirname(archive))}`,
    'ARCHIVE_TMP=""',
    full.slice(start, end),
    '',
  ].join('\n');

  return spawnSync('bash', ['-c', harness], { encoding: 'utf8' });
}

test('archive block creates byte-identical content on a distinct inode', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-archive-'));
  try {
    const source = path.join(tmp, 'live.deb');
    const archive = path.join(tmp, 'archive', 'pinned.deb');
    fs.writeFileSync(source, 'build-one');

    const res = runRealArchiveBlock(source, archive);
    assert.equal(res.status, 0, `archive block failed: ${res.stderr}`);
    assert.equal(fs.readFileSync(archive, 'utf8'), 'build-one');
    assert.notEqual(
      fs.statSync(source).ino,
      fs.statSync(archive).ino,
      'the archive must never hardlink the mutable fixed-path live deb',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rewriting the live deb after archival cannot mutate the pinned archive', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-archive-'));
  try {
    const source = path.join(tmp, 'live.deb');
    const archive = path.join(tmp, 'archive', 'pinned.deb');
    fs.writeFileSync(source, 'build-one');

    const res = runRealArchiveBlock(source, archive);
    assert.equal(res.status, 0, `archive block failed: ${res.stderr}`);

    fs.writeFileSync(source, 'build-two-written-in-place');
    assert.equal(fs.readFileSync(archive, 'utf8'), 'build-one');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
