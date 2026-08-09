// WI-36794 — the nightly channel is a SEPARATE INSTALLED APPLICATION, and the
// two facts that make it one are set in two different files by two different
// mechanisms:
//
//   * `src-tauri/tauri.nightly.conf.json` — the bundle identity (id + name +
//     icons). This is what makes the OS treat it as a second app.
//   * the baked `PAPERCUSP_CHANNEL` / `PAPERCUSP_CHANNEL_DATA_HOME` stamps —
//     what makes `workspaces::shared_sidecar_home()` open a distinct data home.
//
// Either one applied without the other is a build that writes to the wrong
// app's state, and the expensive direction is silent: an overlay with no stamp
// is a separate app pointed at `~/.papercusp` — the operator state of the
// desktop in daily use.
//
// `workspaces::verify_channel_identity()` refuses to boot on a disagreement at
// RUNTIME, but it can only do so because of a structural assumption about the
// identifier: that a channel bundle id is the base id plus ONE more dot segment,
// and that the segment IS the channel id. That assumption is what this file
// pins — if the overlay ever names itself `com.papercusp.nightly-gui`, the Rust
// guard silently starts reading `""` as the channel and stops guarding anything.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const CHANNEL = 'nightly';

function readConfig(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', name), 'utf8'));
}

function releaseConfigSource() {
  return fs.readFileSync(path.join(root, 'bin', 'release.config.ts'), 'utf8');
}

/**
 * The base data-home directory name as `bin/release.config.ts` declares it —
 * read from the source rather than retyped, because the Rust chokepoint hard-
 * codes the same string and the two must not drift.
 */
function declaredBaseDataHomeDirName() {
  const m = releaseConfigSource().match(/dataHomeDirName:\s*'([^']+)'/);
  assert(m, 'PAPERCUSP_BASE_IDENTITY.dataHomeDirName not found in bin/release.config.ts');
  return m[1];
}

/** The `identitySuffix` the nightly channel declares in the registry. */
function declaredIdentitySuffix() {
  const src = releaseConfigSource();
  const block = src.slice(src.indexOf(`id: '${CHANNEL}'`));
  const m = block.match(/identitySuffix:\s*'([^']+)'/);
  assert(m, `channel '${CHANNEL}' declares no identitySuffix in bin/release.config.ts`);
  return m[1];
}

test('nightly overlay is the base identity plus exactly one channel segment', () => {
  const base = readConfig('tauri.conf.json');
  const nightly = readConfig('tauri.nightly.conf.json');
  const suffix = declaredIdentitySuffix();

  // The kit's formula (resolveChannelIdentity): `${base.bundleId}.${suffix}`.
  assert.equal(nightly.identifier, `${base.identifier}.${suffix}`);

  // The property workspaces::channel_suffix_of_identifier() actually reads: one
  // MORE dot segment than the base, and that segment IS the channel id. Asserted
  // structurally rather than by string equality, because the Rust side counts
  // segments — a rename that kept the same suffix but flattened the id
  // (`com.papercusp.gui-nightly`) would pass an equality check and defeat the
  // runtime guard.
  const baseSegs = base.identifier.split('.').filter(Boolean);
  const nightlySegs = nightly.identifier.split('.').filter(Boolean);
  assert.equal(nightlySegs.length, baseSegs.length + 1);
  assert.equal(nightlySegs[baseSegs.length], CHANNEL);
  assert.equal(baseSegs.length, 3, 'workspaces.rs BASE_IDENTIFIER_SEGMENTS assumes a 3-segment base id');
});

test('nightly overlay is visibly a different product, not a re-skin of the same one', () => {
  const base = readConfig('tauri.conf.json');
  const nightly = readConfig('tauri.nightly.conf.json');

  assert.notEqual(nightly.productName, base.productName);
  assert(nightly.productName.includes(base.productName), 'keep the base product name as a prefix so the two sort together');

  // A distinct icon SET, not a distinct icon LIST pointing at the same files —
  // two identically-iconed apps in a launcher is the failure users actually hit.
  const icons = nightly.bundle.icon;
  assert(Array.isArray(icons) && icons.length > 0, 'nightly overlay declares no icons');
  for (const rel of icons) {
    const p = path.join(root, 'src-tauri', rel);
    assert(fs.existsSync(p), `nightly icon missing on disk: ${rel}`);
  }
  const baseIcon = fs.readFileSync(path.join(root, 'src-tauri', 'icons', '128x128.png'));
  const nightlyIcon = fs.readFileSync(path.join(root, 'src-tauri', 'icons', 'nightly', '128x128.png'));
  assert(!baseIcon.equals(nightlyIcon), 'the nightly icon is byte-identical to the base icon');
});

