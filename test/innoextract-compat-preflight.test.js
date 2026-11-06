'use strict';

// EI-20977281692677413: the Windows producer emits Inno Setup 6.7 installers,
// while the distro innoextract may only understand older loader revisions. The
// release must prove the exact producer/consumer pair before cargo-xwin, and the
// artifact audit must use the same explicitly selected extractor.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const builder = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');
const audit = fs.readFileSync(path.join(root, 'bin/audit-release-bundle.py'), 'utf8');
const helperPath = path.join(root, 'bin/lib/innoextract-compat-preflight.sh');
const helper = fs.readFileSync(helperPath, 'utf8');

test('maintained upstream checksum patch has well-formed hunk lengths', () => {
  for (const name of ['innoextract-verification-metadata.patch', 'innoextract-disk-slice-header.patch']) {
    const lines = fs.readFileSync(path.join(root, 'bin/lib', name), 'utf8').trimEnd().split('\n');
    let hunks = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const header = /^@@ -\d+,(\d+) \+\d+,(\d+) @@/.exec(lines[i]);
      if (!header) continue;
      let end = i + 1;
      while (end < lines.length && !/^(?:@@|--- a\/)/.test(lines[end])) end += 1;
      const body = lines.slice(i + 1, end);
      assert.equal(body.filter((line) => /^[ -]/.test(line)).length, Number(header[1]));
      assert.equal(body.filter((line) => /^[ +]/.test(line)).length, Number(header[2]));
      hunks += 1;
    }
    assert.ok(hunks > 0, 'an empty patch is not a repair');
  }
});

