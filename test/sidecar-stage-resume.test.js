'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { makeDesktopTestScratchDirSync } = require('./test-scratch.cjs');
const { captureIdentity, inventory, recordFailure, validateResume, writeJson } = require('../bin/lib/sidecar-stage-state.js');
const bin = path.resolve(__dirname, '../bin');
const builder = fs.readFileSync(path.join(bin, 'build-desktop-sidecar.sh'), 'utf8');
const finish = builder.match(/^__pc_finish_sidecar_build\(\) \{\n[\s\S]*?^\}$/m)[0];
const trap = builder.match(/^trap '[^\n]*' EXIT$/m)[0];
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
  return { root, head };
}

test('actual source capture detects same-HEAD source edits and binds both repositories', () => {
  const f = fixture();
  try {
    const source = gitFixture(path.join(f.root, 'source'));
    const desktop = gitFixture(path.join(f.root, 'desktop'));
    fs.mkdirSync(path.join(desktop.root, 'bin'));
    fs.copyFileSync(path.join(bin, 'verify-sidecar-bundle.sh'), path.join(desktop.root, 'bin/verify-sidecar-bundle.sh'));
    const env = {
      SIDECAR_STAGE_REPO_ROOT: source.root, SIDECAR_STAGE_DESKTOP_ROOT: desktop.root,
      SIDECAR_STAGE_HELPER_ROOT: bin, SIDECAR_STAGE_FINAL_DIR: f.finalDir,
      SIDECAR_STAGE_TARGET_OS: 'linux', SIDECAR_STAGE_TARGET_ARCH: 'x64',
      PROVENANCE_SOURCE_GIT_HEAD: source.head, PROVENANCE_SOURCE_GIT_DIRTY: 'false',
      PAPERCUSP_DISTRIBUTION_PROFILE: 'vm-release', PAPERCUSP_RELEASE_AUDIT: '1',
    };
    const first = captureIdentity(env);
    assert.equal(first.sourceHead, source.head);
    assert.equal(first.desktopHead, desktop.head);
    assert.deepEqual(captureIdentity(env), first);
    recordFailure(f.stage, first, 'assembled', 1);
    fs.writeFileSync(path.join(source.root, 'package-lock.json'), '{"changed":true}\n');
    const changed = captureIdentity(env);
    assert.equal(changed.sourceHead, first.sourceHead);
    assert.notEqual(changed.sourceState, first.sourceState);
    assert.throws(() => validateResume(f.stage, changed), /identity changed/);
    assert.throws(() => captureIdentity({ ...env, PROVENANCE_SOURCE_GIT_HEAD: 'd'.repeat(40) }), /differs from REPO_ROOT/);
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
    for (const gate of ['--prune-vm-release', '--audit-vm-release', '"$ROOT/bin/verify-sidecar-bundle.sh"', '--audit-vulnerabilities', '--scan-dir "$SIDECAR_DIR"']) {
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
  for (const file of ['sidecar-stage-state.js', 'portable-sha256.sh', 'stamp-git-head.sh']) fs.copyFileSync(path.join(bin, 'lib', file), path.join(here, 'lib', file));
  fs.writeFileSync(path.join(here, 'audit-release-bundle.py'), '# fixture gate\n');
  fs.writeFileSync(path.join(shim, 'python3'), '#!/usr/bin/env bash\nprintf "%s\\n" "$2" >> "$GATE_LOG"\n[[ "$2" != "$FAIL_GATE" ]]\n', { mode: 0o755 });
  fs.writeFileSync(path.join(shim, 'grype'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(target, 'bin/verify-sidecar-bundle.sh'), '#!/usr/bin/env bash\nprintf "verify:%s\\n" "$1" >> "$GATE_LOG"\n[[ "$FAIL_GATE" != "verify" ]]\n', { mode: 0o755 });
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
    for (const gate of ['--prune-vm-release', '--audit-vm-release', '--audit-vulnerabilities', 'provenance', '--scan-dir']) assert(run.gates.includes(gate), `missing gate ${gate}`);
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
