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
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VERIFY_SCRIPT = path.resolve(__dirname, '../../scripts/verify-tauri-headless.sh');
const source = fs.readFileSync(VERIFY_SCRIPT, 'utf8');
const sourcePreview = fs.readFileSync(path.resolve(__dirname, '../../scripts/source-preview.mjs'), 'utf8');
const nativeInputsBlock = sourcePreview.match(/export const TAURI_VERIFIER_INPUTS = Object.freeze\(\[([\s\S]*?)\]\);/)?.[1];
const nativeInputs = [...(nativeInputsBlock || '').matchAll(/'([^']+)'/g)].map(match => match[1]);
const DEV_OPERATOR_SCRIPT = path.resolve(__dirname, '../bin/dev-operator-ifneeded.sh');
const devOperatorSource = fs.readFileSync(DEV_OPERATOR_SCRIPT, 'utf8');
const dreamSource = fs.readFileSync(path.resolve(__dirname, '../../scripts/verify-dream-native.sh'), 'utf8');
const voiceSource = fs.readFileSync(path.resolve(__dirname, '../../scripts/verify-voice-settings.sh'), 'utf8');

function nativeCargoPreflightFixture({ freeGb, warm = false, prepareOnly = false, claimSlot = false, handoff = false, peerReceipt = false, afterFreeGb = 12 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-native-capacity-'));
  const target = path.join(dir, 'cargo');
  const ledger = path.join(dir, 'reservations');
  const dfCalls = path.join(dir, 'df-calls');
  try {
    fs.mkdirSync(warm ? path.join(target, 'debug', 'deps') : target, { recursive: true });
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'cargo'), '#!/usr/bin/env node\n' +
      'process.stdout.write(JSON.stringify({target_directory: process.env.NATIVE_FIXTURE_TARGET}));\n',
    { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'df'), '#!/usr/bin/env bash\n' +
      'printf "measured\\n" >> "$NATIVE_FIXTURE_DF_CALLS"\n' +
      `available=${freeGb * 1024 * 1024}\n` +
      `[ "\${NATIVE_FIXTURE_AFTER_PREPARE:-0}" != 1 ] || available=${afterFreeGb * 1024 * 1024}\n` +
      'printf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 209715200 0 %s 0%% /fixture\\n" "$available"\n',
    { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'tauri'), '#!/usr/bin/env bash\nprintf "CLI_STARTED\\n"\n', { mode: 0o755 });
    const preflight = source.match(/^preflight_native_cargo\(\) \{[\s\S]*?^\}/m)?.[0];
    assert.ok(preflight, 'the maintained native preflight must be executable');
    const result = spawnSync('bash', ['-c', preflight + '\n' +
      'trap \'papercusp_release_disk_reservation; [ -z "${peer:-}" ] || kill "$peer" 2>/dev/null\' EXIT\n' +
      'preflight_native_cargo || exit $?\n' +
      'printf "PREPARATION_STARTED target=%s\\n" "$CARGO_TARGET_DIR"\n' +
      'if [ -n "${NATIVE_CARGO_DISK_RESERVATION_FILE:-}" ] && [ -f "$NATIVE_CARGO_DISK_RESERVATION_FILE" ]; then echo RESERVATION_HELD; fi\n' +
      (peerReceipt ? 'sleep 30 & peer=$!\n' +
        'sed "/^pid=/d; /^start=/d" "$NATIVE_CARGO_DISK_RESERVATION_FILE" > "$NATIVE_CARGO_DISK_RESERVATION_FILE.tmp"\n' +
        'printf "pid=%s\\nstart=%s\\n" "$peer" "$(papercusp_proc_starttime "$peer")" >> "$NATIVE_CARGO_DISK_RESERVATION_FILE.tmp"\n' +
        'mv "$NATIVE_CARGO_DISK_RESERVATION_FILE.tmp" "$NATIVE_CARGO_DISK_RESERVATION_FILE"\n' : '') +
      (handoff ? 'export NATIVE_FIXTURE_AFTER_PREPARE=1 PAPERCUSP_DISK_RESERVATION_FILE="$NATIVE_CARGO_DISK_RESERVATION_FILE"\n' +
        'PAPERCUSP_SIDECAR_LOCK="$HOME/sidecar.lock" bash "$DESKTOP_DIR/bin/tauri-guarded" dev || exit $?\n' : '') +
      (claimSlot ? 'if flock -n "$HOME/.papercusp/desktop-dev-slots/slot0.lock" true; then echo SLOT_UNPROTECTED; else echo SLOT_HELD; fi\n' : '')], {
      encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, HOME: dir, DESKTOP_DIR: path.resolve(__dirname, '..'),
        CARGO_TARGET_DIR: claimSlot ? '' : target, PREPARE_ONLY: prepareOnly ? '1' : '0',
        PATH: `${bin}:${process.env.PATH}`, PAPERCUSP_DISK_RESERVATION_DIR: ledger,
        NATIVE_FIXTURE_DF_CALLS: dfCalls, NATIVE_FIXTURE_TARGET: target },
    });
    const claims = fs.existsSync(ledger) ? fs.readdirSync(ledger)
      .flatMap(mount => fs.readdirSync(path.join(ledger, mount))) : [];
    return { ...result, target, claims, measured: fs.existsSync(dfCalls) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function maintainedShellFunction(name) {
  const start = source.indexOf(name + '() {');
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'maintained shell function missing: ' + name);
  return source.slice(start, end + 2);
}

