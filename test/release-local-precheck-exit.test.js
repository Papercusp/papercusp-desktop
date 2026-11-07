// release-local.sh is NOT a read-only script, and its first ~550 lines read as
// though it is: version validation, channel validation, provenance, submodule
// freshness, migration boot-smoke, build-set completeness. The first statement
// that touches the shared working tree is the version bump, which writes FOUR
// tracked files.
//
// WHY THIS GUARD EXISTS (2026-08-09). An agent verifying preflight guards near
// the top of the script ran it as a probe (`release-local.sh 9.9.9 alpha`),
// expecting an early refusal. Nothing refuses an alpha cut, so it ran on to the
// version bump and stamped 9.9.9 into all four manifests. On this shared tree
// that is not a local mistake:
//
//   * git-sync swept it into a commit inside a minute, so `git status` was
//     clean afterwards — the state in which an edited file and an untouched one
//     are indistinguishable;
//   * every running `tauri dev` watches this same source tree, so the write to
//     src-tauri/tauri.conf.json rebuilt and restarted EVERY desktop on the box,
//     the owner's included. Target-dir isolation does not prevent that — a slot
//     lock guards the generated app-manifest from concurrent writers, not the
//     watched source tree.
//
// The fix is PAPERCUSP_RELEASE_PRECHECK_ONLY=1, which exits after every gate and
// before the first write. This file pins the one property that makes it worth
// anything: THE EXIT IS ABOVE THE FIRST WRITE. An exit that drifts below the
// version bump still prints "nothing has been modified" and is silently a lie —
// the failure would look exactly like success, which is why ordering is checked
// mechanically rather than left to review.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
// The subject is overridable ONLY so falsifiability can be proved against a
// COPY outside the tree (scripts/mutation-probe.sh --file … , the default
// copy-out tier). Mutating the real bin/release-local.sh in place to test this
// guard would be the same class of mistake the guard exists to prevent: on this
// shared checkout git-sync commits the whole tree every few minutes, so a probe
// that holds a mutation for the length of a test run can have it swept into a
// commit even when nothing goes wrong. One line here removes that need.
const SCRIPT = process.env.PROBE_RELEASE_LOCAL || path.join(root, 'bin', 'release-local.sh');
const src = () => fs.readFileSync(SCRIPT, 'utf8');

test('scanner and collector preflight runs both real suites and stops on either failure before costly work', (t) => {
  const text = src();
  const definition = text.match(/^release_verify_contract_regressions\(\) \{\n[\s\S]*?^\}/m)?.[0];
  assert(definition, 'release contract preflight is missing');
  // The suites are launched through release_run_unmanaged (`env -u … "$@"`), so the
  // slice needs the wrapper and the identity list it strips. `env` execs a BINARY from
  // PATH, which bypasses bash-function stubs entirely, so the stubs below are
  // executables on PATH. Stubbing `node`/`npm` as functions used to make the slice die
  // with `release_run_unmanaged: command not found` (WI-6554700010042531).
  const identityList = text.match(/^RELEASE_MANAGED_IDENTITY_ENV=\(\n[\s\S]*?^\)/m)?.[0];
  const wrapper = text.match(/^release_run_unmanaged\(\) \{[^\n]*\n[\s\S]*?^\}/m)?.[0];
  assert(identityList, 'the managed-release identity list (RELEASE_MANAGED_IDENTITY_ENV) is missing');
  assert(wrapper, 'release_run_unmanaged is missing');
  const identity = identityList.split('\n').slice(1, -1).map((l) => l.trim()).filter(Boolean);
  assert(identity.length > 0 && identity.every((n) => /^[A-Z][A-Z0-9_]*$/.test(n)), `unparseable identity list: ${identity}`);
  const call = text.indexOf('\nrelease_verify_contract_regressions || {');
  assert(call > 0 && call < text.indexOf('# Migration-safety gate'), 'contract checks must precede migration replay');
  assert(call < text.indexOf('if [[ "${PAPERCUSP_RELEASE_PRECHECK_ONLY:-0}" == "1" ]]'), 'precheck-only must run contract checks');
  assert.match(definition, /node --test --test-global-setup=test\/monorepo-host-preflight\.mjs/);
  assert.match(definition, /test\/release-gitleaks\.test\.js test\/release-local-linux-reuse\.test\.js/);
  assert.match(definition, /npm run test:file --[\s\S]*packages\/operator-core\/lib\/code-intelligence\/reuse-source-population\.test\.ts/);

  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'release-contract-stubs-'));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  for (const [name, label] of [['node', 'NODE_CHECK'], ['npm', 'WORKER_CHECK']]) {
    fs.writeFileSync(path.join(bin, name), [
      '#!/bin/sh',
      `echo ${label}`,
      `for n in ${identity.join(' ')}; do printenv "$n" >/dev/null && echo "LEAK:$n"; done`,
      `[ "$FAIL_CHECK" != ${name} ]`,
      '',
    ].join('\n'), { mode: 0o755 });
  }
  // A cut exports the live operation's identity to release-local.sh. The child suites
  // must never see it, or their fixtures journal into the LIVE operation
  // (WI-6554700010029592), so every identity variable is set here and must not leak.
  const liveIdentity = Object.fromEntries(identity.map((n) => [n, 'live-operation']));
  for (const [failed, expected] of [['none', 0], ['node', 1], ['npm', 1]]) {
    const command = [
      'set -euo pipefail', 'ROOT=' + JSON.stringify(root),
      'ORCHESTRATOR_HERE=' + JSON.stringify(path.join(root, 'bin')),
      identityList, wrapper, definition,
      'release_verify_contract_regressions || exit 1', 'echo CONTRACTS_PASSED',
    ].join('\n');
    const result = spawnSync('bash', ['-c', command], {
      encoding: 'utf8',
      env: { ...process.env, ...liveIdentity, PATH: `${bin}:${process.env.PATH}`, FAIL_CHECK: failed },
    });
    assert.equal(result.status, expected, result.stderr || result.stdout);
    assert.match(result.stdout, /NODE_CHECK/);
    assert.equal(result.stdout.includes('WORKER_CHECK'), failed !== 'node');
    assert.equal(result.stdout.includes('CONTRACTS_PASSED'), failed === 'none');
    assert.doesNotMatch(result.stdout, /LEAK:/, 'the managed-release identity reached a child suite');
  }
});

