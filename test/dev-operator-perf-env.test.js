// WI-7344 (2026-08-03): the desktop's operator is spawned by `npm run dev` via
// dev-operator-ifneeded.sh, NOT by systemd. Every host-level perf fix so far has
// been rolled out as a systemd drop-in on papercup-dev-api.service /
// papercup-staging-api.service — which silently skips this host, the ONE the
// owner actually looks at.
//
// That is exactly how WI-7160 (main-thread stalls from git fork()s, ~40ms of
// blocked event loop per GB of parent RSS) stayed live on the desktop for a day
// after being closed: the fix env vars went into two systemd drop-ins and
// nowhere else. Measured on the owner's live desktop (pid 3129329, 3.68 GB RSS,
// single-process by the CLUSTER=0 pin): /api/health, median 1.7ms, returned
// 2.7-3.2s while a HUD transcript search took 13.5s — a query the same host
// answers in ~0.5s when its event loop is free.
//
// The failure mode this guards is not "someone edits the line below"; it is
// "someone fixes a perf bug in a systemd drop-in and never learns this launcher
// exists". So the assertion is deliberately about the CLASS (the desktop
// launcher carries the same spawn-offload env as the service units), not about
// one string.
//
// Follows the node:test pattern already established for bin/*.sh behavior tests
// (build-desktop-sidecar-lock.test.js, dev-operator-ifneeded-reaper.test.js)
// rather than adding a framework — the four canonical frameworks don't cover
// shell scripts and this side-channel already does.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'bin', 'dev-operator-ifneeded.sh');

