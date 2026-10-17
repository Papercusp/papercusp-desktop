import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

// Capture only this command's descendants, while they still exist. Sampling after
// spawnSync returns loses the wait state that distinguishes a compiler from a lock.
function ownedProcessSnapshot(pid, rows = [], seen = new Set()) {
  if (process.platform !== 'linux' || !pid || seen.has(pid) || rows.length >= 32) return rows;
  seen.add(pid);
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    rows.push({ pid, command: fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(),
      state: fields[0], cpuTicks: Number(fields[11]) + Number(fields[12]),
      waitChannel: fs.readFileSync(`/proc/${pid}/wchan`, 'utf8').trim() });
    // A child is recorded under the Linux task (thread) that created it, not
    // necessarily the process-group leader. Cargo/rustc helpers may be spawned
    // by a worker thread, so reading only task/<pid>/children can omit the very
    // compiler process this timeout diagnostic is meant to explain.
    const childPids = new Set();
    for (const taskId of fs.readdirSync(`/proc/${pid}/task`)) {
      try {
        const children = fs.readFileSync(`/proc/${pid}/task/${taskId}/children`, 'utf8').trim();
        for (const child of children.split(/\s+/).filter(Boolean)) childPids.add(Number(child));
      } catch (error) {
        // Threads can exit between readdir and read; the process snapshot is
        // still useful, and any surviving child is reachable from another row.
        if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error;
      }
    }
    for (const child of childPids) ownedProcessSnapshot(child, rows, seen);
  } catch (error) {
    rows.push({ pid, unavailable: error.code || error.message });
  }
  return rows;
}

async function runFixtureCommand(command, args, { env = process.env, timeout, stage }) {
  const started = performance.now();
  const child = spawn(command, args, { env, detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', error, processesBeforeTimeout;
  child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-64 * 1024); });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-64 * 1024); });
  child.on('error', cause => { error = cause; });
  const timer = setTimeout(() => {
    processesBeforeTimeout = ownedProcessSnapshot(child.pid);
    error = Object.assign(new Error(`${command} exceeded ${timeout}ms`), { code: 'ETIMEDOUT' });
    // The command owns a fresh process group. Kill its compiler/test children as
    // well, so inherited pipes cannot keep a timed-out fixture alive indefinitely.
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch (cause) {
      if (cause.code !== 'ESRCH') error.message += `; cleanup: ${cause.message}`;
    }
  }, timeout);
  return new Promise(resolve => child.once('close', (status, signal) => {
    clearTimeout(timer);
    resolve({ status, signal, stdout, stderr, error, stage, command, args, pid: child.pid,
      elapsedMs: Math.round(performance.now() - started), timeoutMs: timeout, processesBeforeTimeout });
  }));
}

function cargoFailureMessage(result) {
  const tail = (value) => typeof value === 'string' ? value.trim().slice(-3000) : '';
  const stdout = tail(result.stdout);
  const stderr = tail(result.stderr);
  return [
    result.stage ? `stage: ${result.stage}; command: ${JSON.stringify([result.command, ...result.args])}; ` +
      `elapsed: ${result.elapsedMs}ms; timeout: ${result.timeoutMs}ms; status: ${result.status}; signal: ${result.signal}` : '',
    result.error ? `spawn error: ${result.error.message || result.error}` : '',
    result.processesBeforeTimeout ? `owned processes before timeout: ${JSON.stringify(result.processesBeforeTimeout)}` : '',
    stdout ? `stdout (last 3000 chars):\n${stdout}` : '',
    stderr ? `stderr (last 3000 chars):\n${stderr}` : '',
  ].filter(Boolean).join('\n\n') || 'cargo command exited without captured output';
}

test('Cargo failure diagnostics retain stdout and stderr tails', () => {
  const message = cargoFailureMessage({
    status: 101,
    stdout: 'test failing_case ... FAILED',
    stderr: 'tar: Exiting with failure status due to previous errors',
  });
  assert.match(message, /test failing_case \.\.\. FAILED/);
  assert.match(message, /tar: Exiting with failure status/);
});

