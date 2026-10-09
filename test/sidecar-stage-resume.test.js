'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const { makeDesktopTestScratchDirSync } = require('./test-scratch.cjs');
const { captureIdentity, captureSpa, copySpa, failureEvidenceRoot, inventory, recordFailure,
  sourceState, validateResume, validateSpa, writeJson } = require('../bin/lib/sidecar-stage-state.js');
const bin = path.resolve(__dirname, '../bin');
const builder = fs.readFileSync(path.join(bin, 'build-desktop-sidecar.sh'), 'utf8');
const finish = builder.match(/^__pc_finish_sidecar_build\(\) \{\n[\s\S]*?^\}$/m)[0];
const trap = builder.match(/^trap '[^\n]*' EXIT$/m)[0];
const failureTrap = builder.match(/^trap '[^\n]*' ERR$/m)[0];
const resume = builder.slice(builder.indexOf('if [[ -n "${PAPERCUSP_SIDECAR_RESUME_FROM:-}" ]]'), builder.indexOf('# Assembly-only work.'));

function gitFixture(root) {
  fs.mkdirSync(root, { recursive: true });
  const git = (args, input) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', input,
    env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' },
  }).trim();
  git(['init', '-q']);
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
  const blob = git(['hash-object', '-w', 'package-lock.json']);
  const tree = git(['mktree'], `100644 blob ${blob}\tpackage-lock.json\n`);
  const head = git(['commit-tree', tree], 'fixture\n');
  git(['update-ref', 'HEAD', head]);
  git(['read-tree', 'HEAD']);
  return { root, head, git };
}

function directSourceState(root) {
  const digest = crypto.createHash('sha256');
  for (const args of [
    ['diff', '--no-ext-diff', '--binary', '--submodule=diff', 'HEAD'],
    ['status', '--porcelain=v1', '--untracked-files=normal'],
  ]) {
    digest.update(JSON.stringify(args));
    digest.update(execFileSync('git', ['-C', root, ...args], { maxBuffer: 96 * 1024 * 1024 }));
  }
  return digest.digest('hex');
}

