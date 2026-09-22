'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
// Overridable so a mutation probe can point this suite at a MUTATED COPY
// outside the tree (mutation-probe.sh tier 2) instead of editing the shared
// checkout, where git-sync can commit the mutant mid-run. Defaults to the real
// script, so an ordinary run is unchanged.
const scriptPath = process.env.PAPERCUSP_RELEASE_LOCAL_PATH
  || path.join(root, 'bin', 'release-local.sh');
const source = fs.readFileSync(scriptPath, 'utf8');

function sliceBetween(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert(from >= 0, `release-local.sh is missing start marker: ${start}`);
  assert(to > from, `release-local.sh is missing end marker after ${start}: ${end}`);
  return source.slice(from, to);
}

// Run the REAL provenance helper and Linux reuse branch, stopping before the
// independent Android branch. This is deliberately not a rewritten model of
// the shell logic: if the production branch changes, the behavior under test
// changes with it.
const linuxReuseHarness = sliceBetween('_prov_version()', '# ── Mobile');
const releaseTaskJournalHarness = sliceBetween(
  '# ── P-005: restart-safe release stages',
  '# ── end P-005 release-task journal helpers',
);
const cutStartHarness = sliceBetween(
  '# EI-20551860898590077: bind every artifact',
  'echo "==> bumping version in manifests"',
);
const supervisorHarness = sliceBetween(
  'leg_heartbeat_line() {',
  'supervise_legs\n\n# Android',
);

function runSupervisorWithFastFailedSibling() {
  const command = [
    'set -euo pipefail',
    'LEG_HEARTBEAT_S=0',
    'LEG_GRACE_PID=',
    'LEG_TICK_PID=',
    'RELEASE_SALVAGE_GRACE_S=0',
    'LEG_NAMES=(fast slow)',
    'LEG_STATE=(alive alive)',
    'LEG_RC=( "" "" )',
    'LEG_LOGS=(/dev/null /dev/null)',
    '(sleep 0.02; exit 7) & fast_pid=$!',
    '(sleep 0.2; exit 0) & slow_pid=$!',
    // Let the fast child exit before wait -n starts. Bash can then collect the
    // still-running sibling first and leave the fast PID stale in the set.
    'sleep 0.05',
    'LEG_PIDS=("$fast_pid" "$slow_pid")',
    supervisorHarness,
    'supervise_legs',
  ].join('\n');
  return spawnSync('bash', ['-c', command], { encoding: 'utf8', timeout: 2000 });
}

test('supervisor reaps a fast failed child left behind by wait -n', () => {
  const result = runSupervisorWithFastFailedSibling();
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.error, undefined, 'stale child must not leave the supervisor sleeping until timeout');
  assert.match(result.stdout, /fast leg FAILED \(rc=7\)/);
  assert.doesNotMatch(result.stdout, /SALVAGE GRACE .*EXPIRED/);
});

// Stub the expensive builders, not the Linux producer or provenance emitter.
// Stop at the producing child: a sibling failure prevents the later collector
// from running. Explicit PID waits keep this receipt regression independent of
// the supervisor's fast-child wait -n issue (EI-22609421740403514).
function runFreshWithFailedSibling({ emitterFails = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-linux-salvage-'));
  const bin = path.join(temp, 'bin');
  const bundle = path.join(temp, 'target', 'release', 'bundle');
  const tag = path.basename(temp);
  const linuxLog = `/tmp/papercusp-linuxleg-${tag}.log`;
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'repack-deb-xz.sh'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'printf ":repacked" >> "$1"',
    'printf "final-deb-signature" > "$1.sig"',
  ].join('\n'));
  fs.writeFileSync(path.join(bin, 'build-appimage.sh'), [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `mkdir -p ${JSON.stringify(path.join(bundle, 'appimage'))}`,
    `printf "final-appimage" > ${JSON.stringify(path.join(bundle, 'appimage', 'Papercusp_GUI_0.0.18_amd64.AppImage'))}`,
    `printf "final-appimage-signature" > ${JSON.stringify(path.join(bundle, 'appimage', 'Papercusp_GUI_0.0.18_amd64.AppImage.sig'))}`,
  ].join('\n'));
  const emitter = path.join(bin, 'emit-build-provenance.sh');
  if (emitterFails) fs.writeFileSync(emitter, 'exit 23\n');
  else fs.symlinkSync(path.join(root, 'bin', 'emit-build-provenance.sh'), emitter);

  try {
    const command = [
      'set -euo pipefail',
      `ROOT=${JSON.stringify(temp)}`,
      `ORCHESTRATOR_HERE=${JSON.stringify(bin)}`,
      `CARGO_TARGET_ROOT=${JSON.stringify(path.join(temp, 'target'))}`,
      `TAG=${JSON.stringify(tag)}`,
      'VERSION=0.0.18',
      'BUILD_SHA=original-baked-sha',
      `PROVENANCE_SOURCE_GIT_HEAD=${'a'.repeat(40)}`,
      'PROVENANCE_SOURCE_GIT_DIRTY=false',
      "PAPERCUSP_BUILD_ROLES='gui server'",
      'PAPERCUSP_REUSE_LINUX=0',
      'PAPERCUSP_LINUX_RUSTFLAGS=',
      'TAURI_CLI_VERSION=2.0.0',
      'KEY_FILE=unused-test-key',
      'DESKTOP_CHANNEL_BUILD_ENV=(); DESKTOP_CHANNEL_BUILD_CFG=(); PC_NICE=()',
      'CHANNEL=alpha',
      'npx() {',
      '  local role=GUI',
      '  [[ "$*" != *tauri.server.conf.json* ]] || role=Server',
      '  mkdir -p "$CARGO_TARGET_ROOT/release/bundle/deb"',
      '  printf "raw:%s" "$role" > "$CARGO_TARGET_ROOT/release/bundle/deb/Papercusp_${role}_0.0.18_amd64.deb"',
      '}',
      linuxReuseHarness,
      '(exit 7) & WIN_PID=$!',
      'if wait "$WIN_PID"; then win_rc=0; else win_rc=$?; fi',
      'if wait "$LINUX_PID"; then linux_rc=0; else linux_rc=$?; fi',
      'printf "WIN_RC=%s LINUX_RC=%s\\n" "$win_rc" "$linux_rc"',
      '[[ "$win_rc" == 0 && "$linux_rc" == 0 ]]',
    ].join('\n');
    const result = spawnSync('bash', ['-c', command], { encoding: 'utf8', timeout:30000 });
    const receiptPath = path.join(bundle, 'build-provenance.json');
    const receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null;
    const finalHashes = Object.fromEntries(
      (receipt?.artifacts || []).map((artifact) => [
        artifact.name,
        crypto.createHash('sha256').update(fs.readFileSync(path.join(bundle, artifact.name))).digest('hex'),
      ]),
    );
    return { result, receipt, finalHashes };
  } finally {
    fs.rmSync(temp, { recursive:true, force:true });
    fs.rmSync(linuxLog, { force:true });
  }
}

test('completed Linux salvage retains final-byte provenance when a sibling fails', () => {
  const { result, receipt, finalHashes } = runFreshWithFailedSibling();
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /WIN_RC=7 LINUX_RC=0/);
  assert.ok(receipt, 'successful Linux sibling lost its required reuse provenance');
  assert.equal(receipt.version, '0.0.18');
  assert.equal(receipt.buildSha, 'original-baked-sha');
  assert.equal(receipt.gitHead, 'a'.repeat(40));
  assert.equal(receipt.gitDirty, false);
  assert.equal(receipt.reused, false);
  assert.equal(receipt.artifacts.length, 3);
  for (const artifact of receipt.artifacts) {
    assert.equal(artifact.sha256, finalHashes[artifact.name], 'receipt must hash final repacked bytes');
    assert.equal(artifact.sig, true, 'receipt must follow final updater signing');
  }
});

test('a Linux provenance failure cannot be reported as successful salvage', () => {
  const { result, receipt } = runFreshWithFailedSibling({ emitterFails:true });
  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /WIN_RC=7 LINUX_RC=23/);
  assert.equal(receipt, null);
});

