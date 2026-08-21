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

test('the Inno compatibility preflight runs before the first cargo-xwin build', () => {
  const preflightAt = builder.indexOf(
    'innoextract_compat_preflight "${PAPERCUSP_INNOEXTRACT:-}"',
  );
  const cargoVersionAt = builder.indexOf('\ncargo xwin --version');
  const cargoBuildAt = builder.indexOf('\n      cargo xwin build');

  assert.ok(preflightAt >= 0, 'Windows builder must invoke the compatibility preflight');
  assert.ok(cargoVersionAt >= 0, 'Windows builder must retain the cargo-xwin toolchain check');
  assert.ok(cargoBuildAt >= 0, 'Windows builder must retain the cargo-xwin build');
  assert.ok(
    preflightAt < cargoVersionAt && preflightAt < cargoBuildAt,
    'the real Inno producer/consumer probe must fail before any cargo-xwin invocation',
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
