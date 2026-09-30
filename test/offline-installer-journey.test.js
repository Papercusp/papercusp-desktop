'use strict';

// WI-10003962 — P-521 "Full installer" row driver. Drive the REAL
// bin/offline-installer-journey.sh end to end: real fake .debs built with
// dpkg-deb, real witness extraction, the real remote scripts executed by an
// ssh shim inside a sandbox root (stubbed apt/systemctl/iptables/curl), and a
// real fake operator process whose listener is resolved to the installed
// bin/node bytes. Every negative case asserts that a skipped, void or
// unmeasured leg can never produce a PASS.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test, after } = require('node:test');

// Overridable so scripts/mutation-probe.sh can point the suite at a mutated COPY.
const SCRIPT = process.env.PCOIJ_SCRIPT || join(__dirname, '..', 'bin', 'offline-installer-journey.sh');
const VERSION = '0.0.25';
const GIT_HEAD = '93f1c72063bb422583c9c24e7092f1bed767f64f';
// What the real Tauri binary compiles in (option_env!("PAPERCUSP_BUILD_SHA")) and
// hands its sidecar, so /api/health reports it: the desktop head, which is NOT the
// workspace source sha above (0.0.25: health cddbd8d5, source 93f1c720).
const BAKED_SHA = 'cddbd8d530d8d3a7c49f22a371347d601a24ba47';
const PY = ['/usr/bin/python3.12', '/usr/bin/python3'].find((p) => existsSync(p));
const HAVE_TOOLS = Boolean(PY) && spawnSync('bash', ['-c', 'command -v dpkg-deb && command -v ss'], { encoding: 'utf8' }).status === 0;
const roots = [];

