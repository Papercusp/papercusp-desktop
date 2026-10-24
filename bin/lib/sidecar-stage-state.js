'use strict';

// Private producer evidence lives BESIDE the stage, never inside shipped bytes.
// This extends build-desktop-sidecar's existing assemble/qualify/publish phases;
// a retained stage is not a successful sidecar or a release attestation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFileSync, spawn } = require('node:child_process');

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

function gitArgs(root, args) {
  return ['-C', root, ...args];
}

function git(root, args) {
  return execFileSync('git', gitArgs(root, args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

// Failure evidence is generated output, not product source. An old frozen
// target cannot inherit the current producer's .gitignore; adjacent retention
// would make the next source-clean preflight fail. Reuse one output-specific
// namespace in the existing private stage mechanism, never a source exemption.
function failedStagesParent(env = process.env) {
  return path.resolve(env.XDG_STATE_HOME || path.join(env.HOME || os.homedir(), '.local', 'state'),
    'papercusp', 'sidecar-failed-stages');
}

function failureEvidenceRoot(finalDir, env = process.env) {
  const key = crypto.createHash('sha256').update(path.resolve(finalDir)).digest('hex').slice(0, 24);
  return path.resolve(env.PAPERCUSP_SIDECAR_FAILED_STAGE_ROOT || path.join(failedStagesParent(env), key));
}

function streamGitOutput(root, args, digest) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', gitArgs(root, args), { stdio: ['ignore', 'pipe', 'pipe'] });
    const stderr = [];
    let stderrBytes = 0;
    child.stdout.on('data', chunk => digest.update(chunk));
    child.stderr.on('data', chunk => {
      if (stderrBytes >= 8192) return;
      const part = chunk.subarray(0, 8192 - stderrBytes);
      stderr.push(part);
      stderrBytes += part.length;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim();
      reject(new Error(
        'git ' + args.join(' ') + ' failed with ' + (signal || code)
        + (detail ? ': ' + detail : ''),
      ));
    });
  });
}

async function sourceState(root) {
  // HEAD alone cannot observe uncommitted edits at the same commit. Include
  // nested tracked diffs and untracked source status, without storing the text.
  const digest = crypto.createHash('sha256');
  for (const args of [
    ['diff', '--no-ext-diff', '--binary', '--submodule=diff', 'HEAD'],
    ['status', '--porcelain=v1', '--untracked-files=normal'],
  ]) {
    digest.update(JSON.stringify(args));
    await streamGitOutput(root, args, digest);
  }
  return digest.digest('hex');
}

