const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');

// WHY THIS GUARD EXISTS (2026-08-10, WI-37553 / EI-20094260886633250)
//
// The shipped Windows papercusp-desktop.exe carried 359 occurrences of the
// build box's $HOME — 316 from ~/.cargo, 192 from ~/.rustup, 1 workspace path.
// The linux binary carried ZERO for the same source, because the ELF link
// dead-strips those unreferenced rodata panic-location strings; PE/COFF retains
// them, exactly as Mach-O does (EI-20044309663936316). Windows runs no identity
// scan of its own, so nothing ever reported it and it shipped to testers.
//
// The remedy is TWO parts, and BOTH are load-bearing:
//   1. --remap-path-prefix on the cargo-xwin build  ->  359 leaks become 1.
//   2. --scrub-app-binary on the produced .exe      ->  that last 1 becomes 0.
// Part 2 cannot be dropped "because we remap now": the survivor is an absolute
// CARGO_MANIFEST_DIR baked by tauri's permission codegen via env!(), and remap
// only ever rewrites rustc SOURCE paths. Part 1 cannot be dropped "because we
// scrub now" either: the scrub replaces explicit known literals, and leaving 359
// of them for it to find is a far larger surface than leaving 1.
//
// PROPERTY-BASED, NOT SHAPE-BASED — deliberately. The sibling guard in
// build-desktop-sidecar-lock.test.js was a literal-shape matcher and went stale
// the instant a `RUSTFLAGS="..."` was inserted between `&&` and `cargo`,
// producing a FALSE RED that red-pinned the whole @papercusp/desktop task
// (EI-20095745825604620) against a script that had not regressed. So: assert the
// PROPERTY, per occurrence, and name the offending line.
//
// Comment and `echo` lines are excluded throughout. The script legitimately
// DISCUSSES both `--scrub-app-binary` and `run_iscc` in a long explanatory
// comment block, and matching that prose would be the same spelling-vs-property
// error one level up — a guard that passes because it matched its own docs.

