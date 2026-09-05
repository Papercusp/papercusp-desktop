'use strict';

// EI-20082207759701826 — the DETECTOR gap that let EI-20075266271803900
// (AppImage hard-fails on any host without system WebKitGTK) ship for a year.
//
// bin/verify-appimage-pristine.sh is the runtime detector: it runs the PACKAGED
// artifact in a container with no system WebKitGTK. That leg needs docker and a
// real 3.4 GB artifact, so it is not a unit test. What IS unit-testable — and is
// where the detector would silently rot — is the coupling between two files:
//
//   build-appimage.sh  authors the AppRun
//   verify-appimage-pristine.sh  DERIVES its whole assertion scope by parsing it
//
// The guard derives its library search path, its WebKit helper dirs, and the
// binary it must scan from the AppRun's own text, precisely so that adding a lib
// dir to the build does not need an edit in the guard. The cost of that design
// is a parsing contract, and a parsing contract that nobody exercises breaks
// silently in the direction that still PASSES: derive an empty scope, scan
// nothing, report green. build-appimage.sh already carries that exact failure —
// its GL-fallback loop copies five sonames while its self-containment guard
// spot-checks one.
//
// So this file asserts, against the REAL shell code (via `--derive-only`, never
// a JavaScript re-implementation of its regexes):
//   1. the AppRun build-appimage.sh actually writes is parseable by the guard,
//      and yields the scope we expect;
//   2. each seeded AppRun defect makes the guard FAIL, by its own distinct name;
//   3. the guard names no binary by hand.
//
// Falsifiability without mutating the shared tree: every mutation below is
// applied to a COPY under os.tmpdir(). A mutate-and-restore probe on a tracked
// file races git-sync's whole-tree sweep and can commit the mutant (CLAUDE.md).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const GUARD = path.join(ROOT, 'bin', 'verify-appimage-pristine.sh');
const BUILDER = path.join(ROOT, 'bin', 'build-appimage.sh');

/** The AppRun text build-appimage.sh actually writes into the AppDir. */
function shippedAppRunText() {
  const src = fs.readFileSync(BUILDER, 'utf8');
  const m = src.match(/cat > "\$APPDIR\/AppRun" <<'APPRUN'\n([\s\S]*?)\nAPPRUN\n/);
  assert.ok(
    m,
    'build-appimage.sh no longer writes the AppRun via the APPRUN heredoc — the guard derives its ' +
      'entire scope from that AppRun, so this coupling must be re-established deliberately',
  );
  return m[1];
}

/**
 * Materialise a minimal AppDir carrying `appRunText`, plus whatever payload
 * files the AppRun's own `exec` line points at, and return its path.
 */
function makeAppDir(appRunText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-pristine-derive-'));
  fs.writeFileSync(path.join(dir, 'AppRun'), `${appRunText}\n`, { mode: 0o755 });
  const exec = appRunText.match(/^exec\s+"\$HERE\/([^"]+)"/m);
  if (exec) {
    const target = path.join(dir, exec[1]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '#!/bin/sh\n', { mode: 0o755 });
  }
  return dir;
}

