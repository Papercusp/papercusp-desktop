// EI-19446480107603858 — is the prebuilt sidecar a build that carries the change
// this cut is supposed to ship?
//
// WHY THIS EXISTS
// `build-mac-cross.sh` (and `build-windows-cross.sh`) consume a sidecar that some
// EARLIER, separate command produced. Both gated it on EXISTENCE and ARCH only:
//
//     [[ -d "$DARWIN_SIDECAR/apps" && -f "$DARWIN_SIDECAR/bin/node" ]] || fail "... not found"
//     file "$DARWIN_SIDECAR/bin/node" | grep -q 'Mach-O'              || fail "... NOT darwin"
//
// Both guards are loud when the sidecar is MISSING and completely silent when it is
// STALE — and stale is the COMMON case, precisely because rebuilding it is a separate
// manual step nobody remembers. The guard is verbose in the rare case and mute in the
// frequent one.
//
// THE HALF-FRESH ARTIFACT — why staleness here is so deceptive
// The same build refreshes the OTHER half of the bundle every single run:
// cross-install-darwin-tree.sh rsyncs the live monorepo into the shipped source tree.
// So one half is rebuilt from current source and the other half is a cache, and nothing
// announces which is which. On 2026-08-03 (WI-3307) that shipped a bundle whose
// decisive acceptance criterion PASSED on the fresh half while the cached sidecar
// carried a 9-hour-old operator: /var/tmp/darwin-sidecar-abifix/serve.mjs was baked at
// 02:53Z and contained ZERO occurrences of the fix's symbols, yet DID contain
// env-operator-launcher.ts's other strings — so the launcher was bundled, just the old
// one. A partly-fresh artifact is far more deceptive than a wholly-stale one, because
// the evidence of freshness is real.
//
// Generalised: when an artifact is assembled from inputs with DIFFERENT refresh
// policies, "I rebuilt it" is not a claim about any particular input.
//
// WHY THIS DOES NOT FAIL ON "sidecar gitHead != HEAD"
// That was the fix originally proposed on the issue, and it is wrong here for the
// reason ./spa-freshness.js already established for its own input set: this is ONE
// shared checkout edited concurrently by the whole fleet, so HEAD moves every few
// minutes and a "source newer than artifact" rule would fire on essentially every
// build for every agent — a false-positive machine, which is a guard people learn to
// bypass. A guard that cries wolf is worse than no guard, because it trains the
// bypass.
//
// So this module contributes two things, and blocks on only one of them:
//
//   1. THE BANNER (always, never blocks). The sidecar's recorded gitHead, buildSha and
//      age, printed at the top of every consuming build. Silence was the actual defect;
//      "built 9h ago from ebb8505" would have stopped the WI-3307 build in its tracks
//      before ~73 minutes of cargo zigbuild. Information has no false-positive rate.
//
//   2. THE ASSERTION (blocks, zero false positives). PAPERCUSP_REQUIRE_SIDECAR_CONTAINS
//      = <sha> states "this cut must carry commit X", and the check refuses the build
//      when the sidecar's provenance does not contain it. It can only fire when a
//      caller asserted something, so it cannot cry wolf. This is the ad-hoc "grep the
//      built serve.mjs for a symbol only my fix introduces" FIX GATE — the thing that
//      actually caught the WI-3307 staleness — promoted from a shell snippet each
//      caller had to remember into a declarable precondition every caller inherits.
//      (Remembering was exactly the property that failed.)
//
// An absent provenance file is NOT treated as a pass: it is reported as undecidable,
// in the same spirit as spa-freshness.js's 'no-dist' — declining to guess rather than
// reporting a clean pass it has not earned.
//
// PURE — takes the provenance document's TEXT plus already-resolved git facts, so every
// verdict is unit-testable without a 4.7GB sidecar or a git repo on disk.

'use strict';

/**
 * Parse a build-provenance.json document (bin/emit-build-provenance.sh's output).
 * Returns null when the text is absent or not valid JSON — never throws.
 */
