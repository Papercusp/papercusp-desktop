'use strict';

// WI-6554700010012075: a release-audited Server build must carry the first-boot hive
// seed or opt out explicitly. The D-224 candidate (2026-10-13) was built from a clean
// checkout with no (gitignored) src-tauri/seed; with PAPERCUSP_SKIP_SEED_CUT=1 every
// producer only WARNed, the Mac Server shipped seedless and the P-521 offline-restore
// leg failed by construction after nomination.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
// Overridable so a mutation probe can point the suite at a mutated COPY.
const helper = process.env.PAPERCUSP_RELEASE_SEED_GUARD_PATH
  || path.join(root, 'bin', 'lib', 'release-seed-guard.sh');

const CLEAN_ENV = {
  PAPERCUSP_RELEASE_AUDIT: '',
  PAPERCUSP_ALLOW_SEEDLESS_RELEASE: '',
  PAPERCUSP_ALLOW_SEEDLESS_REASON: '',
};

function guard({ roles = 'gui server', profile = 'dogfood', seeded = false, env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-seed-guard-'));
  try {
    const seed = path.join(dir, 'seed');
    if (seeded) {
      fs.mkdirSync(seed);
      fs.writeFileSync(path.join(seed, 'manifest.json'), '{"hive":"papercusp"}\n');
    }
    return spawnSync('bash', ['-c', 'source "$1"; release_seed_guard "$2" "$3" "$4"', 'x', helper, roles, profile, seed], {
      encoding: 'utf8',
      env: { ...process.env, ...CLEAN_ENV, ...env },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const AUDIT = { PAPERCUSP_RELEASE_AUDIT: '1' };

test('release-audited seedless Server build is REFUSED (the D-224 shape)', () => {
  const r = guard({ env: AUDIT });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /release-audited Server build .* has no hive seed/);
  assert.match(r.stderr, /PAPERCUSP_ALLOW_SEEDLESS_RELEASE=1/);
});

test('release-audited public Server is refused too (tauri.server.conf.json bundles seed/**)', () => {
  assert.equal(guard({ profile: 'public', env: AUDIT }).status, 1);
});

test('a present seed passes and prints a SEED_GUARD receipt with the manifest sha256', () => {
  const r = guard({ seeded: true, env: AUDIT });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^SEED_GUARD role=server profile=dogfood seed=present manifestSha256=[0-9a-f]{64}$/m);
});

test('explicit seedless opt-out needs a reason, and the reason is recorded', () => {
  const noReason = guard({ env: { ...AUDIT, PAPERCUSP_ALLOW_SEEDLESS_RELEASE: '1' } });
  assert.equal(noReason.status, 1);
  assert.match(noReason.stderr, /needs a non-empty PAPERCUSP_ALLOW_SEEDLESS_REASON/);
  const allowed = guard({
    env: { ...AUDIT, PAPERCUSP_ALLOW_SEEDLESS_RELEASE: '1', PAPERCUSP_ALLOW_SEEDLESS_REASON: 'plan#D-999 scope cut' },
  });
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stdout, /seed=absent allowed=1 reason=plan#D-999 scope cut/);
});

test('GUI-only builds, vm-release, and non-audit builds are not refused', () => {
  assert.equal(guard({ roles: 'gui', env: AUDIT }).status, 0);
  const vm = guard({ roles: 'server', profile: 'vm-release', env: AUDIT });
  assert.equal(vm.status, 0);
  assert.match(vm.stdout, /seed=excluded-by-profile/);
  const dev = guard({});
  assert.equal(dev.status, 0);
  assert.match(dev.stderr, /WARN: no seed manifest/);
});

// Every Server-producing path must run the guard BEFORE its first expensive build step,
// so a seedless release fails in seconds rather than after hours of compile and
// nomination. The marker is that first build step, not a banner: mac-vm-build.sh echoes
// its "build start" banner before the seed cut (WI-6554700010012186).
const GUARD_CALL = /^\s*(PAPERCUSP_RELEASE_AUDIT=1\s+)?release_seed_guard "/;
// A mutation probe points ONE script at a mutated copy:
//   PAPERCUSP_SEED_GUARD_SCRIPT_OVERRIDE=<script name>=<path to copy>
const [overrideName, overridePath] = (process.env.PAPERCUSP_SEED_GUARD_SCRIPT_OVERRIDE || '').split(/=(.*)/s);
const scriptPath = (script) => (script === overrideName && overridePath ? overridePath : path.join(root, 'bin', script));
const scriptLines = (script) => fs.readFileSync(scriptPath(script), 'utf8').split('\n');

for (const [script, buildStartMarker] of [
  ['build-mac-cross.sh', '===== mac cross-build start'],
  ['build-linux-local.sh', '==> Linux local build:'],
  ['mac-vm-build.sh', '--- term shim (SwiftPM) ---'],
  ['release-local.sh', '==> building sidecar'],
]) {
  test(`${script} calls release_seed_guard before the build starts`, () => {
    const lines = scriptLines(script);
    const guardAt = lines.findIndex((l) => GUARD_CALL.test(l));
    const startAt = lines.findIndex((l) => l.includes(buildStartMarker));
    assert.ok(guardAt >= 0, `${script} must call release_seed_guard`);
    assert.ok(startAt >= 0, `${script} build-start marker moved; update this test`);
    assert.ok(guardAt < startAt, `${script}: guard (line ${guardAt + 1}) must precede the build start (line ${startAt + 1})`);
    // The call may continue onto later lines with a trailing backslash.
    let call = lines[guardAt];
    for (let i = guardAt + 1; /\\\s*$/.test(call) && i < lines.length; i += 1) call = call.replace(/\\\s*$/, ' ') + lines[i];
    // `fail` is build-mac-cross.sh's `echo ERROR; exit 1` helper.
    assert.match(call, /\|\|\s*(exit 1|fail "[^"]*")\s*$/, `${script}: a refused guard must stop the build`);
  });
}

test('release-local.sh forces the release audit on its guard (its own RELEASE_AUDIT export comes later)', () => {
  const lines = scriptLines('release-local.sh');
  const guardAt = lines.findIndex((l) => GUARD_CALL.test(l));
  const exportAt = lines.findIndex((l) => /^export PAPERCUSP_RELEASE_AUDIT=1\b/.test(l));
  assert.match(lines[guardAt], /^PAPERCUSP_RELEASE_AUDIT=1 release_seed_guard /);
  assert.ok(exportAt > guardAt, 'if the export moves above the guard, this test (and the inline override) can go');
});

test('mac-vm-verify-build.sh placeholder build opts out explicitly, with a reason, and that env passes the guard', () => {
  const src = fs.readFileSync(scriptPath('mac-vm-verify-build.sh'), 'utf8');
  assert.match(src, /export PAPERCUSP_SKIP_SEED_CUT=1/);
  assert.match(src, /export PAPERCUSP_ALLOW_SEEDLESS_RELEASE=1/);
  const reason = src.match(/export PAPERCUSP_ALLOW_SEEDLESS_REASON=(\S+)/);
  assert.ok(reason && reason[1].length > 0, 'the placeholder opt-out must carry a non-empty reason');
  const r = guard({
    env: { ...AUDIT, PAPERCUSP_ALLOW_SEEDLESS_RELEASE: '1', PAPERCUSP_ALLOW_SEEDLESS_REASON: reason[1] },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /seed=absent allowed=1 reason=mac-vm-verify-build/);
});
