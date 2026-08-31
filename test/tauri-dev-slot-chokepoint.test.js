/**
 * EI-19369470572700441 — every `tauri dev` launcher must claim a target-dir slot.
 *
 * WI-7101 fixed the corruption itself (bin/lib/claim-target-dir.sh) but wired it
 * into exactly ONE caller, leaving "remember to source the helper" as a
 * convention. Three launchers then forgot it — including
 * scripts/verify-tauri-headless.sh, the path root CLAUDE.md tells agents to use
 * for UI verification, so the DOCUMENTED safe practice was launching an
 * unprotected concurrent build against the shared ~/.cargo-target.
 *
 * The fix moved the claim to the `tauri` npm script (bin/tauri-guarded), which
 * every launcher already goes through. The same chokepoint now holds the shared
 * sidecar read lock, so Cargo/build.rs cannot walk a directory during the
 * sidecar's atomic publish. These tests are the recurrence guard for both: one
 * proves the chokepoint actually claims, one proves the sidecar lock blocks a
 * concurrent writer, and one proves nobody has routed around it again.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const {
  mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync, readdirSync, statSync,
  mkdirSync, copyFileSync, existsSync, readlinkSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join, relative } = require('node:path');

const DESKTOP_DIR = join(__dirname, '..');
const REPO_ROOT = join(DESKTOP_DIR, '..');
const GUARD = join(DESKTOP_DIR, 'bin', 'tauri-guarded');
// Overridable so falsifiability can be proven against a COPY of the script, outside the
// tree (scripts/mutation-probe.sh). git-sync commits the whole working tree every few
// minutes, so mutating the real file in place risks committing the mutant — that has
// already happened once here (db6d7b02b1). Defaults to the real path.
const CLAIM = process.env.PROBE_CLAIM_SCRIPT || join(DESKTOP_DIR, 'bin', 'lib', 'claim-target-dir.sh');

/**
 * Run the guard with a stub `tauri` first on PATH, in a sandboxed HOME, and
 * report the CARGO_TARGET_DIR the real CLI would have been exec'd with. Driving
 * the wrapper end-to-end (rather than grepping it) is what makes this a
 * behavioural guard: it fails if the claim stops happening for ANY reason, not
 * just if the source line is deleted.
 */
