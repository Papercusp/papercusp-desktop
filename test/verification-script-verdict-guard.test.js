// D-009 (plan fix-0014-platform-defects-2026-08-10):
//   "A verification surface that cannot emit a FAILING verdict is not a signal."
//
// THE BUG THIS PREVENTS. bin/mac-vm-fresh-install-e2e.sh opened with `set +e`,
// carried no nonzero exit, and therefore exited 0 on every run — including runs
// where it printed "operator did NOT reach /api/health 200 within 200s". It was
// cited as macOS runtime evidence for a release. The failure mode is not that it
// was wrong; it is that a green result and a red one were the SAME BYTE, so no
// amount of care downstream could tell them apart.
//
// A census at the time found 9 of 21 verification scripts in bin/ could not emit
// a failing verdict, and all nine were mac-vm-*. Rewriting them by hand fixes
// today's nine and does nothing about the tenth, so the durable fix is this guard.
//
// THE RULE IS DELIBERATELY NARROW, because a guard that cries wolf gets deleted.
// Plenty of scripts here are report-only BY DESIGN — mac-vm-log-scan.sh prints
// log lines, mac-vm-inspect-running.sh dumps process state, mac-vm-gw-prep.sh
// sets a box up. None of those claim a verdict, and forcing an exit code on them
// would be noise. What must be able to fail is a script whose NAME asserts a
// verdict — *verify*, *-test*, *e2e*, *-check*. Those get quoted as evidence.
//
// Everything runs against the real bin/ plus temp-dir fixtures: no mutation of
// the shared working tree (a probe that edits tracked files can be committed by
// the git-sync sweep even when nothing errors).

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin');
const CONVERTED_VERDICT_SCRIPTS = [
  'mac-vm-relaunch-verify.sh',
  'mac-vm-lifecycle-gw-e2e.sh',
  'mac-vm-seed-runtime-test.sh',
  'mac-vm-reqb-fileprec.sh',
];

/**
 * A script CAN emit a failing verdict when it either aborts on error (`set -e`)
 * or carries an explicit nonzero exit. Comments are stripped first so that prose
 * *about* exiting — this file's own header would qualify — cannot satisfy it.
 */
