#!/usr/bin/env node
// EI-19446480107603858 — announce a prebuilt sidecar's provenance, and refuse the build
// when the caller asserted a commit the sidecar does not carry.
// Rationale, and why this does NOT fail on "gitHead != HEAD", in ./lib/sidecar-freshness.js.
//
// Wired into the two cross-build legs that CONSUME a sidecar they did not build
// (build-mac-cross.sh, build-windows-cross.sh), immediately beside their existing
// existence/arch payload asserts — so the freshness signal arrives at the same moment,
// and from the same guard block, as "is it there at all" and "is it the right arch".
//
//   node bin/check-sidecar-freshness.js --sidecar <dir> [--repo-root <dir>] [--label <name>]
//
// Exit 0 = proceed (the banner is on stdout), 4 = refused for staleness (family
// convention: matches check-spa-freshness.js and the build-and-archive-deb.sh guard, so
// a wrapper can treat "refused for staleness" as one condition whichever guard caught it).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  inspectSidecarFreshness,
  blocksBuild,
  describe,
} = require('./lib/sidecar-freshness.js');

const desktopDir = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const sidecarDir = path.resolve(arg('--sidecar', path.join(desktopDir, 'src-tauri/sidecar')));
const repoRoot = path.resolve(
  arg('--repo-root', process.env.PAPERCUSP_REPO_DIR || path.resolve(desktopDir, '..')),
);
const label = arg('--label', 'sidecar-freshness');

function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function gitOrNull(args) {
  try {
    const r = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
    return r.status === 0 ? String(r.stdout).trim() || null : null;
  } catch {
    return null;
  }
}

/**
 * Does `head` (the sidecar's recorded commit) contain `needle`?
 * true / false / null when either object is unknown to this checkout — the three
 * outcomes are deliberately distinct: `null` refuses rather than passing, because an
 * assertion that could not be checked has not been satisfied.
 */
function containsCommit(needle, head) {
  if (!needle || !head) return null;
  try {
    const r = spawnSync('git', ['-C', repoRoot, 'merge-base', '--is-ancestor', needle, head], {
      encoding: 'utf8',
    });
    if (r.status === 0) return true; // ancestor (a commit is its own ancestor)
    if (r.status === 1) return false; // resolved, and NOT contained
    return null; // 128 / spawn failure: unknown object, cannot judge
  } catch {
    return null;
  }
}

const provenanceText = readOrNull(path.join(sidecarDir, 'build-provenance.json'));
const requireContains = (process.env.PAPERCUSP_REQUIRE_SIDECAR_CONTAINS || '').trim() || null;

// Resolve the sidecar's own gitHead first so ancestry can be asked against it.
let recordedHead = null;
try {
  const doc = provenanceText ? JSON.parse(provenanceText) : null;
  if (doc && typeof doc.gitHead === 'string') recordedHead = doc.gitHead;
} catch {
  /* inspect() reports the unreadable verdict; nothing to resolve here */
}

const result = inspectSidecarFreshness({
  sidecarPresent: fs.existsSync(sidecarDir),
  provenanceText,
  headSha: gitOrNull(['rev-parse', 'HEAD']),
  requireContains,
  containsVerdict: requireContains ? containsCommit(requireContains, recordedHead) : null,
});

const message = describe(result);

if (blocksBuild(result.verdict) && process.env.PAPERCUSP_ALLOW_STALE_SIDECAR === '1') {
  console.warn(`[${label}] OVERRIDDEN by PAPERCUSP_ALLOW_STALE_SIDECAR=1:\n${message}`);
  process.exit(0);
}

if (blocksBuild(result.verdict)) {
  console.error(`[${label}] ${message}`);
  process.exit(4);
}

console.log(`[${label}] ${message}`);