test('nightly deb must not conflict with or replace the stable package', () => {
  // The whole point of a side-by-side channel is coexistence. `tauri.server.conf.json`
  // deliberately declares conflicts/replaces against papercusp-gui; copying that
  // pattern here would make installing nightly UNINSTALL the app in daily use.
  const nightly = readConfig('tauri.nightly.conf.json');
  const deb = nightly.bundle?.linux?.deb ?? {};
  assert.deepEqual(deb.conflicts ?? [], []);
  assert.deepEqual(deb.replaces ?? [], []);
});

test('the Rust chokepoint and the release config agree on the base data home', () => {
  // workspaces.rs hardcodes BASE_DATA_HOME_DIR_NAME; release.config.ts declares
  // PAPERCUSP_BASE_IDENTITY.dataHomeDirName. They are the same directory, in two
  // languages, and nothing else ties them together.
  const rs = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'workspaces.rs'), 'utf8');
  const m = rs.match(/BASE_DATA_HOME_DIR_NAME:\s*&str\s*=\s*"([^"]+)"/);
  assert(m, 'BASE_DATA_HOME_DIR_NAME not found in src-tauri/src/workspaces.rs');
  assert.equal(m[1], declaredBaseDataHomeDirName());
});

// ---------------------------------------------------------------------------
// The recurrence guard for the build path that does not exist yet.
//
// Items 4 + 5 of WI-36794 (the daily cut, and a real bundle installed beside the
// working desktop) still have to be built. When they are, the build invocation
// MUST carry the channel stamps alongside the `--config` overlay — that is the
// single moment at which the two halves of the identity are joined, and the
// moment at which forgetting one is catastrophic and invisible.
//
// So the scan below is written now, while nothing matches it. A guard with no
// live subject is normally a guard nobody has tested, so `scanForUnstamped` is a
// pure function over (name, text) and is exercised against SYNTHETIC controls
// that keep it falsifiable regardless of what the tree happens to contain.
// ---------------------------------------------------------------------------

const OVERLAY = 'tauri.nightly.conf.json';
const CFG_ARRAY = 'DESKTOP_CHANNEL_BUILD_CFG';
const ENV_ARRAY = 'DESKTOP_CHANNEL_BUILD_ENV';

// ⚠ THE GUARD'S SUBJECT MOVED, so the guard did too — read this before
// "simplifying" it back.
//
// The first version of this scan looked for lines containing the literal
// `tauri.nightly.conf.json` and required both stamps on that same line. That was
// right for a build path that names the overlay inline. It is now VACUOUS:
// `desktop_channel_identity` derives the overlay path as
// `src-tauri/tauri.${channel}.conf.json`, so the literal appears in no build
// script at all and a literal-scan reports clean while checking nothing. A
// guard that goes quiet because the thing it guards was refactored is worse
// than no guard — it certifies the change that blinded it.
//
// So the property is enforced where it now lives, in three parts:
//   (A) CONTAINMENT — no build script hand-rolls the overlay; the chokepoint is
//       the only producer.
//   (B) JOINT USE — wherever a build site expands the overlay array, it expands
//       the stamp array on the same command.
//   (C) COMPLETENESS — the chokepoint actually emits both halves, checked by
//       RUNNING it rather than by reading it.

/**
 * Physical lines joined into LOGICAL ones across `\` continuations.
 *
 * The property being checked is "the overlay and the stamps reach the same
 * COMMAND", and a shell command spans continuations — a real build invocation is
 * routinely four lines long with its env prefix on the first and its arguments
 * on the last. Scanning physical lines answers a different, narrower question
 * and fails on correct code (it did, on build-appimage.sh), which is the kind of
 * false positive that gets a guard deleted rather than fixed.
 */