function staleIpcAdvertCleanupFixture(nspidValue) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-tauri-ipc-pidns-'));
  try {
    const home = path.join(root, 'home');
    const work = path.join(root, 'work');
    const status = path.join(root, 'proc-status');
    const papercuspHome = path.join(home, '.papercusp');
    const advert = path.join(papercuspHome, 'endpoint-ipc.3270.json');
    fs.mkdirSync(papercuspHome, { recursive: true });
    fs.mkdirSync(work, { recursive: true });
    fs.writeFileSync(advert, JSON.stringify({ socketPath: '/tmp/fixture.sock', pid: 999999, port: 3270 }));
    const statusBody = nspidValue === null
      ? 'Name:\tbash\n'
      : 'Name:\tbash\nNSpid:\t' + nspidValue + '\n';
    fs.writeFileSync(status, statusBody);

    const shell = [
      'log() { :; }',
      'kill() { return 1; }',
      maintainedShellFunction('verifier_pid_namespace_is_private'),
      maintainedShellFunction('prepare_verifier_papercusp_home'),
      maintainedShellFunction('prune_stale_ipc_advert_for_port'),
      'prepare_verifier_papercusp_home "$VERIFY_TAURI_PID_STATUS"',
      'prune_stale_ipc_advert_for_port 3270',
      'printf "%s\\n" "$PAPERCUSP_HOME"',
    ].join('\n');
    const result = spawnSync('bash', ['-c', shell], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        WORK: work,
        PAPERCUSP_HOME: papercuspHome,
        VERIFY_TAURI_PID_STATUS: status,
      },
    });
    return {
      status: result.status,
      stderr: result.stderr,
      papercuspHome: result.stdout.trim(),
      workHome: path.join(work, 'papercusp-home'),
      hostAdvertRemains: fs.existsSync(advert),
      hostHome: papercuspHome,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('stale IPC cleanup cannot remove a host advertisement from a private PID namespace', () => {
  assert.ok(source.indexOf('prepare_verifier_papercusp_home ||') <
    source.indexOf('prune_stale_ipc_advert_for_port "$DEV_PORT"'),
  'private Papercusp home must be configured before the early cleanup');

  const privateNamespace = staleIpcAdvertCleanupFixture('2158939 1');
  assert.equal(privateNamespace.status, 0, privateNamespace.stderr);
  assert.equal(privateNamespace.papercuspHome, privateNamespace.workHome);
  assert.equal(privateNamespace.hostAdvertRemains, true, 'namespace-relative PID absence must not delete host state');

  const sameNamespace = staleIpcAdvertCleanupFixture('2158939');
  assert.equal(sameNamespace.status, 0, sameNamespace.stderr);
  assert.equal(sameNamespace.papercuspHome, sameNamespace.hostHome);
  assert.equal(sameNamespace.hostAdvertRemains, false, 'confirmed same-namespace dead PIDs remain prunable');

  const unknownNamespace = staleIpcAdvertCleanupFixture(null);
  assert.equal(unknownNamespace.status, 0, unknownNamespace.stderr);
  assert.equal(unknownNamespace.papercuspHome, unknownNamespace.workHome);
  assert.equal(unknownNamespace.hostAdvertRemains, true, 'unknown namespace identity must fail closed');
});

test('native admission rejects cold and warm shortages before verifier preparation', () => {
  for (const [warm, need] of [[false, 65], [true, 12]]) {
    const refused = nativeCargoPreflightFixture({ freeGb: need - 1, warm });
    assert.equal(refused.status, 28, refused.stderr);
    assert.doesNotMatch(refused.stdout, /PREPARATION_STARTED/);
    assert.match(refused.stderr, new RegExp(`need ~${need}GB`));
    assert.ok(refused.stderr.includes(refused.target), 'measure the selected native target');
    assert.deepEqual(refused.claims, [], 'a refusal leaves no reservation');

    const admitted = nativeCargoPreflightFixture({ freeGb: need, warm });
    assert.equal(admitted.status, 0, admitted.stderr);
    assert.ok(admitted.stdout.includes(`target=${admitted.target}`));
    assert.match(admitted.stdout, /RESERVATION_HELD/, 'preparation retains the admitted Cargo budget');
    assert.deepEqual(admitted.claims, [], 'the preparation owner releases its receipt on exit');
  }
});

test('prepare-only does not require native Cargo capacity', () => {
  const result = nativeCargoPreflightFixture({ freeGb: 0, prepareOnly: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PREPARATION_STARTED/);
  assert.equal(result.measured, false);
});

test('early native admission keeps the selected slot locked for preparation and boot', () => {
  const result = nativeCargoPreflightFixture({ freeGb: 100, claimSlot: true });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`target=${result.target}`));
  assert.match(result.stdout, /SLOT_HELD/);
  assert.doesNotMatch(result.stdout, /SLOT_UNPROTECTED/);
  assert.match(result.stdout, /RESERVATION_HELD/);
  assert.deepEqual(result.claims, [], 'the owner releases its receipt on exit');
});

