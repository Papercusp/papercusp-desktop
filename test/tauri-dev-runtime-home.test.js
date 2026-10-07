const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const desktop = join(__dirname, '..');
const guard = join(desktop, 'bin', 'tauri-guarded');

function runGuard({ explicitHome = '', workspace = true, corrupt = false, command = 'dev' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tauri-runtime-home-'));
  try {
    const home = join(root, 'home');
    const workspaces = join(root, 'workspaces');
    const bin = join(root, 'bin');
    for (const dir of [home, workspaces, bin]) mkdirSync(dir, { recursive: true });
    const expectedWorkspaceHome = join(workspaces, 'fixture-workspace', '.papercusp');
    if (workspace) {
      mkdirSync(expectedWorkspaceHome, { recursive: true });
      writeFileSync(join(workspaces, 'registry.json'), corrupt ? '{broken' : JSON.stringify({
        current: 'fixture-workspace',
        workspaces: [{ id: 'fixture-workspace', name: 'Fixture', createdAt: 1 }],
      }));
    }
    writeFileSync(join(bin, 'tauri'), '#!/usr/bin/env node\n' +
      'console.log(JSON.stringify({home:process.env.PAPERCUSP_HOME||"",args:process.argv.slice(2)}));\n',
    { mode: 0o755 });
    const result = spawnSync('bash', [guard, command], {
      cwd: desktop,
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...process.env,
        HOME: home,
        PAPERCUSP_WORKSPACES_ROOT: workspaces,
        PAPERCUSP_WORKSPACE: 'fixture-workspace',
        PAPERCUSP_HOME: explicitHome,
        CARGO_TARGET_DIR: join(root, 'cargo-target'),
        PAPERCUSP_SIDECAR_LOCK: join(root, 'sidecar.lock'),
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    assert.ifError(result.error);
    return { ...result, expectedWorkspaceHome, legacyHome: join(home, '.papercusp') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('tauri dev gives native IPC discovery the same active-workspace home as the operator', () => {
  const result = runGuard();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).home, result.expectedWorkspaceHome);
});

test('tauri dev preserves an explicitly isolated runtime home', () => {
  const explicitHome = join(tmpdir(), 'explicit-tauri-runtime');
  const result = runGuard({ explicitHome });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).home, explicitHome);
});

test('tauri dev retains the canonical legacy fallback when no workspace is provisioned', () => {
  const result = runGuard({ workspace: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).home, result.legacyHome);
});

test('tauri dev fails before native spawn when workspace identity cannot be resolved', () => {
  const result = runGuard({ corrupt: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /WorkspaceRegistryUnreadableError|refusing to report it as EMPTY/);
  assert.doesNotMatch(result.stdout, /"args"/);
});

test('non-dev CLI commands do not resolve or rewrite runtime identity', () => {
  const result = runGuard({ command: 'info', corrupt: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).home, '');
});
