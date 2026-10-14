const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = path.resolve(__dirname, "../bin/candidate-install-upgrade-rollback.sh");

function executable(file, body) {
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

function fixture({ running = false, failVerifier = "", sameSha = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-install-rollback-"));
  const shims = path.join(root, "bin");
  const candidateDir = path.join(root, "candidate package");
  const baselineDir = path.join(root, "baseline package");
  fs.mkdirSync(shims);
  fs.mkdirSync(candidateDir);
  fs.mkdirSync(baselineDir);
  const candidateGui = path.join(candidateDir, "Papercusp GUI_0.0.26_amd64.deb");
  const candidateServer = path.join(candidateDir, "Papercusp Server_0.0.26_amd64.deb");
  const baselineGui = path.join(baselineDir, "Papercusp GUI_0.0.25_amd64.deb");
  const baselineServer = path.join(baselineDir, "Papercusp Server_0.0.25_amd64.deb");
  for (const [file, contents] of [
    [candidateGui, "candidate GUI bytes"],
    [candidateServer, "candidate Server bytes"],
    [baselineGui, "baseline GUI bytes"],
    [baselineServer, "baseline Server bytes"],
  ]) fs.writeFileSync(file, contents);
  const candidateSha = "c".repeat(40);
  const baselineSha = sameSha ? candidateSha : "b".repeat(40);
  fs.writeFileSync(path.join(candidateDir, "build-provenance.json"), JSON.stringify({
    buildSha: candidateSha, version: "0.0.26", dirty: false,
  }));
  fs.writeFileSync(path.join(baselineDir, "build-provenance.json"), JSON.stringify({
    buildSha: baselineSha, version: "0.0.25", dirty: false,
  }));
  const key = path.join(root, ".ssh", "papercup-vm-linux");
  fs.mkdirSync(path.dirname(key));
  fs.writeFileSync(key, "private-test-key", { mode: 0o600 });
  const log = path.join(root, "calls.log");
  const vmScript = path.join(root, "baseline-start.sh");
  const receipt = path.join(root, "evidence", "candidate-rollback.json");
  const vmctl = path.join(root, "vmctl");
  executable(vmctl, `printf 'VMCTL %s\\n' "$*" >>"$MOCK_LOG"
case "$1" in
  endpoint) printf 'ssh_port=2224\\nssh_key=%s\\nssh_host=tester@127.0.0.1\\n' "$MOCK_KEY" ;;
  is-running) [[ "$MOCK_RUNNING" == 1 ]] ;;
  ssh) cat >"$MOCK_VM_SCRIPT" ;;
  *) exit 0 ;;
esac`);
  const dpkgDeb = path.join(shims, "dpkg-deb");
  executable(dpkgDeb, `[[ "$1" == -f && $# == 3 ]] || exit 2
name=$(basename -- "$2")
case "$3:$name" in
  Package:*Server*) printf 'papercusp-server\\n' ;;
  Package:*) printf 'papercusp-gui\\n' ;;
  Version:*_0.0.26_*) printf '0.0.26\\n' ;;
  Version:*_0.0.25_*) printf '0.0.25\\n' ;;
  *) exit 3 ;;
esac`);
  const verifier = path.join(root, "verifier");
  executable(verifier, `artifact=""; expected_sha=""; expected_version=""; install_timeout=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact) artifact="$2"; shift 2 ;;
    --expected-sha) expected_sha="$2"; shift 2 ;;
    --expected-version) expected_version="$2"; shift 2 ;;
    --install-timeout) install_timeout="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf 'VERIFY %s %s\\n' "$artifact" "$expected_sha" >>"$MOCK_LOG"
printf 'INSTALL_TIMEOUT %s\\n' "$install_timeout" >>"$MOCK_LOG"
if [[ "$(basename -- "$artifact")" == "$MOCK_FAIL_VERIFIER" ]]; then
  printf '{"ok":false,"failures":["Server install failed: fixture causal diagnostic"]}\\n'
  printf 'fixture verifier stderr\\n' >&2
  exit 17
fi
printf '{"ok":true,"flipped":true,"portHeld":true,"shaAfter":"%s","versionAfter":"%s","shaBefore":"previous","versionBefore":"previous","portBefore":3999,"portAfter":3999}\\n' "$expected_sha" "$expected_version"`);
  return {
    root, log, vmScript, receipt, vmctl, verifier, key, candidateGui, candidateServer,
    baselineGui, baselineServer, candidateSha, baselineSha,
    env: {
      ...process.env,
      PATH: `${shims}:${process.env.PATH}`,
      TMPDIR: root,
      MOCK_LOG: log,
      MOCK_VM_SCRIPT: vmScript,
      MOCK_KEY: key,
      MOCK_RUNNING: running ? "1" : "0",
      MOCK_FAIL_VERIFIER: failVerifier,
      MOCK_FAIL_VM_AT: "",
      PAPERCUSP_LINUX_VMCTL: vmctl,
      PAPERCUSP_CANDIDATE_INSTALL_VERIFIER: verifier,
    },
  };
}

function run(f) {
  return spawnSync("bash", [script,
    "--candidate-gui", f.candidateGui,
    "--candidate-server", f.candidateServer,
    "--baseline-gui", f.baselineGui,
    "--baseline-server", f.baselineServer,
    "--evidence-out", f.receipt,
  ], { encoding: "utf8", env: f.env });
}

function calls(f) {
  return fs.existsSync(f.log) ? fs.readFileSync(f.log, "utf8").trim().split("\n").filter(Boolean) : [];
}

function withFixture(options, body) {
  const f = fixture(options);
  try { body(f); } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
}

test("candidate upgrade and exact baseline rollback produce a content-bound receipt", () => {
  withFixture({}, (f) => {
    const result = run(f);
    assert.equal(result.status, 0, `${result.stdout}\\n${result.stderr}`);
    const lines = calls(f);
    assert.ok(lines.indexOf("VMCTL reset clean") < lines.indexOf(`VMCTL install clean ${f.baselineServer}`));
    assert.ok(lines.indexOf(`VMCTL install clean ${f.baselineGui}`) < lines.findIndex((line) => line.startsWith("VERIFY ")));
    assert.deepEqual(lines.filter((line) => line.startsWith("VERIFY ")).map((line) => line.split(" ").at(-1)), [f.candidateSha, f.baselineSha]);
    assert.deepEqual(lines.filter((line) => line.startsWith("INSTALL_TIMEOUT ")), ["INSTALL_TIMEOUT 2400", "INSTALL_TIMEOUT 2400"]);
    assert.equal(lines.at(-1), "VMCTL down clean");
    assert.match(fs.readFileSync(f.vmScript, "utf8"), /systemctl --user enable --now papercusp-server\.service/);
    const evidence = JSON.parse(fs.readFileSync(f.receipt, "utf8"));
    assert.equal(evidence.verdict, "PASS");
    assert.equal(evidence.candidate.buildSha, f.candidateSha);
    assert.equal(evidence.rollbackTarget.buildSha, f.baselineSha);
    assert.equal(evidence.candidate.gui.sha256.length, 64);
    assert.equal(evidence.rollbackTarget.server.sha256.length, 64);
    assert.equal(evidence.candidate.upgrade.flipped, true);
    assert.equal(evidence.rollbackTarget.rollback.flipped, true);
  });
});

test("the selected installation budget reaches both upgrade and rollback verifiers", () => {
  withFixture({}, (f) => {
    f.env.PAPERCUSP_CANDIDATE_INSTALL_TIMEOUT = "37";
    const result = run(f);
    assert.equal(result.status, 0, `${result.stdout}\\n${result.stderr}`);
    assert.deepEqual(calls(f).filter((line) => line.startsWith("INSTALL_TIMEOUT ")), ["INSTALL_TIMEOUT 37", "INSTALL_TIMEOUT 37"]);
  });
});

test("a failed candidate verifier powers down and emits no passing receipt", () => {
  withFixture({ failVerifier: "Papercusp GUI_0.0.26_amd64.deb" }, (f) => {
    const result = run(f);
    assert.notEqual(result.status, 0);
    const lines = calls(f);
    assert.equal(lines.some((line) => line.startsWith("VERIFY ") && line.includes("0.0.25")), false);
    assert.equal(lines.at(-1), "VMCTL down clean");
    assert.equal(fs.existsSync(f.receipt), false);
    assert.equal(result.status, 17);
    assert.match(result.stderr, /fixture causal diagnostic/);
    assert.match(result.stderr, /fixture verifier stderr/);
    const diagnosticDirs = fs.readdirSync(path.dirname(f.receipt))
      .filter((name) => name.startsWith("candidate-rollback.json.diagnostics."));
    assert.equal(diagnosticDirs.length, 1);
    const diagnostics = path.join(path.dirname(f.receipt), diagnosticDirs[0]);
    assert.match(fs.readFileSync(path.join(diagnostics, "candidate-upgrade.json"), "utf8"), /fixture causal diagnostic/);
    assert.match(fs.readFileSync(path.join(diagnostics, "candidate-upgrade.stderr.log"), "utf8"), /fixture verifier stderr/);
    const failure = JSON.parse(fs.readFileSync(path.join(diagnostics, "failure.json"), "utf8"));
    assert.equal(failure.verdict, "FAIL");
    assert.equal(failure.phase, "candidate-upgrade");
    assert.equal(failure.exitCode, 17);
  });
});

test("a failed rollback verifier powers down and emits no passing receipt", () => {
  withFixture({ failVerifier: "Papercusp GUI_0.0.25_amd64.deb" }, (f) => {
    const result = run(f);
    assert.notEqual(result.status, 0);
    const lines = calls(f);
    assert.equal(lines.filter((line) => line.startsWith("VERIFY ")).length, 2);
    assert.equal(lines.at(-1), "VMCTL down clean");
    assert.equal(fs.existsSync(f.receipt), false);
    const diagnosticDir = fs.readdirSync(path.dirname(f.receipt))
      .find((name) => name.startsWith("candidate-rollback.json.diagnostics."));
    assert.ok(diagnosticDir);
    const diagnostics = path.join(path.dirname(f.receipt), diagnosticDir);
    assert.equal(JSON.parse(fs.readFileSync(path.join(diagnostics, "candidate-upgrade.json"), "utf8")).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(diagnostics, "failure.json"), "utf8")).phase, "exact-baseline-rollback");
  });
});

test("a VM already owned by another lane is not reset or powered down", () => {
  withFixture({ running: true }, (f) => {
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already running/);
    assert.deepEqual(calls(f).filter((line) => /^VMCTL (reset|up|down|install) /.test(line)), []);
    assert.equal(fs.existsSync(f.receipt), false);
  });
});

test("a candidate with the same build SHA as its rollback target is refused before VM mutation", () => {
  withFixture({ sameSha: true }, (f) => {
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /same build SHA/);
    assert.deepEqual(calls(f).filter((line) => /^VMCTL (reset|up|down|install) /.test(line)), []);
  });
});
