const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// EI-21164709090643162: a live-federation-gate run banked a plain
// "GATE: RED (sidecar-build)" — a federation/product verdict — for a run
// whose ONLY failure was build-desktop-sidecar.sh's bounded sidecar.lock
// acquisition timing out against a still-running, legitimate concurrent
// release repack (bin/repack-deb-xz.sh, an `xz -9` compress that had been
// running 2419s). That is an evidence-PRODUCER contention failure, not
// evidence the federation smokes disproved anything. This file proves the
// fix landed in bin/live-federation-gate.sh: (1) a classifier detects the
// EXACT sidecar-lock-timeout signature plus a concrete live-holder line,
// (2) the FAIL_BUILD branch banks a typed SKIPPED-BUILD-LOCK-CONTENTION
// verdict and exits before ever reaching "GATE: RED (sidecar-build)", and
// (3) the classifier is falsifiable — it does NOT fire on an unrelated
// build failure, nor on a lock-timeout whose holder could not be confirmed.
// EI-21266997625575412 extends the same evidence-producer disposition to a
// working-tree build failure whose error literally names a path held in an
// active cross-domain source lock. Raw lock snapshots can be plain JSON or
// SSE-wrapped MCP responses; missing, malformed, waiting-only, or non-
// overlapping evidence must stay fail-closed on the ordinary RED path.
// WI-40905 extends it to dependency-generation's explicit rc75 contract: the
// before/after manifests proved a concurrent live node_modules writer and the
// immutable publisher refused the torn snapshot, so the gate must bank a typed
// non-green infrastructure skip instead of a federation/product red.

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const gate = fs.readFileSync(path.join(root, 'bin/live-federation-gate.sh'), 'utf8');
const sidecarLockHelper = fs.readFileSync(path.join(root, 'bin/lib/sidecar-lock-yield.sh'), 'utf8');
const dependencyGeneration = fs.readFileSync(
  path.join(repoRoot, 'apps/operator/bin/release/dependency-generation.sh'),
  'utf8',
);
const npmInstallSafe = fs.readFileSync(path.join(repoRoot, 'scripts/npm-install-safe.mjs'), 'utf8');
const federationAssertsSelftest = fs.readFileSync(
  path.join(root, 'bin/lib/federation-asserts.selftest.sh'),
  'utf8',
);

const CONTENTION_CHECK_FN = (
  gate.match(/^BUILD_LOCK_CONTENTION=""\nbuild_lock_contention_check\(\) \{[\s\S]*?\n\}$/m) || []
)[0];

const DEPENDENCY_CONTENTION_CHECK_FN = (
  gate.match(/^BUILD_DEPENDENCY_CONTENTION=""\nbuild_dependency_contention_check\(\) \{[\s\S]*?\n\}$/m) || []
)[0];

const SOURCE_CONTENTION_CHECK_FN = (
  gate.match(/^BUILD_SOURCE_LOCK_CONTENTION=""\nsource_lock_contention_check\(\) \{[\s\S]*?\n\}$/m) || []
)[0];

const FAIL_BUILD_BLOCK = (
  gate.match(/^if \[ "\$FAIL_BUILD" = 1 \]; then\n[\s\S]*?\n^fi$/m) || []
)[0];

