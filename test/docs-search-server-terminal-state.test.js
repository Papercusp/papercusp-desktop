const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '../src-tauri/src/main.rs'), 'utf8');
const cargo = fs.readFileSync(path.join(__dirname, '../src-tauri/Cargo.toml'), 'utf8');

test('native route handoffs preserve pending acknowledgements while navigating the current webview', () => {
  const start = main.indexOf('fn navigate_window_to_route');
  assert.ok(start >= 0, 'the shared native route handler must exist');
  const handler = main.slice(start, main.indexOf('\n}', start) + 2);
  const template = handler.match(/format!\(\s*("(?:\\.|[^"\\])*")/);
  assert.ok(template, 'exercise the actual native navigation script');
  const navigation = JSON.parse(template[1]);

  for (const route of ['/reports?sel=rpt_exact&ws=workspace-a', '/plans?sel=workbench#D-024', '/reports?sel=quoted\"value']) {
    let location = new URL('http://127.0.0.1:33701/reports?sel=rpt_newer&hist=true');
    const pending = { done: false };
    const events = [];
    const navigations = [];
    const window = {
      __reportsPublication: pending,
      location: {
        get href() { return location.href; },
        assign(target) {
          location = new URL(target, location);
          delete window.__reportsPublication;
        },
      },
      history: {
        pushState(state, title, target) {
          navigations.push(target);
          location = new URL(target, location);
        },
      },
      dispatchEvent(event) { events.push(event.type); },
    };
    class PopStateEvent {
      constructor(type) { this.type = type; }
    }

    vm.runInNewContext(navigation.replace('{}', JSON.stringify(route)), { window, PopStateEvent });

    assert.equal(window.__reportsPublication, pending, 'navigation must not unload the pending intent/request');
    assert.equal(window.location.href, new URL(route, 'http://127.0.0.1:33701').href);
    assert.deepEqual(navigations, [route]);
    assert.deepEqual(events, ['popstate']);
  }
});

test('a rejected shortcut rebind rebuilds native tray checkmarks from the persisted choice', () => {
  const start = main.indexOf('} else if let Some(payload) = id.strip_prefix(DOCS_SHORTCUT_MENU_PREFIX)');
  const handler = main.slice(start, main.indexOf('    // Reuse the bundle icon', start));
  const refusal = handler.indexOf('docs-search set to {payload} failed');
  const rebuild = handler.indexOf('match build_server_tray_menu(app)');
  assert.ok(refusal >= 0, 'the refused rebind must be reported');
  assert.ok(rebuild > refusal, 'the menu rebuild must also run after a refused rebind');
});

test('the Server manages disabled NativeTerminal state before registering the docs shortcut', () => {
  const setup = main.slice(main.indexOf('.setup(move |app| {'), main.indexOf('.run(|app_handle, event|'));
  const manage = setup.indexOf('init_native_terminal(app, is_dev || role.is_gui())');
  const register = setup.indexOf('docs_search::register_shortcut(app)', manage);
  assert.ok(manage >= 0, 'all roles must manage NativeTerminal, including the windowless Server');
  assert.ok(register > manage, 'shortcut registration must follow state initialization');

  const init = main.slice(main.indexOf('fn init_native_terminal('), main.indexOf('\n}', main.indexOf('fn init_native_terminal(')) + 2);
  assert.match(init, /if window_owner \{[\s\S]*resolve_strategy_from_env\(\)[\s\S]*\} else \{[\s\S]*TerminalStrategy::Disabled/);
  assert.match(init, /app\.manage\(nt\)/);
});

test('the Mac verification rsync preserves remote Papercusp runtime scratch', () => {
  const script = fs.readFileSync(path.join(__dirname, '../bin/mac-vm-verify-build.sh'), 'utf8');
  const transfer = script.match(/rsync -az --delete[\s\S]*?"\$SNAP\/" "\$VM:\$VMDIR\/"/);
  assert.ok(transfer, 'the snapshot transfer must be present');
  assert.match(transfer[0], /--exclude '\/\.papercusp\/'/);
  assert.match(transfer[0], /--exclude '\/papercusp-desktop\/src-tauri\/sidecar\/'/);
  assert.match(transfer[0], /--exclude '\/papercusp-desktop\/src-tauri\/macos-term-shim\/\.build\/'/);
});

test('the packaged Server enables Tauri data URLs for the offline Quick Panel diagnostic', () => {
  assert.match(cargo, /^tauri = .*"webview-data-url"/m);
});
