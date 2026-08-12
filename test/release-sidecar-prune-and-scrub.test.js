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

function audit(...args) {
  return spawnSync('python3', [AUDIT, ...args], { encoding: 'utf8' });
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
  assert.notEqual(audit('--scan-dir', dir).status, 0,
    'fixture must be rejected BEFORE the scrub, or this test proves nothing');

  assert.equal(audit('--scrub-text', dir).status, 0);
  const after = fs.readFileSync(doc, 'utf8');
  assert.ok(!after.includes(lit), 'the identity literal must be gone');
  assert.ok(after.includes('# Insight'), 'surrounding prose must survive the scrub');
  assert.equal(audit('--scan-dir', dir).status, 0, 'the gate must pass after the scrub');
});

test('scrub-text reaches the doc classes the sidecar actually ships (.md/.mdx/.html)', () => {
  const lit = identityLiteral();
  const dir = tmp('scrubtext-ext');
  // .html matters specifically: internal-docs ships RENDERED twins of each .mdx, so
  // scrubbing only the source would leave the identity live in the served bytes.
  for (const ext of ['md', 'mdx', 'html', 'txt', 'json']) {
    fs.writeFileSync(path.join(dir, `f.${ext}`), `see ${lit} here`);
  }
  assert.equal(audit('--scrub-text', dir).status, 0);
  for (const ext of ['md', 'mdx', 'html', 'txt', 'json']) {
    assert.ok(!fs.readFileSync(path.join(dir, `f.${ext}`), 'utf8').includes(lit),
      `.${ext} must be scrubbed — it ships`);
  }
});

test('scrub-text breaks hardlinks — the live monorepo doc tree is never rewritten', () => {
  // The sidecar copier hardlinks where the FS supports it. An in-place write would
  // reach back THROUGH the link into apps/operator-docs and mutate the real repo.
  const lit = identityLiteral();
  const dir = tmp('scrubtext-link');
  const shipped = path.join(dir, 'shipped.md');
  const source = path.join(dir, 'source-of-truth.md');
  fs.writeFileSync(shipped, `path ${lit} end`);
  fs.linkSync(shipped, source);

  assert.equal(audit('--scrub-text', dir).status, 0);
  assert.ok(!fs.readFileSync(shipped, 'utf8').includes(lit), 'the shipped copy must be scrubbed');
  assert.ok(fs.readFileSync(source, 'utf8').includes(lit),
    'the hardlinked sibling must be UNTOUCHED — scrub must write a new inode');
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

test('build-mac-cross enables Tauri production codegen and has no mac scrub mitigation', () => {
  const src = fs.readFileSync(MAC_CROSS, 'utf8');
  assert.ok(src.includes('cargo zigbuild --release --target "$arch" -p papercusp-desktop --features custom-protocol'),
    'release mac builds must enable Tauri custom-protocol so tauri_build uses production codegen (EI-200443)');
  assert.equal(src.includes('scrub_app_identity'), false,
    'the mac build must not carry the pre-sign scrub mitigation after the production-codegen fix');
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
