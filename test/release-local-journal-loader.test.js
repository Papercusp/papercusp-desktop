'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const release = fs.readFileSync(path.join(__dirname, '../bin/release-local.sh'), 'utf8');
function shellFunction(name) {
  const definition = release.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}\\n`, 'm'))?.[0];
  assert.ok(definition, `missing shell function: ${name}`);
  return definition;
}

function fixture(context, mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-journal-loader-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'papercusp-desktop/bin');
  const modules = path.join(root, 'node_modules');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(modules, 'tsx'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(modules, 'tsx/package.json'), '{"name":"tsx","type":"module","exports":"./loader.mjs"}');
  fs.writeFileSync(path.join(modules, 'tsx/loader.mjs'), mode === 'broken-loader'
    ? 'import "missing-journal-loader-dependency";\n' : 'export {};\n');
  if (mode === 'missing-loader') fs.rmSync(path.join(modules, 'tsx'), { recursive: true });
  const store = path.join(modules, '@papercusp/operator-core');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'package.json'), JSON.stringify({
    name: '@papercusp/operator-core', type: 'module',
    exports: { './lib/task-manager/store': './store.mjs' },
  }));
  fs.writeFileSync(path.join(store, 'store.mjs'), mode === 'broken-ledger'
    ? 'import "missing-journal-ledger-dependency";\n' : 'export {};\n');
  const cli = path.join(root, 'journal.mjs');
  fs.writeFileSync(cli, mode === 'broken-adapter'
    ? 'import "missing-journal-adapter-dependency";\n'
    : 'if (process.argv[1] === new URL(import.meta.url).pathname) console.log(JSON.stringify(process.argv.slice(2)));\n');
  // An implicit npx install must never rescue a missing local loader.
  const npxMarker = path.join(root, 'npx-called');
  fs.writeFileSync(path.join(bin, 'npx'), '#!/bin/sh\nprintf called > "$NPX_MARKER"\nexit 97\n', { mode: 0o755 });
  const marker = path.join(root, 'release-started');
  const result = spawnSync('bash', ['-c', [
    'set -euo pipefail',
    shellFunction('release_task_journal_configure'),
    shellFunction('release_task_journal_call'),
    'release_task_journal_configure',
    'printf started > "$RELEASE_MARKER"',
    'release_task_journal_call status release.build.linux fixture ""',
  ].join('\n')], {
    cwd: root, encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      ORCHESTRATOR_HERE: bin,
      PAPERCUSP_RELEASE_TASK_ID: 'fixture-task',
      PAPERCUSP_RELEASE_OPERATION_ID: 'fixture-operation',
      PAPERCUSP_RELEASE_TASK_JOURNAL_CLI: cli,
      PAPERCUSP_RELEASE_TASK_JOURNAL_RUNNER: '',
      MONOREPO: root,
      EXPECTED_SOURCE_SHA: 'a'.repeat(40),
      VERSION: '0.0.32', CHANNEL: 'alpha',
      NPX_MARKER: npxMarker, RELEASE_MARKER: marker,
    },
  });
  assert.equal(fs.existsSync(npxMarker), false, 'journal admission must never invoke npx');
  return { result, started: fs.existsSync(marker) };
}

for (const mode of ['missing-loader', 'broken-loader', 'broken-adapter', 'broken-ledger']) {
  test(`managed release rejects ${mode} before stage or seed mutation`, (context) => {
    const { result, started } = fixture(context, mode);
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.equal(started, false);
    assert.match(result.stderr, /managed release journal (needs|cannot load)/);
  });
}

test('managed release admits a loadable graph and uses its resolved local runner', (context) => {
  const { result, started } = fixture(context, 'healthy');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(started, true);
  const argv = JSON.parse(result.stdout.trim());
  assert.deepEqual(argv.slice(0, 5), ['status', '--task-id', 'fixture-task', '--operation-id', 'fixture-operation']);
  assert.ok(argv.includes('release.build.linux'));
});
