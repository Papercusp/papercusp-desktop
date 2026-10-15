'use strict';
// WI-6554700010010442 / plan disk-headroom-standing-reclaim-2026-10-12#D-005: the failed
// sidecar stage bank kept every failed stage (5-9 GB each) forever. These tests pin the
// retention policy the producer now enforces on every build, and drive the real shell
// seams in build-desktop-sidecar.sh that call it.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { makeDesktopTestScratchDirSync } = require('./test-scratch.cjs');
const { failureEvidenceRoot, parsePruneArgs, pruneFailedStages, recordFailure } =
  require('../bin/lib/sidecar-stage-state.js');

const bin = path.resolve(__dirname, '../bin');
const helper = path.join(bin, 'lib/sidecar-stage-state.js');
const builder = fs.readFileSync(path.join(bin, 'build-desktop-sidecar.sh'), 'utf8');
const finish = builder.match(/^__pc_finish_sidecar_build\(\) \{\n[\s\S]*?^\}$/m)[0];
const trap = builder.match(/^trap '[^\n]*' EXIT$/m)[0];
const startPruneAt = builder.indexOf('# WI-6554700010010442 / plan disk-headroom');
const startPrune = builder.slice(startPruneAt, builder.indexOf('export SIDECAR_STAGE_REPO_ROOT=', startPruneAt));
const HOUR = 3600e3;
let pinScratch;
let previousPinEnv;
beforeEach(() => {
  pinScratch = makeDesktopTestScratchDirSync('sidecar-pins-');
  previousPinEnv = [process.env.PAPERCUSP_RELEASE_RETENTION_ROOT, process.env.PAPERCUSP_FS_MUTEX_LOCK_DIR];
  process.env.PAPERCUSP_RELEASE_RETENTION_ROOT = path.join(pinScratch, 'leases');
  process.env.PAPERCUSP_FS_MUTEX_LOCK_DIR = path.join(pinScratch, 'mutex');
});
afterEach(() => {
  for (const [index, key] of ['PAPERCUSP_RELEASE_RETENTION_ROOT', 'PAPERCUSP_FS_MUTEX_LOCK_DIR'].entries()) {
    if (previousPinEnv[index] === undefined) delete process.env[key]; else process.env[key] = previousPinEnv[index];
  }
  fs.rmSync(pinScratch, { recursive: true, force: true });
});
function pin(target, expiresAt = Date.now() + HOUR) {
  const id = crypto.randomUUID();
  const tag = 'agent-pin-' + Buffer.from(JSON.stringify({ version: 1, id, owner: 'test', reason: 'review',
    createdAt: new Date().toISOString() })).toString('base64url');
  const dir = process.env.PAPERCUSP_RELEASE_RETENTION_ROOT;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `lease-agent-pin-${id}.tsv`),
    `schema=papercusp-release-retention/v1\ntag=${tag}\nexpires_ns=${BigInt(expiresAt) * 1000000n}\npath=${target}\n`);
}

function scratch() {
  const root = makeDesktopTestScratchDirSync('sidecar-failed-stage-prune-');
  const state = path.join(root, 'state home');
  const finalDir = path.join(root, 'product', 'sidecar');
  fs.mkdirSync(path.dirname(finalDir), { recursive: true });
  const keyDir = failureEvidenceRoot(finalDir, { XDG_STATE_HOME: state });
  fs.mkdirSync(keyDir, { recursive: true });
  return { root, state, finalDir, keyDir, parent: path.dirname(keyDir) };
}

// A real stage + real receipt via the producer's own recordFailure; the receipt's mtime is
// the failure time the policy reads.
function stage(keyDir, suffix, { phase = 'assembled', ageHours = 0, receipt = true, output = 'sidecar' } = {}) {
  const dir = path.join(keyDir, `${output}.failed-stage.${suffix}`);
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'serve.mjs'), `assembled ${suffix}`);
  fs.writeFileSync(path.join(dir, 'bin/node'), crypto.randomBytes(64 * 1024));
  if (receipt) {
    recordFailure(dir, { finalDir: 'fixture' }, phase, 1);
    const when = new Date(Date.now() - ageHours * HOUR);
    fs.utimesSync(`${dir}.resume.json`, when, when);
  }
  return dir;
}

function orphanReceipt(keyDir, suffix, ageHours) {
  const file = path.join(keyDir, `sidecar.failed-stage.${suffix}.resume.json`);
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, accepted: false, status: 'failed',
    phase: 'assembled', resumable: true }));
  const when = new Date(Date.now() - ageHours * HOUR);
  fs.utimesSync(file, when, when);
  return file;
}

