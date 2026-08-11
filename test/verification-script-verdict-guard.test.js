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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin');

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
// Pre-existing D-009 debt. SHRINK-ONLY: converting a script removes its entry.
// Nothing may be ADDED here without the owning plan/work-item saying why — a new
// verdict-claiming script that cannot fail is the exact regression this prevents.
// Tracked for conversion; each still exits 0 unconditionally today.
// ─────────────────────────────────────────────────────────────────────────────
const KNOWN_VERDICTLESS = new Map([
  ['mac-vm-relaunch-verify.sh', 'pre-existing D-009 debt: prints relaunch state, never exits nonzero'],
  ['mac-vm-lifecycle-gw-e2e.sh', 'pre-existing D-009 debt: gateway lifecycle e2e with no verdict'],
  ['mac-vm-seed-runtime-test.sh', 'pre-existing D-009 debt: seed runtime probe with no verdict'],
  ['mac-vm-reqb-fileprec.sh', 'pre-existing D-009 debt: REQ-B file-precedence check with no verdict'],
]);

function verdictClaimingScripts() {
  return fs
    .readdirSync(BIN)
    .filter((f) => f.endsWith('.sh'))
    .filter((f) => claimsAVerdict(f))
    .sort();
}

test('every verdict-claiming script in bin/ can emit a failing verdict (D-009)', () => {
  const offenders = [];
  for (const name of verdictClaimingScripts()) {
    const src = fs.readFileSync(path.join(BIN, name), 'utf8');
    if (!canEmitFailingVerdict(src) && !KNOWN_VERDICTLESS.has(name)) offenders.push(name);
  }

  assert.deepEqual(
    offenders,
    [],
    `These scripts claim a verdict in their name but cannot emit a failing one, so a green run ` +
      `and a red run are the same exit code:\n  ${offenders.join('\n  ')}\n\n` +
      `Give each an explicit nonzero exit (see bin/mac-vm-fresh-install-e2e.sh for the ` +
      `PASS/FAIL/VOID shape), or — only with a stated reason on the owning work-item — add it ` +
      `to KNOWN_VERDICTLESS.`,
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

test('the allowlist is honest: every KNOWN_VERDICTLESS entry exists and still lacks a verdict', () => {
  for (const [name, reason] of KNOWN_VERDICTLESS) {
    const p = path.join(BIN, name);
    assert.ok(fs.existsSync(p), `KNOWN_VERDICTLESS names ${name}, which no longer exists — remove the entry`);
    assert.ok(reason && reason.length > 20, `${name} needs a real reason, not a placeholder`);
    assert.ok(
      !canEmitFailingVerdict(fs.readFileSync(p, 'utf8')),
      `${name} CAN now emit a failing verdict — delete its KNOWN_VERDICTLESS entry so the ` +
        `allowlist keeps shrinking. An allowlist that outlives its debt stops meaning anything.`,
    );
  }
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
