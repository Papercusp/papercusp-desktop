const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const { apply, verify, attestation, manifest, hash, forRoles, compileConfig,
  renderCargoVersion, SHA2_DECLARATION } = require('../bin/lib/windows-source-repair');
const root = path.resolve(__dirname, '..');

function fixture(t, composed = false) {
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
  const cargoBase = {
    'src-tauri/Cargo.toml': '[package]\nname = "papercusp-desktop"\nversion = "0.0.18"\n' +
      '[dependencies]\nserde_json = "1"\n[build-dependencies]\ntauri-build = "2"\n',
    'src-tauri/Cargo.lock': 'version = 3\n\n[[package]]\nname = "papercusp-desktop"\nversion = "0.0.18"\n' +
      'dependencies = [\n "serde_json",\n]\n\n[[package]]\nname = "sha2"\nversion = "0.10.9"\n',
  };
  if (composed) {
    for (const [relative, bytes] of Object.entries(cargoBase)) fs.writeFileSync(path.join(repo, relative), bytes);
    fs.mkdirSync(path.join(repo, 'src-tauri/windows/inno'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src-tauri/windows/inno/papercusp.iss'), 'old installer\n');
  }
  git('add', '.'); git('commit', '-qm', 'fixture base');
  const base = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'src-tauri/src/wsl_setup.rs'), 'new\n');
  fs.writeFileSync(path.join(repo, 'src-tauri/src/wsl_runtime_resources.rs'), 'resolver\n');
  const cargoAfter = Object.fromEntries(Object.entries(cargoBase).map(([p, bytes]) => [p,
    p.endsWith('.toml') ? bytes.replace('serde_json = "1"\n', 'serde_json = "1"\n' + SHA2_DECLARATION)
      : bytes.replace(' "serde_json",\n', ' "serde_json",\n "sha2",\n')]));
  if (composed) {
    for (const [relative, bytes] of Object.entries(cargoAfter)) fs.writeFileSync(path.join(repo, relative), bytes);
    fs.writeFileSync(path.join(repo, 'src-tauri/windows/inno/papercusp.iss'), 'reconciled installer\n');
  }
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
  if (composed) {
    Object.assign(value, { schemaVersion: 2, kind: 'windows-native-source-repair',
      roles: ['gui', 'server'], releaseVersion: '0.0.19' });
    for (const relative of Object.keys(cargoBase)) {
      value.files.push({ path: relative, sourceCommit: repair,
        beforeSha256: hash(Buffer.from(cargoBase[relative])), afterSha256: hash(Buffer.from(cargoAfter[relative])),
        materializedSha256: hash(renderCargoVersion(Buffer.from(cargoAfter[relative]), relative, value.releaseVersion)) });
      fs.writeFileSync(path.join(snapshot, relative),
        renderCargoVersion(Buffer.from(cargoBase[relative]), relative, value.releaseVersion));
    }
    value.files.push({ path: 'src-tauri/windows/inno/papercusp.iss', sourceCommit: repair,
      beforeSha256: hash(Buffer.from('old installer\n')), afterSha256: hash(Buffer.from('reconciled installer\n')) });
  }
  return { dir, repo, snapshot, value, base, git, cargoBase, cargoAfter, apply: (requestedRoles) => apply(
    value, repo, snapshot, base, value.baseWorkspaceCommit, requestedRoles,
  ) };
}

test('v2 composes only pinned sha2 and Inno bytes while preserving release version and provenance', (t) => {
  const f = fixture(t, true);
  const applied = f.apply('gui server');
  for (const file of applied.files) assert.equal(hash(fs.readFileSync(path.join(f.snapshot, file.path))),
    file.materializedSha256 || file.afterSha256);
  assert.match(fs.readFileSync(path.join(f.snapshot, 'src-tauri/Cargo.toml'), 'utf8'), /version = "0.0.19"/);
  assert.deepEqual(attestation(applied, f.snapshot, f.value.operatorBuildSha, f.base, 'gui server', '0.0.19'), applied);
  for (const version of [undefined, '0.0.18']) assert.throws(() =>
    attestation(applied, f.snapshot, f.value.operatorBuildSha, f.base, 'gui server', version), /artifact version/);
  fs.appendFileSync(path.join(f.snapshot, 'src-tauri/windows/inno/papercusp.iss'), 'drift');
  assert.throws(() => verify(applied, f.snapshot, 'gui server'), /repair source changed/);
});

