// EI-20576367847192101 — the placeholder-sidecar guard in bin/build-and-archive-deb.sh.
//
// WHY THIS TEST EXISTS
// `src-tauri/build.rs` (ensure_sidecar_placeholder) writes PLACEHOLDER-README.txt
// stand-ins for sidecar/serve.mjs and sidecar/db-sql/*.sql whenever the real sidecar
// hasn't been built, purely so a fresh/cleaned checkout's `cargo build`/`tauri dev`
// can compile. `tauri build` (what this script wraps) does not know the difference:
// it happily bundles whatever sits in sidecar/, placeholders included, and exits 0.
//
// Before this guard, `bin/build-and-archive-deb.sh` completed with EXIT=0 and
// produced+archived a .deb whose sidecar/ contained only PLACEHOLDER-README.txt
// files — no serve.mjs, no SPA, zero bundled migrations — indistinguishable from a
// good build by exit code, filename, or the archive step.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'bin/build-and-archive-deb.sh');

/**
 * Build a throwaway tree shaped like the real one, with a controllable sidecar
 * completeness, then run ONLY the placeholder-sidecar guard portion of the script
 * (from its own marker up to the pre-existing stale-sidecar guard) against it.
 *
 * We touch a marker file past the guard so "guard allowed the build" is a
 * positive assertion, not merely "did not exit non-zero".
 */
function runGuard({ hasServe = true, sqlCount = 1, hasSpaIndex = true }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-placeholder-sidecar-'));
  try {
    const desktopDir = path.join(tmp, 'papercusp-desktop');
    const sidecarDir = path.join(desktopDir, 'src-tauri/sidecar');
    const dbSqlDir = path.join(sidecarDir, 'db-sql');
    const spaDir = path.join(sidecarDir, 'spa');
    fs.mkdirSync(dbSqlDir, { recursive: true });
    fs.mkdirSync(spaDir, { recursive: true });

    if (hasServe) {
      fs.writeFileSync(path.join(sidecarDir, 'serve.mjs'), '// bundle\n');
    } else {
      fs.writeFileSync(path.join(sidecarDir, 'PLACEHOLDER-README.txt'), 'placeholder\n');
    }
    if (sqlCount > 0) {
      for (let i = 0; i < sqlCount; i++) {
        fs.writeFileSync(path.join(dbSqlDir, `${String(i).padStart(3, '0')}-x.sql`), '-- x\n');
      }
    } else {
      fs.writeFileSync(path.join(dbSqlDir, 'PLACEHOLDER-README.txt'), 'placeholder\n');
    }
    if (hasSpaIndex) {
      fs.writeFileSync(path.join(spaDir, 'index.html'), '<html></html>\n');
    }

    // Extract the guard block plus enough scaffolding to execute it standalone,
    // so the test exercises the REAL script text rather than a copy that can drift.
    const full = fs.readFileSync(scriptPath, 'utf8');
    const start = full.indexOf('# --- PLACEHOLDER-SIDECAR GUARD');
    const end = full.indexOf('# --- STALE-SIDECAR GUARD');
    assert.ok(start > 0, 'placeholder-sidecar guard block not found — did it get renamed or removed?');
    assert.ok(end > start, 'guard must sit before the stale-sidecar guard');

    const marker = path.join(tmp, 'build-ran');
    const harness = [
      'set -euo pipefail',
      `DESKTOP_DIR=${JSON.stringify(desktopDir)}`,
      full.slice(start, end),
      `touch ${JSON.stringify(marker)}`,
      '',
    ].join('\n');

    const res = spawnSync('bash', ['-c', harness], { encoding: 'utf8' });

    return { ...res, buildRan: fs.existsSync(marker) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('FAILS when serve.mjs is a placeholder (missing)', () => {
  const res = runGuard({ hasServe: false });

  assert.equal(res.status, 8, `expected exit 8, got ${res.status}. stderr:\n${res.stderr}`);
  assert.equal(res.buildRan, false, 'the expensive build must NOT run against a placeholder sidecar');
  assert.match(res.stderr, /PLACEHOLDER SIDECAR/);
  assert.match(res.stderr, /serve\.mjs does not exist/);
  assert.match(res.stderr, /build-desktop-sidecar\.sh/);
});

test('FAILS when db-sql/ has zero migration files', () => {
  const res = runGuard({ sqlCount: 0 });

  assert.equal(res.status, 8, `expected exit 8, got ${res.status}. stderr:\n${res.stderr}`);
  assert.equal(res.buildRan, false, 'the expensive build must NOT run with zero bundled migrations');
  assert.match(res.stderr, /PLACEHOLDER SIDECAR/);
  assert.match(res.stderr, /db-sql\/ has no \*\.sql files/);
});

test('FAILS when the SPA was never staged', () => {
  const res = runGuard({ hasSpaIndex: false });

  assert.equal(res.status, 8, `expected exit 8, got ${res.status}. stderr:\n${res.stderr}`);
  assert.equal(res.buildRan, false, 'the expensive build must NOT run with no staged SPA');
  assert.match(res.stderr, /PLACEHOLDER SIDECAR/);
  assert.match(res.stderr, /spa\/index\.html does not exist/);
});

test('ALLOWS the build when the sidecar is real', () => {
  const res = runGuard({});

  assert.equal(res.status, 0, `expected clean pass, got ${res.status}. stderr:\n${res.stderr}`);
  assert.equal(res.buildRan, true, 'a real sidecar must not be blocked');
  assert.doesNotMatch(res.stderr, /PLACEHOLDER SIDECAR/);
});

test('guard sits BEFORE the stale-sidecar guard, the mutex, and the build', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');
  const placeholderAt = full.indexOf('# --- PLACEHOLDER-SIDECAR GUARD');
  const staleAt = full.indexOf('# --- STALE-SIDECAR GUARD');
  const mutexAt = full.indexOf('# --- BUNDLE MUTEX');
  const buildAt = full.indexOf('setsid timeout');

  assert.ok(placeholderAt > 0, 'placeholder-sidecar guard block missing');
  assert.ok(staleAt > 0, 'stale-sidecar guard block missing');
  assert.ok(mutexAt > 0, 'bundle mutex block missing');
  assert.ok(buildAt > 0, 'build invocation missing');
  assert.ok(placeholderAt < staleAt, 'check existence before staleness — a placeholder is never "stale", it is absent');
  assert.ok(staleAt < mutexAt, 'check before taking the lock — do not hold it to fail');
  assert.ok(mutexAt < buildAt, 'the lock must be held before the build starts');
});
