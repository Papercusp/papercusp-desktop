// EI-18891305951810001 — is the SPA about to be packaged the one that was last built?
//
// WHY THIS EXISTS
// `npm run build` is `tauri build --bundles deb`, `beforeBuildCommand` is empty and
// `frontendDist` is a URL — so tauri builds NEITHER the frontend NOR the sidecar. It
// packages whatever already sits in `src-tauri/sidecar/`, which only
// `bin/build-desktop-sidecar.sh` ever refreshes (it runs `vite build` → dist → copies
// dist into sidecar/spa). Nothing in the build path invokes it, so a build after an
// app-source edit silently ships the PREVIOUS frontend.
//
// On 2026-07-28 that cost a full verify cycle and nearly a correct fix: a tested,
// discriminating fix to routes/index.tsx was packaged, the packaged app reproduced the
// ORIGINAL failure exactly, and the natural reading — "the fix is wrong, revert it" —
// was itself wrong. The fix had never entered the binary.
//
// WHY MTIME CANNOT DECIDE THIS, AND CONTENT CAN
// The stale packaged file's mtime was NEWER than the fix (the packaging copy touched
// it), so every timestamp check called it current. Vite's filenames carry a CONTENT
// HASH, so comparing the entry name asked and answered the real question in one grep:
// `index-YLHVi6ZV.js` (packaged) vs `index-AZ22_Xh1.js` (freshly built).
//
// Nor could a source-mtime guard work here: this is ONE shared checkout edited
// concurrently by the whole fleet, so source mtimes churn constantly and a
// "source newer than artifact" rule would fire on every build for every agent — a
// false-positive machine, which is a guard people learn to bypass. Comparing two
// BUILT artifacts to each other has no such noise: they differ only when they really
// are different builds.
//
// The pre-existing stale-sidecar guard (build-and-archive-deb.sh, EI-18683847182779973)
// is the same idea with a different input set — it watches `patches/*.patch` for
// vendored-dep skew. This covers the app-source half it cannot see.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** The `<script src>` vite emits, e.g. `index-AZ22_Xh1.js`. */
const ENTRY_RE = /index-[A-Za-z0-9_-]+\.js/g;

/**
 * Extract the hashed entry-bundle name from an index.html.
 * Returns null when the document references none (an unbuilt or hand-written shell).
 */
function entryBundle(html) {
  if (typeof html !== 'string') return null;
  const found = [...new Set(html.match(ENTRY_RE) ?? [])];
  // A vite index.html references exactly one entry chunk. More than one means the
  // document is not what we think it is — report it rather than silently picking one.
  return found.length === 1 ? found[0] : found.length === 0 ? null : found.sort().join(',');
}

/**
 * Compare the SPA staged for packaging against the freshly built one.
 *
 * PURE — takes the two documents' text, so every verdict is unit-testable without a
 * 4.7GB sidecar on disk.
 *
 * Verdicts:
 *   'match'       staged SPA is the built SPA — safe to package.
 *   'skew'        they are DIFFERENT builds — packaging now ships the wrong frontend.
 *   'no-dist'     nothing to compare against; cannot judge, so does not block.
 *   'no-sidecar'  no staged SPA at all; the sidecar build has never run.
 *   'unreadable'  one of the documents references no entry bundle.
 */
function inspectSpaFreshness({ sidecarHtml, distHtml }) {
  if (sidecarHtml == null) return { verdict: 'no-sidecar', sidecarEntry: null, distEntry: null };
  if (distHtml == null) {
    return { verdict: 'no-dist', sidecarEntry: entryBundle(sidecarHtml), distEntry: null };
  }
  const sidecarEntry = entryBundle(sidecarHtml);
  const distEntry = entryBundle(distHtml);
  if (!sidecarEntry || !distEntry) return { verdict: 'unreadable', sidecarEntry, distEntry };
  return {
    verdict: sidecarEntry === distEntry ? 'match' : 'skew',
    sidecarEntry,
    distEntry,
  };
}

/** Whether a verdict must stop the build. Only a PROVEN skew does. */
function blocksBuild(verdict) {
  return verdict === 'skew';
}