test('v2 rejects unsupported paths, incomplete Cargo pairs and mislabelled rendered hashes before writes', (t) => {
  const f = fixture(t, true);
  for (const relative of ['src-tauri/build.rs', 'src-tauri/tauri.conf.json', 'src-tauri/resources/bootstrap.sh',
    'src-tauri/windows/inno/other.iss', 'src-tauri/src/../Cargo.toml']) {
    const value = structuredClone(f.value); value.files[0].path = relative;
    assert.throws(() => apply(value, f.repo, f.snapshot, f.base, value.baseWorkspaceCommit, 'gui server'),
      /unsupported native repair path/);
  }
  for (const relative of Object.keys(f.cargoBase)) {
    const value = structuredClone(f.value); value.files = value.files.filter((p) => p.path !== relative);
    assert.throws(() => manifest(value), /complete Cargo pair/);
  }
  const file = f.value.files.find((p) => p.path.endsWith('.lock'));
  file.materializedSha256 = file.afterSha256; // committed 0.0.18 is NOT compiled 0.0.19
  assert.throws(() => f.apply('gui server'), /release-rendered Cargo hash mismatch/);
  assert.equal(fs.readFileSync(path.join(f.snapshot, 'src-tauri/src/wsl_setup.rs'), 'utf8'), 'old\n');
  assert.equal(fs.readFileSync(path.join(f.snapshot, 'src-tauri/windows/inno/papercusp.iss'), 'utf8'), 'old installer\n');
});

for (const relative of ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
  test(`v2 rejects a committed, hash-matching unrelated dependency/version change in ${relative}`, (t) => {
    const f = fixture(t, true);
    const bad = f.cargoAfter[relative].replace(relative.endsWith('.lock') ? '"0.10.9"' : '"1"',
      relative.endsWith('.lock') ? '"0.10.8"' : '"2"');
    fs.writeFileSync(path.join(f.repo, relative), bad);
    f.git('add', relative); f.git('commit', '-qm', 'unrelated dependency change');
    const file = f.value.files.find((p) => p.path === relative);
    file.sourceCommit = f.git('rev-parse', 'HEAD');
    file.afterSha256 = hash(Buffer.from(bad));
    file.materializedSha256 = hash(renderCargoVersion(Buffer.from(bad), relative, f.value.releaseVersion));
    assert.throws(() => f.apply('gui server'), /only the pinned sha2/);
    assert.equal(fs.readFileSync(path.join(f.snapshot, 'src-tauri/src/wsl_setup.rs'), 'utf8'), 'old\n');
  });
  test(`v2 refuses baseline drift and post-apply Cargo drift in ${relative}`, (t) => {
    const f = fixture(t, true);
    const before = fs.readFileSync(path.join(f.snapshot, relative));
    fs.appendFileSync(path.join(f.snapshot, relative), '# untracked input\n');
    assert.throws(() => f.apply('gui server'), /snapshot baseline changed/);
    fs.writeFileSync(path.join(f.snapshot, relative), before);
    const applied = f.apply('gui server');
    fs.appendFileSync(path.join(f.snapshot, relative), '# late mutation\n');
    assert.throws(() => verify(applied, f.snapshot, 'gui server'), /repair source changed/);
  });
}

test('v2 catches unmanifested installer helpers and symlinked composition paths', (t) => {
  const f = fixture(t, true);
  const applied = f.apply('gui server');
  const extra = path.join(f.snapshot, 'src-tauri/windows/inno/extra.iss');
  fs.writeFileSync(extra, 'unmanifested');
  assert.throws(() => verify(applied, f.snapshot, 'gui server'), /unmanifested native source delta/);
  fs.unlinkSync(extra);
  const cargo = path.join(f.snapshot, 'src-tauri/Cargo.toml');
  const bytes = fs.readFileSync(cargo); fs.unlinkSync(cargo);
  const target = path.join(f.dir, 'outside.toml'); fs.writeFileSync(target, bytes);
  fs.symlinkSync(target, cargo);
  assert.throws(() => verify(applied, f.snapshot, 'gui server'), /symlink/);
});