test('a sourced current Windows producer keeps frozen source paths but loads current helpers', (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-win-producer-routing-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const current = path.join(sandbox, 'current producer');
  const frozen = path.join(sandbox, 'frozen target');
  const preludeEnd = builder.indexOf('\nTARGET=');
  assert.ok(preludeEnd > 0, 'the executable producer prelude must precede TARGET');
  const prelude = builder.slice(0, preludeEnd);
  const libraries = [...prelude.matchAll(/source "\$HERE\/lib\/([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(libraries.includes('innoextract-compat-preflight.sh'));

  // Execute the actual producer prelude, stopping before any build or host
  // mutation. Both roots contain readable helpers: loading the stale one is a
  // wrong-answer failure, not a missing-file failure that could mask routing.
  for (const [directory, marker] of [[current, 'current'], [frozen, 'stale']]) {
    fs.mkdirSync(path.join(directory, 'bin/lib'), { recursive: true });
    // The executable prelude also invokes this maintained JavaScript guard.
    fs.copyFileSync(path.join(root, 'bin/lib/spa-freshness.js'),
      path.join(directory, 'bin/lib/spa-freshness.js'));
    for (const library of libraries) {
      let body = '# fixture helper\n';
      if (library === 'release-host.sh') body += 'load_release_host() { :; }\n';
      if (library === 'innoextract-compat-preflight.sh') {
        body += `innoextract_compat_preflight() { printf '%s\\n' '${marker}'; }\n`;
      }
      fs.writeFileSync(path.join(directory, 'bin/lib', library), body);
    }
  }
  const producer = path.join(current, 'bin/build-windows-cross.sh');
  const targetEntrypoint = path.join(frozen, 'bin/build-windows-cross.sh');
  fs.writeFileSync(targetEntrypoint, '# frozen source entrypoint\n');
  fs.writeFileSync(
    producer,
    `${prelude}\nprintf '%s\\n' "$HERE" "$ROOT" "$SRC_TAURI" "$(innoextract_compat_preflight)"\n}\n`,
  );
  const run = (entrypoint) => execFileSync(
    'bash',
    ['-c', 'source "$1"', entrypoint, producer],
    { encoding: 'utf8' },
  ).trim().split('\n');

  assert.deepEqual(run(producer), [
    path.join(current, 'bin'), current, path.join(current, 'src-tauri'), 'current',
  ], 'ordinary invocation must retain the current source and helpers');
  assert.deepEqual(run(targetEntrypoint), [
    path.join(current, 'bin'), frozen, path.join(frozen, 'src-tauri'), 'current',
  ], 'exact-source invocation must not load the frozen helper or move the source root');
});

test('Windows builds isolate the runtime Wine prefix and clean only prefixes they own', (t) => {
  const extractFunction = (name) => builder.match(
    new RegExp('^' + name + '\\(\\) \\{[\\s\\S]*?^\\}', 'm'),
  )?.[0];
  const prepare = extractFunction('prepare_wine_inno_prefix');
  const cleanup = extractFunction('cleanup_wine_inno_prefix');
  assert.ok(prepare, 'the Windows producer must define its Wine prefix selection');
  assert.ok(cleanup, 'the Windows producer must define owned-prefix cleanup');
  assert.ok(
    builder.indexOf('trap cleanup_wine_inno_prefix_on_exit EXIT')
      < builder.indexOf('innoextract_compat_preflight "${PAPERCUSP_INNOEXTRACT:-}"'),
    'the private prefix cleanup trap must be active before the real Inno probe',
  );

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-inno-prefix-isolation-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const home = path.join(sandbox, 'home');
  const temp = path.join(sandbox, 'tmp');
  const bin = path.join(sandbox, 'bin');
  fs.mkdirSync(home);
  fs.mkdirSync(temp);
  fs.mkdirSync(bin);

  const prepareRun = (overrides = {}) => {
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail',
      prepare,
      'prepare_wine_inno_prefix',
      'printf "%s\\n%s\\nOWNED=%s\\n" "$WINEPREFIX_INNO" "$ISCC_EXE" "$OWNED_WINEPREFIX_INNO"',
    ].join('\n')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        TMPDIR: temp,
        PAPERCUSP_WINE_INNO_PREFIX: '',
        PAPERCUSP_ISCC_EXE: '',
        ...overrides,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trimEnd().split('\n');
  };

  const first = prepareRun({});
  const second = prepareRun({});
  const defaultIscc = path.join(home, '.papercusp', 'wine-inno', 'drive_c', 'InnoSetup6', 'ISCC.exe');
  assert.equal(first.length, 3);
  assert.equal(first[1], defaultIscc, 'the installed ISCC path remains independent of the runtime prefix');
  assert.equal(first[2], 'OWNED=' + first[0], 'the producer owns its generated runtime prefix');
  assert.ok(first[0].startsWith(temp + path.sep), 'the runtime prefix must live in the per-run temp area');
  assert.notEqual(first[0], second[0], 'separate build invocations must not share a Wine server prefix');
  assert.ok(fs.statSync(first[0]).isDirectory());
  assert.ok(fs.statSync(second[0]).isDirectory());

  const explicitPrefix = path.join(sandbox, 'explicit-prefix');
  fs.mkdirSync(explicitPrefix);
  const explicit = prepareRun({ PAPERCUSP_WINE_INNO_PREFIX: explicitPrefix });
  assert.equal(explicit[0], explicitPrefix, 'an explicit runtime prefix must be honored');
  assert.equal(
    explicit[1],
    path.join(explicitPrefix, 'drive_c', 'InnoSetup6', 'ISCC.exe'),
    'an explicit prefix retains its existing ISCC default',
  );
  assert.equal(explicit[2], 'OWNED=', 'the producer must not delete caller-owned prefixes');

  const ownedPrefix = path.join(sandbox, 'cleanup-prefix');
  const calls = path.join(sandbox, 'wineserver-calls.log');
  fs.mkdirSync(ownedPrefix);
  fs.writeFileSync(path.join(bin, 'wineserver'), [
    '#!/usr/bin/env bash',
    'printf "%s|%s\\n" "$WINEPREFIX" "$*" >> "$WINE_SERVER_CALLS"',
  ].join('\n') + '\n', { mode: 0o755 });
  const cleanupRun = spawnSync('bash', ['-c', [
    'set -euo pipefail',
    cleanup,
    'cleanup_wine_inno_prefix',
  ].join('\n')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: bin + path.delimiter + process.env.PATH,
      OWNED_WINEPREFIX_INNO: ownedPrefix,
      WINE_SERVER_CALLS: calls,
    },
  });
  assert.equal(cleanupRun.status, 0, cleanupRun.stderr);
  assert.equal(fs.existsSync(ownedPrefix), false, 'the producer must remove its private prefix');
  assert.deepEqual(
    fs.readFileSync(calls, 'utf8').trim().split('\n'),
    [ownedPrefix + '|-k', ownedPrefix + '|-w'],
    'Wine shutdown must target only the owned prefix',
  );

  const preservedRun = spawnSync('bash', ['-c', [
    'set -euo pipefail',
    cleanup,
    'cleanup_wine_inno_prefix',
  ].join('\n')], {
    encoding: 'utf8',
    env: { ...process.env, OWNED_WINEPREFIX_INNO: '', WINEPREFIX_INNO: explicitPrefix },
  });
  assert.equal(preservedRun.status, 0, preservedRun.stderr);
  assert.equal(fs.existsSync(explicitPrefix), true, 'caller-owned prefix must survive cleanup');
});

