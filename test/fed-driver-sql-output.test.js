const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const fed = path.join(root, 'scripts/linux-test-vm/fed.sh');

function renderedRemoteCommand(mode) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-fed-sql-'));
  try {
    const bin = path.join(home, 'bin');
    const cache = path.join(home, '.papercusp');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'fed-rig-ports.a'), '3100 5432\n');

    const fakeSsh = path.join(bin, 'ssh');
    fs.writeFileSync(
      fakeSsh,
      '#!/usr/bin/env bash\nlast=""\nfor arg in "$@"; do last="$arg"; done\nprintf \'%s\\n\' "$last"\n',
      { mode: 0o755 },
    );

    return execFileSync('bash', [fed, 'a', mode, 'SELECT 1'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        FED_SSH_KEY: path.join(home, 'unused-test-key'),
      },
    }).trim();
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('sqlt renders psql with tuples-only, unaligned output for assertions', () => {
  const remote = renderedRemoteCommand('sqlt');
  assert.match(remote, / -tA -P pager=off 2>&1$/);
});

test('sql preserves the human-formatted output used for interactive inspection', () => {
  const remote = renderedRemoteCommand('sql');
  assert.match(remote, / -P pager=off 2>&1$/);
  assert.doesNotMatch(remote, /(?:^|\s)-tA(?:\s|$)/);
});
