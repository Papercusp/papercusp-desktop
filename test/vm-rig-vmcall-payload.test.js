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
//
// WI-10003588 — the same bridge must bind the CURRENT operator. A rig VM carries
// two operators (the current runtime plus the installed app's older staging
// env-sidecar). Port discovery used to bind the first listener answering a 200
// /api/health, so a slow current runtime was silently swapped for the stale one
// and rig calls returned well-formed wrong answers. The binding cases at the end
// pin the precedence: explicit env > a live operator.json > the listener scan.

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
      'process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), stdin, port: process.env.PAPERCUSP_HONO_PORT }));',
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

// ---- WI-10003588: port binding precedence ---------------------------------

// A pid that cannot be a live process: far above any real pid_max, so `ps -p`
// reports it absent on every platform the rig runs on.
const DEAD_PID = 2147483646;
// The port the fake listener scan offers — always "healthy", i.e. it plays the
// stale-but-fast operator that used to win the race.
const SCAN_PORT = '4242';

/**
 * Run vmcall.sh with discovery ENABLED: no PAPERCUSP_HONO_PORT unless given,
 * an operator.json of our choosing, and fake `lsof`/`curl` on PATH so the scan
 * deterministically offers SCAN_PORT as a healthy listener. `ps` stays real —
 * the liveness check is exactly what is under test.
 */
function runBinding(fake, { operatorJson, envPort } = {}) {
  const dir = path.dirname(fake);
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'lsof'),
    `#!/bin/sh\necho "node 1 u 20u IPv4 0t0 TCP 127.0.0.1:${SCAN_PORT} (LISTEN)"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nprintf 200\n', { mode: 0o755 });

  const opPath = path.join(dir, 'operator.json');
  if (operatorJson !== undefined) fs.writeFileSync(opPath, operatorJson);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    PCUSP_MCP_CALL: fake,
    PCUSP_VM_NODE: process.execPath,
    PCUSP_OPERATOR_JSON: opPath,
  };
  delete env.PAPERCUSP_HONO_PORT;
  if (envPort) env.PAPERCUSP_HONO_PORT = envPort;

  const r = spawnSync('bash', [vmcall, 'coord:whoami', '{}'], { encoding: 'utf8', input: '', env });
  assert.equal(r.status, 0, `vmcall failed: ${r.stderr}`);
  return { port: JSON.parse(r.stdout).port, stderr: r.stderr };
}

test('a live operator.json beats a faster healthy listener (no silent swap)', () => {
  withFakeMcpCall((fake) => {
    const { port, stderr } = runBinding(fake, {
      operatorJson: JSON.stringify({ port: 5151, pid: process.pid }),
    });
    assert.equal(port, '5151', 'bound the scanned listener instead of the current operator');
    assert.match(stderr, new RegExp(`\\[vmcall port=5151 source=operator\\.json pid=${process.pid}\\]`));
  });
});

test('a dead operator.json pid falls back to the listener scan, and says why', () => {
  withFakeMcpCall((fake) => {
    const { port, stderr } = runBinding(fake, {
      operatorJson: JSON.stringify({ port: 5151, pid: DEAD_PID }),
    });
    assert.equal(port, SCAN_PORT);
    assert.match(stderr, new RegExp(`source=scan \\(operator\\.json pid=${DEAD_PID} is dead\\)`));
  });
});

test('an unparsable or absent operator.json falls back to the scan', () => {
  withFakeMcpCall((fake) => {
    const bad = runBinding(fake, { operatorJson: '{not json' });
    assert.equal(bad.port, SCAN_PORT);
    assert.match(bad.stderr, /source=scan \(.*unparsable or lacks port\/pid\)/);
  });
  withFakeMcpCall((fake) => {
    const none = runBinding(fake, {});
    assert.equal(none.port, SCAN_PORT);
    assert.match(none.stderr, /source=scan \(no .*operator\.json\)/);
  });
});

test('an explicit PAPERCUSP_HONO_PORT still wins over a live operator.json', () => {
  withFakeMcpCall((fake) => {
    const { port, stderr } = runBinding(fake, {
      operatorJson: JSON.stringify({ port: 5151, pid: process.pid }),
      envPort: '7007',
    });
    assert.equal(port, '7007');
    assert.match(stderr, /\[vmcall port=7007 source=env\]/);
  });
});