const isProse = (line) => /^\s*(?:#|echo\b)/.test(line);

const lines = script.split('\n').map((line, i) => ({ line, lineNo: i + 1 }));
const code = lines.filter(({ line }) => !isProse(line));

const find = (re) => code.filter(({ line }) => re.test(line));

// A backslash-continued command block: walk BACKWARD from an invocation line
// while the preceding line ends in `\`. This is what makes the RUSTFLAGS check
// order-independent — the env assignment may sit anywhere in the block.
function commandBlock(allLines, lineNo) {
  let start = lineNo - 1; // 0-based index of the invocation line
  while (start > 0 && /\\\s*$/.test(allLines[start - 1])) start -= 1;
  return allLines.slice(start, lineNo).join('\n');
}

const scriptLines = script.split('\n');
const CARGO_WIN_BUILD = /cargo\s+xwin\s+build\b/;
const SCRUB_CALL = /--scrub-app-binary\b/;
const ASSEMBLED_SCAN_CALL = /--scan-dir\s+"\$\{_WIN_SCAN_DIRS\[@\]\}"/;
// The CALL, not the definition (`run_iscc() {`).
const ISCC_CALL = /^\s*run_iscc\s+["'$]/;

test('the Windows cross-build defines a path remap containing --remap-path-prefix', () => {
  const def = find(/^_WIN_REMAP=/);
  assert.equal(def.length, 1, 'expected exactly one _WIN_REMAP definition');
  assert.match(
    def[0].line,
    /--remap-path-prefix=/,
    '_WIN_REMAP must actually carry --remap-path-prefix; without it the exe re-acquires ~350 leaked $HOME paths',
  );
});

test('every cargo-xwin build passes RUSTFLAGS carrying the remap', () => {
  const builds = find(CARGO_WIN_BUILD);
  assert.ok(builds.length > 0, 'expected at least one `cargo xwin build` invocation to guard');

  const unremapped = builds
    .filter(({ lineNo }) => {
      const block = commandBlock(scriptLines, lineNo);
      return !(/RUSTFLAGS=/.test(block) && /_WIN_REMAP|--remap-path-prefix/.test(block));
    })
    .map(({ lineNo, line }) => `${lineNo}: ${line.trim()}`);

  assert.deepEqual(
    unremapped,
    [],
    'these cargo-xwin builds run WITHOUT the path remap, so the .exe will bake the build box $HOME',
  );
});

test('the Windows cross-build compiles an immutable source snapshot and pins its stamp', () => {
  assert.match(
    script,
    /BUILD_COMMIT_SHA="\$\(git -C "\$SOURCE_ROOT" rev-parse HEAD/, 
    'the producer must resolve the source commit before cargo starts',
  );
  assert.match(
    script,
    /git -C "\$SOURCE_ROOT" worktree add --detach "\$BUILD_ROOT" "\$BUILD_COMMIT_SHA"/,
    'the producer must build from a private worktree, not the shared checkout',
  );
  assert.match(
    script,
    /PAPERCUSP_BUILD_SHA=.*does not identify source HEAD/,
    'a caller-supplied build stamp must be rejected when it names a different commit',
  );
  assert.match(
    script,
    /ROOT="\$BUILD_ROOT"\nSRC_TAURI="\$ROOT\/src-tauri"/,
    'cargo and packaging inputs must switch to the isolated source after snapshotting',
  );
  assert.match(
    script,
    /OUT_DIR="\$OUTPUT_SRC_TAURI\/target\/windows-vm\/bundle\/inno"/,
    'artifacts must remain in the canonical collector tree after the source snapshot is removed',
  );
  assert.match(
    script,
    /git -C "\$SOURCE_ROOT" worktree remove --force "\$BUILD_ROOT"/,
    'the temporary source worktree must be cleaned up on exit',
  );
});

test('the produced .exe is identity-scrubbed BEFORE ISCC packs it', () => {
  const scrubs = find(SCRUB_CALL);
  assert.ok(
    scrubs.length > 0,
    'no --scrub-app-binary call: the env!()-baked CARGO_MANIFEST_DIR that remap cannot reach will ship',
  );

  const packs = find(ISCC_CALL);
  assert.ok(packs.length > 0, 'expected at least one run_iscc call to order against');

  // Ordering is the whole point. On mac this identical call once sat in
  // sign_app(), which runs after the identity scan, so it never executed and the
  // cut died with the leak intact. Presence is not enough; placement is.
  const firstScrub = Math.min(...scrubs.map((s) => s.lineNo));
  const firstPack = Math.min(...packs.map((p) => p.lineNo));
  assert.ok(
    firstScrub < firstPack,
    `scrub (line ${firstScrub}) must precede the first run_iscc call (line ${firstPack}) — scrubbing after packaging leaves the leaky bytes inside the installer`,
  );
});

test('each Windows role scans the assembled payload before ISCC packs it', () => {
  const scanAt = script.indexOf('python3 "$HERE/audit-release-bundle.py" --scan-dir "${_WIN_SCAN_DIRS[@]}"');
  const copyAt = script.indexOf('cp -f "$EXE" "$STAGE/target/release/papercusp-desktop.exe"');
  const packAt = script.indexOf('run_iscc "$app_id" "$app_name"');

  assert.ok(scanAt > -1, 'Windows must run the assembled-payload identity gate');
  assert.ok(copyAt > -1, 'the assembled payload must contain the role exe before the scan');
  assert.ok(scanAt > copyAt, 'the scan must inspect the staged role exe, not only the pre-stage binary');
  assert.ok(packAt > scanAt, 'the installer must not be packed before the assembled-payload scan passes');

  // The BuildRoot is symlinked for speed; passing it to grep -r would skip the
  // directories Inno follows. These real roots are the shipped inputs, and the
  // server-only roots protect the conditional [Files] entries in papercusp.iss.
  for (const root of ['$STAGE/target/release', '$SRC_TAURI/sidecar', '$SRC_TAURI/resources']) {
    assert.match(script, new RegExp(`"\\${root}"`), `assembled scan must include ${root}`);
  }
  assert.match(
    script,
    /_WIN_SCAN_DIRS\+=\("\$SRC_TAURI\/seed"\s+"\$SRC_TAURI\/env-sidecars\/staging"\)/,
    'server payload roots (seed and env-sidecars) must be scanned too',
  );
});

// FALSIFIABILITY — the guard-for-the-guard.
//
// A guard that has never failed is a guard nobody has tested. These prove the
// matchers CATCH the regressions they exist for, and (critically) that they do
// NOT match the script's own prose. Proved against SYNTHETIC strings only: this
// tree is swept into commits every few minutes, so briefly mutating the real
// script to test a guard can get that mutation committed even when nothing goes
// wrong and no handler fails.
test('the matchers catch a regressed script and ignore prose', () => {
  const analyse = (text) => {
    const all = text.split('\n');
    const codeOnly = all
      .map((line, i) => ({ line, lineNo: i + 1 }))
      .filter(({ line }) => !isProse(line));
    const builds = codeOnly.filter(({ line }) => CARGO_WIN_BUILD.test(line));
    return {
      remapped: builds.every(({ lineNo }) => /RUSTFLAGS=/.test(commandBlock(all, lineNo))),
      buildCount: builds.length,
      scrubCount: codeOnly.filter(({ line }) => SCRUB_CALL.test(line)).length,
      assembledScanCount: codeOnly.filter(({ line }) => ASSEMBLED_SCAN_CALL.test(line)).length,
      packLine: Math.min(
        ...codeOnly.filter(({ line }) => ISCC_CALL.test(line)).map((p) => p.lineNo),
        Infinity,
      ),
      scrubLine: Math.min(
        ...codeOnly.filter(({ line }) => SCRUB_CALL.test(line)).map((s) => s.lineNo),
        Infinity,
      ),
    };
  };

  // 1. An unremapped build is caught.
  const unremapped = analyse(['( cd "$SRC_TAURI" && env \\', '    cargo xwin build --release )'].join('\n'));
  assert.equal(unremapped.buildCount, 1, 'sanity: the sample contains one build');
  assert.equal(unremapped.remapped, false, 'a build with no RUSTFLAGS must be reported as unremapped');

  // 2. A remapped build passes.
  const remapped = analyse(
    ['( cd "$SRC_TAURI" && env \\', '    "RUSTFLAGS=$_WIN_REMAP" \\', '    cargo xwin build --release )'].join('\n'),
  );
  assert.equal(remapped.remapped, true, 'a build carrying RUSTFLAGS must pass');

  // 3. Prose is NOT counted — the exact error this guard is written to avoid.
  const prose = analyse(
    [
      '# we call --scrub-app-binary before run_iscc "gui" for identity reasons',
      'echo "  running --scrub-app-binary before run_iscc \\"x\\""',
    ].join('\n'),
  );
  assert.equal(prose.scrubCount, 0, 'a commented/echoed --scrub-app-binary must not count as a real call');
  assert.equal(prose.packLine, Infinity, 'a commented/echoed run_iscc must not count as a real call');

  // 4. The assembled-payload gate is a real call, not prose.
  const realScan = analyse('python3 "$HERE/audit-release-bundle.py" --scan-dir "${_WIN_SCAN_DIRS[@]}"');
  assert.equal(realScan.assembledScanCount, 1, 'a real assembled-payload scan must be counted');

  // 5. Scrub AFTER packing is caught — the mac failure mode, restated.
  const late = analyse(['run_iscc "$APP_ID" "$APP_NAME"', 'python3 audit.py --scrub-app-binary "$EXE"'].join('\n'));
  assert.ok(
    !(late.scrubLine < late.packLine),
    'scrubbing after run_iscc must NOT be accepted — the installer already carries the leaky bytes',
  );
});