/** The operator-facing explanation. Kept here so the CLI and its test share one text. */
function describe(result) {
  switch (result.verdict) {
    case 'skew':
      return (
        'FATAL: STALE FRONTEND — this build would package a DIFFERENT SPA than the one last built.\n' +
        `  staged for packaging : ${result.sidecarEntry}   (src-tauri/sidecar/spa/index.html)\n` +
        `  last built           : ${result.distEntry}   (apps/operator-vite/dist/index.html)\n\n` +
        '  `tauri build` builds neither the frontend nor the sidecar — it packages whatever is\n' +
        '  already staged. Your app-source edits are NOT in that artifact.\n\n' +
        '  Fix:  papercusp-desktop/bin/build-desktop-sidecar.sh   (vite build → dist → sidecar/spa)\n' +
        '        then re-run the build.\n\n' +
        '  THEN VERIFY THE ARTIFACT, not the source: grep the packaged\n' +
        '  sidecar/spa/assets for a distinctive literal from your own change. mtime cannot answer\n' +
        '  this — the stale file\'s mtime is refreshed by the packaging copy (EI-18891305951810001).\n\n' +
        '  Override (you know the staged SPA is what you want): PAPERCUSP_ALLOW_STALE_SPA=1'
      );
    case 'no-sidecar':
      return (
        'WARNING: no staged SPA at src-tauri/sidecar/spa/index.html — the sidecar has never been\n' +
        '  built here. Run bin/build-desktop-sidecar.sh. (Not blocking: the build will fail on its\n' +
        '  own, and more clearly, than a freshness check can.)'
      );
    case 'no-dist':
      return (
        'NOTE: apps/operator-vite/dist/index.html is absent, so SPA freshness cannot be judged.\n' +
        `  Packaging the staged SPA as-is (${result.sidecarEntry ?? 'unknown entry'}). This check\n` +
        '  can only compare two BUILT artifacts; with one missing it declines to guess rather than\n' +
        '  reporting a clean pass it has not earned.'
      );
    case 'unreadable':
      return (
        'NOTE: could not read an entry bundle from one of the SPA documents ' +
        `(staged=${result.sidecarEntry ?? 'none'}, built=${result.distEntry ?? 'none'}), so\n` +
        '  freshness cannot be judged. Not blocking.'
      );
    default:
      return `SPA freshness OK — staged SPA is the last built one (${result.sidecarEntry}).`;
  }
}

/** Measured identity of the built document, carried by build-provenance.json. */
function desktopInterfaceIdentity(html) {
  if (typeof html !== 'string') return { kind: 'unknown', spaIndexSha256: null, entryBundle: null };
  const kinds = [];
  for (const tag of html.replace(/<!--[\s\S]*?-->/g, '').match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)]
      .map((match) => [match[1].toLowerCase(), match[3]]));
    if (attrs.name === 'papercusp-desktop-interface') kinds.push(attrs.content);
  }
  const kind = kinds.length === 1 && ['legacy', 'portal-candidate'].includes(kinds[0])
    ? kinds[0] : 'unknown';
  return {
    kind,
    spaIndexSha256: crypto.createHash('sha256').update(html).digest('hex'),
    entryBundle: entryBundle(html),
  };
}

function desktopInterfaceChoice(env = process.env) {
  const choice = env.PAPERCUSP_DESKTOP_INTERFACE ?? 'legacy';
  if (!['legacy', 'portal-candidate'].includes(choice)) {
    throw new Error(`Unknown desktop interface ${JSON.stringify(choice)}; choose legacy or portal-candidate.`);
  }
  return choice;
}

/** No public cutover override: that remains a separate owner decision. */
function assertPublicDesktopInterface(provenance, env = process.env) {
  if (desktopInterfaceChoice(env) !== 'legacy') {
    throw new Error('PUBLIC DESKTOP INTERFACE HOLD: portal candidate cannot replace public installers, signatures, latest.json or index.html before the separate approved cutover.');
  }
  if (provenance === undefined) return;
  const identities = [provenance?.desktopInterface, provenance?.sidecar?.desktopInterface].filter(Boolean);
  if (!identities.length || identities.some((identity) => identity.kind !== 'legacy' || !/^[a-f0-9]{64}$/.test(identity.spaIndexSha256 ?? ''))) {
    throw new Error('PUBLIC DESKTOP INTERFACE HOLD: artifact has no measured legacy SPA identity; candidate or unknown bytes cannot enter the public release pipeline.');
  }
}

function fileIdentity(file) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  const fd = fs.openSync(file, 'r');
  let size = 0;
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
      size += count;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { bytes: size, sha256: hash.digest('hex') };
}

/** Bind the interface record to the exact installer bytes being published. */
function assertPublicDesktopArtifacts(artifacts, env = process.env) {
  assertPublicDesktopInterface(undefined, env);
  const identities = [];
  for (const artifact of artifacts) {
    let directory = path.dirname(path.resolve(artifact));
    let found = false;
    for (let depth = 0; depth < 5; depth++, directory = path.dirname(directory)) {
      const file = path.join(directory, 'build-provenance.json');
      if (!fs.existsSync(file)) continue;
      const provenance = JSON.parse(fs.readFileSync(file, 'utf8'));
      const relative = path.relative(directory, path.resolve(artifact)).split(path.sep).join('/');
      const record = provenance.artifacts?.find((entry) => entry.name === relative);
      if (!record) continue;
      assertPublicDesktopInterface(provenance, env);
      const measured = fileIdentity(artifact);
      if (record.bytes !== measured.bytes || record.sha256 !== measured.sha256) {
        throw new Error('PUBLIC DESKTOP INTERFACE HOLD: installer bytes differ from their interface provenance.');
      }
      found = true;
      identities.push(provenance.desktopInterface ?? provenance.sidecar.desktopInterface);
      break;
    }
    if (!found) throw new Error('PUBLIC DESKTOP INTERFACE HOLD: installer has no matching build-provenance record.');
  }
  return identities;
}

module.exports = {
  entryBundle, inspectSpaFreshness, blocksBuild, describe,
  desktopInterfaceIdentity, desktopInterfaceChoice,
  assertPublicDesktopInterface, assertPublicDesktopArtifacts,
};

if (require.main === module) {
  try {
    assertPublicDesktopArtifacts(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 4;
  }
}