function runCutStart({ linux = 0, windows = 0, mac = 0 } = {}) {
  const command = [
    'set -euo pipefail',
    'TAG=desktop-v0.0.18-alpha',
    `PAPERCUSP_REUSE_LINUX=${linux}`,
    `PAPERCUSP_REUSE_WIN=${windows}`,
    `PAPERCUSP_REUSE_MAC=${mac}`,
    "release_artifacts_cut_start_write() { printf 'WRITE\\n' >&2; printf '222\\n'; }",
    "release_artifacts_cut_start_ensure() { printf 'ENSURE\\n' >&2; printf '111\\n'; }",
    cutStartHarness,
    "printf 'CUT_START=%s\\n' \"$PAPERCUSP_RELEASE_CUT_START_NS\"",
  ].join('\n');
  return spawnSync('bash', ['-c', command], { encoding: 'utf8' });
}

function runReuse({
  priorVersion = '0.0.18',
  priorBuildSha = 'built-source-sha',
  priorGitHead = 'a'.repeat(40),
  priorGitDirty = false,
  includeArtifact = true,
  includeProvenance = true,
  extraArtifact = false,
} = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-linux-reuse-'));
  const bundle = path.join(temp, 'target', 'release', 'bundle');
  const appimageDir = path.join(bundle, 'appimage');
  const debDir = path.join(bundle, 'deb');
  fs.mkdirSync(appimageDir, { recursive: true });
  fs.mkdirSync(debDir, { recursive: true });
  if (includeArtifact) {
    const artifact = path.join(appimageDir, 'Papercusp_GUI_0.0.18_amd64.AppImage');
    fs.writeFileSync(artifact, 'finished-linux-bytes');
    fs.writeFileSync(`${artifact}.sig`, 'finished-linux-signature');
    for (const role of ['GUI', 'Server']) {
      const deb = path.join(debDir, `Papercusp_${role}_0.0.18_amd64.deb`);
      fs.writeFileSync(deb, `finished-linux-${role}-deb`);
      fs.writeFileSync(`${deb}.sig`, `finished-linux-${role}-deb-signature`);
    }
  }
  if (extraArtifact) {
    const stale = path.join(appimageDir, 'Papercusp GUI_0.0.18_amd64.AppImage');
    fs.writeFileSync(stale, 'failed-pre-repair-bytes');
    fs.writeFileSync(`${stale}.sig`, 'failed-pre-repair-signature');
  }
  if (includeProvenance) {
    const provenance = { version: priorVersion, gitHead: priorGitHead, gitDirty: priorGitDirty };
    if (priorBuildSha !== null) provenance.buildSha = priorBuildSha;
    fs.writeFileSync(path.join(bundle, 'build-provenance.json'), JSON.stringify(provenance));
  }

  const command = [
    'set -euo pipefail',
    `ROOT=${JSON.stringify(temp)}`,
    `CARGO_TARGET_ROOT=${JSON.stringify(path.join(temp, 'target'))}`,
    'VERSION=0.0.18',
    'BUILD_SHA=exact-source-sha',
    'TAG=desktop-v0.0.18-alpha',
    "PAPERCUSP_BUILD_ROLES='gui server'",
    'PAPERCUSP_REUSE_LINUX=1',
    linuxReuseHarness,
    "printf 'HARNESS LINUX_REUSE=%s LINUX_PID=%s PRIOR_SHA=%s PRIOR_HEAD=%s PRIOR_DIRTY=%s\\n' \"$LINUX_REUSE\" \"$LINUX_PID\" \"$LINUX_REUSE_BUILD_SHA\" \"$LINUX_REUSE_GIT_HEAD\" \"$LINUX_REUSE_GIT_DIRTY\"",
  ].join('\n');
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  fs.rmSync(temp, { recursive: true, force: true });
  return result;
}

test('same-version Linux salvage skips the build and enters the canonical collector', () => {
  const result = runReuse();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PAPERCUSP_REUSE_LINUX=1 — skipping linux build/);
  assert.match(result.stdout, /REUSE_linux provenance verified: salvaged version 0\.0\.18 == cut 0\.0\.18/);
  assert.match(result.stdout, /HARNESS LINUX_REUSE=1 LINUX_PID= PRIOR_SHA=built-source-sha PRIOR_HEAD=a{40} PRIOR_DIRTY=false$/m);
  assert.doesNotMatch(result.stdout, /launching Linux x86_64 build/);
});

test('Linux salvage refuses provenance that cannot identify the bytes it reuses', () => {
  const result = runReuse({ priorBuildSha: null });
  assert.notEqual(result.status, 0, 'reuse without prior build identity unexpectedly passed');
  assert.match(result.stdout + result.stderr, /lacks buildSha\/gitHead\/gitDirty/);
});

test('Linux salvage refuses to relabel a different version', () => {
  const result = runReuse({ priorVersion: '0.0.17' });
  assert.notEqual(result.status, 0, 'mismatched provenance unexpectedly passed');
  assert.match(result.stdout + result.stderr, /salvaged artifacts are version '0\.0\.17' but this cut is '0\.0\.18'/);
});

test('Linux salvage refuses an empty bundle before claiming reuse', () => {
  const result = runReuse({ includeArtifact: false });
  assert.notEqual(result.status, 0, 'empty Linux bundle unexpectedly passed');
  assert.match(result.stdout + result.stderr, /no 0\.0\.18 linux artifacts/);
});

test('Linux salvage refuses two same-version AppImages instead of picking by iteration order', () => {
  const result = runReuse({ extraArtifact: true });
  assert.notEqual(result.status, 0, 'ambiguous Linux AppImage set unexpectedly passed');
  assert.match(result.stdout + result.stderr, /bundle is ambiguous\/incomplete/);
  assert.match(result.stdout + result.stderr, /found appimages=2 signatures=2/);
});

test('Linux reuse stays on the shared provenance and collection surfaces', () => {
  const branch = sliceBetween('LINUX_LEG_LOG=', '# ── Mobile');
  const collection = sliceBetween('ARTIFACTS=()', 'if [[ "$WITH_ARM64" == "1" ]]');

  assert.match(branch, /PAPERCUSP_REUSE_LINUX/);
  assert.match(branch, /assert_reused_provenance "\$LINUX_BUNDLE" linux/);
  assert.match(branch, /assert_linux_artifact_cardinality "\$LINUX_BUNDLE"/);
  assert.match(branch, /LINUX_REUSE=1/);
  assert.match(collection, /linux_found=1/);
  assert.match(collection, /assert_linux_artifact_cardinality "\$LINUX_BUNDLE"/);
  assert.match(collection, /"\$LINUX_REUSE" == "1"/);
  assert.match(collection, /emit_linux_build_provenance/);
});

test('an all-fresh cut writes a new freshness boundary', () => {
  const result = runCutStart();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /^WRITE$/m);
  assert.doesNotMatch(result.stderr, /^ENSURE$/m);
  assert.match(result.stdout, /CUT_START=222/);
});

for (const [leg, reuse] of [
  ['linux', { linux: 1 }],
  ['windows', { windows: 1 }],
  ['mac', { mac: 1 }],
]) {
  test(`${leg} reuse preserves and validates the original freshness boundary`, () => {
    const result = runCutStart(reuse);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /^ENSURE$/m);
    assert.doesNotMatch(result.stderr, /^WRITE$/m);
    assert.match(result.stdout, /CUT_START=111/);
    assert.match(result.stdout, /preserving original cut-start/);
  });
}

function canonicalAuditStamp(passedAtUtc) {
  return {
    releaseIdentityAudit: {
      schemaVersion: 1,
      passed: true,
      scanner: 'audit-release-bundle.py --scan-dir',
      passedAtUtc,
    },
  };
}

