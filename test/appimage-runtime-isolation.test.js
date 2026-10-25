'use strict';

// EI-21829997763481272 — APPIMAGE_EXTRACT_AND_RUN uses
// "$TMPDIR/appimage_extracted_<hash>". A shared TMPDIR lets concurrent
// appimagetool/plugin processes select one extraction directory and corrupt each
// other's runtime. Exercise the real wrapper function from build-appimage.sh
// with a fake plugin that creates the same runtime-shaped child.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'bin', 'build-appimage.sh');
const SRC = fs.readFileSync(SCRIPT, 'utf8');

function extractIsolationFunction() {
  const match = SRC.match(
    /run_appimage_tool_isolated\(\) \(\n([\s\S]*?)\n\)\n\n/,
  );
  assert.ok(match, 'build-appimage.sh must define the isolated AppImage wrapper');
  return `run_appimage_tool_isolated() (\n${match[1]}\n)`;
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-runtime-isolation-'));
  const plugin = path.join(root, 'fake-plugin.sh');
  const report = path.join(root, 'report');
  fs.writeFileSync(
    plugin,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '[[ "$1" == "--appimage-extract" ]] || exit 90',
      'mkdir -p squashfs-root/usr/bin',
      "cat > squashfs-root/usr/bin/appimagetool <<'PACKER'",
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '[[ "$*" == *"--comp zstd"* && "$*" == *"--mksquashfs-opt 1048576"* && "$*" == *"--mksquashfs-opt 19"* && "$*" == *"--mksquashfs-opt 4"* ]] || exit 91',
      'printf "%s|%s|%s\\n" "$TMPDIR" "$APPIMAGE_EXTRACT_AND_RUN" "$LDAI_OUTPUT" >> "$APPIMAGE_TEST_REPORT"',
      'mkdir "$TMPDIR/appimage_extracted_fixture"',
      'sleep 0.1',
      'printf "fixture\\n" > "$LDAI_OUTPUT"',
      'if [[ "${APPIMAGE_TEST_EXIT:-0}" != "0" ]]; then exit "$APPIMAGE_TEST_EXIT"; fi',
      'PACKER',
      'chmod +x squashfs-root/usr/bin/appimagetool',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return { root, plugin, report };
}

function runConcurrentFixture(fixture) {
  const functionText = extractIsolationFunction();
  const outputA = path.join(fixture.root, 'a.AppImage');
  const outputB = path.join(fixture.root, 'b.AppImage');
  const appdir = path.join(fixture.root, 'fixture.AppDir');
  fs.mkdirSync(appdir);
  const script = [
    'set -uo pipefail',
    `TMPDIR=${JSON.stringify(fixture.root)}`,
    `export APPIMAGE_TEST_REPORT=${JSON.stringify(fixture.report)}`,
    functionText,
    `run_appimage_tool_isolated ${JSON.stringify(fixture.plugin)} ${JSON.stringify(outputA)} ${JSON.stringify(appdir)} &`,
    'pid_a=$!',
    `run_appimage_tool_isolated ${JSON.stringify(fixture.plugin)} ${JSON.stringify(outputB)} ${JSON.stringify(appdir)} &`,
    'pid_b=$!',
    'wait "$pid_a"',
    'status_a=$?',
    'wait "$pid_b"',
    'status_b=$?',
    'printf "statuses=%s,%s\\nparent_tmpdir=%s\\n" "$status_a" "$status_b" "$TMPDIR"',
  ].join('\n');
  return {
    outputA,
    outputB,
    result: spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: fixture.root },
    }),
  };
}

function runSingleFixture(fixture, exitCode) {
  const functionText = extractIsolationFunction();
  const output = path.join(fixture.root, 'failed.AppImage');
  const appdir = path.join(fixture.root, 'fixture.AppDir');
  fs.mkdirSync(appdir);
  const script = [
    'set -uo pipefail',
    `TMPDIR=${JSON.stringify(fixture.root)}`,
    `export APPIMAGE_TEST_REPORT=${JSON.stringify(fixture.report)}`,
    functionText,
    `APPIMAGE_TEST_EXIT=${exitCode} run_appimage_tool_isolated ${JSON.stringify(fixture.plugin)} ${JSON.stringify(output)} ${JSON.stringify(appdir)}`,
    'status=$?',
    'printf "status=%s\\n" "$status"',
  ].join('\n');
  return {
    output,
    result: spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: fixture.root },
    }),
  };
}

test('concurrent AppImage runtime extractions get private TMPDIRs and clean them up', () => {
  const fixture = makeFixture();
  try {
    const { outputA, outputB, result } = runConcurrentFixture(fixture);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /statuses=0,0/);
    assert.match(result.stdout, new RegExp(`parent_tmpdir=${fixture.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.equal(fs.readFileSync(outputA, 'utf8'), 'fixture\n');
    assert.equal(fs.readFileSync(outputB, 'utf8'), 'fixture\n');

    const rows = fs
      .readFileSync(fixture.report, 'utf8')
      .trim()
      .split('\n')
      .map((row) => row.split('|'));
    assert.equal(rows.length, 2, 'both concurrent plugin invocations must run');
    assert.equal(rows[0][1], '1');
    assert.equal(rows[1][1], '1');
    assert.notEqual(rows[0][0], rows[1][0], 'concurrent invocations must not share TMPDIR');
    for (const [runtimeTmp, , output] of rows) {
      assert.ok(runtimeTmp.startsWith(`${fixture.root}${path.sep}`));
      assert.match(path.basename(runtimeTmp), /^papercusp-appimage-runtime\.[A-Za-z0-9_-]+$/);
      assert.equal(fs.existsSync(runtimeTmp), false, 'the wrapper must clean its private runtime directory');
      assert.ok(fs.existsSync(output), 'the plugin output path must be passed through');
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('a failed AppImage tool still cleans its private runtime directory', () => {
  const fixture = makeFixture();
  try {
    const { output, result } = runSingleFixture(fixture, 7);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stdout, /status=7/);
    assert.equal(fs.existsSync(output), false, 'a failed plugin must not leave a publishable output');

    const [runtimeTmp] = fs.readFileSync(fixture.report, 'utf8').trim().split('|');
    assert.ok(runtimeTmp.startsWith(`${fixture.root}${path.sep}`));
    assert.equal(
      fs.existsSync(runtimeTmp),
      false,
      'the wrapper must clean its private runtime directory after a plugin failure',
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('the build invokes the isolated wrapper instead of the raw plugin command', () => {
  const callAt = SRC.indexOf('run_appimage_tool_isolated "$PLUGIN" "$OUT" "$APPDIR"');
  const rawAt = SRC.indexOf('ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 LDAI_OUTPUT="$OUT" "$PLUGIN"');
  assert.ok(callAt >= 0, 'build-appimage.sh must invoke the isolation wrapper');
  assert.equal(rawAt, -1, 'the raw shared-TMPDIR plugin invocation must not return');
  assert.ok(
    SRC.indexOf('TMPDIR="$runtime_tmp" LDAI_OUTPUT="$output"') >= 0,
    'the wrapper must scope TMPDIR to its owned runtime directory',
  );
});