test('the Inno compatibility preflight runs before the first cargo-xwin build', () => {
  const preflightAt = builder.indexOf(
    'innoextract_compat_preflight "${PAPERCUSP_INNOEXTRACT:-}"',
  );
  const exportAt = builder.indexOf('export PAPERCUSP_INNOEXTRACT');
  const cargoVersionAt = builder.indexOf('\ncargo xwin --version');
  const cargoBuildAt = builder.indexOf('\n      cargo xwin build');

  assert.ok(preflightAt >= 0, 'Windows builder must invoke the compatibility preflight');
  assert.ok(exportAt >= 0, 'Windows builder must export the selected extractor');
  assert.ok(cargoVersionAt >= 0, 'Windows builder must retain the cargo-xwin toolchain check');
  assert.ok(cargoBuildAt >= 0, 'Windows builder must retain the cargo-xwin build');
  assert.ok(
    preflightAt < exportAt && exportAt < cargoVersionAt && exportAt < cargoBuildAt,
    'the real Inno producer/consumer probe must select and export before cargo-xwin',
  );
  assert.match(
    builder,
    /source "\$HERE\/lib\/innoextract-compat-preflight\.sh"/,
    'the builder must load the shared preflight helper rather than duplicate its logic',
  );
  assert.match(
    builder,
    /PAPERCUSP_INNOEXTRACT[\s\S]*finished-artifact audit/,
    'the selected extractor contract must be documented at the producer boundary',
  );
  assert.match(helper, /AppVersion=6\.7\.3/);
  assert.match(helper, /probe-payload\\\.txt/);
  assert.match(helper, /grep -qi 'probe-payload\\\.txt'/);
  assert.match(helper, /DiskSpanning=yes/);
  assert.match(helper, /DiskSliceSize=8388608/);
});

test('the real Inno probe inherits the selected production policy without inventing a source archive', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-inno-policy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const template = fs.readFileSync(path.join(root, 'src-tauri/windows/inno/papercusp.iss'), 'utf8');
  const policy = template.match(/^#if [^\n]*\nDiskSpanning=yes\nDiskSliceSize=\d+\n#endif$/m)?.[0];
  assert.ok(policy);
  const selected = path.join(dir, 'selected.iss');
  const output = path.join(dir, 'probe.iss');
  const run = text => {
    fs.writeFileSync(selected, text);
    return spawnSync('bash', ['-c', 'source "$1"; _innoextract_write_probe "$2" "$3"',
      'policy-probe', helperPath, selected, output], { encoding: 'utf8' });
  };
  assert.equal(run(template).status, 0);
  assert.ok(fs.readFileSync(output, 'utf8').includes(policy.replace(/DiskSliceSize=\d+/, 'DiskSliceSize=8388608')));
  assert.equal(fs.existsSync(path.join(dir, 'sidecar/source.tar.zst')), false);
  // The real compiler/extractor preflight must consume a regressed decision,
  // rather than hard-code DiskSpanning=yes and conceal that regression.
  const changed = template.replace(policy, policy.replace('!Defined(SingleFile)', 'Defined(RegressionControl)'));
  assert.equal(run(changed).status, 0);
  assert.match(fs.readFileSync(output, 'utf8'), /#if Defined\(RegressionControl\)/);
  const malformed = run(template.replace(policy, ''));
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /missing or ambiguous/);
});

