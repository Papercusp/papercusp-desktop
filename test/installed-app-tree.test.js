// EI-18885442084466501 — the installed-tree completeness guard in
// bin/lib/installed-app-tree.js.
//
// WHY THIS TEST EXISTS
// `tauri build` bundles whatever is in src-tauri/sidecar/, and on a fresh
// checkout that is build.rs's PLACEHOLDER. Only bin/build-desktop-sidecar.sh
// replaces it, and `npm run build` never calls that script — so a build that
// exits 0 can emit an app whose operator cannot start.
//
// The failure mode is what makes it worth guarding: the app still LAUNCHES. It
// opens a window, paints, then spends its full 120s operator-boot timeout
// waiting for a sidecar that isn't there and falls back to a foreign
// environment. Every "did it start?" check passes. That is how it silently
// broke the whole packaged-binary perf suite (4/4 specs, 3m19s, timeout
// messages that all pointed at the UI instead of the artifact).
//
// The two cases below are therefore NOT interchangeable: a placeholder tree and
// a partially-populated tree need different remediations, and the runtime's
// generic "Reinstall Papercusp to recover" is wrong for the placeholder case
// (nothing is corrupt — a build step was skipped).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  GUI_PRODUCT_NAME,
  SERVER_PRODUCT_NAME,
  REQUIRED_GUI_SIDECAR_ENTRYPOINTS,
  REQUIRED_SERVER_SIDECAR_ENTRYPOINTS,
  PLACEHOLDER_MARKER,
  resourceRootFor,
  sidecarDirFor,
  requiredSidecarEntrypointsFor,
  inspectInstalledApp,
  describeIncompleteInstall,
} = require('../bin/lib/installed-app-tree.js');

/**
 * Build a throwaway tree shaped like a real installed app:
 *   <root>/bin/papercusp-desktop
 *   <root>/lib/Papercusp GUI/sidecar/...
 * `sidecar` selects what goes in that dir — mirroring the three states seen on
 * disk: a real bundle, build.rs's placeholder, and a half-populated dir.
 */
function makeTree(sidecar, productName = GUI_PRODUCT_NAME) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-installed-tree-'));
  const binDir = path.join(tmp, 'bin');
  const sidecarDir = path.join(tmp, 'lib', productName, 'sidecar');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(sidecarDir, { recursive: true });

  const appPath = path.join(binDir, 'papercusp-desktop');
  fs.writeFileSync(appPath, '#!/bin/true\n');
  const required = requiredSidecarEntrypointsFor(productName);

  if (sidecar === 'complete') {
    for (const entry of required) {
      fs.mkdirSync(path.dirname(path.join(sidecarDir, entry)), { recursive: true });
      fs.writeFileSync(path.join(sidecarDir, entry), '// bundle\n');
    }
  } else if (sidecar === 'placeholder') {
    fs.writeFileSync(path.join(sidecarDir, PLACEHOLDER_MARKER), 'Placeholder created by build.rs\n');
  } else if (sidecar === 'partial') {
    fs.writeFileSync(path.join(sidecarDir, required[0]), '// bundle\n');
  } else if (sidecar === 'absent') {
    fs.rmSync(sidecarDir, { recursive: true, force: true });
  }
  return { tmp, appPath, sidecarDir };
}

test('resolves the resource tree the way a launched binary does', () => {
  // Tauri's Linux rule is <bin>/../lib/<productName>/. Both real shapes this
  // repo produces follow it, so the resolver must not special-case either.
  const debBin = '/x/data/usr/bin/papercusp-desktop';
  assert.equal(resourceRootFor(debBin), '/x/data/usr/lib/Papercusp GUI');
  assert.equal(sidecarDirFor(debBin), '/x/data/usr/lib/Papercusp GUI/sidecar');

  const serverDebBin = '/x/data/usr/bin/papercusp-server';
  assert.equal(
    resourceRootFor(serverDebBin, 'Papercusp Server'),
    '/x/data/usr/lib/Papercusp Server',
  );
  assert.equal(
    sidecarDirFor(serverDebBin, 'Papercusp Server'),
    '/x/data/usr/lib/Papercusp Server/sidecar',
  );

  const cargoBin = '/t/release/papercusp-desktop';
  assert.equal(sidecarDirFor(cargoBin), '/t/lib/Papercusp GUI/sidecar');
});