function logicalLines(text) {
  const out = [];
  let buf = null;
  text.split('\n').forEach((line, i) => {
    if (buf === null) buf = { line: i + 1, text: '' };
    buf.text += line.replace(/\\$/, ' ');
    if (!/\\$/.test(line)) {
      out.push({ line: buf.line, text: buf.text.trim() });
      buf = null;
    }
  });
  if (buf !== null) out.push({ line: buf.line, text: buf.text.trim() });
  return out;
}

/** Sites that expand the overlay array without the stamps on the same command. */
function scanForUnstamped(files) {
  const bad = [];
  for (const { name, text } of files) {
    for (const l of logicalLines(text)) {
      // An ASSIGNMENT (`FOO=()`) defines the array; only an EXPANSION
      // (`"${FOO[@]}"`) applies it to a build. Distinguishing them is what lets
      // the chokepoint declare the arrays separately without tripping this.
      if (!new RegExp(`\\$\\{${CFG_ARRAY}\\[`).test(l.text)) continue;
      if (new RegExp(`\\$\\{${ENV_ARRAY}\\[`).test(l.text)) continue;
      bad.push({ name, line: l.line, text: l.text });
    }
  }
  return bad;
}

/** Build scripts that name a side-by-side overlay instead of deriving it. */
function scanForHandRolledOverlay(files) {
  const bad = [];
  for (const { name, text } of files) {
    text.split('\n').forEach((line, i) => {
      if (!line.includes(OVERLAY)) return;
      bad.push({ name, line: i + 1, text: line.trim() });
    });
  }
  return bad;
}

test('the scans are falsifiable (permanent controls, never mutate the tree)', () => {
  const joined = `env "\${${ENV_ARRAY}[@]}" tauri build "\${${CFG_ARRAY}[@]}"`;
  const cfgOnly = `tauri build "\${${CFG_ARRAY}[@]}"`;
  const envOnly = `env "\${${ENV_ARRAY}[@]}" tauri build`;
  const declaration = `${CFG_ARRAY}=()`;

  assert.deepEqual(scanForUnstamped([{ name: 'ctl', text: joined }]), []);
  // The overlay applied with no stamps: a separate installed application
  // pointed at ~/.papercusp. This is the case that must never build.
  assert.equal(scanForUnstamped([{ name: 'ctl', text: cfgOnly }]).length, 1);
  // Stamps with no overlay is the mirror defect, but the Rust guard refuses to
  // boot on it and it cannot silently write to the wrong home — so it is not
  // this scan's subject, and it must not be reported as one.
  assert.deepEqual(scanForUnstamped([{ name: 'ctl', text: envOnly }]), []);
  // A bare declaration is not an application.
  assert.deepEqual(scanForUnstamped([{ name: 'ctl', text: declaration }]), []);
  // Continuation-joined: correct, and the shape build-appimage.sh actually
  // uses. A physical-line scan reports this as a violation — the false positive
  // that motivated logicalLines().
  const continued = `env "\${${ENV_ARRAY}[@]}" \\\n  tauri build \\\n  "\${${CFG_ARRAY}[@]}"`;
  assert.deepEqual(scanForUnstamped([{ name: 'ctl', text: continued }]), []);
  // ...but continuation-joining must not paper over two genuinely SEPARATE
  // commands that merely sit next to each other.
  const adjacent = `env "\${${ENV_ARRAY}[@]}" true\ntauri build "\${${CFG_ARRAY}[@]}"`;
  assert.equal(scanForUnstamped([{ name: 'ctl', text: adjacent }]).length, 1);

  assert.deepEqual(scanForHandRolledOverlay([{ name: 'ctl', text: joined }]), []);
  assert.equal(
    scanForHandRolledOverlay([{ name: 'ctl', text: `tauri build --config src-tauri/${OVERLAY}` }]).length,
    1,
  );
});

function buildScripts() {
  const dirs = [path.join(root, 'bin'), path.join(root, 'bin', 'lib')];
  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(sh|ts|mjs|js)$/.test(entry.name)) continue;
      const p = path.join(dir, entry.name);
      files.push({ name: path.relative(root, p), text: fs.readFileSync(p, 'utf8') });
    }
  }
  assert(files.length > 0, 'scanned nothing — the scan roots moved, so a clean result would be meaningless');
  return files;
}

