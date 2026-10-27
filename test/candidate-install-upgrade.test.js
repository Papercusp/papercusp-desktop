const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash, generateKeyPairSync, sign } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = path.resolve(__dirname, "../bin/candidate-install-upgrade-rollback.sh");

function executable(file, body) {
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

// A real minisign/Tauri updater key (Ed25519, prehashed "ED" signatures), so
// the journey's signature gate runs the production verifier, not a stub.
function updaterKey(keyIdHex) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  const keyId = Buffer.from(keyIdHex, "hex");
  const publicFile = [
    "untrusted comment: minisign public key",
    Buffer.concat([Buffer.from("Ed"), keyId, der.subarray(der.length - 32)]).toString("base64"),
    "",
  ].join("\n");
  return {
    pubkey: Buffer.from(publicFile).toString("base64"),
    signFile(file) {
      const digest = createHash("blake2b512").update(fs.readFileSync(file)).digest();
      const block = Buffer.concat([Buffer.from("ED"), keyId, sign(null, digest, privateKey)]);
      const sigFile = ["untrusted comment: signature from test key", block.toString("base64"), ""].join("\n");
      fs.writeFileSync(`${file}.sig`, Buffer.from(sigFile).toString("base64"));
    },
  };
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

// The baseline's source commit holds the updater key that installed client
// trusts; the journey must read it from there, never from the candidate.
function baselineKeyRepo(root, pubkey) {
  const repo = path.join(root, "baseline-source");
  fs.mkdirSync(path.join(repo, "src-tauri"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src-tauri", "tauri.conf.json"),
    JSON.stringify({ plugins: { updater: { pubkey } } }));
  git(repo, "init", "-q");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "baseline");
  return { repo, sha: git(repo, "rev-parse", "HEAD") };
}

function fixture({
  running = false, failVerifier = "", sameSha = false, wrongKey = false,
  updateCheck = "cannot_check", loseDataAfter = "",
  seedKey = "k-fixture", checkKey = "k-fixture",
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "candidate-install-rollback-"));
  const shims = path.join(root, "bin");
  const candidateDir = path.join(root, "candidate package");
  const baselineDir = path.join(root, "baseline package");
  const sshDir = path.join(root, "ssh-scripts");
  fs.mkdirSync(shims);
  fs.mkdirSync(candidateDir);
  fs.mkdirSync(baselineDir);
  fs.mkdirSync(sshDir);
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
  const trusted = updaterKey("0102030405060708");
  const signer = wrongKey ? updaterKey("1112131415161718") : trusted;
  signer.signFile(candidateGui);
  signer.signFile(candidateServer);
  const keyRepo = baselineKeyRepo(root, trusted.pubkey);
  const candidateSha = "c".repeat(40);
  const baselineSha = sameSha ? candidateSha : keyRepo.sha;
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
  // `vmctl ssh` answers each guest script the way the real guest would: the
  // old client's update-check verdict, the user-data seed, and the per-phase
  // user-data check (optionally reporting the database row lost).
  executable(vmctl, `printf 'VMCTL %s\\n' "$*" >>"$MOCK_LOG"
case "$1" in
  endpoint) printf 'ssh_port=2224\\nssh_key=%s\\nssh_host=tester@127.0.0.1\\n' "$MOCK_KEY" ;;
  is-running) [[ "$MOCK_RUNNING" == 1 ]] ;;
  ssh)
    script="$(cat)"
    n=$(( $(ls "$MOCK_SSH_DIR" | wc -l) + 1 ))
    printf '%s\\n' "$script" >"$MOCK_SSH_DIR/$n.sh"
    if grep -q PAPERCUSP_LEGACY_UPDATE_CHECK <<<"$script"; then
      printf 'GUEST UPDATE_PROBE\\n' >>"$MOCK_LOG"
      for product in gui server; do
        printf 'PAPERCUSP_LEGACY_UPDATE_CHECK product=%s status=204 check=%s reason=%s\\n' \\
          "$product" "$MOCK_UPDATE_CHECK" "$([[ "$MOCK_UPDATE_CHECK" == cannot_check ]] && echo fetch_failed || echo none)"
      done
    elif grep -q PAPERCUSP_USER_DATA_SEEDED <<<"$script"; then
      printf 'GUEST SEED\\n' >>"$MOCK_LOG"
      nonce="$(sed -n "s/^NONCE='\\(.*\\)'$/\\1/p" <<<"$script")"
      printf 'PAPERCUSP_USER_DATA_SEEDED nonce=%s key=%s agent=a-fixture\\n' "$nonce" "$MOCK_SEED_KEY"
    elif grep -q PAPERCUSP_USER_DATA_CHECK <<<"$script"; then
      phase="$(sed -n "s/^PHASE='\\(.*\\)'$/\\1/p" <<<"$script")"
      printf 'GUEST CHECK %s\\n' "$phase" >>"$MOCK_LOG"
      pg=1; [[ "$phase" == "$MOCK_LOSE_DATA_AFTER" ]] && pg=0
      printf 'PAPERCUSP_USER_DATA_CHECK phase=%s pg=%s file=present key=%s agent=a-fixture\\n' "$phase" "$pg" "$MOCK_CHECK_KEY"
    elif grep -q PAPERCUSP_GUEST_DIAGNOSTICS <<<"$script"; then
      printf 'GUEST DIAGNOSTICS\\n' >>"$MOCK_LOG"
      printf 'fixture guest journal: papercusp-server.service failed\\n'
    else
      printf '%s\\n' "$script" >"$MOCK_VM_SCRIPT"
    fi
    ;;
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
  executable(verifier, `artifact=""; expected_sha=""; expected_version=""; install_timeout=""; allow_downgrade=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact) artifact="$2"; shift 2 ;;
    --expected-sha) expected_sha="$2"; shift 2 ;;
    --expected-version) expected_version="$2"; shift 2 ;;
    --install-timeout) install_timeout="$2"; shift 2 ;;
    --allow-downgrade) allow_downgrade=1; shift ;;
    *) shift ;;
  esac
