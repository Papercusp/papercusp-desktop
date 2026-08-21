'use strict';

// EI-20559353000427453 — identity-scrub quarantine placement and the Debian
// artifact guard. The source stager may build a large archive, so the focused
// test checks its real path contract statically and exercises the small,
// central Debian packaging chokepoint with a tiny fixture.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const stageSource = fs.readFileSync(path.join(root, 'bin/stage-source-tree.sh'), 'utf8');
const repacker = path.join(root, 'bin/repack-deb-xz.sh');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${command} failed (${result.status}): ${result.stderr}`);
  return result.stdout;
}

test('stage-source-tree keeps its scrub quarantine outside the packaged sidecar', () => {
  const assignment = stageSource.match(/SCRUB_DIR="\$\(mktemp -d ([^\n]+)\)"/);
  assert.ok(assignment, 'stage-source-tree.sh must create a scrub quarantine with mktemp');
  assert.match(assignment[1], /\$\{TMPDIR:-\/tmp\}/,
    'the scrub quarantine must use an external temporary root');
  assert.doesNotMatch(assignment[1], /\$SIDECAR/,
    'the scrub quarantine must never be created under the packaged sidecar');
  assert.doesNotMatch(stageSource, /mktemp -d "\$SIDECAR\/\.stage-scrub-/,
    'the old in-sidecar quarantine path must not return');
});

test('Debian repacker rejects stale in-sidecar scrub members', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-stage-scrub-guard-'));
  try {
    const pkg = path.join(tmp, 'pkg');
    const scrubbed = path.join(
      pkg,
      'usr', 'lib', 'Papercusp GUI', 'sidecar',
      '.stage-scrub-regression', 'SCRUBBED', 'source.txt',
    );
    fs.mkdirSync(path.dirname(scrubbed), { recursive: true });
    fs.writeFileSync(scrubbed, 'duplicate scrub payload\n');
    fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'DEBIAN', 'control'), [
      'Package: papercusp-stage-scrub-guard',
      'Version: 1.0.0',
      'Architecture: all',
      'Maintainer: Papercusp <test@example.invalid>',
      'Description: stage scrub recurrence guard fixture',
      '',
    ].join('\n'));

    const deb = path.join(tmp, 'fixture.deb');
    run('dpkg-deb', ['-Zgzip', '-b', pkg, deb]);
    const result = spawnSync('bash', [repacker, deb], {
      encoding: 'utf8',
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: '' },
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.notEqual(result.status, 0, 'a stale scrub subtree must fail the packaging guard');
    assert.match(output, /\.stage-scrub/, 'the guard must identify the stale scrub members');
    assert.match(run('ar', ['t', deb]), /data\.tar\.gz/,
      'the rejected package must remain unmodified');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