test('Cargo fixture timeout captures the live owned process tree before cleanup',
  { skip: process.platform !== 'linux', timeout: 10000 }, async () => {
    // Inherited pipes make this hang if cleanup kills only the immediate child.
    const driver = `const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
        { stdio: ['ignore', 'inherit', 'inherit'] });
      console.log('DESCENDANT_PID=' + child.pid);
      setInterval(() => {}, 1000);`;
    const result = await runFixtureCommand(process.execPath, ['-e', driver],
      { timeout: 2000, stage: 'timeout-regression' });
    assert.equal(result.error?.code, 'ETIMEDOUT');
    assert.equal(result.signal, 'SIGKILL');
    assert.ok(result.processesBeforeTimeout.some(row => row.pid === result.pid && row.state &&
      typeof row.waitChannel === 'string'), JSON.stringify(result.processesBeforeTimeout));
    const descendantPid = Number(result.stdout.match(/DESCENDANT_PID=(\d+)/)?.[1]);
    assert.ok(descendantPid > 0, result.stdout);
    assert.ok(result.processesBeforeTimeout.some(row => row.pid === descendantPid && row.state),
      JSON.stringify(result.processesBeforeTimeout));
    assert.equal(fs.existsSync(`/proc/${result.pid}`), false, 'timed-out command must be reaped');
    const message = cargoFailureMessage(result);
    assert.match(message, /stage: timeout-regression/);
    assert.match(message, /owned processes before timeout:/);
    assert.match(message, /timeout: 2000ms/);
  });

test('Cargo fixture timeout captures children spawned by a worker thread',
  { skip: process.platform !== 'linux', timeout: 10000 }, async () => {
    const driver = `const { Worker } = require('node:worker_threads');
      const worker = new Worker(\`
        const { spawn } = require('node:child_process');
        const { parentPort } = require('node:worker_threads');
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
          { stdio: ['ignore', 'inherit', 'inherit'] });
        parentPort.postMessage(child.pid);
        setInterval(() => {}, 1000);
      \`, { eval: true });
      worker.once('message', pid => console.log('WORKER_DESCENDANT_PID=' + pid));
      setInterval(() => {}, 1000);`;
    const result = await runFixtureCommand(process.execPath, ['-e', driver],
      { timeout: 2000, stage: 'worker-thread-timeout-regression' });
    assert.equal(result.error?.code, 'ETIMEDOUT');
    assert.equal(result.signal, 'SIGKILL');
    const descendantPid = Number(result.stdout.match(/WORKER_DESCENDANT_PID=(\d+)/)?.[1]);
    assert.ok(descendantPid > 0, result.stdout);
    assert.ok(result.processesBeforeTimeout.some(row => row.pid === descendantPid && row.state),
      JSON.stringify(result.processesBeforeTimeout));
    assert.equal(fs.existsSync(`/proc/${result.pid}`), false, 'timed-out command must be reaped');
  });

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src-tauri/src/native_console.rs'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'src-tauri/src/main.rs'), 'utf8');

