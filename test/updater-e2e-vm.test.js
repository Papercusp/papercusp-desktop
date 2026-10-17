const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const vmctlPath = path.join(root, "scripts/linux-test-vm/vmctl");
const vmctlCompatPath = path.join(root, "scripts/linux-test-vm/vmctl.sh");
const federationAssertsPath = path.join(root, "bin/lib/federation-asserts.sh");
const vmctl = fs.readFileSync(vmctlPath, "utf8");
const common = fs.readFileSync(
  path.join(root, "scripts/linux-test-vm/lib/common.sh"),
  "utf8",
);
const federationDriver = fs.readFileSync(
  path.join(root, "bin/vm-federation.sh"),
  "utf8",
);

function federationFragment(startNeedle, endNeedle) {
  const start = federationDriver.indexOf(startNeedle);
  const end = federationDriver.indexOf(endNeedle, start);
  assert(
    start >= 0 && end > start,
    `federation fragment must contain ${startNeedle} before ${endNeedle}`,
  );
  return federationDriver.slice(start, end);
}

function runMemberLinksResolution(createLinks, directoryLinks = "[]") {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vm-fed-member-links-"));
  const directoryProbe = path.join(temp, "directory-calls");
  const fragment = federationFragment(
    'MEMBER_LINKS="$(fed_json "$a_resp"',
    '\nfed_log "B: JOIN',
  );
  const result = spawnSync(
    "bash",
    [
      "-c",
      [
        "fed_json() {",
        '  local input="$1" expr="$2"',
        '  case "$input" in',
        '    create-response) printf "%s" "$CREATE_LINKS" ;;',
        '    directory-row) printf "%s" "$DIRECTORY_LINKS" ;;',
        '    *) [ "$expr" = "len(d)" ] && printf "1" || return 97 ;;',
        "  esac",
        "}",
        'fed_hive_dir_row() { printf "called\\n" >>"$DIRECTORY_PROBE"; printf "directory-row"; }',
        "fed_log() { :; }",
        "a_resp=create-response",
        "HIVE_SLUG=test-hive",
        "DISCOVERY_RETRIES=1",
        fragment,
        'printf "RESULT=%s|%s\\n" "$MEMBER_LINKS" "$links_via"',
      ].join("\n"),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CREATE_LINKS: createLinks,
        DIRECTORY_LINKS: directoryLinks,
        DIRECTORY_PROBE: directoryProbe,
      },
    },
  );
  const directoryCalls = fs.existsSync(directoryProbe)
    ? fs.readFileSync(directoryProbe, "utf8").trim().split("\n").filter(Boolean)
        .length
    : 0;
  fs.rmSync(temp, { recursive: true, force: true });
  return { result, directoryCalls };
}

