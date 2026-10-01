'use strict';

// Release guards historically checked only `[[ -f ]]`. If an interrupted
// producer streams directly into that path, the next packaging run cannot tell
// a complete archive from a truncated one. These assertions keep the durable
// fix at the producer boundary: final paths are removed before a build, written
// through same-directory temporary files, and published only after success.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
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
const auditBundle = path.join(root, 'bin/audit-release-bundle.py');

function executableLines(source) {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

function makeServerArtifact(members) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-server-artifact-'));
  const payload = path.join(temp, 'payload');
  for (const [relative, body] of Object.entries(members)) {
    const target = path.join(payload, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  const artifact = path.join(temp, 'Papercusp Server_0.0.22_amd64.app.tar.gz');
  const packed = spawnSync('tar', ['-czf', artifact, '-C', payload, '.'], { encoding: 'utf8' });
  assert.equal(packed.status, 0, `could not prepare synthetic Server artifact: ${packed.stderr}`);
  return { temp, artifact };
}

test('finished Server artifact audit rejects sidecar source-archive temp members', () => {
  const sidecar = 'Papercusp Server.app/Contents/Resources/sidecar';
  const fixture = makeServerArtifact({
    [`${sidecar}/serve.mjs`]: 'runtime',
    [`${sidecar}/source.tar.zst`]: 'complete archive',
    [`${sidecar}/source.tar.zst.tmp.partial`]: 'truncated archive',
  });
  try {
    const result = spawnSync('python3', [auditBundle, '--scan-artifact', '--require-source-archive', fixture.artifact], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /temporary sidecar member: .*source\.tar\.zst\.tmp\.partial/);
  } finally {
    fs.rmSync(fixture.temp, { recursive: true, force: true });
  }
});

test('finished Server artifact audit requires sidecar/source.tar.zst', () => {
  const sidecar = 'Papercusp Server.app/Contents/Resources/sidecar';
  const fixture = makeServerArtifact({ [`${sidecar}/serve.mjs`]: 'runtime' });
  try {
    const result = spawnSync('python3', [auditBundle, '--scan-artifact', '--require-source-archive', fixture.artifact], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /required sidecar\/source\.tar\.zst is missing/);
  } finally {
    fs.rmSync(fixture.temp, { recursive: true, force: true });
  }
});

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

test('Windows rootfs producer uses the canonical bootstrap that installs iproute2', () => {
  const producer = executableLines(buildRootfs);
  assert.match(producer, /BOOTSTRAP_FILE="\$\{OUT_DIR\}\/papercup-bootstrap\.sh"/);
  assert.match(producer, /BOOTSTRAP_SH="\$\(cat "\$BOOTSTRAP_FILE"\)"/);
  assert.doesNotMatch(
    producer,
    /\napt-get install /,
    'build-rootfs.sh must not restore a second embedded bootstrap recipe',
  );
  assert.match(
    executableLines(bootstrapResource),
    /\n  iproute2 \\\n/,
    'the canonical bootstrap must install iproute2 for ss listener inspection',
  );
});

test('Windows rootfs producer pins and forwards the canonical bootstrap Node runtime', () => {
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
    assert.doesNotMatch(source, /latest-v[0-9$]/, `${name} must not use latest-v*`);
    assert.doesNotMatch(source, /NODE_MAJOR/, `${name} must not reduce the runtime to a major only`);
  }
  assert.match(
    buildRootfs,
    /-e NODE_VERSION="\$NODE_VERSION" \\/,
    'the producer must forward the exact pin into the canonical bootstrap',
  );
  assert.match(
    bootstrapResource,
    /https:\/\/nodejs\.org\/dist\/v\$\{NODE_VERSION\}\/\$\{NODE_TARBALL\}/,
    'the canonical bootstrap must fetch the exact Node release, not a moving major alias',
  );
});