test('v2 preflight rejects extra native/installer files without partially applying a valid repair', (t) => {
  const f = fixture(t, true);
  for (const p of ['src-tauri/src/extra.rs', 'src-tauri/windows/inno/extra.iss']) {
    const extra = path.join(f.snapshot, p); fs.writeFileSync(extra, 'unmanifested');
    assert.throws(() => f.apply('gui server'), /unmanifested native source delta before repair/);
    assert.equal(fs.readFileSync(path.join(f.snapshot, 'src-tauri/src/wsl_setup.rs'), 'utf8'), 'old\n');
    fs.unlinkSync(extra);
  }
});

test('v2 existing provenance emitter binds artifact version and records rendered Cargo and installer pins', (t) => {
  const f = fixture(t, true);
  const applied = f.apply('gui server');
  const input = path.join(f.dir, 'repair.json'); fs.writeFileSync(input, JSON.stringify(applied));
  const out = path.join(f.dir, 'out'); fs.mkdirSync(out);
  const artifact = path.join(out, 'Server.exe'); fs.writeFileSync(artifact, 'new server');
  const emit = (version) => spawnSync('bash', [path.join(root, 'bin/emit-build-provenance.sh'),
    out, version, f.value.operatorBuildSha, 'false', artifact], {
    encoding: 'utf8', env: { ...process.env, PROVENANCE_GIT_ROOT: f.snapshot,
      PROVENANCE_SOURCE_REPAIR_MANIFEST: input, PROVENANCE_SOURCE_REPAIR_ROLES: 'gui server' },
  });
  const wrong = emit('0.0.18');
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /artifact version/);
  assert.equal(fs.existsSync(path.join(out, 'build-provenance.json')), false);
  const good = emit('0.0.19'); assert.equal(good.status, 0, good.stderr);
  const provenance = JSON.parse(fs.readFileSync(path.join(out, 'build-provenance.json')));
  assert.deepEqual(provenance.sourceRepair, applied);
  assert.equal(provenance.version, applied.releaseVersion);
  assert.equal(provenance.gitDirty, true);
});