function runDhtCleanupProbe(keepUp) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vm-fed-keep-up-"));
  const fakeBin = path.join(temp, "bin");
  const work = path.join(temp, "work-marker");
  const pidFile = path.join(temp, "node.pid");
  fs.mkdirSync(fakeBin);
  fs.mkdirSync(work);
  const fakeNode = path.join(fakeBin, "node");
  fs.writeFileSync(
    fakeNode,
    [
      "#!/usr/bin/env bash",
      'printf "%s\\n" "$$" >"$FAKE_NODE_PID_FILE"',
      'printf "BOOTSTRAP=127.0.0.1:4242\\n"',
      "trap 'exit 0' TERM INT",
      "while :; do sleep 1; done",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  const result = spawnSync(
    "bash",
    [
      "-c",
      [
        'source "$1"',
        "fed_log() { :; }",
        'export PATH="$2:$PATH" FAKE_NODE_PID_FILE="$6"',
        'bootstrap="$(fed_start_testnet_dht "$3" "$4" "127.0.0.1" "$5")" || exit 91',
        'pid="$(cat "$6")"',
        'pid_live() { local state; state="$(awk "{print \\$3}" "/proc/$pid/stat" 2>/dev/null)"; [ -n "$state" ] && [ "$state" != Z ]; }',
        "pid_live || exit 92",
        'fed_cleanup_scoped "$4" || exit 93',
        "for _ in $(seq 1 20); do pid_live || break; sleep 0.05; done",
        "if pid_live; then after=alive; else after=dead; fi",
        'if [ "$5" = 1 ] && [ "$after" = alive ]; then kill -9 "$pid" 2>/dev/null || true; fi',
        'printf "bootstrap=%s after=%s\\n" "$bootstrap" "$after"',
      ].join("\n"),
      "bash",
      federationAssertsPath,
      fakeBin,
      root,
      work,
      String(keepUp),
      pidFile,
    ],
    { encoding: "utf8" },
  );

  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    if (Number.isInteger(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }
  fs.rmSync(temp, { recursive: true, force: true });
  return result;
}

test("vmctl.sh compatibility entrypoint delegates to canonical vmctl", () => {
  assert.doesNotThrow(() => fs.accessSync(vmctlCompatPath, fs.constants.X_OK));
  const canonical = spawnSync(vmctlPath, ["help"], { encoding: "utf8" });
  const compatibility = spawnSync(vmctlCompatPath, ["help"], {
    encoding: "utf8",
  });
  assert.equal(canonical.status, 0, canonical.stderr);
  assert.equal(compatibility.status, 0, compatibility.stderr);
  assert.equal(compatibility.stdout, canonical.stdout);
  assert.equal(compatibility.stderr, canonical.stderr);
});

test("federation join prefers create-response memberLinks without polling directory gossip", () => {
  const { result, directoryCalls } = runMemberLinksResolution(
    '["hyper://create-link"]',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    directoryCalls,
    0,
    "a usable create response must bypass directory gossip entirely",
  );
  assert.match(
    result.stdout,
    /RESULT=\["hyper:\/\/create-link"\]\|create-response\(A\)/,
  );
});

test("federation join falls back to directory memberLinks only when the create response has none", () => {
  const { result, directoryCalls } = runMemberLinksResolution(
    "[]",
    '["hyper://directory-link"]',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(directoryCalls, 1);
  assert.match(
    result.stdout,
    /RESULT=\["hyper:\/\/directory-link"\]\|directory\(B\)/,
  );
});

test("missing post-join directory projection is an observable warning, not a failure", () => {
  const fragment = federationFragment(
    'if [ "$links_via" = "create-response(A)" ]; then',
    "\n# ── 11.",
  );
  const result = spawnSync(
    "bash",
    [
      "-c",
      [
        "fed_log() { :; }",
        "fed_hive_dir_row() { return 1; }",
        "fed_json() { return 97; }",
        'links_via="create-response(A)"',
        "HIVE_SLUG=test-hive",
        fragment,
        'printf "SURVIVED\\n"',
      ].join("\n"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /directory announce not observed on B.*continuing/,
  );
  assert.match(result.stdout, /SURVIVED/);
});

test("VM federation cleanup reaps an ordinary testnet DHT but preserves --keep-up for reuse", () => {
  const ordinary = runDhtCleanupProbe(0);
  assert.equal(ordinary.status, 0, ordinary.stderr);
  assert.match(ordinary.stdout, /bootstrap=127\.0\.0\.1:4242 after=dead/);

  const kept = runDhtCleanupProbe(1);
  assert.equal(kept.status, 0, kept.stderr);
  assert.match(kept.stdout, /bootstrap=127\.0\.0\.1:4242 after=alive/);

  const dhtSetup = federationFragment('BOOTSTRAP=""', "\n# ── 7.");
  assert.match(dhtSetup, /BOOTSTRAP="\$DHT_BOOTSTRAP_OVERRIDE"/);
  assert.match(
    dhtSetup,
    /fed_start_testnet_dht "\$OPERATOR_DIR" "\$WORK" "\$FEDBR_HOST_IP" "\$KEEP_UP"/,
  );
  assert(
    dhtSetup.indexOf('BOOTSTRAP="$DHT_BOOTSTRAP_OVERRIDE"') <
      dhtSetup.indexOf("fed_start_testnet_dht"),
    "an explicit reusable bootstrap must bypass spawning a new testnet",
  );
});

function updaterFunction() {
  const start = vmctl.indexOf("cmd_updater_e2e()");
  const end = vmctl.indexOf("\ncmd_gui()", start);
  assert(
    start >= 0 && end > start,
    "cmd_updater_e2e must exist before cmd_gui",
  );
  return vmctl.slice(start, end);
}

function guiPasteFunction() {
  const start = vmctl.indexOf("cmd_gui_paste()");
  const end = vmctl.indexOf("\n# A QEMU screendump", start);
  assert(
    start >= 0 && end > start,
    "cmd_gui_paste must exist before screenshot helpers",
  );
  return vmctl.slice(start, end);
}

function mainWindowVisible(tree) {
  const result = spawnSync(
    "bash",
    [
      "-c",
      'PAPERCUSP_VMCTL_SOURCE_ONLY=1 source "$1"; papercusp_window_tree_has_main',
      "bash",
      vmctlPath,
    ],
    { encoding: "utf8", input: tree },
  );
  return result.status === 0;
}

function operatorPortProbe(name) {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vmctl-op-port-"));
  const commandPath = path.join(probeDir, "command");
  const result = spawnSync(
    "bash",
    [
      "-c",
      [
        'PAPERCUSP_VMCTL_SOURCE_ONLY=1 source "$1"',
        "vm_ssh() { printf '%s\\n' \"$2\" >\"$PROBE_FILE\"; printf '3093\\n'; }",
        'op_port "$2"',
      ].join("\n"),
      "bash",
      vmctlPath,
      name,
    ],
    { encoding: "utf8", env: { ...process.env, PROBE_FILE: commandPath } },
  );
  try {
    assert.equal(result.status, 0, result.stderr);
    return {
      port: result.stdout.trim(),
      command: fs.readFileSync(commandPath, "utf8"),
    };
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

function statusNoProcessProbe() {
  const result = spawnSync(
    "bash",
    [
      "-c",
      [
        'PAPERCUSP_VMCTL_SOURCE_ONLY=1 source "$1"',
        // A pgrep -c miss writes one zero and exits 1, matching GNU pgrep.
        'pgrep() { printf "0\\n"; return 1; }',
        "export -f pgrep",
        "vm_running() { return 0; }",
        'vm_pid() { printf "4242\\n"; }',
        'vm_ssh() { local _name="$1"; shift; [ "${1:-}" = true ] && return 0; bash -c "${1:-}"; }',
        "op_port() { :; }",
        "cmd_status clean",
      ].join("\n"),
      "bash",
      vmctlPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function ppmVisible(file) {
  return spawnSync(
    "bash",
    [
      "-c",
      'PAPERCUSP_VMCTL_SOURCE_ONLY=1 source "$1"; ppm_has_visible_pixels "$2"',
      "bash",
      vmctlPath,
      file,
    ],
    { encoding: "utf8" },
  );
}

test("updater E2E is pinned to a dedicated disposable VM lane", () => {
  const fn = updaterFunction();
  // Fixed lanes are resolved by _testvm_fixed_slot (`updater) echo 3 ;;`).
  assert.match(common, /_testvm_fixed_slot\(\)/);
  assert.match(common, /updater\) echo 3 ;;/);
  assert.match(fn, /updater\|updater-/);
  assert.match(fn, /cmd_reset "\$name"/);
  assert(fn.indexOf('cmd_reset "$name"') < fn.indexOf('cmd_up "$name"'));
  assert.match(fn, /PAPERCUSP_E2E_RUNTIME_DEB/);
  assert(
    fn.indexOf('cmd_install "$name" "$runtime_deb"') <
      fn.indexOf('vm_scp "$name" "$appimage"'),
  );
  assert.match(common, /grep -v '\/Papercusp Server_'/);
});

test("vmctl install waits boundedly for every guest apt lock before update and install", () => {
  const start = vmctl.indexOf("cmd_install()");
  const end = vmctl.indexOf("\ncmd_launch()", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const install = vmctl.slice(start, end);

  for (const lock of [
    "/var/lib/apt/lists/lock",
    "/var/cache/apt/archives/lock",
    "/var/lib/dpkg/lock-frontend",
    "/var/lib/dpkg/lock",
  ]) {
    assert.ok(install.includes(lock), `missing bounded wait for ${lock}`);
  }
  assert.match(install, /deadline=.*date \+%s.*\+ 300/);
  assert.match(install, /clear_streak.*-ge 2/);
  assert.match(install, /pgrep -x apt-get/);

  const definition = install.indexOf("wait_for_guest_apt_idle()");
  const update = install.indexOf("apt-get update -qq");
  const packageInstall = install.indexOf(
    "apt-get -o DPkg::Lock::Timeout=300 install -y --reinstall",
  );
  const waitCalls = [...install.matchAll(/wait_for_guest_apt_idle/g)].map(
    (match) => match.index,
  );
  assert.ok(waitCalls.some((index) => index > definition && index < update));
  assert.ok(
    waitCalls.some((index) => index > update && index < packageInstall),
  );
  assert.match(
    install,
    /apt-get -o DPkg::Lock::Timeout=300 install -y --reinstall/,
  );
});

test("vmctl refuses a fed-* boot without the federation NIC and distinct slirp context", () => {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vmctl-fed-boot-"));
  const marker = path.join(probeDir, "booted");
  const runCommand = (setup, name = "fed-a") => {
    fs.rmSync(marker, { force: true });
    return spawnSync(
      "bash",
      [
        "-c",
        [
          'PAPERCUSP_VMCTL_SOURCE_ONLY=1 source "$1"',
          setup,
          'ensure_overlay() { printf "overlay\\n" >>"$MARKER"; }',
          'bash() { printf "qemu\\n" >>"$MARKER"; }',
          "wait_ssh() { return 0; }",
          'cmd_up "$2"',
        ].join("\n"),
        "bash",
        vmctlPath,
        name,
      ],
      { encoding: "utf8", env: { ...process.env, MARKER: marker } },
    );
  };

  try {
    const missing = runCommand("unset FED_NIC SLIRP_NET");
    assert.equal(missing.status, 1);
    assert.match(
      missing.stderr,
      /refusing to boot federation VM fed-a without FED_NIC \+ SLIRP_NET/,
    );
    assert.match(missing.stderr, /bin\/vm-federation\.sh/);
    assert.equal(
      fs.existsSync(marker),
      false,
      "invalid fed-* context must fail before overlay/QEMU work",
    );

    const partial = runCommand("export FED_NIC=nic; unset SLIRP_NET");
    assert.equal(partial.status, 1);
    assert.equal(fs.existsSync(marker), false);

    const configured = runCommand("export FED_NIC=nic SLIRP_NET=10.31.1.0/24");
    assert.equal(configured.status, 0, configured.stderr);
    assert.equal(fs.readFileSync(marker, "utf8"), "overlay\nqemu\n");

    const ordinaryVm = runCommand("unset FED_NIC SLIRP_NET", "clean");
    assert.equal(ordinaryVm.status, 0, ordinaryVm.stderr);
    assert.equal(fs.readFileSync(marker, "utf8"), "overlay\nqemu\n");
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
});

test("vmctl refuses a fed-* launch without identity and an intentional DHT mode", () => {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "vmctl-fed-launch-"));
  const runGuard = (fedEnv, name = "fed-a") => {
    fs.rmSync(path.join(probeDir, "fed.env"), { force: true });
    fs.rmSync(path.join(probeDir, "launched"), { force: true });
    if (fedEnv !== null)
      fs.writeFileSync(path.join(probeDir, "fed.env"), fedEnv);
    return spawnSync(
      "bash",
      [
        "-c",
        [
          'PAPERCUSP_VMCTL_SOURCE_ONLY=1 source "$1"',
          'vm_ssh() { local _name="$1"; shift; HOME="$FAKE_HOME" bash -c "$*"; }',
          "vm_running() { return 0; }",
          'vm_run() { cat >/dev/null; printf "launched\\n" >"$FAKE_HOME/launched"; }',
          'cmd_launch "$2"',
        ].join("\n"),
        "bash",
        vmctlPath,
        name,
      ],
      { encoding: "utf8", env: { ...process.env, FAKE_HOME: probeDir } },
    );
  };

  try {
    const missing = runGuard(null);
    assert.equal(missing.status, 1);
    assert.match(
      missing.stderr,
      /refusing to launch federation VM fed-a without a validated ~\/fed\.env/,
    );
    assert.equal(fs.existsSync(path.join(probeDir, "launched")), false);

    assert.equal(runGuard("GH_TOKEN=test-token\n").status, 1);
    assert.equal(fs.existsSync(path.join(probeDir, "launched")), false);

    const testnet = runGuard(
      "GH_TOKEN=test-token\nPAPERCUSP_DHT_BOOTSTRAP=10.77.0.1:40059\n",
    );
    assert.equal(testnet.status, 0, testnet.stderr);
    assert.equal(
      fs.readFileSync(path.join(probeDir, "launched"), "utf8"),
      "launched\n",
    );

    const publicDht = runGuard(
      "GH_TOKEN=test-token\nPAPERCUSP_FED_DHT_MODE=public\n",
    );
    assert.equal(publicDht.status, 0, publicDht.stderr);
    assert.equal(
      fs.readFileSync(path.join(probeDir, "launched"), "utf8"),
      "launched\n",
    );

    const ordinaryVm = runGuard(null, "clean");
    assert.equal(ordinaryVm.status, 0, ordinaryVm.stderr);
    assert.equal(
      fs.readFileSync(path.join(probeDir, "launched"), "utf8"),
      "launched\n",
    );
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }

  assert.match(federationDriver, /PAPERCUSP_FED_DHT_MODE=%s/);
});

test("vmctl GUI launch preserves the independently-owned Server runtime", () => {
  const start = vmctl.indexOf("cmd_launch()");
  const end = vmctl.indexOf("\n# cmd_hotpatch", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const launch = vmctl.slice(start, end);

  assert.match(launch, /pkill -9 -f '\[p\]apercusp-desktop'/);
  assert.doesNotMatch(
    launch,
    /pkill[^\n]*(?:serve\.mjs|embedded-postgres|code-server)/,
  );
  assert.doesNotMatch(launch, /pgrep[^\n]*serve\.mjs/);
});

// Run the production command composition; only the VM transport, disk copy,
// service and identity observation are replaced. No SSH, VM or daemon exists.
function runHotpatchCommand(mode = "ok", command = "hotpatch", name = "clean") {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vmctl-hotpatch-"));
  const source = path.join(temp, "serve.mjs");
  fs.writeFileSync(source, "new bundle\n");
  const digest = require("node:crypto").createHash("sha256")
    .update(fs.readFileSync(source)).digest("hex");
  try {
    const result = spawnSync("bash", ["-c", [
      'PAPERCUSP_VMCTL_SOURCE_ONLY=1 source "$1"',
      'vm_running() { return 0; }',
      'vm_ssh() { return 1; }',
      'vm_hotpatch_sidecar() { printf "copy:%s\\n" "$1" >>"$TRACE"; }',
      'vm_hotpatch_provenance() { printf "%s|desktop|outer|clean\\n" "${DIGEST:0:12}"; }',
      'vm_server_loaded_identity() {',
      '  printf "identity\\n" >>"$TRACE"',
      '  [ "$MODE" != unsupported ] || return 1',
      '  if [ ! -f "$RESTARTED" ] || [ "$MODE" = unchanged ]; then',
      '    printf "linux:boot:10|old-bundle|11111111111111111111111111111111\\n"',
      '  elif [ "$MODE" = unavailable ]; then return 1',
      '  elif [ "$MODE" = stale ]; then',
      '    printf "linux:boot:20|old-bundle|22222222222222222222222222222222\\n"',
      '  else printf "linux:boot:20|%s|22222222222222222222222222222222\\n" "$DIGEST"; fi',
      '}',
      'xdpyinfo() { return 0; }; pgrep() { return 1; }',
      'pkill() { printf "kill:%s\\n" "$*" >>"$TRACE"; }',
      'setsid() { printf "gui\\n" >>"$TRACE"; }',
      'sleep() { :; }',
      'export -f xdpyinfo pgrep pkill setsid sleep',
      'vm_run() {',
      '  local script; script="$(cat)"',
      '  if [[ "$script" == *"systemctl --user restart papercusp-server.service"* ]]; then',
      '    printf "restart:%s\\n" "$1" >>"$TRACE"',
      '    [ "$MODE" != failed ] || return 17',
      '    touch "$RESTARTED"',
      '  else { printf "%s\\n" "$script"; echo wait; } | bash -s; fi',
      '}',
      // Virtual controller clock expires a failed observation immediately.
      'date() { if [ -f "$CLOCK" ]; then echo 222; else touch "$CLOCK"; echo 100; fi; }',
      'if [ "$3" = launch ]; then cmd_launch "$4"; else cmd_hotpatch "$4" "$2"; fi',
    ].join("\n"), "bash", vmctlPath, source, command, name], {
      encoding: "utf8", timeout: 5000,
      env: { ...process.env, MODE: mode, DIGEST: digest, HOME: temp,
        TRACE: path.join(temp, "trace"), RESTARTED: path.join(temp, "restarted"),
        CLOCK: path.join(temp, "clock") },
    });
    const trace = fs.existsSync(path.join(temp, "trace"))
      ? fs.readFileSync(path.join(temp, "trace"), "utf8").trim().split("\n") : [];
    return { result, trace };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

test("production GUI-only launch preserves Server; hotpatch reloads Server before GUI acceptance", () => {
  const gui = runHotpatchCommand("ok", "launch");
  assert.equal(gui.result.status, 0, gui.result.stderr);
  assert.deepEqual(gui.trace, ["gui"]);
  const patched = runHotpatchCommand();
  assert.equal(patched.result.status, 0, patched.result.stderr);
  assert.deepEqual(patched.trace, ["identity", "copy:clean", "restart:clean", "identity", "gui"]);
  assert.match(patched.result.stdout + patched.result.stderr, /Server reload verified \(linux:boot:20\|[a-f0-9]{64}\|2222/);
});

for (const [mode, refusal, trace] of [
  ["unsupported", /cannot identify the service-owned Server/, ["identity"]],
  ["failed", /restarting the Server user service/, ["identity", "copy:clean", "restart:clean"]],
  ["stale", /loaded identity differs from hotpatch disk provenance/, ["identity", "copy:clean", "restart:clean", "identity"]],
  ["unchanged", /did not establish a new loaded identity/, ["identity", "copy:clean", "restart:clean", "identity"]],
  ["unavailable", /did not establish a new loaded identity/, ["identity", "copy:clean", "restart:clean", "identity"]],
]) {
  test(`production hotpatch refuses ${mode} Server reload without GUI or success acceptance`, () => {
    const probe = runHotpatchCommand(mode);
    assert.notEqual(probe.result.status, 0);
    assert.match(probe.result.stdout + probe.result.stderr, refusal);
    assert.deepEqual(probe.trace, trace);
    assert.doesNotMatch(probe.result.stdout + probe.result.stderr, /Server reload verified|GUI relaunched/);
  });
}

test("production hotpatch validates federation context before copying or restarting", () => {
  const probe = runHotpatchCommand("ok", "hotpatch", "fed-a");
  assert.equal(probe.result.status, 1);
  assert.match(probe.result.stderr, /without a validated ~\/fed\.env/);
  assert.deepEqual(probe.trace, []);
});

// Execute the real emitted identity probe against synthetic procfs, with the
// service and HTTP primitives stubbed. This exercises the actual birth/path/
// cgroup/digest assertions rather than returning a preselected identity string.
function runServerIdentityFixture(fault = "none", phase = "loaded") {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vmctl-server-identity-"));
  const side = path.join(temp, "lib/Papercusp Server/sidecar");
  const proc = path.join(temp, "proc");
  const bin = path.join(temp, "bin");
  const birth = `linux:fixture-boot:${fault === "old-process" ? "1" : "99000"}`;
  const group = "/user.slice/papercusp-server.service";
  try {
    for (const dir of [side, bin, path.join(temp, ".papercusp"),
      path.join(proc, "4242"), path.join(proc, "sys/kernel/random")]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const entry = path.join(side, "serve.mjs");
    fs.writeFileSync(entry, "Server bundle\n");
    const guiSide = path.join(temp, "lib/Papercusp GUI/sidecar");
    fs.mkdirSync(guiSide, { recursive: true });
    fs.writeFileSync(path.join(guiSide, "serve.mjs"), "unrelated GUI bundle\n");
    fs.writeFileSync(path.join(temp, ".papercusp/operator.json"), JSON.stringify({
      pid: 4242, port: 3093, processIdentity: fault === "birth" ? "linux:fixture-boot:1" : birth,
    }));
    const fields = Array(20).fill("0"); fields[0] = "S";
    fields[19] = fault === "old-process" ? "1" : "99000";
    fs.writeFileSync(path.join(proc, "4242/stat"), `4242 (node) ${fields.join(" ")}\n`);
    fs.writeFileSync(path.join(proc, "sys/kernel/random/boot_id"), "fixture-boot\n");
    fs.writeFileSync(path.join(proc, "uptime"), "1000 0\n");
    fs.writeFileSync(path.join(proc, "4242/cgroup"), `0::${fault === "foreign" ? "/other.service" : group}\n`);
    fs.writeFileSync(path.join(bin, "node"), "fixture executable\n");
    fs.symlinkSync(path.join(bin, "node"), path.join(proc, "4242/exe"));
    fs.writeFileSync(path.join(proc, "4242/cmdline"), ["node", "--require",
      path.join(side, "sidecar-preload.js"), fault === "gui-path" ? path.join(guiSide, "serve.mjs") : entry,
      "--ensure", ""].join("\0"));
    fs.writeFileSync(path.join(proc, "4242/environ"), "GH_TOKEN=fixture-token\0");
    if (fault === "federation") fs.writeFileSync(path.join(temp, "fed.env"), "GH_TOKEN=other-token\n");
    fs.writeFileSync(path.join(bin, "systemctl"), ["#!/usr/bin/env bash",
      '[ "$FAULT" != unsupported ] || exit 1',
      'case "$*" in',
      '  "--user is-active --quiet papercusp-server.service") exit 0 ;;',
      `  "--user show -p ControlGroup --value papercusp-server.service") echo '${group}' ;;`,
      '  "--user show -p InvocationID --value papercusp-server.service") echo 11111111111111111111111111111111 ;;',
      '  *) exit 99 ;;', "esac", ""].join("\n"), { mode: 0o755 });
    fs.writeFileSync(path.join(temp, "sitecustomize.py"), [
      "import io,json,os,time,urllib.request",
      `time.time = lambda: ${Date.now() / 1000 + 100}`,
      "def health(url, timeout):",
      "    assert url == 'http://127.0.0.1:3093/api/health' and timeout == 3",
      "    return io.BytesIO(json.dumps({'ok':True,'service':'other' if os.environ['FAULT']=='health' else 'papercusp-operator'}).encode())",
      "urllib.request.urlopen = health", ""].join("\n"));
    const result = spawnSync("bash", ["-c", [
      'PAPERCUSP_VMCTL_SOURCE_ONLY=1 source "$1"',
      'vm_run() { shift; for kv in "$@"; do export "$kv"; done; bash -s; }',
      'vm_ssh() { shift; bash -c "$1"; }',
      'vm_server_loaded_identity fixture "$2"',
      'printf "disk="; vm_deployed_sidecar_id fixture',
    ].join("\n"), "bash", vmctlPath, phase], {
      encoding: "utf8", timeout: 5000,
      env: { ...process.env, HOME: temp, VM_SIDE_ROOT: path.join(temp, "lib"),
        VM_PROC_ROOT: proc, PATH: `${bin}:${process.env.PATH}`, PYTHONPATH: temp,
        FAULT: fault },
    });
    const digest = require("node:crypto").createHash("sha256").update(fs.readFileSync(entry)).digest("hex");
    return { result, digest, birth };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

test("loaded identity binds the Server service, birth, packaged entry and health to its full digest", () => {
  const probe = runServerIdentityFixture();
  assert.equal(probe.result.status, 0, probe.result.stderr);
  assert.match(probe.result.stdout, new RegExp(`${probe.birth}\\|${probe.digest}\\|11111111111111111111111111111111`));
  assert.match(probe.result.stdout, new RegExp(`disk=${probe.digest.slice(0, 12)} `));
});

test("ownership preflight permits recovery of an old process without claiming its disk bytes are loaded", () => {
  const probe = runServerIdentityFixture("old-process", "ownership");
  assert.equal(probe.result.status, 0, probe.result.stderr);
  assert.match(probe.result.stdout, /linux:fixture-boot:1\|unverified\|1111/);
});

for (const [fault, refusal] of [
  ["birth", /operator birth identity mismatch/],
  ["foreign", /operator is outside Server service/],
  ["gui-path", /unsupported Server Node entry/],
  ["old-process", /bundle changed after Server started/],
  ["federation", /Server federation environment mismatch/],
  ["health", /operator is not healthy/],
]) {
  test(`loaded identity rejects ${fault} despite a readable on-disk Server bundle`, () => {
    const probe = runServerIdentityFixture(fault);
    assert.equal(probe.result.status, 1);
    assert.match(probe.result.stderr, refusal);
    assert.doesNotMatch(probe.result.stdout, new RegExp(probe.digest));
  });
}

test("vmctl gui-paste preserves exact URL bytes and captures before submit", () => {
  const fn = guiPasteFunction();
  assert.match(fn, /CLIPBOARD_B64=/);
  assert.match(fn, /xclip -selection clipboard -in/);
  assert.match(
    fn,
    /xdotool key --window "\$active_window" --clearmodifiers ctrl\+v/,
  );
  assert.doesNotMatch(fn, /xdotool type/);
  assert.match(fn, /screenshot "\$name" "\$out"/);
  assert.match(fn, /submit separately after inspecting/);
});

test("updater E2E proves a different kernel and never seeds live home state", () => {
  const fn = updaterFunction();
  assert.match(fn, /systemd-detect-virt/);
  assert.match(fn, /guest_boot.*!=.*host_boot/);
  assert.match(fn, /PAPERCUSP_E2E_PID_ISOLATED=1/);
  assert.match(fn, /e2e_home="\$e2e_root\/home"/);
  assert.match(fn, /forbidden PID-bearing seed/);
  assert.doesNotMatch(fn, /(?:rsync|cp -a).*\.papercusp/);
});

test("guest startup validates operator birth identity against guest procfs", () => {
  const fn = updaterFunction();
  assert.match(fn, /operator\.json/);
  assert.match(fn, /processIdentity/);
  assert.match(fn, /fields\[19\]/);
  assert.match(fn, /isolation-proof\.json/);
  assert.match(fn, /operatorIdentityVerified":false/);
  assert.match(fn, /operatorIdentityVerified":true/);
  assert.match(fn, /artifact predates the.*stale-PID cleanup fix/s);
  assert(
    fn.indexOf('operatorIdentityVerified":false') <
      fn.indexOf('record.get("processIdentity")'),
    "kernel-isolation evidence must survive rejection of a stale artifact",
  );
});

test("VM status resolves updater-e2e operator discovery from its isolated HOME", () => {
  const updater = operatorPortProbe("updater");
  assert.equal(updater.port, "3093");
  assert.match(
    updater.command,
    /updater-e2e\/home\/\.papercusp\/operator\.json/,
  );
  assert.doesNotMatch(
    updater.command,
    /expanduser\('~\/\.papercusp\/operator\.json'\)/,
  );

  const updaterLane = operatorPortProbe("updater-2");
  assert.match(
    updaterLane.command,
    /updater-e2e\/home\/\.papercusp\/operator\.json/,
  );

  const normal = operatorPortProbe("clean");
  assert.equal(normal.port, "3093");
  assert.match(normal.command, /~\/\.papercusp\/operator\.json/);
  assert.doesNotMatch(normal.command, /updater-e2e\/home/);
});

test("VM verification accepts only a full-size Papercusp main window", () => {
  assert.equal(
    mainWindowVisible(
      "0x800242 (has no name): () 1280x800+0+0\n" +
        '  0xa00003 "Papercusp": ("papercusp-desktop" "Papercusp-desktop") 1278x775+1+20\n',
    ),
    true,
  );

  assert.equal(
    mainWindowVisible(
      '0xc00001 "papercusp-desktop": ("papercusp-desktop" "Papercusp-desktop") 10x10+10+10\n' +
        '0xa00024 "xmessage": ("xmessage" "Xmessage") 207x52+537+400\n',
    ),
    false,
    "tray/server placeholders and unrelated dialogs must not satisfy GUI verification",
  );

  assert.equal(
    mainWindowVisible(
      '0xa00003 "Papercusp": ("papercusp-desktop" "Papercusp-desktop") 799x599+1+20\n',
    ),
    false,
    "a titled placeholder below the configured minimum geometry must not pass",
  );
});

test("VM verification requires the packaged GUI runtime role and bundle identifier", () => {
  const start = vmctl.indexOf("cmd_verify()");
  const end = vmctl.indexOf("\ncmd_status()", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const verify = vmctl.slice(start, end);

  assert.match(verify, /GUI runtime role \+ bundle identifier/);
  assert.match(verify, /role=gui \(identifier com\.papercusp\.gui\)/);
  assert.match(verify, /\.papercusp\/logs\/gui\.log/);
});

test("VM screenshot rejects a nonempty all-black PPM and keeps the guest fallback reachable", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vmctl-screenshot-"));
  const black = path.join(temp, "black.ppm");
  const visible = path.join(temp, "visible.ppm");
  const header = Buffer.from("P6\n2 1\n255\n");
  fs.writeFileSync(black, Buffer.concat([header, Buffer.alloc(6)]));
  fs.writeFileSync(
    visible,
    Buffer.concat([header, Buffer.from([0, 0, 0, 0, 0, 1])]),
  );

  try {
    assert.notEqual(
      ppmVisible(black).status,
      0,
      "an all-black but nonempty screendump must not pass",
    );
    assert.equal(
      ppmVisible(visible).status,
      0,
      "a PPM with a visible pixel must pass",
    );

    const start = vmctl.indexOf("screenshot()");
    const end = vmctl.indexOf("\nvm_scp_back()", start);
    const screenshot = vmctl.slice(start, end);
    assert(
      start >= 0 && end > start,
      "screenshot() must remain source-visible to the guard",
    );
    assert(
      screenshot.indexOf('ppm_has_visible_pixels "$out"') <
        screenshot.indexOf("scrot -o /tmp/shot.ppm"),
      "the qemu PPM must be validated before falling back to the guest framebuffer",
    );
    assert.match(screenshot, /vm_scp_back "\$name" \/tmp\/shot\.ppm "\$out"/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("VM status reports one scalar zero for absent process counts", () => {
  const output = statusNoProcessProbe();
  assert.match(output, /^procs:\s+desktop=0 serve\.mjs=0$/m);
  assert.doesNotMatch(
    output,
    /^0$/m,
    "an absent process must not add a second fallback zero line",
  );
});

test("vmctl help emits only the leading comment block", () => {
  const result = spawnSync(vmctlPath, ["help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /^vmctl — Papercusp Linux clean-room test VM control\./,
  );
  assert.doesNotMatch(result.stdout, /\bsource\s+.*common\.sh/);
  assert.doesNotMatch(result.stdout, /\bcmd_provision\s*\(/);
  assert.doesNotMatch(result.stdout, /\bSELF_DIR\s*=/);
});
