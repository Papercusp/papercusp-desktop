const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const main = fs.readFileSync(path.join(__dirname, '../src-tauri/src/main.rs'), 'utf8');

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
});
