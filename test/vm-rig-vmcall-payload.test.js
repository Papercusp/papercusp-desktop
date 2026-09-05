// EI-20320664768533929 — the VM bridge must accept a quoting-safe payload.
//
// An ssh-driven `vmcall.sh` call puts its JSON through TWO shells, so the
// positional form loses quoting and reaches mcp-call as a truncated fragment.
// mcp-call.mjs already answers that with `--json-file <path>` and `--json -`,
// and vmcall.sh forwards argv verbatim, so the file form works by passthrough.
//
// The stdin form did NOT: vmcall.sh backgrounds the MCP child (`&`) so its
// deadline loop can bound it, and bash redirects a background command's stdin
// from /dev/null whenever job control is off — always the case in the
// non-interactive ssh invocation this script exists to serve. The payload
// silently arrived EMPTY, i.e. it failed in the same quiet direction as the
// lost-quoting bug the flag was reached for to avoid. Both forms are pinned
// here so neither can regress back to a positional-only bridge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Overridable so a falsifiability probe can point this at a MUTATED COPY outside
// the tree (scripts/mutation-probe.sh tier 2) instead of mutating the shared
// checkout, where a git-sync sweep could commit the mutant mid-run.
const vmcall =
  process.env.VMCALL_SCRIPT ||
  path.join(import.meta.dirname, '..', 'bin', 'vm-rig', 'vmcall.sh');

/**
 * Stand in for mcp-call.mjs, echoing back BOTH argv and whatever reached stdin
 * so each can be asserted independently. Run under the real node binary, which
 * vmcall.sh also uses for its own JSON-result validation step.
 */
function withFakeMcpCall(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmcall-payload-'));
  const fake = path.join(dir, 'fake-mcp-call.mjs');
  fs.writeFileSync(
    fake,
    [
      'import { readFileSync } from "node:fs";',
      'let stdin = "";',
      'try { stdin = readFileSync(0, "utf8"); } catch {}',
      'process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), stdin }));',
      '',
    ].join('\n'),
  );
  try {
    return run(fake);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runVmcall(fake, args, input) {
  return spawnSync('bash', [vmcall, ...args], {
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      // Skip listener discovery entirely: this exercises the argument/stdin
      // plumbing, not port probing, so no operator needs to be running.
      PAPERCUSP_HONO_PORT: '65535',
      PCUSP_MCP_CALL: fake,
      PCUSP_VM_NODE: process.execPath,
    },
  });
}

test('stdin reaches the MCP child, so `--json -` reads the real payload', () => {
  withFakeMcpCall((fake) => {
    // Apostrophes are the exact class that broke the positional form.
    const payload = JSON.stringify({ summary: "it's safe", fleetSlug: 'p2p-rig' });
    const r = runVmcall(fake, ['work_items:complete', '--json', '-'], payload);

    assert.equal(r.status, 0, `vmcall failed: ${r.stderr}`);
    const seen = JSON.parse(r.stdout);
    assert.equal(
      seen.stdin,
      payload,
      'stdin was lost — a backgrounded child gets /dev/null unless fd 3 is handed to it explicitly',
    );
    // The payload must survive byte-for-byte, apostrophe included.
    assert.equal(JSON.parse(seen.stdin).summary, "it's safe");
  });
});

test('`--json-file` and its path are forwarded verbatim, with no local parsing', () => {
  withFakeMcpCall((fake) => {
    const argsPath = path.join(path.dirname(fake), 'args.json');
    fs.writeFileSync(argsPath, JSON.stringify({ summary: "it's safe" }));
    const args = ['work_items:complete', '--json-file', argsPath, '--harness', 'papercup'];
    const r = runVmcall(fake, args, '');

    assert.equal(r.status, 0, `vmcall failed: ${r.stderr}`);
    const seen = JSON.parse(r.stdout);
    assert.deepEqual(
      seen.argv,
      args,
      'vmcall must pass argv through untouched — it deliberately parses no payload',
    );
  });
});

test('a call with no stdin still completes instead of blocking on fd 3', () => {
  withFakeMcpCall((fake) => {
    // The positional form remains supported; handing the child fd 3 must not
    // make a stdin-less invocation hang waiting for input that never comes.
    const r = runVmcall(fake, ['coord:whoami', '{"a":1}'], '');

    assert.equal(r.status, 0, `vmcall failed: ${r.stderr}`);
    const seen = JSON.parse(r.stdout);
    assert.deepEqual(seen.argv, ['coord:whoami', '{"a":1}']);
    assert.equal(seen.stdin, '', 'no stdin was supplied, so the child should see EOF');
  });
});