async function captureIdentity(env = process.env) {
  const repoRoot = fs.realpathSync(env.SIDECAR_STAGE_REPO_ROOT);
  const desktopRoot = fs.realpathSync(env.SIDECAR_STAGE_DESKTOP_ROOT);
  const here = fs.realpathSync(env.SIDECAR_STAGE_HELPER_ROOT);
  const failedStageRoot = path.resolve(env.SIDECAR_STAGE_FAILED_ROOT || failureEvidenceRoot(env.SIDECAR_STAGE_FINAL_DIR, env));
  for (const source of [repoRoot, desktopRoot]) {
    if (failedStageRoot === source || failedStageRoot.startsWith(`${source}${path.sep}`))
      throw new Error('failed stage evidence root must be outside product source');
  }
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
    path.join(here, 'verify-sidecar-bundle.sh'),
    path.join(here, 'lib/server-container.mjs'),
    path.join(repoRoot, 'package-lock.json'),
  ].map(file => ({ file: fs.realpathSync(file), sha256: sha256(file) }));
  const sourceStateDigest = await sourceState(repoRoot);
  const desktopStateDigest = await sourceState(desktopRoot);
  const identity = {
    repoRoot, desktopRoot, sourceHead, desktopHead,
    sourceState: sourceStateDigest, desktopState: desktopStateDigest,
    submodules: git(repoRoot, ['submodule', 'status', '--recursive']),
    finalDir: path.resolve(env.SIDECAR_STAGE_FINAL_DIR),
    failedStageRoot,
    profile: env.PAPERCUSP_DISTRIBUTION_PROFILE,
    targetOs: env.SIDECAR_STAGE_TARGET_OS, targetArch: env.SIDECAR_STAGE_TARGET_ARCH,
    version: env.PAPERCUSP_DESKTOP_VERSION || '', buildSha: env.PAPERCUSP_BUILD_SHA || '',
    sourceDirty: env.PROVENANCE_SOURCE_GIT_DIRTY,
    releaseAudit: env.PAPERCUSP_RELEASE_AUDIT || '0',
    scrub: env.PAPERCUSP_STAGE_SCRUB || '1', tools,
    buildNodeVersion: process.version,
    spaRecipeSha256: digestJson(['apps/operator-vite/package.json',
      'apps/operator-vite/vite.config.ts', 'apps/operator-vite/bin/vite-build-singleflight']
      .map(file => ({ file, sha256: fs.existsSync(path.join(repoRoot, file))
        ? sha256(path.join(repoRoot, file)) : null }))),
  };
  if (env.PAPERCUSP_SPA_SNAPSHOT_FROM) {
    const root = fs.realpathSync(env.PAPERCUSP_SPA_SNAPSHOT_FROM);
    const receipt = validateSpa(root, identity);
    identity.spaSnapshot = { root, receiptSha256: sha256(`${root}.spa.json`),
      contentSha256: receipt.contentSha256 };
  }
  return identity;
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

function digestJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function cleanSourceState() {
  const digest = crypto.createHash('sha256');
  for (const args of [['diff', '--no-ext-diff', '--binary', '--submodule=diff', 'HEAD'],
    ['status', '--porcelain=v1', '--untracked-files=normal']]) digest.update(JSON.stringify(args));
  return digest.digest('hex');
}

// SPA bytes are portable, but their source and build recipe are not interchangeable.
// Deliberately omit architecture, checkout paths and native producer tools here.
function spaBinding(identity) {
  const keys = ['sourceHead', 'desktopHead', 'sourceState', 'desktopState', 'submodules',
    'profile', 'version', 'buildSha', 'buildNodeVersion', 'spaRecipeSha256'];
  const binding = Object.fromEntries(keys.map(key => [key, identity[key]]));
  binding.packageLockSha256 = identity.tools?.find(tool => path.basename(tool.file) === 'package-lock.json')?.sha256;
  if (identity.sourceDirty !== 'false' || identity.sourceState !== cleanSourceState()
      || identity.desktopState !== cleanSourceState()) throw new Error('SPA reuse requires clean product and desktop source');
  if (keys.some(key => typeof binding[key] !== 'string' || (key !== 'submodules' && !binding[key]))
      || !/^[a-f0-9]{64}$/.test(binding.packageLockSha256 || '')
      || !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(binding.buildNodeVersion)) {
    throw new Error('SPA snapshot lacks complete source/build binding');
  }
  return binding;
}

