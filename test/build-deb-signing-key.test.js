// EI-20398328195531333 — archived Debian builds must load the conventional
// updater key before doing any expensive staging, compiling, or bundling.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'bin/build-and-archive-deb.sh');

function runSigningPreflight({ createDefaultKey = false, explicitKey, keyPath, password } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-signing-key-'));
  const conventionalKey = path.join(tmp, '.papercusp/signing/papercusp.key');
  try {
    if (createDefaultKey) {
      fs.mkdirSync(path.dirname(conventionalKey), { recursive: true });
      fs.writeFileSync(conventionalKey, 'test-private-key\n', { mode: 0o600 });
    }

    const full = fs.readFileSync(scriptPath, 'utf8');
    const start = full.indexOf('# --- UPDATER SIGNING KEY');
    const end = full.indexOf('# --- SEED OVERLAY', start);
    assert.ok(start > 0, 'updater signing-key preflight block not found');
    assert.ok(end > start, 'signing-key preflight must finish before seed staging');

    const harness = [
      'set -euo pipefail',
      full.slice(start, end),
      'printf "KEY=%s\\nPASSWORD=%s\\n" "$TAURI_SIGNING_PRIVATE_KEY" "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD"',
      '',
    ].join('\n');

    const env = { ...process.env, HOME: tmp };
    for (const name of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PATH', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD']) {
      delete env[name];
    }
    if (explicitKey !== undefined) env.TAURI_SIGNING_PRIVATE_KEY = explicitKey;
    if (keyPath !== undefined) env.TAURI_SIGNING_PRIVATE_KEY_PATH = keyPath;
    if (password !== undefined) env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = password;

    return { ...spawnSync('bash', ['-c', harness], { encoding: 'utf8', env }), conventionalKey };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('loads the conventional mode-0600 updater key when no signing env is supplied', () => {
  const res = runSigningPreflight({ createDefaultKey: true });

  assert.equal(res.status, 0, `preflight failed: ${res.stderr}`);
  assert.match(res.stdout, new RegExp(`KEY=${res.conventionalKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(res.stdout, /PASSWORD=\n/);
});

test('honors TAURI_SIGNING_PRIVATE_KEY_PATH instead of the conventional path', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-explicit-key-'));
  try {
    const key = path.join(tmp, 'release.key');
    fs.writeFileSync(key, 'test-private-key\n', { mode: 0o600 });
    const res = runSigningPreflight({ keyPath: key, password: 'test-password' });

    assert.equal(res.status, 0, `preflight failed: ${res.stderr}`);
    assert.match(res.stdout, new RegExp(`KEY=${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(res.stdout, /PASSWORD=test-password/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('preserves a directly supplied key value without requiring a key file', () => {
  const res = runSigningPreflight({ explicitKey: 'inline-private-key' });

  assert.equal(res.status, 0, `preflight failed: ${res.stderr}`);
  assert.match(res.stdout, /KEY=inline-private-key/);
  assert.match(res.stdout, /supplied via TAURI_SIGNING_PRIVATE_KEY/);
});

test('fails before staging or building when neither a supplied nor conventional key exists', () => {
  const res = runSigningPreflight();

  assert.equal(res.status, 7);
  assert.match(res.stderr, /FATAL: updater signing key not found/);
  assert.match(res.stderr, /setup-signing-key\.sh/);
});

test('signing-key preflight runs before seed staging and the expensive build', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');
  const preflightAt = full.indexOf('# --- UPDATER SIGNING KEY');
  const stageAt = full.indexOf('bash "$DESKTOP_DIR/bin/stage-env-sidecars.sh"');
  const buildAt = full.indexOf('run_build_bounded &');

  assert.ok(preflightAt > 0 && stageAt > preflightAt, 'key preflight must precede env-sidecar staging');
  assert.ok(buildAt > stageAt, 'key preflight and staging must both precede the expensive build');
});
