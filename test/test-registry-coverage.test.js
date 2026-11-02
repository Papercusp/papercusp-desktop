// Every Node test file under test/ must actually be RUN by `npm test`.
//
// WHY THIS TEST EXISTS
// `test:shell` enumerates its files BY HAND. That makes "add your new test to the
// list" a convention each author has to remember — and the failure when someone
// forgets is silent in the worst possible way: the test file exists, it is
// committed, it passes when run directly, and `npm test` is green. Nothing
// anywhere says it never ran. A guard that is never executed is not a guard, but
// it LOOKS like one to every later reader, including the author who added it.
//
// Measured 2026-08-08 (P-011, plan memory-corpus-hygiene-and-release-distribution-2026-08-03):
// 16 test files on disk, 14 reachable from `npm test`. The two missing were
// sidecar-no-database-bake-guard.test.js — the recurrence guard for P-011 itself,
// which protects against a database dump shipping inside a public desktop bundle —
// and updater-e2e-vm.test.js, whose dedicated `test:updater-e2e-vm` script nothing
// chained. Both pass in well under a second and neither needs a VM, so both had
// simply fallen out of the runner unnoticed.
//
// This is the same class as the tauri-dev-slot chokepoint (see the root CLAUDE.md):
// a rule enforced by convention gets routed around, so the rule becomes a test.
//
// ⚠ FOR WHOEVER EDITS THIS NEXT: the fix for a failure here is to ADD your file to
// `test:shell`, not to add it to EXCLUSIONS. An entry below removes a test from the
// suite permanently and silently — which is the exact outcome this file exists to
// prevent. Only exclude a test that genuinely must not run in the default suite
// (it needs external hardware, a network, or minutes of wall-clock), and say why.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/**
 * Tests deliberately kept out of the default suite. Each entry MUST carry a reason.
 * Empty on purpose: nothing here currently needs it.
 */
const EXCLUSIONS = Object.create(null);