test('native boot adopts the retained Cargo budget after preparation without double reserving', () => {
  const result = nativeCargoPreflightFixture({ freeGb: 100, warm: true, handoff: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESERVATION_HELD/);
  assert.match(result.stderr, /adopted 12GB ancestor reservation/);
  assert.match(result.stdout, /CLI_STARTED/);
  assert.deepEqual(result.claims, [], 'handoff creates no second reservation');
});

test('native boot cannot adopt an unrelated live peer reservation', () => {
  const result = nativeCargoPreflightFixture({ freeGb: 100, warm: true, handoff: true, peerReceipt: true });
  assert.equal(result.status, 28, result.stderr);
  assert.doesNotMatch(result.stdout, /CLI_STARTED/);
  assert.doesNotMatch(result.stderr, /adopted/);
  assert.match(result.stderr, /insufficient disk for native dev Cargo build/);
});

test('native boot refuses physical disk exhaustion despite its retained Cargo reservation', () => {
  const result = nativeCargoPreflightFixture({ freeGb: 100, warm: true, handoff: true, afterFreeGb: 11 });
  assert.equal(result.status, 28, result.stderr);
  assert.match(result.stdout, /RESERVATION_HELD/);
  assert.doesNotMatch(result.stdout, /CLI_STARTED/);
  assert.doesNotMatch(result.stderr, /adopted/);
  assert.match(result.stderr, /insufficient disk for native dev Cargo build/);
  assert.deepEqual(result.claims, [], 'the refused descendant and preparation owner release their receipt');
});

test('native admission precedes costly preparation and pins its maintained helpers', () => {
  const admission = source.indexOf('vh_run_step native-cargo-capacity preflight_native_cargo');
  assert.ok(admission > 0);
  for (const step of ['shared-schema-readiness', 'operator-source-snapshot']) {
    assert.ok(admission < source.indexOf(`vh_run_step ${step} `), step);
  }
  assert.match(source, /local input_args=\(--tauri-inputs\)/);
  for (const helper of ['tauri-guarded', 'lib/claim-target-dir.sh',
    'lib/cargo-target-root.sh', 'lib/release-artifacts.sh', 'lib/disk-preflight.sh']) {
    assert.ok(nativeInputs.includes(`papercusp-desktop/bin/${helper}`), helper);
  }
});

test('native console compile preflight refuses failures before setup and skips non-native preparation', () => {
  const preflight = source.match(/^preflight_native_console_platform\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(preflight, 'native console platform preflight missing');
  for (const [prepareOnly, platform, checkStatus, expected] of [
    ['0', 'Linux', 1, 1], ['0', 'Linux', 0, 0], ['1', 'Linux', 1, 0], ['0', 'Darwin', 1, 0],
  ]) {
    const result = spawnSync('bash', ['-c',
      `uname() { printf '%s\\n' '${platform}'; }\n` +
      `node() { printf 'CHECK_ARGS %s\\n' "$*"; return ${checkStatus}; }\n` + preflight + '\n' +
      'preflight_native_console_platform || exit $?\nprintf "PREPARATION_STARTED\\n"\n'], {
      encoding: 'utf8', env: { ...process.env, DESKTOP_DIR: '/fixture/desktop', PREPARE_ONLY: prepareOnly },
    });
    assert.equal(result.status, expected, result.stderr);
    assert.equal(result.stdout.includes('PREPARATION_STARTED'), expected === 0);
    const runsCheck = prepareOnly === '0' && platform === 'Linux';
    assert.equal(result.stdout.includes('CHECK_ARGS'), runsCheck);
    if (runsCheck) assert.match(result.stdout, /--test --test-global-setup=\/fixture\/desktop\/test\/monorepo-host-preflight.mjs \/fixture\/desktop\/test\/native-console-gnome.test.mjs/);
  }
  const admission = source.indexOf('vh_run_step native-console-platform-check preflight_native_console_platform');
  assert.ok(admission > source.indexOf('vh_run_step native-cargo-capacity preflight_native_cargo'));
  assert.ok(admission < source.indexOf('vh_run_step operator-source-snapshot '));
  for (const input of ['papercusp-desktop/src-tauri/src/main.rs',
    'papercusp-desktop/src-tauri/src/native_console.rs', 'papercusp-desktop/src-tauri/src/wsl_sidecar_staging.rs',
    'papercusp-desktop/test/native-console-gnome.test.mjs', 'papercusp-desktop/test/monorepo-host-preflight.mjs',
    'scripts/lib/node-test-host-preflight.mjs', 'packages/operator-core/lib/gnome-terminal-policy.json']) {
    assert.ok(nativeInputs.includes(input), input);
  }
});

test('native console preflight accepts the inherited committed-source loader', () => {
  const loader = path.resolve(__dirname, '../../scripts/lib/committed-source-loader.mjs');
  const preflight = source.match(/^preflight_native_console_platform\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(preflight, 'native console platform preflight missing');
  // Exercise the real runner and module load without repeating the Cargo fixture.
  // The command-only fixture above cannot detect a loader refusing CommonJS.
  const env = { ...process.env, DESKTOP_DIR: path.resolve(__dirname, '..'), PREPARE_ONLY: '0',
    NODE_OPTIONS: [process.env.NODE_OPTIONS || '', `--import=${loader}`].filter(Boolean).join(' ') };
  // Start a runner, rather than a second child of this suite's node:test IPC.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync('bash', ['-c',
    'uname() { printf "Linux\\n"; }\n' +
    preflight.replace('node --test ', 'node --test --test-name-pattern="^Cargo failure diagnostics" ') +
    '\npreflight_native_console_platform'], {
    encoding: 'utf8', timeout: 60000, env,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /Cargo failure diagnostics retain stdout and stderr tails/);
  assert.doesNotMatch(result.stderr, /COMMITTED_SOURCE refused/);
});

function voiceExpression(name, document, location = {}, KeyboardEvent = class {
  constructor(type, options) { this.type = type; Object.assign(this, options); }
}) {
  const expression = voiceSource.match(new RegExp(`${name}='([\\s\\S]*?)'\\n`))?.[1];
  assert.ok(expression, `maintained native ${name} expression must exist`);
  return new Function('document', 'location', 'KeyboardEvent', `return ${expression};`)(document, location, KeyboardEvent);
}

test('voice regression requires its settings page and finds the alert after unrelated alerts', () => {
  assert.equal(voiceExpression('GEMINI_ALERT', { querySelector: () => null }), false);
  let alerts = [{ textContent: 'Unrelated alert' }];
  const page = { querySelectorAll: () => alerts };
  const document = { querySelector: selector => selector === '.pc-settings-page--voice'
    ? page : selector === '[role=alert]' ? alerts[0] : null };
  assert.equal(voiceExpression('GEMINI_ALERT', document), false);
  alerts = [{ textContent: 'Unrelated alert' }, { textContent: 'Gemini Live is not supported in this release.' }];
  assert.equal(new Function('document', 'return !!document.querySelector(\'[role="alert"]\')?.textContent?.includes(\'Gemini Live is not supported\');')(document), false,
    'the original first-alert-only assertion rejects this valid rendered state');
  assert.equal(voiceExpression('GEMINI_ALERT', document), true);
});

test('voice regression cannot accept an enabled or missing Gemini option', () => {
  let options = [];
  const document = { querySelectorAll: () => options };
  assert.equal(voiceExpression('GEMINI_DISABLED', document), false);
  let disabled = false;
  options = [{ textContent: 'Google Gemini Live', hasAttribute: () => disabled,
    getAttribute: () => disabled ? 'true' : 'false' }];
  assert.equal(voiceExpression('GEMINI_DISABLED', document), false);
  disabled = true;
  assert.equal(voiceExpression('GEMINI_DISABLED', document), true);
});

test('voice regression opens the picker using the Radix keyboard contract', () => {
  assert.equal(voiceExpression('GEMINI_OPEN_PICKER', { querySelector: () => null }), false);
  const actions = [];
  const trigger = { focus: () => actions.push('focus'), dispatchEvent: e => actions.push(e) };
  assert.equal(voiceExpression('GEMINI_OPEN_PICKER', { querySelector: () => trigger }), true);
  assert.equal(actions[0], 'focus');
  assert.equal(actions[1].type, 'keydown');
  assert.equal(actions[1].key, 'ArrowDown');
  assert.equal(actions[1].bubbles, true);
  assert.equal(actions[1].cancelable, true);
});

test('voice regression failure evidence identifies an unmounted route without throwing', () => {
  const document = { readyState: 'complete', querySelector: () => null,
    querySelectorAll: () => [{ textContent: 'Onboarding is required' }] };
  // Options and alerts use distinct selectors, as a real DOM does.
  document.querySelectorAll = selector => selector === '[role=alert]'
    ? [{ textContent: 'Onboarding is required' }] : [];
  const diagnostic = voiceExpression('GEMINI_DIAGNOSTIC', document, { href: 'http://127.0.0.1:33700/onboarding' });
  assert.equal(diagnostic.href, 'http://127.0.0.1:33700/onboarding');
  assert.equal(diagnostic.settingsPresent, false);
  assert.equal(diagnostic.fullAgentLabel, null);
  assert.deepEqual(diagnostic.alerts, ['Onboarding is required']);
  assert.deepEqual(diagnostic.geminiOptions, []);
});

function runVoiceRouteFixture(isolated) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-native-route-'));
  const calls = path.join(dir, 'calls');
  try {
    const tool = path.join(dir, 'tauri-agent-tools');
    const poll = path.join(dir, 'poll');
    fs.writeFileSync(tool, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$VOICE_FIXTURE_CALLS"
if [ "$1" = probe ]; then printf 'App PID: 4242\\n'; fi
if [ "$1" = eval ] && [[ "$4" == *settingsPresent* ]]; then
  printf '{"href":"http://127.0.0.1:33700/onboarding","settingsPresent":false}\\n'
fi
`);
    fs.writeFileSync(poll, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$VOICE_FIXTURE_CALLS"
if [[ "$*" == *pc-settings-page--voice* ]]; then exit 37; fi
`);
    fs.writeFileSync(path.join(dir, 'node'), '#!/usr/bin/env bash\ncat >/dev/null\n');
    for (const file of [tool, poll, path.join(dir, 'node')]) fs.chmodSync(file, 0o755);
    const result = spawnSync('bash', [path.resolve(__dirname, '../../scripts/verify-voice-settings.sh'), '--gemini-unavailable'], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH,
        VERIFY_TAURI_PID: '4242', VERIFY_TAURI_PORT: '33700',
        VERIFY_TAURI_AGENT_TOOLS_BIN: tool, VERIFY_TAURI_POLL: poll,
        VERIFY_TAURI_ISOLATED_DB: isolated ? '1' : '0', VOICE_FIXTURE_CALLS: calls },
    });
    return { ...result, calls: fs.readFileSync(calls, 'utf8') };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('voice native regression refuses the shared DB before any preference write', () => {
  const result = runVoiceRouteFixture(false);
  assert.equal(result.status, 9, result.stderr);
  assert.equal(result.calls.trim(), 'probe --pid 4242');
});

test('voice native regression preserves route failure and captures evidence before picker checks', () => {
  const result = runVoiceRouteFixture(true);
  assert.equal(result.status, 37, result.stderr);
  assert.match(result.stdout, /"settingsPresent":false/);
  assert.match(result.calls, /--require .pc-settings-page--voice/);
  assert.doesNotMatch(result.calls, /ArrowDown/);
  assert.doesNotMatch(result.calls, /--require \[role=option\]/);
});

function dreamExpression(name) {
  const expression = dreamSource.match(new RegExp(`${name}='([\\s\\S]*?)'\\n`))?.[1];
  assert.ok(expression, `maintained native ${name} expression must exist`);
  return new Function('window', 'document', `return ${expression};`);
}

function dreamDocument(button, alert = false) {
  return { querySelector: () => button ? {
    querySelectorAll: () => [button], querySelector: () => alert ? {} : null,
  } : null };
}

test('native Dream counterexample waits for an enabled Start and refuses an alert', () => {
  const ready = dreamExpression('COUNTEREXAMPLE_READY');
  const button = { textContent: 'Start manual dreaming', disabled: true };
  assert.equal(ready({}, dreamDocument(null)), false);
  assert.equal(ready({}, dreamDocument(button)), false);
  button.disabled = false;
  assert.equal(ready({}, dreamDocument(button, true)), false);
  assert.equal(ready({}, dreamDocument(button)), true);
});

test('native Dream observer preserves the real response and records acknowledged dispatch', async () => {
  let onClick;
  const button = { textContent: 'Start manual dreaming', disabled: false,
    addEventListener: (event, handler) => { assert.equal(event, 'click'); onClick = handler; } };
  const response = new Response(JSON.stringify({ ok: true, result: { content: [{ text: '{"ok":true}' }] } }));
  const requests = [];
  const original = async (...args) => { requests.push(args); return response; };
  const window = { fetch: original, location: { href: 'http://127.0.0.1:33700/adv' } };
  assert.equal(dreamExpression('COUNTEREXAMPLE_OBSERVER')(window, dreamDocument(button)), true);
  onClick();
  const init = { method: 'POST', body: JSON.stringify({ name: 'dream:control', args: { pot: 'dream-native', mode: 'manual', enabled: true } }) };
  const actual = await window.fetch('/api/agent-mcp/run-tool', init);
  assert.equal(actual, response, 'never replace the server response');
  assert.deepEqual(await actual.json(), { ok: true, result: { content: [{ text: '{"ok":true}' }] } });
  assert.deepEqual(requests, [['/api/agent-mcp/run-tool', init]], 'call the real fetch exactly once');
  assert.deepEqual(window.__dreamNativeProbe.clicks, [{ disabled: false }]);
  assert.equal(window.__dreamNativeProbe.requests.length, 1);
  assert.equal(window.__dreamNativeAck.httpOk, true);
  assert.equal(window.__dreamNativeAck.envelopeOk, true);
  assert.equal(window.__dreamNativeAck.refused, false);
});

test('native Dream observer distinguishes unrelated writes, server refusals and malformed responses', async () => {
  const button = { textContent: 'Start manual dreaming', disabled: false, addEventListener: () => {} };
  let response = new Response('{"ok":true}');
  const window = { fetch: async () => response, location: { href: 'http://127.0.0.1:33700/adv' } };
  assert.equal(dreamExpression('COUNTEREXAMPLE_OBSERVER')(window, dreamDocument(button)), true);
  const init = (pot) => ({ method: 'POST', body: JSON.stringify({ name: 'dream:control', args: { pot, mode: 'manual', enabled: true } }) });
  await window.fetch('/api/agent-mcp/run-tool', init('another-pot'));
  assert.equal(window.__dreamNativeAck, null, 'another pot cannot establish this counterexample');
  response = new Response(JSON.stringify({ ok: true, result: { content: [{ text: '{"ok":false}' }] } }));
  assert.equal(await window.fetch('/api/agent-mcp/run-tool', init('dream-native')), response);
  assert.equal(window.__dreamNativeAck.refused, true);
  response = new Response('invalid-json');
  assert.equal(await window.fetch('/api/agent-mcp/run-tool', init('dream-native')), response);
  assert.equal(window.__dreamNativeAck.refused, true);
  assert.ok(window.__dreamNativeAck.error);
});

test('startup diagnostic refuses a live foreign PID even when its pidfile exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-startup-report-'));
  try {
    fs.writeFileSync(path.join(dir, 'node.pid'), String(process.pid));
    const start = source.indexOf('collect_operator_startup_diagnostic() {');
    const end = source.indexOf('\nboot_failure_diag() {', start);
    assert.ok(start >= 0 && end > start);
    const result = spawnSync('bash', ['-c', source.slice(start, end) + '\ncollect_operator_startup_diagnostic'], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, OPERATOR_STARTUP_DIAGNOSTIC_DIR: dir,
        OPERATOR_HOST_BUNDLE: path.join(dir, 'foreign-host.mjs') },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '', 'a foreign PID must not be signaled or reported as captured');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('retains startup reports per attempt and captures before the frontend deadline', () => {
  assert.match(source, /OPERATOR_STARTUP_DIAGNOSTIC_DIR=.*VH_RUN_DIR.*attempt-\$BOOT_ATTEMPTS/);
  assert.match(source, /PAPERCUSP_DEV_HOST_DIAGNOSTIC_DIR="\$OPERATOR_STARTUP_DIAGNOSTIC_DIR"/);
  assert.match(source, /BUILD_ELAPSED" -ge 60.*port_is_listening/);
  assert.match(source, /grep -Fxq -- "\$OPERATOR_HOST_BUNDLE"/);
});

test('collects one real credential-free report from the exact owned Node entry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-owned-startup-'));
  const entry = path.join(dir, 'host.mjs');
  fs.writeFileSync(entry, 'console.log("ready"); setInterval(() => {}, 1000);\n');
  const child = spawn(process.execPath, ['--report-on-signal', '--report-signal=SIGUSR2',
    '--report-exclude-env', '--report-exclude-network', `--report-directory=${dir}`, entry], {
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, STARTUP_DIAGNOSTIC_TEST_SECRET: 'must-never-be-retained' },
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`host exited before ready: ${code}`)));
    });
    fs.writeFileSync(path.join(dir, 'node.pid'), String(child.pid));
    const start = source.indexOf('collect_operator_startup_diagnostic() {');
    const end = source.indexOf('\nboot_failure_diag() {', start);
    const result = spawnSync('bash', ['-c', 'log() { echo "$*"; }\n' + source.slice(start, end)
      + '\ncollect_operator_startup_diagnostic\ncollect_operator_startup_diagnostic'], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, OPERATOR_STARTUP_DIAGNOSTIC_DIR: dir, OPERATOR_HOST_BUNDLE: entry },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim().split('\n').length, 1, 'signal only once per attempt');
    let reports = [];
    let report;
    let reportText;
    for (let i = 0; i < 100; i++) {
      reports = fs.readdirSync(dir).filter(name => name.endsWith('.json'));
      if (reports.length) {
        reportText = fs.readFileSync(path.join(dir, reports[0]), 'utf8');
        try { report = JSON.parse(reportText); break; } catch (err) {
          if (!(err instanceof SyntaxError)) throw err;
        }
      }
      await delay(20);
    }
    assert.equal(reports.length, 1, 'Node must actually write the retained report');
    assert.ok(report, 'Node must finish writing a valid report before evidence is read');
    assert.equal(report.header.processId, child.pid);
    assert.equal(report.environmentVariables, undefined);
    assert.ok(!reportText.includes('must-never-be-retained'));
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
  // A hard-coded /tmp cleanup is only allowed as the EXTRA legacy-location
  // sweep, guarded so it runs when TMPDIR is scoped elsewhere. An unguarded
  // /tmp-only cleanup diverges from Node os.tmpdir() when TMPDIR is scoped.
  const withoutGuardedFallback = source.replace(
    /if \[ "\$\{TMPDIR:-\/tmp\}" != "\/tmp" \]; then\s*\n\s*rm -f -- "\/tmp\/tauri-dev-bridge-\$BRIDGE_PID\.token"\s*\n\s*fi/g,
    '',
  );
  assert.doesNotMatch(
    withoutGuardedFallback,
    /rm -f -- "\/tmp\/tauri-dev-bridge-\$BRIDGE_PID\.token"/,
    'a hard-coded /tmp cleanup diverges from Node os.tmpdir() when TMPDIR is scoped',
  );
});