test('both producer qualification phases execute current tooling against the selected product', () => {
  const f = fixture();
  try {
    const tooling = path.join(f.root, 'current tooling');
    const product = path.join(f.root, 'frozen product');
    const desktop = path.join(product, 'desktop');
    fs.mkdirSync(tooling);
    fs.mkdirSync(path.join(desktop, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(tooling, 'verify-sidecar-bundle.sh'),
      '#!/bin/sh\nprintf "%s\\n" "$REPO_ROOT" "$PAPERCUSP_DESKTOP_TARGET_ROOT" "$@"\n', { mode: 0o700 });
    fs.writeFileSync(path.join(desktop, 'bin/verify-sidecar-bundle.sh'),
      '#!/bin/sh\necho frozen-verifier >&2\nexit 23\n', { mode: 0o700 });
    const calls = builder.split('\n')
      .filter(line => line.includes('verify-sidecar-bundle.sh" "$SIDECAR_DIR"'))
      .map(line => line.replace(/^if ! /, '').replace(/; then$/, ''));
    assert.equal(calls.length, 2, 'stage and final-path verification must both be exercised');
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'HERE="$1"; ROOT="$2"; REPO_ROOT="$3"; SIDECAR_DIR="$4"; TARGET_OS=linux; TARGET_ARCH=arm64',
      ...calls,
    ].join('\n'), 'fixture', tooling, desktop, product, f.stage], {
      encoding: 'utf8', env: { ...process.env, REPO_ROOT: '/foreign-source', PAPERCUSP_DESKTOP_TARGET_ROOT: '/foreign-desktop' },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const expected = [product, desktop, f.stage, '--target-os', 'linux', '--target-arch', 'arm64'];
    assert.deepEqual(result.stdout.trim().split('\n'), [...expected, ...expected]);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('stage identity binds the executable tooling verifier and refuses its changed bytes on resume', async () => {
  const f = fixture();
  try {
    const source = gitFixture(path.join(f.root, 'source'));
    const desktop = gitFixture(path.join(f.root, 'desktop'));
    const tooling = path.join(f.root, 'tooling');
    fs.mkdirSync(path.join(tooling, 'lib'), { recursive: true });
    for (const file of ['build-desktop-sidecar.sh', 'audit-release-bundle.py', 'emit-build-provenance.sh', 'lib/transformers-models.sh', 'lib/server-container.mjs']) {
      fs.copyFileSync(path.join(bin, file), path.join(tooling, file));
    }
    const selected = path.join(tooling, 'verify-sidecar-bundle.sh');
    fs.writeFileSync(selected, '#!/bin/sh\nexit 0\n');
    fs.mkdirSync(path.join(desktop.root, 'bin'));
    const frozen = path.join(desktop.root, 'bin/verify-sidecar-bundle.sh');
    fs.writeFileSync(frozen, '#!/bin/sh\nexit 23\n');
    const env = {
      SIDECAR_STAGE_REPO_ROOT: source.root, SIDECAR_STAGE_DESKTOP_ROOT: desktop.root,
      SIDECAR_STAGE_HELPER_ROOT: tooling, SIDECAR_STAGE_FINAL_DIR: f.finalDir,
      SIDECAR_STAGE_FAILED_ROOT: f.root,
      SIDECAR_STAGE_TARGET_OS: 'linux', SIDECAR_STAGE_TARGET_ARCH: 'arm64',
      PROVENANCE_SOURCE_GIT_HEAD: source.head, PROVENANCE_SOURCE_GIT_DIRTY: 'false',
      PAPERCUSP_DISTRIBUTION_PROFILE: 'vm-release', PAPERCUSP_RELEASE_AUDIT: '1',
    };
    const first = await captureIdentity(env);
    assert.deepEqual(first.tools.find(tool => path.basename(tool.file) === 'verify-sidecar-bundle.sh'), {
      file: fs.realpathSync(selected), sha256: crypto.createHash('sha256').update(fs.readFileSync(selected)).digest('hex'),
    });
    assert.equal(first.tools.some(tool => tool.file === frozen), false);
    const inventory = path.join(tooling, 'lib/server-container.mjs');
    assert.deepEqual(first.tools.find(tool => tool.file === fs.realpathSync(inventory)), {
      file: fs.realpathSync(inventory), sha256: crypto.createHash('sha256').update(fs.readFileSync(inventory)).digest('hex'),
    });
    recordFailure(f.stage, first, 'assembled', 1);
    validateResume(f.stage, first);
    fs.appendFileSync(selected, '# changed qualification policy\n');
    const changed = await captureIdentity(env);
    assert.equal(changed.sourceState, first.sourceState);
    assert.equal(changed.desktopState, first.desktopState);
    assert.throws(() => validateResume(f.stage, changed), /producer identity changed/);
    fs.writeFileSync(selected, '#!/bin/sh\nexit 0\n');
    fs.appendFileSync(inventory, '// changed ELF inventory policy\n');
    const changedInventory = await captureIdentity(env);
    assert.throws(() => validateResume(f.stage, changedInventory), /producer identity changed/);
    fs.rmSync(selected);
    await assert.rejects(captureIdentity(env), /ENOENT/, 'missing tooling must never fall back to frozen verifier');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('actual source capture detects same-HEAD source edits and binds both repositories', async () => {
  const f = fixture();
  try {
    const source = gitFixture(path.join(f.root, 'source'));
    const desktop = gitFixture(path.join(f.root, 'desktop'));
    fs.mkdirSync(path.join(desktop.root, 'bin'));
    fs.copyFileSync(path.join(bin, 'verify-sidecar-bundle.sh'), path.join(desktop.root, 'bin/verify-sidecar-bundle.sh'));
    const env = {
      SIDECAR_STAGE_REPO_ROOT: source.root, SIDECAR_STAGE_DESKTOP_ROOT: desktop.root,
      SIDECAR_STAGE_HELPER_ROOT: bin, SIDECAR_STAGE_FINAL_DIR: f.finalDir,
      SIDECAR_STAGE_FAILED_ROOT: f.root,
      SIDECAR_STAGE_TARGET_OS: 'linux', SIDECAR_STAGE_TARGET_ARCH: 'x64',
      PROVENANCE_SOURCE_GIT_HEAD: source.head, PROVENANCE_SOURCE_GIT_DIRTY: 'false',
      PAPERCUSP_DISTRIBUTION_PROFILE: 'vm-release', PAPERCUSP_RELEASE_AUDIT: '1',
    };
    const first = await captureIdentity(env);
    assert.equal(first.sourceHead, source.head);
    assert.equal(first.desktopHead, desktop.head);
    assert.deepEqual(await captureIdentity(env), first);
    recordFailure(f.stage, first, 'assembled', 1);
    fs.writeFileSync(path.join(source.root, 'package-lock.json'), '{"changed":true}\n');
    const changed = await captureIdentity(env);
    assert.equal(changed.sourceHead, first.sourceHead);
    assert.notEqual(changed.sourceState, first.sourceState);
    assert.throws(() => validateResume(f.stage, changed), /identity changed/);
    await assert.rejects(captureIdentity({ ...env, PROVENANCE_SOURCE_GIT_HEAD: 'd'.repeat(40) }), /differs from REPO_ROOT/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('source-state capture streams Git diff output larger than the child-process buffer', async () => {
  const f = fixture();
  try {
    const { root, git } = gitFixture(path.join(f.root, 'large-source'));
    const bytes = 33 * 1024 * 1024;
    const sourceFile = path.join(root, 'large.txt');
    fs.writeFileSync(sourceFile, Buffer.alloc(bytes, 0x61));
    git(['add', 'large.txt']);
    git(['commit', '-qm', 'large baseline']);
    fs.writeFileSync(sourceFile, Buffer.alloc(bytes, 0x62));

    const state = await sourceState(root);
    assert.match(state, /^[a-f0-9]{64}$/);
    assert.equal(state, directSourceState(root), 'source capture must preserve every streamed Git byte');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('source-state preserves direct Git fingerprints for dirty nested and untracked source at the same HEAD', async () => {
  const f = fixture();
  try {
    const source = gitFixture(path.join(f.root, 'source with spaces'));
    const nested = gitFixture(path.join(f.root, 'nested'));
    source.git(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', nested.root, 'nested']);
    source.git(['commit', '-qm', 'nested source']);
    const head = source.git(['rev-parse', 'HEAD']);
    const clean = await sourceState(source.root);
    assert.equal(clean, directSourceState(source.root));
    fs.writeFileSync(path.join(source.root, 'nested/package-lock.json'), '{"nestedChanged":true}\n');
    const dirty = await sourceState(source.root);
    assert.notEqual(dirty, clean);
    assert.equal(dirty, directSourceState(source.root));
    fs.writeFileSync(path.join(source.root, 'untracked source.txt'), 'new source\n');
    const untracked = await sourceState(source.root);
    assert.notEqual(untracked, dirty);
    assert.equal(untracked, directSourceState(source.root));
    assert.equal(source.git(['rev-parse', 'HEAD']), head);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('source-state fails on a real Git error instead of accepting a partial fingerprint', async () => {
  const f = fixture();
  try {
    const direct = spawnSync('git', ['-C', f.root, 'diff', '--no-ext-diff', '--binary', '--submodule=diff', 'HEAD']);
    assert.notEqual(direct.status, 0);
    await assert.rejects(sourceState(f.root), new RegExp('git diff .* failed with ' + direct.status));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('source-state preserves Git exit and signal failures and bounds stderr', () => {
  const f = fixture();
  try {
    const shimRoot = path.join(f.root, 'shim');
    fs.mkdirSync(shimRoot);
    const shim = path.join(shimRoot, 'git');
    const helper = path.join(bin, 'lib/sidecar-stage-state.js');
    const probe = 'require(process.argv[1]).sourceState(process.argv[2]).then(() => { process.exitCode = 99; }, error => { process.stdout.write(error.message); });';
    for (const [script, expected] of [
      ['printf partial; i=0; while [ "$i" -lt 10000 ]; do printf x >&2; i=$((i + 1)); done; exit 23', /failed with 23: x+$/],
      ['kill -TERM $$', /failed with SIGTERM$/],
      ['kill -KILL $$', /failed with SIGKILL$/],
      ['kill -PIPE $$', /failed with SIGPIPE$/],
    ]) {
      fs.writeFileSync(shim, '#!/bin/sh\n' + script + '\n', { mode: 0o700 });
      const result = spawnSync(process.execPath, ['-e', probe, helper, f.root], {
        encoding: 'utf8', env: { ...process.env, PATH: shimRoot + path.delimiter + process.env.PATH },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, expected);
      assert(result.stdout.length < 8400, 'diagnostics must retain at most 8192 stderr bytes');
    }
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('git-sync cannot collect private failed stages, receipts or cut identity scratch', () => {
  const f = fixture();
  try {
    const repo = gitFixture(path.join(f.root, 'repo'));
    fs.copyFileSync(path.join(bin, '../.gitignore'), path.join(repo.root, '.gitignore'));
    const inputs = [
      'src-tauri/sidecar.failed-stage.1234/serve.mjs',
      'src-tauri/sidecar.failed-stage.1234.resume.json',
      'src-tauri/sidecar.failed-stage.1234.resume.json.tmp.5678',
      'src-tauri/sidecar.failed-prior.1234/bin/node',
      'src-tauri/sidecar.tmp.1234.identity.json',
      'src-tauri/sidecar.tmp.1234.identity.json.tmp.5678',
    ];
    const result = execFileSync('git', ['-C', repo.root, 'check-ignore', '--stdin'], { input: `${inputs.join('\n')}\n`, encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(result, inputs);
    const source = spawnSync('git', ['-C', repo.root, 'check-ignore', 'bin/build-desktop-sidecar.sh']);
    assert.equal(source.status, 1, 'producer source must remain tracked');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('failure evidence defaults to an output-scoped external state namespace, not the frozen source', () => {
  const finalDir = '/immutable/product/desktop/src-tauri/sidecar';
  const env = { HOME: '/private/home', XDG_STATE_HOME: '/private/state' };
  const first = failureEvidenceRoot(finalDir, env);
  assert(first.startsWith('/private/state/papercusp/sidecar-failed-stages/'));
  assert.equal(failureEvidenceRoot(finalDir, env), first);
  assert.notEqual(failureEvidenceRoot(`${finalDir}-other`, env), first);
  assert.equal(failureEvidenceRoot(finalDir, { ...env, PAPERCUSP_SIDECAR_FAILED_STAGE_ROOT: '/owned/failure-bank' }), '/owned/failure-bank');
  assert.match(builder, /SIDECAR_FAILED_STAGE_ROOT=.*evidence-root/);
  assert.match(builder, /export SIDECAR_STAGE_FAILED_ROOT="\$SIDECAR_FAILED_STAGE_ROOT"/);
});

test('external failure retention leaves a frozen target with no new gitignore clean and resumes only bound bytes', () => {
  const f = fixture();
  try {
    const product = gitFixture(path.join(f.root, 'product'));
    const failedRoot = path.join(f.root, 'external-evidence');
    fs.mkdirSync(failedRoot);
    f.finalDir = path.join(product.root, 'sidecar');
    f.identity = { ...f.identity, finalDir: f.finalDir, failedStageRoot: failedRoot };
    const tmp = `${f.finalDir}.tmp.5678`;
    const identityFile = path.join(f.root, 'identity.json');
    fs.renameSync(f.stage, tmp);
    writeJson(identityFile, f.identity);
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail', finish,
      'SIDECAR_FINAL_DIR="$1"; SIDECAR_TMP_DIR="$2"; SIDECAR_FAILED_STAGE_ROOT="$3"; HERE="$4"',
      '_sidecar_stage_identity="$5"; _sidecar_stage_phase=assembled',
      '__pc_release_sidecar_publish_lock() { :; }',
      trap, 'exit 1',
    ].join('\n'), 'test', f.finalDir, tmp, failedRoot, bin, identityFile], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(product.git(['status', '--porcelain', '--untracked-files=all']), '');
    const stage = path.join(failedRoot, fs.readdirSync(failedRoot).find(name => /^sidecar\.failed-stage\.\d+$/.test(name)));
    assert.equal(validateResume(stage, f.identity).accepted, false);
    assert.throws(() => validateResume(stage, { ...f.identity, failedStageRoot: product.root }), /failed-stage sibling/);
    fs.writeFileSync(path.join(stage, 'serve.mjs'), 'changed bytes');
    assert.throws(() => validateResume(stage, f.identity), /changed/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('reused container PID preserves earlier bytes and receipt; failed relocation writes no receipt', () => {
  for (const failMove of [false, true]) {
    const f = fixture();
    try {
      const failedRoot = path.join(f.root, 'failure-bank');
      fs.mkdirSync(failedRoot);
      f.identity = { ...f.identity, failedStageRoot: failedRoot };
      const tmp = `${f.finalDir}.tmp.current`;
      fs.renameSync(f.stage, tmp);
      const identityFile = path.join(f.root, 'current-identity.json');
      writeJson(identityFile, f.identity);
      const result = spawnSync('bash', ['-c', [
        'set -euo pipefail', finish,
        'SIDECAR_FINAL_DIR="$1"; SIDECAR_TMP_DIR="$2"; SIDECAR_FAILED_STAGE_ROOT="$3"; HERE="$4"',
        '_sidecar_stage_identity="$5"; _sidecar_stage_phase=assembled',
        'prior="$SIDECAR_FAILED_STAGE_ROOT/sidecar.failed-stage.$$"',
        'mkdir "$prior"; printf previous > "$prior/serve.mjs"',
        'printf previous-receipt > "$prior.resume.json"',
        '__pc_release_sidecar_publish_lock() { :; }',
        ...(failMove ? ['mv() { return 1; }'] : []),
        trap, 'exit 1',
      ].join('\n'), 'test', f.finalDir, tmp, failedRoot, bin, identityFile], { encoding: 'utf8' });
      assert.equal(result.status, 1, result.stderr);
      const names = fs.readdirSync(failedRoot);
      const prior = names.find(name => /^sidecar\.failed-stage\.\d+$/.test(name));
      assert.ok(prior, result.stderr);
      assert.equal(fs.readFileSync(path.join(failedRoot, prior, 'serve.mjs'), 'utf8'), 'previous');
      assert.equal(fs.readFileSync(path.join(failedRoot, `${prior}.resume.json`), 'utf8'), 'previous-receipt');
      if (failMove) {
        assert.match(result.stderr, /could not relocate failed stage/);
        assert.equal(names.length, 2, 'failed relocation must not write a receipt for existing bytes');
        assert.ok(fs.existsSync(tmp), 'unmoved current bytes remain available');
      } else {
        const retained = path.join(failedRoot, `${prior}.1`);
        assert.match(result.stderr, /unaccepted sidecar stage retained/);
        assert.equal(validateResume(retained, f.identity).accepted, false);
        assert.equal(fs.existsSync(tmp), false);
      }
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('stage identity refuses failure evidence placed inside immutable product source', async () => {
  const f = fixture();
  try {
    const source = gitFixture(path.join(f.root, 'source'));
    const desktop = gitFixture(path.join(f.root, 'desktop'));
    await assert.rejects(captureIdentity({
      SIDECAR_STAGE_REPO_ROOT: source.root, SIDECAR_STAGE_DESKTOP_ROOT: desktop.root,
      SIDECAR_STAGE_HELPER_ROOT: bin, SIDECAR_STAGE_FINAL_DIR: f.finalDir,
      SIDECAR_STAGE_FAILED_ROOT: path.join(source.root, 'generated-evidence'),
    }), /must be outside product source/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

function fixture() {
  const root = makeDesktopTestScratchDirSync('sidecar-stage-resume-');
  const finalDir = path.join(root, 'sidecar');
  const stage = `${finalDir}.failed-stage.1234`;
  fs.mkdirSync(path.join(stage, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'serve.mjs'), 'assembled source');
  fs.writeFileSync(path.join(stage, 'bin/node'), 'native executable');
  const identity = { finalDir, sourceHead: 'a'.repeat(40), desktopHead: 'b'.repeat(40), profile: 'vm-release', targetOs: 'linux', targetArch: 'x64', tools: [{ sha256: 'c'.repeat(64) }] };
  return { root, finalDir, stage, identity };
}

async function spaFixture() {
  const f = fixture();
  const source = gitFixture(path.join(f.root, 'source'));
  const snapshot = path.join(f.root, 'snapshot');
  fs.mkdirSync(snapshot);
  fs.writeFileSync(path.join(snapshot, 'index.html'), '<html>portable</html>');
  fs.writeFileSync(path.join(snapshot, 'chunk.js'), 'export default 1');
  fs.symlinkSync('chunk.js', path.join(snapshot, 'chunk-link.js'));
  f.snapshot = snapshot;
  f.identity = { ...f.identity, sourceHead: source.head, desktopHead: source.head,
    sourceState: await sourceState(source.root), desktopState: await sourceState(source.root),
    submodules: 'none', sourceDirty: 'false', version: '0.0.26', buildSha: source.head,
    buildNodeVersion: process.version, spaRecipeSha256: 'd'.repeat(64),
    tools: [{ file: path.join(source.root, 'package-lock.json'), sha256: 'c'.repeat(64) }] };
  captureSpa(snapshot, f.identity);
  return f;
}

test('SPA reuse binds source and recipe while allowing portable bytes across target architectures', async () => {
  const f = await spaFixture();
  try {
    validateSpa(f.snapshot, { ...f.identity, targetArch: 'arm64', repoRoot: '/relocated' });
    for (const [key, value] of Object.entries({ sourceHead: 'e'.repeat(40), desktopHead: 'e'.repeat(40),
      profile: 'dogfood', version: 'different', buildSha: 'different', buildNodeVersion: 'v1.2.3',
      spaRecipeSha256: 'e'.repeat(64), submodules: 'different',
      tools: [{ file: '/package-lock.json', sha256: 'e'.repeat(64) }] })) {
      assert.throws(() => validateSpa(f.snapshot, { ...f.identity, [key]: value }), /binding changed/, key);
    }
    for (const key of ['sourceState', 'desktopState', 'sourceDirty']) {
      assert.throws(() => validateSpa(f.snapshot, { ...f.identity, [key]: 'changed' }), /requires clean/);
    }
    const destination = path.join(f.root, 'copy');
    copySpa(f.snapshot, destination, f.identity);
    assert.deepEqual(inventory(destination), inventory(f.snapshot));
    assert.equal(fs.existsSync(`${destination}.spa.json`), false, 'private receipt is not shipped');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('SPA import refuses tampered bytes, modes, paths and links before publishing a copy', async () => {
  for (const mutate of [
    f => fs.writeFileSync(path.join(f.snapshot, 'chunk.js'), 'tampered'),
    f => fs.chmodSync(path.join(f.snapshot, 'chunk.js'), 0o700),
    f => fs.writeFileSync(path.join(f.snapshot, 'extra'), 'unmeasured'),
    f => fs.rmSync(path.join(f.snapshot, 'index.html')),
    f => { fs.unlinkSync(path.join(f.snapshot, 'chunk-link.js')); fs.symlinkSync('index.html', path.join(f.snapshot, 'chunk-link.js')); },
    f => { fs.unlinkSync(path.join(f.snapshot, 'chunk-link.js')); fs.symlinkSync('../source/package-lock.json', path.join(f.snapshot, 'chunk-link.js')); },
  ]) {
    const f = await spaFixture();
    try {
      mutate(f);
      const destination = path.join(f.root, 'copy');
      assert.throws(() => copySpa(f.snapshot, destination, f.identity), /changed|index.html|escapes/);
      assert.equal(fs.existsSync(destination), false);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('SPA portability rejects native addons and disguised ELF, PE and Mach-O bytes', async () => {
  for (const [name, bytes] of [['addon.node', 'native'], ['hidden.js', Buffer.from([127, 69, 76, 70])],
    ['windows.js', 'MZbinary'], ['mac.js', Buffer.from([0xcf, 0xfa, 0xed, 0xfe])]]) {
    const f = await spaFixture();
    try {
      fs.writeFileSync(path.join(f.snapshot, name), bytes);
      assert.throws(() => captureSpa(f.snapshot, f.identity), /contains native bytes/);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('changed SPA receipt invalidates a previously captured stage even with identical content', async () => {
  const f = await spaFixture();
  try {
    const receiptFile = `${f.snapshot}.spa.json`;
    const receipt = validateSpa(f.snapshot, f.identity);
    const identity = { ...f.identity, spaSnapshot: { root: fs.realpathSync(f.snapshot),
      receiptSha256: crypto.createHash('sha256').update(fs.readFileSync(receiptFile)).digest('hex'),
      contentSha256: receipt.contentSha256 } };
    recordFailure(f.stage, identity, 'assembled', 1);
    fs.appendFileSync(receiptFile, '\n');
    assert.throws(() => validateSpa(f.snapshot, identity), /receipt changed/);
    assert.throws(() => validateResume(f.stage, { ...identity, spaSnapshot: { ...identity.spaSnapshot, receiptSha256: 'e'.repeat(64) } }), /identity changed/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('actual producer SPA branch imports only validated input and bypasses Vite compilation', async () => {
  const f = await spaFixture();
  try {
    const identityFile = path.join(f.root, 'spa-identity.json');
    writeJson(identityFile, f.identity);
    const block = builder.slice(builder.indexOf('if [[ -n "${PAPERCUSP_SPA_SNAPSHOT_FROM:-}" ]]'),
      builder.indexOf('echo "→ building sidecar into'));
    const run = destination => spawnSync('bash', ['-euo', 'pipefail', '-c',
      'npm() { echo unexpected-vite >&2; return 99; };\n' + block], {
      encoding: 'utf8', env: { ...process.env, HERE: bin, SIDECAR_DIR: destination,
        PAPERCUSP_SPA_SNAPSHOT_FROM: f.snapshot, _sidecar_stage_identity: identityFile },
    });
    const good = path.join(f.root, 'producer-copy'); fs.mkdirSync(good);
    const accepted = run(good);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /reused source-bound/);
    assert.deepEqual(inventory(path.join(good, 'spa')), inventory(f.snapshot));
    fs.writeFileSync(path.join(f.snapshot, 'chunk.js'), 'tampered');
    const bad = path.join(f.root, 'producer-refused'); fs.mkdirSync(bad);
    const refused = run(bad);
    assert.notEqual(refused.status, 0); assert.match(refused.stderr, /SPA bytes, paths, modes or links changed/);
    assert.equal(fs.existsSync(path.join(bad, 'spa')), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('completed failed assembly resumes only with exact source, profile, target and producer identity', () => {
  const f = fixture();
  try {
    recordFailure(f.stage, f.identity, 'assembled', 1);
    assert.equal(validateResume(f.stage, f.identity).accepted, false);
    for (const [key, value] of Object.entries({ sourceHead: 'd'.repeat(40), desktopHead: 'd'.repeat(40), profile: 'dogfood', targetOs: 'darwin', targetArch: 'arm64', tools: [] })) {
      assert.throws(() => validateResume(f.stage, { ...f.identity, [key]: value }), /identity changed/, key);
    }
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('changed bytes, added files, removed paths and mode changes invalidate resume', () => {
  for (const mutate of [
    f => fs.writeFileSync(path.join(f.stage, 'serve.mjs'), 'changed source'),
    f => fs.writeFileSync(path.join(f.stage, 'unmeasured'), 'added'),
    f => fs.rmSync(path.join(f.stage, 'bin/node')),
    f => fs.chmodSync(path.join(f.stage, 'serve.mjs'), 0o700),
  ]) {
    const f = fixture();
    try {
      recordFailure(f.stage, f.identity, 'assembled', 1);
      mutate(f);
      assert.throws(() => validateResume(f.stage, f.identity), /changed/);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  }
});

test('partial assembly and missing critical bytes remain retained but cannot resume', () => {
  const f = fixture();
  try {
    const partial = recordFailure(f.stage, f.identity, 'assembling', 1);
    assert.equal(partial.resumable, false);
    assert.throws(() => validateResume(f.stage, f.identity), /no completed assembly/);
    fs.rmSync(path.join(f.stage, 'bin/node'));
    recordFailure(f.stage, f.identity, 'assembled', 1);
    assert.throws(() => validateResume(f.stage, f.identity), /missing critical/);
    assert.equal(fs.existsSync(path.join(f.stage, 'serve.mjs')), true);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('symlink inventory permits internal relocatable links and refuses external or changed links', () => {
  const f = fixture();
  try {
    const link = path.join(f.stage, 'internal');
    fs.symlinkSync('serve.mjs', link);
    recordFailure(f.stage, f.identity, 'assembled', 1);
    validateResume(f.stage, f.identity);
    fs.rmSync(link);
    fs.symlinkSync('bin/node', link);
    assert.throws(() => validateResume(f.stage, f.identity), /changed/);
    fs.rmSync(link);
    fs.symlinkSync(path.join(f.stage, 'serve.mjs'), link);
    assert.throws(() => inventory(f.stage), /escapes relocatable/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('resume refuses a published path or a foreign output sibling', () => {
  const f = fixture();
  try {
    recordFailure(f.stage, f.identity, 'assembled', 1);
    assert.throws(() => validateResume(f.finalDir, f.identity), /failed-stage sibling/);
    assert.throws(() => validateResume(f.stage, { ...f.identity, finalDir: `${f.finalDir}-other` }), /failed-stage sibling/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

function lifecycle(f, { success = false, published = false, status = 1 } = {}) {
  const tmp = `${f.finalDir}.tmp.5678`;
  const old = `${f.finalDir}.old.5678`;
  const lockdir = `${f.finalDir}.lockdir`;
  const identityFile = `${tmp}.identity.json`;
  fs.renameSync(f.stage, published ? f.finalDir : tmp);
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'prior'), 'previous accepted bytes');
  fs.mkdirSync(lockdir);
  writeJson(identityFile, f.identity);
  const result = spawnSync('bash', ['-c', [
    'set -euo pipefail', finish,
    'SIDECAR_FINAL_DIR="$1"; SIDECAR_TMP_DIR="$2"; OLD_DIR="$3"; HERE="$4"',
    '_sidecar_stage_identity="$5"; SIDECAR_PUBLISH_LOCKDIR="$6"',
    '__pc_release_sidecar_publish_lock() { test -d "$SIDECAR_FINAL_DIR" || exit 90; rm -rf "$SIDECAR_PUBLISH_LOCKDIR"; SIDECAR_PUBLISH_LOCKDIR=""; }',
    `_sidecar_stage_phase=assembled; _sidecar_success=${Number(success)}; _sidecar_published=${Number(published)}`,
    trap, `exit ${status}`,
  ].join('\n'), 'test', f.finalDir, tmp, old, bin, identityFile, lockdir], { encoding: 'utf8' });
  return { result, tmp, old, lockdir, identityFile };
}

test('silent shell failure reports its source line and phase through the actual EXIT trap', () => {
  const f = fixture();
  try {
    const lines = [
      'set -euo pipefail', finish,
      'SIDECAR_FINAL_DIR="$1"; SIDECAR_TMP_DIR="$2"; HERE="$3"',
      '_sidecar_stage_phase=assembling; _sidecar_success=0; _sidecar_published=0',
      '__pc_release_sidecar_publish_lock() { :; }',
      failureTrap, trap,
      'false',
    ];
    const failureLine = lines.join('\n').split('\n').length;
    const result = spawnSync('bash', ['-c', lines.join('\n'), 'fixture', f.finalDir, f.stage, bin],
      { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, new RegExp(`source line ${failureLine} \\(phase=assembling, exit=1\\)`));
    assert.match(result.stderr, /unaccepted sidecar stage retained/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('late published failure restores prior output, retains usable evidence and releases locks', () => {
  const f = fixture();
  try {
    const run = lifecycle(f, { published: true });
    assert.equal(run.result.status, 1, run.result.stderr);
    assert.equal(fs.readFileSync(path.join(f.finalDir, 'prior'), 'utf8'), 'previous accepted bytes');
    assert.equal(fs.existsSync(run.old), false);
    assert.equal(fs.existsSync(run.lockdir), false);
    assert.equal(fs.existsSync(run.identityFile), false);
    const failed = fs.readdirSync(f.root).find(name => /^sidecar\.failed-stage\.\d+$/.test(name));
    const receipt = validateResume(path.join(f.root, failed), f.identity);
    assert.equal(receipt.exitCode, 1);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('successful cleanup reaps temporary and prior output without retaining failure receipts', () => {
  const f = fixture();
  try {
    const run = lifecycle(f, { success: true, published: true, status: 0 });
    assert.equal(run.result.status, 0, run.result.stderr);
    for (const file of [run.old, run.tmp, run.lockdir, run.identityFile]) assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(path.join(f.finalDir, 'serve.mjs')), true);
    assert.equal(fs.readdirSync(f.root).some(name => name.includes('failed-stage')), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('exit zero before qualification completes cannot masquerade as a successful build', () => {
  const f = fixture();
  try {
    const run = lifecycle(f, { published: true, status: 0 });
    assert.equal(run.result.status, 1, run.result.stderr);
    assert.equal(fs.readFileSync(path.join(f.finalDir, 'prior'), 'utf8'), 'previous accepted bytes');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('real resume branch consumes validated failed bytes and bypasses assembly only', () => {
  const f = fixture();
  try {
    recordFailure(f.stage, f.identity, 'assembled', 1);
    const expected = path.join(f.root, 'identity.json');
    writeJson(expected, f.identity);
    const tmp = `${f.finalDir}.tmp.5678`;
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'HERE="$1"; PAPERCUSP_SIDECAR_RESUME_FROM="$2"; _sidecar_stage_identity="$3"; SIDECAR_TMP_DIR="$4"',
      resume,
      'if [[ -z "${PAPERCUSP_SIDECAR_RESUME_FROM:-}" ]]; then exit 77; fi',
      'test "$_sidecar_stage_phase" = assembled',
      'test -f "$SIDECAR_TMP_DIR/serve.mjs"',
    ].join('\n'), 'test', bin, f.stage, expected, tmp], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(f.stage), false);
    assert.equal(fs.readFileSync(path.join(tmp, 'serve.mjs'), 'utf8'), 'assembled source');
    const assemblyEnd = builder.indexOf('fi # assembly-only work;');
    for (const gate of ['--prune-vm-release', '--audit-vm-release', '"$HERE/verify-sidecar-bundle.sh"', '--audit-vulnerabilities', '--scan-dir "$SIDECAR_DIR"']) {
      assert(builder.indexOf(gate, assemblyEnd) > assemblyEnd, `${gate} must rerun after resume rejoins`);
    }
    assert(builder.indexOf('_sidecar_success=1', assemblyEnd) > builder.indexOf('--scan-dir "$SIDECAR_DIR"', assemblyEnd));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

// Run the SHIPPED qualification/publish tail against controlled verifier/audit
// executables. This checks gate execution and rollback, not merely source order.
function qualifyResume(f, failGate = '') {
  const source = gitFixture(path.join(f.root, 'source'));
  const here = path.join(f.root, 'producer');
  const target = path.join(f.root, 'desktop');
  const shim = path.join(f.root, 'shims');
  const pg = path.join(f.root, 'papercusp');
  const gateLog = path.join(f.root, 'gates.log');
  for (const dir of [here, path.join(here, 'lib'), path.join(target, 'bin'), shim, path.join(pg, 'libs/db/sql'), path.join(f.stage, 'db-sql')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(pg, 'libs/db/sql/001-initial.sql'), 'select 1;');
  fs.writeFileSync(path.join(f.stage, 'db-sql/001-initial.sql'), 'select 1;');
  for (const model of ['harrier-oss-v1-0.6b-ONNX', 'embeddinggemma-300m-ONNX']) {
    fs.mkdirSync(path.join(f.stage, 'node_modules/@huggingface/transformers/models/onnx-community', model), { recursive: true });
  }
  const qualificationElf = Buffer.alloc(20);
  qualificationElf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  qualificationElf.writeUInt16LE(62, 18);
  fs.writeFileSync(path.join(f.stage, 'bin/node'), qualificationElf);
  fs.writeFileSync(path.join(f.stage, 'node_modules/qualification-order.node'), qualificationElf);
  fs.writeFileSync(path.join(shim, 'objdump'), '#!/usr/bin/env bash\necho addon-libraries >> "$GATE_LOG"\necho "NEEDED libc.so.6"\n', { mode: 0o755 });
  for (const file of ['sidecar-stage-state.js', 'portable-sha256.sh', 'stamp-git-head.sh', 'server-container.mjs']) fs.copyFileSync(path.join(bin, 'lib', file), path.join(here, 'lib', file));
  fs.writeFileSync(path.join(here, 'audit-release-bundle.py'), '# fixture gate\n');
  fs.writeFileSync(path.join(shim, 'python3'), '#!/usr/bin/env bash\nprintf "%s\\n" "$2" >> "$GATE_LOG"\n[[ "$2" != "$FAIL_GATE" ]]\n', { mode: 0o755 });
  fs.writeFileSync(path.join(shim, 'grype'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(here, 'verify-sidecar-bundle.sh'), '#!/usr/bin/env bash\nprintf "verify:%s\\n" "$1" >> "$GATE_LOG"\n[[ "$FAIL_GATE" != "verify" ]]\n', { mode: 0o755 });
  fs.writeFileSync(path.join(here, 'emit-build-provenance.sh'), '#!/usr/bin/env bash\necho provenance >> "$GATE_LOG"\nprintf "{}\\n" > "$1/build-provenance.json"\n', { mode: 0o755 });
  f.identity.sourceHead = source.head;
  recordFailure(f.stage, f.identity, 'assembled', 1);
  const identityFile = path.join(f.root, 'identity.json');
  writeJson(identityFile, f.identity);
  fs.mkdirSync(f.finalDir);
  fs.writeFileSync(path.join(f.finalDir, 'prior'), 'accepted prior');
  const functions = ['assert_sidecar_db_sql_matches_source', 'assert_no_transformers_model_fragments', '__pc_is_cargo_sidecar_placeholder'].map(name => builder.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}`, 'm'))[0]);
  const tail = builder.slice(builder.indexOf('# ── D-043/P-052 immutable runtime-only profile'), builder.indexOf('}  # ── end self-read guard'));
  const result = spawnSync('bash', ['-c', [
    'set -euo pipefail', ...functions, finish,
    '__pc_acquire_sidecar_publish_lock() { echo acquire >> "$GATE_LOG"; }',
    '__pc_release_sidecar_publish_lock() { echo release >> "$GATE_LOG"; }',
    '_sidecar_stage_phase=assembling; _sidecar_published=0; _sidecar_success=0',
    trap, resume, tail,
  ].join('\n')], {
    encoding: 'utf8', env: {
      ...process.env, PATH: `${shim}:${process.env.PATH}`, GATE_LOG: gateLog, FAIL_GATE: failGate,
      HERE: here, ROOT: target, REPO_ROOT: source.root, PAPERCUSP_ROOT: pg,
      TARGET_OS: 'linux', TARGET_ARCH: process.arch,
      SIDECAR_FINAL_DIR: f.finalDir, SIDECAR_TMP_DIR: `${f.finalDir}.tmp.5678`, SIDECAR_DIR: `${f.finalDir}.tmp.5678`,
      _sidecar_stage_identity: identityFile, PAPERCUSP_SIDECAR_RESUME_FROM: f.stage,
      DISTRIBUTION_PROFILE: 'vm-release', TARGET_OS: 'linux', TARGET_ARCH: 'x64',
      PAPERCUSP_RELEASE_AUDIT: '1', PROVENANCE_SOURCE_GIT_HEAD: source.head,
      PROVENANCE_SOURCE_GIT_DIRTY: 'false', PAPERCUSP_BUILD_SHA: source.head, PAPERCUSP_DESKTOP_VERSION: '0.0.0',
    },
  });
  return { result, gates: fs.existsSync(gateLog) ? fs.readFileSync(gateLog, 'utf8').trim().split('\n') : [] };
}

test('resumed assembly executes every current qualification gate before accepting final bytes', () => {
  const f = fixture();
  try {
    const run = qualifyResume(f);
    assert.equal(run.result.status, 0, `${run.result.stdout}\n${run.result.stderr}`);
    for (const gate of ['addon-libraries', '--prune-vm-release', '--audit-vm-release', '--audit-vulnerabilities', 'provenance', '--scan-dir']) assert(run.gates.includes(gate), `missing gate ${gate}`);
    assert(run.gates.indexOf('addon-libraries') < run.gates.indexOf('--prune-vm-release'));
    assert(run.gates.indexOf('addon-libraries') < run.gates.indexOf('--audit-vulnerabilities'));
    assert.equal(run.gates.filter(gate => gate.startsWith('verify:')).length, 2);
    assert(run.gates.indexOf('provenance') < run.gates.indexOf('--scan-dir'));
    assert.equal(fs.existsSync(path.join(f.finalDir, 'serve.mjs')), true);
    const stamp = JSON.parse(fs.readFileSync(path.join(f.finalDir, '.sidecar-build-stamp')));
    assert.equal(stamp.releaseIdentityAudit.passed, true);
    assert.equal(fs.readdirSync(f.root).some(name => /^sidecar\.failed-stage\.\d+$/.test(name)), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('resumed SBOM and final privacy failures stay refused and retain recoverable bytes', () => {
  for (const gate of ['--audit-vulnerabilities', '--scan-dir']) {
    const f = fixture();
    try {
      const run = qualifyResume(f, gate);
      assert.equal(run.result.status, 1, `${run.result.stdout}\n${run.result.stderr}`);
      assert(run.gates.includes(gate));
      assert.equal(fs.readFileSync(path.join(f.finalDir, 'prior'), 'utf8'), 'accepted prior');
      const failed = fs.readdirSync(f.root).find(name => /^sidecar\.failed-stage\.\d+$/.test(name));
      assert(failed, 'failed resume must retain its new stage');
      const receipt = validateResume(path.join(f.root, failed), f.identity);
      assert.equal(receipt.accepted, false);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  }
});