test('(A) no build script hand-rolls the nightly overlay — the chokepoint derives it', () => {
  const bad = scanForHandRolledOverlay(buildScripts());
  assert.deepEqual(
    bad,
    [],
    `these name ${OVERLAY} directly instead of calling desktop_channel_identity, so the ` +
      `overlay can be applied without the stamps that go with it:\n` +
      bad.map((b) => `  ${b.name}:${b.line}  ${b.text}`).join('\n'),
  );
});

test('(B) every build site applies the overlay and the channel stamps together', () => {
  const files = buildScripts();

  // NON-VACUITY FIRST. This scan reports "clean" for a tree with no wiring at
  // all, which is exactly what deleting the wiring looks like — so assert the
  // sites exist before believing they are correct.
  const sites = files.flatMap(({ name, text }) =>
    logicalLines(text)
      .map((l) => ({ name, line: l.line, text: l.text }))
      .filter((l) => new RegExp(`\\$\\{${CFG_ARRAY}\\[`).test(l.text)),
  );
  assert(
    sites.length >= 3,
    `expected the linux deb, appimage and arm64 build sites to expand ${CFG_ARRAY}; found ${sites.length}. ` +
      `The wiring was removed or renamed, which makes the joint-use check below vacuous.`,
  );

  const bad = scanForUnstamped(files);
  assert.deepEqual(
    bad,
    [],
    `these apply the channel identity overlay without baking its stamps on the same command:\n` +
      bad.map((b) => `  ${b.name}:${b.line}  ${b.text}`).join('\n'),
  );
});

test('(C) the chokepoint emits both halves, and they agree with release.config.ts', () => {
  // RUN the function rather than reading it: what matters is what a build site
  // actually receives, and a text scan of a shell function cannot tell a
  // correct derivation from a plausible-looking broken one.
  const run = (channel) => {
    const script = `
      set -euo pipefail
      . "${path.join(root, 'bin', 'lib', 'gen-latest-manifest.sh')}"
      desktop_channel_identity "${channel}"
      printf 'CFG:%s\\n' "\${${CFG_ARRAY}[@]:-}"
      printf 'ENV:%s\\n' "\${${ENV_ARRAY}[@]:-}"
    `;
    const out = require('node:child_process').execFileSync('bash', ['-c', script], {
      encoding: 'utf8',
    });
    const pick = (tag) =>
      out
        .split('\n')
        .filter((l) => l.startsWith(tag))
        .map((l) => l.slice(tag.length))
        .filter(Boolean);
    return { cfg: pick('CFG:'), env: pick('ENV:') };
  };

  const suffix = declaredIdentitySuffix();
  const baseHome = declaredBaseDataHomeDirName();

  const nightly = run(CHANNEL);
  assert.deepEqual(nightly.cfg, ['--config', `src-tauri/tauri.${CHANNEL}.conf.json`]);
  // The stamp is compared by workspaces::verify_channel_identity() against the
  // bundle identifier's extra dot segment, which is the identitySuffix.
  assert.deepEqual(nightly.env, [
    `PAPERCUSP_CHANNEL=${suffix}`,
    // resolveChannelIdentity()'s formula: `${base.dataHomeDirName}-${suffix}`.
    `PAPERCUSP_CHANNEL_DATA_HOME=${baseHome}-${suffix}`,
  ]);
  assert.notEqual(`${baseHome}-${suffix}`, baseHome, 'the nightly data home collides with the base app');

  // An update lane must stay un-stamped. All 24 builds ever cut carry no stamp,
  // and resolve_data_home_dir_name() treats an absent stamp as the existing
  // ~/.papercusp precisely so they keep working — a stable build that started
  // carrying one would be a regression, not a nicety.
  for (const lane of ['alpha', 'beta', 'stable']) {
    const r = run(lane);
    assert.deepEqual(r.cfg, [], `${lane} must not apply an identity overlay`);
    assert.deepEqual(r.env, [], `${lane} must not bake channel stamps`);
  }
});
