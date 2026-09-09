const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const { apply, verify, attestation, manifest, hash, forRoles, compileConfig } = require('../bin/lib/windows-source-repair');
const root = path.resolve(__dirname, '..');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-source-repair-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Test Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  fs.mkdirSync(path.join(repo, 'src-tauri/src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src-tauri/tauri.conf.json'),
    JSON.stringify({ identifier: 'com.papercusp.gui' }));
  fs.writeFileSync(path.join(repo, 'src-tauri/tauri.server.conf.json'),
    JSON.stringify({ identifier: 'com.papercusp.server' }));
  fs.writeFileSync(path.join(repo, 'src-tauri/src/wsl_setup.rs'), 'old\n');
  git('add', '.'); git('commit', '-qm', 'fixture base');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'src-tauri/src/wsl_setup.rs'), 'new\n');
  fs.writeFileSync(path.join(repo, 'src-tauri/src/wsl_runtime_resources.rs'), 'resolver\n');
  git('add', '.'); git('commit', '-qm', 'fixture repair');
  const repair = git('rev-parse', 'HEAD');
  const snapshot = path.join(dir, 'snapshot');
  git('worktree', 'add', '--detach', snapshot, base);
  const value = {
    schemaVersion: 1, kind: 'windows-gui-source-repair', workItem: 'EI-123',
    baseDesktopCommit: base, baseWorkspaceCommit: 'e'.repeat(40),
    operatorBuildSha: base.slice(0, 8),
    files: [
      { path: 'src-tauri/src/wsl_setup.rs', sourceCommit: repair,
        beforeSha256: hash(Buffer.from('old\n')), afterSha256: hash(Buffer.from('new\n')) },
      { path: 'src-tauri/src/wsl_runtime_resources.rs', sourceCommit: repair,
        beforeSha256: null, afterSha256: hash(Buffer.from('resolver\n')) },
    ],
  };
  return { dir, repo, snapshot, value, base, apply: (requestedRoles) => apply(
    value, repo, snapshot, base, value.baseWorkspaceCommit, requestedRoles,
  ) };
}

test('legacy GUI manifests retain the exact original serialization and digest', (t) => {
  const f = fixture(t);
  const oldShape = {
    schemaVersion: 1, kind: f.value.kind, workItem: f.value.workItem,
    baseDesktopCommit: f.base, baseWorkspaceCommit: f.value.baseWorkspaceCommit,
    operatorBuildSha: f.value.operatorBuildSha,
    files: [...f.value.files].sort((a, b) => a.path.localeCompare(b.path)),
  };
  const expected = { ...oldShape, manifestSha256: hash(Buffer.from(JSON.stringify(oldShape))) };
  assert.equal(JSON.stringify(manifest(f.value)), JSON.stringify(expected));
  assert.deepEqual(forRoles(f.value, 'gui'), expected);
  assert.throws(() => forRoles(f.value, 'server'), /roles mismatch/);
  assert.throws(() => forRoles(f.value, 'gui server'), /roles mismatch/);
  assert.throws(() => manifest({ ...f.value, roles: ['server'] }), /legacy repair is GUI-only/);
});

for (const requested of [['server'], ['gui'], ['server', 'gui']]) {
  test(`explicit ${requested.join('/')} repair binds apply, verify, config and provenance roles`, (t) => {
    const f = fixture(t);
    Object.assign(f.value, { kind: 'windows-native-source-repair', roles: requested });
    const applied = f.apply(requested.join(' '));
    assert.deepEqual(applied.roles, [...requested].sort());
    assert.deepEqual(verify(applied, f.snapshot, requested), applied);
    assert.deepEqual(attestation(applied, f.snapshot, f.value.operatorBuildSha, f.base,
      requested.join(' ')), applied);
    for (const role of requested) {
      const config = compileConfig(applied, f.snapshot, role);
      assert.equal(config.identifier || 'com.papercusp.gui', `com.papercusp.${role}`);
    }
    assert.throws(() => verify(applied, f.snapshot), /roles must explicitly name/);
    assert.throws(() => attestation(applied, f.snapshot, f.value.operatorBuildSha, f.base),
      /roles must explicitly name/);
    fs.writeFileSync(path.join(f.snapshot, 'src-tauri/src/unmanifested.rs'), 'not allowed');
    assert.throws(() => verify(applied, f.snapshot, requested), /unmanifested native source delta/);
  });
}

