'use strict';

// The release cut's WSL rootfs preflight (bin/lib/wsl-rootfs-preflight.sh).
//
// WHY (WI-6554700010042513). The 0.0.32 cut's old preflight compared only the
// rootfs tarball's sha256 with the tracked .rootfs-build-stamp. The tarball
// matched, but the tracked stamp itself was stale: an old recipe fingerprint and
// no bunArchiveSha256. The Windows leg runs `build-rootfs.sh --verify-artifacts`
// before packing, which checks all four inputs, so the cut failed there minutes
// in instead of at second zero. These tests pin the replacement:
//   * the preflight runs the target's own --verify-artifacts check, and a stale
//     recipe fails it in seconds (exercised with the REAL build-rootfs.sh);
//   * a missing Bun archive fails, or is hydrated only from a donor whose sha256
//     matches the tracked stamp;
//   * a target whose build-rootfs.sh predates the flag is never invoked, because
//     invoking it starts a full rebuild that deletes the tarball;
//   * every file build-rootfs.sh or the hydration writes under
//     src-tauri/resources is either tracked or gitignored, so git-sync cannot
//     sweep a 40 MB temp file into history (it did once: commit 7c62d8a5).

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
// Overridable so a mutation probe can run this suite against a COPY outside the
// shared tree (scripts/mutation-probe.sh), never a mutated file in place.
const helper = process.env.PAPERCUSP_WSL_PREFLIGHT_PATH
  || path.join(root, 'bin', 'lib', 'wsl-rootfs-preflight.sh');
const TARBALL = 'papercup-runtime.tar.gz';
const ZIP = 'papercup-bun-linux.zip';
const STAMP = '.rootfs-build-stamp';
const RECIPE = 'papercup-rootfs-recipe';

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function tempWorkspace(t) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-rootfs-preflight-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  return ws;
}

// <ws>/<checkout>/papercusp-desktop, so the helper's sibling scan ($ROOT/../..)
// stays inside the temp workspace and never reaches the real one.
function checkout(ws, name) {
  const dir = path.join(ws, name, 'papercusp-desktop');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src-tauri', 'resources'), { recursive: true });
  return dir;
}

const resources = (dir) => path.join(dir, 'src-tauri', 'resources');

function useRealVerifier(dir) {
  fs.copyFileSync(path.join(root, 'scripts', 'build-rootfs.sh'), path.join(dir, 'scripts', 'build-rootfs.sh'));
  for (const name of ['papercup-bootstrap.sh', 'papercup-bun-runtime.py']) {
    fs.copyFileSync(path.join(root, 'src-tauri', 'resources', name), path.join(resources(dir), name));
  }
}

// A verifier that implements --verify-artifacts. Any other invocation is a full
// build, which the preflight must never start.
function useStubVerifier(dir) {
  fs.writeFileSync(path.join(dir, 'scripts', 'build-rootfs.sh'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [[ "${1:-}" == "--verify-artifacts" ]]; then',
    '  printf "VERIFY|%s|%s\\n" "${PAPERCUSP_ROOTFS_OUT_DIR:-}" "${PAPERCUSP_RUNTIME_PLATFORM:-}" >> "$STUB_LOG"',
    `  for f in ${STAMP} ${TARBALL} ${ZIP}; do`,
    '    test -f "$PAPERCUSP_ROOTFS_OUT_DIR/$f" || { echo "stub verifier: missing $f" >&2; exit 1; }',
    '  done',
    '  exit "${STUB_VERIFY_RC:-0}"',
    'fi',
    'echo FULL_BUILD >> "$STUB_LOG"',
    'exit 99',
    '',
  ].join('\n'));
}

// A build-rootfs.sh that predates --verify-artifacts: it ignores its arguments,
// and its full build starts by deleting the tarball, as the real one did.
function useOldVerifier(dir) {
  fs.writeFileSync(path.join(dir, 'scripts', 'build-rootfs.sh'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'echo FULL_BUILD >> "$STUB_LOG"',
    `rm -f "$(cd "$(dirname "$0")/.." && pwd)/src-tauri/resources/${TARBALL}"`,
    'exit 0',
    '',
  ].join('\n'));
}

