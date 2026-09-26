// D-162's physical witness is only evidence when it measures the process that
// actually owns the VM operator and leaves the owner-authority gate as found.
// These source-contract checks protect the shell driver's fail-closed seams;
// the real two-host run remains the end-to-end acceptance.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const driverPath = path.join(
  import.meta.dirname,
  "..",
  "bin",
  "vm-rig",
  "p202-workdist.sh",
);
const source = fs.readFileSync(driverPath, "utf8");

function functionSlice(name, endMarker) {
  const start = source.indexOf(`${name}() {`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${endMarker} must follow ${name}`);
  return source.slice(start, end);
}

function bundleBindingViolations(body) {
  const violations = [];
  if (!body.includes('lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t')) {
    violations.push("does not resolve the live MCP listener");
  }
  if (!body.includes("wc -l") || !body.includes("= 1")) {
    violations.push("does not require a unique listener");
  }
  if (!body.includes('CMD=$(ps -o command= -p "$L"')) {
    violations.push("does not read the listener command");
  }
  if (!body.includes('case "$CMD" in *"$c"*) S="$c"; break ;; esac')) {
    violations.push("does not bind serve.mjs to the listener command");
  }
  if (!body.includes('B="${S%/serve.mjs}/bin/psql"')) {
    violations.push("does not derive psql from the same sidecar");
  }
  if (
    /for c in \/Applications\/Papercusp\*\.app\/Contents\/Resources\/sidecar\/bin\/psql/.test(
      body,
    )
  ) {
    violations.push("selects psql from an independent app glob");
  }
  if (
    body.includes("sidecar/bin/node") &&
    !body.includes('case "$CMD" in "$n "*) B="${n%/node}/psql"; break ;; esac')
  ) {
    violations.push("derives psql from a node that is not the listener's node");
  }
  return violations;
}

function gateRestoreViolations(body) {
  const violations = [];
  if (!body.includes("for attempt in $(seq 1 5); do")) {
    violations.push("does not retry the idempotent restore");
  }
  if (!body.includes('[ "$after" = "true:$GATE_PRIOR" ]')) {
    violations.push("does not verify the restored explicit row shape");
  }
  if (!body.includes('[ "$after" = "false:-" ]')) {
    violations.push(
      "does not verify that a formerly absent override is absent again",
    );
  }
  if (!body.includes("GATE NOT RESTORED after 5 attempts")) {
    violations.push("does not expose exhausted restoration retries");
  }
  const finalWarning = body.indexOf("GATE NOT RESTORED after 5 attempts");
  if (
    finalWarning !== -1 &&
    body.slice(finalWarning).includes("GATE_ARMED=0")
  ) {
    violations.push("marks the gate restored after the fail-closed warning");
  }
  return violations;
}

test("VM bundle discovery binds every artifact oracle to the unique live listener", () => {
  const body = functionSlice("discover_vm", "\ndrv_psql_rig() {");
  assert.deepEqual(bundleBindingViolations(body), []);
});

test("delegated-seat gate restoration retries and proves the exact prior shape", () => {
  const body = functionSlice(
    "restore_gate",
    "\ntrap restore_gate EXIT INT TERM",
  );
  assert.deepEqual(gateRestoreViolations(body), []);
});

test("the bundle-binding detector rejects the old first-glob-wins implementation", () => {
  const oldShape = String.raw`
    B=""; S=""
    for c in /Applications/Papercusp*.app/Contents/Resources/sidecar/bin/psql; do
      [ -x "$c" ] && B="$c" && break
    done
    for c in /Applications/Papercusp*.app/Contents/Resources/sidecar/serve.mjs; do
      [ -f "$c" ] && S="$c" && break
    done
  `;
  assert.ok(bundleBindingViolations(oldShape).length >= 3);
});

test("the bundle-binding detector rejects psql taken from a node the listener is not running", () => {
  const body = functionSlice("discover_vm", "\ndrv_psql_rig() {");
  const bound = 'case "$CMD" in "$n "*) B="${n%/node}/psql"; break ;; esac';
  assert.ok(body.includes(bound));
  const unbound = body.replace(bound, '[ -x "$n" ] && B="${n%/node}/psql" && break');
  assert.ok(
    bundleBindingViolations(unbound).includes(
      "derives psql from a node that is not the listener's node",
    ),
  );
});

test("the gate-restore detector rejects a one-shot best-effort clear", () => {
  const oldShape = String.raw`
    rig_mcp vm flags:set '{"enabled":null}' || true
    after="$(gate_global_state)"
    echo "GATE NOT RESTORED"
    GATE_ARMED=0
  `;
  assert.ok(gateRestoreViolations(oldShape).length >= 3);
});
