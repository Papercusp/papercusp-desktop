// The vm-release vulnerability leg gates on High/Critical with failClosed:true — and until
// 2026-08-31 it did so over an SBOM that contained ZERO npm packages, which is the largest
// ecosystem in the bundle by a wide margin.
//
// WHY THIS GUARD EXISTS (EI-21925061645614369). audit-release-bundle.py built its SBOM with a
// bare `syft dir:<root>`. A `dir:` source selects the catalogers tagged `directory`, and in
// syft 1.51 the javascript catalogers are split across two tags:
//
//     javascript-lock-cataloger      declared, deno, DIRECTORY, javascript, node, npm
//     javascript-package-cataloger   IMAGE, installed, javascript, node
//
// The lock cataloger reads package-lock.json. A release bundle ships node_modules/ with NO
// lockfile at the extracted root, so the only cataloger that could see the installed packages
// is image-tagged and never ran. Measured on the published r14 bundle: 298 SBOM components,
// 284 of them golang, ZERO npm — over an extracted tree containing 313 package.json files —
// and the leg exited 0 and wrote `status: "green", gatedMatches: 0`.
//
// That bundle was baked into the live 0.0.18 workspace-host candidate and carries 26
// at/above-high npm findings, one of them Critical (form-data@4.0.0, GHSA-fjxv-7rqg-78g4).
// The only reason anyone knew is that a DIFFERENT scanner — the GCP image scan, later and at
// cloud cost — caught it by path attribution and arrived at the same 26.
//
// Nothing errored. A gate that cannot see a population does not report "unknown"; it reports
// clean. That is the specific hazard this file pins, and it is the same rule the audited
// script already states in its own header — "a scan that inspects nothing is
// indistinguishable from a scan that found nothing" — simply never applied to the
// vulnerability leg.
//
// TWO PROPERTIES ARE PINNED HERE, and the second is the load-bearing one:
//
//   1. the syft invocation selects the installed-package cataloger; and
//   2. the npm COVERAGE ASSERTION exists, fails CLOSED, and sits ABOVE the grype invocation.
//
// (1) alone is one upstream cataloger retag away from silently regressing to exactly the
// broken state, and the regression would again look like a clean build. (2) is what converts
// that from a silent green into a loud refusal, which is why its ORDER relative to grype is
// checked mechanically rather than left to review: an assertion that runs after the verdict
// has already been computed protects nothing.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
// Overridable ONLY so falsifiability can be proved against a COPY outside the tree
// (scripts/mutation-probe.sh --file …, the default copy-out tier). Mutating the real
// bin/audit-release-bundle.py in place to test this guard would be the same class of mistake
// the guard exists to prevent: on this shared checkout git-sync commits the whole tree every
// few minutes, so a probe holding a mutation for the length of a test run can have it swept
// into a commit even when nothing goes wrong and no handler fails.
const SCRIPT =
  process.env.PROBE_AUDIT_RELEASE_BUNDLE || path.join(root, 'bin', 'audit-release-bundle.py');
const src = () => fs.readFileSync(SCRIPT, 'utf8');

function cachePreflight(t, { explicit = false, obstruction = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grype-cache-preflight-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bin = path.join(tmp, 'bin');
  const cacheHome = path.join(tmp, '.cache');
  const cacheLink = path.join(cacheHome, explicit ? 'custom-grype' : 'grype');
  const target = path.join(tmp, 'removed-offload', 'grype');
  fs.mkdirSync(bin);
  fs.mkdirSync(cacheHome);
  fs.symlinkSync(target, cacheLink, 'dir');
  if (obstruction) {
    fs.mkdirSync(path.dirname(target));
    fs.writeFileSync(target, 'keep this file');
  }
  const calls = path.join(tmp, 'calls');
  fs.writeFileSync(path.join(bin, 'syft'), '#!/bin/sh\nprintf \'{"version":"test"}\\n\'\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'grype'), [
    '#!/bin/sh',
    'cache="${GRYPE_DB_CACHE_DIR:-$HOME/.cache/grype/db}"',
    'case "$1:$2" in',
    '  db:update) test -d "$cache" || exit 13; echo update >> "$CACHE_TEST_CALLS" ;;',
    '  db:status) test -d "$cache" || exit 14; echo status >> "$CACHE_TEST_CALLS"; printf \'{"valid":true,"built":"%s"}\\n\' "$CACHE_TEST_NOW" ;;',
    '  version:-o) printf \'{"version":"test"}\\n\' ;;',
    '  *) exit 15 ;;',
    'esac',
    '',
  ].join('\n'), { mode: 0o755 });
  const env = { ...process.env, HOME: tmp, PATH: `${bin}:${process.env.PATH}`, XDG_CACHE_HOME: cacheHome,
    CACHE_TEST_CALLS: calls, CACHE_TEST_NOW: new Date().toISOString() };
  delete env.GRYPE_DB_CACHE_DIR;
  if (explicit) env.GRYPE_DB_CACHE_DIR = path.join(cacheLink, 'db');
  const result = spawnSync('python3', [SCRIPT, '--preflight-vulnerabilities', '--refresh-db'],
    { env, encoding: 'utf8', timeout: 15_000 });
  return { result, target, calls };
}