test('a thin GUI with its packaged SPA reads as complete', () => {
  const { tmp, appPath } = makeTree('complete');
  try {
    const report = inspectInstalledApp(appPath);
    assert.equal(report.complete, true);
    assert.equal(report.placeholder, false);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.required, REQUIRED_GUI_SIDECAR_ENTRYPOINTS);
    // A complete tree must produce NO message — otherwise the guard would cry
    // wolf on every good build and get muted.
    assert.equal(describeIncompleteInstall(report), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a Server bundle still requires both operator entrypoints', () => {
  const { tmp, appPath } = makeTree('complete', SERVER_PRODUCT_NAME);
  try {
    const report = inspectInstalledApp(appPath, SERVER_PRODUCT_NAME);
    assert.equal(report.complete, true);
    assert.deepEqual(report.required, REQUIRED_SERVER_SIDECAR_ENTRYPOINTS);
    assert.deepEqual(report.missing, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('build.rs placeholder is reported as never-built, naming the sidecar script', () => {
  const { tmp, appPath } = makeTree('placeholder', SERVER_PRODUCT_NAME);
  try {
    const report = inspectInstalledApp(appPath, SERVER_PRODUCT_NAME);
    assert.equal(report.complete, false);
    assert.equal(report.placeholder, true);
    assert.deepEqual(report.missing, REQUIRED_SERVER_SIDECAR_ENTRYPOINTS);

    const msg = describeIncompleteInstall(report);
    // The remediation is the whole point: an agent hitting this must be told
    // the one command that fixes it, not left to rediscover it.
    assert.match(msg, /build-desktop-sidecar\.sh/);
    assert.match(msg, /NEVER BUILT/);
    // And it must say WHY a green-looking `npm run build` is not enough.
    assert.match(msg, /npm run build.* is NOT enough|is NOT enough/s);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a half-populated sidecar names exactly what is missing', () => {
  const { tmp, appPath } = makeTree('partial', SERVER_PRODUCT_NAME);
  try {
    const report = inspectInstalledApp(appPath, SERVER_PRODUCT_NAME);
    assert.equal(report.complete, false);
    assert.equal(report.placeholder, false);
    // Only the genuinely-absent entrypoint — the present one must not be listed.
    assert.deepEqual(report.missing, REQUIRED_SERVER_SIDECAR_ENTRYPOINTS.slice(1));
    assert.match(describeIncompleteInstall(report), /sidecar-preload\.js/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an absent sidecar dir is a result, not a throw', () => {
  // The bare `cargo build --release` case: the sibling lib/ tree never exists.
  // A guard that threw here would fail differently from one that reported, and
  // callers would have to wrap it — so absence must flow through the same path.
  const { tmp, appPath } = makeTree('absent');
  try {
    const report = inspectInstalledApp(appPath);
    assert.equal(report.exists, true, 'the BINARY exists — only its resources do not');
    assert.equal(report.complete, false);
    assert.deepEqual(report.missing, REQUIRED_GUI_SIDECAR_ENTRYPOINTS);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the Server required list matches what the Rust refuses to boot without', () => {
  // This guard only has value while it agrees with main.rs's
  // missing_sidecar_entrypoints. If that list grows, a build missing the new
  // entrypoint would pass here and still FATAL at runtime — the exact silent
  // gap this module exists to close. Read the real source, not a copy.
  const mainRs = fs.readFileSync(path.join(__dirname, '../src-tauri/src/main.rs'), 'utf8');
  for (const entry of REQUIRED_SERVER_SIDECAR_ENTRYPOINTS) {
    assert.ok(
      mainRs.includes(`"${entry}"`),
      `${entry} is required by this guard but no longer appears in main.rs — the lists have drifted`,
    );
  }
});

test('the GUI contract is attach-only and never requires Server entrypoints', () => {
  assert.deepEqual(requiredSidecarEntrypointsFor(GUI_PRODUCT_NAME), ['spa/index.html']);
  for (const serverOnly of REQUIRED_SERVER_SIDECAR_ENTRYPOINTS) {
    assert(!requiredSidecarEntrypointsFor(GUI_PRODUCT_NAME).includes(serverOnly));
  }
});
