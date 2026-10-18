'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const smoke = path.resolve(__dirname, '../bin/vm-smoke-windows.sh');
const guiPath = 'C:\\Users\\User\\AppData\\Local\\Papercusp GUI\\papercusp-desktop.exe';
const visibleGui = { id: 42, path: guiPath, sessionId: 1, windowHandle: 123, windowVisible: true };

function runSmoke(processes, overrides = {}) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-gui-smoke-'));
  try {
    fs.writeFileSync(path.join(fixture, 'ssh'), [
      '#!/bin/sh',
      'case "$*" in',
      '  *"echo VM-OK"*) printf "%s\\n" VM-OK ;;',
      '  *"wsl -l -v"*) printf "%s\\n" "papercup-runtime Running 2" ;;',
      // The old guard admits every fixture, even Server-only and Session 0.
      '  *tasklist*) printf "%s\\n" papercusp-desktop.exe ;;',
      '  *-EncodedCommand*) printf "%s\\n" "$WINDOWS_SMOKE_FIXTURE" ;;',
      '  *) exit 99 ;;',
      'esac',
      '',
    ].join('\n'), { mode: 0o755 });
    return spawnSync('bash', [smoke], {
      encoding: 'utf8', timeout: 5000,
      env: {
        ...process.env, PATH: `${fixture}:${process.env.PATH}`, VM_SMOKE_GUI_ONLY: '1',
        WINDOWS_SMOKE_FIXTURE: JSON.stringify({ guiPath, activeSessionId: 1, probeSessionId: 1, processes, ...overrides }),
      },
    });
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}

test('GUI-only smoke rejects a Server process with the same executable name', () => {
  const result = runSmoke([{ ...visibleGui, path: guiPath.replace('Papercusp GUI', 'Papercusp Server') }]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /no installed GUI with a visible window/);
});

test('GUI-only smoke rejects a GUI running in Session 0', () => {
  const result = runSmoke([{ ...visibleGui, sessionId: 0 }]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /no installed GUI with a visible window/);
});

test('GUI-only smoke rejects a GUI in another interactive session', () => {
  const result = runSmoke([{ ...visibleGui, sessionId: 2 }]);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /no installed GUI with a visible window/);
});

test('GUI-only smoke requires a real visible top-level window', () => {
  for (const change of [{ windowHandle: 0 }, { windowVisible: false }]) {
    const result = runSmoke([{ ...visibleGui, ...change }]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /no installed GUI with a visible window/);
  }
});

test('GUI-only smoke rejects an unavailable active console session', () => {
  for (const activeSessionId of [null, 0, 4294967295]) {
    const result = runSmoke([visibleGui], { activeSessionId });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /no active console session/);
  }
});

test('GUI-only smoke rejects a window witness collected from SSH Session 0', () => {
  const result = runSmoke([visibleGui], { probeSessionId: 0 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /window witness did not run in the active console session/);
});

test('GUI-only smoke accepts the exact GUI visible in the active console session', () => {
  const result = runSmoke([{ ...visibleGui, path: guiPath.toLowerCase() }]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /GUI-ONLY SMOKE/);
  assert.match(result.stdout, /visible GUI.*session 1/i);
});