test('pins the operator source graph before Tauri launch and cleans it on both exits', () => {
  const snapshot = source.indexOf('snapshot_operator_source()');
  const snapshotCall = source.indexOf(
    'snapshot_operator_source || { cleanup_operator_source_snapshot; exit 1; }',
  );
  const work = source.indexOf('WORK="$(mktemp -d');
  const launch = source.indexOf('cat > "$WORK/launch.sh" <<LAUNCH');
  const sourceEnv = source.indexOf('$OPERATOR_SOURCE_ENV_LINE', launch);
  const teardown = source.indexOf('teardown() {');
  const stop = source.indexOf(
    '[ -n "$OPERATOR_SOURCE_WORK" ] && rm -rf -- "$OPERATOR_SOURCE_WORK"',
  );

  assert.ok(snapshot > work, 'the operator snapshot must live under the per-run WORK dir');
  assert.ok(snapshotCall > snapshot, 'the operator source snapshot helper must run with failure cleanup');
  assert.ok(launch > snapshotCall, 'the operator source must be frozen before Tauri launch');
  assert.ok(sourceEnv > launch, 'generated launch.sh must export the frozen operator source root');
  const pinnedDeps = source.match(/^snapshot_verifier_pinned_deps\(\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(pinnedDeps, 'the shared dependency snapshot helper must exist');
  assert.ok(pinnedDeps.includes('papercusp_pinned_deps_snapshot_locked "$REPO_DIR" "$snapshot_root" "$mode"'),
    'the helper must invoke the maintained locked dependency snapshot producer');
  for (const name of ['snapshot_operator_source', 'snapshot_committed_operator_source']) {
    const body = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, 'm'))?.[0];
    assert.ok(body?.includes('snapshot_verifier_pinned_deps "$snapshot_root"'),
      `${name} must delegate its dependency snapshot to the shared helper`);
  }
  assert.ok(source.indexOf('cleanup_operator_source_snapshot', teardown) > teardown);
  assert.ok(stop > 0, 'boot-only stop.sh must clean the operator source root');
  for (const excluded of [
    "--exclude='node_modules'",
    "--exclude='papercusp-desktop'",
    "--exclude='.git'",
    "--exclude='/dist'",
    "--exclude='coverage'",
  ]) {
    assert.ok(source.includes(excluded), `source snapshot must retain exclusion ${excluded}`);
  }
});

