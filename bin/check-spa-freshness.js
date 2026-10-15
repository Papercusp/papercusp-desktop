#!/usr/bin/env node
// EI-18891305951810001 — `prebuild` gate: refuse to package a frontend that is not the
// one last built. Rationale, and why content rather than mtime, in ./lib/spa-freshness.js.
//
// Deliberately wired to the npm `prebuild` lifecycle rather than to the archive wrapper:
// the pre-existing stale-sidecar guard lives in bin/build-and-archive-deb.sh, which
// `npm run build` — the entrypoint in README.md, SHIPPING.md, and the one an agent
// reaches for — never invokes. A guard the documented entrypoint skips is not a guard.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inspectSpaFreshness, blocksBuild, describe, assertPublicDesktopInterface, desktopInterfaceIdentity } = require('./lib/spa-freshness.js');

const desktopDir = path.resolve(__dirname, '..');
const repoRoot = process.env.PAPERCUSP_REPO_DIR || path.resolve(desktopDir, '..');
// The verifier keeps PAPERCUSP_REPO_DIR pointed at its dependency/coordination
// donor. Package assertions must compare against the SPA frozen for that run,
// rather than whichever frontend a peer last built in the donor checkout.
const isolatedVerifier = process.env.PAPERCUSP_VERIFY_TAURI_ISOLATED === '1';
const frozenSpaDir = process.env.VERIFY_TAURI_SPA_DIST;
if (isolatedVerifier && !frozenSpaDir) {
  console.error('[spa-freshness] FATAL: isolated packaging requires VERIFY_TAURI_SPA_DIST as its frozen SPA baseline.');
  process.exit(4);
}

const SIDECAR_INDEX = path.join(desktopDir, 'src-tauri/sidecar/spa/index.html');
const DIST_INDEX = path.join(
  isolatedVerifier ? frozenSpaDir : path.join(repoRoot, 'apps/operator-vite/dist'),
  'index.html',
);

function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

const result = inspectSpaFreshness({
  sidecarHtml: readOrNull(SIDECAR_INDEX),
  distHtml: readOrNull(DIST_INDEX),
});
try {
  assertPublicDesktopInterface();
  if (process.env.PAPERCUSP_RELEASE_HOST || process.env.PAPERCUSP_RELEASE_TAG || process.env.PAPERCUSP_DISTRIBUTION_PROFILE === 'public') {
    assertPublicDesktopInterface({ desktopInterface: desktopInterfaceIdentity(readOrNull(SIDECAR_INDEX)) });
  }
} catch (error) {
  console.error(error.message);
  process.exit(4);
}
const message = describe(result);

// An isolated acceptance run needs a measured match. A missing or unreadable
// baseline cannot inherit the ordinary build's non-blocking no-dist behavior,
// and the stale-SPA escape hatch cannot turn it into acceptance evidence.
if (isolatedVerifier && result.verdict !== 'match') {
  console.error(`[spa-freshness] FATAL: isolated package does not match its frozen SPA baseline (${DIST_INDEX}).\n${message}`);
  process.exit(4);
}

if (blocksBuild(result.verdict) && process.env.PAPERCUSP_ALLOW_STALE_SPA === '1') {
  console.warn(`[spa-freshness] OVERRIDDEN by PAPERCUSP_ALLOW_STALE_SPA=1:\n${message}`);
  process.exit(0);
}

if (blocksBuild(result.verdict)) {
  console.error(`[spa-freshness] ${message}`);
  // 4 matches the sibling stale-sidecar guard's exit code, so a wrapper can treat
  // "refused for staleness" as one condition regardless of which guard caught it.
  process.exit(4);
}

console.log(`[spa-freshness] ${message}`);
