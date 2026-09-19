// EI-22764638031916839 — native sidecar addons must match the Node binary that
// the builder vendors, and the bundle verifier must exercise lazy addon loads.

'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '..');
const builder = fs.readFileSync(
  path.join(desktopRoot, 'bin/build-desktop-sidecar.sh'),
  'utf8',
);
const verifier = fs.readFileSync(
  path.join(desktopRoot, 'bin/verify-sidecar-bundle.sh'),
  'utf8',
);

function extractAlignmentFunction(source) {
  const match = source.match(
    /align_better_sqlite3_native\(\) \{[\s\S]*?\n\}\n\n# Windows packaging/,
  );
  assert.ok(match, 'align_better_sqlite3_native() is missing');
  return match[0].replace(/\n\n# Windows packaging[\s\S]*$/, '');
}

function extractVerifierGuard() {
  const match = verifier.match(
    /cat >"\$_guard_js" <<'GUARD_EOF'\n([\s\S]*?)\nGUARD_EOF/,
  );
  assert.ok(match, 'native verifier guard heredoc is missing');
  return match[1];
}

test('desktop worker builds before Node staging and is executed by the finished-bundle verifier', () => {
  const buildStart = builder.indexOf('DESKTOP_SESSION_BIN=');
  const buildEnd = builder.indexOf('# Bundle the embedded-postgres-server', buildStart);
  const verifyStart = verifier.indexOf('_desktop_session=');
  const verifyEnd = verifier.indexOf('_ri=', verifyStart);
  assert.ok(buildStart >= 0 && buildEnd > buildStart, 'desktop worker build phase is missing');
  assert.ok(verifyStart >= 0 && verifyEnd > verifyStart, 'packaged worker check is missing');

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-desktop-worker-staging-'));
  const fakeBin = path.join(fixture, 'tools');
  const sidecar = path.join(fixture, 'sidecar');
  const bin = path.join(sidecar, 'bin');
  try {
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, 'npx'), [
      '#!/bin/sh',
      'for arg in "$@"; do',
      '  case "$arg" in --outfile=*) printf "process.exit(0);\\n" > "${arg#--outfile=}";; esac',
      'done',
      '',
    ].join('\n'), { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      SIDECAR_DIR: sidecar,
      REPO_ROOT: fixture,
      WEB_DIR: fixture,
      BIN: bin,
      NODE_BIN: path.join(bin, 'node'),
    };
    const built = spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'MINIFY_ARGS=()',
      builder.slice(buildStart, buildEnd),
    ].join('\n')], { env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
    assert.equal(fs.existsSync(env.NODE_BIN), false, 'this phase must not require the later Node copy');
    const worker = path.join(bin, 'papercusp-desktop-session.cjs');
    assert.ok(fs.statSync(worker).mode & 0o111, 'the worker must be executable');

    // The final verifier must exercise the packaged runtime and reject a broken worker.
    fs.symlinkSync(process.execPath, env.NODE_BIN);
    const verify = () => spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'fail() { printf "%s\\n" "$*" >&2; exit 1; }',
      'ok() { :; }',
      verifier.slice(verifyStart, verifyEnd),
    ].join('\n')], { env, encoding: 'utf8', timeout: 10_000 });
    const good = verify();
    assert.equal(good.status, 0, `${good.stdout}${good.stderr}`);
    fs.writeFileSync(worker, 'process.exit(23);\n');
    const broken = verify();
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /desktop session worker failed packaged execution/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('builder refreshes better-sqlite3 for the bundled Node target ABI', () => {
  const align = extractAlignmentFunction(builder);
  const nodeSelection = builder.indexOf('NODE_VERSION="${NODE_VERSION:-v24.18.1}"');
  const alignAt = builder.indexOf('align_better_sqlite3_native() {');

  assert.ok(nodeSelection >= 0, 'bundled Node version selector is missing');
  assert.ok(alignAt > nodeSelection, 'ABI alignment must happen after Node selection');
  assert.match(align, /rm -f "\$bsq_dir"\/build\/Release\/\*\.node/);
  assert.match(align, /prebuild-install/);
  assert.match(align, /--platform="\$TARGET_OS"/);
  assert.match(align, /--arch="\$TARGET_ARCH"/);
  assert.match(align, /--target="\$target_version"/);
  assert.match(align, /--runtime=node/);
  assert.match(align, /npm rebuild --runtime=node --target="\$target_version" --build-from-source better-sqlite3/);
  assert.match(builder, /\[\[ "\$TARGET_OS" == "linux" \|\| "\$TARGET_OS" == "darwin" \]\]/);
});

test('builder passes the exact Node target to prebuild-install', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-sidecar-abi-'));
  const fakeBin = path.join(fixture, 'bin');
  const sidecar = path.join(fixture, 'sidecar');
  const packageDir = path.join(sidecar, 'node_modules/better-sqlite3');
  const argsFile = path.join(fixture, 'npx-args');
  try {
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'build/Release'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'build/Release/wrong-abi.node'), 'wrong');
    fs.writeFileSync(
      path.join(fakeBin, 'npx'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$@" > "$PC_NPX_ARGS"',
        'mkdir -p "$PWD/build/Release"',
        'printf target > "$PWD/build/Release/target.node"',
        '',
      ].join('\n'),
    );
    fs.chmodSync(path.join(fakeBin, 'npx'), 0o755);

    const align = extractAlignmentFunction(builder);
    const result = spawnSync(
      'bash',
      [
        '-c',
        [
          'set -euo pipefail',
          `SIDECAR_DIR=${JSON.stringify(sidecar)}`,
          'NODE_VERSION=v24.18.1',
          'TARGET_OS=linux',
          'TARGET_ARCH=x64',
          align,
          'align_better_sqlite3_native',
        ].join('\n'),
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          PC_NPX_ARGS: argsFile,
        },
      },
    );

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
    assert.ok(args.includes('--target=24.18.1'));
    assert.ok(args.includes('--runtime=node'));
    assert.ok(args.includes('--platform=linux'));
    assert.ok(args.includes('--arch=x64'));
    assert.equal(
      fs.existsSync(path.join(packageDir, 'build/Release/wrong-abi.node')),
      false,
      'the host-ABI addon must be removed before target repair',
    );
    assert.equal(fs.existsSync(path.join(packageDir, 'build/Release/target.node')), true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('verifier opens better-sqlite3 so lazy ABI failures are observable', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-sidecar-native-guard-'));
  const sidecar = path.join(fixture, 'sidecar');
  const marker = path.join(fixture, 'constructor-marker');
  const guard = path.join(fixture, 'guard.js');
  try {
    fs.mkdirSync(path.join(sidecar, 'node_modules/better-sqlite3'), { recursive: true });
    fs.writeFileSync(path.join(sidecar, 'serve.mjs'), '');
    fs.writeFileSync(
      path.join(sidecar, 'node_modules/better-sqlite3/index.js'),
      [
        'const fs = require("node:fs");',
        'module.exports = class Database {',
        '  constructor(filename) { fs.writeFileSync(process.env.PC_CONSTRUCTOR_MARKER, filename); }',
        '  close() {}',
        '};',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(guard, extractVerifierGuard());
    const result = spawnSync(process.execPath, [guard, 'better-sqlite3'], {
      cwd: sidecar,
      encoding: 'utf8',
      env: {
        ...process.env,
        PC_SIDECAR_ROOT: sidecar,
        PC_CONSTRUCTOR_MARKER: marker,
      },
    });

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(fs.readFileSync(marker, 'utf8'), ':memory:');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