/** The scripts `npm test` actually chains, resolved from the `test` script itself. */
function testChainScriptNames() {
  const entry = pkg.scripts?.test ?? '';
  const names = [...entry.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
  assert.notEqual(names.length, 0, 'the `test` script no longer chains any npm run targets — re-check this guard');
  return names;
}

/**
 * The `test/…` arguments exactly as the SHELL splits them — whitespace tokens, not a
 * regex scan over the body. A regex scan counted `test/a.test.jstest/b.test.js` (a
 * dropped space) as BOTH files, while `node --test` received ONE glob that matched no
 * file and — Node ≥21 treats arguments as globs — skipped it without a word, so two
 * guards silently stopped running (WI-10003497).
 */
function testPathTokens(body) {
  return body.split(/\s+/).filter((t) => t.startsWith('test/'));
}

/** Tokens that name no real test file: typos, glued paths, deleted files. */
function findDeadTokens(tokens, onDisk) {
  return tokens.filter((t) => !onDisk.has(t));
}

/** Every `test/…` token the scripts `npm test` reaches. */
function tokensReachableFromNpmTest() {
  return testChainScriptNames().flatMap((name) => testPathTokens(pkg.scripts?.[name] ?? ''));
}

/** Every Node test file named by the scripts `npm test` reaches. */
function filesReachableFromNpmTest() {
  return new Set(tokensReachableFromNpmTest());
}

function filesOnDisk() {
  return fs
    .readdirSync(path.join(root, 'test'))
    .filter((f) => f.endsWith('.test.js') || f.endsWith('.test.mjs') || f.endsWith('.test.cjs'))
    .map((f) => `test/${f}`)
    .sort();
}

/** The pure predicate, extracted so it can be exercised with synthetic inputs below. */
function findOrphans(onDisk, reachable, exclusions) {
  return onDisk.filter((f) => !reachable.has(f) && !(f in exclusions));
}

test('test:shell routes through the Node ledger wrapper', () => {
  assert.match(
    pkg.scripts?.['test:shell'] ?? '',
    /^node bin\/run-node-test-suite\.mjs(?:\s|$)/,
    'test:shell must preserve its Node runner while recording per-file ledger rows.',
  );
});

test('CONTROL: the orphan predicate detects a file no script names', () => {
  // Falsifiability, without mutating the shared tree (a mutate-and-restore probe
  // races git-sync's whole-tree sweep and can commit the mutant — see CLAUDE.md).
  // If this ever passes an empty array, the guard below cannot fail either.
  assert.deepEqual(
    findOrphans(['test/a.test.js', 'test/b.test.js'], new Set(['test/a.test.js']), {}),
    ['test/b.test.js'],
  );
  // ...and an excluded file is correctly forgiven.
  assert.deepEqual(
    findOrphans(['test/b.test.js'], new Set(), { 'test/b.test.js': 'needs hardware' }),
    [],
  );
});

test('every Node test file under test/ is run by `npm test`', () => {
  const reachable = filesReachableFromNpmTest();
  const orphans = findOrphans(filesOnDisk(), reachable, EXCLUSIONS);

  assert.deepEqual(
    orphans,
    [],
    'These test files exist but `npm test` never runs them:\n' +
      orphans.map((f) => `  • ${f}`).join('\n') +
      '\n\nAdd each to the `test:shell` script in papercusp-desktop/package.json. ' +
      'A committed, passing, never-executed guard is indistinguishable from a working ' +
      'one until the thing it guards against actually ships. Do NOT silence this by ' +
      'adding the file to EXCLUSIONS unless it genuinely cannot run in the default ' +
      'suite (external hardware, network, or minutes of wall-clock) — and then say why.',
  );
});

test('CONTROL: a glued or missing path is a dead token, not two reachable files', () => {
  const onDisk = new Set(['test/a.test.js', 'test/b.test.js']);
  const tokens = testPathTokens('node --test test/a.test.jstest/b.test.js test/gone.test.js');
  // The exact WI-10003497 shape: neither half may count as reachable…
  assert.equal(new Set(tokens).has('test/a.test.js'), false);
  assert.equal(new Set(tokens).has('test/b.test.js'), false);
  // …and both the glued token and the stale one are reported.
  assert.deepEqual(findDeadTokens(tokens, onDisk), ['test/a.test.jstest/b.test.js', 'test/gone.test.js']);
  // Calibration: a correctly spaced script yields no dead tokens.
  assert.deepEqual(findDeadTokens(testPathTokens('node --test test/a.test.js test/b.test.js'), onDisk), []);
});

test('every `test/…` argument of `npm test` names a real test file', () => {
  // `node --test` treats each argument as a glob and silently skips one that matches
  // nothing, so a typo or a dropped space removes tests with a GREEN exit.
  const dead = findDeadTokens(tokensReachableFromNpmTest(), new Set(filesOnDisk()));
  assert.deepEqual(
    dead,
    [],
    'These `test/…` arguments name no file, so `node --test` silently skips them:\n' +
      dead.map((t) => `  • ${t}`).join('\n') +
      '\n\nFix the path (a missing space between two entries is the usual cause) ' +
      'in the `test:shell` script of papercusp-desktop/package.json.',
  );
});

test('this guard itself is run by `npm test`', () => {
  // Without this, the coverage guard could be dropped from test:shell and take its
  // own enforcement with it — failing silent, exactly like the bug it detects.
  assert.equal(
    filesReachableFromNpmTest().has('test/test-registry-coverage.test.js'),
    true,
    'test-registry-coverage.test.js is not in `test:shell`, so nothing enforces test coverage.',
  );
});

test('every EXCLUSIONS entry names a real file and carries a reason', () => {
  const onDisk = new Set(filesOnDisk());
  for (const [file, reason] of Object.entries(EXCLUSIONS)) {
    assert.equal(onDisk.has(file), true, `EXCLUSIONS names ${file}, which no longer exists — drop the stale entry.`);
    assert.equal(
      typeof reason === 'string' && reason.trim().length > 10,
      true,
      `EXCLUSIONS[${file}] needs a real reason explaining why it cannot run in the default suite.`,
    );
  }
});
