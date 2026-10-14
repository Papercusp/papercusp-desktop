const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src-tauri/src/zoom-shortcuts.js'), 'utf8');
const storageKey = 'papercusp.desktop.zoom';

function desktop({ mac = false, stored, storageUnavailable = false, invoke } = {}) {
  const listeners = new Map();
  const calls = [];
  const warnings = [];
  const storage = new Map(stored === undefined ? [] : [[storageKey, String(stored)]]);
  const window = {
    localStorage: {
      getItem(key) {
        if (storageUnavailable) throw new Error('storage unavailable');
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageUnavailable) throw new Error('storage unavailable');
        storage.set(key, value);
      },
    },
    __TAURI_INTERNALS__: {
      metadata: { currentWebview: { label: 'ws-test' } },
      async invoke(command, args) {
        calls.push({ command, label: args.label, value: args.value });
        if (invoke) await invoke(args.value);
      },
    },
    addEventListener(name, handler, options) {
      listeners.set(name, { handler, options });
    },
  };
  vm.runInNewContext(source.replace('__PAPERCUSP_ZOOM_MACOS__', String(mac)), {
    window, console: { warn: (...args) => warnings.push(args) },
  });
  return {
    calls, warnings, storage, listeners,
    ready: () => listeners.get('DOMContentLoaded').handler(),
    press(key, overrides = {}) {
      const event = {
        key, code: '', ctrlKey: !mac, metaKey: mac, altKey: false,
        shiftKey: false, isComposing: false, target: { tagName: 'INPUT' },
        prevented: false, stopped: false,
        preventDefault() { this.prevented = true; },
        stopImmediatePropagation() { this.stopped = true; },
        ...overrides,
      };
      listeners.get('keydown').handler(event);
      return event;
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('plus/equal, minus and zero apply browser zoom steps to the current native webview', async () => {
  const app = desktop();
  assert.equal(app.listeners.get('keydown').options, true);
  for (const key of ['=', '+', '-', '0']) {
    const event = app.press(key, { shiftKey: key === '+' });
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
  }
  await settle();
  assert.deepEqual(app.calls, [1.1, 1.25, 1.1, 1].map((value) => ({
    command: 'plugin:webview|set_webview_zoom', label: 'ws-test', value,
  })));
  assert.equal(app.storage.get(storageKey), '1');
});

test('keypad plus, minus and zero work with focused editable content', async () => {
  const app = desktop();
  app.press('+', { code: 'NumpadAdd', target: { isContentEditable: true } });
  app.press('-', { code: 'NumpadSubtract', target: { tagName: 'TEXTAREA' } });
  app.press('0', { code: 'Numpad0' });
  await settle();
  assert.deepEqual(app.calls.map((call) => call.value), [1.1, 1, 1]);
});

test('macOS uses Command and Linux/Windows use Control regardless of navigator.platform', async () => {
  for (const mac of [true, false]) {
    const app = desktop({ mac });
    assert.equal(app.press('+', { ctrlKey: mac, metaKey: !mac }).prevented, false);
    assert.equal(app.press('+').prevented, true);
    await settle();
    assert.deepEqual(app.calls.map((call) => call.value), [1.1]);
  }
});

test('plain keys, unrelated shortcuts, AltGr and composition are left alone', async () => {
  const app = desktop();
  const events = [
    app.press('+', { ctrlKey: false }),
    app.press('0', { ctrlKey: false }),
    app.press('f'), app.press('+', { altKey: true }),
    app.press('-', { metaKey: true }), app.press('+', { isComposing: true }),
  ];
  for (const event of events) {
    assert.equal(event.prevented, false);
    assert.equal(event.stopped, false);
  }
  await settle();
  assert.deepEqual(app.calls, []);
});

test('zoom stays within browser limits and reset restores exactly 100%', async () => {
  const app = desktop();
  for (let i = 0; i < 25; i++) app.press('+');
  await settle();
  assert.equal(app.calls.at(-1).value, 5);
  for (let i = 0; i < 35; i++) app.press('-');
  await settle();
  assert.equal(app.calls.at(-1).value, 0.25);
  app.press('0');
  await settle();
  assert.equal(app.calls.at(-1).value, 1);
});

test('saved zoom restores after metadata initialization and survives a new document', async () => {
  const app = desktop({ stored: 1.5 });
  app.ready();
  await settle();
  assert.equal(app.calls[0].value, 1.5);
  app.press('+');
  await settle();
  const reloaded = desktop({ stored: app.storage.get(storageKey) });
  reloaded.ready();
  await settle();
  assert.equal(reloaded.calls[0].value, 1.75);
});

test('invalid saved levels fall back to 100% and storage failures do not disable zoom', async () => {
  for (const stored of ['invalid', -1, 1000, 1.234]) {
    const app = desktop({ stored });
    app.ready();
    await settle();
    assert.equal(app.calls[0].value, 1);
  }
  const app = desktop({ storageUnavailable: true });
  app.press('+');
  await settle();
  assert.equal(app.calls[0].value, 1.1);
  assert.deepEqual(app.warnings, []);
});

test('rapid presses serialize native IPC and a refused zoom can recover', async () => {
  let release;
  const firstCall = new Promise((resolve) => { release = resolve; });
  const app = desktop({ invoke: (value) => value === 1.1 ? firstCall : undefined });
  app.press('+');
  app.press('+');
  await settle();
  assert.deepEqual(app.calls.map((call) => call.value), [1.1]);
  release();
  await settle();
  assert.deepEqual(app.calls.map((call) => call.value), [1.1, 1.25]);

  let fail = true;
  const recovering = desktop({ invoke: () => { if (fail) throw new Error('refused'); } });
  recovering.press('+');
  await settle();
  assert.equal(recovering.warnings.length, 1);
  assert.equal(recovering.storage.has(storageKey), false);
  fail = false;
  recovering.press('+');
  await settle();
  assert.deepEqual(recovering.calls.map((call) => call.value), [1.1, 1.1]);
  assert.equal(recovering.storage.get(storageKey), '1.1');
});

test('desktop startup injects the script on every navigation and grants native zoom IPC', () => {
  const main = fs.readFileSync(path.join(root, 'src-tauri/src/main.rs'), 'utf8');
  assert.match(main, /append_invoke_initialization_script\([\s\S]*?include_str!\("zoom-shortcuts\.js"\)\.replace\(/);
  assert.match(main, /cfg!\(target_os = "macos"\)/);
  const capability = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/capabilities/default.json'), 'utf8'));
  assert.ok(capability.permissions.includes('core:webview:allow-set-webview-zoom'));
});

// Run through scripts/verify-tauri-headless.sh: the wrapper verifies bridge
// ownership and supplies an isolated display/profile. Never attach to a human GUI.
test('native webview zoom responds to keyboard shortcuts and survives reload', {
  skip: !process.env.VERIFY_TAURI_PID,
  timeout: 120_000,
}, () => {
  assert.equal(process.env.VERIFY_TAURI_ISOLATED_DB, '1', 'native zoom proof requires a disposable WebView profile');
  assert.ok(process.env.VERIFY_TAURI_POLL);
  const pid = process.env.VERIFY_TAURI_PID;
  const evaluate = (script) => execFileSync('tauri-agent-tools', ['eval', '--pid', pid, script], { timeout: 15_000 });
  const check = (predicate) => execFileSync(process.env.VERIFY_TAURI_POLL, [
    '--require', 'body', '--eval', predicate,
  ], { timeout: 45_000 });
  const press = (key) => evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {
    key: ${JSON.stringify(key)}, ctrlKey: true, bubbles: true, cancelable: true
  })); true`);

  press('0');
  evaluate('window.__desktopZoomBaseline = window.innerWidth; true');
  evaluate(`const input = document.createElement('input');
    input.id = 'desktop-zoom-verification'; document.body.appendChild(input); input.focus(); true`);
  press('+');
  check("document.activeElement?.id === 'desktop-zoom-verification' && window.innerWidth < window.__desktopZoomBaseline * 0.95");
  press('-');
  check('Math.abs(window.innerWidth - window.__desktopZoomBaseline) <= 1');
  press('+');
  press('+');
  check('window.innerWidth < window.__desktopZoomBaseline * 0.85');
  evaluate('window.sessionStorage.setItem("desktop-zoom-baseline", String(window.__desktopZoomBaseline)); location.reload(); true');
  check('Number(window.sessionStorage.getItem("desktop-zoom-baseline")) > 0 && window.innerWidth < Number(window.sessionStorage.getItem("desktop-zoom-baseline")) * 0.85');
  press('0');
  check('Number(window.sessionStorage.getItem("desktop-zoom-baseline")) > 0 && Math.abs(window.innerWidth - Number(window.sessionStorage.getItem("desktop-zoom-baseline"))) <= 1');
});
