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
const sourceSelection = path.join(root, 'bin/lib/source-tree-selection.sh');
const macCross = fs.readFileSync(path.join(root, 'bin/build-mac-cross.sh'), 'utf8');
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

test('D166 source projection follows exact selection and the committed lock guard before archive audit', () => {
  const selection = stageSource.indexOf('source_tree_selection "$HERE" "$MONO" installer');
  const pin = stageSource.indexOf('cmp -s "$SOURCE_PACKAGE_LOCK_PIN_COPY" "$SOURCE_PACKAGE_LOCK_ARCHIVE_TMP"');
  const projection = stageSource.indexOf('seed_uuid_project_source_archive "$HERE/lib/print-gitleaks-findings.py" "$OUT_TMP" "$SIDECAR"');
  const audit = stageSource.indexOf('python3 "$HERE/audit-release-bundle.py" "$OUT_TMP"');
  const publish = stageSource.indexOf('mv -f "$OUT_TMP" "$OUT"');
  assert.ok(selection >= 0 && pin > selection && projection > pin && audit > projection && publish > audit);
  assert.ok(stageSource.includes('UUID_SOURCE_TAR_ARGS=(--hard-dereference)'), 'every selected hard-link payload must be visible');
});

test('source stager selects the explicit candidate sidecar before checking its runtime input', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-source-candidate-'));
  try {
    const candidate = path.join(tmp, 'isolated-candidate');
    fs.mkdirSync(candidate);
    const result = spawnSync('bash', [path.join(root, 'bin/stage-source-tree.sh')], {
      encoding: 'utf8',
      env: { ...process.env, PAPERCUSP_STAGE_SOURCE: '1', PAPERCUSP_STAGE_SOURCE_ROOT: tmp,
        PAPERCUSP_STAGE_SOURCE_SIDECAR: candidate },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stderr.includes(`${candidate}/serve.mjs missing`), result.stderr);
    assert.ok(!fs.existsSync(path.join(candidate, 'source.tar.zst')),
      'a candidate without a runtime input must not publish a source archive');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('identity scrub overlay cannot reintroduce a source-selection exclusion', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-source-selection-filter-'));
  try {
    const excluded = 'docs/reports/private-owner-audit/README.md';
    const shipping = 'packages/demo/ship.js';
    for (const rel of [excluded, shipping]) {
      const file = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'identity-bearing candidate\n');
    }

    const result = spawnSync('bash', [
      '-c',
      [
        'set -euo pipefail',
        '. "$1"',
        "SELECTION_EXCLUDES=(--exclude='./docs/reports')",
        'source_tree_filter_candidate_files tar "$2" "$3" "$4"',
      ].join('\n'),
      'bash',
      sourceSelection,
      tmp,
      excluded,
      shipping,
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(result.stdout.trim(), shipping,
      'the exact tar selection must keep the excluded report out while retaining shipping source');
    assert.match(
      stageSource,
      /source_tree_filter_candidate_files "\$TAR_BIN" "\$MONO" "\$\{_leakers\[@\]\}"/,
      'stage-source-tree.sh must filter discovered leakers before building the scrub overlay',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('source staging overlays and verifies an external committed package-lock pin', () => {
  assert.match(stageSource, /SOURCE_PACKAGE_LOCK_PIN="\$\{PAPERCUSP_SOURCE_PACKAGE_LOCK_PIN:-\}\"/,
    'stage-source-tree.sh must accept an externally materialized lockfile pin');
  assert.match(stageSource, /--exclude='\.\/package-lock\.json'/,
    'the mutable source-tree lockfile must be excluded from the archive pass');
  assert.ok(stageSource.includes("declare -a PACKAGE_LOCK_TRANSFORM=(--transform='s|^\\./PINNED/|./|')"),
    'the pinned lockfile must be transformed back to the canonical archive member');
  assert.match(stageSource, /cmp -s "\$SOURCE_PACKAGE_LOCK_PIN_COPY" "\$SOURCE_PACKAGE_LOCK_ARCHIVE_TMP"/,
    'the produced archive member must be compared with the committed pin');
});

test('mac cross-build captures the committed lockfile before scratch staging', () => {
  const pin = macCross.indexOf('git -C "$ROOT/.." show HEAD:package-lock.json > "$SOURCE_PACKAGE_LOCK_PIN"');
  const crossInstall = macCross.indexOf('bash "$HERE/cross-install-darwin-tree.sh"');
  const stage = macCross.indexOf('bash "$HERE/stage-source-tree.sh"');
  assert.ok(pin >= 0, 'build-mac-cross.sh must materialize the committed root lockfile');
  assert.ok(crossInstall > pin, 'the lockfile pin must be captured before cross-install');
  assert.ok(stage > crossInstall, 'source staging must follow cross-install');
  assert.match(macCross, /PAPERCUSP_SOURCE_PACKAGE_LOCK_PIN="\$SOURCE_PACKAGE_LOCK_PIN"/,
    'build-mac-cross.sh must pass the external pin into stage-source-tree.sh');
  assert.match(macCross, /rm -f "\$SOURCE_PACKAGE_LOCK_PIN"/,
    'the caller must clean up its external pin after the build');
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
