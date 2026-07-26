// EI-18683847182779973 — the stale-sidecar guard in bin/build-and-archive-deb.sh.
//
// WHY THIS TEST EXISTS
// `tauri build` does not rebuild the sidecar, and src-tauri/sidecar/serve.mjs is
// an esbuild bundle that INLINES its vendored deps. So a patch applied to
// node_modules (patches/*.patch) can be fully present at the source level while
// the artifact the rig executes still carries the pre-patch copy.
//
// The failure mode is not a crash. Instrumentation added by a diagnostic patch
// reads back `undefined` — the FALSY value — which in a diagnostic context is
// usually the "nothing unusual happened" reading. So a stale bundle produces a
// clean CONFIRMATION of whatever hypothesis predicted the falsy value. It
// manufactures agreement rather than failing loudly, which is why this is
// guarded at build time and not left to reviewer discipline.
//
// This class has now nearly cost three investigation runs, so the guard must
// FAIL the build (exit 4), not warn.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'bin/build-and-archive-deb.sh');

/**
 * Build a throwaway tree shaped like the real one, with a controllable skew
 * between the sidecar stamp and the newest patch file, then run ONLY the guard
 * portion of the script (everything up to the build invocation) against it.
 *
 * We stub `npm run build` so a PASS is observable without a 3GB tauri build:
 * the stub writes a marker file, so "guard allowed the build" is a positive
 * assertion rather than merely "did not exit non-zero".
 */
function runGuard({ stampEpoch, patchEpoch, allowStale = false }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-stale-sidecar-'));
  try {
    const desktopDir = path.join(tmp, 'papercusp-desktop');
    const sidecarDir = path.join(desktopDir, 'src-tauri/sidecar');
    const patchesDir = path.join(tmp, 'patches');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.mkdirSync(patchesDir, { recursive: true });

    fs.writeFileSync(
      path.join(sidecarDir, '.sidecar-build-stamp'),
      JSON.stringify({ serveSha256: 'deadbeef', builtAtUtc: 'x', epochSec: stampEpoch }, null, 2),
    );
    fs.writeFileSync(path.join(sidecarDir, 'serve.mjs'), '// bundle\n');

    const patchFile = path.join(patchesDir, 'hyperdht+6.32.0.patch');
    fs.writeFileSync(patchFile, 'diff --git a/x b/x\n');
    fs.utimesSync(patchFile, patchEpoch, patchEpoch);

    // Extract the guard block plus enough scaffolding to execute it standalone,
    // so the test exercises the REAL script text rather than a copy that can drift.
    const full = fs.readFileSync(scriptPath, 'utf8');
    const start = full.indexOf('# --- STALE-SIDECAR GUARD');
    const end = full.indexOf('echo "=== building ($BUILD_CMD) ==="');
    assert.ok(start > 0, 'stale-sidecar guard block not found — did it get renamed or removed?');
    assert.ok(end > start, 'guard must sit immediately before the build invocation');

    const marker = path.join(tmp, 'build-ran');
    const harness = [
      'set -euo pipefail',
      `DESKTOP_DIR=${JSON.stringify(desktopDir)}`,
      `REPO_DIR=${JSON.stringify(tmp)}`,
      full.slice(start, end),
      `touch ${JSON.stringify(marker)}`,
      '',
    ].join('\n');

    const res = spawnSync('bash', ['-c', harness], {
      encoding: 'utf8',
      env: { ...process.env, PAPERCUSP_ALLOW_STALE_SIDECAR: allowStale ? '1' : '0' },
    });

    return { ...res, buildRan: fs.existsSync(marker) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('FAILS the build when a patch is newer than the sidecar bundle', () => {
  const res = runGuard({ stampEpoch: 1785055439, patchEpoch: 1785056900 });

  assert.equal(res.status, 4, `expected exit 4, got ${res.status}. stderr:\n${res.stderr}`);
  assert.equal(res.buildRan, false, 'the expensive build must NOT run when the sidecar is stale');
  assert.match(res.stderr, /STALE SIDECAR/);
  // The remediation must name the actual fix command — a guard that only says
  // "stale" sends the next agent hunting through the build graph.
  assert.match(res.stderr, /build-desktop-sidecar\.sh/);
  // And it must tell them to verify the ARTIFACT, since checking node_modules
  // or the .patch file is precisely what fails to catch this.
  assert.match(res.stderr, /serve\.mjs/);
});

test('ALLOWS the build when the sidecar postdates every patch', () => {
  const res = runGuard({ stampEpoch: 1785056900, patchEpoch: 1785055439 });

  assert.equal(res.status, 0, `expected clean pass, got ${res.status}. stderr:\n${res.stderr}`);
  assert.equal(res.buildRan, true, 'a fresh sidecar must not be blocked');
  assert.doesNotMatch(res.stderr, /STALE SIDECAR/);
});

test('PAPERCUSP_ALLOW_STALE_SIDECAR=1 is a working escape hatch', () => {
  const res = runGuard({ stampEpoch: 1785055439, patchEpoch: 1785056900, allowStale: true });

  assert.equal(res.status, 0, `escape hatch should permit the build, got ${res.status}`);
  assert.equal(res.buildRan, true);
});

test('guard sits BEFORE the build so it cannot burn a full tauri build first', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');
  const guardAt = full.indexOf('# --- STALE-SIDECAR GUARD');
  const buildAt = full.indexOf('eval "$BUILD_CMD"');

  assert.ok(guardAt > 0, 'guard block missing');
  assert.ok(buildAt > 0, 'build invocation missing');
  assert.ok(guardAt < buildAt, 'the guard must run before the build, not after');
});