test('migration preflight uses private PG for the selected source and preserves failure and identity isolation', (t) => {
  const text = src();
  const start = text.indexOf('if [[ "${PAPERCUSP_SKIP_MIGRATION_BOOTSMOKE:-0}" != "1" ]]');
  const end = text.indexOf('\n# Build-set architecture invariant', start);
  assert(start >= 0 && end > start, 'migration preflight block is missing');
  const block = text.slice(start, end);
  const identityList = text.match(/^RELEASE_MANAGED_IDENTITY_ENV=\(\n[\s\S]*?^\)/m)?.[0];
  const wrapper = text.match(/^release_run_unmanaged\(\) \{[^\n]*\n[\s\S]*?^\}/m)?.[0];
  assert(identityList && wrapper, 'managed identity isolation is missing');
  const identity = identityList.split('\n').slice(1, -1).map((line) => line.trim()).filter(Boolean);
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'release-private-migration-pg-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const selected = path.join(fixture, 'selected-source');
  const desktop = path.join(selected, 'papercusp-desktop');
  const scripts = path.join(selected, 'scripts');
  const sql = path.join(selected, 'libs', 'papercusp', 'libs', 'db', 'sql');
  for (const dir of [desktop, scripts, sql]) fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(path.join(root, '..', 'node_modules'), path.join(selected, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(sql, '000.sql'), '');
  fs.writeFileSync(path.join(sql, '104.sql'), '');
  const receipt = path.join(fixture, 'receipt.json');
  fs.writeFileSync(path.join(scripts, 'with-test-pg.mjs'), [
    "import { spawnSync } from 'node:child_process';",
    "const args = process.argv.slice(process.argv.indexOf('--') + 1);",
    "const child = spawnSync(args[0], args.slice(1), { stdio: 'inherit', env: { ...process.env, PAPERCUSP_TEST_PG_ADMIN_URL: 'postgres://fixture@127.0.0.1:12345/postgres' } });",
    'process.exitCode = child.status ?? 1;',
  ].join('\n'));
  fs.writeFileSync(path.join(scripts, 'test-files.mjs'), [
    "import { writeFileSync } from 'node:fs';",
    'writeFileSync(process.env.FIXTURE_RECEIPT, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), admin: process.env.PAPERCUSP_TEST_PG_ADMIN_URL, hookTimeout: process.env.VITEST_INTEGRATION_HOOK_TIMEOUT_MS, fileTimeout: process.env.PAPERCUSP_TEST_FILE_TIMEOUT_MS, identity: Object.keys(process.env).filter(key => JSON.parse(process.env.FIXTURE_IDENTITY_KEYS).includes(key)) }));',
    'process.exitCode = Number(process.env.FIXTURE_CHILD_EXIT);',
  ].join('\n'));
  const command = ['set -euo pipefail', 'ROOT=' + JSON.stringify(desktop), identityList, wrapper, block].join('\n');
  for (const childExit of [0, 7]) {
    const result = spawnSync('bash', ['-c', command], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...Object.fromEntries(identity.map((name) => [name, 'live-release-operation'])),
        PAPERCUSP_SKIP_MIGRATION_BOOTSMOKE: '0',
        PAPERCUSP_TEST_PG_ADMIN_URL: 'postgres://inherited-shared@127.0.0.1:5432/postgres',
        VITEST_INTEGRATION_HOOK_TIMEOUT_MS: '',
        PAPERCUSP_TEST_FILE_TIMEOUT_MS: '',
        FIXTURE_RECEIPT: receipt,
        FIXTURE_CHILD_EXIT: String(childExit),
        FIXTURE_IDENTITY_KEYS: JSON.stringify(identity),
      },
    });
    assert.equal(result.status, childExit === 0 ? 0 : 1, result.stderr || result.stdout);
    const observed = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    assert.equal(observed.cwd, selected);
    assert.deepEqual(observed.args, [
      'packages/operator-core/lib/release-preflight-migration-boot-smoke.integration.test.ts',
      '--reporter=default',
      '--reporter=hanging-process',
    ]);
    assert.equal(observed.admin, 'postgres://fixture@127.0.0.1:12345/postgres');
    assert.equal(observed.hookTimeout, '180000');
    assert.equal(observed.fileTimeout, '604200');
    assert.deepEqual(observed.identity, []);
    if (childExit !== 0) assert.match(result.stdout, /ERROR: migration boot-smoke failed/);
  }
});