test('vulnerability preflight restores a removed symlink target before refreshing the DB', (t) => {
  for (const explicit of [false, true]) {
    const { result, target, calls } = cachePreflight(t, { explicit });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.statSync(path.join(target, 'db')).isDirectory());
    assert.equal(fs.readFileSync(calls, 'utf8'), 'update\nstatus\n');
    assert.match(result.stdout, /VULNERABILITY TOOLS READY/);
  }
});

test('vulnerability preflight refuses an obstructing file without deleting it or invoking Grype', (t) => {
  const { result, target, calls } = cachePreflight(t, { obstruction: true });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /AUDIT ERROR: grype cache directory/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep this file');
  assert.equal(fs.existsSync(calls), false);
});

function bootstrapProbe(mode) {
  // Exercise the production preflight with a simulated 310s updater. Sleeping
  // for five minutes would obscure the budget regression rather than test it.
  const probe = [
    'import io, json, os, runpy, sys, tempfile, types',
    'ns = runpy.run_path(sys.argv[1])',
    'mode = sys.argv[2]; calls = []; state = {"killed": False}',
    'class Process:',
    '    def __init__(self, command, **kwargs):',
    '        calls.append({"operation": "update", "argv": command[1:], "hash": kwargs["env"]["GRYPE_DB_VALIDATE_BY_HASH_ON_START"], "log": kwargs["env"]["GRYPE_LOG_LEVEL"]})',
    '        self.stdout = io.StringIO("[0000] INFO downloading new vulnerability DB\\n[0111] INFO downloaded vulnerability DB\\n[0111] DEBUG applying DB migrations\\n[0309] DEBUG moved database directory to activate\\n")',
    '    def wait(self, timeout=None):',
    '        if timeout is not None:',
    '            calls.append({"operation": "bootstrap-wait", "timeout": timeout})',
    '            if timeout < 310 or mode == "timeout":',
    '                raise ns["subprocess"].TimeoutExpired("grype db update", timeout)',
    '        return -9 if state["killed"] else 1 if mode == "failed-stale" else 0',
    '    def kill(self): state["killed"] = True',
    'def run(command, **kwargs):',
    '    is_db = command[1:3] == ["db", "status"]',
    '    calls.append({"operation": "status" if is_db else "version", "timeout": kwargs["timeout"], "autoUpdate": kwargs["env"]["GRYPE_DB_AUTO_UPDATE"], "hash": kwargs["env"]["GRYPE_DB_VALIDATE_BY_HASH_ON_START"]})',
    '    value = {"version": "test"}',
    '    if is_db:',
    '        built = ns["datetime"].now(ns["timezone"].utc)',
    '        if mode == "failed-stale":',
    '            from datetime import timedelta',
    '            built -= timedelta(hours=73)',
    '        value = {"valid": not state["killed"], "built": built.isoformat()}',
    '    return types.SimpleNamespace(returncode=0, stdout=json.dumps(value), stderr="")',
    'ns["subprocess"].Popen = Process',
    'ns["subprocess"].run = run',
    'ns["shutil"].which = lambda name: "/test/" + name',
    'with tempfile.TemporaryDirectory() as cache:',
    '    os.environ["GRYPE_DB_CACHE_DIR"] = cache',
    '    os.environ["GRYPE_DB_VALIDATE_BY_HASH_ON_START"] = "false"',
    '    code = ns["preflight_vulnerabilities"](["--refresh-db"])',
    'print(json.dumps({"code": code, "calls": calls, **state}))',
  ].join('\n');
  const result = spawnSync('python3', ['-c', probe, SCRIPT, mode], {
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return { result, measured: JSON.parse(result.stdout.trim().split('\n').at(-1)) };
}

test('Grype cold bootstrap can exceed the metadata deadline and reports real phase boundaries', () => {
  const { result, measured } = bootstrapProbe('slow-success');
  assert.equal(measured.code, 0, result.stderr);
  assert.equal(measured.killed, false);
  assert.deepEqual(measured.calls.map((c) => c.timeout).filter((x) => x !== undefined),
    [1800, 60, 60, 300]);
  const update = measured.calls.find((c) => c.operation === 'update');
  assert.deepEqual(update.argv, ['db', 'update']);
  assert.equal(update.hash, 'true');
  assert.equal(update.log, 'debug');
  assert.ok(measured.calls.filter((c) => c.operation !== 'bootstrap-wait')
    .every((c) => c.hash === 'true'));
  const events = result.stderr.split('\n').filter((s) => s.startsWith('GRYPE_DB_BOOTSTRAP '))
    .map((s) => JSON.parse(s.slice('GRYPE_DB_BOOTSTRAP '.length)));
  assert.deepEqual(events.filter((e) => e.outcome === 'started').map((e) => e.phase),
    ['check', 'download-extract', 'import', 'activate']);
  assert.ok(events.every((e) => e.elapsedSeconds >= 0));
  assert.equal(events.at(-1).diagnosticsComplete, true);
  assert.match(events[0].extractionTiming, /included-in-download-extract/);
  assert.match(result.stdout, /VULNERABILITY TOOLS READY/);
});

test('Grype bootstrap timeout kills its child and cannot admit an invalid partial DB', () => {
  const { result, measured } = bootstrapProbe('timeout');
  assert.equal(measured.code, 2);
  assert.equal(measured.killed, true);
  assert.match(result.stderr, /"outcome": "timeout"/);
  assert.match(result.stderr, /grype DB reports valid != true/);
  assert.doesNotMatch(result.stdout, /VULNERABILITY TOOLS READY/);
});

test('a failed Grype bootstrap still checks freshness and rejects a stale cached DB', () => {
  const { result, measured } = bootstrapProbe('failed-stale');
  assert.equal(measured.code, 2);
  assert.match(result.stderr, /"outcome": "failed"/);
  assert.match(result.stderr, /maximum is 72h/);
  assert.doesNotMatch(result.stdout, /VULNERABILITY TOOLS READY/);
});

/** 1-based line index of the first line matching `re`, or -1. */
function firstLine(text, re) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return -1;
}

test('the syft SBOM selects the installed-package cataloger', () => {
  const text = src();
  const line = firstLine(text, /--select-catalogers/);
  assert.notEqual(
    line,
    -1,
    'audit-release-bundle.py passes no --select-catalogers to syft. A bare `syft dir:` selects ' +
      'only the directory-tagged catalogers, and the javascript one among those reads ' +
      'package-lock.json — which a release bundle does not ship. The SBOM will contain zero npm ' +
      'packages and the High/Critical gate will return green over whatever npm ships.',
  );
  assert.match(
    text,
    /\+javascript-package-cataloger/,
    'the installed-package cataloger is not selected by name. It is the only cataloger that ' +
      'reads node_modules/*/package.json, and it is image-tagged, so a dir: source never picks ' +
      'it up on its own.',
  );
  // The `+` prefix ADDS to the default set. Replacing the set instead would silently drop the
  // golang/binary coverage that currently supplies 284 of the SBOM's components — trading one
  // blind spot for another, and the resulting green would look identical.
  assert.match(
    text,
    /"\+javascript-package-cataloger"/,
    'the cataloger must be added with a leading + rather than replacing the default set, or ' +
      'binary/golang coverage is lost.',
  );
});

test('a blind SBOM cannot reach a verdict: the npm coverage assertion fails closed, above grype', () => {
  const text = src();

  const assertionLine = firstLine(text, /SBOM catalogued 0 npm packages/);
  assert.notEqual(
    assertionLine,
    -1,
    'the npm coverage assertion is gone. Without it, an upstream cataloger retag re-blinds the ' +
      'leg silently and the build goes green — the exact 2026-08-31 failure.',
  );

  const grypeLine = firstLine(text, /\[\s*grype\s*,\s*f?["']sbom:/);
  assert.notEqual(grypeLine, -1, 'could not locate the grype invocation to order against');

  assert.ok(
    assertionLine < grypeLine,
    `the npm coverage assertion (line ${assertionLine}) must run BEFORE grype scans the SBOM ` +
      `(line ${grypeLine}). Below it, the verdict is already computed from a blind SBOM and the ` +
      'assertion is decoration.',
  );

  // Fails CLOSED. A warning here is a green build with a note nobody reads, and the whole point
  // is that this leg's failure mode is indistinguishable from success.
  const tail = text.slice(text.indexOf('SBOM catalogued 0 npm packages'));
  const returnLine = tail.slice(0, 1200).match(/return\s+2/);
  assert.ok(
    returnLine,
    'the coverage assertion does not `return 2` (unscannable). It must refuse, not warn: an ' +
      'unscannable bundle is not a clean one.',
  );
});

test('the expectation is derived from the tree, not from a hardcoded package count', () => {
  const text = src();
  // The assertion must ask the ARTIFACT how many npm packages it contains and compare against
  // what the SBOM caught. A constant expectation rots the moment the bundle's contents change,
  // and rots toward passing.
  assert.match(
    text,
    /node_modules/,
    'the coverage assertion should count installed package directories on disk',
  );
  assert.match(
    text,
    /pkg:npm\//,
    'the coverage assertion should count npm components in the SBOM by purl, so the comparison ' +
      'is between two measurements of the same artifact rather than against a constant',
  );
});