after(() => {
  for (const root of roots) {
    const pidfile = join(root, 'state', 'operator.pid');
    if (existsSync(pidfile)) {
      try { process.kill(Number(readFileSync(pidfile, 'utf8').trim()), 'SIGKILL'); } catch {}
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function exe(file, source) { writeFileSync(file, source); chmodSync(file, 0o755); }
function sha(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }

// The fake operator: python run by the installed "bin/node" (a copy of the
// python interpreter), so /proc/<pid>/exe resolves INSIDE the installed tree.
const SERVE = `
import http.server, json, os, sys
side = os.path.dirname(os.path.abspath(__file__))
prov = json.load(open(os.path.join(side, 'build-provenance.json')))
sha = os.environ.get('FAKE_HEALTH_SHA') or os.environ.get('FAKE_BAKED_BUILD_SHA', '')[:8]
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({'ok': True, 'sha': sha, 'version': prov['version']}).encode()
        self.send_response(200); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
srv = http.server.HTTPServer(('127.0.0.1', 0), H)
home = os.path.join(os.environ['HOME'], '.papercusp'); os.makedirs(home, exist_ok=True)
json.dump({'port': srv.server_address[1], 'pid': os.getpid()}, open(os.path.join(home, 'operator.json'), 'w'))
srv.serve_forever()
`;

// Declared relations shaped like the real Tauri .debs: the GUI needs the distro's
// WebKitGTK (with an alternative) AND the Papercusp Server package, which the
// online provisioning step must never install.
const DEPENDS = {
  'papercusp-server': { depends: 'libc6 (>= 2.35)' },
  'papercusp-gui': { depends: 'libwebkit2gtk-4.1-0 (>= 2.40) | libwebkit2gtk-4.1-0-alt, papercusp-server (= 0.0.25)', recommends: 'xdg-desktop-portal-gtk' },
};

function buildDeb(root, name, pkg, { serve = SERVE, migrations = ['1236-a.sql', '1237-b.sql'] } = {}) {
  const dir = join(root, 'build', name);
  mkdirSync(join(dir, 'DEBIAN'), { recursive: true });
  const rel = DEPENDS[pkg] ?? {};
  writeFileSync(join(dir, 'DEBIAN', 'control'), `Package: ${pkg}\nVersion: ${VERSION}\nArchitecture: amd64\nMaintainer: t\n${rel.depends ? `Depends: ${rel.depends}\n` : ''}${rel.recommends ? `Recommends: ${rel.recommends}\n` : ''}Description: t\n`);
  if (pkg === 'papercusp-server') {
    const side = join(dir, 'usr', 'lib', 'Papercusp Server', 'sidecar');
    mkdirSync(join(side, 'bin'), { recursive: true });
    mkdirSync(join(side, 'db-sql'), { recursive: true });
    mkdirSync(join(side, 'env-sidecars', 'staging'), { recursive: true });
    copyFileSync(PY, join(side, 'bin', 'node'));
    chmodSync(join(side, 'bin', 'node'), 0o755);
    writeFileSync(join(side, 'serve.mjs'), serve);
    writeFileSync(join(side, 'env-sidecars', 'staging', 'serve.mjs'), '# staging copy, not the runtime\n');
    writeFileSync(join(side, 'build-provenance.json'), JSON.stringify({ version: VERSION, buildSha: '', gitHead: GIT_HEAD }));
    for (const m of migrations) writeFileSync(join(side, 'db-sql', m), `-- ${m}\n`);
  } else {
    mkdirSync(join(dir, 'usr', 'bin'), { recursive: true });
    exe(join(dir, 'usr', 'bin', 'papercusp-desktop'), '#!/bin/sh\nexit 0\n');
  }
  const out = join(root, 'artifacts', `${name}.deb`);
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  const r = spawnSync('dpkg-deb', ['-Znone', '--root-owner-group', '-b', dir, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return out;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pcoij-test-'));
  roots.push(root);
  const stubs = join(root, 'stubs');
  const target = join(root, 'target');
  const home = join(root, 'home');
  const state = join(root, 'state');
  for (const d of [stubs, target, home, state]) mkdirSync(d, { recursive: true });

  const gui = buildDeb(root, 'Papercusp GUI_0.0.25_amd64', 'papercusp-gui');
  const server = buildDeb(root, 'Papercusp Server_0.0.25_amd64', 'papercusp-server');

  // ssh: run the real remote script locally, in the sandbox, behind the stubs.
  const ssh = join(stubs, 'ssh-shim');
  exe(ssh, `#!/usr/bin/env bash
printf 'SSH %s\\n' "$*" >> "$FAKE_STATE/transport.log"
exec env HOME="$FAKE_HOME" PATH="$FAKE_STUBS:$PATH" bash -s
`);
  const scp = join(stubs, 'scp-shim');
  exe(scp, `#!/usr/bin/env bash
src="\${@: -2:1}"; dst="\${@: -1}"; dst="\${dst#*:}"
printf 'SCP %s -> %s\\n' "$src" "$dst" >> "$FAKE_STATE/transport.log"
mkdir -p "$(dirname "$dst")" && cp "$src" "$dst"
`);
  exe(join(stubs, 'sudo'), '#!/usr/bin/env bash\n[ "$1" = -n ] && shift\nexec "$@"\n');
  exe(join(stubs, 'loginctl'), '#!/usr/bin/env bash\necho "loginctl $*" >> "$FAKE_STATE/calls.log"\n');
  // dpkg-query: the Papercusp status query reads dpkg-status; the whole-system
  // package=version listing (the provisioning before/after diff) reads dpkg-all.
  exe(join(stubs, 'dpkg-query'), `#!/usr/bin/env bash
case "$*" in
  *papercusp-*) [ -f "$FAKE_STATE/dpkg-status" ] || exit 1; tr '\\n' ' ' < "$FAKE_STATE/dpkg-status" ;;
  *) [ -f "$FAKE_STATE/dpkg-all" ] && cat "$FAKE_STATE/dpkg-all"; exit 0 ;;
esac
`);
  // apt-get, faithful to the behaviour measured on the real 0.0.25 Linux VM:
  //  - satisfy installs each declared relation (first alternative) or fails on an
  //    unsatisfiable one (FAKE_APT_UNSATISFIABLE);
  //  - FAKE_APT_MISSING is a package the install still needs that nothing
  //    provisioned; with --no-download apt ABORTS before printing any Inst line,
  //    -s included — only a plain -s simulation names it.
  exe(join(stubs, 'apt-get'), `#!/usr/bin/env bash
echo "apt-get $*" >> "$FAKE_STATE/calls.log"
[ "$1" = update ] && exit 0
installed() { grep -q "^$1=" "$FAKE_STATE/dpkg-all" 2>/dev/null; }
if [ "$1" = satisfy ]; then
  shift; spec=""; for a in "$@"; do case "$a" in -*) ;; *) spec="$a" ;; esac; done
  for u in \${FAKE_APT_UNSATISFIABLE:-}; do case "$spec" in *"$u"*) echo "E: Unable to satisfy dependencies. Reached two conflicting assignments: $u"; exit 100 ;; esac; done
  printf '%s\\n' "$spec" | tr ',' '\\n' | sed 's/|.*//; s/(.*//; s/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' | while read -r p; do
    installed "$p" || echo "$p=2.44" >> "$FAKE_STATE/dpkg-all"; done
  exit 0
fi
debs=(); sim=0; nodl=0
for a in "$@"; do case "$a" in -s) sim=1 ;; --no-download) nodl=1 ;; *.deb) debs+=("$a") ;; esac; done
missing=""; if [ -n "\${FAKE_APT_MISSING:-}" ] && ! installed "$FAKE_APT_MISSING"; then missing="$FAKE_APT_MISSING"; fi
if [ -n "$missing" ] && [ "$nodl" = 1 ]; then echo "E: Unable to fetch some archives, maybe run apt-get update or try with --fix-missing?"; exit 100; fi
if [ "$sim" = 1 ]; then
  echo "Inst papercusp-server (${VERSION} local)"; echo "Inst papercusp-gui (${VERSION} local)"
  [ -n "$missing" ] && echo "Inst $missing (2.44 Ubuntu:24.04/noble [amd64])"
  exit 0
fi
# apt 2.8 copies a local .deb argument in through its acquire step; --no-download
# disables that, so a real install of local .debs with it always aborts (VM run 4).
if [ "$nodl" = 1 ] && [ "\${#debs[@]}" -gt 0 ]; then echo "E: Internal Error, Pathname to install is not absolute '$(basename "\${debs[0]}")'"; exit 100; fi
n=0; for d in "\${debs[@]}"; do n=$((n+1)); echo "Get:$n $d $(dpkg-deb -f "$d" Package) amd64 ${VERSION} [1 B]"; done
if [ -n "$missing" ]; then
  if [ -f "$FAKE_STATE/offline" ]; then
    echo "Err:3 http://archive.ubuntu.com/ubuntu noble/main amd64 $missing amd64 2.44"
    echo "E: Failed to fetch http://archive.ubuntu.com/ubuntu/pool/main/$missing.deb  Could not connect to archive.ubuntu.com:80"; exit 100
  fi
  echo "Get:3 http://archive.ubuntu.com/ubuntu noble/main amd64 $missing amd64 2.44 [1 B]"
fi
for d in "\${debs[@]}"; do
  dpkg-deb -x "$d" "$FAKE_ROOT" || exit 1
  printf '%s=ii\\n' "$(dpkg-deb -f "$d" Package)" >> "$FAKE_STATE/dpkg-status"
done
`);
  exe(join(stubs, 'systemctl'), `#!/usr/bin/env bash
echo "systemctl $*" >> "$FAKE_STATE/calls.log"
side="$FAKE_ROOT/usr/lib/Papercusp Server/sidecar"
start() { setsid "$side/bin/node" "$side/serve.mjs" > "$FAKE_STATE/operator.log" 2>&1 < /dev/null & echo $! > "$FAKE_STATE/operator.pid"; }
stop() { [ -f "$FAKE_STATE/operator.pid" ] && kill "$(cat "$FAKE_STATE/operator.pid")" 2>/dev/null; rm -f "$HOME/.papercusp/operator.json"; sleep 0.3; }
case "$*" in
  *enable*--now*) start ;;
  *restart*) stop; start ;;
  *stop*) stop ;;
esac
exit 0
`);
  const fw = `#!/usr/bin/env bash
echo "$(basename "$0") $*" >> "$FAKE_STATE/calls.log"
case "$*" in
  "-C OUTPUT -j PCOIJ_OFFLINE") [ -f "$FAKE_STATE/offline" ]; exit $? ;;
  "-I OUTPUT 1 -j PCOIJ_OFFLINE") [ -n "\${FAKE_FIREWALL_INEFFECTIVE:-}" ] || touch "$FAKE_STATE/offline" ;;
  "-D OUTPUT -j PCOIJ_OFFLINE") rm -f "$FAKE_STATE/offline" ;;
esac
exit 0
`;
  exe(join(stubs, 'iptables'), fw);
  exe(join(stubs, 'ip6tables'), fw);
  exe(join(stubs, 'curl'), `#!/usr/bin/env bash
case "$*" in *127.0.0.1*) exec /usr/bin/curl "$@" ;; esac
[ -f "$FAKE_STATE/offline" ] && exit 7
exit 0
`);
  // mcp-call stand-in: python syntax, run by the installed "node".
  const mcp = join(root, 'mcp-call.py.mjs');
  writeFileSync(mcp, `import json, os\nprint(json.dumps({'pots': [{'slug': os.environ.get('FAKE_POT_SLUG', 'papercusp')}]}))\n`);

  const ledger = join(root, 'ledger.json');
  writeFileSync(ledger, JSON.stringify([
    { name: 'Papercusp GUI_0.0.25_amd64.deb', sha256: sha(gui), size: readFileSync(gui).length },
    { name: 'Papercusp Server_0.0.25_amd64.deb', sha256: sha(server), size: readFileSync(server).length },
  ]));
  return { root, stubs, target, home, state, gui, server, ssh, scp, mcp, ledger };
}

// A Discovery/join operational-test-evidence document, shaped like
// docs/evidence/p505-run34-exact-0025-physical-*.json: it names the runtime
// (Server .deb) sha256 under subject.debSha256.
function joinEvidence(fx, debSha256) {
  const file = join(fx.root, `join-${debSha256.slice(0, 8)}.json`);
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, kind: 'operational-test-evidence', exitCode: 0, subject: { artifact: 'Papercusp Server_0.0.25_amd64.deb', debSha256 } }));
  return file;
}

function run(fx, { args = [], env = {}, ledger = true, joinSha = sha(fx.server), healthSha = BAKED_SHA } = {}) {
  const evidence = join(fx.root, 'evidence.json');
  const argv = [
    '--platform', 'linux', '--gui-artifact', fx.gui, '--server-artifact', fx.server,
    '--evidence-out', evidence, '--ssh-host', 'fake@target', '--remote-dir', join(fx.root, 'remote'),
    '--mcp-call', fx.mcp, '--health-timeout', '20', ...(ledger ? ['--ledger-json', fx.ledger] : []),
    ...(joinSha ? ['--join-evidence', joinEvidence(fx, joinSha)] : []),
    ...(healthSha ? ['--expected-health-sha', healthSha] : []), ...args,
  ];
  const r = spawnSync('bash', [SCRIPT, ...argv], {
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      PC_SSH: fx.ssh, PC_SCP: fx.scp, PCOIJ_TARGET_ROOT: fx.target, PCOIJ_HEALTH_POLL: '0.3',
      FAKE_ROOT: fx.target, FAKE_HOME: fx.home, FAKE_STATE: fx.state, FAKE_STUBS: fx.stubs,
      FAKE_BAKED_BUILD_SHA: BAKED_SHA,
      ...env,
    },
  });
  const doc = existsSync(evidence) ? JSON.parse(readFileSync(evidence, 'utf8')) : null;
  const legs = doc ? Object.fromEntries(doc.legs.map((l) => [l.leg, l])) : {};
  const calls = existsSync(join(fx.state, 'calls.log')) ? readFileSync(join(fx.state, 'calls.log'), 'utf8') : '';
  return { ...r, doc, legs, calls };
}

const opts = { skip: HAVE_TOOLS ? false : 'needs python3, dpkg-deb and ss' };

test('happy path: every leg passes, installer identity is recorded apart from the runtime identity', opts, () => {
  const fx = fixture();
  const r = run(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.doc.verdict, 'PASS');
  for (const leg of ['installer-identity', 'join-runtime-match', 'runtime-identity', 'preflight-fresh', 'os-prerequisites', 'offline', 'install', 'installed-bytes', 'witness-compat', 'first-launch', 'offline-restore', 'restart-reresolve']) {
    assert.equal(r.legs[leg]?.status, 'pass', `${leg}: ${r.legs[leg]?.detail}`);
  }
  // The P-521 readiness manifest binds an evidence document only when it is an
  // operational-test-evidence doc that declares the journey and names a candidate
  // artifact sha256 under subject (p2p-candidate-evidence.ts). The runtime sha is
  // under the same key the Discovery/join evidence uses (plan D-083).
  assert.equal(r.doc.kind, 'operational-test-evidence');
  assert.equal(r.doc.p521Journey, 'full-installer-compat');
  assert.equal(r.doc.exitCode, 0);
  assert.equal(r.doc.subject.debSha256, sha(fx.server));
  assert.equal(r.doc.subject.artifactSha256, sha(fx.server));
  assert.equal(r.doc.join.runtimeSha256, sha(fx.server));
  assert.deepEqual(r.doc.subject.artifacts.map((a) => a.sha256).sort(), [sha(fx.gui), sha(fx.server)].sort());
  assert.ok(!Number.isNaN(Date.parse(r.doc.finishedAt)));
  assert.equal(r.doc.physicalRun.legVerdicts.length, r.doc.legs.length);
  assert.ok(r.doc.physicalRun.legVerdicts.every((l) => l.status === 'pass'));
  assert.match(r.doc.command[0], /offline-installer-journey\.sh .*--join-evidence/);
  assert.equal(r.doc.installerIdentity.server.sha256, sha(fx.server));
  assert.equal(r.doc.installerIdentity.gui.sha256, sha(fx.gui));
  // The runtime identity is the sidecar bytes, not the installer bytes.
  const side = join(fx.target, 'usr', 'lib', 'Papercusp Server', 'sidecar');
  assert.equal(r.doc.witness.runtime['serve.mjs'], sha(join(side, 'serve.mjs')));
  assert.equal(r.doc.witness.runtime['bin/node'], sha(join(side, 'bin', 'node')));
  assert.notEqual(r.doc.witness.runtime['serve.mjs'], r.doc.installerIdentity.server.sha256);
  assert.equal(r.doc.installedRuntime['db-sql.head'], '1237-b.sql');
  assert.equal(r.doc.candidate.expectedSha, GIT_HEAD, 'empty buildSha falls back to gitHead');
  // The health identity is kept apart from the source identity.
  assert.equal(r.doc.candidate.expectedHealthSha, BAKED_SHA);
  assert.equal(r.doc.serving.launch.sha, BAKED_SHA.slice(0, 8), 'a short health sha matches a full expected sha');
  // The serving process is the installed node, and a restart replaced it.
  assert.match(r.doc.serving.launch.exe, /sidecar\/bin\/node$/);
  assert.equal(r.doc.serving.launch.exeSha, r.doc.installedRuntime['bin/node']);
  assert.notEqual(r.doc.serving.restart.pid, r.doc.serving.launch.pid);
  // Offline was enforced and then removed again; the install never downloaded.
  assert.equal(r.doc.offline.egressAfter, 'denied');
  // The driver's own ssh replies are exempted BEFORE the REJECT, or enforcing
  // offline cuts the control session (measured on the real Linux VM).
  assert.match(r.calls, /PCOIJ_OFFLINE -p tcp --sport 22 -j RETURN[\s\S]*PCOIJ_OFFLINE -j REJECT/);
  assert.match(r.doc.offline.egressBefore, /^reachable:/);
  assert.equal(existsSync(join(fx.state, 'offline')), false, 'egress firewall removed on exit');
  // Plan ruling (amends D-083 item 1): the .debs' declared Depends + Recommends are
  // provisioned ONLINE, verbatim from their control fields, BEFORE egress is denied;
  // the Papercusp packages install afterwards fetching nothing. Only the
  // provisioning step may touch the network (apt-get update + satisfy).
  // The install cannot use --no-download (apt 2.8 aborts on local .debs with it);
  // egress denial enforces "fetch nothing" and remoteFetches=0 proves it.
  assert.match(r.calls, /apt-get update[\s\S]*apt-get satisfy[\s\S]*PCOIJ_OFFLINE -j REJECT[\s\S]*apt-get install --yes \S+server\.deb \S+gui\.deb/);
  assert.doesNotMatch(r.calls, /apt-get install --yes --no-download/);
  assert.equal(r.doc.install.remoteFetches, '0');
  assert.match(r.legs.install.detail, /0 remote fetches/);
  const satisfy = r.calls.split('\n').find((l) => l.startsWith('apt-get satisfy'));
  assert.match(satisfy, /libwebkit2gtk-4\.1-0 \(>= 2\.40\) \| libwebkit2gtk-4\.1-0-alt/);
  assert.match(satisfy, /libc6 \(>= 2\.35\)/);
  assert.match(satisfy, /xdg-desktop-portal-gtk/, 'Recommends are provisioned too');
  assert.doesNotMatch(satisfy, /papercusp/, 'provisioning never installs a Papercusp package');
  assert.doesNotMatch(r.calls.split('PCOIJ_OFFLINE -j REJECT')[1], /apt-get (update|satisfy)/);
  assert.equal(r.doc.osPrerequisites.satisfyExit, '0');
  assert.equal(r.doc.osPrerequisites.provisioned.trim(), 'libc6=2.44 libwebkit2gtk-4.1-0=2.44 xdg-desktop-portal-gtk=2.44');
  assert.equal(r.doc.osPrerequisites.provisionedCount, '3');
  assert.match(r.doc.osPrerequisites['declared.gui.Depends'], /papercusp-server \(= 0\.0\.25\)/, 'the declared list is recorded unfiltered');
  // Artifacts cross the control session exactly once.
  const scps = readFileSync(join(fx.state, 'transport.log'), 'utf8').split('\n').filter((l) => l.startsWith('SCP') && l.endsWith('/gui.deb'));
  assert.equal(scps.length, 1);
  assert.match(r.calls, /loginctl enable-linger/);
  for (const l of r.doc.logs) assert.match(l.sha256, /^[0-9a-f]{64}$/);
});

test('no ledger: installer identity is unmeasured and the run is INCOMPLETE, never PASS', opts, () => {
  const r = run(fixture(), { ledger: false });
  assert.equal(r.status, 3, r.stderr);
  assert.equal(r.doc.verdict, 'INCOMPLETE');
  assert.equal(r.legs['installer-identity'].status, 'unmeasured');
});

test('no discovery-join evidence: join-runtime-match is unmeasured and the run is INCOMPLETE (D-083)', opts, () => {
  const r = run(fixture(), { joinSha: null });
  assert.equal(r.status, 3, r.stderr);
  assert.equal(r.doc.verdict, 'INCOMPLETE');
  assert.equal(r.doc.exitCode, 3);
  assert.equal(r.legs['join-runtime-match'].status, 'unmeasured');
});

test('discovery-join evidence naming a different runtime sha256 fails the row (D-083)', opts, () => {
  const fx = fixture();
  const r = run(fx, { joinSha: 'a'.repeat(64) });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.doc.verdict, 'FAIL');
  assert.equal(r.doc.exitCode, 1);
  assert.equal(r.legs['join-runtime-match'].status, 'fail');
  assert.match(r.legs['join-runtime-match'].detail, new RegExp(`${sha(fx.server)} != discovery-join a{64}`));
  // The manifest reads this as a fail through physicalRun, not only through exitCode.
  assert.ok(r.doc.physicalRun.legVerdicts.some((l) => l.leg === 'join-runtime-match' && l.status === 'fail'));
});

test('ledger mismatch fails the installer-identity leg', opts, () => {
  const fx = fixture();
  const led = JSON.parse(readFileSync(fx.ledger, 'utf8'));
  led[1].sha256 = '0'.repeat(64);
  writeFileSync(fx.ledger, JSON.stringify(led));
  const r = run(fx);
  assert.equal(r.status, 1);
  assert.equal(r.legs['installer-identity'].status, 'fail');
  assert.match(r.legs['installer-identity'].detail, /Papercusp Server_0\.0\.25_amd64\.deb: sha256/);
});

test('egress that survives enforcement voids offline; the restore is then not an offline proof', opts, () => {
  const r = run(fixture(), { env: { FAKE_FIREWALL_INEFFECTIVE: '1' } });
  assert.equal(r.status, 3, r.stderr);
  assert.equal(r.legs.offline.status, 'void');
  assert.equal(r.legs['offline-restore'].status, 'unmeasured');
  assert.equal(r.legs['first-launch'].status, 'pass');
});

test('a dependency the install would still have to download fails install and names it', opts, () => {
  // The apt stub aborts -s --no-download with no Inst lines exactly like real apt, so
  // this fails if the closure simulation ever passes --no-download again (the
  // 0.0.25 VM run named ZERO of ~76 missing packages that way).
  const r = run(fixture(), { env: { FAKE_APT_MISSING: 'libgstreamer-gl1.0-0' } });
  assert.equal(r.status, 1);
  assert.equal(r.legs['os-prerequisites'].status, 'pass');
  assert.equal(r.legs.install.status, 'fail');
  assert.match(r.legs.install.detail, /offline-unsatisfied deps: libgstreamer-gl1\.0-0/);
  assert.match(r.legs.install.detail, /apt: E: Failed to fetch http:\/\/archive\.ubuntu\.com/);
  assert.match(r.doc.install.needsDownload, /libgstreamer-gl1\.0-0/);
  for (const leg of ['installed-bytes', 'witness-compat', 'first-launch', 'offline-restore', 'restart-reresolve']) {
    assert.equal(r.legs[leg].status, 'unmeasured', leg);
  }
});

test('an install that fetched anything remote fails install even when apt exits 0', opts, () => {
  // Egress survives (firewall ineffective), so apt quietly downloads the missing
  // package: exit 0, both packages ii — and still not an offline install.
  const r = run(fixture(), { env: { FAKE_FIREWALL_INEFFECTIVE: '1', FAKE_APT_MISSING: 'libgstreamer-gl1.0-0' } });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.legs.offline.status, 'void');
  assert.equal(r.doc.install.installExit, '0');
  assert.equal(r.doc.install.remoteFetches, '1');
  assert.equal(r.legs.install.status, 'fail');
  assert.match(r.legs.install.detail, /fetched 1 remote archive/);
});