test('release launcher resolves Cargo under a minimal systemd PATH before build preflight', (t) => {
  const text = src();
  const definition = text.match(/^ensure_release_cargo_path\(\) \{\n[\s\S]*?^\}/m)?.[0];
  assert(definition, 'Cargo PATH resolver is missing');
  const call = firstLine(text, /^ensure_release_cargo_path$/);
  const targetClaim = firstLine(text, /^source "\$ORCHESTRATOR_HERE\/lib\/claim-target-dir.sh"$/);
  const metadata = firstLine(text, /^CARGO_TARGET_ROOT="\$\(papercusp_cargo_target_root /);
  assert(call > 0 && call < targetClaim && targetClaim < metadata, 'Cargo must be resolved before release build setup');

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'release-cargo-path-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const home = path.join(fixture, 'home');
  const relocated = path.join(fixture, 'relocated');
  const preferred = path.join(fixture, 'preferred');
  for (const bin of [path.join(home, '.cargo', 'bin'), path.join(relocated, 'bin'), preferred]) {
    fs.mkdirSync(bin, { recursive: true });
  }
  const writeCargo = (bin, name) => {
    const file = path.join(bin, 'cargo');
    fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${name}'\n`, { mode: 0o755 });
    return file;
  };
  writeCargo(path.join(home, '.cargo', 'bin'), 'default');
  writeCargo(path.join(relocated, 'bin'), 'relocated');
  writeCargo(preferred, 'preferred');
  const run = (env) => spawnSync('bash', ['-c', `${definition}\nensure_release_cargo_path || exit $?\ncargo`], {
    encoding: 'utf8',
    env: { HOME: home, PATH: '/usr/bin:/bin', ...env },
  });

  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'default');
  result = run({ CARGO_HOME: relocated });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'relocated');
  result = run({ CARGO_HOME: relocated, PATH: `${preferred}:/usr/bin:/bin` });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'preferred');
  result = run({ CARGO_HOME: path.join(fixture, 'missing') });
  assert.equal(result.status, 12);
  assert.match(result.stderr, /cargo not resolvable/);
});

/** 1-based line index of the first line matching `re`, or -1. */
function firstLine(text, re) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return -1;
}

// The files the version-bump block itself WRITES. Named here so that adding a
// fourth without moving the precheck exit above it is a visible edit to this
// list, not an invisible widening of the blast radius.
//
// Cargo.lock is deliberately NOT in this list, and the distinction is load-
// bearing rather than pedantic: the bump writes three files, and Cargo.lock
// picks the version up LATER, when some cargo invocation re-resolves it from
// Cargo.toml. It still ends up carrying the version — that is how it reached
// 9.9.9 in the incident — but it is downstream of Cargo.toml, not a fourth
// write here. Listing it as one made this very test fail against a correct
// script, which is the sort of false red that gets a guard deleted.
const WRITTEN_MANIFESTS = ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json'];

