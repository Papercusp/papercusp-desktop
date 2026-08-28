'use strict';

// Release guards historically checked only `[[ -f ]]`. If an interrupted
// producer streams directly into that path, the next packaging run cannot tell
// a complete archive from a truncated one. These assertions keep the durable
// fix at the producer boundary: final paths are removed before a build, written
// through same-directory temporary files, and published only after success.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const stageSource = fs.readFileSync(path.join(root, 'bin/stage-source-tree.sh'), 'utf8');
const buildRootfs = fs.readFileSync(path.join(root, 'scripts/build-rootfs.sh'), 'utf8');
const sidecarBuilder = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
const bootstrapResource = fs.readFileSync(
  path.join(root, 'src-tauri/resources/papercup-bootstrap.sh'),
  'utf8',
);

function executableLines(source) {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

test('source archive is audited before atomic publication', () => {
  const executable = executableLines(stageSource);

  assert.match(executable, /rm -f "\$OUT"/);
  assert.match(executable, /OUT_TMP="\$\(mktemp "\$\{OUT\}\.tmp\.XXXXXX"\)"/);
  assert.match(executable, /\| zstd [^\n]* -o "\$OUT_TMP"/);
  assert.match(executable, /python3 "\$HERE\/audit-release-bundle\.py" "\$OUT_TMP"/);
  assert.match(executable, /mv -f "\$OUT_TMP" "\$OUT"/);
  assert.doesNotMatch(
    executable,
    /\| zstd [^\n]* -o "\$OUT"/,
    'zstd must never stream into the final archive path',
  );
});

test('Windows rootfs export is published only after gzip succeeds', () => {
  const executable = executableLines(buildRootfs);

  assert.match(executable, /rm -f "\$OUT_TARBALL"/);
  assert.match(executable, /OUT_TMP="\$\(mktemp "\$\{OUT_TARBALL\}\.tmp\.XXXXXX"\)"/);
  assert.match(executable, /docker export "\$CONTAINER" \| gzip -9 > "\$OUT_TMP"/);
  assert.match(executable, /mv -f "\$OUT_TMP" "\$OUT_TARBALL"/);
  assert.doesNotMatch(
    executable,
    /docker export "\$CONTAINER" \| gzip -9 > "\$OUT_TARBALL"/,
    'docker export must never stream into the final tarball path',
  );
});

test('Windows rootfs recipe fingerprint probe is read-only', () => {
  const executable = executableLines(buildRootfs);
  const printProbe = executable.indexOf('if [[ "${1:-}" == "--print-recipe-fingerprint" ]]');
  const destructiveCleanup = executable.indexOf('rm -f "$OUT_TARBALL"');

  assert.ok(printProbe >= 0, 'build-rootfs.sh must expose the recipe fingerprint probe');
  assert.ok(
    destructiveCleanup > printProbe,
    '--print-recipe-fingerprint must return before deleting the existing rootfs tarball',
  );
});

test('Windows rootfs atomic temporary archive is gitignored while it streams', () => {
  const temporaryArchive = 'src-tauri/resources/papercup-runtime.tar.gz.tmp.guard';
  const ignored = spawnSync('git', ['-C', root, 'check-ignore', '-q', '--', temporaryArchive], {
    encoding: 'utf8',
  });

  assert.equal(
    ignored.status,
    0,
    `git-sync must never discover the 250-400 MB atomic rootfs temp as dirty: ${ignored.stderr}`,
  );
});

test('Windows WSL bootstrap installs iproute2 for ss listener inspection', () => {
  for (const [name, source] of [
    ['build-rootfs.sh', buildRootfs],
    ['papercup-bootstrap.sh', bootstrapResource],
  ]) {
    assert.match(
      executableLines(source),
      /\n  iproute2 \\\n/,
      `${name} must install iproute2, which provides the ss listener-inspection command`,
    );
  }
});

test('Windows WSL bootstrap pins the sidecar Node runtime and ABI', () => {
  const sidecarMatch = sidecarBuilder.match(
    /^NODE_VERSION="\$\{NODE_VERSION:-v([0-9]+\.[0-9]+\.[0-9]+)\}"$/m,
  );
  assert.ok(sidecarMatch, 'the sidecar builder must declare an exact default Node release');

  const sidecarVersion = sidecarMatch[1];
  const expectedDefault = `NODE_VERSION="\${NODE_VERSION:-${sidecarVersion}}"`;
  for (const [name, source] of [
    ['build-rootfs.sh', buildRootfs],
    ['papercup-bootstrap.sh', bootstrapResource],
  ]) {
    assert.ok(source.includes(expectedDefault), `${name} must default to sidecar Node ${sidecarVersion}`);
    assert.match(
      source,
      /https:\/\/nodejs\.org\/dist\/v\$\{NODE_VERSION\}\/\$\{NODE_TARBALL\}/,
      `${name} must fetch the exact Node release, not a moving major alias`,
    );
    assert.doesNotMatch(source, /latest-v[0-9$]/, `${name} must not use latest-v*`);
    assert.doesNotMatch(source, /NODE_MAJOR/, `${name} must not reduce the runtime to a major only`);
  }
});
