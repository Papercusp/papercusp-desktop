// WI-10004404 (2026-09-30): the desktop dev operator pins background workers
// OFF, because on the shared dev database the bg-host on :3270 is their single
// writer (EI-126). An ISOLATED verifier (scripts/verify-tauri-headless.sh with
// its own throwaway database) has no bg-host, so with workers OFF nothing
// routine-driven could be verified there: a signed webhook was accepted but its
// trigger run was never dispatched (plan external-app-access-to-workspaces
// P-014, leg B1).
//
// The fix is an opt-in (PAPERCUSP_DEV_BACKGROUND_WORKERS=1) that only takes
// effect when PAPERCUSP_VERIFY_TAURI_ISOLATED=1. These tests run the script's
// REAL gating block under every env combination, so the opt-in can neither
// leak onto the shared database nor silently stop working in the rig.
//
// node:test, like the sibling bin/*.sh guards (dev-operator-perf-env.test.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = process.env.DEV_OPERATOR_SCRIPT
  || path.join(__dirname, '..', 'bin', 'dev-operator-ifneeded.sh');

function source() {
  return fs.readFileSync(SCRIPT, 'utf8');
}

/** The block that decides DEV_BACKGROUND_WORKERS, from its default to the
 *  closing `fi` of the opt-in check. */
function gatingBlock() {
  const lines = source().split('\n');
  const start = lines.findIndex((l) => l === 'DEV_BACKGROUND_WORKERS=0');
  assert.ok(
    start >= 0,
    'dev-operator-ifneeded.sh no longer sets DEV_BACKGROUND_WORKERS=0 as its ' +
      'default. Re-point this guard at wherever the background-workers ' +
      'decision now lives; do NOT delete it (WI-10004404, EI-126).',
  );
  const end = lines.findIndex((l, i) => i > start && l === 'fi');
  assert.ok(end > start, 'could not find the end of the DEV_BACKGROUND_WORKERS opt-in block');
  return lines.slice(start, end + 1).join('\n');
}

function decide(env) {
  const r = spawnSync('bash', ['-c', `${gatingBlock()}\nprintf 'RESULT=%s\\n' "$DEV_BACKGROUND_WORKERS"`], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, `gating block failed: ${r.stderr}`);
  const m = /RESULT=(\S*)/.exec(r.stdout);
  assert.ok(m, `gating block printed no result: ${r.stdout}`);
  return m[1];
}

test('background workers stay OFF by default and on a non-isolated launch', () => {
  assert.strictEqual(decide({}), '0');
  assert.strictEqual(
    decide({ PAPERCUSP_DEV_BACKGROUND_WORKERS: '1' }),
    '0',
    'the opt-in must be ignored outside an isolated verifier: on the shared ' +
      'dev database the bg-host on :3270 is the single background writer (EI-126)',
  );
  assert.strictEqual(decide({ PAPERCUSP_VERIFY_TAURI_ISOLATED: '1' }), '0');
});

test('an isolated verifier can opt background workers ON', () => {
  assert.strictEqual(
    decide({ PAPERCUSP_VERIFY_TAURI_ISOLATED: '1', PAPERCUSP_DEV_BACKGROUND_WORKERS: '1' }),
    '1',
    'an isolated rig with PAPERCUSP_DEV_BACKGROUND_WORKERS=1 must run background ' +
      'workers, or routine-driven behaviour (webhook trigger dispatch, schedules) ' +
      'can never be verified there (WI-10004404)',
  );
});

test('DEFAULT_DEV_CMD takes the decided value, never a hard-coded ON', () => {
  const line = source().split('\n').find((l) => l.startsWith('DEFAULT_DEV_CMD='));
  assert.ok(line, 'dev-operator-ifneeded.sh no longer defines DEFAULT_DEV_CMD');
  assert.match(line, /\bPAPERCUSP_BACKGROUND_WORKERS=\$DEV_BACKGROUND_WORKERS\b/);
  assert.doesNotMatch(line, /\bPAPERCUSP_BACKGROUND_WORKERS=1\b/);
});

/** The reuse-path check that kills a leaked operator reporting dbosEnabled. */
function squatterVerdict(health, devBackgroundWorkers) {
  const src = source();
  const m = /\n(    case "\$health" in\n[\s\S]*?\n    esac)\n/.exec(src);
  assert.ok(m, 'could not find the dbosEnabled squatter check in the reuse path');
  const script = `squatter=0\nhealth='${health}'\nDEV_BACKGROUND_WORKERS=${devBackgroundWorkers}\n${m[1]}\nprintf 'SQUATTER=%s\\n' "$squatter"`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `squatter check failed: ${r.stderr}`);
  return /SQUATTER=(\S*)/.exec(r.stdout)[1];
}

test('the reuse path still rejects a workers-ON operator on an ordinary launch', () => {
  assert.strictEqual(squatterVerdict('{"dbosEnabled":true}', 0), '1');
  assert.strictEqual(squatterVerdict('{"dbosEnabled":false}', 0), '0');
});

test('an isolated verifier with the opt-in does not reject its own operator', () => {
  assert.strictEqual(squatterVerdict('{"dbosEnabled":true}', 1), '0');
});