test('frozen host diagnostics preserve the actual exec PID and exclude credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'operator diagnostic '));
  try {
    const entry = path.join(dir, 'host entry.js');
    const diagnosticDir = path.join(dir, 'reports');
    fs.writeFileSync(entry, 'console.log(JSON.stringify({pid:process.pid,args:process.execArgv}));\n');
    const src = fs.readFileSync(SCRIPT, 'utf8');
    const start = src.indexOf('DEV_HOST_COMMAND="npx tsx bin/hono-host.ts"');
    const end = src.indexOf("printf -v DEV_OPERATOR_DIR_Q", start);
    const result = spawnSync('bash', ['-c', src.slice(start, end) + '\neval "$DEV_HOST_COMMAND"'], {
      encoding: 'utf8',
      env: { ...process.env, DEV_SOURCE_ROOT: '', PAPERCUSP_DEV_HOST_ENTRY: entry,
        PAPERCUSP_DEV_HOST_DIAGNOSTIC_DIR: diagnosticDir },
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(Number(fs.readFileSync(path.join(diagnosticDir, 'node.pid'), 'utf8')), observed.pid);
    for (const arg of ['--report-on-signal', '--report-signal=SIGUSR2', '--report-exclude-env', '--report-exclude-network']) {
      assert.ok(observed.args.includes(arg), `missing ${arg}`);
    }
    assert.ok(observed.args.includes(`--report-directory=${diagnosticDir}`));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** The spawn-offload vars WI-7160 introduced. Each maps to a git-heavy caller
 *  that fork()s from the operator's main thread; on a single-process host with
 *  multi-GB RSS each fork is charged as synchronous event-loop time. */
const REQUIRED_SPAWN_SIDECAR_VARS = [
  // dev-deploy-state.ts's `git()` — the Deploy panel. Caught live on the
  // owner's desktop issuing `git -C papercusp-release log -1 --format=...`
  // in batches, leaving 20 [git] <defunct> zombies in a 20s sample.
  'PAPERCUSP_DEV_DEPLOY_SPAWN_SIDECAR',
  // system-health/compute.ts's `runGit` — the system-health tick.
  'PAPERCUSP_SYSTEM_HEALTH_SPAWN_SIDECAR',
];

function devCommandLine() {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const line = src.split('\n').find((l) => l.startsWith('DEFAULT_DEV_CMD='));
  assert.ok(
    line,
    'dev-operator-ifneeded.sh no longer defines DEFAULT_DEV_CMD — this guard ' +
      'is asserting against a shape that moved. Re-point it at wherever the ' +
      'desktop operator command is now built, do NOT delete it.',
  );
  return line;
}

test('the desktop operator launcher enables the git spawn sidecar', () => {
  const line = devCommandLine();
  for (const v of REQUIRED_SPAWN_SIDECAR_VARS) {
    assert.match(
      line,
      new RegExp(`\\b${v}=1\\b`),
      `${v}=1 is missing from DEFAULT_DEV_CMD.\n\n` +
        'The desktop operator is NOT a systemd unit, so it inherits nothing ' +
        'from papercup-dev-api.service.d / papercup-staging-api.service.d. ' +
        'Without this var the Deploy-panel / system-health git execs fork from ' +
        "this process's main thread, and on a single-process host at 3-5 GB RSS " +
        'that stalls the whole event loop in multi-second chunks — the HUD ' +
        'search, the SSE stream and every request together (WI-7344).',
    );
  }
});

test('the single-process pin that makes stalls unabsorbable is still in place', () => {
  // Not redundant with the reaper test's coverage: this documents WHY the vars
  // above are load-bearing HERE specifically. If this host ever stops being
  // single-process, a stall gets absorbed by sibling workers and the urgency
  // of the assertion above genuinely drops — so the two facts should move
  // together, and a reader who changes one should see the other.
  const line = devCommandLine();
  assert.match(line, /\bPAPERCUSP_CLUSTER=0\b/);
  assert.match(line, /\bPAPERCUSP_CLUSTER_WORKERS=0\b/);
});

test('every spawn-sidecar var enabled on the service units is also enabled here', () => {
  // The actual class guard. Reads the systemd drop-ins when they are present on
  // this host and asserts the launcher is not BEHIND them. Skips (rather than
  // fails) where the drop-ins do not exist — CI, a fresh clone, a contributor
  // machine — because their absence says nothing about the launcher.
  const dropInDirs = [
    path.join(
      process.env.HOME || '',
      '.config/systemd/user/papercup-dev-api.service.d',
    ),
    path.join(
      process.env.HOME || '',
      '.config/systemd/user/papercup-staging-api.service.d',
    ),
  ].filter((d) => fs.existsSync(d));

  if (dropInDirs.length === 0) return; // nothing to compare against here

  const declared = new Set();
  for (const dir of dropInDirs) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.conf')) continue;
      const body = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const m of body.matchAll(
        /^\s*Environment=(PAPERCUSP_[A-Z0-9_]*SPAWN_SIDECAR)=1\s*$/gm,
      )) {
        declared.add(m[1]);
      }
    }
  }

  const line = devCommandLine();
  const missing = [...declared].filter(
    (v) => !new RegExp(`\\b${v}=1\\b`).test(line),
  );

  assert.deepStrictEqual(
    missing,
    [],
    `These spawn-sidecar vars are enabled on the systemd operator units but ` +
      `NOT on the desktop launcher: ${missing.join(', ')}.\n\n` +
      'That asymmetry is the WI-7344 bug class: a perf fix shipped as a ' +
      'systemd drop-in reaches :3070 and :3170 but never reaches the desktop ' +
      "operator on :3270 — the host the owner's UI actually talks to, and the " +
      'worst case for main-thread fork cost (single-process, multi-GB RSS). ' +
      'Add them to DEFAULT_DEV_CMD in bin/dev-operator-ifneeded.sh.',
  );
});

// host-memory-reduction-2026-09-27 D-027: the glibc arena cap shipped as
// 40-malloc-arena.conf drop-ins (the WI-7344 bug class again), and the :3270
// desktop operator held 1.8 GB in 64 MiB arenas. boot-malloc-arena.ts now
// re-execs an uncapped host, so this pin is about skipping that second exec.
test('the desktop operator launcher caps glibc malloc arenas', () => {
  assert.match(
    devCommandLine(),
    /\bMALLOC_ARENA_MAX=2\b/,
    'DEFAULT_DEV_CMD must set MALLOC_ARENA_MAX=2, matching the systemd ' +
      'operator units, or every desktop boot pays a re-exec in boot-malloc-arena.ts.',
  );
});
