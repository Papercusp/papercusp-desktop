'use strict';

// Private producer evidence lives BESIDE the stage, never inside shipped bytes.
// This extends build-desktop-sidecar's existing assemble/qualify/publish phases;
// a retained stage is not a successful sidecar or a release attestation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function writeJson(file, value) {
  const tmp = `${file}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

function sourceState(root) {
  // HEAD alone cannot observe uncommitted edits at the same commit. Include
  // nested tracked diffs and untracked source status, without storing the text.
  const digest = crypto.createHash('sha256');
  for (const args of [
    ['diff', '--no-ext-diff', '--binary', '--submodule=diff', 'HEAD'],
    ['status', '--porcelain=v1', '--untracked-files=normal'],
  ]) digest.update(JSON.stringify(args)).update(git(root, args));
  return digest.digest('hex');
}

function captureIdentity(env = process.env) {
  const repoRoot = fs.realpathSync(env.SIDECAR_STAGE_REPO_ROOT);
  const desktopRoot = fs.realpathSync(env.SIDECAR_STAGE_DESKTOP_ROOT);
  const here = fs.realpathSync(env.SIDECAR_STAGE_HELPER_ROOT);
  const sourceHead = git(repoRoot, ['rev-parse', 'HEAD']);
  const desktopHead = git(desktopRoot, ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(sourceHead) || !/^[a-f0-9]{40}$/.test(desktopHead)) {
    throw new Error('cannot bind both source repository identities');
  }
  if (sourceHead !== env.PROVENANCE_SOURCE_GIT_HEAD) {
    throw new Error('sidecar stage source identity differs from REPO_ROOT');
  }
  const tools = [
    path.join(here, 'build-desktop-sidecar.sh'), __filename,
    path.join(here, 'audit-release-bundle.py'),
    path.join(here, 'emit-build-provenance.sh'),
    path.join(here, 'lib/transformers-models.sh'),
    path.join(desktopRoot, 'bin/verify-sidecar-bundle.sh'),
    path.join(repoRoot, 'package-lock.json'),
  ].map(file => ({ file: fs.realpathSync(file), sha256: sha256(file) }));
  return {
    repoRoot, desktopRoot, sourceHead, desktopHead,
    sourceState: sourceState(repoRoot), desktopState: sourceState(desktopRoot),
    submodules: git(repoRoot, ['submodule', 'status', '--recursive']),
    finalDir: path.resolve(env.SIDECAR_STAGE_FINAL_DIR),
    profile: env.PAPERCUSP_DISTRIBUTION_PROFILE,
    targetOs: env.SIDECAR_STAGE_TARGET_OS, targetArch: env.SIDECAR_STAGE_TARGET_ARCH,
    version: env.PAPERCUSP_DESKTOP_VERSION || '', buildSha: env.PAPERCUSP_BUILD_SHA || '',
    sourceDirty: env.PROVENANCE_SOURCE_GIT_DIRTY,
    releaseAudit: env.PAPERCUSP_RELEASE_AUDIT || '0',
    scrub: env.PAPERCUSP_STAGE_SCRUB || '1', tools,
  };
}

function inventory(stage) {
  const root = fs.realpathSync(stage);
  if (fs.lstatSync(stage).isSymbolicLink()) throw new Error('stage root must not be a symlink');
  const rows = [];
  function walk(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const entry = relative ? `${relative}/${name}` : name;
      const file = path.join(root, entry);
      const stat = fs.lstatSync(file);
      const mode = stat.mode & 0o777;
      if (stat.isDirectory()) {
        rows.push({ path: entry, type: 'directory', mode });
        walk(entry);
      } else if (stat.isFile()) {
        rows.push({ path: entry, type: 'file', mode, size: stat.size, sha256: sha256(file) });
      } else if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(file);
        const resolved = fs.realpathSync(file);
        if (path.isAbsolute(target) || (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))) {
          throw new Error(`stage symlink escapes relocatable bytes: ${entry}`);
        }
        rows.push({ path: entry, type: 'symlink', target });
      } else {
        throw new Error(`unsupported stage entry: ${entry}`);
      }
    }
  }
  walk('');
  return rows;
}

function recordFailure(stage, identity, phase, exitCode) {
  const receipt = {
    schemaVersion: 1, accepted: false, status: 'failed', phase, exitCode,
    identity, resumable: false,
  };
  try {
    receipt.entries = inventory(stage);
    receipt.resumable = phase === 'assembled';
  } catch (error) { receipt.inventoryError = error.message; }
  writeJson(`${stage}.resume.json`, receipt);
  return receipt;
}

function validateResume(stage, expected) {
  const absolute = path.resolve(stage);
  const prefix = `${expected.finalDir}.failed-stage.`;
  if (!absolute.startsWith(prefix) || !/^[0-9]+$/.test(absolute.slice(prefix.length))) {
    throw new Error('resume requires a retained failed-stage sibling of this output');
  }
  const receipt = JSON.parse(fs.readFileSync(`${absolute}.resume.json`, 'utf8'));
  if (receipt.schemaVersion !== 1 || receipt.accepted !== false || receipt.status !== 'failed'
      || receipt.phase !== 'assembled' || receipt.resumable !== true) {
    throw new Error('failed stage has no completed assembly phase; rebuild required');
  }
  if (JSON.stringify(receipt.identity) !== JSON.stringify(expected)) {
    throw new Error('failed stage source/profile/target/producer identity changed; rebuild required');
  }
  const entries = inventory(absolute);
  if (JSON.stringify(receipt.entries) !== JSON.stringify(entries)) {
    throw new Error('failed stage bytes, paths, modes or symlinks changed; rebuild required');
  }
  for (const critical of ['serve.mjs', 'bin/node']) {
    const row = entries.find(entry => entry.path === critical);
    if (!row || row.type !== 'file' || row.size === 0) throw new Error(`missing critical stage bytes: ${critical}`);
  }
  return receipt;
}

module.exports = { captureIdentity, inventory, recordFailure, validateResume, writeJson };

if (require.main === module) {
  try {
    const [command, file, ...args] = process.argv.slice(2);
    if (command === 'capture') writeJson(file, captureIdentity());
    else if (command === 'retain') {
      recordFailure(file, JSON.parse(fs.readFileSync(args[0], 'utf8')), args[1], Number(args[2]));
    } else if (command === 'validate') {
      validateResume(file, JSON.parse(fs.readFileSync(args[0], 'utf8')));
    } else throw new Error('expected capture, retain or validate');
  } catch (error) {
    console.error(`FATAL: sidecar stage: ${error.message}`);
    process.exitCode = 1;
  }
}