test('the classifiers + typed FAIL_BUILD branches are present in the shipped gate', () => {
  assert(CONTENTION_CHECK_FN, 'could not locate build_lock_contention_check() in live-federation-gate.sh');
  assert(
    DEPENDENCY_CONTENTION_CHECK_FN,
    'could not locate build_dependency_contention_check() in live-federation-gate.sh',
  );
  assert(SOURCE_CONTENTION_CHECK_FN, 'could not locate source_lock_contention_check() in live-federation-gate.sh');
  assert(FAIL_BUILD_BLOCK, 'could not locate the "if FAIL_BUILD = 1" branch in live-federation-gate.sh');
  assert.match(
    gate,
    /capture_source_lock_snapshot "\$WORK\/source-locks-before-build\.json"[\s\S]*?bash bin\/build-desktop-sidecar\.sh/,
    'the first active-lock snapshot must be captured before the working-tree build',
  );
  assert.match(
    gate,
    /capture_source_lock_snapshot "\$WORK\/source-locks-after-build-failure\.json"[\s\S]*?source_lock_contention_check "\$WORK\/build\.log"/,
    'a failed build must capture the second snapshot before classifying the build log',
  );
  assert.match(
    gate,
    /build_lock_contention_check "\$WORK\/build\.log"/,
    'the sidecar lock classifier must still run against $WORK/build.log after failure',
  );
  assert.match(
    gate,
    /build_dependency_contention_check "\$WORK\/build\.log"/,
    'the dependency-generation classifier must run against $WORK/build.log after failure',
  );
  assert.match(
    FAIL_BUILD_BLOCK,
    /GATE: SKIPPED-BUILD-LOCK-CONTENTION/,
    'a confirmed lock contention must bank a typed SKIPPED verdict, not a RED',
  );
  assert.match(FAIL_BUILD_BLOCK, /exit 0/, 'the contention branch must exit before reaching the RED verdict below');
  assert.match(
    FAIL_BUILD_BLOCK,
    /GATE: SKIPPED-BUILD-SOURCE-LOCK-CONTENTION/,
    'an exact active source-lock overlap must bank its own typed SKIPPED verdict',
  );
  assert.match(
    FAIL_BUILD_BLOCK,
    /GATE: SKIPPED-DEPENDENCY-CONTENTION/,
    'an exact dependency-generation rc75 race must bank its own typed SKIPPED verdict',
  );
});

