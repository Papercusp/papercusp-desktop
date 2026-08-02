/**
 * EI-19369470572700441 — every `tauri dev` launcher must claim a target-dir slot.
 *
 * WI-7101 fixed the corruption itself (bin/lib/claim-target-dir.sh) but wired it
 * into exactly ONE caller, leaving "remember to source the helper" as a
 * convention. Three launchers then forgot it — including
 * scripts/verify-tauri-headless.sh, the path root CLAUDE.md tells agents to use
 * for UI verification, so the DOCUMENTED safe practice was launching an
 * unprotected concurrent build against the shared ~/.cargo-target.
 *
 * The fix moved the claim to the `tauri` npm script (bin/tauri-guarded), which
 * every launcher already goes through. These tests are the recurrence guard for
 * that: one proves the chokepoint actually claims, the other proves nobody has
 * routed around it again.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync, readdirSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, relative } = require('node:path');

const DESKTOP_DIR = join(__dirname, '..');
const REPO_ROOT = join(DESKTOP_DIR, '..');
const GUARD = join(DESKTOP_DIR, 'bin', 'tauri-guarded');

/**
 * Run the guard with a stub `tauri` first on PATH, in a sandboxed HOME, and
 * report the CARGO_TARGET_DIR the real CLI would have been exec'd with. Driving
 * the wrapper end-to-end (rather than grepping it) is what makes this a
 * behavioural guard: it fails if the claim stops happening for ANY reason, not
 * just if the source line is deleted.
 */
function runGuard(args) {
  const home = mkdtempSync(join(tmpdir(), 'ei19369470-'));
  const shimDir = mkdtempSync(join(tmpdir(), 'ei19369470-bin-'));
  try {
    const shim = join(shimDir, 'tauri');
    writeFileSync(shim, '#!/usr/bin/env bash\nprintf "%s" "${CARGO_TARGET_DIR:-}"\n');
    chmodSync(shim, 0o755);
    return execFileSync('bash', [GUARD, ...args], {
      env: { ...process.env, HOME: home, CARGO_TARGET_DIR: '', PATH: `${shimDir}:${process.env.PATH}` },
      encoding: 'utf8',
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(shimDir, { recursive: true, force: true });
  }
}

test('the chokepoint claims a target-dir slot for `dev`', () => {
  const targetDir = runGuard(['dev', '--config', '{"build":{"devUrl":"http://127.0.0.1:3070"}}']);
  assert.match(
    targetDir,
    /cargo-target/,
    'the `tauri` npm script must claim a slot before exec-ing the CLI for `dev` — ' +
      'without it a concurrent build corrupts the shared app-manifest (WI-7101)',
  );
});

test('`build` is deliberately left alone — release cuts own their isolation', () => {
  assert.strictEqual(
    runGuard(['build', '--bundles', 'deb']),
    '',
    'claiming was scoped to `dev` on purpose; widening it silently changes release behaviour',
  );
});

test('flags before the subcommand do not hide it from the guard', () => {
  assert.match(runGuard(['--verbose', 'dev']), /cargo-target/);
});

/** Every file that could plausibly launch tauri: the shell entrypoints + npm scripts. */
function launcherFiles() {
  const files = [];
  for (const dir of [join(DESKTOP_DIR, 'bin'), join(REPO_ROOT, 'scripts')]) {
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      if (!statSync(full).isFile()) continue;
      files.push(full);
    }
  }
  return files;
}

test('no launcher routes around the chokepoint with a bare `tauri dev`', () => {
  const offenders = [];

  for (const file of launcherFiles()) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    text.split('\n').forEach((line, i) => {
      // Comments and docs discuss `tauri dev` constantly — only real invocations count.
      // Quoted spans go too: these scripts pass "tauri dev exited before the bridge
      // came up" to their diagnostics, and a guard that cries wolf on error prose is
      // one somebody eventually deletes. An invocation is unquoted by construction
      // (`tauri dev --config '{...}'` keeps its command words outside the quotes).
      const code = line.replace(/^\s*#.*$/, '').replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
      if (!/\btauri\s+dev\b/.test(code)) return;
      // `npm run tauri -- dev` (and `npm run tauri dev`) IS the chokepoint.
      if (/npm\s+run\s+tauri\b/.test(code)) return;
      offenders.push(`${relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
  }

  // npm scripts are launchers too — dev:hmr was one of the three original bypassers.
  for (const pkgPath of [join(DESKTOP_DIR, 'package.json'), join(REPO_ROOT, 'package.json')]) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
      continue;
    }
    for (const [name, body] of Object.entries(pkg.scripts ?? {})) {
      if (typeof body !== 'string') continue;
      if (!/\btauri\s+dev\b/.test(body)) continue;
      if (/npm\s+run\s+tauri\b/.test(body)) continue;
      offenders.push(`${relative(REPO_ROOT, pkgPath)} scripts.${name}: ${body}`);
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    'these launch `tauri dev` without going through `npm run tauri` (bin/tauri-guarded), ' +
      'so they claim no target-dir slot and can corrupt a concurrent build\'s generated ' +
      'app-manifest — WI-7101 / EI-19369470572700441. Route them through `npm run tauri -- dev`:\n' +
      offenders.join('\n'),
  );
});

test('the `tauri` npm script is still wired to the guard', () => {
  const pkg = JSON.parse(readFileSync(join(DESKTOP_DIR, 'package.json'), 'utf8'));
  assert.match(
    pkg.scripts.tauri,
    /tauri-guarded/,
    'every launcher reaches the slot claim through this one script — unwiring it ' +
      'silently unprotects all of them at once',
  );
});
