const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const helper = path.join(root, 'bin', 'repack-deb-xz.sh');
const buildWrapperRel = 'bin/build-deb-repacked.sh';

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  assert.equal(res.status, 0, `${cmd} failed (${res.status}): ${res.stderr}`);
  return res.stdout;
}

test('replaces only data.tar.gz with data.tar.xz and remains dpkg-readable', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-xz-test-'));
  try {
    const pkg = path.join(tmp, 'pkg');
    fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
    fs.mkdirSync(path.join(pkg, 'usr', 'share', 'papercusp'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'DEBIAN', 'control'), [
      'Package: papercusp-repack-test',
      'Version: 1.0.0',
      'Architecture: all',
      'Maintainer: Papercusp <test@example.invalid>',
      'Description: repack fixture',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(pkg, 'usr', 'share', 'papercusp', 'payload.txt'), 'payload survives recompression\n');
    const sidecar = path.join(pkg, 'usr', 'lib', 'Papercusp GUI', 'sidecar');
    const staging = path.join(sidecar, 'env-sidecars', 'staging');
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(sidecar, 'serve.mjs'), 'console.log("same staged bundle");\n');
    fs.copyFileSync(path.join(sidecar, 'serve.mjs'), path.join(staging, 'serve.mjs'));

    const deb = path.join(tmp, 'fixture.deb');
    run('dpkg-deb', ['-Zgzip', '-b', pkg, deb]);
    assert.match(run('ar', ['t', deb]), /data\.tar\.gz/);

    run('bash', [helper, deb], { env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: '' } });
    const members = run('ar', ['t', deb]).trim().split('\n');
    assert.deepEqual(members, ['debian-binary', 'control.tar.gz', 'data.tar.xz']);

    const extracted = path.join(tmp, 'extracted');
    run('dpkg-deb', ['-x', deb, extracted]);
    assert.equal(fs.readFileSync(path.join(extracted, 'usr', 'share', 'papercusp', 'payload.txt'), 'utf8'), 'payload survives recompression\n');
    const primaryStat = fs.statSync(path.join(extracted, 'usr', 'lib', 'Papercusp GUI', 'sidecar', 'serve.mjs'));
    const stagedStat = fs.statSync(path.join(extracted, 'usr', 'lib', 'Papercusp GUI', 'sidecar', 'env-sidecars', 'staging', 'serve.mjs'));
    assert.equal(primaryStat.ino, stagedStat.ino, 'dpkg extraction must restore staging as a hardlink to the primary payload');

    const listing = run('bash', ['-c', 'dpkg-deb --fsys-tarfile "$1" | tar -tvf -', '_', deb]);
    assert.match(listing, /env-sidecars\/staging\/serve\.mjs link to .*sidecar\/serve\.mjs/);

    // A second pass is deliberately idempotent and still validates the package.
    run('bash', [helper, deb], { env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: '' } });
    assert.deepEqual(run('ar', ['t', deb]).trim().split('\n'), members);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('all shell Linux deb producers invoke the repacker', () => {
  for (const rel of ['bin/build-and-archive-deb.sh', 'bin/build-linux-local.sh', 'bin/release-local.sh']) {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.match(source, /repack-deb-xz\.sh/, `${rel} must repack its Debian artifacts`);
  }
});

test('both npm Debian producers route through the repacking build wrapper', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const name of ['build', 'build:debug']) {
    assert.match(
      pkg.scripts?.[name] ?? '',
      /bin\/build-deb-repacked\.sh/,
      `package.json script ${name} must route Debian artifacts through ${buildWrapperRel}`,
    );
  }

  const wrapper = fs.readFileSync(path.join(root, buildWrapperRel), 'utf8');
  assert.match(wrapper, /tauri build --bundles deb/, `${buildWrapperRel} must build only Debian bundles`);
  assert.match(wrapper, /repack-deb-xz\.sh/, `${buildWrapperRel} must invoke the canonical repacker`);
});

