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

test('portable source projection keeps dependency bytes and relocated workspace/bin links', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-portable-source-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const donor = path.join(tmp, 'donor'), source = path.join(tmp, 'source');
  const extracted = path.join(tmp, 'installed');
  const write = (base, rel, text) => {
    const file = path.join(base, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  write(source, 'packages/workspace/package.json', '{"name":"workspace","main":"index.js"}');
  write(source, 'packages/workspace/index.js', 'module.exports = 23;');
  const workspaceCli = write(source, 'packages/workspace/cli.js',
    '#!/usr/bin/env node\nconsole.log(require("workspace"));\n');
  fs.chmodSync(workspaceCli, 0o755);
  write(donor, 'node_modules/dep/package.json', '{"name":"dep","main":"index.js"}');
  write(donor, 'node_modules/dep/index.js', 'module.exports = 19;');
  const cli = write(donor, 'node_modules/dep/cli.js',
    '#!/usr/bin/env node\nconsole.log(require("dep") + require("workspace"));\n');
  fs.chmodSync(cli, 0o755);
  write(donor, 'node_modules/dep/assets/private/secret.txt', 'must stay excluded');
  write(donor, 'node_modules/dep/assets/public/data.txt', 'preserved runtime bytes');
  fs.mkdirSync(path.join(donor, 'node_modules/.bin'));
  fs.symlinkSync('../dep/cli.js', path.join(donor, 'node_modules/.bin/demo'));
  fs.symlinkSync('../workspace/cli.js', path.join(donor, 'node_modules/.bin/workspace-demo'));
  fs.symlinkSync(path.join(source, 'packages/workspace'), path.join(donor, 'node_modules/workspace'));
  fs.mkdirSync(path.join(source, 'node_modules/dep'), { recursive: true });
  for (const child of ['package.json', 'index.js', 'cli.js', 'assets']) {
    fs.symlinkSync(path.join(donor, 'node_modules/dep', child), path.join(source, 'node_modules/dep', child));
  }
  fs.symlinkSync(path.join(donor, 'node_modules/.bin'), path.join(source, 'node_modules/.bin'));
  fs.symlinkSync(path.join(source, 'packages/workspace'), path.join(source, 'node_modules/workspace'));
  const original = fs.readlinkSync(path.join(source, 'node_modules/dep/index.js'));
  const archive = path.join(tmp, 'source.tar');
  // Feed the selected archive to the actual producer projection, not a mock.
  const selected = spawnSync('tar', ['-C', source, '-cf', '-', './node_modules', './packages']);
  assert.equal(selected.status, 0, selected.stderr.toString());
  const projected = spawnSync('python3', [path.join(root, 'bin/audit-release-bundle.py'),
    '--portable-source-tar', source, 'tar', '--exclude=./node_modules/dep/assets/private'],
  { input: selected.stdout, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(projected.status, 0, projected.stderr.toString());
  const excludedSelection = spawnSync('tar', ['--exclude=./packages/workspace/cli.js',
    '-C', source, '-cf', '-', './node_modules', './packages']);
  assert.equal(excludedSelection.status, 0, excludedSelection.stderr.toString());
  const excludedTarget = spawnSync('python3', [path.join(root, 'bin/audit-release-bundle.py'),
    '--portable-source-tar', source, 'tar', '--exclude=./packages/workspace/cli.js'],
  { input: excludedSelection.stdout, maxBuffer: 16 * 1024 * 1024 });
  assert.notEqual(excludedTarget.status, 0);
  assert.match(excludedTarget.stderr.toString(), /link target was excluded: node_modules\/\.bin\/workspace-demo/);
  fs.writeFileSync(archive, projected.stdout);
  fs.mkdirSync(extracted);
  run('tar', ['-xf', archive, '-C', extracted]);
  assert.equal(fs.readlinkSync(path.join(source, 'node_modules/dep/index.js')), original);
  assert.equal(fs.readlinkSync(path.join(extracted, 'node_modules/.bin/demo')), '../dep/cli.js');
  assert.equal(fs.readlinkSync(path.join(extracted, 'node_modules/workspace')), '../packages/workspace');
  assert.equal(fs.statSync(path.join(extracted, 'node_modules/dep/cli.js')).mode & 0o777, 0o755);
  assert.equal(fs.readFileSync(path.join(extracted, 'node_modules/dep/assets/public/data.txt'), 'utf8'),
    'preserved runtime bytes');
  assert.equal(fs.existsSync(path.join(extracted, 'node_modules/dep/assets/private')), false);
  fs.rmSync(donor, { recursive: true });
  assert.equal(run(process.execPath, [path.join(extracted, 'node_modules/.bin/demo')],
    { cwd: extracted }).trim(), '42');
  assert.equal(run(process.execPath, [path.join(extracted, 'node_modules/.bin/workspace-demo')],
    { cwd: extracted }).trim(), '23');
  assert.ok(stageSource.includes('| python3 "$HERE/audit-release-bundle.py" --portable-source-tar'),
    'the real stager must project the selected tar before compression and final audit');
});

test('portable source projection consumes the complete GNU selection record before checking its producer', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-source-selection-record-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const donor = path.join(tmp, 'donor'), source = path.join(tmp, 'source');
  fs.mkdirSync(donor);
  fs.writeFileSync(path.join(donor, 'runtime.js'), 'module.exports = 41;\n');
  fs.writeFileSync(path.join(donor, 'private.txt'), 'excluded bytes');
  fs.mkdirSync(path.join(source, 'node_modules'), { recursive: true });
  fs.symlinkSync(donor, path.join(source, 'node_modules/dep'));
  const selected = spawnSync('tar', ['-C', source, '-cf', '-', './node_modules']);
  assert.equal(selected.status, 0, selected.stderr.toString());
  const projected = spawnSync('python3', [path.join(root, 'bin/audit-release-bundle.py'),
    '--portable-source-tar', source, 'tar', '--exclude=./node_modules/dep/private.txt'], {
    input: selected.stdout,
    // A valid GNU record larger than a pipe makes closing at tar EOF, before
    // padding has drained, deterministically kill the otherwise successful tar.
    env: { ...process.env, TAR_OPTIONS: '--blocking-factor=8192' },
    maxBuffer: 1024 * 1024,
    timeout: 15000,
  });
  assert.equal(projected.status, 0, projected.stderr.toString());
  const archive = path.join(tmp, 'projected.tar');
  const installed = path.join(tmp, 'installed');
  fs.writeFileSync(archive, projected.stdout);
  fs.mkdirSync(installed);
  run('tar', ['-xf', archive, '-C', installed]);
  assert.equal(fs.readFileSync(path.join(installed, 'node_modules/dep/runtime.js'), 'utf8'),
    'module.exports = 41;\n');
  assert.equal(fs.existsSync(path.join(installed, 'node_modules/dep/private.txt')), false);
  assert.equal(fs.readlinkSync(path.join(source, 'node_modules/dep')), donor);

  const refused = spawnSync('python3', [path.join(root, 'bin/audit-release-bundle.py'),
    '--portable-source-tar', source, 'tar'], {
    input: selected.stdout,
    env: { ...process.env, TAR_OPTIONS: '--blocking-factor=invalid' },
    timeout: 15000,
  });
  assert.notEqual(refused.status, 0, 'a failed GNU selector must remain a hard refusal');
  assert.match(refused.stderr.toString(), /node_modules\/dep \(exit 2\).*Invalid blocking factor/s);
});

test('portable source projection refuses external source links and dependency cycles', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-portable-refuse-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const source = path.join(tmp, 'source'), donor = path.join(tmp, 'donor');
  fs.mkdirSync(source); fs.mkdirSync(donor);
  fs.writeFileSync(path.join(donor, 'outside.txt'), 'outside source');
  fs.symlinkSync(path.join(donor, 'outside.txt'), path.join(source, 'outside'));
  const project = member => {
    const selected = spawnSync('tar', ['-C', source, '-cf', '-', ...[].concat(member)]);
    assert.equal(selected.status, 0, selected.stderr.toString());
    return spawnSync('python3', [path.join(root, 'bin/audit-release-bundle.py'),
      '--portable-source-tar', source, 'tar'], { input: selected.stdout });
  };
  const outside = project('./outside');
  assert.notEqual(outside.status, 0);
  assert.match(outside.stderr.toString(), /outside dependencies/);
  fs.symlinkSync(path.join(source, 'outside'), path.join(source, 'kept-link'));
  const missing = project('./kept-link');
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr.toString(), /link target was excluded/);
  fs.symlinkSync('loop-b', path.join(source, 'loop-a'));
  fs.symlinkSync('loop-a', path.join(source, 'loop-b'));
  const localCycle = project(['./loop-a', './loop-b']);
  assert.notEqual(localCycle.status, 0);
  assert.match(localCycle.stderr.toString(), /cyclic source link/);
  fs.mkdirSync(path.join(source, 'node_modules'));
  fs.symlinkSync(donor, path.join(source, 'node_modules/cyclic'));
  fs.symlinkSync(donor, path.join(donor, 'back'));
  const cyclic = project('./node_modules');
  assert.notEqual(cyclic.status, 0);
  assert.match(cyclic.stderr.toString(), /cyclic dependency directory/);
});

