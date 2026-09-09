// Exact, committed-path repairs to a frozen Windows native source snapshot.
// This is a derived source, NOT a clean build of the base commit. The existing
// buildSha remains the paired Server/operator identity; sourceRepair identifies
// the changed native code independently. Publication still needs acceptance.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], {
  maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
const commit = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function roles(value) {
  assert.ok(Array.isArray(value) && value.length > 0 && value.length <= 2,
    'repair roles must explicitly name gui and/or server');
  assert.ok(value.every((role) => role === 'gui' || role === 'server'), 'invalid repair role');
  assert.equal(new Set(value).size, value.length, 'duplicate repair role');
  return [...value].sort();
}

function manifest(value) {
  assert.equal(value.schemaVersion, 1, 'unsupported source repair schema');
  const legacy = value.kind === 'windows-gui-source-repair';
  assert.ok(legacy || value.kind === 'windows-native-source-repair', 'unsupported repair kind');
  // Preserve the legacy GUI manifest's exact serialized shape and hash. Never
  // silently discard a roles field that could look like Server authorization.
  if (legacy) assert.equal(value.roles, undefined, 'legacy repair is GUI-only; use native kind for explicit roles');
  const scopedRoles = legacy ? null : roles(value.roles);
  assert.ok(commit(value.baseDesktopCommit) && commit(value.baseWorkspaceCommit));
  assert.match(value.operatorBuildSha, /^[a-f0-9]{8,40}$/);
  assert.ok(value.baseDesktopCommit.startsWith(value.operatorBuildSha),
    'paired operator identity must identify the frozen desktop base');
  assert.match(value.workItem, /^(?:WI|EI)-\d+$/);
  assert.ok(Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 20);
  const files = value.files.map((file) => {
    // This seam is deliberately native-source-only, not a second arbitrary
    // release-input copier or a route around the generated payload gates.
    assert.match(file.path, /^src-tauri\/src\/[A-Za-z0-9_-]+\.rs$/);
    assert.ok(commit(file.sourceCommit), 'repair bytes must be committed');
    assert.ok(file.beforeSha256 === null || digest(file.beforeSha256));
    assert.ok(digest(file.afterSha256));
    assert.notEqual(file.beforeSha256, file.afterSha256, 'empty repair');
    return {
      path: file.path, sourceCommit: file.sourceCommit,
      beforeSha256: file.beforeSha256, afterSha256: file.afterSha256,
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
  assert.equal(new Set(files.map((f) => f.path)).size, files.length, 'duplicate repair path');
  const result = {
    schemaVersion: 1, kind: value.kind, workItem: value.workItem,
    baseDesktopCommit: value.baseDesktopCommit,
    baseWorkspaceCommit: value.baseWorkspaceCommit,
    operatorBuildSha: value.operatorBuildSha, files,
    ...(legacy ? {} : { roles: scopedRoles }),
  };
  return { ...result, manifestSha256: hash(Buffer.from(JSON.stringify(result))) };
}

function forRoles(input, requested) {
  const repair = manifest(input);
  // Old callers remain GUI-only. New native manifests ALWAYS require the
  // actual requested build roles, including on post-build attestation.
  const fallback = repair.kind === 'windows-gui-source-repair' ? ['gui'] : [];
  const requestedRoles = requested === undefined || requested === ''
    ? roles(fallback) : roles(typeof requested === 'string' ? requested.trim().split(/\s+/) : requested);
  assert.deepEqual(requestedRoles, repair.roles || ['gui'], 'source repair/build roles mismatch');
  return repair;
}

function compileConfig(input, snapshot, role) {
  const repair = manifest(input);
  assert.ok((repair.roles || ['gui']).includes(role), 'compile role outside source repair');
  const base = JSON.parse(fs.readFileSync(regularPath(snapshot, 'src-tauri/tauri.conf.json')));
  const override = role === 'server'
    ? JSON.parse(fs.readFileSync(regularPath(snapshot, 'src-tauri/tauri.server.conf.json'))) : {};
  assert.equal(override.identifier ?? base.identifier, `com.papercusp.${role}`,
    'source repair compile identifier mismatch');
  return override;
}

function regularPath(root, relative, missing = false) {
  const parts = relative.split('/');
  let current = root;
  for (let i = 0; i < parts.length; i += 1) {
    current = path.join(current, parts[i]);
    if (!fs.existsSync(current) && missing && i === parts.length - 1) {
      // existsSync follows symlinks, so check lstat as well.
      assert.throws(() => fs.lstatSync(current), { code: 'ENOENT' });
      return current;
    }
    const stat = fs.lstatSync(current);
    assert.ok(!stat.isSymbolicLink(), `symlink in repair path: ${relative}`);
    assert.ok(i === parts.length - 1 ? stat.isFile() : stat.isDirectory());
  }
  return current;
}

function apply(input, sourceRepo, snapshot, baseDesktopCommit, baseWorkspaceCommit, requestedRoles) {
  const repair = forRoles(input, requestedRoles);
  assert.equal(repair.baseDesktopCommit, baseDesktopCommit, 'wrong desktop base');
  assert.equal(repair.baseWorkspaceCommit, baseWorkspaceCommit, 'wrong workspace base');
  assert.equal(git(snapshot, 'rev-parse', 'HEAD').toString().trim(), baseDesktopCommit);
  // Validate EVERY byte/path before writing any. A bad second entry must not
  // leave the first applied and look like a valid partial repair on a retry.
  const prepared = repair.files.map((file) => {
    const target = regularPath(snapshot, file.path, file.beforeSha256 === null);
    if (file.beforeSha256 === null) {
      assert.ok(!fs.existsSync(target), `new source already exists: ${file.path}`);
      assert.equal(git(snapshot, 'ls-tree', baseDesktopCommit, '--', file.path).length, 0);
    } else {
      assert.equal(hash(fs.readFileSync(target)), file.beforeSha256, 'snapshot baseline changed');
      assert.equal(hash(git(snapshot, 'show', `${baseDesktopCommit}:${file.path}`)),
        file.beforeSha256, 'before hash is not the frozen source');
    }
    const treeEntry = git(sourceRepo, 'ls-tree', file.sourceCommit, '--', file.path).toString();
    assert.match(treeEntry, /^100644 blob /, 'repair must name a regular committed Rust file');
    const bytes = git(sourceRepo, 'show', `${file.sourceCommit}:${file.path}`);
    assert.equal(hash(bytes), file.afterSha256, 'committed repair hash mismatch');
    return { target, bytes };
  });
  for (const { target, bytes } of prepared) fs.writeFileSync(target, bytes);
  verify(repair, snapshot, requestedRoles);
  return repair;
}

function verify(input, snapshot, requestedRoles) {
  const repair = forRoles(input, requestedRoles);
  assert.equal(input.manifestSha256, repair.manifestSha256, 'repair manifest changed');
  assert.equal(git(snapshot, 'rev-parse', 'HEAD').toString().trim(), repair.baseDesktopCommit);
  const changed = new Set([
    ...git(snapshot, 'diff', '--name-only', 'HEAD', '--', 'src-tauri/src').toString().trim().split('\n'),
    ...git(snapshot, 'ls-files', '--others', '--exclude-standard', '--', 'src-tauri/src')
      .toString().trim().split('\n'),
  ].filter(Boolean));
  assert.deepEqual([...changed].sort(), repair.files.map((f) => f.path).sort(),
    'unmanifested native source delta');
  for (const file of repair.files) {
    assert.equal(hash(fs.readFileSync(regularPath(snapshot, file.path))), file.afterSha256,
      `repair source changed: ${file.path}`);
  }
  return repair;
}

function attestation(input, snapshot, buildSha, gitHead, requestedRoles) {
  const repair = verify(input, snapshot, requestedRoles);
  assert.equal(buildSha, repair.operatorBuildSha, 'repair paired operator identity mismatch');
  assert.equal(gitHead, repair.baseDesktopCommit, 'repair base provenance mismatch');
  for (const role of repair.roles || ['gui']) compileConfig(repair, snapshot, role);
  return repair;
}

if (require.main === module) {
  const [action, inputPath, ...args] = process.argv.slice(2);
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const result = action === 'apply' ? apply(input, ...args)
    : action === 'verify' ? verify(input, ...args)
      : action === 'attestation' ? attestation(input, ...args)
        : action === 'roles' ? forRoles(input, ...args)
          : action === 'config' ? compileConfig(input, ...args)
      : (() => { throw new Error(`unknown action: ${action}`); })();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = { apply, verify, attestation, manifest, hash, forRoles, compileConfig };
