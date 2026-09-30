// WI-10004115: bin/vm-rig/probe-session.sh used to default the probe's wake
// handle to Mac plan run 1. On a re-joined VM that run did not exist, so every
// probe wake sat pending with "plan run 1 not found" — a red parity leg 2 that
// reads exactly like a dead wake bridge. `start` must now resolve the handle
// against the Mac's own plans:runs and refuse loudly instead of arming it.
//
// These run the REAL script with ssh, scp and psql faked on PATH (scp too: a
// nested deploy.sh must never reach the real rig VM), and assert on what the
// script would have done to the VM.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// PROBE_SCRIPT lets scripts/mutation-probe.sh point the suite at a mutated COPY.
const script =
  process.env.PROBE_SCRIPT ??
  path.join(import.meta.dirname, "..", "bin", "vm-rig", "probe-session.sh");

function makeFakes() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-session-test-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const log = path.join(dir, "calls.log");
  fs.writeFileSync(log, "");
  const write = (name, body) => {
    const p = path.join(bin, name);
    fs.writeFileSync(p, `#!/bin/bash\n${body}\n`);
    fs.chmodSync(p, 0o755);
  };
  write(
    "ssh",
    [
      'cmd="${@: -1}"',
      'printf "SSH %s\\n" "$cmd" >> "$FAKE_LOG"',
      'case "$cmd" in',
      '  *"test -x /tmp/vmcall.sh"*) exit 0 ;;',
      '  *"plans:runs"*) printf "%s" "$FAKE_RUNS_REPLY"; exit 0 ;;',
      "  hostname) echo fakehost; exit 0 ;;",
      "  *) exit 0 ;;",
      "esac",
    ].join("\n"),
  );
  write("scp", 'printf "SCP %s\\n" "$*" >> "$FAKE_LOG"; exit 0');
  write("psql", "exit 1");
  return { dir, bin, log };
}

function run(env, runsReply = "") {
  const fakes = makeFakes();
  const baseEnv = { ...process.env };
  delete baseEnv.PCUSP_PROBE_PLAN_RUN_ID;
  delete baseEnv.PCUSP_PROBE_PLAN_SLUG;
  const r = spawnSync("bash", [script, "start"], {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...baseEnv,
      PATH: `${fakes.bin}:${process.env.PATH}`,
      FAKE_LOG: fakes.log,
      FAKE_RUNS_REPLY: runsReply,
      PCUSP_VM_SSH: "probe-test@203.0.113.9",
      PCUSP_PROBE_WAIT_SEC: "1",
      PCUSP_PROBE_POLL_SEC: "1",
      PCUSP_TOWER_DSN: "postgresql://nobody@127.0.0.1:1/none",
      ...env,
    },
  });
  const calls = fs.readFileSync(fakes.log, "utf8");
  fs.rmSync(fakes.dir, { recursive: true, force: true });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, calls };
}

const touchedRunningLoop = (calls) =>
  calls.includes("/tmp/live1-probe-session.pid") || calls.includes("SCP ");

const runs = (...rows) => JSON.stringify({ runs: rows, sweep: { ran: true } });

test("no stale numeric default: the source never defaults the plan run id", () => {
  const src = fs.readFileSync(script, "utf8");
  assert.doesNotMatch(src, /PCUSP_PROBE_PLAN_RUN_ID:-[0-9]/);
});

test("refuses without a plan slug, before touching the VM loop", () => {
  const r = run({});
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /PCUSP_PROBE_PLAN_SLUG is unset/);
  assert.doesNotMatch(r.calls, /plans:runs/);
  assert.equal(touchedRunningLoop(r.calls), false, r.calls);
});

test("refuses a plan run id that does not exist on the Mac", () => {
  const r = run(
    { PCUSP_PROBE_PLAN_SLUG: "live1-probe", PCUSP_PROBE_PLAN_RUN_ID: "1" },
    runs({ id: 7, status: "failed" }),
  );
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /plan run 1 does not exist on the Mac/);
  assert.match(r.stderr, /7:failed/);
  assert.equal(touchedRunningLoop(r.calls), false, r.calls);
});

test("refuses a running plan run (a wake against it is skipped, not delivered)", () => {
  const r = run(
    { PCUSP_PROBE_PLAN_SLUG: "live1-probe", PCUSP_PROBE_PLAN_RUN_ID: "7" },
    runs({ id: 7, status: "running" }),
  );
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /status=running/);
  assert.equal(touchedRunningLoop(r.calls), false, r.calls);
});

test("refuses an unreadable plans:runs reply instead of guessing", () => {
  const r = run({ PCUSP_PROBE_PLAN_SLUG: "live1-probe" }, "connection refused");
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /could not read plans:runs/);
  assert.equal(touchedRunningLoop(r.calls), false, r.calls);
});

test("refuses a malformed run id or slug", () => {
  const badId = run({ PCUSP_PROBE_PLAN_SLUG: "live1-probe", PCUSP_PROBE_PLAN_RUN_ID: "abc" });
  assert.equal(badId.code, 2, badId.stderr);
  const badSlug = run({ PCUSP_PROBE_PLAN_SLUG: "x';rm -rf /;'" });
  assert.equal(badSlug.code, 2, badSlug.stderr);
  assert.doesNotMatch(badSlug.calls, /plans:runs/);
});

test("with no id, arms the newest SETTLED run and passes it to the Mac loop", () => {
  const r = run(
    { PCUSP_PROBE_PLAN_SLUG: "live1-probe" },
    runs({ id: 9, status: "running" }, { id: 7, status: "failed" }),
  );
  assert.match(r.stdout, /plan=live1-probe plan_run=7 /);
  assert.match(r.calls, /SCP /);
  assert.match(r.calls, /'su-live1-imac-probe' '30' '7'/);
});

test("'none' opts into addressable-only without querying the Mac", () => {
  const r = run({ PCUSP_PROBE_PLAN_RUN_ID: "none" });
  assert.doesNotMatch(r.calls, /plans:runs/);
  assert.match(r.stdout, /NOT wakeable/);
  assert.match(r.calls, /'su-live1-imac-probe' '30' ''/);
});