test('explicit roles reject missing, unknown, duplicate and mismatched scopes before writing', (t) => {
  const f = fixture(t);
  Object.assign(f.value, { kind: 'windows-native-source-repair', roles: ['server'] });
  for (const invalid of [undefined, [], ['desktop'], ['gui', 'gui'], 'server']) {
    assert.throws(() => manifest({ ...f.value, roles: invalid }), /role/);
  }
  for (const requested of [undefined, '', 'gui', 'gui server', 'server server', 'unknown',
    ' server', 'server ', 'server\t', 'server\ngui', 'gui  server']) {
    assert.throws(() => f.apply(requested), /role/);
    assert.equal(fs.readFileSync(path.join(f.snapshot, 'src-tauri/src/wsl_setup.rs'), 'utf8'), 'old\n');
  }
  const normalized = manifest({ ...f.value, roles: ['server', 'gui'] });
  assert.equal(normalized.manifestSha256,
    manifest({ ...f.value, roles: ['gui', 'server'] }).manifestSha256);
  assert.notEqual(normalized.manifestSha256, manifest(f.value).manifestSha256);
  f.value.files[0].afterSha256 = '0'.repeat(64);
  assert.throws(() => f.apply('server'), /committed repair hash mismatch/);
});

test('producer preflight refuses wrong roles and nonempty quarantine before toolchain execution', (t) => {
  const f = fixture(t);
  const input = path.join(f.dir, 'input.json');
  const script = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');
  const start = script.indexOf('ROLES="${PAPERCUSP_BUILD_ROLES');
  const end = script.indexOf('# Resolve the cargo target dir', start);
  assert.ok(start > 0 && end > start);
  const output = path.join(f.dir, 'quarantine'); fs.mkdirSync(output);
  const sentinel = path.join(output, 'prior-installer.exe'); fs.writeFileSync(sentinel, 'immutable');
  const run = (value, requestedRoles) => {
    fs.writeFileSync(input, JSON.stringify(value));
    return spawnSync('bash', ['-c',
      `set -euo pipefail\nfail() { echo "$*" >&2; exit 1; }\n${script.slice(start, end)}`], {
      encoding: 'utf8', env: {
        ...process.env, HERE: path.join(root, 'bin'),
        PAPERCUSP_BUILD_ROLES: requestedRoles, PAPERCUSP_WINDOWS_SOURCE_REPAIR: input,
        PAPERCUSP_WINDOWS_OUTPUT_DIR: output,
      },
    });
  };
  const wrongRole = run(f.value, 'server');
  assert.notEqual(wrongRole.status, 0);
  assert.match(wrongRole.stderr, /roles must exactly match/);
  const native = { ...f.value, kind: 'windows-native-source-repair', roles: ['server'] };
  const nonempty = run(native, 'server');
  assert.notEqual(nonempty.status, 0);
  assert.match(nonempty.stderr, /source repair output must be empty/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'immutable');
  fs.unlinkSync(sentinel);
  const valid = run(native, 'server');
  assert.equal(valid.status, 0, valid.stderr);
});

test('role configuration and attestation refuse a Server build configured as GUI', (t) => {
  const f = fixture(t);
  Object.assign(f.value, { kind: 'windows-native-source-repair', roles: ['server'] });
  const applied = f.apply('server');
  assert.throws(() => compileConfig(applied, f.snapshot, 'gui'), /compile role outside/);
  fs.writeFileSync(path.join(f.snapshot, 'src-tauri/tauri.server.conf.json'),
    JSON.stringify({ identifier: 'com.papercusp.gui' }));
  assert.throws(() => compileConfig(applied, f.snapshot, 'server'), /compile identifier mismatch/);
  assert.throws(() => attestation(applied, f.snapshot, f.value.operatorBuildSha, f.base, 'server'),
    /compile identifier mismatch/);
});

test('Server repair never restages frozen payloads and refuses missing generated inputs', (t) => {
  const f = fixture(t);
  const script = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');
  const start = script.indexOf('# ── Server-only source-tree + env-sidecar staging.');
  const end = script.indexOf('# ── Immutable build-source snapshot', start);
  assert.ok(start > 0 && end > start);
  const src = path.join(f.snapshot, 'src-tauri');
  const frozen = ['sidecar/source.tar.zst', 'env-sidecars/staging/serve.mjs',
    'env-sidecars/staging/spa/index.html'];
  for (const relative of frozen) {
    const dest = path.join(src, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `frozen:${relative}`);
  }
  const run = () => spawnSync('bash', ['-c',
    `set -euo pipefail\nfail() { echo "$*" >&2; exit 1; }\n` +
    `__pc_acquire_sidecar_flock() { fail 'must not restage a frozen source'; }\n${script.slice(start, end)}`], {
    encoding: 'utf8', env: {
      ...process.env, ROOT: f.snapshot, SRC_TAURI: src, SOURCE_REPAIR: 'manifest-present',
      ROLES: 'gui server', PAPERCUSP_STAGE_SOURCE: '1',
    },
  });
  assert.equal(run().status, 0);
  for (const relative of frozen) {
    assert.equal(fs.readFileSync(path.join(src, relative), 'utf8'), `frozen:${relative}`);
  }
  assert.equal(fs.existsSync(path.join(src, 'sidecar.lock')), false);
  fs.unlinkSync(path.join(src, frozen[0]));
  const missing = run();
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /requires the frozen source.tar.zst/);
});

