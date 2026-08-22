const assert = require('node:assert/strict');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const builder = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
const windowsBuilder = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');
const sidecarLockHelper = fs.readFileSync(path.join(root, 'bin/lib/sidecar-lock-yield.sh'), 'utf8');
const liveFederationGate = fs.readFileSync(path.join(root, 'bin/live-federation-gate.sh'), 'utf8');

const SIDECAR_LOCK_SECTION = (
  builder.match(/^exec 9>"\$SIDECAR_FINAL_DIR\.lock"\n[\s\S]*?^SIDECAR_DIR="\$SIDECAR_TMP_DIR"$/m) || []
)[0];

async function waitForFile(file, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('every release writer uses the shared bounded cooperative sidecar-lock helper', () => {
  for (const [name, source] of [
    ['build-desktop-sidecar.sh', builder],
    ['build-windows-cross.sh', windowsBuilder],
  ]) {
    assert.match(
      source,
      /source "\$HERE\/lib\/sidecar-lock-yield\.sh"/,
      `${name} must source the shared writer-lock protocol`,
    );
    assert.match(
      source,
      /__pc_acquire_sidecar_flock /,
      `${name} must use the bounded cooperative acquisition, not a bare flock`,
    );
  }
  assert.doesNotMatch(
    windowsBuilder,
    /^\s*flock 9\s*$/m,
    'the Windows release staging path must never return to an unbounded bare flock',
  );
  assert.match(sidecarLockHelper, /flock -w "\$SIDECAR_LOCK_WAIT" 9/);
  assert.match(sidecarLockHelper, /kill -USR1/);
  assert.match(sidecarLockHelper, /holder context follows/);
});

test('the scheduled live federation gate waits boundedly for a progressing package writer', () => {
  assert.match(
    liveFederationGate,
    /PAPERCUSP_SIDECAR_LOCK_WAIT_SEC="\$\{PAPERCUSP_SIDECAR_LOCK_WAIT_SEC:-3600\}"\s+\\\s+bash bin\/build-desktop-sidecar\.sh/,
    'the four-hour gate must not inherit the interactive builder\'s 60-second contention timeout',
  );
});

test('the real builder lock path survives vanished fuser PIDs and yields a live tauri reader', async () => {
  assert(SIDECAR_LOCK_SECTION, 'could not extract the shipped sidecar lock section');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-builder-yield-'));
  const lockBase = path.join(tmp, 'sidecar');
  const holderScript = path.join(tmp, 'tauri-guarded');
  const ready = path.join(tmp, 'ready');
  const yielded = path.join(tmp, 'yielded');
  const fuserFdState = path.join(tmp, 'fuser-fd9-state');
  const shimDir = path.join(tmp, 'bin');
  fs.mkdirSync(shimDir);
  fs.writeFileSync(
    holderScript,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'exec 8>"$1"',
      'flock -s 8',
      'printf ready >"$2"',
      'trap \'exec 8>&-; printf yielded >"$3"\' USR1',
      'while :; do sleep 0.05; done',
    ].join('\n'),
  );
  fs.chmodSync(holderScript, 0o755);

  const holder = spawn('bash', [holderScript, `${lockBase}.lock`, ready, yielded], {
    stdio: 'ignore',
    detached: true,
  });
  try {
    await waitForFile(ready);
    const fuserShim = path.join(shimDir, 'fuser');
    fs.writeFileSync(
      fuserShim,
      [
        '#!/usr/bin/env bash',
        'if [[ -e /proc/$$/fd/9 ]]; then printf open >"$FUSER_FD_STATE"; else printf closed >"$FUSER_FD_STATE"; fi',
        // A PID outside Linux's possible range deterministically models the real
        // fuser-helper race; the second PID is the cooperative reader we must signal.
        'printf \'99999999 %s\\n\' "$HOLDER_PID"',
      ].join('\n'),
    );
    fs.chmodSync(fuserShim, 0o755);

    const harness = [
      'set -euo pipefail',
      `SIDECAR_FINAL_DIR=${JSON.stringify(lockBase)}`,
      `SIDECAR_TMP_DIR=${JSON.stringify(`${lockBase}.tmp`)}`,
      'PAPERCUSP_SIDECAR_LOCK_WAIT_SEC=2',
      'PAPERCUSP_SIDECAR_READER_YIELD_AFTER_SEC=0',
      sidecarLockHelper,
      SIDECAR_LOCK_SECTION,
      'echo LOCK_ACQUIRED',
    ].join('\n');
    const result = spawnSync('bash', ['-c', harness], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${shimDir}:${process.env.PATH}`,
        FUSER_FD_STATE: fuserFdState,
        HOLDER_PID: String(holder.pid),
      },
    });

    assert.equal(result.status, 0, `builder lock path exited ${result.status}:\n${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /LOCK_ACQUIRED/, 'the writer must cross the cooperative-yield boundary');
    assert.equal(fs.readFileSync(fuserFdState, 'utf8'), 'closed', 'fuser helpers must not inherit writer fd 9');
    assert.equal(fs.existsSync(yielded), true, 'the real tauri-guarded holder must receive SIGUSR1');
  } finally {
    if (holder.exitCode === null) {
      try { process.kill(-holder.pid, 'SIGTERM'); } catch {}
      await new Promise((resolve) => holder.once('close', resolve));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The guard is PROPERTY-based, not SHAPE-based, and that is a deliberate
// rewrite (2026-08-10). It used to match a literal `( exec 9>&-; cd <x>&& cargo
// build ` and compare two counts. That shape silently went stale the moment a
// `RUSTFLAGS="..."` (and `PATH=`/`SDKROOT=` on the cross line) was inserted
// between the `&&` and the `cargo`: every build was STILL correctly wrapped in
// the fd-closing subshell, but the pattern matched 0 of them, so the guard
// reported `0 !== 2` — a FALSE RED against a script that had not regressed.
//
// A guard that fails when the code is fine is worse than no guard: it costs a
// real diagnosis every time, and it trains the next reader to assume its red is
// spurious — which is exactly when it stops catching the real thing. So assert
// the PROPERTY (every real cargo invocation sits inside the fd-closing
// subshell) per-occurrence, and report WHICH line is unprotected rather than a
// bare count mismatch.
//
// `cargo zigbuild` (the darwin-cross pui build) is now covered too — it spawns
// the same daemon-capable rustc wrapper and was never counted by the old
// `cargo build ` match. Mentions inside comments and `echo` strings are
// excluded: the script legitimately talks ABOUT bare `cargo build` in several
// places, and matching prose is the spelling-vs-property error one level up.
const CARGO_INVOCATION = /cargo (?:build|zigbuild) /;
const FD_CLOSING_SUBSHELL = /\( exec 9>&-;/;

const cargoInvocationLines = builder
  .split('\n')
  .map((line, i) => ({ line, lineNo: i + 1 }))
  .filter(({ line }) => CARGO_INVOCATION.test(line) && !/^\s*(?:#|echo\b)/.test(line));

test('every cargo build closes the sidecar flock fd before sccache can daemonize', () => {
  const unprotected = cargoInvocationLines
    .filter(({ line }) => !FD_CLOSING_SUBSHELL.test(line))
    .map(({ lineNo, line }) => `${lineNo}: ${line.trim()}`);

  assert.deepEqual(
    unprotected,
    [],
    'each of these cargo invocations runs WITHOUT `( exec 9>&-; …)`, so RUSTC_WRAPPER (sccache) ' +
      'can daemonize holding the inherited sidecar flock fd 9 and wedge every later build',
  );

  // Tripwire, kept from the original guard: a NEW cargo invocation should make
  // someone re-read this file rather than silently inherit its coverage.
  assert.equal(
    cargoInvocationLines.length,
    3,
    `update this guard when another cargo build is added (found ${cargoInvocationLines.length}: ` +
      `${cargoInvocationLines.map(({ lineNo }) => lineNo).join(', ')})`,
  );
});

// EI-20186539588704262 follow-up: the Vite build lock must cover the SPA
// handoff too. A desktop build that returns to copying the live operator-vite
// dist/ after the singleflight process exits reopens the stale-hash race.
test('desktop sidecar consumes the lock-held Vite snapshot, not live dist/', () => {
  assert.match(
    builder,
    /VITE_BUILD_SNAPSHOT_DIR="\$SIDECAR_DIR\/spa"/,
    'build-desktop-sidecar.sh must request a Vite snapshot in its staging tree',
  );
  assert.match(
    builder,
    /using locked operator-vite snapshot/,
    'the packaging step must identify and consume the stable snapshot',
  );
  assert.doesNotMatch(
    builder,
    /cp -a "\$VITE_DIR\/dist" "\$SIDECAR_DIR\/spa"/,
    'copying live Vite dist/ after the build lock is released reopens the stale-hash race',
  );
});

// The falsifiability proof the old guard never had — asserted against SYNTHETIC
// source, never by mutating the real script (this tree is swept into commits
// every few minutes, so a briefly-mutated file gets committed even when nothing
// goes wrong).
test('the guard actually catches an unprotected cargo build', () => {
  const unprotectedSample = 'cd "$REPO/apps/tui" && RUSTFLAGS="-x" cargo build --release';
  const protectedSample = '( exec 9>&-; cd "$REPO/apps/tui" && RUSTFLAGS="-x" cargo build --release )';
  const proseSample = '# it does NOT protect a plain `cargo build`/`cargo check` under src-tauri';
  const echoSample = 'echo "    → cross: cargo zigbuild pui for ${_pui_triple}"';

  const isCounted = (l) => CARGO_INVOCATION.test(l) && !/^\s*(?:#|echo\b)/.test(l);

  assert.equal(isCounted(unprotectedSample) && !FD_CLOSING_SUBSHELL.test(unprotectedSample), true);
  assert.equal(isCounted(protectedSample) && FD_CLOSING_SUBSHELL.test(protectedSample), true);
  // The two exclusions, pinned: prose and log strings must NOT read as invocations.
  assert.equal(isCounted(proseSample), false);
  assert.equal(isCounted(echoSample), false);
});

test('a daemon-capable child with fd 9 closed cannot retain the parent flock', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-sidecar-lock-'));
  const lock = path.join(tmp, 'sidecar.lock');
  let sleeper = 0;

  try {
    sleeper = Number(
      execFileSync(
        'bash',
        [
          '-c',
          'exec 9>"$1"; flock 9; ( exec 9>&-; exec sleep 30 ) >/dev/null 2>&1 & echo $!',
          'bash',
          lock,
        ],
        { encoding: 'utf8' },
      ).trim(),
    );
    assert(Number.isInteger(sleeper) && sleeper > 1);
    assert.equal(spawnSync('flock', ['-n', lock, '-c', 'true']).status, 0);
  } finally {
    if (sleeper > 1) {
      try {
        process.kill(sleeper, 'SIGTERM');
      } catch {}
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// WI-6557: the outgoing sidecar tree (OLD_DIR — the `mv "$SIDECAR_FINAL_DIR"
// "$OLD_DIR"` swap just before publish) used to be reaped ONLY on the
// explicit success path (`rm -rf "$OLD_DIR"` right after the publish rename).
// Any failure between the swap and that line (a `set -e` death, an explicit
// `exit 1` guard) permanently stranded the whole outgoing tree — 11 orphaned
// `sidecar.old.<pid>` dirs, one of them 2.5G, were found stranded on one box
// from exactly this gap. The fix folds OLD_DIR into the same EXIT trap that
// already reaps SIDECAR_TMP_DIR/SIDECAR_LOCKDIR.
test('EI-18775478513129278 sibling / WI-6557: the EXIT trap also reaps OLD_DIR, not just SIDECAR_TMP_DIR/SIDECAR_LOCKDIR', () => {
  const trapLines = builder.match(/^trap '[^\n]*' EXIT$/gm) || [];
  assert.equal(trapLines.length, 1, 'expected exactly one top-level EXIT trap in the script');
  assert.match(
    trapLines[0],
    /\$\{OLD_DIR:\+"\$OLD_DIR"\}/,
    'the EXIT trap must also reap $OLD_DIR (the outgoing sidecar tree) or a mid-publish failure strands it permanently',
  );
});

// Behavioral counterpart of the guard above: actually RUNS the exact trap
// line extracted from the real script (never a hand-copied duplicate that
// could silently drift from what ships) in a sandbox that mimics the real
// variable lifecycle — OLD_DIR assigned partway through, THEN the process
// dies before its own explicit cleanup runs — and asserts the directory is
// gone afterward. A static text match alone cannot prove the trap syntax is
// correct bash (e.g. that `${OLD_DIR:+...}` really is safe under this
// script's `set -u` before OLD_DIR is ever assigned).
test('WI-6557: the real EXIT trap line removes OLD_DIR on a mid-publish failure (behavioral)', () => {
  const trapLine = (builder.match(/^trap '[^\n]*' EXIT$/m) || [])[0];
  assert(trapLine, 'could not locate the EXIT trap line in build-desktop-sidecar.sh');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-sidecar-olddir-'));
  try {
    const sidecarTmpDir = path.join(tmp, 'sidecar.tmp.1234');
    const oldDir = path.join(tmp, 'sidecar.old.1234');
    fs.mkdirSync(sidecarTmpDir);
    fs.mkdirSync(oldDir);
    fs.writeFileSync(path.join(oldDir, 'a-real-2.5g-build-would-have-files-like-this'), 'x');

    const script = [
      'set -euo pipefail',
      `SIDECAR_TMP_DIR=${JSON.stringify(sidecarTmpDir)}`,
      'SIDECAR_LOCKDIR=""',
      trapLine, // the ACTUAL line from the shipped script
      `OLD_DIR=${JSON.stringify(oldDir)}`, // mimics the real script's later assignment
      'exit 1', // simulate a failure AFTER the swap but BEFORE the explicit success-path rm -rf
    ].join('\n');

    const result = spawnSync('bash', ['-c', script]);
    assert.equal(result.status, 1, 'the sandbox script should still exit 1 (the trap must not swallow the failure)');
    assert.equal(fs.existsSync(oldDir), false, 'OLD_DIR must be reaped by the EXIT trap on a mid-publish failure');
    assert.equal(fs.existsSync(sidecarTmpDir), false, 'SIDECAR_TMP_DIR must still be reaped too (pre-existing behavior)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// WI-38368 / EI-18882950272344248 — the stale-staging sweep.
//
// The EXIT trap above cannot be the whole answer: measured on this box, a bash
// EXIT trap DOES fire on SIGTERM and SIGINT, but NOT on SIGKILL (nor the OOM
// killer / power loss). So SIGKILL residue is the one class no trap can close,
// and the startup sweep is the only mechanism that can. A 1.4GB
// `sidecar.tmp.3992781` with a long-dead owning pid sat here for over a day
// from exactly this gap.
//
// Same discipline as the trap tests above: extract and run the REAL function
// from the shipped script, never a hand-copied duplicate that could drift.
const SWEEP_FN = (builder.match(/^__pc_sweep_stale_staging\(\) \{\n[\s\S]*?^\}$/m) || [])[0];

test('WI-38368: the stale-staging sweep function is present in the shipped script', () => {
  assert(SWEEP_FN, 'could not locate __pc_sweep_stale_staging() in build-desktop-sidecar.sh');
  assert.match(SWEEP_FN, /kill -0/, 'the sweep must check whether the owning pid is alive');
  assert.match(
    SWEEP_FN,
    /ps -p "\$pid" -o args=/,
    'kill -0 alone is insufficient — pid wrap would protect dead residue forever, so the sweep must also confirm the pid is really a build-desktop-sidecar process',
  );
});

// Behavioral: a static match cannot prove the globbing, the pid check, or the
// self-exclusion actually work. Run the real function against a sandbox that
// mimics the true directory layout, with one genuinely-live decoy process.
test('WI-38368: the sweep reaps dead residue, spares a LIVE build, and never eats its own staging dir (behavioral)', () => {
  assert(SWEEP_FN, 'could not locate __pc_sweep_stale_staging() in build-desktop-sidecar.sh');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-sidecar-sweep-'));
  let live = 0;
  try {
    const final = path.join(tmp, 'sidecar');
    // A real, live process whose `ps args` genuinely contains the script name —
    // the decoy the sweep must refuse to touch.
    const decoy = path.join(tmp, 'build-desktop-sidecar.sh');
    fs.writeFileSync(decoy, 'sleep 30\n');
    live = Number(
      execFileSync('bash', ['-c', 'bash "$1" >/dev/null 2>&1 & echo $!', 'bash', decoy], {
        encoding: 'utf8',
      }).trim(),
    );
    assert(Number.isInteger(live) && live > 1, 'failed to start the live decoy build');

    // A pid that is dead: allocate one, then reap it.
    const deadPid = Number(
      execFileSync('bash', ['-c', '( exit 0 ) & echo $!; wait'], { encoding: 'utf8' }).trim(),
    );

    const deadTmp = `${final}.tmp.${deadPid}`;
    const deadOld = `${final}.old.${deadPid}`;
    const liveTmp = `${final}.tmp.${live}`;
    const ownTmp = `${final}.tmp.999999`; // stands in for THIS run's own staging tree
    const notPidStamped = `${final}.tmp.notanumber`;
    for (const d of [deadTmp, deadOld, liveTmp, ownTmp, notPidStamped]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(deadTmp, 'a-1.4g-build-would-have-files-like-this'), 'x');

    const script = [
      'set -euo pipefail',
      `SIDECAR_FINAL_DIR=${JSON.stringify(final)}`,
      `SIDECAR_TMP_DIR=${JSON.stringify(ownTmp)}`,
      SWEEP_FN, // the ACTUAL function from the shipped script
      '__pc_sweep_stale_staging',
    ].join('\n');

    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, `sweep should exit 0, got ${result.status}: ${result.stderr}`);

    assert.equal(fs.existsSync(deadTmp), false, 'a tmp staging dir whose owning pid is dead must be reaped');
    assert.equal(fs.existsSync(deadOld), false, 'an old staging dir whose owning pid is dead must be reaped');
    assert.equal(
      fs.existsSync(liveTmp),
      true,
      'a CONCURRENT build’s staging dir must never be deleted out from under it',
    );
    assert.equal(fs.existsSync(ownTmp), true, 'the sweep must never remove this run’s own SIDECAR_TMP_DIR');
    assert.equal(
      fs.existsSync(notPidStamped),
      true,
      'a dir without a numeric pid suffix is not ours to reap — leave it alone',
    );
  } finally {
    if (live > 1) {
      try {
        process.kill(live, 'SIGKILL');
      } catch {}
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The case EVERY future build hits, and the one with the widest blast radius if
// wrong: no residue at all. The script runs under `set -euo pipefail`, so a
// sweep whose last statement evaluated non-zero on the empty path would abort
// every build before it started. The unmatched glob must also not be mistaken
// for a directory named `sidecar.tmp.*`.
test('WI-38368: the sweep is a no-op that does NOT abort the build when there is no residue (set -euo pipefail)', () => {
  assert(SWEEP_FN, 'could not locate __pc_sweep_stale_staging() in build-desktop-sidecar.sh');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-sidecar-sweep-empty-'));
  try {
    const final = path.join(tmp, 'sidecar');
    const script = [
      'set -euo pipefail', // the shipped script's own mode (line 20)
      `SIDECAR_FINAL_DIR=${JSON.stringify(final)}`,
      `SIDECAR_TMP_DIR=${JSON.stringify(`${final}.tmp.999999`)}`,
      SWEEP_FN,
      '__pc_sweep_stale_staging',
      'echo REACHED_NEXT_STATEMENT',
    ].join('\n');

    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, `the empty sweep must not abort the build: ${result.stderr}`);
    assert.match(
      result.stdout,
      /REACHED_NEXT_STATEMENT/,
      'execution must continue past the sweep when there is nothing to reap',
    );
    assert.equal(
      fs.existsSync(`${final}.tmp.*`),
      false,
      'an unmatched glob must never be treated as a real directory',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// FALSIFIABILITY CONTROL for the test above. A guard that has never failed is a
// guard nobody has tested, and the assertions above would pass vacuously if the
// sandbox simply never deleted anything. So run a deliberately-WRONG sweep — the
// blanket `rm -rf sidecar.tmp.*` this fix exists to avoid — through the same
// sandbox and assert it destroys the live build's tree. Kept permanently in the
// test file as a control (never a mutation of the shared tree, which git-sync
// would happily commit mid-probe).
test('WI-38368 control: a BLANKET sweep would eat a live build — proving the pid check is what saves it', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-sidecar-sweep-ctl-'));
  let live = 0;
  try {
    const final = path.join(tmp, 'sidecar');
    const decoy = path.join(tmp, 'build-desktop-sidecar.sh');
    fs.writeFileSync(decoy, 'sleep 30\n');
    live = Number(
      execFileSync('bash', ['-c', 'bash "$1" >/dev/null 2>&1 & echo $!', 'bash', decoy], {
        encoding: 'utf8',
      }).trim(),
    );
    const liveTmp = `${final}.tmp.${live}`;
    fs.mkdirSync(liveTmp);

    const blanket = [
      'set -euo pipefail',
      `SIDECAR_FINAL_DIR=${JSON.stringify(final)}`,
      'rm -rf "$SIDECAR_FINAL_DIR".tmp.*', // the naive implementation
    ].join('\n');
    assert.equal(spawnSync('bash', ['-c', blanket]).status, 0);

    assert.equal(
      fs.existsSync(liveTmp),
      false,
      'control must fail as designed: a blanket sweep DOES delete a live build’s staging dir. If this assertion ever flips, the behavioral test above is passing vacuously.',
    );
  } finally {
    if (live > 1) {
      try {
        process.kill(live, 'SIGKILL');
      } catch {}
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