test('compatibility requires extraction, intact bytes, and corruption refusal', (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-innoextract-select-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const home = path.join(sandbox, 'home');
  const fakeBin = path.join(sandbox, 'bin');
  const winePrefix = path.join(sandbox, 'wine');
  const iscc = path.join(winePrefix, 'drive_c', 'InnoSetup6', 'ISCC.exe');
  const managed = path.join(
    home,
    '.papercusp',
    'toolchains',
    'innoextract-maintained',
    'bin',
    'innoextract',
  );
  const calls = path.join(sandbox, 'calls.log');

  fs.mkdirSync(path.dirname(managed), { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(path.dirname(iscc), { recursive: true });
  fs.writeFileSync(iscc, 'mock ISCC\n');

  const writeExecutable = (file, body) => {
    fs.writeFileSync(file, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, {
      mode: 0o755,
    });
  };
  writeExecutable(
    managed,
    [
      'printf "managed\\n" >> "$PAPERCUSP_TEST_CALL_LOG"',
      'if [[ "${1:-}" == "-l" ]]; then printf "probe-payload.txt\\n"; exit 0; fi',
      'fixture="${@: -1}"',
      'if [[ "$fixture" == */legacy-*/*.exe && "${PAPERCUSP_TEST_EXTRACT_MODE:-}" == reject-legacy ]]; then',
      '  echo "bad slice magic number" >&2; exit 1',
      'fi',
      'if [[ "$fixture" == */truncated-*/*.exe ]]; then',
      '  [[ "${PAPERCUSP_TEST_EXTRACT_MODE:-}" == ignore-truncation ]] && exit 0',
      '  echo "bad slice size" >&2; exit 1',
      'fi',
      'if [[ "$fixture" == */corrupt-*/*.exe ]]; then',
      '  if [[ "$(head -c 8 "${fixture%.exe}-1.bin")" == "notinno!" ]]; then',
      '    [[ "${PAPERCUSP_TEST_EXTRACT_MODE:-}" == ignore-header ]] && exit 0',
      '    echo "bad slice magic number" >&2; exit 1',
      '  fi',
      '  [[ "${PAPERCUSP_TEST_EXTRACT_MODE:-}" == ignore-corruption ]] && exit 0',
      '  printf "Checksum mismatch: expected original, got corrupt\\n" >&2; exit 1',
      'fi',
      'out=""',
      'while (($#)); do',
      '  if [[ "$1" == "--output-dir" ]]; then out="$2"; shift 2; else shift; fi',
      'done',
      'mkdir -p "$out/app"',
      'cp "$(dirname "$fixture")/../probe-payload.txt" "$out/app/probe-payload.txt"',
      'case "${PAPERCUSP_TEST_EXTRACT_MODE:-}" in',
      '  warning) printf "Could not read back output checksum for multi-part file\\n" >&2 ;;',
      '  wrong-bytes) printf "wrong bytes\\n" > "$out/app/probe-payload.txt" ;;',
      'esac',
      'exit 0',
    ].join('\n'),
  );
  writeExecutable(
    path.join(fakeBin, 'innoextract'),
    'printf "stale-path\\n" >> "$PAPERCUSP_TEST_CALL_LOG"\nexit 23',
  );
  writeExecutable(path.join(fakeBin, 'winepath'), '[[ "$1" == "-w" ]]\nprintf "%s\\n" "$2"');
  writeExecutable(
    path.join(fakeBin, 'wine'),
    'probe_iss="${@: -1}"\n' +
      'mkdir -p "$(dirname "$probe_iss")/out"\n' +
      'base="$(dirname "$probe_iss")"\n' +
      'printf "fixture stub\\n" > "$base/out/innoextract-compat-probe.exe"\n' +
      'python3 - "$base" <<\'PY\'\n' +
      'import pathlib, struct, sys\n' +
      'base = pathlib.Path(sys.argv[1])\n' +
      'payload = (base / "probe-payload.txt").read_bytes()\n' +
      'for i, part in enumerate((payload[:6291456], payload[6291456:]), 1):\n' +
      '    (base / "out" / f"innoextract-compat-probe-{i}.bin").write_bytes(\n' +
      '        b"idskb32\\x1a" + struct.pack("<Q", len(part) + 16) + part)\n' +
      'PY',
  );
  writeExecutable(
    path.join(fakeBin, 'xvfb-run'),
    '[[ "${1:-}" == "-a" ]] && shift\nexec "$@"',
  );
  writeExecutable(path.join(fakeBin, 'timeout'), 'shift\nexec "$@"');

  const env = {
    ...process.env,
    HOME: home,
    PATH: `${fakeBin}:${process.env.PATH || ''}`,
    PAPERCUSP_TEST_CALL_LOG: calls,
  };
  delete env.PAPERCUSP_INNOEXTRACT;

  const output = execFileSync(
    'bash',
    [
      '-c',
      'source "$1"; innoextract_compat_preflight "" "$2" "$3"',
      'bash',
      helperPath,
      winePrefix,
      iscc,
    ],
    { encoding: 'utf8', env },
  );

  assert.equal(output.trim(), managed, 'resolver must return the passing managed absolute path');
  assert.equal(
    fs.readFileSync(calls, 'utf8'),
    'managed\n'.repeat(8),
    'the stale PATH binary must not run once a managed candidate passes the real-format probe',
  );

  // Listing is insufficient: exercise each refusal and compatibility obligation.
  for (const mode of [
    'warning', 'wrong-bytes', 'reject-legacy', 'ignore-truncation',
    'ignore-corruption', 'ignore-header',
  ]) {
    assert.throws(() => execFileSync(
      'bash',
      ['-c', 'source "$1"; innoextract_compat_preflight "$4" "$2" "$3"',
        'bash', helperPath, winePrefix, iscc, managed],
      { encoding: 'utf8', env: { ...env, PAPERCUSP_TEST_EXTRACT_MODE: mode },
        stdio: ['ignore', 'pipe', 'pipe'] },
    ), (error) => {
      assert.notEqual(error.status, 0);
      assert.match(error.stderr, /failed extraction\/integrity controls/);
      return true;
    }, `must reject ${mode} even though the fixture listing passed`);
  }
});

test('audit-release-bundle.py uses PAPERCUSP_INNOEXTRACT for executable expansion', () => {
  const selected = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-innoextract-override-'));
  const extractor = path.join(selected, 'selected extractor.sh');
  const artifact = path.join(selected, 'fixture-setup.exe');
  const dest = path.join(selected, 'expanded');

  fs.writeFileSync(
    extractor,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '[[ " $* " == *" -t "* ]] || { echo "missing integrity test flag" >&2; exit 9; }',
      'out=""',
      'while (($#)); do',
      '  if [[ "$1" == "--output-dir" ]]; then out="$2"; shift 2; else shift; fi',
      'done',
      'mkdir -p "$out"',
      'printf "selected extractor payload\\n" > "$out/probe-payload.txt"',
    ].join('\n') + '\n',
    { mode: 0o755 },
  );
  fs.writeFileSync(artifact, 'not-an-installer-for-the-fake-consumer\n');

  const python = [
    'import importlib.util, sys',
    `spec = importlib.util.spec_from_file_location("audit", ${JSON.stringify(path.join(root, 'bin/audit-release-bundle.py'))})`,
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'ok, method = mod._expand_installer(sys.argv[1], sys.argv[2])',
    'print(ok)',
    'print(method)',
  ].join('; ');
  const output = execFileSync('python3', ['-c', python, artifact, dest], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PAPERCUSP_INNOEXTRACT: extractor },
  });

  assert.match(output, /^True\n/m, 'the selected extractor must expand the fixture');
  assert.match(
    output,
    /innoextract \(.*selected extractor\.sh\)/,
    'audit output must identify the configured extractor it actually used',
  );
  assert.equal(
    fs.readFileSync(path.join(dest, 'probe-payload.txt'), 'utf8'),
    'selected extractor payload\n',
    'audit must invoke PAPERCUSP_INNOEXTRACT rather than silently using PATH innoextract',
  );

  fs.rmSync(selected, { recursive: true, force: true });
});