test('materializes only exact committed repair bytes and attests a stable source identity', (t) => {
  const f = fixture(t);
  const applied = f.apply();
  assert.equal(fs.readFileSync(path.join(f.snapshot, 'src-tauri/src/wsl_setup.rs'), 'utf8'), 'new\n');
  assert.equal(applied.manifestSha256, manifest(f.value).manifestSha256);
  assert.deepEqual(verify(applied, f.snapshot), applied);
  assert.throws(f.apply, /already exists|baseline changed/);
});

test('invalid committed bytes reject the entire repair before any write', (t) => {
  const f = fixture(t);
  f.value.files[0].afterSha256 = '0'.repeat(64);
  assert.throws(f.apply, /committed repair hash mismatch/);
  assert.equal(fs.readFileSync(path.join(f.snapshot, 'src-tauri/src/wsl_setup.rs'), 'utf8'), 'old\n');
  assert.equal(fs.existsSync(path.join(f.snapshot, 'src-tauri/src/wsl_runtime_resources.rs')), false);
});

test('refuses mismatched bases, traversal, duplicates, symlinks and uncommitted inputs', (t) => {
  const f = fixture(t);
  assert.throws(() => apply(f.value, f.repo, f.snapshot, 'a'.repeat(40),
    f.value.baseWorkspaceCommit), /wrong desktop base/);
  for (const edit of [
    (v) => { v.files[0].path = 'src-tauri/src/../../outside.rs'; },
    (v) => { v.files.push(v.files[0]); },
    (v) => { v.files[0].sourceCommit = 'HEAD'; },
    (v) => { v.operatorBuildSha = 'z'.repeat(8); },
  ]) {
    const value = structuredClone(f.value); edit(value);
    assert.throws(() => apply(value, f.repo, f.snapshot, f.base, value.baseWorkspaceCommit));
  }
  fs.unlinkSync(path.join(f.snapshot, 'src-tauri/src/wsl_setup.rs'));
  fs.symlinkSync(path.join(f.repo, 'src-tauri/src/wsl_setup.rs'),
    path.join(f.snapshot, 'src-tauri/src/wsl_setup.rs'));
  assert.throws(f.apply, /symlink/);
});

test('post-build verification rejects any unmanifested or modified native source', (t) => {
  const f = fixture(t);
  const applied = f.apply();
  fs.writeFileSync(path.join(f.snapshot, 'src-tauri/src/extra.rs'), 'unreviewed\n');
  assert.throws(() => verify(applied, f.snapshot), /unmanifested native source delta/);
  fs.unlinkSync(path.join(f.snapshot, 'src-tauri/src/extra.rs'));
  fs.appendFileSync(path.join(f.snapshot, 'src-tauri/src/wsl_setup.rs'), 'drift\n');
  assert.throws(() => verify(applied, f.snapshot), /repair source changed/);
});

test('a provenance attestation cannot mislabel the paired operator or base commit', (t) => {
  const f = fixture(t);
  const applied = f.apply();
  assert.deepEqual(attestation(applied, f.snapshot, f.value.operatorBuildSha, f.base), applied);
  assert.throws(() => attestation(applied, f.snapshot, 'a'.repeat(8), f.base),
    /paired operator identity mismatch/);
  assert.throws(() => attestation(applied, f.snapshot, f.value.operatorBuildSha, 'b'.repeat(40)),
    /base provenance mismatch/);
});