/** The line of the actual `if` branch — NOT the header comment that names it. */
const PRECHECK_BRANCH = /if \[\[ "\$\{PAPERCUSP_RELEASE_PRECHECK_ONLY:-0\}" == "1" \]\]/;
const PREPARE_TAG_BRANCH = /if \[\[ -n "\$\{PAPERCUSP_RELEASE_PREPARE_TAG_SHA:-\}" \]\]/;
// WI-10004349 / D-112: keep the compatibility preflight call after the optional
// release-identity.env union. The helper no longer requires owner name/email; the
// release-identity-env suite pins that behaviour directly.
const OWNER_IDENTITY_BRANCH = /^papercusp_require_release_owner_identity \|\| exit 2$/;
const OWNER_IDENTITY_UNION = /^papercusp_union_release_identity_env \|\| exit 2$/;

test('the precheck-only exit exists and is reachable', () => {
  const text = src();
  // Anchor on the BRANCH, not on any mention of the variable: the header
  // documents it ~500 lines earlier, so a bare name match lands in a comment
  // and then reports the branch missing when it is present and correct.
  const guard = firstLine(text, PRECHECK_BRANCH);
  assert(guard > 0, 'the PAPERCUSP_RELEASE_PRECHECK_ONLY branch has been removed from bin/release-local.sh');
  assert(
    /exit 0/.test(text.split('\n').slice(guard - 1, guard + 8).join('\n')),
    'the PAPERCUSP_RELEASE_PRECHECK_ONLY branch no longer exits 0',
  );
});

test('the precheck exit is ABOVE the version bump — the first tree write', () => {
  const text = src();
  const guard = firstLine(text, PRECHECK_BRANCH);
  const bump = firstLine(text, /^echo "==> bumping version in manifests"/);

  assert(guard > 0, 'the PAPERCUSP_RELEASE_PRECHECK_ONLY branch was removed or reworded');
  assert(bump > 0, 'the version-bump step was removed or reworded — re-derive what the first tree write now is');
  assert(
    guard < bump,
    `the precheck exit (line ${guard}) is BELOW the version bump (line ${bump}). A precheck run would ` +
      `write the manifests and then claim "nothing has been modified" — a false green that restarts ` +
      `every desktop on the box.`,
  );
});

test('the release-owned prepare-tag operation exits before the first build write', () => {
  const text = src();
  const prepare = firstLine(text, PREPARE_TAG_BRANCH);
  const bump = firstLine(text, /^echo "==> bumping version in manifests"/);
  const branch = text.split('\n').slice(prepare - 1, prepare + 30).join('\n');

  assert(prepare > 0, 'the PAPERCUSP_RELEASE_PREPARE_TAG_SHA branch was removed or reworded');
  assert(prepare < bump, 'prepare-tag drifted below the version bump and can mutate build manifests');
  assert(
    /release_tag_create_exact/.test(branch),
    'prepare-tag no longer routes through the create-only force-with-lease helper',
  );
  assert(/exit \$\?/.test(branch), 'prepare-tag no longer exits immediately after the exact ref operation');
});