function writeArtifacts(resDir, { tarball, zip, stamp, recipe }) {
  if (tarball !== undefined) fs.writeFileSync(path.join(resDir, TARBALL), tarball);
  if (zip !== undefined) fs.writeFileSync(path.join(resDir, ZIP), zip);
  if (stamp !== undefined) fs.writeFileSync(path.join(resDir, STAMP), JSON.stringify(stamp, null, 2) + '\n');
  if (recipe !== undefined) fs.writeFileSync(path.join(resDir, RECIPE), recipe + '\n');
}

function stampFor(tarball, zip, extra = {}) {
  return {
    platform: 'linux/amd64',
    recipeSha256: 'a'.repeat(64),
    rootfsSha256: sha(tarball),
    bunArchiveSha256: sha(zip),
    ...extra,
  };
}

// Mirrors release-local.sh: strict mode, then the call in an `||` context. The
// PREFLIGHT_RC line proves the function RETURNED instead of exiting the caller.
function preflight(t, target, env = {}, mode = '') {
  const log = path.join(path.dirname(path.dirname(target)), 'stub.log');
  fs.writeFileSync(log, '');
  const cleanEnv = { ...process.env };
  for (const key of ['PAPERCUSP_ROOTFS_DONOR', 'PAPERCUSP_ROOTFS_OUT_DIR', 'PAPERCUSP_RUNTIME_PLATFORM',
    'UBUNTU_IMAGE', 'NODE_VERSION', 'PNPM_VERSION', 'STUB_VERIFY_RC']) delete cleanEnv[key];
  const started = Date.now();
  const result = spawnSync('bash', ['-c', [
    'set -euo pipefail',
    'source "$1"',
    'rc=0',
    'papercusp_wsl_rootfs_preflight "$2" "$3" || rc=$?',
    'echo "PREFLIGHT_RC=$rc"',
  ].join('\n'), 'preflight', helper, target, mode], {
    encoding: 'utf8',
    env: { ...cleanEnv, STUB_LOG: log, ...env },
    timeout: 120_000,
  });
  const match = /PREFLIGHT_RC=(\d+)/.exec(result.stdout || '');
  assert.ok(match, `the preflight must return to its caller, not exit it.\nstatus=${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  return {
    rc: Number(match[1]),
    stdout: result.stdout,
    stderr: result.stderr,
    log: fs.readFileSync(log, 'utf8'),
    ms: Date.now() - started,
  };
}

test('a stale recipe in the tracked stamp fails the real --verify-artifacts check in seconds', (t) => {
  const ws = tempWorkspace(t);
  const target = checkout(ws, 'target');
  useRealVerifier(target);
  const tarball = Buffer.from('rootfs bytes');
  const zip = Buffer.from('bun archive bytes');
  // The tarball matches its receipt, which is all the old preflight checked.
  writeArtifacts(resources(target), { tarball, zip, stamp: stampFor(tarball, zip), recipe: 'a'.repeat(64) });

  const out = preflight(t, target);

  assert.notEqual(out.rc, 0, out.stdout + out.stderr);
  assert.match(out.stderr, /rootfs recipe is stale/);
  assert.match(out.stderr, /fail the Windows leg's own check/);
  assert.ok(out.ms < 60_000, `the preflight must fail fast, took ${out.ms}ms`);
  // A read-only check: the artifact it judged is untouched.
  assert.deepEqual(fs.readFileSync(path.join(resources(target), TARBALL)), tarball);
});

test('a missing Bun archive with no matching donor fails before the verifier runs', (t) => {
  const ws = tempWorkspace(t);
  const target = checkout(ws, 'target');
  useStubVerifier(target);
  const tarball = Buffer.from('rootfs bytes');
  const zip = Buffer.from('bun archive bytes');
  writeArtifacts(resources(target), { tarball, stamp: stampFor(tarball, zip), recipe: 'a'.repeat(64) });

  const out = preflight(t, target);

  assert.notEqual(out.rc, 0);
  assert.match(out.stderr, new RegExp(`no ${ZIP.replace(/\./g, '\\.')} matching the TRACKED stamp`));
  assert.equal(out.log, '', 'the verifier must not run when an input is missing');
  assert.equal(fs.existsSync(path.join(resources(target), ZIP)), false);
});

test('a stamp that predates the Bun archive receipt cannot verify a donor and says to rebuild', (t) => {
  const ws = tempWorkspace(t);
  const target = checkout(ws, 'target');
  useStubVerifier(target);
  const tarball = Buffer.from('rootfs bytes');
  const stamp = stampFor(tarball, Buffer.from('x'));
  delete stamp.bunArchiveSha256;
  writeArtifacts(resources(target), { tarball, stamp, recipe: 'a'.repeat(64) });

  const out = preflight(t, target);

  assert.notEqual(out.rc, 0);
  assert.match(out.stderr, /has no bunArchiveSha256/);
  assert.match(out.stderr, /Re-run scripts\/build-rootfs\.sh/);
});

test('both artifacts hydrate from PAPERCUSP_ROOTFS_DONOR, then the target verifier checks them', (t) => {
  const ws = tempWorkspace(t);
  const target = checkout(ws, 'target');
  useStubVerifier(target);
  const tarball = Buffer.from('rootfs bytes');
  const zip = Buffer.from('bun archive bytes');
  writeArtifacts(resources(target), { stamp: stampFor(tarball, zip), recipe: 'a'.repeat(64) });
  const donorDir = path.join(ws, 'elsewhere');
  fs.mkdirSync(donorDir);
  writeArtifacts(donorDir, { tarball, zip });

  const out = preflight(t, target, { PAPERCUSP_ROOTFS_DONOR: path.join(donorDir, TARBALL) });

  assert.equal(out.rc, 0, out.stdout + out.stderr);
  assert.deepEqual(fs.readFileSync(path.join(resources(target), TARBALL)), tarball);
  assert.deepEqual(fs.readFileSync(path.join(resources(target), ZIP)), zip);
  assert.equal(out.log, `VERIFY|${resources(target)}|linux/amd64\n`,
    'the verifier runs once, the way the Windows leg runs it, against the target resources');
  const leftovers = fs.readdirSync(resources(target)).filter((name) => name.includes('.tmp.'));
  assert.deepEqual(leftovers, [], 'hydration must not leave temp files behind');
});

test('the sibling scan rejects a wrong-sha donor and takes the matching one', (t) => {
  const ws = tempWorkspace(t);
  const target = checkout(ws, 'target');
  useStubVerifier(target);
  const tarball = Buffer.from('rootfs bytes');
  const zip = Buffer.from('bun archive bytes');
  writeArtifacts(resources(target), { stamp: stampFor(tarball, zip), recipe: 'a'.repeat(64) });
  writeArtifacts(resources(checkout(ws, 'a-stale')), { tarball: Buffer.from('old rootfs'), zip: Buffer.from('old zip') });
  writeArtifacts(resources(checkout(ws, 'b-good')), { tarball, zip });

  const out = preflight(t, target);

  assert.equal(out.rc, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /donor rejected: sha256 differs from the tracked stamp: .*a-stale/);
  assert.deepEqual(fs.readFileSync(path.join(resources(target), TARBALL)), tarball);
  assert.deepEqual(fs.readFileSync(path.join(resources(target), ZIP)), zip);
});

test('a donor that matches nothing is never copied in', (t) => {
  const ws = tempWorkspace(t);
  const target = checkout(ws, 'target');
  useStubVerifier(target);
  const tarball = Buffer.from('rootfs bytes');
  const zip = Buffer.from('bun archive bytes');
  writeArtifacts(resources(target), { stamp: stampFor(tarball, zip), recipe: 'a'.repeat(64) });
  writeArtifacts(resources(checkout(ws, 'stale')), { tarball: Buffer.from('old rootfs'), zip });

  const out = preflight(t, target);

  assert.notEqual(out.rc, 0);
  assert.equal(fs.existsSync(path.join(resources(target), TARBALL)), false);
  assert.equal(out.log, '');
});

test('a verifier refusal fails the preflight', (t) => {
  const ws = tempWorkspace(t);
  const target = checkout(ws, 'target');
  useStubVerifier(target);
  const tarball = Buffer.from('rootfs bytes');
  const zip = Buffer.from('bun archive bytes');
  writeArtifacts(resources(target), { tarball, zip, stamp: stampFor(tarball, zip), recipe: 'a'.repeat(64) });

  const out = preflight(t, target, { STUB_VERIFY_RC: '1' });

  assert.notEqual(out.rc, 0);
  assert.match(out.stderr, /fail the Windows leg's own check/);
});

test('a missing stamp fails', (t) => {
  const ws = tempWorkspace(t);
  const target = checkout(ws, 'target');
  useStubVerifier(target);
  writeArtifacts(resources(target), { tarball: Buffer.from('rootfs bytes'), zip: Buffer.from('zip') });

  const out = preflight(t, target);

  assert.notEqual(out.rc, 0);
  assert.match(out.stderr, /tracked rootfs stamp is missing/);
});

test('a target that predates --verify-artifacts is never invoked; the sha-only check runs instead', (t) => {
  const ws = tempWorkspace(t);
  const target = checkout(ws, 'target');
  useOldVerifier(target);
  const tarball = Buffer.from('rootfs bytes');
  const zip = Buffer.from('bun archive bytes');
  writeArtifacts(resources(target), { tarball, zip, stamp: stampFor(tarball, zip), recipe: 'a'.repeat(64) });

  const good = preflight(t, target);
  assert.equal(good.rc, 0, good.stdout + good.stderr);
  assert.match(good.stderr, /does not implement --verify-artifacts/);
  assert.equal(good.log, '', 'calling an old build-rootfs.sh starts a full rebuild that deletes the tarball');
  assert.deepEqual(fs.readFileSync(path.join(resources(target), TARBALL)), tarball);

  fs.writeFileSync(path.join(resources(target), TARBALL), 'different rootfs bytes');
  const bad = preflight(t, target);
  assert.notEqual(bad.rc, 0);
  assert.match(bad.stderr, new RegExp(`${TARBALL.replace(/\./g, '\\.')} does not match the tracked`));
  assert.equal(bad.log, '');
});

test('release-local.sh gates WITH_WINDOWS on this helper, sourced from the orchestrator revision', () => {
  const scriptPath = process.env.PAPERCUSP_RELEASE_LOCAL_PATH || path.join(root, 'bin', 'release-local.sh');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const gate = /\nif \[\[ "\$WITH_WINDOWS" == "1" && "\$\{PAPERCUSP_REUSE_WIN:-0\}" != "1" \]\]; then\n([\s\S]*?)\nfi\n/.exec(source);
  assert.ok(gate, 'release-local.sh must keep a WITH_WINDOWS rootfs gate (skipped only under PAPERCUSP_REUSE_WIN=1)');
  // A frozen salvage target's $ROOT/bin/lib predates the helper (WI-6554700010042517).
  assert.match(gate[1], /source "\$ORCHESTRATOR_HERE\/lib\/wsl-rootfs-preflight\.sh"/);
  assert.match(gate[1], /papercusp_wsl_rootfs_preflight "\$ROOT" \|\| exit 1/);
  // The sha-only compare that let the 0.0.32 cut through must not come back inline.
  assert.doesNotMatch(source, /rootfs_have_sha=/);
});

test('read-only readiness accepts verified donors without materializing target artifacts', (t) => {
  const ws = tempWorkspace(t);
  const target = checkout(ws, 'target');
  useStubVerifier(target);
  const tarball = Buffer.from('rootfs bytes');
  const zip = Buffer.from('bun archive bytes');
  writeArtifacts(resources(target), { stamp: stampFor(tarball, zip), recipe: 'a'.repeat(64) });
  const donor = resources(checkout(ws, 'donor'));
  writeArtifacts(donor, { tarball, zip });
  const before = fs.readdirSync(resources(target));
  const scratch = path.join(ws, 'scratch');
  fs.mkdirSync(scratch);

  const out = preflight(t, target, { TMPDIR: scratch }, '--read-only');

  assert.equal(out.rc, 0, out.stdout + out.stderr);
  assert.deepEqual(fs.readdirSync(resources(target)), before, 'dry-run must not hydrate the target');
  assert.deepEqual(fs.readdirSync(scratch), [], 'validation view must be removed');
  assert.match(out.log, /VERIFY\|.*papercusp-wsl-readiness.*\|linux\/amd64/);
  assert.deepEqual(fs.readFileSync(path.join(donor, TARBALL)), tarball);
});

test('read-only readiness leaves missing inputs absent after verifier refusal', (t) => {
  const ws = tempWorkspace(t);
  const target = checkout(ws, 'target');
  useRealVerifier(target);
  const tarball = Buffer.from('rootfs bytes');
  const zip = Buffer.from('bun archive bytes');
  writeArtifacts(resources(target), { stamp: stampFor(tarball, zip), recipe: 'a'.repeat(64) });
  writeArtifacts(resources(checkout(ws, 'donor')), { tarball, zip });
  const before = fs.readdirSync(resources(target));
  const out = preflight(t, target, {}, '--read-only');
  assert.notEqual(out.rc, 0);
  assert.match(out.stderr, /rootfs recipe is stale/);
  assert.deepEqual(fs.readdirSync(resources(target)), before);
});

test('read-only readiness refuses frozen stamps without a Bun receipt before copying any donor', (t) => {
  const ws = tempWorkspace(t);
  const target = checkout(ws, 'target');
  useStubVerifier(target);
  const tarball = Buffer.from('rootfs bytes');
  const zip = Buffer.from('bun archive bytes');
  const stamp = stampFor(tarball, zip);
  delete stamp.bunArchiveSha256;
  writeArtifacts(resources(target), { stamp, recipe: 'a'.repeat(64) });
  writeArtifacts(resources(checkout(ws, 'donor')), { tarball, zip });
  const before = fs.readdirSync(resources(target));
  const out = preflight(t, target, {}, '--read-only');
  assert.notEqual(out.rc, 0);
  assert.match(out.stderr, /has no bunArchiveSha256/);
  assert.deepEqual(fs.readdirSync(resources(target)), before);
  assert.equal(out.log, '');
});

test('read-only readiness never invokes a legacy full-build script', (t) => {
  const ws = tempWorkspace(t);
  const target = checkout(ws, 'target');
  useOldVerifier(target);
  const tarball = Buffer.from('rootfs bytes');
  const zip = Buffer.from('bun archive bytes');
  writeArtifacts(resources(target), { tarball, zip, stamp: stampFor(tarball, zip) });
  const out = preflight(t, target, {}, '--read-only');
  assert.equal(out.rc, 0, out.stdout + out.stderr);
  assert.equal(out.log, '');
  assert.deepEqual(fs.readFileSync(path.join(resources(target), TARBALL)), tarball);
});

test('every path build-rootfs.sh or hydration writes under resources is tracked or gitignored', (t) => {
  const inside = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8' });
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    t.skip('not a git work tree');
    return;
  }
  const build = fs.readFileSync(path.join(root, 'scripts', 'build-rootfs.sh'), 'utf8');
  const tarballDef = /OUT_TARBALL="\$\{OUTPUT_DIR\}\/([^"]+)"/.exec(build);
  assert.ok(tarballDef, 'build-rootfs.sh must define OUT_TARBALL under OUTPUT_DIR');
  const names = new Set();
  for (const m of build.matchAll(/"\$\{OUTPUT_DIR\}\/([^"$]+)"/g)) names.add(m[1]);
  for (const m of build.matchAll(/mktemp "\$\{(OUT_TARBALL|OUTPUT_DIR)\}([^"]*)"/g)) {
    const base = m[1] === 'OUT_TARBALL' ? tarballDef[1] : '';
    names.add((base + m[2]).replace(/^\//, '').replace(/X{6,}/, 'q1W2e3'));
  }
  // The preflight's own hydration temp files.
  const helperSource = fs.readFileSync(helper, 'utf8');
  assert.ok(helperSource.includes('"$dest.tmp.$$"'), 'hydration temp naming changed: update this test');
  names.add(`${TARBALL}.tmp.12345`);
  names.add(`${ZIP}.tmp.12345`);

  // Positive control: the derivation found the paths this test exists for.
  for (const expected of [TARBALL, ZIP, STAMP, RECIPE, `${TARBALL}.tmp.q1W2e3`, '.bun-linux.q1W2e3']) {
    assert.ok(names.has(expected), `derived path set is missing ${expected}: ${[...names].join(', ')}`);
  }

  const tracked = new Set(spawnSync('git', ['-C', root, 'ls-files', '--', 'src-tauri/resources'], { encoding: 'utf8' })
    .stdout.split('\n').filter(Boolean));
  for (const name of names) {
    const rel = `src-tauri/resources/${name}`;
    const ignored = spawnSync('git', ['-C', root, 'check-ignore', '-q', '--no-index', rel]).status === 0;
    if (tracked.has(rel)) {
      assert.equal(ignored, false, `${rel} is tracked, so no ignore rule may match it`);
    } else {
      assert.equal(ignored, true, `${rel} is written under resources but neither tracked nor gitignored`);
    }
  }
});