test('a declared dependency the distro cannot satisfy FAILS the row — never a skip', opts, () => {
  const r = run(fixture(), { env: { FAKE_APT_UNSATISFIABLE: 'libwebkit2gtk-4.1-0' } });
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.doc.verdict, 'FAIL');
  assert.equal(r.legs['os-prerequisites'].status, 'fail');
  assert.match(r.legs['os-prerequisites'].detail, /cannot satisfy a declared dependency: apt-get satisfy exit 100: E: Unable to satisfy dependencies/);
  assert.equal(r.doc.osPrerequisites.provisionedCount, '0');
});

test('installed runtime that differs from the minimal witness fails witness-compat', opts, () => {
  const fx = fixture();
  const witness = buildDeb(fx.root, 'witness-other', 'papercusp-server', { migrations: ['1236-a.sql', '1237-b.sql', '1238-c.sql'] });
  const r = run(fx, { args: ['--witness', witness] });
  assert.equal(r.status, 1);
  assert.equal(r.legs['witness-compat'].status, 'fail');
  assert.match(r.legs['witness-compat'].detail, /db-sql\.digest/);
  assert.match(r.legs['witness-compat'].detail, /db-sql\.head/);
});

test('a health sha that is not the candidate fails first launch', opts, () => {
  const r = run(fixture(), { env: { FAKE_HEALTH_SHA: 'deadbeef00' } });
  assert.equal(r.status, 1);
  assert.equal(r.legs['first-launch'].status, 'fail');
  assert.match(r.legs['first-launch'].detail, /deadbeef00/);
});

