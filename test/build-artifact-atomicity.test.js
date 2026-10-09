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
const artifactLibrary = path.join(root, 'bin/lib/release-artifacts.sh');

function outputFixture(t, preflight) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-producer-binding-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const bank = path.join(temp, 'new bank');
  const oldBank = path.join(temp, 'old bank');
  fs.mkdirSync(bank);
  fs.mkdirSync(oldBank);
  const preflightPath = path.join(oldBank, 'preflight.sh');
  fs.writeFileSync(preflightPath, preflight);
  return { bank, oldBank, preflightPath, output: path.join(bank, 'linux-gui-production') };
}

function composeOutput(f) {
  return spawnSync('bash', ['-c', [
    'set -euo pipefail',
    'readonly PAPERCUSP_PRODUCER_BANK="$1"',
    'readonly PAPERCUSP_PRODUCER_OUTPUT="$1/linux-gui-production"',
    'readonly RUN="$PAPERCUSP_PRODUCER_OUTPUT"',
    'source "$2"',
    'release_artifacts_assert_producer_output "$PAPERCUSP_PRODUCER_BANK" linux-gui-production "$RUN"',
    'source "$3"',
    'release_artifacts_assert_producer_output "$PAPERCUSP_PRODUCER_BANK" linux-gui-production "$RUN"',
    'printf "%s\\n" "$RUN"',
    'mkdir -p "$RUN"',
  ].join('\n'), 'fixture', f.bank, artifactLibrary, f.preflightPath], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, OLD_BANK: f.oldBank },
  });
}

test('sourced preflight REVIEW/BANK mutations cannot redirect a bound producer output', t => {
  const f = outputFixture(t, 'REVIEW="$OLD_BANK"\nBANK="$REVIEW"\n');
  const result = composeOutput(f);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout.trim(), f.output);
  assert.ok(fs.existsSync(f.output));
  assert.equal(fs.existsSync(path.join(f.oldBank, 'linux-gui-production')), false);
});

test('attempts to mutate either immutable output binding fail before producer creation', t => {
  for (const variable of ['PAPERCUSP_PRODUCER_BANK', 'PAPERCUSP_PRODUCER_OUTPUT', 'RUN']) {
    const f = outputFixture(t, `${variable}="$OLD_BANK"\n`);
    const result = composeOutput(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /readonly variable/);
    assert.equal(fs.existsSync(f.output), false);
    assert.equal(fs.existsSync(path.join(f.oldBank, 'linux-gui-production')), false);
  }
});