test('audited source archive retains its exact expired checkout until the artifact is removed', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-source-retention-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const helper = path.resolve(root, '../scripts/lint-as-committed.mjs');
  const { pathToFileURL } = require('node:url');
  const lifecycle = await import(pathToFileURL(helper));
  const source = path.join(tmp, lifecycle.WORK_ROOT_PREFIX + 'release-retention');
  fs.mkdirSync(source);
  run('git', ['init', '--quiet', source]);
  run('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--quiet', '--allow-empty', '-m', 'fixture'], { cwd: source });
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: source }).trim();
  fs.writeFileSync(path.join(source, lifecycle.OWNER_MARKER),
    JSON.stringify({ pid: 101, keep: true, sha, createdAtMs: 0 }));
  const archive = path.join(tmp, 'source.tar.zst');
  fs.writeFileSync(archive, 'fixture audited artifact');
  const block = stageSource.match(/<<'SOURCE_ARCHIVE_RETENTION'\n([\s\S]*?)\nSOURCE_ARCHIVE_RETENTION/);
  assert.ok(block, 'exercise the actual source-stager retention boundary');
  assert.ok(stageSource.indexOf("<<'SOURCE_ARCHIVE_RETENTION'") > stageSource.indexOf('mv -f "$OUT_TMP" "$OUT"'),
    'only the successfully audited final artifact can retain its source');
  const internal = path.join(source, 'source.tar.zst');
  fs.writeFileSync(internal, 'fixture internal artifact');
  const internalResult = run(process.execPath, ['--input-type=module', '-', source, internal, helper], { input: block[1] });
  assert.doesNotMatch(internalResult, /COMMITTED_SOURCE_ARCHIVE_RETENTION_OK/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(source, lifecycle.OWNER_MARKER))).retainedFor, undefined);
  const retained = run(process.execPath, ['--input-type=module', '-', source, archive, helper], { input: block[1] });
  assert.match(retained, /COMMITTED_SOURCE_ARCHIVE_RETENTION_OK/);
  assert.equal(lifecycle.verifyCommittedWorkRoot(source, sha, [], archive).sha, sha);
  const options = { root: tmp, nowMs: lifecycle.MAX_AGE_MS + 3600_000, cwds: [], isAlive: () => false, maxIdleKept: 0 };
  assert.ok((await lifecycle.sweepStaleWorkRoots(options)).kept.some(x => x.reason === 'dependent-artifact'));
  assert.ok(fs.existsSync(source));
  fs.rmSync(archive);
  assert.ok((await lifecycle.sweepStaleWorkRoots(options)).removed.some(x => x.reason === 'max-age'));
  assert.equal(fs.existsSync(source), false);
});