/** Run the REAL guard's derivation stage against an AppDir. */
function derive(appDir) {
  const r = spawnSync('bash', [GUARD, '--derive-only', appDir], { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const field = (k) => {
    const m = out.match(new RegExp(`^${k}=(.*)$`, 'm'));
    return m ? m[1].trim() : null;
  };
  return {
    code: r.status,
    out,
    libdirs: (field('DERIVED_LIBDIRS') || '').split(/\s+/).filter(Boolean),
    wkdirs: (field('DERIVED_WKDIRS') || '').split(/\s+/).filter(Boolean),
    exec: field('DERIVED_EXEC'),
  };
}

test('the guard exists and is executable', () => {
  assert.ok(fs.existsSync(GUARD), 'bin/verify-appimage-pristine.sh must exist');
  // eslint-disable-next-line no-bitwise
  assert.ok(fs.statSync(GUARD).mode & 0o111, 'the guard must be executable');
});

test('the shipped AppRun is parseable and yields a NON-EMPTY derived scope', () => {
  const d = derive(makeAppDir(shippedAppRunText()));
  assert.equal(d.code, 0, `--derive-only failed against the shipped AppRun:\n${d.out}`);

  // The precise counts are asserted, not just non-emptiness: "derived something"
  // is satisfied by a regex that silently matches one dir out of three, which is
  // the under-scoped-but-green failure this whole file exists to catch.
  assert.deepEqual(
    d.libdirs.slice().sort(),
    ['usr/lib', 'usr/lib/glfallback', 'usr/lib/x86_64-linux-gnu'],
    'the derived library search path must be exactly what the shipped AppRun exports — ' +
      'if the build legitimately added or removed a lib dir, update this list in the same commit',
  );
  assert.equal(d.wkdirs.length, 3, `expected 3 derived WebKit helper dirs, got: ${d.wkdirs.join(' ')}`);
  assert.equal(d.exec, 'usr/bin/papercusp-desktop');
});

test('CONTROL: a missing LD_LIBRARY_PATH export fails, rather than deriving an empty scope', () => {
  const mutated = shippedAppRunText().replace(/^export LD_LIBRARY_PATH=.*$/m, '# removed');
  const d = derive(makeAppDir(mutated));
  assert.notEqual(d.code, 0, 'a guard that derives no library path must refuse, not scan nothing and pass');
  assert.match(d.out, /no 'export LD_LIBRARY_PATH=' line/);
});

test('CONTROL: a missing `cd "$HERE"` fails — this is EI-20075266271803900 root cause 2', () => {
  const mutated = shippedAppRunText().replace(/^cd "\$HERE".*$/m, '# removed');
  const d = derive(makeAppDir(mutated));
  assert.notEqual(d.code, 0, 'the packaged-artifact re-assertion of the 3b-ii invariant must fail closed');
  assert.match(d.out, /does not 'cd "\$HERE"'/);
});

test('CONTROL: a missing exec line fails, rather than falling back to a guessed binary name', () => {
  const mutated = shippedAppRunText().replace(/^exec\s+"\$HERE\/.*$/m, '# removed');
  const d = derive(makeAppDir(mutated));
  assert.notEqual(d.code, 0);
  assert.match(d.out, /cannot derive which binary ships as the entrypoint/);
});

test('CONTROL: the entrypoint FOLLOWS a rename instead of staying pinned to the old name', () => {
  // The regression this catches is concrete: the guard once hardcoded
  // `usr/bin/papercusp-desktop` in its ELF scan. After a rename it would have
  // kept passing while silently no longer scanning the main binary at all.
  const mutated = shippedAppRunText().replace(
    /^exec\s+"\$HERE\/usr\/bin\/papercusp-desktop"/m,
    'exec "$HERE/usr/bin/renamed-binary"',
  );
  const d = derive(makeAppDir(mutated));
  assert.equal(d.code, 0, `derivation should still succeed after a rename:\n${d.out}`);
  assert.equal(d.exec, 'usr/bin/renamed-binary');
});

test('CONTROL: an exec target that is not present in the payload fails', () => {
  const dir = makeAppDir(shippedAppRunText());
  fs.rmSync(path.join(dir, 'usr', 'bin', 'papercusp-desktop'));
  const d = derive(dir);
  assert.notEqual(d.code, 0);
  assert.match(d.out, /the artifact cannot start at all/);
});

test('the guard scans no hand-named binary — every scope decision is derived', () => {
  // A hand-maintained name in EXECUTABLE code is the drift this design forbids;
  // naming it in a COMMENT (to explain what used to be wrong) is fine, so strip
  // comment lines before looking.
  const code = fs
    .readFileSync(GUARD, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
  assert.doesNotMatch(
    code,
    /usr\/bin\/papercusp-desktop/,
    'the guard must derive the entrypoint from the AppRun, never hardcode it',
  );
});