test('real producer composes AFTER frozen version inputs so the Cargo repair cannot be overwritten', (t) => {
  const f = fixture(t, true);
  const input = path.join(f.dir, 'input.json'); fs.writeFileSync(input, JSON.stringify(f.value));
  const frozen = path.join(f.dir, 'frozen'); fs.mkdirSync(path.join(frozen, 'src-tauri'), { recursive: true });
  fs.writeFileSync(path.join(frozen, 'package.json'), '{"version":"0.0.19"}');
  fs.copyFileSync(path.join(f.snapshot, 'src-tauri/tauri.conf.json'), path.join(frozen, 'src-tauri/tauri.conf.json'));
  for (const p of Object.keys(f.cargoBase)) fs.copyFileSync(path.join(f.snapshot, p), path.join(frozen, p));
  const script = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');
  const start = script.indexOf('for _release_input in package.json');
  const end = script.indexOf('copy_superproject_snapshot_blob "$WINDOWS_CSP_POLICY_REL"', start);
  assert.ok(start > 0 && end > start);
  assert.ok(script.indexOf('windows-source-repair.js" apply') > start);
  const result = spawnSync('bash', ['-c',
    'set -euo pipefail\nfail() { echo "$*" >&2; exit 1; }\n' +
    'copy_snapshot_input() { cp "$SOURCE_ROOT/$1" "$BUILD_ROOT/$1"; }\n' + script.slice(start, end)], {
    encoding: 'utf8', env: { ...process.env, SOURCE_ROOT: frozen, BUILD_ROOT: f.snapshot,
      BUILD_CONTAINER: f.dir, SOURCE_REPAIR: input, PROVENANCE_TOOLS_ROOT: path.join(root, 'bin'),
      PAPERCUSP_WINDOWS_SOURCE_REPAIR_REPO: f.repo, BUILD_COMMIT_SHA: f.base,
      BUILD_SUPERPROJECT_COMMIT_SHA: f.value.baseWorkspaceCommit, ROLES: 'gui server' },
  });
  assert.equal(result.status, 0, result.stderr);
  const applied = JSON.parse(fs.readFileSync(path.join(f.dir, 'source-repair.json')));
  assert.deepEqual(verify(applied, f.snapshot, 'gui server'), applied);
});

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
    fs.writeFileSync(dest, relative === 'env-sidecars/staging/serve.mjs'
      ? 'frozen:ensureOAuthStateKeyFile'
      : `frozen:${relative}`);
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
    const expected = relative === 'env-sidecars/staging/serve.mjs'
      ? 'frozen:ensureOAuthStateKeyFile'
      : `frozen:${relative}`;
    assert.equal(fs.readFileSync(path.join(src, relative), 'utf8'), expected);
  }
  assert.equal(fs.existsSync(path.join(src, 'sidecar.lock')), false);
  fs.unlinkSync(path.join(src, frozen[0]));
  const missing = run();
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /requires the frozen source.tar.zst/);

  fs.writeFileSync(path.join(src, frozen[0]), 'frozen:sidecar/source.tar.zst');
  fs.writeFileSync(path.join(src, frozen[1]), 'frozen:serve-without-oauth-key-fix');
  const missingOAuthFix = run();
  assert.notEqual(missingOAuthFix.status, 0);
  assert.match(missingOAuthFix.stderr, /requires the OAuth state key-file fix/);

  fs.writeFileSync(path.join(src, frozen[1]),
    'ensureOAuthStateKeyFile;env2&&env2.length>=32?secretKey=Buffer.from(env2,"utf8"):secretKey=randomBytes');
  const legacyOAuthFallback = run();
  assert.notEqual(legacyOAuthFallback.status, 0);
  assert.match(legacyOAuthFallback.stderr, /refuses the legacy per-process OAuth state random fallback/);
});

test('tracked Windows source-repair env-sidecar carries the OAuth state key-file fix', () => {
  const tracked = path.join(root, 'src-tauri/env-sidecars/staging/serve.mjs');
  const source = fs.readFileSync(tracked, 'utf8');
  assert.match(source, /ensureOAuthStateKeyFile/);
  assert.doesNotMatch(source,
    /env2&&env2\.length>=32\?secretKey=Buffer\.from\(env2,"utf8"\):secretKey=randomBytes/);

  const script = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');
  const start = script.indexOf('# ── Server-only source-tree + env-sidecar staging.');
  const end = script.indexOf('# ── Immutable build-source snapshot', start);
  assert.ok(start > 0 && end > start);
  const sourceRepair = script.slice(start, end);
  assert.match(sourceRepair, /requires the OAuth state key-file fix in frozen env-sidecars\/staging\/serve\.mjs/);
  assert.match(sourceRepair, /refuses the legacy per-process OAuth state random fallback/);
});

test('materializes only exact committed repair bytes and attests a stable source identity', (t) => {
  const f = fixture(t);
  const applied = f.apply();
  assert.equal(fs.readFileSync(path.join(f.snapshot, 'src-tauri/src/wsl_setup.rs'), 'utf8'), 'new\n');
  assert.equal(applied.manifestSha256, manifest(f.value).manifestSha256);
  assert.deepEqual(verify(applied, f.snapshot), applied);
  assert.throws(f.apply, /already exists|baseline changed|unmanifested native source delta/);
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
  assert.throws(f.apply, /symlink|unmanifested native source delta/);
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
  fs.writeFileSync(path.join(bin, 'cargo'), '#!/bin/bash\n' +
    'case " $* " in *" --locked "*) ;; *) exit 93;; esac\n' +
    'printf "%s\\n" "$TAURI_CONFIG" >>"$CONFIG_RECEIPT"\n');
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
      PROVENANCE_TOOLS_ROOT: path.join(root, 'bin'),
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
  const rolesValidation = script.indexOf('node "$HERE/lib/windows-source-repair.js" roles');
  const targetResolution = script.indexOf('papercusp_cargo_target_root "$SRC_TAURI"');
  assert.ok(rolesValidation >= 0, 'Windows source-repair roles are validated');
  assert.ok(targetResolution > rolesValidation,
    'source-repair roles are validated before Cargo target-root resolution');
  assert.match(script, /source repair roles must exactly match requested build roles/);
  assert.match(script, /source repair output must be empty/);
  assert.match(script, /OUT_DIR="\$PAPERCUSP_WINDOWS_OUTPUT_DIR"/);
  assert.match(script, /PROVENANCE_SOURCE_REPAIR_MANIFEST="\$SOURCE_REPAIR_APPLIED"/);
  assert.match(script, /PROVENANCE_SOURCE_REPAIR_ROLES="\$ROLES"/);
  assert.match(script, /bash "\$PROVENANCE_TOOLS_ROOT\/emit-build-provenance\.sh"/);
});

