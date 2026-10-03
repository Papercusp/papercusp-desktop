// WI-10005998 (2026-10-03): bash reads a running script by BYTE OFFSET, so a peer's edit to a
// long-running build script in the shared tree shifts the running shell into changed bytes. That
// killed a ~45-min sidecar bake with 'line 5012: VM_RELEASE_TRUST_OUTPUT_DIR: unbound variable'
// after a 6-line insertion upstream of the offset. The fix is the WI-3306 self-read guard: the whole
// body sits in one { ... } group (bash parses all of it before running any of it), closed at EOF
// by `exit 0` + `}` so nothing appended or shifted after the group is ever read.
//
// This pins the guard on every long-running build script that carries it, and proves it works on
// the REAL file: a copy whose first guarded statement truncates the script still runs to its
// marker, which an unguarded script cannot (its next read hits EOF and it ends silently).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BIN = path.join(import.meta.dirname, '..', 'bin');

// Overridable so a mutation probe can point the guard at a mutated COPY outside the tree:
// PAPERCUSP_SELF_READ_GUARD_UNDER_TEST=<abs path> checks that one file only.
const GUARDED = process.env.PAPERCUSP_SELF_READ_GUARD_UNDER_TEST
  ? [process.env.PAPERCUSP_SELF_READ_GUARD_UNDER_TEST]
  : [
      'build-desktop-sidecar.sh',
      'build-and-archive-deb.sh',
      'build-mac-cross.sh',
      'build-windows-cross.sh',
      'stage-source-tree.sh',
      'cross-install-darwin-tree.sh',
    ].map((name) => path.join(BIN, name));

const isCode = (line) => !/^\s*(#|$)/.test(line);

// Truncate the running script, then fork an EXTERNAL command: bash buffers a script and only
// re-syncs its file offset before a fork, which is exactly what a long build does constantly. After
// that sync an unguarded shell reads EOF from the truncated file and never reaches the marker
// (the calibration test below proves this probe is not vacuous). Separate lines on purpose: bash
// parses one line at a time, so a one-line probe would run from the already-parsed line.
const PROBE = [': > "${BASH_SOURCE[0]}"', '/bin/true', 'echo SELF_READ_GUARD_OK', 'exit 0'];

function guardLayout(source) {
  const lines = source.split('\n');
  const setIdx = lines.findIndex((l) => /^set -euo pipefail\s*$/.test(l));
  const openIdx = lines.findIndex((l, i) => i > setIdx && /^\{\s*$/.test(l));
  const codeIdx = lines.map((l, i) => (isCode(l) ? i : -1)).filter((i) => i >= 0);
  return { lines, setIdx, openIdx, codeIdx };
}

for (const script of GUARDED) {
  const name = path.basename(script);

  test(`${name}: the whole body sits in one self-read { } group closed by exit 0 at EOF`, () => {
    const { lines, setIdx, openIdx, codeIdx } = guardLayout(fs.readFileSync(script, 'utf8'));
    assert.ok(setIdx >= 0, `${name}: no 'set -euo pipefail' line`);
    assert.ok(openIdx > setIdx, `${name}: no '{' self-read guard opener after 'set -euo pipefail'`);
    // Nothing executable may run unguarded between the set line and the opener.
    const unguarded = codeIdx.filter((i) => i > setIdx && i < openIdx).map((i) => lines[i]);
    assert.deepEqual(unguarded, [], `${name}: executable lines outside the guard`);
    const last = codeIdx.at(-1);
    assert.match(lines[last], /^\}/, `${name}: the last code line must close the guard`);
    assert.match(lines[codeIdx.at(-2)], /^\s*exit 0\s*$/, `${name}: 'exit 0' must precede the closing '}'`);
  });

  test(`${name}: a copy that truncates itself mid-run still reaches its marker`, () => {
    const { lines, openIdx } = guardLayout(fs.readFileSync(script, 'utf8'));
    assert.ok(openIdx > 0, `${name}: no guard opener`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-read-guard-'));
    try {
      const copy = path.join(dir, name);
      fs.writeFileSync(copy, [...lines.slice(0, openIdx + 1), ...PROBE, ...lines.slice(openIdx + 1)].join('\n'));
      const result = spawnSync('bash', [copy], { encoding: 'utf8', cwd: dir, timeout: 60_000 });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /SELF_READ_GUARD_OK/);
      assert.equal(fs.statSync(copy).size, 0, 'the probe really truncated the running script');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('calibration: an unguarded script that truncates itself does NOT reach its marker', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-read-guard-cal-'));
  try {
    const copy = path.join(dir, 'unguarded.sh');
    fs.writeFileSync(copy, ['#!/usr/bin/env bash', 'set -euo pipefail', ...PROBE, ''].join('\n'));
    const result = spawnSync('bash', [copy], { encoding: 'utf8', cwd: dir, timeout: 60_000 });
    assert.doesNotMatch(result.stdout, /SELF_READ_GUARD_OK/, 'the behavioural probe would pass vacuously');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