test('explicit verifier source roots are marker-checked and cannot fall back to the live checkout', () => {
  assert.match(devOperatorSource, /PAPERCUSP_DEV_SOURCE_ROOT/);
  assert.match(devOperatorSource, /apps\/operator\/package\.json/);
  assert.match(devOperatorSource, /libs\/papercusp\/package\.json/);
  assert.match(devOperatorSource, /PAPERCUSP_DEV_SOURCE_ROOT.*readable directory/);
  assert.match(devOperatorSource, /DEV_OPERATOR_DIR="\.\.\/apps\/operator"/);
  assert.match(devOperatorSource, /DEFAULT_DEV_CMD=.*cd \$DEV_OPERATOR_DIR_Q/);
});

test('a mutation after the simulated launch cannot change the captured operator source', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-tauri-operator-source-'));
  try {
    const donor = path.join(dir, 'donor');
    const snapshot = path.join(dir, 'snapshot');
    const sourceFile = path.join(donor, 'packages', 'operator-core', 'lib', 'mutation-fixture.ts');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.mkdirSync(path.join(donor, 'apps', 'operator'), { recursive: true });
    fs.writeFileSync(path.join(donor, 'apps', 'operator', 'package.json'), '{}\n');
    fs.mkdirSync(path.join(donor, 'libs', 'papercusp'), { recursive: true });
    fs.writeFileSync(path.join(donor, 'libs', 'papercusp', 'package.json'), '{}\n');
    fs.writeFileSync(sourceFile, 'export const version = "captured";\n');
    fs.cpSync(donor, snapshot, { recursive: true, dereference: false });

    // Model the verifier's launch boundary: a later shared-checkout edit is
    // outside the process's captured source read path.
    fs.writeFileSync(sourceFile, 'export const version = "mutated-after-launch";\n');
    assert.match(
      fs.readFileSync(path.join(snapshot, 'packages', 'operator-core', 'lib', 'mutation-fixture.ts'), 'utf8'),
      /captured/,
    );
    assert.match(fs.readFileSync(sourceFile, 'utf8'), /mutated-after-launch/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