function canEmitFailingVerdict(source) {
  const code = source
    .split('\n')
    .map((l) => l.replace(/^\s*#.*$/, ''))
    .join('\n');
  const setsErrexit = /^\s*set\s+-[a-zA-Z]*e/m.test(code);
  // `exit N` is a COMMAND, not necessarily a line. The common real shape is
  // inline — `if ! probe; then echo FAIL; exit 1; fi` — so anchoring to
  // line-start silently reports a script that CAN fail as one that cannot.
  // (The falsifiability fixtures below caught exactly that in this matcher.)
  const exitsNonzero = /(^|[;&|(]|\bthen\b|\belse\b|\bdo\b|\{)\s*exit\s+[1-9][0-9]*/m.test(code);
  return setsErrexit || exitsNonzero;
}

/** A script whose NAME claims a verdict, and which will therefore be quoted as evidence. */
function claimsAVerdict(name) {
  return /(verify|e2e|-test|_test|-check)/i.test(name);
}

// ─────────────────────────────────────────────────────────────────────────────
function verdictClaimingScripts() {
  return fs
    .readdirSync(BIN)
    .filter((f) => f.endsWith('.sh'))
    .filter((f) => claimsAVerdict(f) || CONVERTED_VERDICT_SCRIPTS.includes(f))
    .sort();
}

test('every verdict-claiming script in bin/ can emit a failing verdict (D-009)', () => {
  const offenders = [];
  for (const name of verdictClaimingScripts()) {
    const src = fs.readFileSync(path.join(BIN, name), 'utf8');
    if (!canEmitFailingVerdict(src)) offenders.push(name);
  }

  assert.deepEqual(
    offenders,
    [],
    `These scripts claim a verdict in their name but cannot emit a failing one, so a green run ` +
      `and a red run are the same exit code:\n  ${offenders.join('\n  ')}\n\n` +
      `Give each an explicit nonzero exit (see bin/mac-vm-fresh-install-e2e.sh for the ` +
      `PASS/FAIL/VOID shape) so the guard can distinguish a real pass from a false green.`,
  );
});

test('the specific script that motivated D-009 emits a real verdict', () => {
  const src = fs.readFileSync(path.join(BIN, 'mac-vm-fresh-install-e2e.sh'), 'utf8');

  assert.ok(
    canEmitFailingVerdict(src),
    'mac-vm-fresh-install-e2e.sh must be able to exit nonzero — this is the script whose ' +
      'unconditional exit 0 was cited as macOS release evidence.',
  );

  // The regression is not only "no exit code" — it is `set +e` with no exit code.
  // Assert the specific dead shape cannot come back silently.
  const code = src.split('\n').map((l) => l.replace(/^\s*#.*$/, '')).join('\n');
  assert.ok(
    !/^\s*set\s+\+e\s*$/m.test(code),
    'mac-vm-fresh-install-e2e.sh must not re-introduce a bare `set +e`; failures are ' +
      'accumulated explicitly and reported through the exit code.',
  );

  // VOID must survive. It is the outcome that separates "this passed" from
  // "this could not have failed", and it is the first thing an optimising edit drops.
  assert.ok(/exit 2/.test(code), 'the VOID verdict (exit 2) must remain');
  assert.ok(/exit 1/.test(code), 'the FAIL verdict (exit 1) must remain');
});

// ─────────────────────────────────────────────────────────────────────────────
// FALSIFIABILITY. The three tests above pass if the detector is broken and thinks
// everything is fine — the precise failure they exist to prevent, one level up.
// So prove the detector actually discriminates, on fixtures with known answers.
// ─────────────────────────────────────────────────────────────────────────────
test('the detector is falsifiable: it flags a verdictless script and clears a real one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-guard-'));
  try {
    const verdictless = [
      '#!/bin/bash',
      'set +e',
      'echo "checking..."',
      'curl -s localhost/health || echo "did NOT answer"', // reports failure, exits 0
      'echo DONE',
    ].join('\n');

    const withVerdict = [
      '#!/bin/bash',
      'if ! curl -sf localhost/health; then echo FAIL; exit 1; fi',
      'echo PASS',
    ].join('\n');

    const errexit = ['#!/bin/bash', 'set -euo pipefail', 'curl -sf localhost/health'].join('\n');

    // A script that only TALKS about exiting must not satisfy the detector —
    // this is why comments are stripped before matching.
    const commentOnly = [
      '#!/bin/bash',
      '# on failure this should exit 1 someday',
      '# set -e would be nice here too',
      'echo "report only"',
    ].join('\n');

    assert.equal(canEmitFailingVerdict(verdictless), false, 'a `set +e` script with no exit must be FLAGGED');
    assert.equal(canEmitFailingVerdict(withVerdict), true, 'an explicit `exit 1` must be CLEARED');
    assert.equal(canEmitFailingVerdict(errexit), true, '`set -euo pipefail` must be CLEARED');
    assert.equal(canEmitFailingVerdict(commentOnly), false, 'comments about exiting must NOT count as a verdict');

    // And the name rule discriminates too — otherwise the guard would either
    // police nothing or police every prep script into meaningless exit codes.
    assert.equal(claimsAVerdict('mac-vm-relaunch-verify.sh'), true);
    assert.equal(claimsAVerdict('mac-vm-fresh-install-e2e.sh'), true);
    assert.equal(claimsAVerdict('mac-vm-log-scan.sh'), false, 'a diagnostic must stay exempt');
    assert.equal(claimsAVerdict('mac-vm-gw-prep.sh'), false, 'a setup script must stay exempt');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('each converted mac-vm verdict script fails on a synthetic failure', () => {
  for (const name of CONVERTED_VERDICT_SCRIPTS) {
    const result = spawnSync('bash', [path.join(BIN, name)], {
      env: { ...process.env, MAC_VM_VERDICT_TEST_FAIL: '1' },
      encoding: 'utf8',
      timeout: 2000,
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    assert.equal(result.status, 1, `${name} must exit 1 on synthetic failure; output:\n${output}`);
    assert.match(output, /VERDICT: FAIL/, `${name} must print a failing verdict`);
  }
});

test('GUI-only launch keeps AppRun utilities while excluding co-located host launchers', () => {
  const source = fs.readFileSync(path.join(BIN, 'linux-fresh-install-e2e.sh'), 'utf8');
  const helper = source.match(/prepare_gui_launch_path\(\) \{\n[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'the real launch PATH constructor must be exercised');
  const appRun = fs.readFileSync(path.join(BIN, 'build-appimage.sh'), 'utf8')
    .match(/cat > "\$APPDIR\/AppRun" <<'APPRUN'\n([\s\S]*?)\nAPPRUN/)?.[1];
  assert.ok(appRun, 'exercise the real producer AppRun, not a substitute');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-launch-path-'));
  try {
    const host = path.join(root, 'host-bin');
    const appdir = path.join(root, 'bundle');
    const isolated = path.join(root, 'launch-bin');
    fs.mkdirSync(host);
    fs.mkdirSync(path.join(appdir, 'usr/bin'), { recursive: true });
    fs.writeFileSync(path.join(appdir, 'AppRun'), appRun, { mode: 0o755 });
    fs.writeFileSync(path.join(appdir, 'usr/bin/papercusp-desktop'),
      '#!/bin/bash\nprintf "BUNDLED:%s\\n" "$APPDIR"\n', { mode: 0o755 });
    for (const tool of ['dirname', 'readlink', 'realpath', 'ls', 'sed', 'grep', 'gsettings']) {
      const resolved = spawnSync('/bin/bash', ['-c', 'command -v "$1"', 'resolve-tool', tool], { encoding: 'utf8' });
      assert.equal(resolved.status, 0, `fixture requires ${tool}`);
      fs.symlinkSync(resolved.stdout.trim(), path.join(host, tool));
    }
    for (const tool of ['node', 'npm', 'gtk-launch', 'papercusp-server', 'papercusp-desktop']) {
      fs.writeFileSync(path.join(host, tool), '#!/bin/bash\necho HOST_LAUNCHER >&2\nexit 91\n', { mode: 0o755 });
    }
    const result = spawnSync('/bin/bash', ['-c', [
      helper, 'prepare_gui_launch_path "$1" || exit 90',
      'for tool in node npm gtk-launch papercusp-server papercusp-desktop; do',
      '  if PATH="$1" command -v "$tool" >/dev/null; then exit 92; fi', 'done',
      'export PATH="$1"', 'exec "$2/AppRun"',
    ].join('\n'), 'isolated-launch', isolated, appdir], {
      encoding: 'utf8', env: { ...process.env, PATH: host + ':' + process.env.PATH, APPDIR: '' },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.trim(), 'BUNDLED:' + appdir);
    assert.doesNotMatch(result.stderr, /command not found|HOST_LAUNCHER/);
    assert.deepEqual(fs.readdirSync(isolated).sort(), ['dirname', 'grep', 'gsettings', 'ls', 'readlink', 'realpath', 'sed']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('GUI-only launch refuses a missing AppRun utility before launching', () => {
  const source = fs.readFileSync(path.join(BIN, 'linux-fresh-install-e2e.sh'), 'utf8');
  const helper = source.match(/prepare_gui_launch_path\(\) \{\n[\s\S]*?\n\}/)?.[0];
  assert.ok(helper);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-launch-missing-tool-'));
  try {
    const result = spawnSync('/bin/bash', ['-c', [
      helper, 'command() { if [[ "$2" = readlink ]]; then return 1; fi; builtin command "$@"; }',
      'prepare_gui_launch_path "$1" || exit 90', 'echo LAUNCH_ALLOWED',
    ].join('\n'), 'missing-utility', path.join(root, 'launch-bin')], { encoding: 'utf8' });
    assert.equal(result.status, 90, result.stdout + result.stderr);
    assert.match(result.stderr, /required AppRun utility missing: readlink/);
    assert.doesNotMatch(result.stdout, /LAUNCH_ALLOWED/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