test('a health sha equal to the SOURCE gitHead is not the candidate (health reports the baked buildSha)', opts, () => {
  // Pre-fix, an empty witness buildSha made the driver expect gitHead here, so a real
  // 0.0.25 install (health cddbd8d5) false-FAILED and this case would have PASSED.
  const r = run(fixture(), { env: { FAKE_HEALTH_SHA: GIT_HEAD.slice(0, 10) } });
  assert.equal(r.status, 1);
  assert.equal(r.legs['first-launch'].status, 'fail');
  assert.match(r.legs['first-launch'].detail, /baked buildSha cddbd8d530d8/);
});

test('no health identity (empty witness buildSha, no --expected-health-sha) refuses before touching the target', opts, () => {
  const r = run(fixture(), { healthSha: null });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no \/api\/health identity/);
  assert.equal(r.doc, null, 'no evidence is written for a refused run');
  assert.equal(r.calls, '', 'nothing ran on the target');
});

test('an absent seeded pot fails offline-restore', opts, () => {
  const r = run(fixture(), { env: { FAKE_POT_SLUG: 'something-else' } });
  assert.equal(r.status, 1);
  assert.equal(r.legs['offline-restore'].status, 'fail');
});

test('a target that already carries Papercusp voids preflight and installs nothing', opts, () => {
  const fx = fixture();
  writeFileSync(join(fx.state, 'dpkg-status'), 'papercusp-server=ii\n');
  const r = run(fx);
  assert.equal(r.status, 3);
  assert.equal(r.legs['preflight-fresh'].status, 'void');
  assert.doesNotMatch(r.calls, /apt-get/);
  for (const leg of ['os-prerequisites', 'offline', 'install', 'first-launch', 'restart-reresolve']) assert.equal(r.legs[leg].status, 'unmeasured', leg);
});

test('usage errors exit 2 before touching a target', () => {
  const r = spawnSync('bash', [SCRIPT, '--platform', 'linux'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  const m = spawnSync('bash', [SCRIPT, '--platform', 'mac', '--offline', 'enforce'], { encoding: 'utf8' });
  assert.equal(m.status, 2);
  assert.match(m.stderr, /not implemented for mac/);
});
