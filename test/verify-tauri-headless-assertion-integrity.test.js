// EI-21166620509752037 — a long headless Tauri run must not execute a
// file-backed assertion after that file changed during the boot.
//
// The verifier intentionally boots a real desktop and operator, so this guard
// test checks the cheap, deterministic contract at source level and separately
// proves the sha256sum verdict shape. The expensive live Tauri drive remains the
// caller's acceptance test; it must never be the only recurrence guard.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VERIFY_SCRIPT = path.resolve(__dirname, '../../scripts/verify-tauri-headless.sh');
const source = fs.readFileSync(VERIFY_SCRIPT, 'utf8');

test('captures file-backed assertion argv before boot and records a sha256 manifest', () => {
  assert.match(source, /ASSERTION_CWD="\$PWD"/);
  assert.match(source, /ASSERTION_ARGS=\("\$\{@:2\}"\)/);
  assert.match(source, /sha256sum -- "\$resolved" >> "\$ASSERTION_INPUT_MANIFEST"/);

  const captureCall = source.indexOf('write_assertion_input_manifest || exit $?');
  const bootStart = source.indexOf('# ── boot Xvfb');
  assert.ok(captureCall >= 0, 'the pre-boot assertion input snapshot must be called');
  assert.ok(bootStart > captureCall, 'assertion inputs must be hashed before Xvfb/Tauri boot');
});

test('rechecks the manifest immediately before execution and refuses changed bytes', () => {
  const verifier = source.indexOf('verify_assertion_input_integrity()');
  const call = source.lastIndexOf('verify_assertion_input_integrity || exit $?');
  const execution = source.lastIndexOf('"$@"');
  assert.ok(verifier >= 0, 'the integrity verifier must exist');
  assert.ok(call > verifier, 'the integrity verifier must be called');
  assert.ok(execution > call, 'the integrity check must precede the assertion command');

  const body = source.slice(verifier, call);
  assert.match(body, /sha256sum -c -- "\$ASSERTION_INPUT_MANIFEST"/);
  assert.match(body, /ASSERTION INPUT CHANGED DURING VERIFIER BOOT/);
  assert.match(body, /return 3/);
});

test('executes an immutable work-dir copy for in-repo bash/sh assertion scripts', () => {
  const snapshot = source.indexOf('snapshot_assertion_script()');
  const snapshotCall = source.indexOf('snapshot_assertion_script || exit $?');
  const bootStart = source.indexOf('# ── boot Xvfb');
  const argumentRewrite = source.indexOf('ASSERTION_ARGS[1]="$ASSERTION_SCRIPT_SNAPSHOT_PATH"');
  const finalArgRestore = source.indexOf('set -- "${ASSERTION_ARGS[@]}"');
  const execution = source.lastIndexOf('"$@"');

  assert.ok(snapshot >= 0, 'the immutable assertion-script snapshot helper must exist');
  assert.ok(snapshotCall > snapshot, 'the assertion-script snapshot helper must be called');
  assert.ok(bootStart > snapshotCall, 'the assertion script must be frozen before verifier boot');
  assert.ok(argumentRewrite > snapshot, 'the copied script path must replace the caller path');
  assert.ok(argumentRewrite < snapshotCall, 'the copied script path must be assigned before the helper returns');
  assert.ok(finalArgRestore > snapshotCall, 'execution must restore the rewritten assertion argv');
  assert.ok(execution > finalArgRestore, 'the final command must run after argv rewriting');
  assert.match(source, /case "\$\(basename -- "\$shell_command"\)" in\s+bash\|sh\)/);
  assert.match(source, /resolved="\$\(cd "\$ASSERTION_CWD".*readlink -f -- "\$script_arg"/);
  assert.match(source, /case "\$resolved" in\s+"\$repo_dir_real"\/\*\)/);
  assert.match(source, /ASSERTION_SCRIPT_SNAPSHOT_PATH="\$WORK\/assertion-script\.sh"/);
  assert.match(source, /cp -- "\$resolved" "\$tmp"/);
  assert.match(
    source,
    /assertion script snapshot frozen at \$ASSERTION_SCRIPT_SNAPSHOT_PATH .* IMMUTABLE for this run/,
  );
});

test('the sha256 manifest turns a mutated assertion file into a failing verdict', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-tauri-assertion-integrity-'));
  try {
    const assertion = path.join(dir, 'assertion.sh');
    const manifest = path.join(dir, 'assertion-inputs.sha256');
    fs.writeFileSync(assertion, 'echo initial\n');
    const stamped = spawnSync('sha256sum', [assertion], { encoding: 'utf8' });
    assert.equal(stamped.status, 0, stamped.stderr);
    fs.writeFileSync(manifest, stamped.stdout);

    fs.writeFileSync(assertion, 'echo changed\n');
    const check = spawnSync('sha256sum', ['-c', '--status', manifest], { encoding: 'utf8' });
    assert.equal(check.status, 1, 'changed assertion bytes must fail the manifest check');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cleans bridge credentials from the runtime temp directory used for discovery', () => {
  assert.match(
    source,
    /rm -f -- "\$\{TMPDIR:-\/tmp\}\/tauri-dev-bridge-\$BRIDGE_PID\.token"/,
  );
  assert.doesNotMatch(
    source,
    /rm -f -- "\/tmp\/tauri-dev-bridge-\$BRIDGE_PID\.token"/,
    'a hard-coded /tmp cleanup diverges from Node os.tmpdir() when TMPDIR is scoped',
  );
});