test('the version bump really is the first write, and it writes what we think', () => {
  const text = src();
  const bump = firstLine(text, /^echo "==> bumping version in manifests"/);
  // The write USED to be a python heredoc inline below the banner. It is now
  // DELEGATED to a shell function, so a literal window below the banner contains
  // the CALL and none of the writes — which red-pinned this guard on 2026-09-16
  // against a script whose safety property was entirely intact.
  //
  // Follow the indirection rather than widening the window. Widening is the
  // tempting one-character fix and it is the wrong one: it would keep passing if
  // a manifest write genuinely migrated above the precheck exit, which is the one
  // thing this test exists to catch.
  const lines = text.split('\n');
  const window = lines.slice(bump - 1, bump + 40);
  const isDefined = (name) => new RegExp(`^${name}\\(\\) \\{`, 'm').test(text);
  const calledIdx = window.findIndex((l) => {
    const name = /^\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s|$)/.exec(l)?.[1];
    return Boolean(name) && isDefined(name);
  });

  let block;
  if (calledIdx >= 0) {
    const called = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(window[calledIdx])[1];
    const defLine = firstLine(text, new RegExp(`^${called}\\(\\) \\{`));
    const endIdx = lines.findIndex((l, i) => i >= defLine && /^\}/.test(l));
    assert(
      endIdx > 0,
      `could not find the closing brace of ${called}() — this guard can no longer read the write block, ` +
        `which is a broken instrument and must not be read as a pass`,
    );
    block = lines.slice(defLine - 1, endIdx + 1).join('\n');

    // Defining a function writes nothing; the write happens at the CALL. So the
    // ordering property is about the invocation line, and it is asserted here
    // explicitly rather than inferred from the banner sitting beside it.
    const precheck = firstLine(text, PRECHECK_BRANCH);
    const callLine = bump + calledIdx;
    assert(
      precheck > 0 && precheck < callLine,
      `${called} is invoked at line ${callLine}, at or above the precheck exit (${precheck}) — a manifest ` +
        `write can now run before the precheck-only exit`,
    );
  } else {
    block = window.join('\n');
  }
  for (const f of WRITTEN_MANIFESTS) {
    const leaf = f.split('/').pop();
    assert(
      block.includes(leaf),
      `the version bump no longer mentions ${f} — if the set of written files changed, re-check that ` +
        `the precheck exit is still above ALL of them`,
    );
  }
});

test('owner-identity compatibility loading remains before every seed or manifest write', () => {
  const text = src();
  const guard = firstLine(text, OWNER_IDENTITY_BRANCH);
  const bump = firstLine(text, /^echo "==> bumping version in manifests"/);
  const seed = firstLine(text, /^cut_release_seed$/);

  const union = firstLine(text, OWNER_IDENTITY_UNION);

  assert(guard > 0, 'the owner-identity compatibility preflight was removed or reworded');
  assert(
    union > 0 && union < guard,
    `the release-identity.env union (line ${union}) must run before the owner-identity guard (line ${guard}) — ` +
      'the compatibility file must be merged before the stable preflight surface runs',
  );
  assert(guard < bump, `identity compatibility preflight (line ${guard}) drifted below the version bump (line ${bump})`);
  assert(guard < seed, `identity compatibility preflight (line ${guard}) drifted below the seed cut (line ${seed})`);
});

test('the header warns that this script is not read-only', () => {
  // The guard above makes the safe run EXIST; this makes it DISCOVERABLE. The
  // trap was never that the writes were hidden — it was that nothing told the
  // reader to expect them before reaching them.
  const head = src().split('\n').slice(0, 60).join('\n');
  assert(
    /NOT READ-ONLY/i.test(head),
    "release-local.sh's header no longer warns that it writes to the shared tree",
  );
  assert(
    /PAPERCUSP_RELEASE_PRECHECK_ONLY/.test(head),
    "release-local.sh's header no longer names the precheck-only escape hatch",
  );
  assert(
    /PAPERCUSP_RELEASE_PREPARE_TAG_SHA/.test(head),
    "release-local.sh's header no longer discloses the separate remote-tag creation path",
  );
});

test('the dogfood pin verifies the canonical GitHub remote, not the cutter origin', () => {
  const text = src();
  const dogfoodStart = text.indexOf('# ── Dogfood version pin');
  const seedStart = text.indexOf('cut_release_seed');
  assert(dogfoodStart >= 0, 'the dogfood pin section was removed or reworded');
  assert(seedStart > dogfoodStart, 'the dogfood pin section no longer precedes the seed cut');
  const dogfood = text.slice(dogfoodStart, seedStart);

  // The definition is hoisted to the read-only remote-tag precondition above the
  // PRECHECK-ONLY exit, so it must precede its first use — not sit in this section.
  const canonicalDef = text.indexOf('PAPERCUP_DOGFOOD_CANONICAL_REMOTE="https://github.com/Papercusp/papercup"');
  const firstUse = text.indexOf('$PAPERCUP_DOGFOOD_CANONICAL_REMOTE');
  assert(canonicalDef >= 0, 'the dogfood pin no longer names the canonical GitHub remote explicitly');
  assert(
    firstUse > canonicalDef && canonicalDef < dogfoodStart,
    'the canonical GitHub remote is no longer defined before the dogfood pin uses it',
  );
  assert.match(
    dogfood,
    /release_tag_prepare_local_exact "\$MONOREPO" "\$TAG" "\$EXPECTED_SOURCE_SHA" "\$PAPERCUP_DOGFOOD_CANONICAL_REMOTE"/,
    'the dogfood pin no longer passes the canonical remote into tag verification',
  );
});