done
printf 'VERIFY %s %s\\n' "$artifact" "$expected_sha" >>"$MOCK_LOG"
printf 'INSTALL_TIMEOUT %s\\n' "$install_timeout" >>"$MOCK_LOG"
printf 'ALLOW_DOWNGRADE %s\\n' "$allow_downgrade" >>"$MOCK_LOG"
if [[ "$(basename -- "$artifact")" == "$MOCK_FAIL_VERIFIER" ]]; then
  printf '{"ok":false,"failures":["Server install failed: fixture causal diagnostic"]}\\n'
  printf 'fixture verifier stderr\\n' >&2
  exit 17
fi
printf '{"ok":true,"flipped":true,"portHeld":true,"shaAfter":"%s","versionAfter":"%s","shaBefore":"previous","versionBefore":"previous","portBefore":3999,"portAfter":3999}\\n' "$expected_sha" "$expected_version"`);
  return {
    root, log, vmScript, receipt, vmctl, verifier, key, candidateGui, candidateServer,
    baselineGui, baselineServer, candidateSha, baselineSha, sshDir, args: [],
    env: {
      ...process.env,
      PATH: `${shims}:${process.env.PATH}`,
      TMPDIR: root,
      MOCK_LOG: log,
      MOCK_VM_SCRIPT: vmScript,
      MOCK_SSH_DIR: sshDir,
      MOCK_KEY: key,
      MOCK_RUNNING: running ? "1" : "0",
      MOCK_FAIL_VERIFIER: failVerifier,
      MOCK_FAIL_VM_AT: "",
      MOCK_UPDATE_CHECK: updateCheck,
      MOCK_LOSE_DATA_AFTER: loseDataAfter,
      MOCK_SEED_KEY: seedKey,
      MOCK_CHECK_KEY: checkKey,
      PAPERCUSP_LINUX_VMCTL: vmctl,
      PAPERCUSP_CANDIDATE_INSTALL_VERIFIER: verifier,
      PAPERCUSP_LEGACY_TRUSTED_KEY_REPO: keyRepo.repo,
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
    ...f.args,
  ], { encoding: "utf8", env: f.env });
}

function calls(f) {
  return fs.existsSync(f.log) ? fs.readFileSync(f.log, "utf8").trim().split("\n").filter(Boolean) : [];
}

function failure(f) {
  const dir = fs.readdirSync(path.dirname(f.receipt))
    .find((name) => name.startsWith("candidate-rollback.json.diagnostics."));
  assert.ok(dir, "a failed journey must leave its diagnostics directory");
  return JSON.parse(fs.readFileSync(path.join(path.dirname(f.receipt), dir, "failure.json"), "utf8"));
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
    // Only the rollback reinstalls an older package; apt refuses that unless
    // the leg opts in, and the upgrade leg must stay strict.
    assert.deepEqual(lines.filter((line) => line.startsWith("ALLOW_DOWNGRADE ")), ["ALLOW_DOWNGRADE 0", "ALLOW_DOWNGRADE 1"]);
    assert.equal(lines.at(-1), "VMCTL down clean");
    assert.equal(lines.includes("GUEST DIAGNOSTICS"), false, "a passing journey collects no failure diagnostics");
    assert.match(fs.readFileSync(f.vmScript, "utf8"), /systemctl --user enable --now papercusp-server\.service/);
    const evidence = JSON.parse(fs.readFileSync(f.receipt, "utf8"));
    assert.equal(evidence.verdict, "PASS");
    assert.equal(evidence.schemaVersion, 2);
    assert.equal(evidence.candidate.buildSha, f.candidateSha);
    assert.equal(evidence.rollbackTarget.buildSha, f.baselineSha);
    assert.equal(evidence.candidate.gui.sha256.length, 64);
    assert.equal(evidence.rollbackTarget.server.sha256.length, 64);
    assert.equal(evidence.candidate.upgrade.flipped, true);
    assert.equal(evidence.rollbackTarget.rollback.flipped, true);
  });
});

test("the old client's update check, the trusted-key signatures and user data are proven around both flips", () => {
  withFixture({}, (f) => {
    const result = run(f);
    assert.equal(result.status, 0, `${result.stdout}\\n${result.stderr}`);
    const lines = calls(f);
    const firstVerify = lines.findIndex((line) => line.startsWith("VERIFY "));
    const secondVerify = lines.findIndex((line, i) => i > firstVerify && line.startsWith("VERIFY "));
    // Probe and seed the OLD client before anything replaces it; check the
    // data after the upgrade and again after the rollback.
    assert.ok(lines.indexOf("GUEST UPDATE_PROBE") > lines.indexOf(`VMCTL install clean ${f.baselineGui}`));
    assert.ok(lines.indexOf("GUEST UPDATE_PROBE") < firstVerify);
    assert.ok(lines.indexOf("GUEST SEED") < firstVerify);
    const upgradeCheck = lines.indexOf("GUEST CHECK candidate-upgrade");
    const rollbackCheck = lines.indexOf("GUEST CHECK exact-baseline-rollback");
    assert.ok(firstVerify < upgradeCheck && upgradeCheck < secondVerify && secondVerify < rollbackCheck);
    const legacy = JSON.parse(fs.readFileSync(f.receipt, "utf8")).legacyClient;
    assert.equal(legacy.baselineSourceSha, f.baselineSha);
    assert.equal(legacy.trustedKeySha256.length, 64);
    assert.deepEqual(legacy.signatures.map((row) => [row.artifact, row.valid, row.keyId]), [
      [path.basename(f.candidateGui), true, "0102030405060708"],
      [path.basename(f.candidateServer), true, "0102030405060708"],
    ]);
    assert.equal(legacy.updateCheck.verdict, "not-silent");
    assert.equal(legacy.updateCheck.hostUnavailableAsserted, false);
    assert.deepEqual(legacy.updateCheck.reports.map((row) => [row.product, row.check, row.reason]), [
      ["gui", "cannot_check", "fetch_failed"],
      ["server", "cannot_check", "fetch_failed"],
    ]);
    assert.match(legacy.userData.nonce, /^[0-9a-f]{32}$/);
    assert.deepEqual(legacy.userData.checks.map((row) => [row.phase, row.verdict]), [
      ["candidate-upgrade", "preserved"],
      ["exact-baseline-rollback", "preserved"],
    ]);
  });
});

test("a candidate not signed by the key the baseline trusts is refused before VM mutation", () => {
  withFixture({ wrongKey: true }, (f) => {
    const result = run(f);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /do not verify under the updater key baseline/);
    assert.match(result.stderr, /"valid":false/);
    assert.deepEqual(calls(f).filter((line) => /^VMCTL (reset|up|down|install|ssh) /.test(line)), []);
    assert.equal(fs.existsSync(f.receipt), false);
  });
});

test("user data lost by the candidate upgrade fails the journey before rollback", () => {
  withFixture({ loseDataAfter: "candidate-upgrade" }, (f) => {
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /user data not preserved after candidate-upgrade: database-row-lost/);
    const lines = calls(f);
    assert.equal(lines.filter((line) => line.startsWith("VERIFY ")).length, 1);
    assert.equal(lines.at(-1), "VMCTL down clean");
    assert.equal(fs.existsSync(f.receipt), false);
    assert.equal(failure(f).phase, "user-data-candidate-upgrade");
  });
});

test("an encryption key created after the seed is kept, but one that existed and changed fails", () => {
  // The key file is created lazily on first use: a fresh baseline may have
  // none, and nothing can be orphaned by a key that never existed.
  withFixture({ seedKey: "absent", checkKey: "k-created-later" }, (f) => {
    const result = run(f);
    assert.equal(result.status, 0, `${result.stdout}\\n${result.stderr}`);
    const legacy = JSON.parse(fs.readFileSync(f.receipt, "utf8")).legacyClient;
    assert.deepEqual(legacy.userData.checks.map((row) => row.verdict), ["preserved", "preserved"]);
  });
  withFixture({ checkKey: "k-replaced" }, (f) => {
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /user data not preserved after candidate-upgrade: encryption-key-changed/);
    assert.equal(fs.existsSync(f.receipt), false);
    assert.equal(failure(f).phase, "user-data-candidate-upgrade");
  });
});

test("an old client answering up_to_date fails when its host is asserted unavailable", () => {
  withFixture({ updateCheck: "up_to_date" }, (f) => {
    f.args.push("--legacy-host-unavailable");
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /answered-up-to-date/);
    const lines = calls(f);
    assert.equal(lines.some((line) => line.startsWith("VERIFY ")), false);
    assert.equal(lines.at(-1), "VMCTL down clean");
    assert.equal(fs.existsSync(f.receipt), false);
    assert.equal(failure(f).phase, "old-client-update-check");
  });
});

test("an up_to_date answer is recorded, not failed, when the old host may still be live", () => {
  withFixture({ updateCheck: "up_to_date" }, (f) => {
    const result = run(f);
    assert.equal(result.status, 0, `${result.stdout}\\n${result.stderr}`);
    const legacy = JSON.parse(fs.readFileSync(f.receipt, "utf8")).legacyClient;
    assert.equal(legacy.updateCheck.verdict, "answered-up-to-date");
    assert.equal(legacy.updateCheck.hostUnavailableAsserted, false);
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
    // The guest journal is captured before the disposable VM is powered down.
    assert.deepEqual(lines.slice(-2), ["GUEST DIAGNOSTICS", "VMCTL down clean"]);
    assert.match(fs.readFileSync(path.join(diagnostics, "guest-diagnostics.log"), "utf8"), /fixture guest journal/);
    const failed = JSON.parse(fs.readFileSync(path.join(diagnostics, "failure.json"), "utf8"));
    assert.equal(failed.verdict, "FAIL");
    assert.equal(failed.phase, "candidate-upgrade");
    assert.equal(failed.exitCode, 17);
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