test('the classifier pattern is pinned to sidecar-lock-yield.sh\'s ONLY emitter of each line shape', () => {
  // If this drifts (the FATAL wording or the holder-line format changes),
  // build_lock_contention_check must be updated in lockstep or it silently
  // stops matching and every future contention window falls back to RED.
  assert.match(sidecarLockHelper, /echo "FATAL: timed out after \$\{SIDECAR_LOCK_WAIT\}s waiting for the sidecar lock/);
  assert.match(sidecarLockHelper, /printf '       pid %s \(running %ss\): %s\\n'/);
});

test('dependency contention patterns are pinned to the immutable publisher\'s canonical rc75 emitters', () => {
  assert.match(
    dependencyGeneration,
    /FATAL: live node_modules changed during generation build; refusing a torn snapshot/,
  );
  assert.match(
    npmInstallSafe,
    /NPM_INSTALL_SAFE_FATAL: immutable dependency generation publish exited \$\{status\}; the install is healthy but no checkpoint-safe generation was published\./,
  );
});

test('a failed nested FRESH provenance probe preserves its causal output in the outer gate log', () => {
  assert.match(
    federationAssertsSelftest,
    /verdict_probe_rc=\$\?[\s\S]*?nested output follows[\s\S]*?sed 's\/\^\/    \| \/' "\$WORK\/verdict-fresh\.out"/,
    'the outer self-test log must retain the nested gate output before its temporary WORK cleanup',
  );
});

test('the nested FRESH probe cannot inherit the parent gate pc-heavy marker', () => {
  assert.match(
    federationAssertsSelftest,
    /export PC_HEAVY_PREEMPT_READY_FILE="\$inherited_ready_marker"[\s\S]*?PC_HEAVY_PREEMPT_AFTER_READY=0 PC_HEAVY_PREEMPT_READY_FILE=/,
    'the behavioral probe must seed an occupied parent marker and then scrub it for the nested gate',
  );
  assert.match(
    federationAssertsSelftest,
    /PC_HEAVY_BYPASS=1 PC_HEAVY_PREEMPT_AFTER_READY=0 PC_HEAVY_PREEMPT_READY_FILE=/,
    'the synthetic FRESH probe must not re-enrol an ordinary npm test in the production heavy-work queue',
  );
});

test('every early protection refusal can bank a verdict before ordinary gate setup', () => {
  const clockHelper = gate.indexOf('now_s() {');
  const verdictWriter = gate.indexOf('bank_verdict() {');
  const protectionCall = gate.indexOf('\ngate_preempt_protect_until_first_verdict\n');
  assert(clockHelper >= 0, 'could not locate now_s()');
  assert(verdictWriter >= 0, 'could not locate bank_verdict()');
  assert(protectionCall >= 0, 'could not locate the early pc-heavy protection call');
  assert(
    clockHelper < verdictWriter && verdictWriter < protectionCall,
    'now_s() and bank_verdict() must be defined before the early protection call can refuse',
  );
});

function runDependencyContentionClassifier(buildLog) {
  assert(DEPENDENCY_CONTENTION_CHECK_FN, 'dependency classifier extraction failed');
  const script = [
    'set -uo pipefail',
    DEPENDENCY_CONTENTION_CHECK_FN,
    `build_dependency_contention_check ${JSON.stringify(buildLog)}`,
    'printf \'RESULT:%s\\n\' "$BUILD_DEPENDENCY_CONTENTION"',
  ].join('\n');
  return spawnSync('bash', ['-c', script], { encoding: 'utf8' });
}

test('build_dependency_contention_check: reports the exact immutable-generation rc75 race', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gate-dependency-contention-'));
  try {
    const buildLog = path.join(tmp, 'build.log');
    fs.writeFileSync(
      buildLog,
      [
        '[dependency-generation] changed input: apps/operator/node_modules (metadata fingerprint changed)',
        '[dependency-generation] FATAL: live node_modules changed during generation build; refusing a torn snapshot',
        'NPM_INSTALL_SAFE_FATAL: immutable dependency generation publish exited 75; the install is healthy but no checkpoint-safe generation was published.',
        '',
      ].join('\n'),
    );
    const result = runDependencyContentionClassifier(buildLog);
    assert.equal(result.status, 0, `classifier exited ${result.status}: ${result.stderr}`);
    assert.match(
      result.stdout,
      /^RESULT:apps\/operator\/node_modules \(metadata fingerprint changed\)$/m,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('build_dependency_contention_check: fails closed unless both canonical rc75 diagnostics are present', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gate-dependency-contention-neg-'));
  try {
    const buildLog = path.join(tmp, 'build.log');
    for (const contents of [
      '[dependency-generation] FATAL: live node_modules changed during generation build; refusing a torn snapshot\n',
      'NPM_INSTALL_SAFE_FATAL: immutable dependency generation publish exited 75; the install is healthy but no checkpoint-safe generation was published.\n',
      'NPM_INSTALL_SAFE_FATAL: immutable dependency generation publish exited 1; the install is healthy but no checkpoint-safe generation was published.\n',
    ]) {
      fs.writeFileSync(buildLog, contents);
      const result = runDependencyContentionClassifier(buildLog);
      assert.equal(result.status, 0, `classifier exited ${result.status}: ${result.stderr}`);
      assert.match(result.stdout, /^RESULT:$/m, 'an incomplete or different failure must remain RED');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('build_lock_contention_check: sets BUILD_LOCK_CONTENTION for a confirmed lock timeout with a live holder', () => {
  assert(CONTENTION_CHECK_FN, 'extraction failed');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gate-contention-'));
  try {
    const buildLog = path.join(tmp, 'build.log');
    fs.writeFileSync(
      buildLog,
      [
        '→ using pinned Node runtime: /home/x/.local/bin/node (v25.9.0, required >=25)',
        '→ sidecar lock is busy; allowing readers 5s to finish startup before requesting a cooperative yield',
        'FATAL: timed out after 60s waiting for the sidecar lock (/x/papercusp-desktop/src-tauri/sidecar.lock).',
        '       A live reader or build still owns it; holder context follows.',
        '       pid 3892704 (running 2419s): bash /x/papercusp-desktop/bin/repack-deb-xz.sh /x/Papercusp Server_0.0.18_amd64.deb',
        '       pid 3936883 (running 2378s): xz -9 -T4 --memlimit-compress=4GiB -c',
        '       If the holder is tauri-guarded, it should yield on SIGUSR1; otherwise stop the holder or choose an isolated sidecar output.',
        '',
      ].join('\n'),
    );

    const script = [
      'set -uo pipefail',
      CONTENTION_CHECK_FN,
      `build_lock_contention_check ${JSON.stringify(buildLog)}`,
      'printf \'RESULT:%s\\n\' "$BUILD_LOCK_CONTENTION"',
    ].join('\n');
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, `classifier script exited ${result.status}: ${result.stderr}`);
    const resultLine = result.stdout.split('\n').find((l) => l.startsWith('RESULT:'));
    assert(resultLine, `no RESULT line in stdout: ${result.stdout}`);
    const captured = resultLine.slice('RESULT:'.length);
    assert.notEqual(captured, '', 'BUILD_LOCK_CONTENTION must be set for a confirmed lock-timeout with a live holder');
    assert.match(captured, /pid 3892704/, 'must carry the reported holder pid');
    assert.match(captured, /repack-deb-xz\.sh/, 'must carry the reported holder argv (the legitimate concurrent repack)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// FALSIFIABILITY CONTROLS — the guard must not fire outside its exact case.
test('build_lock_contention_check: does NOT fire on an unrelated build failure', () => {
  assert(CONTENTION_CHECK_FN, 'extraction failed');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gate-contention-neg-'));
  try {
    const buildLog = path.join(tmp, 'build.log');
    fs.writeFileSync(
      buildLog,
      'BUILD FAILED — src-tauri/sidecar has no serve.mjs (nested sidecar.tmp.* publish?)\n',
    );
    const script = [
      'set -uo pipefail',
      CONTENTION_CHECK_FN,
      `build_lock_contention_check ${JSON.stringify(buildLog)}`,
      'printf \'RESULT:%s\\n\' "$BUILD_LOCK_CONTENTION"',
    ].join('\n');
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^RESULT:$/m, 'a genuine build defect must stay classified as a RED, never contention');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('build_lock_contention_check: does NOT fire when the holder could not be confirmed (fail-closed to RED)', () => {
  assert(CONTENTION_CHECK_FN, 'extraction failed');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gate-contention-unknown-'));
  try {
    const buildLog = path.join(tmp, 'build.log');
    fs.writeFileSync(
      buildLog,
      [
        'FATAL: timed out after 60s waiting for the sidecar lock (/x/sidecar.lock).',
        '       A live reader or build still owns it; holder context follows.',
        '       holder details unavailable (install fuser/procps or inspect /proc/locks)',
        '',
      ].join('\n'),
    );
    const script = [
      'set -uo pipefail',
      CONTENTION_CHECK_FN,
      `build_lock_contention_check ${JSON.stringify(buildLog)}`,
      'printf \'RESULT:%s\\n\' "$BUILD_LOCK_CONTENTION"',
    ].join('\n');
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /^RESULT:$/m,
      'without a concrete holder line we cannot prove fair contention vs a genuine wedge — must fail closed to RED',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function runSourceLockClassifier(buildLog, snapshots) {
  assert(SOURCE_CONTENTION_CHECK_FN, 'source classifier extraction failed');
  const script = [
    'set -uo pipefail',
    SOURCE_CONTENTION_CHECK_FN,
    `source_lock_contention_check ${JSON.stringify(buildLog)} ${snapshots.map((snapshot) => JSON.stringify(snapshot)).join(' ')}`,
    'printf \'RESULT:%s\\n\' "$BUILD_SOURCE_LOCK_CONTENTION"',
  ].join('\n');
  return spawnSync('bash', ['-c', script], { encoding: 'utf8' });
}

test('source_lock_contention_check: decodes plain JSON and reports an exact active path overlap', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gate-source-lock-json-'));
  try {
    const buildLog = path.join(tmp, 'build.log');
    const before = path.join(tmp, 'before.json');
    const after = path.join(tmp, 'after.json');
    const lockedPath = 'packages/operator-core/lib/agent-tools/work_items/complete.ts';
    fs.writeFileSync(
      buildLog,
      `✘ [ERROR] Multiple exports\n    ../../${lockedPath}:1111:16:\n`,
    );
    fs.writeFileSync(before, JSON.stringify({ active_locks: [] }));
    fs.writeFileSync(after, JSON.stringify({
      active_locks: [{
        path: lockedPath,
        owner: 'su-f83cc',
        intent: 'EI-21259433290500193 completion-freshness extraction',
      }],
      waiting: [],
    }));

    const result = runSourceLockClassifier(buildLog, [before, after]);
    assert.equal(result.status, 0, `classifier exited ${result.status}: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(`RESULT:path=${lockedPath.replaceAll('.', '\\.')}`));
    assert.match(result.stdout, /owner=su-f83cc/);
    assert.match(result.stdout, /intent=EI-21259433290500193 completion-freshness extraction/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('source_lock_contention_check: decodes an SSE-wrapped MCP text payload', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gate-source-lock-sse-'));
  try {
    const buildLog = path.join(tmp, 'build.log');
    const snapshot = path.join(tmp, 'locks.sse');
    const lockedPath = 'apps/operator/lib/tools/example.ts';
    fs.writeFileSync(buildLog, `✘ [ERROR] Build failed\n    ../../${lockedPath}:42:1:\n`);
    const toolText = JSON.stringify({
      active_locks: [{ path: lockedPath, owner: 'su-source', intent: 'atomic edit' }],
      waiting: [],
    });
    const envelope = {
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: toolText }] },
    };
    fs.writeFileSync(snapshot, `:stream-open\n\ndata: ${JSON.stringify(envelope)}\n\n`);

    const result = runSourceLockClassifier(buildLog, [snapshot]);
    assert.equal(result.status, 0, `classifier exited ${result.status}: ${result.stderr}`);
    assert.match(result.stdout, /RESULT:path=apps\/operator\/lib\/tools\/example\.ts owner=su-source intent=atomic edit/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('source_lock_contention_check: ignores malformed, waiting-only, non-exact, and progress-only lock evidence', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gate-source-lock-negative-'));
  try {
    const buildLog = path.join(tmp, 'build.log');
    const malformed = path.join(tmp, 'malformed.sse');
    const waiting = path.join(tmp, 'waiting.json');
    const basenameOnly = path.join(tmp, 'basename-only.json');
    const progressOnly = path.join(tmp, 'progress-only.json');
    const progressPath = 'packages/operator-core/lib/progress-only.ts';
    fs.writeFileSync(
      buildLog,
      [
        `→ scanned ../../${progressPath}`,
        ...Array.from({ length: 10 }, (_, index) => `progress line ${index}`),
        '✘ [ERROR] Build failed',
        '    ../../other/complete.ts:10:1:',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(malformed, 'data: {definitely-not-json}\n');
    fs.writeFileSync(waiting, JSON.stringify({
      active_locks: [],
      waiting: [{ path: 'other/complete.ts', owner: 'su-waiting', intent: 'not active' }],
    }));
    fs.writeFileSync(basenameOnly, JSON.stringify({
      active_locks: [{
        path: 'packages/operator-core/lib/agent-tools/work_items/complete.ts',
        owner: 'su-other',
        intent: 'different path with same basename',
      }],
    }));
    fs.writeFileSync(progressOnly, JSON.stringify({
      active_locks: [{ path: progressPath, owner: 'su-progress', intent: 'unrelated active edit' }],
    }));

    const result = runSourceLockClassifier(buildLog, [malformed, waiting, basenameOnly, progressOnly]);
    assert.equal(result.status, 0, `classifier exited ${result.status}: ${result.stderr}`);
    assert.match(
      result.stdout,
      /^RESULT:$/m,
      'anything short of an active lock whose full repository path appears literally must remain ordinary RED',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Behavioral counterpart of the static "typed branch" test above: actually RUNS
// the exact FAIL_BUILD block extracted from the shipped script and proves a
// confirmed contention exits 0 with the typed verdict, records the same
// short-retry backoff the storm/starvation downgrades use, and NEVER reaches
// past the block (i.e. never falls through toward "GATE: RED (sidecar-build)").
test('the real FAIL_BUILD branch bank a typed SKIPPED verdict and exits before RED (behavioral)', () => {
  assert(FAIL_BUILD_BLOCK, 'extraction failed');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gate-failbuild-'));
  try {
    const stateDir = path.join(tmp, 'state');
    fs.mkdirSync(stateDir);
    fs.writeFileSync(path.join(stateDir, 'last-red'), '111'); // must be cleared by the contention branch
    const workDir = path.join(tmp, 'work');
    fs.mkdirSync(workDir);

    const script = [
      'set -uo pipefail',
      `STATE_DIR=${JSON.stringify(stateDir)}`,
      `WORK=${JSON.stringify(workDir)}`,
      'FAIL_BUILD=1',
      'SKIP_MATRIX=0',
      'SKIP_FROMREPO=0',
      'BUILD_LOCK_CONTENTION="pid 3892704 (running 2419s): bash bin/repack-deb-xz.sh Papercusp_Server.deb"',
      'BUILD_DEPENDENCY_CONTENTION=""',
      'BUILD_SOURCE_LOCK_CONTENTION=""',
      'log() { :; }', // real log() writes to stderr only — irrelevant here
      'now_s() { echo 1700000000; }',
      'check_staleness() { echo CHECK_STALENESS_CALLED; }',
      'verdict() { echo "$1"; }', // real verdict() also banks to a JSONL file — irrelevant here
      FAIL_BUILD_BLOCK,
      'echo UNREACHABLE_AFTER_CONTENTION_EXIT',
    ].join('\n');
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });

    assert.equal(result.status, 0, `expected a clean exit 0, got ${result.status}: ${result.stderr}`);
    assert.match(result.stdout, /GATE: SKIPPED-BUILD-LOCK-CONTENTION/, 'must bank the typed contention verdict');
    assert.doesNotMatch(
      result.stdout,
      /GATE: RED/,
      'a confirmed contention must never also read as a RED verdict',
    );
    assert.doesNotMatch(
      result.stdout,
      /UNREACHABLE_AFTER_CONTENTION_EXIT/,
      'the contention branch must exit before falling through to the smoke/verdict section below it',
    );
    assert.match(result.stdout, /CHECK_STALENESS_CALLED/, 'must still run check_staleness — silence must never look like green');
    assert.equal(fs.existsSync(path.join(stateDir, 'last-downgrade')), true, 'must record the short-retry downgrade backoff');
    assert.equal(fs.existsSync(path.join(stateDir, 'last-red')), false, 'must clear last-red — this run confirmed nothing red');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the real FAIL_BUILD branch banks a typed dependency-contention SKIP and exits before RED (behavioral)', () => {
  assert(FAIL_BUILD_BLOCK, 'extraction failed');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gate-dependency-failbuild-'));
  try {
    const stateDir = path.join(tmp, 'state');
    fs.mkdirSync(stateDir);
    fs.writeFileSync(path.join(stateDir, 'last-red'), '111');
    const workDir = path.join(tmp, 'work');
    fs.mkdirSync(workDir);

    const script = [
      'set -uo pipefail',
      `STATE_DIR=${JSON.stringify(stateDir)}`,
      `WORK=${JSON.stringify(workDir)}`,
      'FAIL_BUILD=1',
      'SKIP_MATRIX=0',
      'SKIP_FROMREPO=0',
      'BUILD_LOCK_CONTENTION=""',
      'BUILD_DEPENDENCY_CONTENTION="apps/operator/node_modules (metadata fingerprint changed)"',
      'BUILD_SOURCE_LOCK_CONTENTION=""',
      'log() { :; }',
      'now_s() { echo 1700000000; }',
      'check_staleness() { echo CHECK_STALENESS_CALLED; }',
      'verdict() { echo "$1"; }',
      FAIL_BUILD_BLOCK,
      'echo UNREACHABLE_AFTER_DEPENDENCY_CONTENTION_EXIT',
    ].join('\n');
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });

    assert.equal(result.status, 0, `expected a clean exit 0, got ${result.status}: ${result.stderr}`);
    assert.match(result.stdout, /GATE: SKIPPED-DEPENDENCY-CONTENTION/);
    assert.doesNotMatch(result.stdout, /GATE: RED/);
    assert.doesNotMatch(result.stdout, /UNREACHABLE_AFTER_DEPENDENCY_CONTENTION_EXIT/);
    assert.match(result.stdout, /CHECK_STALENESS_CALLED/);
    assert.equal(fs.existsSync(path.join(stateDir, 'last-downgrade')), true);
    assert.equal(fs.existsSync(path.join(stateDir, 'last-red')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the real FAIL_BUILD branch banks a typed source-lock SKIP and exits before RED (behavioral)', () => {
  assert(FAIL_BUILD_BLOCK, 'extraction failed');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gate-source-failbuild-'));
  try {
    const stateDir = path.join(tmp, 'state');
    fs.mkdirSync(stateDir);
    fs.writeFileSync(path.join(stateDir, 'last-red'), '111');
    const workDir = path.join(tmp, 'work');
    fs.mkdirSync(workDir);

    const script = [
      'set -uo pipefail',
      `STATE_DIR=${JSON.stringify(stateDir)}`,
      `WORK=${JSON.stringify(workDir)}`,
      'FAIL_BUILD=1',
      'SKIP_MATRIX=0',
      'SKIP_FROMREPO=0',
      'BUILD_LOCK_CONTENTION=""',
      'BUILD_DEPENDENCY_CONTENTION=""',
      'BUILD_SOURCE_LOCK_CONTENTION="path=packages/operator-core/lib/agent-tools/work_items/complete.ts owner=su-f83cc intent=atomic edit"',
      'log() { :; }',
      'now_s() { echo 1700000000; }',
      'check_staleness() { echo CHECK_STALENESS_CALLED; }',
      'verdict() { echo "$1"; }',
      FAIL_BUILD_BLOCK,
      'echo UNREACHABLE_AFTER_SOURCE_CONTENTION_EXIT',
    ].join('\n');
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });

    assert.equal(result.status, 0, `expected a clean exit 0, got ${result.status}: ${result.stderr}`);
    assert.match(result.stdout, /GATE: SKIPPED-BUILD-SOURCE-LOCK-CONTENTION/);
    assert.doesNotMatch(result.stdout, /GATE: RED/);
    assert.doesNotMatch(result.stdout, /UNREACHABLE_AFTER_SOURCE_CONTENTION_EXIT/);
    assert.match(result.stdout, /CHECK_STALENESS_CALLED/);
    assert.equal(fs.existsSync(path.join(stateDir, 'last-downgrade')), true);
    assert.equal(fs.existsSync(path.join(stateDir, 'last-red')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the real FAIL_BUILD branch falls through to the ordinary RED path when contention was NOT confirmed', () => {
  assert(FAIL_BUILD_BLOCK, 'extraction failed');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gate-failbuild-fallthrough-'));
  try {
    const stateDir = path.join(tmp, 'state');
    fs.mkdirSync(stateDir);
    const workDir = path.join(tmp, 'work');
    fs.mkdirSync(workDir);

    const script = [
      'set -uo pipefail',
      `STATE_DIR=${JSON.stringify(stateDir)}`,
      `WORK=${JSON.stringify(workDir)}`,
      'FAIL_BUILD=1',
      'SKIP_MATRIX=0',
      'SKIP_FROMREPO=0',
      'BUILD_LOCK_CONTENTION=""', // unconfirmed — e.g. a genuine build defect
      'BUILD_DEPENDENCY_CONTENTION=""',
      'BUILD_SOURCE_LOCK_CONTENTION=""',
      'log() { :; }',
      'now_s() { echo 1700000000; }',
      'check_staleness() { echo CHECK_STALENESS_CALLED; }',
      'verdict() { echo "$1"; }',
      FAIL_BUILD_BLOCK,
      'echo REACHED_ORDINARY_RED_PATH',
    ].join('\n');
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });

    assert.equal(result.status, 0, `expected a clean exit 0, got ${result.status}: ${result.stderr}`);
    assert.doesNotMatch(result.stdout, /GATE: SKIPPED-BUILD-LOCK-CONTENTION/, 'must not fire the contention verdict when unconfirmed');
    assert.doesNotMatch(result.stdout, /GATE: SKIPPED-DEPENDENCY-CONTENTION/);
    assert.match(result.stdout, /REACHED_ORDINARY_RED_PATH/, 'an unconfirmed build failure must still reach the gate\'s ordinary RED verdict path');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The recurrence check the EI asked for, run against the REAL acquisition
// helper: actually HOLD sidecar.lock past the bounded wait with a live
// process (never a mutation of the shared tree — a synthetic lock file in a
// tmp dir), let the real __pc_acquire_sidecar_flock() time out, capture its
// genuine FATAL diagnostic, and feed that into the real classifier.
test('recurrence: a lock genuinely held past the bounded wait is classified as contention end-to-end (behavioral)', async () => {
  assert(CONTENTION_CHECK_FN, 'extraction failed');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gate-recurrence-'));
  const lock = path.join(tmp, 'sidecar.lock');
  const holderScript = path.join(tmp, 'repack-deb-xz.sh'); // realistic argv, matches the live incident
  const ready = path.join(tmp, 'ready');
  let holder;
  try {
    fs.writeFileSync(
      holderScript,
      ['#!/usr/bin/env bash', 'set -euo pipefail', 'exec 8>"$1"', 'flock -x 8', 'printf ready >"$2"', 'while :; do sleep 0.05; done'].join('\n'),
    );
    fs.chmodSync(holderScript, 0o755);
    holder = spawn('bash', [holderScript, lock, ready], { stdio: 'ignore', detached: true });

    const deadline = Date.now() + 3000;
    while (!fs.existsSync(ready)) {
      if (Date.now() >= deadline) throw new Error('holder never signalled ready');
      await new Promise((r) => setTimeout(r, 20));
    }

    // The bounded wait is scaled down (1s stands in for the real 60s/3600s —
    // the mechanism under test, flock -w timing out against a live holder, is
    // identical regardless of the configured duration) so this test stays fast.
    const writerScript = [
      'set -uo pipefail',
      `SIDECAR_LOCK_WAIT_LOCK=${JSON.stringify(lock)}`,
      'PAPERCUSP_SIDECAR_LOCK_WAIT_SEC=1',
      'PAPERCUSP_SIDECAR_READER_YIELD_AFTER_SEC=0',
      sidecarLockHelper,
      'exec 9>"$SIDECAR_LOCK_WAIT_LOCK"',
      '__pc_acquire_sidecar_flock "$SIDECAR_LOCK_WAIT_LOCK"',
    ].join('\n');
    const writerResult = spawnSync('bash', ['-c', writerScript], { encoding: 'utf8' });
    assert.notEqual(writerResult.status, 0, 'the writer must fail to acquire while the holder is alive');
    const buildLog = path.join(tmp, 'build.log');
    fs.writeFileSync(buildLog, `${writerResult.stdout}${writerResult.stderr}`);

    const classifierScript = [
      'set -uo pipefail',
      CONTENTION_CHECK_FN,
      `build_lock_contention_check ${JSON.stringify(buildLog)}`,
      'printf \'RESULT:%s\\n\' "$BUILD_LOCK_CONTENTION"',
    ].join('\n');
    const classifierResult = spawnSync('bash', ['-c', classifierScript], { encoding: 'utf8' });
    assert.equal(classifierResult.status, 0);
    const resultLine = classifierResult.stdout.split('\n').find((l) => l.startsWith('RESULT:'));
    const captured = resultLine.slice('RESULT:'.length);
    assert.notEqual(captured, '', `classifier did not confirm contention against a genuinely-held real lock:\n${buildLog ? fs.readFileSync(buildLog, 'utf8') : ''}`);
    assert.match(captured, /repack-deb-xz\.sh/, 'must attribute the timeout to the real live holder process');
  } finally {
    if (holder && holder.exitCode === null) {
      try {
        process.kill(-holder.pid, 'SIGTERM');
      } catch {}
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