function parseProvenance(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  try {
    const doc = JSON.parse(text);
    return doc && typeof doc === 'object' ? doc : null;
  } catch {
    return null;
  }
}

/** Human-readable age, e.g. "9h 12m". Null in, null out. */
function formatAge(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Judge a prebuilt sidecar's freshness.
 *
 * @param {object}  args
 * @param {boolean} args.sidecarPresent  does the sidecar dir itself exist?
 * @param {?string} args.provenanceText  contents of <sidecar>/build-provenance.json, or null
 * @param {?string} args.headSha         the consuming repo's current HEAD (banner only)
 * @param {?string} args.requireContains the commit the caller asserts the sidecar must carry
 * @param {?boolean} args.containsVerdict true = provenance contains it, false = it does not,
 *                                        null = could not be resolved (unknown object).
 *                                        Resolved by the CALLER (git), so this stays pure.
 * @param {number}  args.nowMs           clock injection for deterministic tests
 *
 * Verdicts:
 *   'match'                 nothing asserted (or the assertion holds) — safe to build.
 *   'skew'                  an assertion was made and the sidecar does NOT carry it. BLOCKS.
 *   'contains-unverifiable' an assertion was made and could not be checked at all. BLOCKS —
 *                           an unverifiable assertion is not a pass.
 *   'no-sidecar'            no sidecar at all; the build fails on its own, more clearly.
 *   'no-provenance'         sidecar predates provenance emission; cannot judge, does not block.
 *   'unreadable'            provenance present but unparseable / missing gitHead.
 */
function inspectSidecarFreshness({
  sidecarPresent,
  provenanceText = null,
  headSha = null,
  requireContains = null,
  containsVerdict = null,
  nowMs = Date.now(),
} = {}) {
  const require_ = typeof requireContains === 'string' && requireContains.trim() !== ''
    ? requireContains.trim()
    : null;

  const base = {
    gitHead: null,
    buildSha: null,
    builtAtUtc: null,
    ageMs: null,
    headSha: headSha ?? null,
    requireContains: require_,
    containsVerdict: require_ ? containsVerdict : null,
  };

  if (!sidecarPresent) return { ...base, verdict: 'no-sidecar' };

  const prov = parseProvenance(provenanceText);
  if (prov == null) {
    // Distinguish "no file at all" from "a file we could not read" — they call for
    // different operator actions (rebuild vs investigate a corrupt emit).
    const hadText = typeof provenanceText === 'string' && provenanceText.trim() !== '';
    return { ...base, verdict: hadText ? 'unreadable' : 'no-provenance' };
  }

  const gitHead = typeof prov.gitHead === 'string' && prov.gitHead !== '' ? prov.gitHead : null;
  const builtAtUtc = typeof prov.builtAtUtc === 'string' && prov.builtAtUtc !== ''
    ? prov.builtAtUtc
    : null;
  const parsedAt = builtAtUtc ? Date.parse(builtAtUtc) : NaN;
  const facts = {
    ...base,
    gitHead,
    buildSha: typeof prov.buildSha === 'string' && prov.buildSha !== '' ? prov.buildSha : null,
    builtAtUtc,
    ageMs: Number.isFinite(parsedAt) ? Math.max(0, nowMs - parsedAt) : null,
  };

  // A provenance doc with no gitHead cannot answer the only question that blocks.
  if (!gitHead) return { ...facts, verdict: 'unreadable' };

  if (require_) {
    if (containsVerdict === false) return { ...facts, verdict: 'skew' };
    if (containsVerdict !== true) return { ...facts, verdict: 'contains-unverifiable' };
  }

  return { ...facts, verdict: 'match' };
}

/**
 * Whether a verdict must stop the build. Only a PROVEN skew, or an assertion the
 * caller explicitly made and we could not verify, does. Never mere staleness.
 */
function blocksBuild(verdict) {
  return verdict === 'skew' || verdict === 'contains-unverifiable';
}

/** The sidecar's identity line — printed on EVERY verdict, including the passing ones. */
function provenanceLine(result) {
  if (!result.gitHead && !result.builtAtUtc) return 'provenance: none recorded';
  const age = formatAge(result.ageMs);
  const parts = [
    `built ${result.builtAtUtc ?? 'at an unrecorded time'}${age ? ` (${age} ago)` : ''}`,
    `gitHead ${result.gitHead ?? 'unknown'}`,
  ];
  if (result.buildSha) parts.push(`buildSha ${result.buildSha}`);
  if (result.headSha && result.gitHead && result.headSha !== result.gitHead) {
    parts.push(`repo HEAD is now ${result.headSha}`);
  }
  return parts.join('  ·  ');
}

/** The operator-facing explanation. Kept here so the CLI and its test share one text. */
function describe(result) {
  const line = provenanceLine(result);
  switch (result.verdict) {
    case 'skew':
      return (
        'FATAL: STALE SIDECAR — the prebuilt sidecar does NOT carry the commit this build was\n' +
        `  told to ship (PAPERCUSP_REQUIRE_SIDECAR_CONTAINS=${result.requireContains}).\n` +
        `  sidecar ${line}\n\n` +
        '  The consuming build does not rebuild the sidecar; it packages whatever is already\n' +
        '  staged. Your source fix is NOT in that artifact, and every check that reads the\n' +
        '  shipped SOURCE TREE (which IS refreshed every build) will still pass — that is the\n' +
        '  half-fresh trap this guard exists for.\n\n' +
        '  Fix:  rebuild the sidecar, then re-run this build:\n' +
        '        TARGET_OS=<os> TARGET_ARCH=<arch> PAPERCUSP_SIDECAR_OUT=<dir> \\\n' +
        '          papercusp-desktop/bin/build-desktop-sidecar.sh\n\n' +
        '  THEN VERIFY THE ARTIFACT, not the source: grep the rebuilt serve.mjs for a literal\n' +
        '  only your change introduces. That check costs seconds and, on 2026-08-03, saved a\n' +
        '  ~73-minute cross-build that would have reproduced the identical bug.\n\n' +
        '  Override (you know the staged sidecar is what you want): PAPERCUSP_ALLOW_STALE_SIDECAR=1'
      );
    case 'contains-unverifiable':
      return (
        `FATAL: could not verify that the sidecar carries ${result.requireContains}.\n` +
        `  sidecar ${line}\n\n` +
        '  Either the asserted commit or the sidecar\'s recorded gitHead is unknown to this\n' +
        '  checkout (an unfetched commit, a submodule sha, or a typo). An assertion that\n' +
        '  cannot be checked is not a pass, so this refuses rather than reporting a clean\n' +
        '  result it has not earned.\n\n' +
        '  Override: PAPERCUSP_ALLOW_STALE_SIDECAR=1'
      );
    case 'no-sidecar':
      return (
        'WARNING: no prebuilt sidecar found. Run papercusp-desktop/bin/build-desktop-sidecar.sh.\n' +
        '  (Not blocking: the build\'s own payload assert fails on this, and more clearly than a\n' +
        '  freshness check can.)'
      );
    case 'no-provenance':
      return (
        'NOTE: this sidecar carries no build-provenance.json, so its age and origin cannot be\n' +
        '  judged — it predates provenance emission (or was assembled by hand). Building with it\n' +
        '  as-is. This check declines to guess rather than reporting a clean pass it has not\n' +
        '  earned; rebuild the sidecar to get a provenanced one.'
      );
    case 'unreadable':
      return (
        'NOTE: the sidecar\'s build-provenance.json is unparseable or records no gitHead, so\n' +
        '  freshness cannot be judged. Not blocking, but a corrupt provenance emit is worth\n' +
        '  investigating — rebuild the sidecar to regenerate it.'
      );
    default:
      return result.requireContains
        ? `sidecar OK — carries ${result.requireContains}.  ${line}`
        : `sidecar ${line}`;
  }
}

module.exports = {
  parseProvenance,
  formatAge,
  inspectSidecarFreshness,
  blocksBuild,
  provenanceLine,
  describe,
};
