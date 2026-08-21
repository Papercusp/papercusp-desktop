// WI-37620 — the two sidecar-side remedies the WI-4419 identity gate depends on.
//
// WHY THIS TEST EXISTS
// The gate's failure message offers exactly two fixes: "prune the leaking file from
// the sidecar copy in build-desktop-sidecar.sh, or scrub the value — never add an
// exclude here." Both remedies live in audit-release-bundle.py, both are invoked by
// build-desktop-sidecar.sh, and until 0.0.14 both had a hole:
//
//   PRUNE  — prune_docs applied ONLY the `internal-build-infra-docs` rule, so the
//            pagefind shards under the sidecar's internal-docs/ shipped unpruned.
//            The `pagefind-search-index` rule existed (added after the 0.0.9 cut
//            red on exactly this) but only ever filtered source.tar.zst — and
//            covering what tar-excludes cannot reach is the entire purpose of
//            prune_docs. The 0.0.14 cut red on the same literal in the same
//            artifact class as 0.0.9. Pruning DOCS could never have fixed it: the
//            shipping markdown is clean, only the generated INDEX carries the word.
//
//   SCRUB  — a build-box path baked into a compiled addon (.rodata, an assert()
//            __FILE__ expansion) is reachable by neither other remedy: `strip`
//            leaves it, and the file is loaded at runtime so it cannot be pruned.
//
// These assertions are BEHAVIOURAL — they run the real script against fixtures and
// check the real effects, so a rewrite that reintroduces either hole by another
// route still fails.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const AUDIT = path.join(root, 'bin/audit-release-bundle.py');

/**
 * A SYNTHETIC owner name, asserted for every AUDIT invocation.
 *
 * The certify path REFUSES TO CERTIFY (exit 2) unless an owner-name literal is
 * ASSERTED via this env var — `has_owner_name_literal` deliberately ignores git,
 * because git names the COMMITTER and on an automated build box that is not the
 * owner. That refusal is correct, and it is a PRECONDITION of certifying rather
 * than anything to do with the prune/scrub behaviour measured here: without the
 * env, `--scan-dir` exits 2 before it reads a byte, so the post-scrub assertion
 * "the gate must pass after the scrub" sees 2 instead of 0.
 *
 * Must stay SYNTHETIC: a real identity in tracked source is the exact leak this
 * gate exists to prevent.
 */
const SYNTHETIC_OWNER = 'Zzsynthetic Gateowner';
const AUDIT_ENV = { ...process.env, PAPERCUSP_RELEASE_OWNER_NAME: SYNTHETIC_OWNER };

function audit(...args) {
  return spawnSync('python3', [AUDIT, ...args], { encoding: 'utf8', env: AUDIT_ENV });
}

/** A high-entropy identity literal, from the gate's OWN source of truth. */
function identityLiteral() {
  const r = audit('--identity-literals');
  assert.equal(r.status, 0, `--identity-literals failed: ${r.stderr}`);
  for (const line of r.stdout.split('\n')) {
    const [value, , low] = line.split('\t');
    if (value && value.length > 12 && low === '0') return value;
  }
  throw new Error('no high-entropy identity literal available on this host');
}

function tmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `wi37620-${name}-`));
}

