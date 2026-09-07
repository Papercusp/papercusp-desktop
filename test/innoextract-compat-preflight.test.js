'use strict';

// EI-20977281692677413: the Windows producer emits Inno Setup 6.7 installers,
// while the distro innoextract may only understand older loader revisions. The
// release must prove the exact producer/consumer pair before cargo-xwin, and the
// artifact audit must use the same explicitly selected extractor.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const builder = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');
const audit = fs.readFileSync(path.join(root, 'bin/audit-release-bundle.py'), 'utf8');
const helperPath = path.join(root, 'bin/lib/innoextract-compat-preflight.sh');
const helper = fs.readFileSync(helperPath, 'utf8');

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
});

test('a compatible Papercusp-managed extractor wins over a stale PATH binary', (t) => {
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
    'printf "managed\\n" >> "$PAPERCUSP_TEST_CALL_LOG"\n' +
      '[[ "${1:-}" == "-l" ]]\n' +
      'printf "probe-payload.txt\\n"',
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
      'printf "fixture\\n" > "$(dirname "$probe_iss")/out/innoextract-compat-probe.exe"',
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
    'managed\n',
    'the stale PATH binary must not run once a managed candidate passes the real-format probe',
  );
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