function portableSpaInventory(snapshot) {
  const entries = inventory(snapshot);
  const index = entries.find(entry => entry.path === 'index.html');
  if (!index || index.type !== 'file' || index.size === 0) throw new Error('SPA snapshot requires nonempty index.html');
  for (const entry of entries) {
    if (/\.(?:node|so(?:\.[0-9.]+)?|dll|dylib|exe)$/i.test(entry.path))
      throw new Error(`SPA snapshot contains native bytes: ${entry.path}`);
    if (entry.type !== 'file') continue;
    const header = Buffer.alloc(4);
    const fd = fs.openSync(path.join(snapshot, entry.path), 'r');
    try { fs.readSync(fd, header, 0, 4, 0); } finally { fs.closeSync(fd); }
    if (header.equals(Buffer.from([127, 69, 76, 70])) || header.subarray(0, 2).toString() === 'MZ'
        || [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(header.readUInt32BE()))
      throw new Error(`SPA snapshot contains native bytes: ${entry.path}`);
  }
  return entries;
}

function captureSpa(snapshot, identity) {
  const binding = spaBinding(identity);
  const entries = portableSpaInventory(snapshot);
  const receipt = { schemaVersion: 1, kind: 'portable-spa', binding, entries,
    contentSha256: digestJson(entries) };
  writeJson(`${snapshot}.spa.json`, receipt);
  return receipt;
}

function validateSpa(snapshot, identity) {
  const binding = spaBinding(identity);
  const receiptFile = `${snapshot}.spa.json`;
  if (fs.lstatSync(receiptFile).isSymbolicLink()) throw new Error('SPA receipt must not be a symlink');
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  if (receipt.schemaVersion !== 1 || receipt.kind !== 'portable-spa'
      || JSON.stringify(receipt.binding) !== JSON.stringify(binding)) throw new Error('SPA source/build binding changed');
  const entries = portableSpaInventory(snapshot);
  if (JSON.stringify(entries) !== JSON.stringify(receipt.entries)
      || digestJson(entries) !== receipt.contentSha256) throw new Error('SPA bytes, paths, modes or links changed');
  if (identity.spaSnapshot && (identity.spaSnapshot.root !== fs.realpathSync(snapshot)
      || identity.spaSnapshot.receiptSha256 !== sha256(receiptFile)
      || identity.spaSnapshot.contentSha256 !== receipt.contentSha256)) throw new Error('SPA input receipt changed after stage capture');
  return receipt;
}

function copySpa(snapshot, destination, identity) {
  const receipt = validateSpa(snapshot, identity);
  if (fs.existsSync(destination)) throw new Error('SPA copy destination already exists');
  const temporary = `${destination}.tmp.${process.pid}`;
  if (fs.existsSync(temporary)) throw new Error('SPA copy temporary already exists');
  try {
    fs.cpSync(snapshot, temporary, { recursive: true, verbatimSymlinks: true });
    // cpSync creates directories using the destination umask. Restore the
    // validated modes without changing the process-wide umask or following links.
    for (const entry of receipt.entries) {
      if (entry.type !== 'symlink') fs.chmodSync(path.join(temporary, entry.path), entry.mode);
    }
    if (JSON.stringify(portableSpaInventory(temporary)) !== JSON.stringify(receipt.entries))
      throw new Error('SPA bytes changed during copy');
    validateSpa(snapshot, identity);
    fs.renameSync(temporary, destination);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  return receipt;
}

async function captureSpaFromSource(snapshot, identity) {
  for (const [root, head, state] of [[identity.repoRoot, identity.sourceHead, identity.sourceState],
    [identity.desktopRoot, identity.desktopHead, identity.desktopState]]) {
    if (git(root, ['rev-parse', 'HEAD']) !== head || await sourceState(root) !== state)
      throw new Error('SPA source changed since identity capture');
  }
  return captureSpa(snapshot, identity);
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
  const prefix = expected.failedStageRoot
    ? path.join(expected.failedStageRoot, `${path.basename(expected.finalDir)}.failed-stage.`)
    : `${expected.finalDir}.failed-stage.`;
  // The producer adds one numeric suffix when a container reuses its PID.
  if (!absolute.startsWith(prefix) || !/^[0-9]+(?:\.[0-9]+)?$/.test(absolute.slice(prefix.length))) {
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

// WI-6554700010010442 / plan disk-headroom-standing-reclaim-2026-10-12#D-005.
// The failure bank used to keep every failed stage (5-9 GB each) forever. A
// stage is reusable only by PAPERCUSP_SIDECAR_RESUME_FROM, only from phase
// 'assembled', and only when its identity equals the next build's exactly, so
// anything but the newest failure of an output is dead weight. Retention is a
// policy enforced by the writer on every build, never a low-disk reaction:
//   - an output's group keeps at most its NEWEST entry, and only while that
//     entry is a resumable stage younger than the TTL (default 24h);
//   - a successful build clears its output's group entirely;
//   - orphan receipts and receipt-less stages are deleted;
//   - a protected path (the RESUME_FROM target) is never deleted;
//   - a group whose builder does not hold the lock is touched only outside a
//     grace window (default 60 min), so a concurrent writer is never raced.
const FAILED_STAGE_ENTRY = /^(.+)\.failed-stage\.([0-9]+(?:\.[0-9]+)?)(\.resume\.json)?$/;
const FAILED_STAGE_KEY_DIR = /^[0-9a-f]{24}$/;

function lstatOrNull(file) {
  try { return fs.lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function readdirOrEmpty(dir) {
  try { return fs.readdirSync(dir).sort(); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// Reuse one bounded, no-follow census for total and exact pinned allocation.
// A shared inode can be encountered outside its pinned scope first; its pinned
// contribution therefore has its own set, independent of total-walk ordering.
function diskAllocation(target, coversPath = () => false) {
  const seen = new Map();
  const pinned = new Set();
  let budget = 100000;
  const deadline = Date.now() + 30000;
  let total = 0;
  let pinnedBytes = 0;
  const walk = file => {
    if (--budget < 0 || Date.now() >= deadline) throw new Error('failed stage byte census budget exceeded');
    const stat = lstatOrNull(file);
    if (!stat) return;
    const id = `${stat.dev}:${stat.ino}`;
    const bytes = stat.blocks * 512;
    if (seen.has(id) && seen.get(id) !== bytes) throw new Error('failed stage allocation changed during census');
    if (!seen.has(id)) {
      seen.set(id, bytes);
      total += bytes;
    }
    if (coversPath(file) && !pinned.has(id)) {
      pinned.add(id);
      pinnedBytes += bytes;
    }
    if (stat.isDirectory()) for (const name of readdirOrEmpty(file)) walk(path.join(file, name));
  };
  walk(target);
  return { bytes: total, pinnedBytes };
}

function isResumableReceipt(receipt) {
  return Boolean(receipt) && receipt.schemaVersion === 1 && receipt.accepted === false
    && receipt.status === 'failed' && receipt.phase === 'assembled' && receipt.resumable === true;
}

function failedStageGroups(keyDir) {
  const groups = new Map();
  for (const name of readdirOrEmpty(keyDir)) {
    const match = FAILED_STAGE_ENTRY.exec(name);
    if (!match) continue;
    const [, output, suffix, receiptExtension] = match;
    if (!groups.has(output)) groups.set(output, new Map());
    const group = groups.get(output);
    const stage = path.join(keyDir, `${output}.failed-stage.${suffix}`);
    if (!group.has(suffix)) group.set(suffix, { output, suffix, stage, receipt: `${stage}.resume.json` });
    group.get(suffix)[receiptExtension ? 'hasReceipt' : 'hasStage'] = true;
  }
  const result = new Map();
  for (const [output, group] of groups) {
    const entries = [];
    for (const entry of group.values()) {
      const stageStat = entry.hasStage ? lstatOrNull(entry.stage) : null;
      const receiptStat = entry.hasReceipt ? lstatOrNull(entry.receipt) : null;
      if (!stageStat && !receiptStat) continue;
      let receipt = null;
      if (receiptStat?.isFile()) {
        try { receipt = JSON.parse(fs.readFileSync(entry.receipt, 'utf8')); } catch { receipt = null; }
      }
      entries.push({
        ...entry, hasStage: Boolean(stageStat), hasReceipt: Boolean(receiptStat),
        // The receipt is written last, atomically, so its mtime is the failure
        // time. A receipt-less stage is dated by when it entered the bank
        // (rename sets ctime; a cross-device mv creates a new inode).
        time: receiptStat ? receiptStat.mtimeMs : Math.max(stageStat.mtimeMs, stageStat.ctimeMs),
        resumable: Boolean(stageStat?.isDirectory()) && isResumableReceipt(receipt),
      });
    }
    entries.sort((a, b) => b.time - a.time || b.suffix.localeCompare(a.suffix, 'en', { numeric: true }));
    result.set(output, entries);
  }
  return result;
}

function nonNegativeNumber(value, name) {
  const number = Number(value);
  if (value === '' || value === null || !Number.isFinite(number) || number < 0)
    throw new Error(`${name} must be a non-negative number`);
  return number;
}

function planFailedStagePrune(keyDir, { now, ttlMs, graceMs, protect, ownedOutput, clear }) {
  const decisions = [];
  for (const [output, entries] of failedStageGroups(keyDir)) {
    const owned = ownedOutput === output;
    const newest = entries[0];
    const keeper = !(owned && clear) && newest?.resumable && now - newest.time < ttlMs ? newest : null;
    for (const entry of entries) {
      const age = now - entry.time;
      const paths = [entry.hasStage && entry.stage, entry.hasReceipt && entry.receipt].filter(Boolean);
      let action = 'delete';
      let reason;
      if (protect.has(entry.stage) || protect.has(entry.receipt)) [action, reason] = ['keep', 'protected'];
      else if (entry === keeper) [action, reason] = ['keep', 'newest-resumable'];
      else if (!owned && age < graceMs) [action, reason] = ['keep', 'within-grace'];
      else if (owned && clear) reason = 'output-built-successfully';
      else if (!entry.hasStage) reason = 'orphan-receipt';
      else if (!entry.hasReceipt) reason = 'no-receipt';
      else if (age >= ttlMs) reason = 'expired';
      else if (!entry.resumable) reason = 'not-resumable';
      else reason = 'superseded';
      decisions.push({ action, reason, output, keyDir, paths, time: entry.time, ageHours: Math.round(age / 36e3) / 100 });
    }
  }
  return decisions;
}

async function pruneFailedStages(options = {}, env = process.env) {
  const { withRetentionPinProtection } = await import('../../../scripts/lib/retention-pins.mjs');
  return withRetentionPinProtection(isPinned => pruneFailedStagesWithProtection(options, env, isPinned),
    { dir: env.PAPERCUSP_RELEASE_RETENTION_ROOT, nowMs: options.now });
}

// The scheduled reclaimer already holds the shared retention mutex. Its
// predicate comes from the protection read inside that lock.
function pruneFailedStagesWithProtection(options = {}, env = process.env, isPinned) {
  if (typeof isPinned !== 'function') throw new Error('retention protection is required');
  if (typeof isPinned.coversPath !== 'function') throw new Error('pin allocation coverage is required');
  const now = options.now ?? Date.now();
  const ttlMs = nonNegativeNumber(options.ttlHours ?? (env.PAPERCUSP_SIDECAR_FAILED_STAGE_TTL_HOURS || 24),
    'PAPERCUSP_SIDECAR_FAILED_STAGE_TTL_HOURS') * 3600e3;
  const graceMs = nonNegativeNumber(options.graceMinutes ?? (env.PAPERCUSP_SIDECAR_FAILED_STAGE_GRACE_MINUTES || 60),
    'PAPERCUSP_SIDECAR_FAILED_STAGE_GRACE_MINUTES') * 60e3;
  const maxBytes = Number(options.maxBytes ?? 20 * 1024 ** 3);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('failed stage maxBytes must be a positive safe integer');
  if (Boolean(options.keyDir) !== Boolean(options.output))
    throw new Error('prune --key-dir and --output name the locked output together');
  if (options.clear && !options.keyDir) throw new Error('prune --clear requires --key-dir and --output');
  if (!options.keyDir && !options.all) throw new Error('prune requires --all or --key-dir with --output');
  const protect = new Set();
  for (const file of options.protect || []) {
    if (!file) continue;
    protect.add(path.resolve(file));
    protect.add(`${path.resolve(file)}.resume.json`);
  }
  const lockedKeyDir = options.keyDir ? path.resolve(options.keyDir) : null;
  const parent = path.resolve(options.parent ?? (lockedKeyDir ? path.dirname(lockedKeyDir) : failedStagesParent(env)));
  const keyDirs = [];
  if (lockedKeyDir) keyDirs.push(lockedKeyDir);
  if (options.all) {
    for (const name of readdirOrEmpty(parent)) {
      const keyDir = path.join(parent, name);
      if (FAILED_STAGE_KEY_DIR.test(name) && keyDir !== lockedKeyDir && lstatOrNull(keyDir)?.isDirectory())
        keyDirs.push(keyDir);
    }
  }
  const receipt = { schemaVersion: 1, kind: 'sidecar-failed-stage-prune', at: new Date(now).toISOString(),
    dryRun: Boolean(options.dryRun), ttlHours: ttlMs / 3600e3, graceMinutes: graceMs / 60e3,
    deleted: [], kept: [], errors: [], freedBytes: 0 };
  const decisions = [];
  for (const keyDir of keyDirs) {
    const ownedOutput = keyDir === lockedKeyDir ? path.basename(path.resolve(options.output)) : null;
    decisions.push(...planFailedStagePrune(keyDir, { now, ttlMs, graceMs, protect, ownedOutput, clear: options.clear }));
  }
  // One ceiling for the whole bank, rather than one per output identity. Unknown
  // entries count toward usage but are never turned into deletion candidates.
  const { bytes: beforeBytes, pinnedBytes } = diskAllocation(parent, isPinned.coversPath);
  const cap = receipt.cap = { root: parent, maxBytes, beforeBytes, afterBytes: beforeBytes,
    pinnedBytes, overByBytes: Math.max(0, beforeBytes - maxBytes), pinnedOverageBytes: Math.max(0, pinnedBytes - maxBytes) };
  if (beforeBytes > maxBytes) decisions.sort((a, b) => a.time - b.time || a.paths[0].localeCompare(b.paths[0]));
  for (const decision of decisions) {
      if (decision.paths.some(isPinned)) {
        receipt.kept.push({ paths: decision.paths, reason: 'retention-pin', ageHours: decision.ageHours });
        continue;
      }
      // An explicit producer protection or a foreign stage still being admitted
      // remains protected. A resumable fallback can be evicted under the ceiling.
      const capVictim = cap.afterBytes > maxBytes && decision.reason !== 'protected' && decision.reason !== 'within-grace';
      if (decision.action === 'keep' && !capVictim) {
        receipt.kept.push({ paths: decision.paths, reason: decision.reason, ageHours: decision.ageHours });
        continue;
      }
      // The receipt goes first: a half-deleted stage must never look resumable.
      for (const file of [...decision.paths].reverse()) {
        try {
          const bytes = diskAllocation(file).bytes;
          if (!options.dryRun) fs.rmSync(file, { recursive: true, force: true });
          receipt.deleted.push({ path: file, reason: capVictim ? 'size-cap' : decision.reason, ageHours: decision.ageHours, diskBytes: bytes });
          receipt.freedBytes += bytes;
          cap.afterBytes = Math.max(0, cap.afterBytes - bytes);
        } catch (error) {
          receipt.errors.push({ path: file, error: error.message });
        }
      }
  }
  if (!options.dryRun) {
    // Per-entry subtraction can double-count a link shared with a retained
    // stage. The final verdict uses actual remaining bank allocation.
    const after = diskAllocation(parent, isPinned.coversPath);
    cap.afterBytes = after.bytes;
    cap.pinnedBytes = after.pinnedBytes;
    cap.pinnedOverageBytes = Math.max(0, after.pinnedBytes - maxBytes);
  }
  cap.overByBytes = Math.max(0, cap.afterBytes - maxBytes);
  if (cap.overByBytes > cap.pinnedOverageBytes) receipt.errors.push({ path: parent, error: `failed stage size cap remains exceeded:${cap.overByBytes}` });
  if (options.all && !options.dryRun && lstatOrNull(parent)?.isDirectory()) {
    try { writeJson(path.join(parent, 'last-prune.json'), receipt); } catch (error) {
      receipt.errors.push({ path: path.join(parent, 'last-prune.json'), error: error.message });
    }
  }
  return receipt;
}

function parsePruneArgs(argv) {
  const options = { protect: [] };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = () => {
      if (index + 1 >= argv.length) throw new Error(`prune ${flag} requires a value`);
      return argv[++index];
    };
    if (flag === '--all') options.all = true;
    else if (flag === '--clear') options.clear = true;
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--key-dir') options.keyDir = value();
    else if (flag === '--output') options.output = value();
    else if (flag === '--protect') options.protect.push(value());
    else if (flag === '--parent') options.parent = value();
    else if (flag === '--ttl-hours') options.ttlHours = value();
    else if (flag === '--grace-minutes') options.graceMinutes = value();
    else if (flag === '--max-bytes') options.maxBytes = value();
    else throw new Error(`prune: unknown argument ${flag}`);
  }
  return options;
}

module.exports = { captureIdentity, captureSpa, captureSpaFromSource, copySpa, failedStagesParent,
  failureEvidenceRoot, inventory, parsePruneArgs, portableSpaInventory, pruneFailedStages, pruneFailedStagesWithProtection, recordFailure,
  sourceState, spaBinding, validateResume, validateSpa, writeJson };

if (require.main === module) {
  try {
    const [command, file, ...args] = process.argv.slice(2);
    if (command === 'evidence-root') {
      process.stdout.write(`${failureEvidenceRoot(file)}\n`);
    } else if (command === 'capture') {
      captureIdentity().then(identity => writeJson(file, identity)).catch(error => {
        console.error('FATAL: sidecar stage: ' + error.message);
        process.exitCode = 1;
      });
    }
    else if (command === 'capture-spa') {
      captureSpaFromSource(file, JSON.parse(fs.readFileSync(args[0], 'utf8'))).catch(error => {
        console.error('FATAL: sidecar stage: ' + error.message); process.exitCode = 1;
      });
    } else if (command === 'copy-spa') {
      copySpa(file, args[0], JSON.parse(fs.readFileSync(args[1], 'utf8')));
    } else if (command === 'export-spa') {
      const identity = JSON.parse(fs.readFileSync(args[1], 'utf8'));
      captureSpaFromSource(file, identity).then(() => {
        copySpa(file, args[0], identity);
        captureSpa(args[0], identity);
      }).finally(() => fs.rmSync(`${file}.spa.json`, { force: true })).catch(error => {
        console.error('FATAL: sidecar stage: ' + error.message); process.exitCode = 1;
      });
    } else if (command === 'retain') {
      recordFailure(file, JSON.parse(fs.readFileSync(args[0], 'utf8')), args[1], Number(args[2]));
    } else if (command === 'validate') {
      validateResume(file, JSON.parse(fs.readFileSync(args[0], 'utf8')));
    } else if (command === 'prune') {
      pruneFailedStages(parsePruneArgs(process.argv.slice(3))).then(receipt => {
        const gib = (receipt.freedBytes / 2 ** 30).toFixed(2);
        process.stdout.write(`→ failed sidecar stages: ${receipt.dryRun ? 'would delete' : 'deleted'} `
          + `${receipt.deleted.length} path(s), ${gib} GiB; kept ${receipt.kept.length}; errors ${receipt.errors.length}\n`);
        process.stdout.write(`SIDECAR_FAILED_STAGE_PRUNE ${JSON.stringify(receipt)}\n`);
        if (receipt.errors.length) process.exitCode = 1;
      }).catch(error => { console.error('FATAL: sidecar stage: ' + error.message); process.exitCode = 1; });
    } else throw new Error('expected capture, retain, validate or prune');
  } catch (error) {
    console.error(`FATAL: sidecar stage: ${error.message}`);
    process.exitCode = 1;
  }
}