test('a zero-exit Inno integrity warning fails closed before generic fallback', () => {
  const selected = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-innoextract-warning-'));
  const extractor = path.join(selected, 'warning extractor.sh');
  const artifact = path.join(selected, 'fixture-setup.exe');
  const dest = path.join(selected, 'expanded');

  fs.writeFileSync(
    extractor,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'out=""',
      'while (($#)); do',
      '  if [[ "$1" == "--output-dir" ]]; then out="$2"; shift 2; else shift; fi',
      'done',
      'mkdir -p "$out"',
      'printf "Could not read back disk-spanned data for multi-part file\\n" >&2',
      'printf "checksum mismatch: expected abc actual def\\n" >&2',
      'printf "corrupt payload\\n" > "$out/source.tar.zst"',
      'exit 0',
    ].join('\n') + '\n',
    { mode: 0o755 },
  );
  fs.writeFileSync(artifact, 'not-an-installer-for-the-fake-consumer\n');

  const python = [
    'import importlib.util, sys',
    `spec = importlib.util.spec_from_file_location("audit", ${JSON.stringify(path.join(root, 'bin/audit-release-bundle.py'))})`,
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    'ok, method = mod._expand_installer(sys.argv[1], sys.argv[2])',
    'print(ok)',
    'print(method)',
  ].join('; ');
  const output = execFileSync('python3', ['-c', python, artifact, dest], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PAPERCUSP_INNOEXTRACT: extractor },
  });

  assert.match(
    output,
    /^False\n/m,
    'a checksum/read-back warning must reject a non-empty partial extraction',
  );
  assert.match(
    output,
    /innoextract .*integrity warning/,
    'the failed method must preserve the fail-closed reason',
  );

  fs.rmSync(selected, { recursive: true, force: true });
});