test('production Windows focus handles a denied foreign-window move and verifies activation', { timeout: 30000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-console-focus-'));
  try {
    const driver = path.join(temp, 'focus.rs');
    const binary = path.join(temp, 'focus-test');
    fs.writeFileSync(driver, `
#![allow(non_snake_case, non_upper_case_globals, dead_code, unused_unsafe)]
use std::cell::RefCell;
#[derive(Clone)] struct State { current: bool, target_desktop: u32, active_desktop: u32, wrong_move: bool, allow_move: bool, allow_activation: bool, cloaked: bool, minimized: bool, foreground: isize, moves: usize, switches: usize, duplicate: bool }
impl Default for State { fn default() -> Self { Self { current: false, target_desktop: 2, active_desktop: 1, wrong_move: false, allow_move: false, allow_activation: true, cloaked: false, minimized: true, foreground: 2, moves: 0, switches: 0, duplicate: false } } }
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }
fn state<R>(f: impl FnOnce(&mut State) -> R) -> R { STATE.with(|s| f(&mut s.borrow_mut())) }
#[derive(Clone, Copy)] struct Bool(bool); impl Bool { fn as_bool(self) -> bool { self.0 } }
mod windows { pub mod core { pub struct GUID; impl GUID { pub fn zeroed() -> u32 { 0 } } } pub mod Win32 {
 pub mod Foundation { #[derive(Clone, Copy, PartialEq)] pub struct HWND(pub *mut std::ffi::c_void); }
 pub mod Graphics { pub mod Dwm { pub const DWMWA_CLOAKED: u32 = 14; pub unsafe fn DwmGetWindowAttribute(_: super::super::Foundation::HWND, _: u32, v: *mut std::ffi::c_void, _: u32) -> Result<(),()> { *(v as *mut u32) = crate::state(|s| s.cloaked as u32); Ok(()) } } }
 pub mod System { pub mod Com {
  pub const CLSCTX_INPROC_SERVER: () = (); pub const COINIT_APARTMENTTHREADED: () = ();
  pub fn CoInitializeEx(_: Option<()>, _: ()) -> Result<(),()> { Ok(()) } pub fn CoUninitialize() {}
  pub fn CoCreateInstance(_: &(), _: Option<()>, _: ()) -> Result<super::super::UI::Shell::IVirtualDesktopManager,()> { Ok(super::super::UI::Shell::IVirtualDesktopManager) }
 } }
 pub mod UI {
  pub mod Shell {
   pub const VirtualDesktopManager: () = (); pub struct IVirtualDesktopManager;
   impl IVirtualDesktopManager {
    pub fn IsWindowOnCurrentVirtualDesktop(&self, _: super::super::Foundation::HWND) -> Result<crate::Bool,()> { Ok(crate::Bool(crate::state(|s| s.current))) }
    pub fn GetWindowDesktopId(&self, h: super::super::Foundation::HWND) -> Result<u32,()> { Ok(crate::state(|s| if h.0 as isize==1 {s.target_desktop} else {s.active_desktop})) }
    pub fn MoveWindowToDesktop(&self, _: super::super::Foundation::HWND, d: &u32) -> Result<(),()> { crate::state(|s| { s.moves += 1; if s.allow_move { s.current = true; if s.wrong_move {s.active_desktop=s.target_desktop} else {s.target_desktop=*d}; Ok(()) } else { Err(()) } }) }
   }
  }
  pub mod WindowsAndMessaging {
   use super::super::Foundation::HWND; pub const SW_RESTORE: i32 = 9;
   pub fn GetForegroundWindow() -> HWND { HWND(crate::state(|s| s.foreground) as *mut _) }
   pub fn IsIconic(_: HWND) -> crate::Bool { crate::Bool(crate::state(|s| s.minimized)) }
   pub fn IsWindowVisible(_: HWND) -> crate::Bool { crate::Bool(true) }
   pub fn SetForegroundWindow(h: HWND) -> Result<(),()> { crate::state(|s| { if s.current { s.foreground = h.0 as isize; } }); Ok(()) }
   pub fn ShowWindow(_: HWND, _: i32) -> crate::Bool { crate::state(|s| s.minimized = false); crate::Bool(true) }
   pub fn SwitchToThisWindow(h: HWND, _: bool) { crate::state(|s| { s.switches += 1; if s.allow_activation { s.active_desktop=s.target_desktop; s.current = true; s.foreground = h.0 as isize; } }); }
  }
 }
} }
mod tauri { pub mod async_runtime { pub async fn spawn_blocking<T>(f: impl FnOnce() -> T) -> Result<T,()> { Ok(f()) } } }
struct DesktopWindow { title: String, hwnd: String }
fn enumerate_windows(_: Option<&str>) -> Vec<DesktopWindow> { (0..crate::state(|s| if s.duplicate {2} else {1})).map(|_| DesktopWindow { title: "Agent".into(), hwnd: "1".into() }).collect() }
fn run_mode(mode: &str) -> bool { let mut future = std::pin::pin!(focus_window_by_title_observed("Agent".into(),mode.into())); let mut cx = std::task::Context::from_waker(std::task::Waker::noop()); match std::future::Future::poll(future.as_mut(), &mut cx) { std::task::Poll::Ready(v) => v, _ => panic!("unexpected pending fixture") } }
fn run() -> bool {run_mode("window")}
${functionSource('focus_window_by_title_observed')}
#[test] fn switch_mode_observes_target_desktop_without_foreign_move() { assert!(run()); state(|s| { assert_eq!(s.moves,0); assert_eq!(s.switches,1); assert_eq!(s.foreground,1); assert_eq!(s.active_desktop,2); assert!(!s.minimized); }); }
#[test] fn denied_bring_here_never_switches_or_reports_success() {assert!(!run_mode("current"));state(|s|{assert_eq!(s.moves,1);assert_eq!(s.switches,0);assert_eq!(s.active_desktop,1);assert_eq!(s.foreground,2);});}
#[test] fn switched_desktop_cannot_masquerade_as_successful_move() {state(|s|{s.allow_move=true;s.wrong_move=true;});assert!(!run_mode("current"));}
#[test] fn denied_activation_never_reports_success() { state(|s| s.allow_activation=false); assert!(!run()); }
#[test] fn still_cloaked_never_reports_success() { state(|s| s.cloaked=true); assert!(!run()); }
#[test] fn current_desktop_needs_no_move_or_fallback() { state(|s| s.current=true); assert!(run()); state(|s| { assert_eq!(s.moves,0); assert_eq!(s.switches,0); }); }
#[test] fn successful_move_needs_no_fallback() { state(|s| s.allow_move=true); assert!(run_mode("current")); state(|s| {assert_eq!(s.switches,0);assert_eq!(s.target_desktop,1);assert_eq!(s.active_desktop,1);}); }
#[test] fn ambiguous_windows_are_untouched() { state(|s| s.duplicate=true); assert!(!run()); state(|s| { assert_eq!(s.moves,0); assert_eq!(s.switches,0); assert!(s.minimized); }); }
`);
    const compile = await runFixtureCommand('rustc', ['--edition=2021', '--test', '--cfg', 'target_os="windows"', '-Aexplicit_builtin_cfgs_in_flags', driver, '-o', binary], { timeout: 15000, stage: 'windows-focus-fixture-compile' });
    assert.equal(compile.status, 0, compile.stderr);
    const run = await runFixtureCommand(binary, [], { timeout: 10000, stage: 'windows-focus-fixture-run' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /8 passed; 0 failed/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

function functionSource(name) {
  const start = source.indexOf(`fn ${name}(`);
  const lineStart = source.lastIndexOf('\n', start) + 1;
  const indent = source.slice(lineStart, start).match(/^\s*/)[0];
  const end = source.indexOf('\n' + indent + '}', start);
  assert.ok(start >= 0 && end > start, `production ${name} missing`);
  return source.slice(lineStart + indent.length, end + indent.length + 2);
}
function structSource(name) {
  const start = source.indexOf(`pub struct ${name} {`);
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, `production ${name} missing`);
  return source.slice(start, end + 2).replace(/^\s*#\[serde[^\n]*\]\n/gm, '');
}

test('production native GNOME preparation and both entrypoints preserve preferences and fail before spawn',
  { skip: process.platform !== 'linux', timeout: 120000 }, async () => {
    // Reuse the desktop's lightweight production-helper Cargo fixture pattern.
    // The production bodies and their production tests are compiled verbatim.
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-console-gnome-'));
    try {
      const policyImport = source.match(/const GNOME_TERMINAL_POLICY: &str = include_str!\("([^"]+)"\);/);
      assert.ok(policyImport, 'native policy is not compiled into the installed shell');
      const policyPath = path.resolve(root, 'src-tauri/src', policyImport[1]);
      assert.equal(policyPath, path.resolve(root, '../packages/operator-core/lib/gnome-terminal-policy.json'));
      const contextStart = source.indexOf('const TERMINAL_CONTEXT_ENV_KEYS:');
      const contextEnd = source.indexOf('\n];', contextStart);
      assert.ok(contextStart >= 0 && contextEnd > contextStart);
      const fixtureStart = source.indexOf('    #[cfg(target_os = "linux")]\n    struct TerminalFixture');
      const fixtureEnd = source.indexOf('    fn envelope(', fixtureStart);
      assert.ok(fixtureStart >= 0 && fixtureEnd > fixtureStart, 'production native GNOME regression tests missing');
      const driver = path.join(temp, 'native.rs');
      // Preserve the production declaration's platform attributes. An unconditional
      // fixture import or cargo test alone masks a Windows/test-only module gate.
      const moduleDeclaration = mainSource.match(/((?:#\[[^\n]+\]\r?\n)*)mod wsl_sidecar_staging;/)?.[0];
      assert.ok(moduleDeclaration, 'production bounded-output module declaration missing');
      fs.writeFileSync(driver, [
        'use std::collections::HashMap; use std::path::PathBuf;',
        `#[path=${JSON.stringify(path.join(root, 'src-tauri/src/wsl_sidecar_staging.rs'))}]`,
        moduleDeclaration,
        structSource('ConsoleEnvelope'), structSource('ExternalConsoleSpec'),
        source.slice(contextStart, contextEnd + 3),
        `const GNOME_TERMINAL_POLICY: &str = include_str!(${JSON.stringify(policyPath)});`,
        ...['is_valid_env_name', 'strip_terminal_context_env', 'prepare_linux_terminal_args',
          'gnome_preparation_error', 'spawn_linux_with', 'spawn_external_with'].map(functionSource),
        '#[cfg(test)] mod tests { use super::*;',
        source.slice(fixtureStart, fixtureEnd), functionSource('envelope'), '}',
      ].join('\n'));
      const manifest = path.join(temp, 'Cargo.toml');
      fs.writeFileSync(manifest, [
        '[package]', 'name="native-console-gnome-regression"', 'version="0.0.0"', 'edition="2021"',
        '[workspace]', '[lib]', `path=${JSON.stringify(driver)}`, '[dependencies]',
        'serde_json="1"', 'uuid={version="1",features=["v4"]}', 'libc="0.2"',
      ].join('\n'));
      const runCargo = async (args) => {
        const result = await runFixtureCommand(process.env.CARGO || 'cargo', [...args, '--offline', '--manifest-path', manifest],
          {
            stage: `cargo ${args.join(' ')}`,
            timeout: 55000,
            // Each fixture starts several owned child processes with five-second
            // operation bounds; parallel Rust tests can starve otherwise tiny archives.
            env: { ...process.env, CARGO_TARGET_DIR: path.join(temp, 'target'), RUST_TEST_THREADS: '1' },
          });
        assert.equal(result.status, 0, cargoFailureMessage(result));
        return result;
      };
      // Compile the production helper bodies and declaration without cfg(test)
      // before running their behavioral regressions.
      await runCargo(['check', '--lib']);
      const run = await runCargo(['test']);
      for (const name of ['gnome_preparation_preserves_explicit_profiles_and_other_emulators',
        'gnome_preparation_verifies_default_and_finite_history_receipts',
        'both_native_gnome_entrypoints_prepare_before_spawn_and_refuse_dependency_failures']) {
        assert.ok(run.stdout.includes(`tests::${name} ... ok`), run.stdout);
      }
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
