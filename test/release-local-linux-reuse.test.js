'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'bin', 'release-local.sh');
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

function runJournalLinuxResume({ action, absent = false, verify = 0 }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-linux-journal-'));
  const bundle = path.join(temp, 'bundle');
  const calls = path.join(temp, 'calls.log');
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(bundle, 'build-provenance.json'), '{}');
  const command = [
    'set -euo pipefail',
    'ORCHESTRATOR_HERE=/unused',
    'MONOREPO=/unused',
    'EXPECTED_SOURCE_SHA=' + 'a'.repeat(40),
    'VERSION=0.0.18',
    'CHANNEL=nightly',
    'TAG=desktop-v0.0.18-nightly',
    "PAPERCUSP_BUILD_ROLES='gui'",
    'PAPERCUSP_REUSE_LINUX=0',
    'PROVENANCE_SOURCE_GIT_HEAD=' + 'b'.repeat(40),
    'RELEASE_TASK_JOURNAL_ENABLED=0',
    releaseTaskJournalHarness,
    'RELEASE_TASK_JOURNAL_ENABLED=1',
    "release_task_audit_reuse_expiry() { printf '2099-01-01T00:00:00.000Z\\n'; }",
    `RELEASE_TASK_BUILD_ACTION=${action}`,
    'RELEASE_TASK_BUILD_REQUEST_ID=old-request',
    'RELEASE_TASK_BUILD_IDENTITY=linux-input',
    `release_task_linux_outputs_absent() { return ${absent ? 0 : 1}; }`,
    `release_task_verify_linux_artifacts() { printf 'verify:%s:%s\\n' "$1" "$2" >> ${JSON.stringify(calls)}; return ${verify}; }`,
    `release_task_journal_call() { printf '%s\\n' "$*" >> ${JSON.stringify(calls)}; [[ "$1" != commit ]] || printf '%s\\n' '{"state":"committed"}'; }`,
    'release_task_begin_stage() { RELEASE_TASK_LAST_ACTION=run; RELEASE_TASK_LAST_REQUEST_ID=new-request; printf "begin:%s:%s\\n" "$1" "$2" >> ' + JSON.stringify(calls) + '; }',
    "release_artifacts_cut_start_write() { printf '222\\n'; }",
    `release_task_prepare_linux_stage ${JSON.stringify(bundle)}`,
    'printf "RESULT action=%s request=%s reuse=%s cut=%s\\n" "$RELEASE_TASK_BUILD_ACTION" "$RELEASE_TASK_BUILD_REQUEST_ID" "$PAPERCUSP_REUSE_LINUX" "${PAPERCUSP_RELEASE_CUT_START_NS:-}"',
  ].join('\n');
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  const log = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '';
  fs.rmSync(temp, { recursive: true, force: true });
  return { result, log };
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
  for (const file of [files.modelBoundary, files.identityScanner, files.provenanceVerifier, files.freshnessVerifier]) {
    fs.writeFileSync(file, `${path.basename(file)}:v1\n`);
  }
  mutator({ files, workspace, desktop });
  const command = [
    'set -euo pipefail',
    `MONOREPO=${JSON.stringify(workspace)}`,
    `ROOT=${JSON.stringify(desktop)}`,
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