test('output guard refuses destination drift, traversal, existing paths and symlink escapes', t => {
  const f = outputFixture(t, 'true\n');
  const check = (bank, leaf, actual) => spawnSync('bash', ['-c',
    'source "$1"; release_artifacts_assert_producer_output "$2" "$3" "$4"',
    'fixture', artifactLibrary, bank, leaf, actual], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(check(f.bank, 'linux-gui-production', f.output).status, 0);
  for (const [bank, leaf, actual] of [
    [f.bank, 'linux-gui-production', path.join(f.oldBank, 'linux-gui-production')],
    [f.bank, '../escape', path.join(f.bank, '../escape')],
    ['', 'linux-gui-production', f.output],
  ]) assert.notEqual(check(bank, leaf, actual).status, 0);
  fs.symlinkSync(path.join(f.oldBank, 'absent'), f.output);
  assert.notEqual(check(f.bank, 'linux-gui-production', f.output).status, 0);
  fs.unlinkSync(f.output);
  fs.mkdirSync(f.output);
  assert.notEqual(check(f.bank, 'linux-gui-production', f.output).status, 0);
  const alias = path.join(path.dirname(f.bank), 'alias');
  fs.symlinkSync(f.bank, alias);
  assert.notEqual(check(alias, 'linux-gui-production', path.join(alias, 'linux-gui-production')).status, 0);
});

// Exact generated-script composition is independent of capacity admission. Read
// the real preflight source, but isolate external validation/capacity work when
// testing its shell globals. FULL_PREFLIGHT=1 additionally runs those admissions.
// Neither mode can reach mkdir, compile, package or sign.
if (process.env.PAPERCUSP_RELEASE_WRAPPER_BINDING_PACKET) {
  const crypto = require('node:crypto');
  const packet = JSON.parse(fs.readFileSync(process.env.PAPERCUSP_RELEASE_WRAPPER_BINDING_PACKET, 'utf8'));
  for (const binding of packet.preflights) {
    const bytes = fs.readFileSync(binding.path);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), binding.sha256);
  }
  const preflight = packet.preflights.find(row => path.basename(row.path) === 'launch-preflight.sh');
  assert.ok(preflight, 'the original launch preflight must be explicitly bound');
  const launchSource = fs.readFileSync(preflight.path, 'utf8');
  const externalBoundary = launchSource.indexOf('\nexport PATH=');
  assert.ok(externalBoundary > 0, 'cannot isolate the original preflight global header');
  // eval runs inside our intercepting function, where Bash's BASH_SOURCE[0]
  // would describe that function. Preserve the real sourced file's identity.
  const header = launchSource.slice(0, externalBoundary)
    .replaceAll('${BASH_SOURCE[0]}', '${BINDING_PREFLIGHT_PATH}');
  const full = process.env.PAPERCUSP_RELEASE_WRAPPER_BINDING_FULL_PREFLIGHT === '1';
  for (const leg of packet.legs) test(`exact ${leg.name} ${full ? 'full preflight' : 'source composition (admission excluded)'} preserves packet output`, () => {
    const before = fs.readFileSync(leg.script.path);
    assert.equal(crypto.createHash('sha256').update(before).digest('hex'), leg.script.sha256);
    assert.equal(fs.existsSync(leg.output), false);
    const args = full ? [leg.script.path, '--binding-preflight-only'] : ['-c', [
      'set -euo pipefail',
      // Execute the COMPLETE original preflight.sh. Its sourced launch header
      // is evaluated in that file's scope (same dirname/BASH_SOURCE); only the
      // later external validations and separate nested capacity subprocess are
      // excluded. This proves shell composition, never resource admission.
      'source() {',
      '  if [[ "$1" == "$BINDING_PREFLIGHT_PATH" ]]; then eval "$BINDING_PREFLIGHT_HEADER";',
      '  else builtin source "$@"; fi',
      '}',
      'bash() {',
      '  [[ "$1" == "$BINDING_NESTED_PATH" ]] || { echo "unexpected external bash" >&2; return 97; }',
      '}',
      'builtin source "$1" --binding-preflight-only',
    ].join('\n'), 'binding-composition', leg.script.path];
    const result = spawnSync('bash', args, {
      encoding: 'utf8', timeout: 180_000,
      env: { ...process.env, BINDING_PREFLIGHT_PATH: preflight.path,
        BINDING_PREFLIGHT_HEADER: header,
        BINDING_NESTED_PATH: path.join(path.dirname(preflight.path), 'preflight-nested-claims.sh') },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(result.stdout.includes(`PRODUCER_OUTPUT_BINDING_PASS ${leg.output}`), result.stdout);
    assert.equal(fs.existsSync(leg.output), false, 'preflight-only must not create a producer destination');
    assert.deepEqual(fs.readFileSync(leg.script.path), before);
  });
  if (!full) for (const leg of packet.legs) test(`CONTROL: rejected ${leg.name} wrapper resolves the old bank under the same source composition`, () => {
    const bytes = fs.readFileSync(leg.rejectedScript.path);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), leg.rejectedScript.sha256);
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'source() {',
      '  if [[ "$1" == "$BINDING_PREFLIGHT_PATH" ]]; then eval "$BINDING_PREFLIGHT_HEADER";',
      '  else builtin source "$@"; fi',
      '}',
      'bash() { [[ "$1" == "$BINDING_NESTED_PATH" ]] || return 97; }',
      'npm() { printf "tauri-cli 2.11.0\\n"; }',
      'mkdir() { printf "CONTROL_STOP_BEFORE_CREATE %s\\n" "$*"; return 98; }',
      'builtin source "$1" --binding-preflight-only',
    ].join('\n'), 'rejected-composition', leg.rejectedScript.path], {
      encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, BINDING_PREFLIGHT_PATH: preflight.path,
        BINDING_PREFLIGHT_HEADER: header,
        BINDING_NESTED_PATH: path.join(path.dirname(preflight.path), 'preflight-nested-claims.sh') },
    });
    const wrongOutput = path.join(path.dirname(preflight.path), path.basename(leg.output));
    assert.equal(result.status, 98, result.stdout + result.stderr);
    assert.ok(result.stdout.includes(`CONTROL_STOP_BEFORE_CREATE -p ${wrongOutput}`), result.stdout);
    assert.equal(fs.existsSync(wrongOutput), false);
    assert.equal(fs.existsSync(leg.output), false);
  });
}

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