function runBuilderOwnerPreflight({ audit, owner, advance = false }) {
  const dir = tmp('owner-preflight');
  const env = {
    ...process.env,
    PAPERCUSP_RELEASE_AUDIT: audit,
    // The rejecting cases use a missing repo to prove they stop before the first
    // runtime-pin read. Allowed cases use the real pin, then stop safely at the
    // deliberately absent Papercusp dependency before any build operation.
    REPO_ROOT: advance ? path.resolve(root, '..') : path.join(dir, 'missing-repo'),
    PAPERCUSP_ROOT: path.join(dir, 'missing-papercusp'),
  };
  delete env.PAPERCUSP_RELEASE_OWNER_NAME;
  if (owner !== undefined) env.PAPERCUSP_RELEASE_OWNER_NAME = owner;
  try {
    return spawnSync('bash', [path.join(root, 'bin/build-desktop-sidecar.sh')], {
      encoding: 'utf8',
      env,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('release-audited sidecar build rejects a missing owner name before toolchain work', () => {
  for (const owner of [undefined, '', ' , ; \t ']) {
    const r = runBuilderOwnerPreflight({ audit: '1', owner });
    const output = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 2, `owner=${JSON.stringify(owner)}\n${output}`);
    assert.match(output, /PAPERCUSP_RELEASE_AUDIT=1 requires a non-empty PAPERCUSP_RELEASE_OWNER_NAME/);
    assert.match(output, /final identity audit cannot certify/);
    assert.doesNotMatch(output, /could not read the repo-pinned Node major/,
      'the owner-name rejection must precede the first toolchain/runtime preflight');
  }
});

test('sidecar owner-name preflight leaves dev builds and asserted release builds unchanged', () => {
  for (const input of [
    { audit: '0', owner: undefined, advance: true, label: 'dev build' },
    { audit: '1', owner: SYNTHETIC_OWNER, advance: true, label: 'asserted release build' },
  ]) {
    const r = runBuilderOwnerPreflight(input);
    const output = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, `${input.label}\n${output}`);
    assert.match(output, /papercusp not found at/,
      `${input.label} must advance past the owner-name guard`);
    assert.doesNotMatch(output, /requires a non-empty PAPERCUSP_RELEASE_OWNER_NAME/);
  }
});

test('prune-docs removes pagefind search-index shards, not just internal-infra docs', () => {
  const dir = tmp('prune');
  try {
    const docs = path.join(dir, 'internal-docs');
    fs.mkdirSync(path.join(docs, 'pagefind/index'), { recursive: true });
    // The three shard extensions the `pagefind-search-index` rule names.
    for (const f of ['index/en_dead.pf_index', 'pagefind.en_beef.pf_meta', 'x.pf_fragment']) {
      fs.mkdirSync(path.dirname(path.join(docs, 'pagefind', f)), { recursive: true });
      fs.writeFileSync(path.join(docs, 'pagefind', f), 'indexed words\n');
    }
    // A normal doc must SURVIVE — this is a targeted prune, not a purge.
    fs.writeFileSync(path.join(docs, 'guide.html'), 'harmless\n');

    const r = audit('--prune-docs', docs);
    assert.equal(r.status, 0, `prune-docs failed:\n${r.stdout}${r.stderr}`);

    const left = [];
    for (const [d, , files] of walk(docs)) for (const f of files) left.push(path.join(d, f));
    const shards = left.filter((f) => /\.pf_(index|fragment|meta)$/.test(f));
    assert.deepEqual(shards, [], `pagefind shards must be pruned, found:\n${shards.join('\n')}`);
    assert.ok(fs.existsSync(path.join(docs, 'guide.html')), 'a normal doc must survive the prune');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── WI-38233 / the 0.0.16 cut: the PRUNE↔SCAN predicate gap.
//
// prune_docs deletes by PATH; scan_dir fails by CONTENT. A doc whose path matches no
// FORBIDDEN_PATH rule but whose TEXT quotes this box's identity falls between them —
// 65 assembled files did exactly that and red the 0.0.16 cut after every path rule
// passed clean. --scrub-text closes it. These assertions are behavioural: they drive
// the real gate, so a rewrite that reopens the gap by another route still fails.

test('scrub-text clears a doc the gate would REJECT — and the gate agrees afterwards', () => {
  const lit = identityLiteral();
  const dir = tmp('scrubtext');
  const doc = path.join(dir, 'agent-insights', 'some-insight.mdx');
  fs.mkdirSync(path.dirname(doc), { recursive: true });
  fs.writeFileSync(doc, `# Insight\n\nRun it from ${lit}/papercusp and re-check.\n`);

  // FALSIFIER: prove the gate REJECTS this fixture first. Without this, a scrub that
  // did nothing would still let the post-scan assertion below pass vacuously.
  //
  // Asserted as EXACTLY 1, not merely non-zero: the gate separates "found leaks" (1)
  // from "could not check" (2) precisely so a caller can tell a blind gate from a
  // real verdict. A `notEqual(…, 0)` falsifier accepts BOTH, so a gate that refused
  // to certify — and therefore never read the fixture at all — would satisfy this
  // step and make the scrub look proven. That is not hypothetical: it is exactly how
  // this test failed when the box's asserted owner identity went missing.
  assert.equal(audit('--scan-dir', dir).status, 1,
    'fixture must be REJECTED-on-a-leak (exit 1) before the scrub; exit 2 means the ' +
    'gate could not check and this test would prove nothing');

  assert.equal(audit('--scrub-text', dir).status, 0);
  const after = fs.readFileSync(doc, 'utf8');
  assert.ok(!after.includes(lit), 'the identity literal must be gone');
  assert.ok(after.includes('# Insight'), 'surrounding prose must survive the scrub');
  assert.equal(audit('--scan-dir', dir).status, 0, 'the gate must pass after the scrub');
});

test('scrub-text reaches the source and generated-text classes the sidecar actually ships', () => {
  const lit = identityLiteral();
  const dir = tmp('scrubtext-ext');
  // .html matters specifically: internal-docs ships RENDERED twins of each .mdx, so
  // scrubbing only the source would leave the identity live in the served bytes.
  for (const ext of ['md', 'mdx', 'html', 'txt', 'json', 'js', 'mjs', 'ts', 'sql']) {
    fs.writeFileSync(path.join(dir, `f.${ext}`), `see ${lit} here`);
  }
  assert.equal(audit('--scrub-text', dir).status, 0);
  for (const ext of ['md', 'mdx', 'html', 'txt', 'json', 'js', 'mjs', 'ts', 'sql']) {
    assert.ok(!fs.readFileSync(path.join(dir, `f.${ext}`), 'utf8').includes(lit),
      `.${ext} must be scrubbed — it ships`);
  }
});

test('scrub-text breaks hardlinks — the live monorepo doc tree is never rewritten', () => {
  // The sidecar copier hardlinks where the FS supports it. An in-place write would
  // reach back THROUGH the link into apps/operator-docs and mutate the real repo.
  const lit = identityLiteral();
  const dir = tmp('scrubtext-link');
  try {
    const shipped = path.join(dir, 'internal-docs', 'shipped.md');
    fs.mkdirSync(path.dirname(shipped), { recursive: true });
    fs.writeFileSync(shipped, `path ${lit} end`);
    const source = path.join(dir, 'source-of-truth.md'); // OUTSIDE the scrubbed root
    fs.linkSync(shipped, source);
    assert.equal(fs.statSync(shipped).nlink, 2, 'fixture must actually be hardlinked');

    assert.equal(audit('--scrub-text', path.join(dir, 'internal-docs')).status, 0);
    assert.ok(!fs.readFileSync(shipped, 'utf8').includes(lit), 'the shipped copy must be scrubbed');
    assert.ok(fs.readFileSync(source, 'utf8').includes(lit),
      'the sibling hardlink must be UNTOUCHED — an in-place write would have rewritten it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scrub-text leaves a CLEAN doc byte-identical', () => {
  const dir = tmp('scrubtext-clean');
  const doc = path.join(dir, 'clean.md');
  const body = '# Clean\n\nNothing sensitive here.\n';
  fs.writeFileSync(doc, body);
  const before = fs.statSync(doc).mtimeMs;
  assert.equal(audit('--scrub-text', dir).status, 0);
  assert.equal(fs.readFileSync(doc, 'utf8'), body);
  assert.equal(fs.statSync(doc).mtimeMs, before, 'a clean file must not be rewritten at all');
});

test('build-desktop-sidecar runs --scrub-text BEFORE the identity scan that judges it', () => {
  // Ordering is the whole contract: scrubbing after the scan would gate on unscrubbed
  // bytes and red every cut, which is the bug this wiring exists to prevent.
  const sh = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
  const scrub = sh.indexOf('--scrub-text');
  const scan = sh.indexOf('--scan-dir');
  assert.ok(scrub > 0, 'build-desktop-sidecar.sh must invoke --scrub-text');
  assert.ok(scan > 0, 'build-desktop-sidecar.sh must invoke --scan-dir');
  assert.ok(scrub < scan, '--scrub-text must run BEFORE --scan-dir');
  // Both doc trees, or the untouched one reds the cut.
  assert.ok(/--scrub-text[\s\S]{0,200}internal-docs/.test(sh), 'must scrub internal-docs');
  assert.ok(/--scrub-text[\s\S]{0,200}operator-docs\/src\/content\/docs/.test(sh),
    'must scrub the .mdx source tree');
  assert.ok(/--scrub-text[\s\S]{0,260}serve\.mjs/.test(sh),
    'must scrub the generated operator entrypoint');
  assert.ok(/--scrub-text[\s\S]{0,300}\$SIDECAR_DIR\/spa/.test(sh),
    'must scrub generated SPA text');
  const overlayCopy = sh.indexOf('cp -a "$OLD_DIR/$_overlay" "$SIDECAR_TMP_DIR/$_overlay"');
  const envTextScrub = sh.indexOf('--scrub-text', overlayCopy);
  assert.ok(envTextScrub > overlayCopy,
    'preserved env-sidecar text must be scrubbed after the overlay restore');
});

test('cross-darwin git vendor prunes git-instaweb before scanning and signing the shipping tree', () => {
  const sh = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
  const vendorCopy = sh.indexOf(
    'cp -a "$_cross_darwin_git_keg/libexec/git-core" "$SIDECAR_DIR/bin/.git-vendor/libexec/git-core"',
  );
  const prune = sh.indexOf(
    'rm -f "$SIDECAR_DIR/bin/.git-vendor/libexec/git-core/git-instaweb"',
    vendorCopy,
  );
  const rewriteWalk = sh.indexOf(
    'find "$SIDECAR_DIR/bin/.git-vendor" -type f -print0',
    vendorCopy,
  );

  assert.ok(vendorCopy > 0, 'the cross-darwin Git libexec copy must exist');
  assert.ok(prune > vendorCopy,
    'git-instaweb must be pruned from the copied tree, never from the source keg');
  assert.ok(rewriteWalk > prune,
    'the prune must happen before the shipping vendor tree is rewritten and signed');
  assert.match(
    sh.slice(prune, rewriteWalk),
    /\[\[ ! -e "\$SIDECAR_DIR\/bin\/\.git-vendor\/libexec\/git-core\/git-instaweb" \]\]/,
    'the builder must fail closed if git-instaweb survives the prune',
  );
});

test('build-desktop-sidecar scrubs every preserved env-sidecar db-sql tree at its copy point', () => {
  const sh = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
  const overlayCopy = sh.indexOf('cp -a "$OLD_DIR/$_overlay" "$SIDECAR_TMP_DIR/$_overlay"');
  const envScrub = sh.indexOf('"preserved env sidecars"');
  const stamp = sh.indexOf('_stamp_serve_sha=');
  const finalScan = sh.lastIndexOf('audit-release-bundle.py" --scan-dir "$SIDECAR_DIR"');

  assert.ok(overlayCopy > 0, 'the release-overlay preservation copy must exist');
  assert.ok(envScrub > overlayCopy,
    'env-sidecar db-sql must be scrubbed AFTER preserved overlays are restored');
  assert.ok(stamp > envScrub, 'the scrub must finish before the sidecar is stamped');
  assert.ok(finalScan > envScrub, 'the final assembled scan must judge the scrubbed bytes');
  assert.match(
    sh.slice(envScrub - 120, envScrub + 240),
    /\$SIDECAR_TMP_DIR"\/env-sidecars\/\*\/db-sql/,
    'the copy-point scrub must cover every env-sidecars/<environment>/db-sql tree',
  );
  assert.match(
    sh,
    /find "\$\{_roots\[@\]\}" -type f -name '\*\.sql' -print0/,
    'the shared db-sql scrub helper must recurse through every SQL file in each selected tree',
  );
});

test('sidecar db-sql scrub consumes the audit gate case-folded pattern instead of rebuilding it', () => {
  const sh = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
  const programStart = sh.indexOf('declare -a _dbsql_sed=()');
  const helperStart = sh.indexOf('_scrub_sidecar_db_sql()', programStart);
  assert.ok(programStart > 0 && helperStart > programStart,
    'the db-sql scrub program and helper must exist in order');

  const program = sh.slice(programStart, helperStart);
  assert.match(
    program,
    /read -r _val _red _wb _pat/,
    'the sidecar scrub must read --identity-literals column 4, which carries the audit case rule',
  );
  assert.match(
    program,
    /_dbsql_sed\+=\(-e "s\/\$\{_pat\}\/\$\{_r\}\/g"\)/,
    'the sidecar scrub must pass the audit-owned folded ERE directly to sed',
  );
  assert.match(
    program,
    /if \[\[ -n "\$_pat" \]\]/,
    'an older three-column audit script may use the compatibility fallback, but must not be the normal path',
  );
});

test('scrub-binaries removes a build-box literal from a compiled addon, preserving byte length', () => {
  const lit = identityLiteral();
  const dir = tmp('scrub');
  try {
    const rel = 'node_modules/pkg/build/Release/addon.node';
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Shaped like the real leak: an assert() __FILE__ string between NULs in .rodata.
    const blob = Buffer.concat([
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0]),
      Buffer.from(`void Thing::Method()\0\0${lit}/.cache/node-gyp/x.h\0\0tail`),
    ]);
    fs.writeFileSync(p, blob);
    const before = fs.statSync(p).size;

    const r = audit('--scrub-binaries', path.join(dir, 'node_modules'));
    assert.equal(r.status, 0, `scrub-binaries failed:\n${r.stdout}${r.stderr}`);

    const after = fs.readFileSync(p);
    assert.equal(after.length, before,
      'byte length MUST be preserved — every ELF offset/section size depends on it');
    assert.ok(!after.includes(lit), `the literal must be gone, still present in ${rel}`);
    // The surrounding structure must survive: this is a targeted overwrite, not a truncation.
    assert.ok(after.includes('/.cache/node-gyp/x.h'), 'the rest of the path must be intact');
    assert.ok(after.includes('tail'), 'bytes after the literal must be untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The sidecar copier HARDLINKS where the filesystem supports it (build-desktop-sidecar.sh
// has an explicit "FS without hardlink support" fallback), and the real sshcrypto.node in
// the sidecar carries 3 links. An in-place write would therefore reach through every one
// of them. Measured today the sidecar copy and the repo's own node_modules are different
// inodes, so the shared tree is not at risk — but that is a property of how the copier
// happens to run, not a guarantee, and it is not one to re-verify by hand each release.
test('scrub-binaries breaks hardlinks — a sibling link is NOT rewritten', () => {
  const lit = identityLiteral();
  const dir = tmp('hardlink');
  try {
    const p = path.join(dir, 'node_modules/pkg/build/Release/addon.node');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(`\x7fELF\0\0${lit}/.cache/x.h\0tail`));
    const sibling = path.join(dir, 'sibling.node');
    fs.linkSync(p, sibling);          // outside the scrubbed root, same inode
    assert.equal(fs.statSync(p).nlink, 2, 'fixture must actually be hardlinked');

    const r = audit('--scrub-binaries', path.join(dir, 'node_modules'));
    assert.equal(r.status, 0, `scrub-binaries failed:\n${r.stdout}${r.stderr}`);

    assert.ok(!fs.readFileSync(p).includes(lit), 'the scrubbed file must be clean');
    assert.ok(fs.readFileSync(sibling).includes(lit),
      'the sibling hardlink must be UNTOUCHED — an in-place write would have rewritten it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// CALIBRATION CONTROL: without this, a scrub that mangled every binary would satisfy
// the assertion above while destroying the bundle.
test('scrub-binaries leaves a CLEAN addon byte-identical', () => {
  const dir = tmp('clean');
  try {
    const p = path.join(dir, 'node_modules/pkg/build/Release/clean.node');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const blob = Buffer.from('\x7fELF\0\0nothing sensitive here\0/usr/include/node/x.h\0');
    fs.writeFileSync(p, blob);

    const r = audit('--scrub-binaries', path.join(dir, 'node_modules'));
    assert.equal(r.status, 0, `scrub-binaries failed:\n${r.stdout}${r.stderr}`);
    assert.ok(fs.readFileSync(p).equals(blob), 'a clean addon must not be rewritten at all');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── WI-37553: --scrub-app-binary (explicit packaged executable) ──────────────
// A THIRD scrub case, separate from --scrub-binaries: that one walks a tree by
// SCRUBBABLE_BINARY_SUFFIXES and would never match an extension-less packaged
// executable. This explicit-file form remains for the Windows release caller
// and other artifacts that need the same length-preserving identity scrub.
//
// The byte-length assertion is the load-bearing one: the scrub rewrites bytes
// inside an already-linked binary, so every Mach-O offset, section size and
// relocation stays valid ONLY because the placeholder is padded to the literal's
// exact length. A regression there would produce a corrupt, signable, shippable
// binary — which is exactly the failure no later gate would catch.
function highEntropyLiteral() {
  const r = spawnSync('python3', [AUDIT, '--identity-literals'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `--identity-literals failed: ${r.stderr}`);
  for (const line of r.stdout.split('\n')) {
    const value = line.split('\t')[0];
    if (value && value.length > 12) return value;
  }
  throw new Error('no high-entropy identity literal available on this host');
}

test('--scrub-app-binary removes the literal and PRESERVES byte length exactly', () => {
  const lit = highEntropyLiteral();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wi37553-app-'));
  try {
    // Extension-less, like a real .app executable, with NULs so it reads binary.
    const p = path.join(dir, 'papercusp-desktop');
    const blob = Buffer.concat([
      Buffer.from([0, 1, 2]), Buffer.from(`prefix${lit}/src-tauri suffix`), Buffer.from([0, 3]),
    ]);
    fs.writeFileSync(p, blob);
    const before = fs.statSync(p).size;

    const r = spawnSync('python3', [AUDIT, '--scrub-app-binary', p], { encoding: 'utf8' });
    assert.equal(r.status, 0, `scrub-app-binary failed:\n${r.stdout}${r.stderr}`);

    const after = fs.readFileSync(p);
    assert.equal(after.length, before, 'scrub MUST preserve byte length exactly');
    assert.equal(after.includes(lit), false, 'the identity literal must be gone');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--scrub-app-binary takes EXPLICIT files and never sweeps a directory', () => {
  const lit = highEntropyLiteral();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wi37553-scope-'));
  try {
    // A sibling carrying the SAME literal, not named on the command line. If this
    // is rewritten, the flag has quietly become a tree walk.
    const named = path.join(dir, 'papercusp-desktop');
    const bystander = path.join(dir, 'other-binary');
    const blob = Buffer.concat([Buffer.from([0, 1]), Buffer.from(`x${lit}y`), Buffer.from([0])]);
    fs.writeFileSync(named, blob);
    fs.writeFileSync(bystander, blob);

    const r = spawnSync('python3', [AUDIT, '--scrub-app-binary', named], { encoding: 'utf8' });
    assert.equal(r.status, 0, `scrub-app-binary failed:\n${r.stdout}${r.stderr}`);

    assert.equal(fs.readFileSync(named).includes(lit), false, 'the named file must be scrubbed');
    assert.ok(fs.readFileSync(bystander).equals(blob),
      'an unnamed sibling must be byte-identical — this flag must never walk a tree');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// PROBE_SCRIPT lets scripts/mutation-probe.sh point these at a mutated COPY
// outside the tree, so falsifiability can be proven without ever mutating the
// shared working tree (a sweep would commit the mutant).
const MAC_CROSS = process.env.PROBE_SCRIPT || path.join(root, 'bin/build-mac-cross.sh');
const MAC_VM = path.join(root, 'bin/mac-vm-build.sh');
const MAC_XATTR_HELPER = path.join(root, 'bin/lib/strip-mac-signing-xattrs.py');

test('build-mac-cross resolves Cargo-installed tools from CARGO_HOME under a minimal manager PATH', () => {
  const dir = tmp('mac-cargo-home');
  const cargoHome = path.join(dir, 'cargo-home');
  const cargoBin = path.join(cargoHome, 'bin');
  const zigDir = path.join(dir, 'zig');
  const missingSdk = path.join(dir, 'missing-sdk');
  fs.mkdirSync(cargoBin, { recursive: true });
  fs.mkdirSync(zigDir, { recursive: true });

  const executable = (file, body) => {
    fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(file, 0o755);
  };
  executable(path.join(cargoBin, 'cargo'), 'printf \'%s\\n\' \'{"target_directory":"/tmp/papercusp-test-target"}\'');
  executable(path.join(cargoBin, 'cargo-zigbuild'), 'exit 0');
  executable(path.join(zigDir, 'zig'), 'exit 0');

  try {
    const r = spawnSync('bash', [MAC_CROSS], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: '/usr/bin:/bin',
        HOME: dir,
        CARGO_HOME: cargoHome,
        PAPERCUSP_ZIG_DIR: zigDir,
        SDKROOT: missingSdk,
        PAPERCUSP_RELEASE_HOST: 'updates.invalid.test',
        PAPERCUSP_BUILD_SHA: 'deadbeef',
        PAPERCUSP_BUILD_VERSION: '0.0.0-test',
      },
    });
    const output = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, output);
    assert.match(output, /macOS SDK not found/,
      'the preflight must advance past cargo-zigbuild and stop at the deliberately missing SDK');
    assert.doesNotMatch(output, /cargo-zigbuild not installed/,
      'CARGO_HOME\/bin must be visible even when the manager PATH omits it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-mac-cross Info.plist generator closes its Python heredoc before shell helpers', () => {
  const src = fs.readFileSync(MAC_CROSS, 'utf8');
  const fnStart = src.indexOf('gen_info_plist() {');
  const nextSection = src.indexOf('# ── env-sidecars/staging', fnStart);
  assert.ok(fnStart > 0 && nextSection > fnStart, 'gen_info_plist function boundaries must exist');
  const fn = src.slice(fnStart, nextSection);
  const pyStart = fn.indexOf("<<'PY'");
  const pyEnd = fn.indexOf('\nPY\n', pyStart);
  const shellHelper = src.indexOf('strip_mac_signing_xattrs() {');
  const absolutePyEnd = fnStart + pyEnd;

  assert.ok(pyStart > 0 && pyEnd > pyStart, 'gen_info_plist must have a closed Python heredoc');
  assert.ok(shellHelper > absolutePyEnd,
    'shell helper definitions must never be embedded inside gen_info_plist Python input');

  const dir = tmp('mac-plist-heredoc');
  const input = path.join(dir, 'Info.plist');
  const output = path.join(dir, 'Generated.plist');
  fs.writeFileSync(input, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict><key>NSMicrophoneUsageDescription</key><string>Synthetic fixture</string></dict></plist>',
  ].join('\n'));
  try {
    const r = spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'VERSION=0.0.0-test',
      `SRC_TAURI=${JSON.stringify(dir)}`,
      fn,
      `gen_info_plist com.papercusp.synthetic 'Synthetic App' ${JSON.stringify(output)}`,
    ].join('\n')], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const generated = fs.readFileSync(output, 'utf8');
    assert.match(generated, /com\.papercusp\.synthetic/);
    assert.match(generated, /Synthetic fixture/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mac producers strip only signing-invalid xattrs and preserve required user.* metadata', () => {
  const dir = tmp('mac-xattrs');
  const file = path.join(dir, 'seed.bin');
  fs.writeFileSync(file, 'seed');
  const setup = spawnSync('python3', ['-c', `
import os, sys
p = sys.argv[1]
set_names = []
for name in ('com.apple.FinderInfo', 'user.com.apple.FinderInfo'):
    try:
        os.setxattr(p, name, b'finder')
        set_names.append(name)
        break
    except OSError:
        pass
if not set_names:
    raise SystemExit('could not set a platform xattr fixture')
os.setxattr(p, 'user.device-file', b'keep')
`, file], { encoding: 'utf8' });
  try {
    assert.equal(setup.status, 0, `could not create xattr fixture: ${setup.stderr}`);
    const dirty = spawnSync('python3', [MAC_XATTR_HELPER, '--check', dir], { encoding: 'utf8' });
    assert.equal(dirty.status, 1, `fixture must fail the strict metadata check: ${dirty.stderr}`);

    const scrub = spawnSync('python3', [MAC_XATTR_HELPER, dir], { encoding: 'utf8' });
    assert.equal(scrub.status, 0, `xattr scrub failed: ${scrub.stdout}${scrub.stderr}`);
    const clean = spawnSync('python3', [MAC_XATTR_HELPER, '--check', dir], { encoding: 'utf8' });
    assert.equal(clean.status, 0, `strict metadata check must pass after scrub: ${clean.stderr}`);

    const attrs = spawnSync('python3', ['-c', `
import os, sys
print('\\n'.join(sorted(os.listxattr(sys.argv[1]))))
`, file], { encoding: 'utf8' });
    assert.equal(attrs.status, 0, attrs.stderr);
    assert.match(attrs.stdout, /(?:^|\n)user\.device-file(?:\n|$)/,
      'required user.device-file xattr must survive');
    assert.doesNotMatch(attrs.stdout, /(?:^|\n)(?:com\.apple\.|user\.com\.apple\.)(?:FinderInfo|ResourceFork)(?:\n|$)/,
      'only signing-invalid Apple xattrs should be removed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-mac-cross enables production codegen and scrubs metadata before signing', () => {
  const src = fs.readFileSync(MAC_CROSS, 'utf8');
  assert.ok(src.includes('cargo zigbuild --release --target "$arch" -p papercusp-desktop --features custom-protocol'),
    'release mac builds must enable Tauri custom-protocol so tauri_build uses production codegen (EI-200443)');
  const scrubAt = src.lastIndexOf('strip_mac_signing_xattrs "$app"');
  const checkAt = src.lastIndexOf('verify_mac_signing_xattrs "$app"');
  const signAt = src.indexOf('sign_app "$app"');
  assert.ok(scrubAt > 0 && scrubAt < signAt,
    'the assembled app must be scrubbed before rcodesign');
  assert.ok(checkAt > scrubAt && checkAt < signAt,
    'the cross-build must fail closed if signing-invalid xattrs remain');
  assert.doesNotMatch(src, /^\s*xattr\s+-cr\b/m,
    'the producer must not delete required user.* xattrs with blanket xattr -cr');
});

test('mac-vm-build cleans resource staging and runs strict codesign before publication', () => {
  const src = fs.readFileSync(MAC_VM, 'utf8');
  const buildAt = src.indexOf('npx tauri build');
  const verifyAt = src.indexOf('verify_mac_app_signature "$role_bundle_dir/macos/$role_label.app"');
  const identityScanAt = src.indexOf('--scan-dir "$role_bundle_dir/macos/$role_label.app"');
  assert.ok(src.includes('strip_mac_signing_xattrs "$_res_src"'),
    'mac VM builds must clean source resources before Tauri creates fresh staging');
  assert.ok(src.includes('strip_mac_signing_xattrs "$_res_dst"'),
    'mac VM builds must clean persistent per-role staging resources');
  assert.ok(buildAt > 0 && verifyAt > buildAt && verifyAt < identityScanAt,
    'strict codesign verification must run after Tauri builds the app and before later publication gates');
  assert.ok(src.includes('codesign --verify --deep --strict "$app"'),
    'the native mac leg must use the strict codesign verifier');
  assert.doesNotMatch(src, /^\s*xattr\s+-cr\b/m,
    'the producer must not delete required user.* xattrs with blanket xattr -cr');
});

test('build-mac-cross fails fast: the binary is scanned right after lipo', () => {
  // WHY THIS EXISTS: the authoritative assembled-bytes gate runs AFTER assemble_app
  // copies a ~2.4GB sidecar per role. Measured on the 0.0.14 cut that is ~58min into a
  // ~75min mac leg, and the mac leg is ~96% of the whole release's wall clock. Two
  // attempts died there, each burning a full mac build to learn something the binary
  // already knew. So the binary gets scanned IN ISOLATION straight after lipo. This
  // test pins that the early gate exists AND still precedes assembly —
  // an early gate that drifted after assemble_app would be pure cost and no benefit.
  const src = fs.readFileSync(MAC_CROSS, 'utf8');

  const lipoAt = src.indexOf('-create');                      // llvm-lipo fuses the arches
  const earlyScanAt = src.indexOf('--scan-dir "$_early_scan"');
  const assembleAt = src.indexOf('assemble_app "$app_id"');
  const fullScanAt = src.indexOf('--scan-dir "$app"');

  assert.ok(earlyScanAt > -1, 'the universal binary must be identity-scanned right after lipo');
  assert.ok(earlyScanAt < assembleAt,
    'THE POINT: the early scan must precede assemble_app — after it, the 2.4GB/role sidecar copies are already paid');
  // The authoritative gate is NOT replaced by the cheap one.
  assert.ok(fullScanAt > assembleAt,
    'the assembled-bytes scan must still run after assembly — the early scan supplements it, never replaces it');
});

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  yield [dir, entries.filter((e) => e.isDirectory()).map((e) => e.name),
         entries.filter((e) => e.isFile()).map((e) => e.name)];
  for (const e of entries) if (e.isDirectory()) yield* walk(path.join(dir, e.name));
}