for (const explicitRoles of [null, ['server'], ['gui', 'server']]) {
test(`existing provenance emitter records ${explicitRoles || 'legacy GUI'} repair and cannot call it clean`, (t) => {
  const f = fixture(t);
  if (explicitRoles) Object.assign(f.value, { kind: 'windows-native-source-repair', roles: explicitRoles });
  const requested = explicitRoles?.join(' ');
  const applied = f.apply(requested);
  const input = path.join(f.dir, 'repair.json');
  fs.writeFileSync(input, JSON.stringify(applied));
  const out = path.join(f.dir, 'out'); fs.mkdirSync(out);
  const artifact = path.join(out, `${explicitRoles?.join('-') || 'GUI'}.exe`);
  fs.writeFileSync(artifact, 'new executable');
  const emit = (roleEnv) => spawnSync('bash', [path.join(root, 'bin/emit-build-provenance.sh'),
    out, '0.0.19', f.value.operatorBuildSha, 'false', artifact], {
    encoding: 'utf8', env: {
      ...process.env, PROVENANCE_GIT_ROOT: f.snapshot,
      PROVENANCE_SOURCE_GIT_HEAD: f.base, PROVENANCE_SOURCE_GIT_DIRTY: 'false',
      PROVENANCE_SOURCE_REPAIR_MANIFEST: input,
      PROVENANCE_SOURCE_REPAIR_ROLES: roleEnv || '',
    },
  });
  if (explicitRoles) {
    for (const invalid of ['', 'gui']) {
      const refused = emit(invalid);
      assert.notEqual(refused.status, 0, refused.stderr);
      assert.equal(fs.existsSync(path.join(out, 'build-provenance.json')), false);
    }
  }
  const result = emit(requested);
  assert.equal(result.status, 0, result.stderr);
  const provenance = JSON.parse(fs.readFileSync(path.join(out, 'build-provenance.json')));
  assert.equal(provenance.gitDirty, true);
  assert.deepEqual(provenance.sourceRepair, applied);
  assert.equal(provenance.artifacts[0].sha256, hash(Buffer.from('new executable')));
});
}

test('real producer compile invocation binds both roles and overrides inherited TAURI_CONFIG', (t) => {
  const f = fixture(t);
  Object.assign(f.value, { kind: 'windows-native-source-repair', roles: ['gui', 'server'] });
  const applied = f.apply('gui server');
  const input = path.join(f.dir, 'repair.json');
  fs.writeFileSync(input, JSON.stringify(applied));
  const bin = path.join(f.dir, 'bin'); fs.mkdirSync(bin);
  const receipt = path.join(f.dir, 'compile-config.jsonl');
  fs.writeFileSync(path.join(bin, 'cargo'), '#!/bin/bash\nprintf "%s\\n" "$TAURI_CONFIG" >>"$CONFIG_RECEIPT"\n');
  fs.chmodSync(path.join(bin, 'cargo'), 0o755);
  const script = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');
  const start = script.indexOf('for role in $ROLES; do');
  const end = script.indexOf('  EXE="$CROSS_EXE"', start);
  assert.ok(start > 0 && end > start);
  const result = spawnSync('bash', ['-c',
    `set -euo pipefail\nfail() { echo "$*" >&2; exit 1; }\n${script.slice(start, end)}\ndone`], {
    encoding: 'utf8', env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, CONFIG_RECEIPT: receipt,
      ROOT: f.snapshot, SRC_TAURI: path.join(f.snapshot, 'src-tauri'),
      HERE: path.join(root, 'bin'), SOURCE_REPAIR_APPLIED: input,
      ROLES: 'gui server', TARGET: 'x86_64-pc-windows-msvc',
      _WIN_REMAP: '', _WIN_CRT_STATIC: '', TAURI_CONFIG: '{"identifier":"wrong.inherited.role"}',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(receipt, 'utf8').trim().split('\n').map(JSON.parse),
    [{}, { identifier: 'com.papercusp.server' }]);
});

test('Windows producer applies/verifies repair around compile and keeps output separate', () => {
  const script = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');
  assert.ok(script.indexOf('windows-source-repair.js" apply') < script.indexOf('cargo xwin build --release'));
  assert.ok(script.indexOf('windows-source-repair.js" verify') > script.indexOf('cargo xwin build --release'));
  assert.ok(script.indexOf('windows-source-repair.js" roles') < script.indexOf('cargo metadata'));
  assert.match(script, /source repair roles must exactly match requested build roles/);
  assert.match(script, /source repair output must be empty/);
  assert.match(script, /OUT_DIR="\$PAPERCUSP_WINDOWS_OUTPUT_DIR"/);
  assert.match(script, /PROVENANCE_SOURCE_REPAIR_MANIFEST="\$SOURCE_REPAIR_APPLIED"/);
  assert.match(script, /PROVENANCE_SOURCE_REPAIR_ROLES="\$ROLES"/);
  assert.match(script, /bash "\$HERE\/emit-build-provenance\.sh"/);
});
