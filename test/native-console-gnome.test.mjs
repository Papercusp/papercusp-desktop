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
    const children = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim();
    for (const child of children.split(/\s+/).filter(Boolean)) ownedProcessSnapshot(Number(child), rows, seen);
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

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src-tauri/src/native_console.rs'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'src-tauri/src/main.rs'), 'utf8');
function functionSource(name) {
  const start = source.indexOf(`fn ${name}(`);
  const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
  const end = source.indexOf('\n' + indent + '}', start);
  assert.ok(start >= 0 && end > start, `production ${name} missing`);
  return source.slice(start, end + indent.length + 2);
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