test('the npm build wrapper repacks the fresh bundle from release and debug profiles', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-build-wrapper-test-'));
  try {
    const pkgDir = path.join(tmp, 'pkg');
    fs.mkdirSync(path.join(pkgDir, 'DEBIAN'), { recursive: true });
    fs.mkdirSync(path.join(pkgDir, 'opt', 'papercusp'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'DEBIAN', 'control'), [
      'Package: papercusp-build-wrapper-test',
      'Version: 1.0.0',
      'Architecture: all',
      'Maintainer: Papercusp <test@example.invalid>',
      'Description: build wrapper fixture',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(pkgDir, 'opt', 'papercusp', 'payload'), 'wrapper payload\n');

    const sourceDeb = path.join(tmp, 'source.deb');
    run('dpkg-deb', ['-Zgzip', '-b', pkgDir, sourceDeb]);

    const fakeBin = path.join(tmp, 'bin');
    const targetDir = path.join(tmp, 'target');
    const argsLog = path.join(tmp, 'tauri-args.log');
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, 'cargo'), [
      '#!/usr/bin/env bash',
      'printf \'{"target_directory":"%s"}\\n\' "$FAKE_TARGET_DIR"',
      '',
    ].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(fakeBin, 'tauri'), [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'profile=release',
      'for arg in "$@"; do [[ "$arg" == "--debug" ]] && profile=debug; done',
      'printf \'%s\\n\' "$*" > "$FAKE_ARGS_LOG"',
      'mkdir -p "$FAKE_TARGET_DIR/$profile/bundle/deb"',
      'cp "$FAKE_DEB_SOURCE" "$FAKE_TARGET_DIR/$profile/bundle/deb/Papercusp_1.0.0_all.deb"',
      '',
    ].join('\n'), { mode: 0o755 });

    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      FAKE_ARGS_LOG: argsLog,
      FAKE_DEB_SOURCE: sourceDeb,
      FAKE_TARGET_DIR: targetDir,
      TAURI_SIGNING_PRIVATE_KEY: '',
    };
    for (const { args, profile } of [
      { args: [], profile: 'release' },
      { args: ['--debug'], profile: 'debug' },
    ]) {
      const result = spawnSync('bash', [path.join(root, buildWrapperRel), ...args], {
        cwd: root,
        encoding: 'utf8',
        env,
      });
      assert.equal(result.status, 0, `wrapper failed (${result.status}): ${result.stderr}`);
      assert.match(fs.readFileSync(argsLog, 'utf8'), new RegExp(`^build --bundles deb${args.length ? ' --debug' : ''}\\n$`));
      const builtDeb = path.join(targetDir, profile, 'bundle', 'deb', 'Papercusp_1.0.0_all.deb');
      assert.deepEqual(run('ar', ['t', builtDeb]).trim().split('\n'), [
        'debian-binary',
        'control.tar.gz',
        'data.tar.xz',
      ]);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('refuses to invalidate an existing updater signature without a signing key', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-xz-sig-'));
  try {
    const pkg = path.join(tmp, 'pkg');
    fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
    fs.mkdirSync(path.join(pkg, 'opt', 'fixture'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'DEBIAN', 'control'), [
      'Package: papercusp-repack-signature-test',
      'Version: 1.0.0',
      'Architecture: all',
      'Maintainer: Papercusp <test@example.invalid>',
      'Description: signature guard fixture',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(pkg, 'opt', 'fixture', 'payload'), 'signed bytes\n');
    const deb = path.join(tmp, 'signed.deb');
    run('dpkg-deb', ['-Zgzip', '-b', pkg, deb]);
    fs.writeFileSync(`${deb}.sig`, 'signature-for-original-bytes\n');
    const original = fs.readFileSync(deb);

    const res = spawnSync('bash', [helper, deb], {
      encoding: 'utf8',
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: '' },
    });
    assert.equal(res.status, 5);
    assert.match(res.stderr, /refusing to create a stale signature/);
    assert.deepEqual(fs.readFileSync(deb), original, 'refusal must preserve the original package bytes');
    assert.equal(fs.readFileSync(`${deb}.sig`, 'utf8'), 'signature-for-original-bytes\n');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