const exists = file => fs.existsSync(file);
const reasons = receipt => Object.fromEntries(receipt.deleted.map(row => [path.basename(row.path), row.reason]));

test('locked output keeps only its newest resumable stage and deletes every other entry', async () => {
  const f = scratch();
  try {
    const newest = stage(f.keyDir, '300', { ageHours: 1 });
    const older = stage(f.keyDir, '200', { ageHours: 3 });
    const broken = stage(f.keyDir, '100', { phase: 'assembling', ageHours: 5 });
    const orphan = orphanReceipt(f.keyDir, '10', 6);
    fs.writeFileSync(path.join(f.keyDir, 'unrelated.txt'), 'not a stage');
    fs.writeFileSync(`${newest}.resume.json.tmp.999`, 'in-flight receipt write');
    const receipt = await pruneFailedStages({ keyDir: f.keyDir, output: f.finalDir }, {});
    assert.ok(exists(newest) && exists(`${newest}.resume.json`), 'newest resumable stage is kept');
    for (const gone of [older, `${older}.resume.json`, broken, `${broken}.resume.json`, orphan])
      assert.equal(exists(gone), false, `${gone} must be deleted`);
    assert.ok(exists(path.join(f.keyDir, 'unrelated.txt')), 'non-stage entries are never touched');
    assert.ok(exists(`${newest}.resume.json.tmp.999`), 'an in-flight receipt temp file is never touched');
    assert.deepEqual(reasons(receipt), {
      'sidecar.failed-stage.200': 'superseded', 'sidecar.failed-stage.200.resume.json': 'superseded',
      'sidecar.failed-stage.100': 'not-resumable', 'sidecar.failed-stage.100.resume.json': 'not-resumable',
      'sidecar.failed-stage.10.resume.json': 'orphan-receipt',
    });
    assert.deepEqual(receipt.kept.map(row => row.reason), ['newest-resumable']);
    assert.ok(receipt.freedBytes >= 2 * 64 * 1024, `freed bytes counted from disk blocks: ${receipt.freedBytes}`);
    assert.deepEqual(receipt.errors, []);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('under the lock a receipt-less stage is deleted and, being newest, keeps nothing older', async () => {
  const f = scratch();
  try {
    const resumable = stage(f.keyDir, '1', { ageHours: 1 });
    const noReceipt = stage(f.keyDir, '2', { receipt: false });
    const receipt = await pruneFailedStages({ keyDir: f.keyDir, output: f.finalDir }, {});
    assert.equal(exists(noReceipt), false);
    assert.equal(exists(resumable), false, 'a newer failed build supersedes the older identity');
    assert.equal(reasons(receipt)['sidecar.failed-stage.2'], 'no-receipt');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('a newer non-resumable failure supersedes an older resumable stage', async () => {
  const f = scratch();
  try {
    const resumable = stage(f.keyDir, '1', { ageHours: 2 });
    const latest = stage(f.keyDir, '2', { phase: 'qualifying', ageHours: 1 });
    await pruneFailedStages({ keyDir: f.keyDir, output: f.finalDir }, {});
    assert.equal(exists(resumable), false, 'an older identity cannot be resumed after a newer build');
    assert.equal(exists(latest), false, 'a non-resumable newest stage is not kept either');
    assert.deepEqual(fs.readdirSync(f.keyDir), []);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('the newest resumable stage expires after the TTL', async () => {
  const f = scratch();
  try {
    const old = stage(f.keyDir, '7', { ageHours: 30 });
    const receipt = await pruneFailedStages({ keyDir: f.keyDir, output: f.finalDir }, {});
    assert.equal(exists(old), false);
    assert.equal(reasons(receipt)['sidecar.failed-stage.7'], 'expired');
    const kept = stage(f.keyDir, '8', { ageHours: 30 });
    await pruneFailedStages({ keyDir: f.keyDir, output: f.finalDir },
      { PAPERCUSP_SIDECAR_FAILED_STAGE_TTL_HOURS: '48' });
    assert.ok(exists(kept), 'PAPERCUSP_SIDECAR_FAILED_STAGE_TTL_HOURS widens the window');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('the RESUME_FROM target and its receipt are never deleted, even by --clear', async () => {
  const f = scratch();
  try {
    const target = stage(f.keyDir, '40', { ageHours: 50 });
    const other = stage(f.keyDir, '41', { ageHours: 1 });
    await pruneFailedStages({ keyDir: f.keyDir, output: f.finalDir, clear: true, protect: [target] }, {});
    assert.ok(exists(target) && exists(`${target}.resume.json`));
    assert.equal(exists(other), false, '--clear removes the unprotected newest stage too');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('--all sweeps other outputs outside the grace window and writes a receipt', async () => {
  const f = scratch();
  try {
    const otherKey = path.join(f.parent, 'a'.repeat(24));
    const freshNoReceipt = stage(otherKey, '1', { receipt: false });
    const oldSuperseded = stage(otherKey, '2', { ageHours: 3 });
    const otherNewest = stage(otherKey, '3', { ageHours: 2 });
    const ignoredDir = path.join(f.parent, 'not-a-key');
    const ignored = stage(ignoredDir, '1', { ageHours: 100 });
    const own = stage(f.keyDir, '9', { phase: 'assembling', receipt: true });
    const receipt = await pruneFailedStages({ all: true, keyDir: f.keyDir, output: f.finalDir }, { XDG_STATE_HOME: f.state });
    assert.equal(exists(own), false, 'the locked output is pruned without a grace window');
    assert.ok(exists(freshNoReceipt), 'another builder may still be writing its receipt');
    assert.equal(exists(oldSuperseded), false);
    assert.equal(exists(otherNewest), false, 'the newest entry of that output is the receipt-less one');
    assert.ok(exists(ignored), 'only 24-hex key directories under the bank are swept');
    const written = JSON.parse(fs.readFileSync(path.join(f.parent, 'last-prune.json'), 'utf8'));
    assert.equal(written.kind, 'sidecar-failed-stage-prune');
    assert.deepEqual(written.deleted.map(row => row.path).sort(), receipt.deleted.map(row => row.path).sort());
    await pruneFailedStages({ all: true }, { XDG_STATE_HOME: f.state, PAPERCUSP_SIDECAR_FAILED_STAGE_GRACE_MINUTES: '0' });
    assert.equal(exists(freshNoReceipt), false, 'outside the grace window it is deleted');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('--dry-run reports without deleting; invalid arguments refuse', async () => {
  const f = scratch();
  try {
    const victim = stage(f.keyDir, '5', { ageHours: 40 });
    const receipt = await pruneFailedStages({ ...parsePruneArgs(['--key-dir', f.keyDir, '--output', f.finalDir, '--dry-run']) }, {});
    assert.ok(exists(victim));
    assert.equal(receipt.dryRun, true);
    assert.equal(receipt.deleted.length, 2);
    await assert.rejects(() => pruneFailedStages({}, {}), /requires --all or --key-dir/);
    await assert.rejects(() => pruneFailedStages({ keyDir: f.keyDir }, {}), /together/);
    await assert.rejects(() => pruneFailedStages({ all: true, clear: true }, {}), /--clear requires/);
    await assert.rejects(() => pruneFailedStages({ all: true, ttlHours: 'soon' }, {}), /non-negative/);
    assert.throws(() => parsePruneArgs(['--bogus']), /unknown argument/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('the build-start prune runs after the EXIT trap and outside the isolated build-lock block', async () => {
  const lockStart = builder.indexOf('SIDECAR_BUILD_LOCK="$SIDECAR_FINAL_DIR.build.lock"');
  const lockEnd = builder.indexOf('# Acquire/release the reader-facing lock', lockStart);
  const exitTrapAt = builder.indexOf(trap);
  assert.ok(lockStart > 0 && lockEnd > lockStart && exitTrapAt > 0 && startPruneAt > 0);
  // Lock tests execute [lockStart, lockEnd) on its own; a prune there would sweep the
  // test host's real bank whenever HERE happens to be set.
  assert.ok(startPruneAt > lockEnd, 'prune must not sit inside the build-lock block');
  assert.ok(startPruneAt > exitTrapAt, 'the build lock and EXIT handling are in place first');
  assert.ok(startPruneAt < builder.indexOf('node "$HERE/lib/sidecar-stage-state.js" capture'),
    'prune precedes stage capture and any RESUME_FROM move');
});

test('build start prunes under the lock and protects a RESUME_FROM path containing spaces', async () => {
  const f = scratch();
  try {
    const target = stage(f.keyDir, '11', { ageHours: 50 });
    const stale = stage(f.keyDir, '12', { phase: 'assembling', ageHours: 2 });
    assert.ok(startPrune.includes('prune --all'), 'the start-of-build prune block was located');
    const result = spawnSync('bash', ['-c', ['set -euo pipefail', 'HERE="$1"; SIDECAR_FAILED_STAGE_ROOT="$2"; SIDECAR_FINAL_DIR="$3"',
      startPrune].join('\n'), 'test', bin, f.keyDir, f.finalDir], {
      encoding: 'utf8', env: { ...process.env, XDG_STATE_HOME: f.state, PAPERCUSP_SIDECAR_RESUME_FROM: target },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(exists(target) && exists(`${target}.resume.json`), result.stdout);
    assert.equal(exists(stale), false, result.stdout);
    assert.match(result.stdout, /^SIDECAR_FAILED_STAGE_PRUNE \{/m);
    const unset = spawnSync('bash', ['-c', ['set -euo pipefail', 'HERE="$1"; SIDECAR_FAILED_STAGE_ROOT="$2"; SIDECAR_FINAL_DIR="$3"',
      startPrune].join('\n'), 'test', bin, f.keyDir, f.finalDir], {
      encoding: 'utf8', env: { ...process.env, XDG_STATE_HOME: f.state, PAPERCUSP_SIDECAR_RESUME_FROM: '' },
    });
    assert.equal(unset.status, 0, unset.stderr);
    assert.equal(exists(target), false, 'without RESUME_FROM the expired stage is pruned');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('a successful build clears its own output group through the real EXIT trap', async () => {
  const f = scratch();
  try {
    const failedBefore = stage(f.keyDir, '20', { ageHours: 1 });
    const otherOutput = stage(f.keyDir, '21', { ageHours: 1, output: 'sidecar-arm64' });
    const tmp = `${f.finalDir}.tmp.4321`;
    fs.mkdirSync(tmp);
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail', finish,
      'SIDECAR_FINAL_DIR="$1"; SIDECAR_TMP_DIR="$2"; SIDECAR_FAILED_STAGE_ROOT="$3"; HERE="$4"',
      '_sidecar_stage_phase=assembled; _sidecar_success=1; _sidecar_published=1',
      '__pc_release_sidecar_publish_lock() { :; }',
      trap, 'exit 0',
    ].join('\n'), 'test', f.finalDir, tmp, f.keyDir, bin], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(exists(failedBefore), false, result.stdout + result.stderr);
    assert.equal(exists(`${failedBefore}.resume.json`), false);
    assert.ok(exists(otherOutput), 'another output sharing the bank is not cleared');
    assert.match(result.stdout, /output-built-successfully/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('the helper CLI exits non-zero only on a refused invocation', async () => {
  const result = spawnSync(process.execPath, [helper, 'prune'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires --all or --key-dir/);
});


test('finite descendant pins protect stages and receipts through aliases; expiry restores cleanup', async () => {
  const f = scratch();
  try {
    const target = stage(f.keyDir, '40', { ageHours: 50 });
    const other = stage(f.keyDir, '41', { ageHours: 50 });
    const child = path.join(target, 'review'); fs.mkdirSync(child);
    pin(child);
    const alias = path.join(f.root, 'stage-alias'); fs.symlinkSync(f.keyDir, alias);
    const receipt = await pruneFailedStages({ keyDir: alias, output: f.finalDir, clear: true }, {});
    assert.ok(exists(target) && exists(`${target}.resume.json`));
    assert.equal(exists(other), false);
    assert.equal(receipt.kept[0].reason, 'retention-pin');
    await pruneFailedStages({ keyDir: f.keyDir, output: f.finalDir, clear: true, now: Date.now() + 2 * HOUR }, {});
    assert.equal(exists(target), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('an unreadable pin store refuses the complete standalone sweep before deletion', async () => {
  const f = scratch();
  try {
    const target = stage(f.keyDir, '40', { ageHours: 50 });
    fs.mkdirSync(process.env.PAPERCUSP_RELEASE_RETENTION_ROOT, { recursive: true });
    fs.writeFileSync(path.join(process.env.PAPERCUSP_RELEASE_RETENTION_ROOT, 'lease-broken.tsv'), 'broken');
    await assert.rejects(() => pruneFailedStages({ keyDir: f.keyDir, output: f.finalDir }, {}), /retention pins unreadable/);
    assert.ok(exists(target) && exists(`${target}.resume.json`));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