function runGuard(args) {
  const home = mkdtempSync(join(tmpdir(), 'ei19369470-'));
  const shimDir = mkdtempSync(join(tmpdir(), 'ei19369470-bin-'));
  try {
    const shim = join(shimDir, 'tauri');
    writeFileSync(shim, '#!/usr/bin/env bash\nprintf "%s" "${CARGO_TARGET_DIR:-}"\n');
    chmodSync(shim, 0o755);
    return execFileSync('bash', [GUARD, ...args], {
      env: {
        ...process.env,
        HOME: home,
        CARGO_TARGET_DIR: '',
        PATH: `${shimDir}:${process.env.PATH}`,
        // Routing/claim probes must never wait on a real concurrent release
        // writer. The dedicated contention tests below exercise that behavior.
        PAPERCUSP_SIDECAR_LOCK: join(home, 'sidecar.lock'),
      },
      encoding: 'utf8',
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
  }
}

/**
 * Run the guard with a controllable Tauri exit status and retain stderr. This
 * proves the release message describes the signal path, rather than merely
 * proving that the wrapper reaches a stub CLI.
 */
function runGuardResult(args, tauriScript) {
  const home = mkdtempSync(join(tmpdir(), 'ei20270512-result-home-'));
  const shimDir = mkdtempSync(join(tmpdir(), 'ei20270512-result-bin-'));
  try {
    const shim = join(shimDir, 'tauri');
    writeFileSync(shim, tauriScript);
    chmodSync(shim, 0o755);
    return spawnSync('bash', [GUARD, ...args], {
      env: {
        ...process.env,
        HOME: home,
        CARGO_TARGET_DIR: '',
        PATH: `${shimDir}:${process.env.PATH}`,
        PAPERCUSP_SIDECAR_LOCK: join(home, 'sidecar.lock'),
      },
      encoding: 'utf8',
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
  }
}

/**
 * Exercise finite-command routing against an unmodified copy of the real guard.
 * The copy's sibling wrapper and PATH `tauri` are distinct recorders, so the
 * result proves which branch exec'd and preserves every forwarded argv element.
 */
function runGuardRouting(args) {
  const sandbox = mkdtempSync(join(tmpdir(), 'ei20465840-routing-'));
  const binDir = join(sandbox, 'bin');
  try {
    mkdirSync(binDir, { recursive: true });
    copyFileSync(GUARD, join(binDir, 'tauri-guarded'));
    writeFileSync(
      join(binDir, 'build-deb-repacked.sh'),
      '#!/usr/bin/env bash\nprintf "repack\\n"\nprintf "%s\\n" "$@"\n',
      { mode: 0o755 },
    );
    writeFileSync(
      join(binDir, 'tauri'),
      '#!/usr/bin/env bash\nprintf "direct\\n"\nprintf "%s\\n" "$@"\n',
      { mode: 0o755 },
    );

    const stdout = execFileSync('bash', [join(binDir, 'tauri-guarded'), ...args], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        PAPERCUSP_SIDECAR_LOCK: join(sandbox, 'sidecar.lock'),
      },
      encoding: 'utf8',
    });
    return stdout.trimEnd().split('\n');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

test('the chokepoint claims a target-dir slot for `dev`', () => {
  const targetDir = runGuard(['dev', '--config', '{"build":{"devUrl":"http://127.0.0.1:3070"}}']);
  assert.match(
    targetDir,
    /cargo-target/,
    'the `tauri` npm script must claim a slot before exec-ing the CLI for `dev` — ' +
      'without it a concurrent build corrupts the shared app-manifest (WI-7101)',
  );
});

test('ordinary Tauri success and failure do not claim a SIGUSR1 yield', () => {
  for (const [label, exitCode] of [['success', 0], ['failure', 23]]) {
    const result = runGuardResult(
      ['dev'],
      `#!/usr/bin/env bash\nexit ${exitCode}\n`,
    );
    assert.strictEqual(result.status, exitCode, `${label} exit status must be preserved`);
    assert.doesNotMatch(
      result.stderr,
      /yielded .*waiting sidecar publish \(SIGUSR1\)/,
      `${label} must not report a publish yield when no SIGUSR1 arrived; stderr: ${result.stderr}`,
    );
  }
});

test('the Tauri chokepoint waits for an in-flight sidecar publish before startup reads resources', async (t) => {
  const haveFlock = spawnSync('bash', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;
  if (!haveFlock) {
    t.skip('needs flock(1) for the shared reader/writer lock proof');
    return;
  }

  const home = mkdtempSync(join(tmpdir(), 'ei20227496-home-'));
  const shimDir = mkdtempSync(join(tmpdir(), 'ei20227496-bin-'));
  const lockDir = mkdtempSync(join(tmpdir(), 'ei20227496-lock-'));
  const lock = join(lockDir, 'sidecar.lock');
  const shim = join(shimDir, 'tauri');
  const env = {
    ...process.env,
    HOME: home,
    CARGO_TARGET_DIR: '',
    PATH: `${shimDir}:${process.env.PATH}`,
    PAPERCUSP_SIDECAR_LOCK: lock,
  };
  let holder;
  let guard;
  try {
    writeFileSync(shim, '#!/usr/bin/env bash\nprintf "%s" "${CARGO_TARGET_DIR:-}"\n');
    chmodSync(shim, 0o755);

    // Run the holder in its own process group so teardown releases the lock
    // immediately; killing only `flock` can leave its `sleep` child holding it
    // until the 30-second timeout and make a passing test look hung.
    holder = spawn('flock', ['-x', lock, 'sleep', '30'], { stdio: 'ignore', detached: true });
    const holderDeadline = Date.now() + 3000;
    while (spawnSync('flock', ['-n', lock, '-c', 'true']).status === 0) {
      assert(Date.now() < holderDeadline, 'the test writer never acquired the sidecar lock');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    let stdout = '';
    let stderr = '';
    guard = spawn('bash', [GUARD, 'dev'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    guard.stdout.on('data', (chunk) => { stdout += chunk; });
    guard.stderr.on('data', (chunk) => { stderr += chunk; });

    // Wait for the condition this test claims to exercise, not an assumed
    // scheduler budget. Under the full concurrent node:test suite the child can
    // spend >150ms starting/claiming its isolated target slot; releasing the
    // writer at that fixed instant lets it reach an already-free sidecar lock and
    // falsely fails on a missing wait banner. A bounded banner wait proves the
    // child reached the contended flock before we release it.
    const waitBannerDeadline = Date.now() + 5000;
    while (!/waiting before reading sidecar/.test(stderr) && guard.exitCode === null) {
      assert(Date.now() < waitBannerDeadline, `Tauri never reached the contended sidecar lock; stderr: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(guard.exitCode, null, 'Tauri must remain blocked while the sidecar writer holds the lock');
    assert.match(stderr, /waiting before reading sidecar/);

    try { process.kill(-holder.pid, 'SIGTERM'); } catch {}
    await new Promise((resolve) => holder.once('close', resolve));
    const exitCode = await new Promise((resolve) => guard.once('close', resolve));
    assert.equal(exitCode, 0);
    assert.match(stderr, /waiting before reading sidecar/);
    assert.match(stdout, /cargo-target/);
  } finally {
    if (guard && guard.exitCode === null) guard.kill('SIGTERM');
    if (holder && holder.exitCode === null) {
      try { process.kill(-holder.pid, 'SIGTERM'); } catch {}
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
    rmSync(lockDir, { recursive: true, force: true });
  }
});

test('a long-lived `tauri dev` yields its parent-held sidecar reader lock on SIGUSR1', async (t) => {
  const haveFlock = spawnSync('bash', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;
  if (!haveFlock) {
    t.skip('needs flock(1) for the cooperative reader/writer lock proof');
    return;
  }

  const home = mkdtempSync(join(tmpdir(), 'ei20270512-home-'));
  const shimDir = mkdtempSync(join(tmpdir(), 'ei20270512-bin-'));
  const lockDir = mkdtempSync(join(tmpdir(), 'ei20270512-lock-'));
  const lock = join(lockDir, 'sidecar.lock');
  const shim = join(shimDir, 'tauri');
  const env = {
    ...process.env,
    HOME: home,
    CARGO_TARGET_DIR: '',
    PATH: `${shimDir}:${process.env.PATH}`,
    PAPERCUSP_SIDECAR_LOCK: lock,
  };
  let guard;
  let writer;
  try {
    writeFileSync(shim, '#!/usr/bin/env bash\necho READY\nexec sleep 30\n');
    chmodSync(shim, 0o755);

    let stdout = '';
    let stderr = '';
    guard = spawn('bash', [GUARD, 'dev'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    guard.stdout.on('data', (chunk) => { stdout += chunk; });
    guard.stderr.on('data', (chunk) => { stderr += chunk; });
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`tauri shim never reached startup: ${stdout}`)), 3000);
      guard.stdout.on('data', () => {
        if (stdout.includes('READY')) {
          clearTimeout(deadline);
          resolve();
        }
      });
      guard.once('error', reject);
    });

    writer = spawn('flock', ['-w', '2', '-x', lock, '-c', 'true'], { stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(writer.exitCode, null, 'the writer must wait while the startup reader is still held');

    process.kill(guard.pid, 'SIGUSR1');
    const writerExit = await new Promise((resolve) => writer.once('close', resolve));
    assert.equal(writerExit, 0, 'the writer must acquire the lock after the cooperative yield');
    assert.match(stderr, /yielded .*waiting sidecar publish \(SIGUSR1\)/);
    assert.equal(guard.exitCode, null, 'yielding the lock must not terminate the long-lived dev child');
  } finally {
    if (writer && writer.exitCode === null) writer.kill('SIGTERM');
    if (guard && guard.exitCode === null) {
      guard.kill('SIGTERM');
      await new Promise((resolve) => guard.once('close', resolve));
    }
    rmSync(home, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
    rmSync(lockDir, { recursive: true, force: true });
  }
});

test('the sidecar writer bounds its wait and identifies cooperative readers', () => {
  const builder = readFileSync(join(DESKTOP_DIR, 'bin', 'build-desktop-sidecar.sh'), 'utf8');
  const windowsBuilder = readFileSync(join(DESKTOP_DIR, 'bin', 'build-windows-cross.sh'), 'utf8');
  const helper = readFileSync(join(DESKTOP_DIR, 'bin', 'lib', 'sidecar-lock-yield.sh'), 'utf8');
  assert.match(helper, /SIDECAR_LOCK_WAIT="\$\{PAPERCUSP_SIDECAR_LOCK_WAIT_SEC:-60\}"/);
  assert.match(helper, /flock -w "\$SIDECAR_LOCK_WAIT" 9/);
  assert.match(helper, /PAPERCUSP_SIDECAR_READER_YIELD_AFTER_SEC/);
  assert.match(helper, /kill -USR1/);
  assert.match(helper, /tauri-guarded/);
  assert.match(helper, /holder context follows/);
  assert.match(builder, /source "\$HERE\/lib\/sidecar-lock-yield\.sh"/);
  assert.match(windowsBuilder, /source "\$HERE\/lib\/sidecar-lock-yield\.sh"/);
  assert.match(windowsBuilder, /__pc_acquire_sidecar_flock "\$SRC_TAURI\/sidecar\.lock"/);
});

test('generic build and bundle commands capable of emitting deb route through the repacker', () => {
  assert.deepStrictEqual(
    runGuardRouting(['build']),
    ['repack', '--tauri-subcommand=build', '--all-bundles'],
    'an unfiltered generic build inherits deb from the base config and must preserve all outputs while repacking it',
  );
  assert.deepStrictEqual(
    runGuardRouting(['--verbose', 'bundle']),
    ['repack', '--tauri-subcommand=bundle', '--all-bundles', '--verbose'],
    'bundle is a second Debian producer, and flags before the subcommand must survive routing',
  );
  assert.deepStrictEqual(
    runGuardRouting(['build', '--bundles', 'rpm,deb', '--debug']),
    ['repack', '--tauri-subcommand=build', '--bundles', 'rpm,deb', '--debug'],
    'a comma-separated list containing deb must be preserved exactly rather than narrowed or duplicated',
  );
  assert.deepStrictEqual(
    runGuardRouting(['bundle', '-b', 'rpm', 'deb', '--ci']),
    ['repack', '--tauri-subcommand=bundle', '-b', 'rpm', 'deb', '--ci'],
    'Tauri also accepts short, space-separated multi-value bundle filters',
  );
  assert.deepStrictEqual(
    runGuardRouting(['bundle', '-brpm,deb', '--ci']),
    ['repack', '--tauri-subcommand=bundle', '-brpm,deb', '--ci'],
    'clap accepts compact -bVALUE filters; a compact list containing deb is still a producer',
  );
});

test('explicit non-Debian filters and --no-bundle remain direct Tauri invocations', () => {
  assert.deepStrictEqual(
    runGuardRouting(['build', '--bundles', 'rpm', 'appimage']),
    ['direct', 'build', '--bundles', 'rpm', 'appimage'],
  );
  assert.deepStrictEqual(
    runGuardRouting(['bundle', '--bundles=appimage,rpm']),
    ['direct', 'bundle', '--bundles=appimage,rpm'],
  );
  assert.deepStrictEqual(
    runGuardRouting(['build', '-brpm']),
    ['direct', 'build', '-brpm'],
    'a compact explicit non-Debian filter must not be mistaken for an unfiltered producer',
  );
  assert.deepStrictEqual(
    runGuardRouting(['build', '--no-bundle']),
    ['direct', 'build', '--no-bundle'],
    'routing a no-bundle compile would make the wrapper wait for an artifact the caller explicitly disabled',
  );
  assert.strictEqual(
    runGuard(['build', '--bundles', 'appimage']),
    '',
    'finite commands must retain their existing target-dir isolation; only dev claims a slot',
  );
});

test('flags before the subcommand do not hide it from the guard', () => {
  assert.match(runGuard(['--verbose', 'dev']), /cargo-target/);
});

/** Every file that could plausibly launch tauri: the shell entrypoints + npm scripts. */
function launcherFiles() {
  const files = [];
  for (const dir of [join(DESKTOP_DIR, 'bin'), join(REPO_ROOT, 'scripts')]) {
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      if (!statSync(full).isFile()) continue;
      files.push(full);
    }
  }
  return files;
}

test('no launcher routes around the chokepoint with a bare `tauri dev`', () => {
  const offenders = [];

  for (const file of launcherFiles()) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    text.split('\n').forEach((line, i) => {
      // Comments and docs discuss `tauri dev` constantly — only real invocations count.
      // Quoted spans go too: these scripts pass "tauri dev exited before the bridge
      // came up" to their diagnostics, and a guard that cries wolf on error prose is
      // one somebody eventually deletes. An invocation is unquoted by construction
      // (`tauri dev --config '{...}'` keeps its command words outside the quotes).
      // `#` is only HALF the comment syntax in scope. launcherFiles() scans `<repo>/scripts`,
      // which is overwhelmingly `.mjs` — so a JavaScript `//` comment discussing `tauri dev`
      // was read as executable code and reported as an offender (WI-1759397: a comment added
      // to scripts/affected-tests.mjs on 2026-08-31 red @papercusp/desktop::test, and with it
      // the affected radius of every unrelated change touching this workspace — exactly the
      // cries-wolf failure the note above warns about, arriving through the dialect it did
      // not cover). Anchored `^\s*` like the `#` rule, so a real invocation sharing a line
      // with a trailing comment is still caught rather than silently stripped away.
      const code = line
        .replace(/^\s*#.*$/, '')
        .replace(/^\s*\/\/.*$/, '')
        .replace(/'[^']*'/g, "''")
        .replace(/"[^"]*"/g, '""');
      if (!/\btauri\s+dev\b/.test(code)) return;
      // `npm run tauri -- dev` (and `npm run tauri dev`) IS the chokepoint.
      if (/npm\s+run\s+tauri\b/.test(code)) return;
      offenders.push(`${relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
  }

  // npm scripts are launchers too — dev:hmr was one of the three original bypassers.
  for (const pkgPath of [join(DESKTOP_DIR, 'package.json'), join(REPO_ROOT, 'package.json')]) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
      continue;
    }
    for (const [name, body] of Object.entries(pkg.scripts ?? {})) {
      if (typeof body !== 'string') continue;
      if (!/\btauri\s+dev\b/.test(body)) continue;
      if (/npm\s+run\s+tauri\b/.test(body)) continue;
      offenders.push(`${relative(REPO_ROOT, pkgPath)} scripts.${name}: ${body}`);
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    'these launch `tauri dev` without going through `npm run tauri` (bin/tauri-guarded), ' +
      'so they claim no target-dir slot and can corrupt a concurrent build\'s generated ' +
      'app-manifest — WI-7101 / EI-19369470572700441. Route them through `npm run tauri -- dev`:\n' +
      offenders.join('\n'),
  );
});

/* -------------------------------------------------------------------------- *
 * WI-37452 — the claim must decide on the PROPERTY (is a desktop running out of
 * this dir?), never on an argv spelling.
 *
 * The original check was `pgrep -af '[t]auri dev'`. npm rewrites its process
 * title from `npm run tauri -- dev …` to `npm run tauri dev …`, so that pattern
 * matched the wrapper's OWN ANCESTOR on every direct launch — and any peer
 * agent's shell that had merely typed the string. Bracketing `[t]auri` guards
 * the pgrep's own argv only, never an ancestor's.
 *
 * Two failure directions, so both are pinned below:
 *   - warn-on-a-self-match (what shipped): a scary "a desktop build is already
 *     running" advisory on launches where nothing else was running at all.
 *   - ISOLATE-on-a-self-match (the fix originally proposed for this bug, and the
 *     more expensive mistake): every direct `npm run tauri -- dev` abandons the
 *     warm shared cache for a COLD ~10min build, forever, for a phantom peer.
 * -------------------------------------------------------------------------- */

const HAVE_FUSER = spawnSync('bash', ['-c', 'command -v fuser'], { encoding: 'utf8' }).status === 0;
const CAN_PROBE = HAVE_FUSER && existsSync('/proc/self/exe') && existsSync('/bin/sleep');
const NO_PROBE_REASON = 'needs Linux /proc + fuser(1) + /bin/sleep to stage a running desktop';

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Source the claim in a sandboxed HOME, optionally under an ancestor renamed the way npm renames itself. */
function claimIn(home, { ancestorTitle } = {}) {
  const inner = `. ${shq(CLAIM)}; printf '%s' "\${CARGO_TARGET_DIR:-}"`;
  const cmd = ancestorTitle ? `exec -a ${shq(ancestorTitle)} bash -c ${shq(inner)}` : inner;
  const res = spawnSync('bash', ['-c', cmd], {
    env: { ...process.env, HOME: home, CARGO_TARGET_DIR: '' },
    encoding: 'utf8',
  });
  return { targetDir: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/**
 * Stage a real process executing out of `<home>/.cargo-target/debug/papercusp-desktop`
 * while holding NO slot lock — i.e. a desktop whose launcher was reaped.
 *
 * Readiness is confirmed by reading /proc/<pid>/exe, deliberately a DIFFERENT
 * mechanism from the fuser probe under test: gating on the probe itself would
 * make the assertion circular.
 */
function startOrphanedDesktop(home) {
  const dir = join(home, '.cargo-target', 'debug');
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, 'papercusp-desktop');
  copyFileSync('/bin/sleep', bin);
  chmodSync(bin, 0o755);
  const child = spawn(bin, ['30'], { stdio: 'ignore' });
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      if (readlinkSync(`/proc/${child.pid}/exe`).startsWith(bin)) return child;
    } catch { /* not exec'd yet */ }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error('staged desktop never reached exec');
    }
    spawnSync('sleep', ['0.05']);
  }
}

test('an ancestor titled the way npm titles itself is NOT mistaken for a peer desktop', () => {
  const home = mkdtempSync(join(tmpdir(), 'wi37452-self-'));
  try {
    const { targetDir, stderr } = claimIn(home, {
      // npm's real rewrite of `npm run tauri -- dev --config '{…}'`.
      ancestorTitle: 'npm run tauri dev --config {"build":{"devUrl":"http://127.0.0.1:3270"}}',
    });
    assert.strictEqual(
      targetDir,
      join(home, '.cargo-target'),
      'nothing was running, so the launch must keep the warm shared slot 0 — isolating here ' +
        'would pay a COLD build on every direct `npm run tauri -- dev` because the check matched ' +
        'its own ancestor (WI-37452)',
    );
    assert.doesNotMatch(
      stderr,
      /already running|holds NO slot lock/,
      'no peer desktop existed; warning about one trains everybody to ignore the warning that matters',
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a desktop still RUNNING out of a slot is not handed that slot, even with its lock free', { skip: CAN_PROBE ? false : NO_PROBE_REASON }, () => {
  const home = mkdtempSync(join(tmpdir(), 'wi37452-orphan-'));
  let child;
  try {
    child = startOrphanedDesktop(home);

    const claimed = claimIn(home);
    assert.strictEqual(
      claimed.targetDir,
      join(home, '.cargo-target-dev2'),
      'the slot lock only proves a LAUNCHER is alive — it is held by npm/the tauri CLI and the app ' +
        'never inherits it, so an orphaned desktop keeps running in a slot the flock reports free. ' +
        'Building into it is the WI-7101 corruption path',
    );
    assert.match(claimed.stderr, /slot 0 SKIPPED/, 'the skip must say why, at the moment it happens');

    // Not sticky: once the orphan is gone the warm shared slot must come back, or every
    // box drifts permanently onto cold slots after the first orphan it ever sees.
    child.kill('SIGKILL');
    const deadline = Date.now() + 5000;
    while (existsSync(`/proc/${child.pid}`) && Date.now() < deadline) spawnSync('sleep', ['0.05']);

    assert.strictEqual(
      claimIn(home).targetDir,
      join(home, '.cargo-target'),
      'the shared slot must be reclaimable once nothing is running out of it',
    );
  } finally {
    child?.kill('SIGKILL');
    rmSync(home, { recursive: true, force: true });
  }
});

test('the `tauri` npm script is still wired to the guard', () => {
  const pkg = JSON.parse(readFileSync(join(DESKTOP_DIR, 'package.json'), 'utf8'));
  assert.match(
    pkg.scripts.tauri,
    /tauri-guarded/,
    'every launcher reaches the slot claim through this one script — unwiring it ' +
      'silently unprotects all of them at once',
  );
});