function runAuditReuseExpiry({ stamp, maxAgeSec = 86_400 } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-release-audit-expiry-'));
  const sidecar = path.join(temp, 'src-tauri', 'sidecar');
  fs.mkdirSync(sidecar, { recursive: true });
  if (stamp !== undefined) {
    fs.writeFileSync(path.join(sidecar, '.sidecar-build-stamp'), JSON.stringify(stamp));
  }
  try {
    const command = [
      'set -euo pipefail',
      `ROOT=${JSON.stringify(temp)}`,
      `PAPERCUSP_RELEASE_REUSE_MAX_AGE_SEC=${JSON.stringify(String(maxAgeSec))}`,
      releaseTaskJournalHarness,
      'release_task_audit_reuse_expiry',
    ].join('\n');
    return spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('fresh identity-scan evidence derives the exact reuse expiry', () => {
  const passedAtUtc = new Date(Date.now() - 60_000).toISOString();
  const result = runAuditReuseExpiry({ stamp: canonicalAuditStamp(passedAtUtc) });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout, new Date(Date.parse(passedAtUtc) + 86_400_000).toISOString());
});

test('missing identity-scan stamp cannot authorize reuse', () => {
  const result = runAuditReuseExpiry();
  assert.notEqual(result.status, 0, 'missing scan evidence unexpectedly produced an expiry');
  assert.match(result.stderr, /ENOENT|no such file/i);
});

test('expired identity-scan evidence cannot authorize reuse', () => {
  const passedAtUtc = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const result = runAuditReuseExpiry({ stamp: canonicalAuditStamp(passedAtUtc) });
  assert.notEqual(result.status, 0, 'expired scan evidence unexpectedly produced an expiry');
  assert.match(result.stderr, /identity scan expired/);
});

test('future-dated identity-scan evidence cannot authorize reuse', () => {
  const passedAtUtc = new Date(Date.now() + 86_400_000).toISOString();
  const result = runAuditReuseExpiry({ stamp: canonicalAuditStamp(passedAtUtc) });
  assert.notEqual(result.status, 0, 'future scan evidence unexpectedly produced an expiry');
  assert.match(result.stderr, /invalid or future-dated/);
});

// The receipt state machine is leg-GENERIC — one registry row plus two predicates
// per leg — so this driver is too: it runs the REAL release-local functions over
// whichever leg's registry row, state-slot prefix and reuse variable are named.
// A leg added here must not change what the Linux assertions below observe; they
// are deliberately unchanged from when linux was the only journalled leg.
const JOURNAL_LEG_FIXTURES = {
  linux: { prefix: 'RELEASE_TASK_BUILD', reuseVar: 'PAPERCUSP_REUSE_LINUX', identity: 'linux-input' },
  windows: { prefix: 'RELEASE_TASK_WIN', reuseVar: 'PAPERCUSP_REUSE_WIN', identity: 'windows-input' },
  mac: { prefix: 'RELEASE_TASK_MAC', reuseVar: 'PAPERCUSP_REUSE_MAC', identity: 'mac-input' },
};

// A journalled leg's provenance ALWAYS names its artifacts — build-provenance.json
// is the completeness oracle every leg's receipt reads, and P-003 clause 1 (D-008)
// now digests (name, bytes, sha256) out of it. A fixture writing a bare `{}`
// describes a bundle no real cut can produce, so it is not a lighter fixture — it
// is a different, impossible one.
const JOURNAL_FIXTURE_PROVENANCE = {
  version: '0.0.18',
  artifacts: [
    { name: 'deb/App_0.0.18_amd64.deb', bytes: 1024, sha256: 'a'.repeat(64) },
    { name: 'appimage/App_0.0.18_amd64.AppImage', bytes: 2048, sha256: 'b'.repeat(64) },
  ],
};

// Mirrors release_task_leg_output_digest. Deliberately ignores every field the
// shell ignores (builtAtUtc, mtime, sig) — that exclusion is the property under
// test: a provenance re-emit must not change the digest.
function fixtureArtifactSetDigest(provenance = JOURNAL_FIXTURE_PROVENANCE) {
  const rows = provenance.artifacts
    .map((a) => [String(a.name), String(a.sha256), String(a.bytes)])
    .sort((l, r) => (l.join('\0') < r.join('\0') ? -1 : l.join('\0') > r.join('\0') ? 1 : 0));
  const outer = require('node:crypto').createHash('sha256');
  for (const [name, digest, size] of rows) outer.update(`${name}\0${digest}\0${size}\0`);
  return outer.digest('hex');
}

function runJournalLegResume({ leg, action, absent = false, verify = 0, provenance, artifactSet, entry }) {
  const fixture = JOURNAL_LEG_FIXTURES[leg];
  assert(fixture, `no journal fixture for leg ${leg}`);
  const { prefix, reuseVar, identity } = fixture;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `papercusp-${leg}-journal-`));
  const bundle = path.join(temp, 'bundle');
  const calls = path.join(temp, 'calls.log');
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(
    path.join(bundle, 'build-provenance.json'),
    JSON.stringify(provenance ?? JOURNAL_FIXTURE_PROVENANCE),
  );
  const command = [
    'set -euo pipefail',
    'ORCHESTRATOR_HERE=/unused',
    'MONOREPO=/unused',
    'EXPECTED_SOURCE_SHA=' + 'a'.repeat(40),
    'VERSION=0.0.18',
    'CHANNEL=nightly',
    'TAG=desktop-v0.0.18-nightly',
    "PAPERCUSP_BUILD_ROLES='gui'",
    `${reuseVar}=0`,
    'PROVENANCE_SOURCE_GIT_HEAD=' + 'b'.repeat(40),
    'RELEASE_TASK_JOURNAL_ENABLED=0',
    releaseTaskJournalHarness,
    'RELEASE_TASK_JOURNAL_ENABLED=1',
    "release_task_audit_reuse_expiry() { printf '2099-01-01T00:00:00.000Z\\n'; }",
    `${prefix}_ACTION=${action}`,
    `${prefix}_REQUEST_ID=old-request`,
    `${prefix}_IDENTITY=${identity}`,
    // P-003 clause 1 (D-008): the digest the prior receipt committed. Defaults to
    // the fixture's own artifacts, so a `reuse` action agrees unless a test
    // deliberately supplies a different one.
    `${prefix}_ARTIFACT_SET=${artifactSet ?? fixtureArtifactSetDigest(provenance ?? JOURNAL_FIXTURE_PROVENANCE)}`,
    `release_task_${leg}_outputs_absent() { return ${absent ? 0 : 1}; }`,
    `release_task_verify_${leg}_artifacts() { printf 'verify:%s:%s\\n' "$1" "$2" >> ${JSON.stringify(calls)}; return ${verify}; }`,
    `release_task_journal_call() { printf '%s\\n' "$*" >> ${JSON.stringify(calls)}; [[ "$1" != commit ]] || printf '%s\\n' '{"state":"committed"}'; }`,
    'release_task_begin_stage() { RELEASE_TASK_LAST_ACTION=run; RELEASE_TASK_LAST_REQUEST_ID=new-request; printf "begin:%s:%s\\n" "$1" "$2" >> ' + JSON.stringify(calls) + '; }',
    "release_artifacts_cut_start_write() { printf '222\\n'; }",
    entry === 'commit'
      ? `release_task_leg_commit ${leg} ${JSON.stringify(bundle)} 1`
      : `release_task_leg_prepare ${leg} ${JSON.stringify(bundle)}`,
    `printf "RESULT action=%s request=%s reuse=%s cut=%s\\n" "$${prefix}_ACTION" "$${prefix}_REQUEST_ID" "$${reuseVar}" "\${PAPERCUSP_RELEASE_CUT_START_NS:-}"`,
  ].join('\n');
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  const log = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '';
  fs.rmSync(temp, { recursive: true, force: true });
  return { result, log };
}

function runJournalLinuxResume(options) {
  return runJournalLegResume({ ...options, leg: 'linux' });
}