test('late provenance emission uses immutable helper copies after source producers change', (t) => {
  const f = fixture(t);
  const source = path.join(f.dir, 'producer-source');
  fs.mkdirSync(path.join(source, 'lib'), { recursive: true });
  // Stage exactly the helpers snapshot_provenance_tools copies (b838aafe added
  // lib/spa-freshness.js); a helper missing here fails the snapshot's cp, not the claim.
  for (const relative of ['emit-build-provenance.sh', 'lib/windows-source-repair.js', 'lib/spa-freshness.js']) {
    fs.copyFileSync(path.join(root, 'bin', relative), path.join(source, relative));
  }
  const script = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');
  const start = script.indexOf('snapshot_provenance_tools() {');
  const end = script.indexOf('\n# Update source baked', start);
  assert.ok(start > 0 && end > start);
  const snapshot = path.join(f.dir, 'producer-snapshot');
  const capture = spawnSync('bash', ['-c',
    `set -euo pipefail\nfail() { echo "$*" >&2; exit 1; }\n${script.slice(start, end)}\n` +
    'snapshot_provenance_tools "$1" "$2"', 'snapshot-test', snapshot, source], {
    encoding: 'utf8', env: { ...process.env, PROVENANCE_TOOLCHAIN: '{"fixture":"preserved"}' },
  });
  assert.equal(capture.status, 0, capture.stderr);
  const toolchain = JSON.parse(capture.stdout);
  assert.equal(toolchain.fixture, 'preserved');
  const producer = JSON.parse(fs.readFileSync(path.join(snapshot, 'producer-inputs.json')));
  assert.deepEqual(toolchain.windowsProvenanceProducer, producer);
  for (const file of producer.files) {
    assert.equal(hash(fs.readFileSync(path.join(source, file.path))), file.sha256);
    assert.notEqual(fs.statSync(path.join(source, file.path)).ino,
      fs.statSync(path.join(snapshot, file.path)).ino, 'must copy, never hardlink mutable helpers');
  }
  fs.writeFileSync(path.join(source, 'emit-build-provenance.sh'), 'exit 97\n');
  fs.writeFileSync(path.join(source, 'lib/windows-source-repair.js'), 'throw Error("moving helper")\n');
  fs.writeFileSync(path.join(source, 'lib/spa-freshness.js'), 'throw Error("moving helper")\n');
  Object.assign(f.value, { kind: 'windows-native-source-repair', roles: ['server'] });
  const applied = f.apply('server');
  const input = path.join(f.dir, 'repair.json'); fs.writeFileSync(input, JSON.stringify(applied));
  const out = path.join(f.dir, 'out'); fs.mkdirSync(out);
  const artifact = path.join(out, 'Server.exe'); fs.writeFileSync(artifact, 'new Server');
  const emitted = spawnSync('bash', [path.join(snapshot, 'emit-build-provenance.sh'),
    out, '0.0.19', f.value.operatorBuildSha, 'false', artifact], {
    encoding: 'utf8', env: {
      ...process.env, PROVENANCE_GIT_ROOT: f.snapshot,
      PROVENANCE_SOURCE_GIT_HEAD: f.base, PROVENANCE_SOURCE_GIT_DIRTY: 'false',
      PROVENANCE_SOURCE_REPAIR_MANIFEST: input, PROVENANCE_SOURCE_REPAIR_ROLES: 'server',
      PROVENANCE_TOOLCHAIN: JSON.stringify(toolchain),
    },
  });
  assert.equal(emitted.status, 0, emitted.stderr);
  const provenance = JSON.parse(fs.readFileSync(path.join(out, 'build-provenance.json')));
  assert.deepEqual(provenance.sourceRepair, applied);
  assert.deepEqual(provenance.toolchain.windowsProvenanceProducer, producer);
  for (const file of producer.files) {
    assert.equal(hash(fs.readFileSync(path.join(snapshot, file.path))), file.sha256);
  }
  assert.ok(script.indexOf('snapshot_provenance_tools "$PROVENANCE_TOOLS_ROOT"') <
    script.indexOf('cargo xwin build --release'));
  assert.match(script, /"\$WINDOWS_PROVENANCE_TOOLCHAIN" "\$phase"/);
});

