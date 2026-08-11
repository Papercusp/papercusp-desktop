// EI-20122241900682950 — the AppImage GL fallback: bundled-set and asserted-set are ONE set.
//
// THE BUG THIS PREVENTS was not a wrong assertion. build-appimage.sh carried TWO
// independent soname literals — a 5-soname copy loop and a guard that spot-checked
// ONE representative (libGLESv2.so.2). So libGL.so.1 was never copied, the guard was
// never asked about it, and every build was green while the shipped AppImage died at
// exec on any box without system OpenGL ("error while loading shared libraries:
// libGL.so.1", exit 127). A partial assertion reads exactly like a passing one.
//
// Hence two halves, and the SECOND is the one that actually prevents the recurrence:
//   1. BEHAVIOURAL — run the REAL guard text from the script against fixture AppDirs,
//      including one that is missing a soname, so the guard is proven FALSIFIABLE.
//      A guard that has never failed is a guard nobody has tested.
//   2. STRUCTURAL — assert the copy loop and the guard both iterate the SAME shell
//      variable. Half 1 passes just as happily against two hand-maintained lists that
//      happen to agree today; only half 2 stops them drifting apart again.
//
// Everything runs in a temp dir: no mutation of the shared working tree (a probe that
// edits tracked files can be committed by the git-sync sweep even when nothing errors).

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'bin', 'build-appimage.sh');
const SRC = fs.readFileSync(SCRIPT, 'utf8');

/** The single-sourced list line, e.g. GLFALLBACK_SONAMES="libGL.so.1 libGLESv2.so.2 ...". */
function sonameAssignment() {
  const m = SRC.match(/^GLFALLBACK_SONAMES="([^"]+)"\s*$/m);
  assert.ok(
    m,
    'build-appimage.sh must define GLFALLBACK_SONAMES on its own line — the single source ' +
      'both the copy loop and the fail-closed guard iterate (EI-20122241900682950)',
  );
  return { line: m[0], sonames: m[1].trim().split(/\s+/) };
}

// The marker MUST be unique to the guard. It cannot be the glfallback path: the COPY
// loop symlinks into that same path, matches first, and — setting no `_missing` —
// returns an empty string, which reads exactly like "the guard found nothing wrong".
// That false pass showed up on the first run of this file, from this very helper.
const GUARD_MARKER = '_missing="$_missing $_gl';

/**
 * Extract the `for _gl in ...; do ... done` block whose body contains `marker`.
 * Deliberately pulls the REAL text out of the script rather than restating it here:
 * a test that re-implements the logic it is guarding cannot detect the logic changing.
 */
function forBlockContaining(marker) {
  const re = /^for _gl in [^\n]*; do\n[\s\S]*?^done$/gm;
  for (const m of SRC.matchAll(re)) {
    if (m[0].includes(marker)) return m[0];
  }
  assert.fail(`no "for _gl in ...; do ... done" block containing ${JSON.stringify(marker)} found`);
}

function tmpAppDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glfallback-guard-'));
  fs.mkdirSync(path.join(dir, 'usr', 'lib', 'glfallback'), { recursive: true });
  return dir;
}

/** Run the REAL guard block against an AppDir populated with `present`; return `_missing`. */
function runGuard(present) {
  const appdir = tmpAppDir();
  for (const so of present) {
    fs.writeFileSync(path.join(appdir, 'usr', 'lib', 'glfallback', so), 'fixture');
  }
  const script = [
    'set -u',
    `APPDIR=${JSON.stringify(appdir)}`,
    '_missing=""',
    sonameAssignment().line,
    forBlockContaining(GUARD_MARKER),
    'printf %s "$_missing"',
  ].join('\n');

  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  fs.rmSync(appdir, { recursive: true, force: true });
  assert.equal(r.status, 0, `guard block exited ${r.status}: ${r.stderr}`);
  return r.stdout.trim();
}

// ── 1. BEHAVIOURAL ──────────────────────────────────────────────────────────────

test('a complete glfallback dir passes the guard', () => {
  const { sonames } = sonameAssignment();
  assert.equal(runGuard(sonames), '', 'all sonames present must yield no _missing');
});

test('THE FALSIFIER: the guard fails for EVERY soname it claims to cover', () => {
  const { sonames } = sonameAssignment();
  // One omission at a time — a guard that only notices the FIRST missing soname, or
  // only its one historical representative, is the exact defect being fixed.
  for (const omitted of sonames) {
    const missing = runGuard(sonames.filter((s) => s !== omitted));
    assert.match(
      missing,
      new RegExp(omitted.replace(/\./g, '\\.')),
      `omitting ${omitted} must be reported — otherwise it can ship missing, which is ` +
        'precisely how libGL.so.1 shipped missing behind a green build',
    );
  }
});

test('libGL.so.1 specifically is covered (the regression that motivated this)', () => {
  const { sonames } = sonameAssignment();
  assert.ok(
    sonames.includes('libGL.so.1'),
    'libGL.so.1 is a load-time DT_NEEDED of the papercusp-desktop binary — resolved by the ' +
      'dynamic linker before main(), so its absence is a hard exec-127, not a soft dlopen miss',
  );
  assert.match(runGuard(sonames.filter((s) => s !== 'libGL.so.1')), /libGL\.so\.1/);
});

// ── 2. STRUCTURAL — the half that stops the class recurring ──────────────────────

test('the copy loop and the guard iterate the SAME variable', () => {
  const copy = forBlockContaining('cp -n "$_src"');
  const guard = forBlockContaining('$APPDIR/usr/lib/glfallback/$_gl');

  for (const [name, block] of [['copy loop', copy], ['guard', guard]]) {
    assert.match(
      block,
      /^for _gl in \$GLFALLBACK_SONAMES; do$/m,
      `the ${name} must iterate $GLFALLBACK_SONAMES, not its own soname literal — two ` +
        'hand-maintained lists is exactly how the bundled set and the asserted set drifted apart',
    );
  }
});

test('no second hard-coded soname list survives anywhere in the script', () => {
  // A literal `.so.N` inside a `for` header is the shape of the bug: someone adding a
  // soname to one list and not the other. The shared assignment line is the sole exception.
  const offenders = SRC.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /^\s*for\s+\w+\s+in\s.*\.so\.\d/.test(line))
    // The webkit/gtk payload check (`for _need in libwebkit2gtk-...`) is a DIFFERENT
    // population with no copy loop to drift from, so it is legitimately a literal.
    .filter(({ line }) => !/for _need in/.test(line));

  assert.deepEqual(
    offenders.map(({ n, line }) => `${n}: ${line.trim()}`),
    [],
    'a soname literal in a for-header reintroduces the two-list drift this guard exists to stop',
  );
});