test('journal restart reconciles verified Linux bytes and activates canonical reuse', () => {
  const { result, log } = runJournalLinuxResume({ action: 'reconcile' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /RESULT action=reuse request=old-request reuse=1/);
  assert.match(log, /commit release\.build\.linux linux-input old-request/);
  assert.doesNotMatch(log, /refuse release\.build\.linux/);
  assert.match(result.stdout, /RELEASE_STAGE_TIMING schema=1 stage=release\.build\.linux decision=cache-hit/);
});

test('lost Linux outcome is refused before a fresh one-use attempt', () => {
  const { result, log } = runJournalLinuxResume({ action: 'reconcile', absent: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /RESULT action=run request=new-request reuse=0 cut=222/);
  assert.match(log, /refuse release\.build\.linux linux-input old-request artifact-set:confirmed-absent/);
  assert.match(log, /begin:release\.build\.linux:linux-input/);
});

test('committed Linux receipt with lost bytes fails closed instead of rebuilding', () => {
  const { result, log } = runJournalLinuxResume({ action: 'reuse', absent: true });
  assert.notEqual(result.status, 0, 'a spent committed receipt unexpectedly rebuilt');
  assert.match(result.stderr, /committed but its artifact\/provenance set is absent/);
  assert.doesNotMatch(log, /begin:release\.build\.linux/);
});

test('present but tampered Linux bytes are not rewritten as confirmed absence', () => {
  const { result, log } = runJournalLinuxResume({ action: 'reconcile', verify: 1 });
  assert.notEqual(result.status, 0, 'tampered artifacts unexpectedly entered a fresh attempt');
  assert.match(result.stderr, /not treating corruption as absence/);
  assert.doesNotMatch(log, /refuse release\.build\.linux/);
  assert.doesNotMatch(log, /begin:release\.build\.linux/);
});

// The same four transitions over the WINDOWS registry row. Without these, an
// interrupted cut resumes the Linux leg from its receipt and silently rebuilds
// Windows from scratch — the coverage gap, not the mechanism, is what P-002 closes.
test('journal restart reconciles verified Windows bytes and activates canonical reuse', () => {
  const { result, log } = runJournalLegResume({ leg: 'windows', action: 'reconcile' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /RESULT action=reuse request=old-request reuse=1/);
  assert.match(log, /commit release\.build\.windows windows-input old-request/);
  assert.doesNotMatch(log, /refuse release\.build\.windows/);
  assert.match(result.stdout, /RELEASE_STAGE_TIMING schema=1 stage=release\.build\.windows decision=cache-hit/);
});

test('lost Windows outcome is refused before a fresh one-use attempt', () => {
  const { result, log } = runJournalLegResume({ leg: 'windows', action: 'reconcile', absent: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /RESULT action=run request=new-request reuse=0 cut=222/);
  assert.match(log, /refuse release\.build\.windows windows-input old-request artifact-set:confirmed-absent/);
  assert.match(log, /begin:release\.build\.windows:windows-input/);
});

test('committed Windows receipt with lost installers fails closed instead of rebuilding', () => {
  const { result, log } = runJournalLegResume({ leg: 'windows', action: 'reuse', absent: true });
  assert.notEqual(result.status, 0, 'a spent committed receipt unexpectedly rebuilt');
  assert.match(result.stderr, /committed but its artifact\/provenance set is absent/);
  assert.doesNotMatch(log, /begin:release\.build\.windows/);
});

test('present but tampered Windows installers are not rewritten as confirmed absence', () => {
  const { result, log } = runJournalLegResume({ leg: 'windows', action: 'reconcile', verify: 1 });
  assert.notEqual(result.status, 0, 'tampered installers unexpectedly entered a fresh attempt');
  assert.match(result.stderr, /not treating corruption as absence/);
  assert.doesNotMatch(log, /refuse release\.build\.windows/);
  assert.doesNotMatch(log, /begin:release\.build\.windows/);
});

// And the same four over the MAC registry row. The mac leg is the most expensive
// one to lose to a restart (full cross-compile + lipo + sign + dmg per role), and
// until it was journalled an interrupted cut rebuilt it from scratch however
// complete the bytes on disk were.
test('journal restart reconciles verified mac bytes and activates canonical reuse', () => {
  const { result, log } = runJournalLegResume({ leg: 'mac', action: 'reconcile' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /RESULT action=reuse request=old-request reuse=1/);
  assert.match(log, /commit release\.build\.mac mac-input old-request/);
  assert.doesNotMatch(log, /refuse release\.build\.mac/);
  assert.match(result.stdout, /RELEASE_STAGE_TIMING schema=1 stage=release\.build\.mac decision=cache-hit/);
});

test('lost mac outcome is refused before a fresh one-use attempt', () => {
  const { result, log } = runJournalLegResume({ leg: 'mac', action: 'reconcile', absent: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /RESULT action=run request=new-request reuse=0 cut=222/);
  assert.match(log, /refuse release\.build\.mac mac-input old-request artifact-set:confirmed-absent/);
  assert.match(log, /begin:release\.build\.mac:mac-input/);
});

test('committed mac receipt with lost artifacts fails closed instead of rebuilding', () => {
  const { result, log } = runJournalLegResume({ leg: 'mac', action: 'reuse', absent: true });
  assert.notEqual(result.status, 0, 'a spent committed receipt unexpectedly rebuilt');
  assert.match(result.stderr, /committed but its artifact\/provenance set is absent/);
  assert.doesNotMatch(log, /begin:release\.build\.mac/);
});

test('present but tampered mac artifacts are not rewritten as confirmed absence', () => {
  const { result, log } = runJournalLegResume({ leg: 'mac', action: 'reconcile', verify: 1 });
  assert.notEqual(result.status, 0, 'tampered mac artifacts unexpectedly entered a fresh attempt');
  assert.match(result.stderr, /not treating corruption as absence/);
  assert.doesNotMatch(log, /refuse release\.build\.mac/);
  assert.doesNotMatch(log, /begin:release\.build\.mac/);
});

// Every leg in the shell registry must be journalled, or the "resume" this plan
// item delivers silently covers a subset. Derived from the registry itself rather
// than from a hand-kept list, so adding a leg without wiring its lifecycle fails
// here instead of at 2am on a real cut.
// ── P-003 clause 1 (D-008): a reuse must CHECK the bytes against its receipt ──
// The pre-existing reuse checks (cardinality, provenance, signature) all re-derive
// trust from the current tree, so they pass on any internally-consistent artifact
// set. These cover the one question that distinguishes "these bytes" from "some
// valid bytes". Every leg is exercised: the hole P-002 left in
// requiredReuseEvidenceRefs was exactly a per-leg one that linux-only tests hid.
for (const leg of ['linux', 'windows', 'mac']) {
  test(`${leg} reuse accepts bytes whose artifact set matches its receipt`, () => {
    const { result } = runJournalLegResume({ leg, action: 'reuse', entry: 'commit' });
    assert.equal(result.status, 0, `matching ${leg} artifact set was refused: ${result.stderr}`);
  });

  test(`${leg} reuse refuses bytes whose artifact set differs from its receipt`, () => {
    const { result } = runJournalLegResume({
      leg,
      action: 'reuse',
      entry: 'commit',
      artifactSet: 'c'.repeat(64),
    });
    assert.notEqual(result.status, 0, `a ${leg} artifact set the receipt never committed was reused`);
    assert.match(result.stderr, /NOT the ones its receipt committed/);
  });

  test(`${leg} reuse refuses a legacy receipt that carries no artifact-set digest`, () => {
    const { result } = runJournalLegResume({ leg, action: 'reuse', entry: 'commit', artifactSet: '' });
    assert.notEqual(result.status, 0, `a ${leg} receipt with no digest still authorized reuse`);
    assert.match(result.stderr, /no artifact-set digest/);
  });
}

test('the artifact-set digest survives a provenance re-emit of identical bytes', () => {
  // A reuse RE-EMITS provenance, so any digest that moved with the envelope could
  // never verify anything — it would refuse every genuine resume. Same artifacts,
  // a later capture: the digest must be unchanged.
  const reEmitted = {
    ...JOURNAL_FIXTURE_PROVENANCE,
    builtAtUtc: '2099-12-31T23:59:59Z',
    artifacts: JOURNAL_FIXTURE_PROVENANCE.artifacts.map((a) => ({
      ...a,
      sig: true,
      mtimeEpochSec: 4102444799,
      mtimeUtc: '2099-12-31T23:59:59Z',
      completedAtUtc: '2099-12-31T23:59:59Z',
    })),
  };
  const { result } = runJournalLegResume({
    leg: 'linux',
    action: 'reuse',
    entry: 'commit',
    provenance: reEmitted,
    artifactSet: fixtureArtifactSetDigest(JOURNAL_FIXTURE_PROVENANCE),
  });
  assert.equal(result.status, 0, `a provenance re-emit changed the artifact-set digest: ${result.stderr}`);
});

test('a bundle whose provenance names no artifacts cannot mint a receipt', () => {
  // The digest is the receipt's only later-verifiable claim about its outputs, so
  // a provenance that cannot supply one must fail closed rather than commit a
  // receipt nothing can check.
  const { result } = runJournalLegResume({
    leg: 'linux',
    action: 'reconcile',
    provenance: { version: '0.0.18', artifacts: [] },
  });
  assert.notEqual(result.status, 0, 'a receipt was committed for artifacts that cannot be digested');
  assert.match(result.stderr, /names no artifacts/);
});

test('every registered release leg has a full journal lifecycle wired into the cutter', () => {
  const registry = sliceBetween('declare -A RELEASE_TASK_LEG_PLATFORM=(', ')');
  const registered = [...registry.matchAll(/^\s*\[([a-z0-9-]+)\]=\S+$/gm)].map((match) => match[1]);
  assert.deepEqual(
    registered.slice().sort(),
    ['linux', 'mac', 'windows'],
    'the leg registry changed — wire the new leg’s lifecycle before updating this list',
  );
  for (const leg of registered) {
    for (const phase of ['start', 'prepare', 'commit']) {
      assert.match(
        source,
        new RegExp(`release_task_leg_${phase} ${leg}\\b`),
        `leg '${leg}' is registered but never calls release_task_leg_${phase}`,
      );
    }
    for (const helper of [`release_task_${leg}_outputs_absent`, `release_task_verify_${leg}_artifacts`]) {
      assert.match(source, new RegExp(`^${helper}\\(\\) \\{`, 'm'), `leg '${leg}' has no ${helper}`);
    }
  }
});

function runJournalManifestResume({ action, absent = false, verify = 0 }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-manifest-journal-'));
  const artifact = path.join(temp, 'Papercusp_GUI_0.0.18_amd64.AppImage');
  const calls = path.join(temp, 'calls.log');
  fs.writeFileSync(artifact, 'immutable-appimage');
  const command = [
    'set -euo pipefail',
    'ORCHESTRATOR_HERE=/unused',
    'MONOREPO=/unused',
    'EXPECTED_SOURCE_SHA=' + 'a'.repeat(40),
    'VERSION=0.0.18',
    'CHANNEL=nightly',
    'TAG=desktop-v0.0.18-nightly',
    "PAPERCUSP_BUILD_ROLES='gui'",
    'RELEASE_TASK_JOURNAL_ENABLED=0',
    releaseTaskJournalHarness,
    'RELEASE_TASK_JOURNAL_ENABLED=1',
    "release_task_audit_reuse_expiry() { printf '2099-01-01T00:00:00.000Z\\n'; }",
    `INITIAL_ACTION=${action}`,
    'begin_count=0',
    'release_task_begin_stage() { begin_count=$((begin_count + 1)); if (( begin_count == 1 )); then RELEASE_TASK_LAST_ACTION="$INITIAL_ACTION"; RELEASE_TASK_LAST_REQUEST_ID=old-request; else RELEASE_TASK_LAST_ACTION=run; RELEASE_TASK_LAST_REQUEST_ID=new-request; fi; printf "begin:%s:%s:%s\\n" "$1" "$2" "$RELEASE_TASK_LAST_ACTION" >> ' + JSON.stringify(calls) + '; }',
    `release_task_manifest_outputs_absent() { return ${absent ? 0 : 1}; }`,
    `release_task_verify_manifest_outputs() { printf 'verify\\n' >> ${JSON.stringify(calls)}; return ${verify}; }`,
    `release_task_commit_manifest_stage() { printf 'commit\\n' >> ${JSON.stringify(calls)}; RELEASE_TASK_MANIFEST_ACTION=reuse; }`,
    `release_task_journal_call() { printf '%s\\n' "$*" >> ${JSON.stringify(calls)}; }`,
    `release_task_prepare_manifest_stage ${JSON.stringify(artifact)}`,
    'printf "RESULT action=%s request=%s skip=%s\\n" "$RELEASE_TASK_MANIFEST_ACTION" "$RELEASE_TASK_MANIFEST_REQUEST_ID" "$RELEASE_TASK_MANIFEST_SKIP"',
  ].join('\n');
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  const log = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '';
  fs.rmSync(temp, { recursive: true, force: true });
  return { result, log };
}

test('lost manifest response reconciles verified outputs without regenerating', () => {
  const { result, log } = runJournalManifestResume({ action: 'reconcile' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /RESULT action=reuse request=old-request skip=1/);
  assert.match(log, /verify\ncommit/);
});

test('absent manifest outputs refuse the spent request before regeneration', () => {
  const { result, log } = runJournalManifestResume({ action: 'reconcile', absent: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /RESULT action=run request=new-request skip=0/);
  assert.match(log, /refuse release\.manifest .* old-request manifest-outputs:confirmed-absent/);
  assert.match(log, /begin:release\.manifest:.*:run/);
});

test('committed manifest receipt never bypasses missing or tampered outputs', () => {
  const missing = runJournalManifestResume({ action: 'reuse', absent: true });
  assert.notEqual(missing.result.status, 0);
  assert.match(missing.result.stderr, /committed but its manifest\/artifact-ledger outputs are absent/);

  const tampered = runJournalManifestResume({ action: 'reuse', verify: 1 });
  assert.notEqual(tampered.result.status, 0);
  assert.match(tampered.result.stderr, /not treating corruption as absence/);
  assert.doesNotMatch(tampered.log, /refuse release\.manifest/);
});

test('journal byte gate composes exact health, hash, and signature verification', () => {
  assert.match(releaseTaskJournalHarness, /verify-provenance\.sh" "\$bundle"/);
  assert.match(releaseTaskJournalHarness, /--health-sha "\$BUILD_SHA"/);
  assert.match(releaseTaskJournalHarness, /--require-signed/);
  assert.match(releaseTaskJournalHarness, /assert_linux_artifact_cardinality "\$bundle"/);
  assert.match(releaseTaskJournalHarness, /does not match source gitlink/);
});

test('journal manifest verifier reuses the canonical generator and exact artifact ledger', () => {
  assert.match(releaseTaskJournalHarness, /gen_latest_manifest "\$VERSION" "\$CHANNEL" "\$TAG"/);
  assert.match(releaseTaskJournalHarness, /release artifact ledger does not name the exact current artifact set/);
  assert.match(releaseTaskJournalHarness, /normalized_manifest\(actual\) != normalized_manifest\(expected\)/);
  assert.match(releaseTaskJournalHarness, /release_artifacts_assert_signatures_present/);
  assert.match(releaseTaskJournalHarness, /--source-scope stage/);
});

function runLinuxContentIdentity(mutator = () => {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-release-content-identity-'));
  const workspace = path.join(temp, 'workspace');
  const desktop = path.join(temp, 'desktop');
  const files = {
    dependencyMarker: path.join(workspace, 'node_modules', '.papercusp-dependency-generation'),
    installedLock: path.join(workspace, 'node_modules', '.package-lock.json'),
    packageLock: path.join(workspace, 'package-lock.json'),
    cupboardBundle: path.join(workspace, 'content-bundles', 'workspace-host', 'bundle.yaml'),
    distributionContract: path.join(desktop, 'src-tauri', 'distribution-contract.json'),
    tauriBase: path.join(desktop, 'src-tauri', 'tauri.conf.json'),
    tauriChannel: path.join(desktop, 'src-tauri', 'tauri.nightly.conf.json'),
    cargoLock: path.join(desktop, 'src-tauri', 'Cargo.lock'),
    modelBoundary: path.join(desktop, 'bin', 'lib', 'transformers-models.sh'),
    identityScanner: path.join(desktop, 'bin', 'audit-release-bundle.py'),
    provenanceVerifier: path.join(desktop, 'bin', 'verify-provenance.sh'),
    freshnessVerifier: path.join(desktop, 'bin', 'check-sidecar-freshness.js'),
    // P-003 clause 4 (D-008): the compression producers are policy inputs because
    // their presets (`zstd --long=27`, `xz -9`) are hardcoded in their own text.
    sourcePackager: path.join(desktop, 'bin', 'stage-source-tree.sh'),
    debCompressor: path.join(desktop, 'bin', 'repack-deb-xz.sh'),
  };
  for (const file of Object.values(files)) fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(files.dependencyMarker, `identity=v1-${'a'.repeat(64)}\nsource=${'a'.repeat(64)}\n`);
  fs.writeFileSync(files.installedLock, '{"lockfileVersion":3}\n');
  fs.writeFileSync(files.packageLock, '{"lockfileVersion":3,"name":"workspace"}\n');
  fs.writeFileSync(files.cupboardBundle, 'schema: 1\ncontent: local\n');
  fs.writeFileSync(files.distributionContract, '{"schemaVersion":1,"optionalPacks":["local-models"]}\n');
  fs.writeFileSync(files.tauriBase, '{"plugins":{"updater":{"pubkey":"signer-a"}}}\n');
  fs.writeFileSync(files.tauriChannel, '{"identifier":"nightly"}\n');
  fs.writeFileSync(files.cargoLock, 'version = 4\n');
  for (const file of [
    files.modelBoundary,
    files.identityScanner,
    files.provenanceVerifier,
    files.freshnessVerifier,
    files.sourcePackager,
    files.debCompressor,
  ]) {
    fs.writeFileSync(file, `${path.basename(file)}:v1\n`);
  }
  mutator({ files, workspace, desktop });
  const command = [
    'set -euo pipefail',
    `MONOREPO=${JSON.stringify(workspace)}`,
    `ROOT=${JSON.stringify(desktop)}`,
    // The identity builder is no longer an inline heredoc: it execs the real
    // bin/lib/release-content-identity.js, so this must be the REAL bin dir
    // (MONOREPO/ROOT stay fixtures). Pointing it at a fixture would test nothing.
    `ORCHESTRATOR_HERE=${JSON.stringify(path.join(root, 'bin'))}`,
    'PAPERCUSP_BUILD_ROLES=gui',
    'TAURI_CLI_VERSION=2.11.0',
    'PAPERCUSP_RELEASE_HOST=https://updates.invalid/release-key',
    'CHANNEL=nightly',
    'RUSTFLAGS=',
    'DESKTOP_CHANNEL_BUILD_CFG=(--config src-tauri/tauri.nightly.conf.json)',
    'PAPERCUSP_RELEASE_REUSE_MAX_AGE_SEC=86400',
    releaseTaskJournalHarness,
    'release_task_content_identity linux-x86_64',
  ].join('\n');
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8', timeout: 30_000 });
  fs.rmSync(temp, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('Linux reuse identity binds dependency, toolchain, profile, policy/content/model, signer and audit inputs', () => {
  const baseline = runLinuxContentIdentity();
  assert.match(baseline.dependencies.generation, /^v1-[0-9a-f]{64}$/);
  assert.deepEqual(baseline.profile.roles, ['gui']);
  assert.match(baseline.signing.updaterPublicKeySha256, /^[0-9a-f]{64}$/);
  assert.equal(baseline.audit.reuseMaxAgeSec, 86400);
  assert.deepEqual(baseline.audit.requiredArtifactVerification, [
    'cardinality', 'provenance', 'health-sha', 'updater-signature',
  ]);

  const mutations = [
    ({ files }) => fs.writeFileSync(files.dependencyMarker, `identity=v1-${'b'.repeat(64)}\nsource=${'b'.repeat(64)}\n`),
    ({ files }) => fs.appendFileSync(files.distributionContract, '{"policy":"changed"}\n'),
    ({ files }) => fs.appendFileSync(files.cupboardBundle, 'content: changed\n'),
    ({ files }) => fs.appendFileSync(files.modelBoundary, 'model-revision=v2\n'),
    ({ files }) => fs.writeFileSync(files.tauriBase, '{"plugins":{"updater":{"pubkey":"signer-b"}}}\n'),
    ({ files }) => fs.appendFileSync(files.identityScanner, 'scanner-v2\n'),
  ];
  for (const mutate of mutations) assert.notDeepEqual(runLinuxContentIdentity(mutate), baseline);
});

function journalLinuxOutputShape(files) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-linux-shape-'));
  for (const [relative, value] of Object.entries(files)) {
    const target = path.join(temp, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  }
  const command = [
    'set -euo pipefail',
    'ORCHESTRATOR_HERE=/unused',
    'MONOREPO=/unused',
    'VERSION=0.0.18',
    'CHANNEL=nightly',
    'TAG=desktop-v0.0.18-nightly',
    "PAPERCUSP_BUILD_ROLES='gui'",
    'RELEASE_TASK_JOURNAL_ENABLED=0',
    releaseTaskJournalHarness,
    `if release_task_linux_outputs_absent ${JSON.stringify(temp)}; then printf 'absent\\n'; else printf 'present\\n'; fi`,
  ].join('\n');
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  fs.rmSync(temp, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test('partial Linux output is retryable, while complete or surplus shape reaches verification', () => {
  const complete = {
    'build-provenance.json': '{}',
    'deb/Papercusp_GUI_0.0.18_amd64.deb': 'deb',
    'deb/Papercusp_GUI_0.0.18_amd64.deb.sig': 'deb-sig',
    'appimage/Papercusp_GUI_0.0.18_amd64.AppImage': 'appimage',
    'appimage/Papercusp_GUI_0.0.18_amd64.AppImage.sig': 'appimage-sig',
  };
  const partial = { ...complete };
  delete partial['deb/Papercusp_GUI_0.0.18_amd64.deb.sig'];
  assert.equal(journalLinuxOutputShape(partial), 'absent');
  assert.equal(journalLinuxOutputShape(complete), 'present');
  assert.equal(
    journalLinuxOutputShape({ ...complete, 'appimage/Papercusp GUI_0.0.18_amd64.AppImage': 'surplus' }),
    'present',
    'surplus output must reach the strict verifier rather than be rewritten as absent',
  );
  const surplusWithoutProvenance = { ...complete, 'appimage/Papercusp GUI_0.0.18_amd64.AppImage': 'surplus' };
  delete surplusWithoutProvenance['build-provenance.json'];
  assert.equal(
    journalLinuxOutputShape(surplusWithoutProvenance),
    'present',
    'missing provenance cannot make a surplus same-version set retryable',
  );
});

function journalWindowsOutputShape(files, roles) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-windows-shape-'));
  for (const [relative, value] of Object.entries(files)) {
    const target = path.join(temp, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  }
  const command = [
    'set -euo pipefail',
    'ORCHESTRATOR_HERE=/unused',
    'MONOREPO=/unused',
    'VERSION=0.0.18',
    'CHANNEL=nightly',
    'TAG=desktop-v0.0.18-nightly',
    `PAPERCUSP_BUILD_ROLES=${JSON.stringify(roles)}`,
    'RELEASE_TASK_JOURNAL_ENABLED=0',
    releaseTaskJournalHarness,
    `if release_task_windows_outputs_absent ${JSON.stringify(temp)}; then printf 'absent\\n'; else printf 'present\\n'; fi`,
  ].join('\n');
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  fs.rmSync(temp, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test('the Windows expected set is one signed installer per role, excluding DiskSpan slices and the normalized zip', () => {
  const guiOnly = {
    'build-provenance.json': '{}',
    'Papercusp GUI_0.0.18_x64-setup.exe': 'setup',
    'Papercusp GUI_0.0.18_x64-setup.exe.sig': 'setup-sig',
  };
  assert.equal(journalWindowsOutputShape(guiOnly, 'gui'), 'present');
  // The SAME bytes are one role short once the cut asks for both roles: the
  // expected count is derived from PAPERCUSP_BUILD_ROLES, never from what landed.
  assert.equal(journalWindowsOutputShape(guiOnly, 'gui server'), 'absent');

  const both = {
    ...guiOnly,
    'Papercusp Server_0.0.18_x64-setup.exe': 'setup',
    'Papercusp Server_0.0.18_x64-setup.exe.sig': 'setup-sig',
  };
  assert.equal(journalWindowsOutputShape(both, 'gui server'), 'present');

  // An installer whose updater signature never landed is incomplete. Shipping it
  // is what build-windows-cross.sh's own ".sig" gate refuses, so a receipt must
  // not be able to pass over it.
  const unsigned = { ...both };
  delete unsigned['Papercusp Server_0.0.18_x64-setup.exe.sig'];
  assert.equal(journalWindowsOutputShape(unsigned, 'gui server'), 'absent');

  // The spanned-Server shape. papercusp_normalize_spanned_server writes the zip
  // and leaves the stub + ".bin" slices on disk, so a normalized cut must still
  // read as exactly complete rather than as surplus contamination.
  const normalized = {
    ...both,
    'Papercusp Server_0.0.18_x64-setup-1.bin': 'slice',
    'Papercusp Server_0.0.18_x64-setup-2.bin': 'slice',
    'Papercusp Server_0.0.18_x64-setup.zip': 'zip',
    'Papercusp Server_0.0.18_x64-setup.zip.sig': 'zip-sig',
  };
  assert.equal(journalWindowsOutputShape(normalized, 'gui server'), 'present');

  // Surplus is contamination from another lane, never "no completed result": it
  // must reach the strict verifier, with or without provenance.
  const surplus = { ...both, 'Papercusp GUI (stale)_0.0.18_x64-setup.exe': 'surplus' };
  assert.equal(journalWindowsOutputShape(surplus, 'gui server'), 'present');
  const surplusWithoutProvenance = { ...surplus };
  delete surplusWithoutProvenance['build-provenance.json'];
  assert.equal(
    journalWindowsOutputShape(surplusWithoutProvenance, 'gui server'),
    'present',
    'missing provenance cannot make a surplus same-version set retryable',
  );
});

function journalMacOutputShape(files, roles) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-mac-shape-'));
  for (const [relative, value] of Object.entries(files)) {
    const target = path.join(temp, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  }
  const command = [
    'set -euo pipefail',
    'ORCHESTRATOR_HERE=/unused',
    'MONOREPO=/unused',
    'VERSION=0.0.18',
    'CHANNEL=nightly',
    'TAG=desktop-v0.0.18-nightly',
    `PAPERCUSP_BUILD_ROLES=${JSON.stringify(roles)}`,
    'RELEASE_TASK_JOURNAL_ENABLED=0',
    releaseTaskJournalHarness,
    `if release_task_mac_outputs_absent ${JSON.stringify(temp)}; then printf 'absent\\n'; else printf 'present\\n'; fi`,
  ].join('\n');
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  fs.rmSync(temp, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

const MAC_GUI = {
  'dmg/Papercusp GUI_0.0.18_universal-apple-darwin.dmg': 'dmg',
  'dmg/Papercusp GUI_0.0.18_universal-apple-darwin.dmg.sig': 'dmg-sig',
  'macos/Papercusp GUI.app.tar.gz': 'updater',
  'macos/Papercusp GUI.app.tar.gz.sig': 'updater-sig',
};
const MAC_SERVER = {
  'dmg/Papercusp Server_0.0.18_universal-apple-darwin.dmg': 'dmg',
  'dmg/Papercusp Server_0.0.18_universal-apple-darwin.dmg.sig': 'dmg-sig',
  'macos/Papercusp Server.app.tar.gz': 'updater',
  'macos/Papercusp Server.app.tar.gz.sig': 'updater-sig',
};

test('the mac expected set is one signed dmg plus one signed updater bundle per role', () => {
  const guiOnly = { 'build-provenance.json': '{}', ...MAC_GUI };
  assert.equal(journalMacOutputShape(guiOnly, 'gui'), 'present');
  // As on Windows, the expected count comes from PAPERCUSP_BUILD_ROLES, never
  // from what happens to have landed.
  assert.equal(journalMacOutputShape(guiOnly, 'gui server'), 'absent');

  const both = { ...guiOnly, ...MAC_SERVER };
  assert.equal(journalMacOutputShape(both, 'gui server'), 'present');

  // build-mac-cross.sh hard-fails without either signature, so a set missing one
  // is an incomplete stage rather than something a receipt may pass over.
  const noDmgSig = { ...both };
  delete noDmgSig['dmg/Papercusp Server_0.0.18_universal-apple-darwin.dmg.sig'];
  assert.equal(journalMacOutputShape(noDmgSig, 'gui server'), 'absent');
  const noUpdaterSig = { ...both };
  delete noUpdaterSig['macos/Papercusp Server.app.tar.gz.sig'];
  assert.equal(journalMacOutputShape(noUpdaterSig, 'gui server'), 'absent');

  const surplus = { ...both, 'dmg/Papercusp GUI (stale)_0.0.18_universal-apple-darwin.dmg': 'surplus' };
  assert.equal(journalMacOutputShape(surplus, 'gui server'), 'present');
  const surplusWithoutProvenance = { ...surplus };
  delete surplusWithoutProvenance['build-provenance.json'];
  assert.equal(
    journalMacOutputShape(surplusWithoutProvenance, 'gui server'),
    'present',
    'missing provenance cannot make a surplus same-version set retryable',
  );
});

// The mac receipt's ORACLE, tested at the producer that writes it. Everything
// above trusts build-provenance.json to attribute an UNVERSIONED .app.tar.gz; this
// runs build-mac-cross.sh's real provenance block to prove the leg cannot finish
// without one. It was best-effort until P-002 (a trailing `|| echo WARN ... non-fatal`),
// which meant a COMPLETE mac build could end with no attestation at all -- and the
// predicate above would then read those good bytes as a retryable absence.
function runMacProvenanceBlock({ artifacts = ['one.dmg'], emitStatus = 0, emitter = true } = {}) {
  const macCrossPath = process.env.PAPERCUSP_BUILD_MAC_CROSS_PATH
    || path.join(root, 'bin', 'build-mac-cross.sh');
  const macCrossSource = fs.readFileSync(macCrossPath, 'utf8');
  const from = macCrossSource.indexOf('# ── Provenance (shared emitter');
  const to = macCrossSource.indexOf('echo "===== mac cross-build done', from);
  assert(from >= 0, 'build-mac-cross.sh is missing its provenance block marker');
  assert(to > from, 'build-mac-cross.sh is missing the marker after its provenance block');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-mac-provenance-'));
  const calls = path.join(temp, 'calls.log');
  if (emitter) {
    fs.writeFileSync(
      path.join(temp, 'emit-build-provenance.sh'),
      ['#!/usr/bin/env bash',
       'printf "emit:%s\\n" "$*" >> ' + JSON.stringify(calls),
       'exit ' + emitStatus,
       ''].join('\n'),
      { mode: 0o755 },
    );
  }
  const command = [
    'set -euo pipefail',
    'fail() { printf "fail:%s\\n" "$*" >> ' + JSON.stringify(calls) + '; exit 9; }',
    'HERE=' + JSON.stringify(temp),
    'ROOT=/unused',
    'OUT_BUNDLE=/unused/bundle',
    'VERSION=0.0.18',
    'MAC_CERT_P12=',
    'DARWIN_SIDECAR=/unused/sidecar',
    'PROV_ARTIFACTS=(' + artifacts.map((a) => JSON.stringify(a)).join(' ') + ')',
    macCrossSource.slice(from, to),
  ].join('\n');
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  const log = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '';
  fs.rmSync(temp, { recursive: true, force: true });
  return { result, log };
}

test('the mac leg cannot finish without the provenance its receipt reads as an oracle', () => {
  // Control FIRST: the happy path must actually reach the emitter, or the three
  // failure assertions below would pass on a block that never runs anything.
  const ok = runMacProvenanceBlock();
  assert.equal(ok.result.status, 0, ok.result.stderr || ok.result.stdout);
  assert.match(ok.log, /^emit:/m, 'CONTROL: the provenance block never invoked the emitter');
  assert.doesNotMatch(ok.log, /^fail:/m);

  // A failing emit is fatal, not a warning.
  const failed = runMacProvenanceBlock({ emitStatus: 1 });
  assert.notEqual(failed.result.status, 0, 'a failed mac provenance emit did not fail the leg');
  assert.match(failed.log, /^fail:mac provenance emit failed/m);

  // A leg that packed nothing has nothing to attest; finishing would leave a
  // "successful" mac build behind whose completeness nothing can establish.
  const empty = runMacProvenanceBlock({ artifacts: [] });
  assert.notEqual(empty.result.status, 0, 'an empty artifact set did not fail the leg');
  assert.match(empty.log, /^fail:mac leg recorded no artifacts to attest/m);
  assert.doesNotMatch(empty.log, /^emit:/m);

  // The emitter runs via `bash`, so its executable bit never gated execution --
  // testing -x only ever SKIPPED the emit silently on a checkout that worked.
  const missing = runMacProvenanceBlock({ emitter: false });
  assert.notEqual(missing.result.status, 0, 'a missing provenance emitter was silently skipped');
});

// The case that makes mac a different predicate from Windows rather than the same
// one with different globs. Tauri leaves "<Product>.app.tar.gz" UNVERSIONED, so a
// prior cut’s updater bundle is indistinguishable BY NAME from this cut’s, and a
// count against the expected role set cannot see it at all: the set below is at or
// under every expected count. Only the cross-count against THIS-version dmgs can.
test('a stale unversioned mac updater bundle is contamination, never a retryable absence', () => {
  const staleSurvivor = {
    'build-provenance.json': '{}',
    ...MAC_GUI,
    // The server leg died before its dmg landed, but a PRIOR cut’s server updater
    // bundle is still sitting in macos/. Two bundles, one this-version dmg.
    'macos/Papercusp Server.app.tar.gz': 'stale-updater-from-a-previous-cut',
    'macos/Papercusp Server.app.tar.gz.sig': 'stale-updater-sig',
  };
  assert.equal(
    journalMacOutputShape(staleSurvivor, 'gui server'),
    'present',
    'more updater bundles than this-version dmgs must fail closed, not be retried with the stale bytes still in the expected set',
  );

  // And the control that keeps the assertion above from passing vacuously: the
  // SAME shortfall with no stale bundle left behind really is a retryable absence.
  const honestShortfall = { 'build-provenance.json': '{}', ...MAC_GUI };
  assert.equal(journalMacOutputShape(honestShortfall, 'gui server'), 'absent');
});

function runRealManifestReceiptVerification({ tamper = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-manifest-receipt-'));
  const artifact = path.join(temp, 'Papercusp_GUI_0.0.18_amd64.AppImage');
  const signature = `${artifact}.sig`;
  fs.writeFileSync(artifact, 'immutable-appimage');
  fs.writeFileSync(signature, 'immutable-signature');
  const command = [
    'set -euo pipefail',
    `ORCHESTRATOR_HERE=${JSON.stringify(path.join(root, 'bin'))}`,
    `ROOT=${JSON.stringify(root)}`,
    'MONOREPO=/unused',
    'VERSION=0.0.18',
    'CHANNEL=nightly',
    'TAG=desktop-v0.0.18-nightly',
    "PAPERCUSP_BUILD_ROLES='gui'",
    'PAPERCUSP_UPDATE_BASE_URL=https://updates.example.test/releases',
    'RELEASE_TASK_JOURNAL_ENABLED=0',
    'source "$ORCHESTRATOR_HERE/lib/gen-latest-manifest.sh"',
    'source "$ORCHESTRATOR_HERE/lib/release-artifacts.sh"',
    releaseTaskJournalHarness,
    `gen_latest_manifest_json_path() { printf '%s\\n' ${JSON.stringify(path.join(temp, 'latest.json'))}; }`,
    `gen_latest_manifest_server_json_path() { printf '%s\\n' ${JSON.stringify(path.join(temp, 'latest-server.json'))}; }`,
    `gen_latest_manifest_notes_path() { printf '%s\\n' ${JSON.stringify(path.join(temp, 'release-notes.md'))}; }`,
    `release_artifacts_manifest_path() { printf '%s\\n' ${JSON.stringify(path.join(temp, 'artifacts.txt'))}; }`,
    'LATEST_JSON="$(gen_latest_manifest_json_path "$TAG")"',
    'LATEST_SERVER_JSON="$(gen_latest_manifest_server_json_path "$TAG")"',
    'NOTES_FILE="$(gen_latest_manifest_notes_path "$TAG")"',
    'ARTIFACTS_MANIFEST="$(release_artifacts_manifest_path "$TAG")"',
    `ARTIFACTS=(${JSON.stringify(artifact)} ${JSON.stringify(signature)})`,
    'gen_latest_manifest "$VERSION" "$CHANNEL" "$TAG" "${ARTIFACTS[@]}" >/dev/null',
    'printf "%s\\n" "${ARTIFACTS[@]}" | LC_ALL=C sort -u > "$ARTIFACTS_MANIFEST"',
    ...(tamper
      ? ["python3 - \"$LATEST_JSON\" <<'PY'\nimport json, sys\np=sys.argv[1]\nv=json.load(open(p))\nv['platforms']['linux-x86_64']['url'] += '.tampered'\nopen(p, 'w').write(json.dumps(v) + '\\n')\nPY"]
      : []),
    'release_task_verify_manifest_outputs "${ARTIFACTS[@]}"',
  ].join('\n');
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  fs.rmSync(temp, { recursive: true, force: true });
  return result;
}

test('real manifest receipt matches the canonical generator and rejects changed output', () => {
  const valid = runRealManifestReceiptVerification();
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  const changed = runRealManifestReceiptVerification({ tamper: true });
  assert.notEqual(changed.status, 0, 'changed manifest unexpectedly matched its receipt inputs');
  assert.match(changed.stderr, /does not match the canonical generator/);
});

function runLegVerb(verb) {
  const command = [
    'set -euo pipefail',
    'RELEASE_TASK_JOURNAL_ENABLED=0',
    releaseTaskJournalHarness,
    'RELEASE_TASK_JOURNAL_ENABLED=1',
    verb,
  ].join('\n');
  return spawnSync('bash', ['-c', command], { encoding: 'utf8' });
}

test('an unregistered leg is refused at every entry point, before any journal call', () => {
  for (const verb of [
    'release_task_leg_start bogus',
    'release_task_leg_prepare bogus /tmp/papercusp-nonexistent',
    'release_task_leg_commit bogus /tmp/papercusp-nonexistent 0',
  ]) {
    const result = runLegVerb(verb);
    assert.equal(result.status, 2, `${verb} did not fail closed: ${result.stderr || result.stdout}`);
    assert.match(result.stderr, /unknown release leg 'bogus'/);
  }

  // 0-CONTROL: a REGISTERED leg must get PAST this guard, or every assertion
  // above would hold just as well for a registry that refuses everything.
  const known = runLegVerb('release_task_leg_prepare linux /tmp/papercusp-nonexistent');
  assert.doesNotMatch(known.stderr, /unknown release leg/);
});

// The canonical post-join collector, sliced whole so the arm64 guard runs in
// its real position — after the linux collection it follows and depends on.
const collectorHarness = sliceBetween(
  '# ── Collect artifacts in the PARENT',
  '# Retain all final target',
);

function runArm64Collection({ includeArm64Artifact = true } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-arm64-collect-'));
  const target = path.join(temp, 'target');
  const linuxBundle = path.join(target, 'release', 'bundle');
  const arm64Bundle = path.join(target, 'aarch64-unknown-linux-gnu', 'release', 'bundle');
  for (const dir of ['deb', 'appimage']) {
    fs.mkdirSync(path.join(linuxBundle, dir), { recursive: true });
    fs.mkdirSync(path.join(arm64Bundle, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(linuxBundle, 'deb', 'Papercusp_GUI_0.0.18_amd64.deb'), 'linux-bytes');
  if (includeArm64Artifact) {
    fs.writeFileSync(path.join(arm64Bundle, 'deb', 'Papercusp_GUI_0.0.18_arm64.deb'), 'arm64-bytes');
  }
  const command = [
    'set -euo pipefail',
    `CARGO_TARGET_ROOT=${JSON.stringify(target)}`,
    'VERSION=0.0.18',
    'LINUX_REUSE=0',
    'RELEASE_TASK_JOURNAL_ENABLED=0',
    'WITH_ARM64=1',
    "WIN_PID=''",
    'WIN_REUSE=0',
    "MAC_PID=''",
    'MAC_REUSE=0',
    'assert_linux_artifact_cardinality() { :; }',
    collectorHarness,
    'printf "COLLECTED=%s\\n" "${#ARTIFACTS[@]}"',
  ].join('\n');
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  fs.rmSync(temp, { recursive: true, force: true });
  return result;
}

test('an arm64 leg that produced nothing fails the cut instead of publishing without it', () => {
  const empty = runArm64Collection({ includeArm64Artifact: false });
  assert.notEqual(empty.status, 0, 'an empty arm64 bundle was collected silently');
  assert.match(`${empty.stdout}${empty.stderr}`, /WITH_ARM64=1 but no 0\.0\.18 arm64 artifacts/);

  // 0-CONTROL. Without this, the assertion above would pass just as happily if
  // the collector were broken for some reason unrelated to the guard — and the
  // arm64 entry must also actually REACH ARTIFACTS, which is the half that was
  // silently discarded before (the pre-reset append).
  const present = runArm64Collection();
  assert.equal(present.status, 0, present.stderr || present.stdout);
  assert.match(present.stdout, /COLLECTED=2/);
});