test('a failed finished-artifact gate retains explicitly unsigned native-source evidence', (t) => {
  const f = fixture(t);
  Object.assign(f.value, { kind: 'windows-native-source-repair', roles: ['server'] });
  const applied = f.apply('server');
  const input = path.join(f.dir, 'repair.json'); fs.writeFileSync(input, JSON.stringify(applied));
  const tools = path.join(f.dir, 'tools'); fs.mkdirSync(path.join(tools, 'lib'), { recursive: true });
  for (const relative of ['emit-build-provenance.sh', 'lib/windows-source-repair.js']) {
    fs.copyFileSync(path.join(root, 'bin', relative), path.join(tools, relative));
  }
  fs.writeFileSync(path.join(tools, 'producer-inputs.json'), '{"schemaVersion":1,"files":[]}');
  const out = path.join(f.dir, 'out'); fs.mkdirSync(out);
  const artifact = path.join(out, 'Papercusp Server_0.0.19_x64-setup.exe');
  fs.writeFileSync(artifact, 'unsigned native candidate');
  const script = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');
  const start = script.indexOf('emit_windows_provenance() {');
  const end = script.indexOf('# ── Identity-scan the FINISHED installers', start);
  assert.ok(start > 0 && end > start);
  const result = spawnSync('bash', ['-c',
    `set -euo pipefail\nfail() { echo "$*" >&2; exit 1; }\n${script.slice(start, end)}\n` +
    'fail "fixture finished artifact rejected"'], {
    encoding: 'utf8', env: {
      ...process.env, ROOT: f.snapshot, SRC_TAURI: path.join(f.snapshot, 'src-tauri'),
      OUT_DIR: out, VERSION: '0.0.19', PAPERCUSP_BUILD_SHA: f.value.operatorBuildSha,
      SOURCE_REPAIR_APPLIED: input, ROLES: 'server',
      PROVENANCE_TOOLS_ROOT: tools, WINDOWS_PROVENANCE_TOOLCHAIN: '{}',
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fixture finished artifact rejected/);
  const evidence = JSON.parse(fs.readFileSync(path.join(out, 'build-provenance.json')));
  assert.deepEqual(evidence.sourceRepair, applied);
  assert.equal(evidence.toolchain.windowsBuildPhase, 'native-built-awaiting-artifact-audit');
  assert.equal(evidence.signed, false);
  assert.equal(evidence.artifacts[0].sig, false);
  assert.equal(evidence.artifacts[0].sha256, hash(Buffer.from('unsigned native candidate')));
  assert.equal(fs.existsSync(`${artifact}.sig`), false);
  assert.ok(script.indexOf('emit_windows_provenance native-built-awaiting-artifact-audit') <
    script.indexOf('echo "==> identity-scan of the finished installer(s)"'));
  assert.ok(script.indexOf('emit_windows_provenance artifact-audited-and-signed') >
    script.indexOf('echo "==> signing installers"'));
  assert.match(script, /refusing to sign or publish it/);
});
