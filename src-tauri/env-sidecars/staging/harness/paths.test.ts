/**
 * paths.ts unit tests — focused on promptHarnessRoot, the prompt-resolution
 * root override that decouples agent PROMPT edits from the code-release gate
 * (decouple-agent-prompts-from-release-gate-2026-06-20 P-002 / D-001).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harnessRoot, promptHarnessRoot, resolveHarnessPackageRoot } from './paths.js';

describe('promptHarnessRoot — prompt-root override', () => {
  const saved: Record<string, string | undefined> = {};
  const tmps: string[] = [];

  beforeEach(() => {
    saved.PAPERCUSP_PROMPT_ROOT = process.env.PAPERCUSP_PROMPT_ROOT;
    saved.PAPERCUSP_INTEGRATION_ROOT = process.env.PAPERCUSP_INTEGRATION_ROOT;
    delete process.env.PAPERCUSP_PROMPT_ROOT;
    delete process.env.PAPERCUSP_INTEGRATION_ROOT;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const mk = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'papercusp-promptroot-'));
    tmps.push(d);
    return d;
  };

  /**
   * Every `resolveHarnessPackageRoot` case below passes `{ stopAt: root }`.
   *
   * The walk probes EVERY ancestor of its start dirs, and these fixtures live
   * under `mkdtemp(tmpdir())` — so an unbounded walk leaves the tree above
   * `root` (`/tmp`, then `/`) inside the assertion, and no test can own that.
   * On 2026-08-04 something left a full `blueprints/` tree at bare `/tmp`
   * (WI-10675); `hasHarnessAssets('/tmp')` flipped true, the null case below
   * resolved to `'/tmp'`, and that red-pinned `main` for the whole fleet.
   * Bounding the walk at the root each case created makes these assertions
   * decidable from the fixtures alone.
   */
  const mkAsset = (dir: string): void => {
    mkdirSync(join(dir, 'blueprints', 'base'), { recursive: true });
    writeFileSync(join(dir, 'blueprints', 'base', 'blueprint.yaml'), 'id: base\nkind: harness\n');
  };

  it('resolveHarnessPackageRoot recovers the source harness package from a bundled dist-host start dir', () => {
    const root = mk();
    const harness = join(root, 'libs', 'papercusp', 'packages', 'harness');
    mkAsset(harness);
    mkdirSync(join(root, 'apps', 'operator', 'dist-host'), { recursive: true });
    const start = join(root, 'apps', 'operator', 'dist-host');
    expect(resolveHarnessPackageRoot([start], { stopAt: root })).toBe(harness);
  });

  it('resolveHarnessPackageRoot prefers PAPERCUSP_INTEGRATION_ROOT when it has harness assets', () => {
    const root = mk();
    const harness = join(root, 'libs', 'papercusp', 'packages', 'harness');
    mkAsset(harness);
    process.env.PAPERCUSP_INTEGRATION_ROOT = root;
    expect(resolveHarnessPackageRoot(['/missing/start'], { stopAt: root })).toBe(harness);
  });

  it('resolveHarnessPackageRoot returns null when no candidate has harness assets', () => {
    const root = mk();
    expect(resolveHarnessPackageRoot([root], { stopAt: root })).toBeNull();
  });

  it('stopAt bounds the upward walk — an ancestor carrying harness assets is NOT adopted', () => {
    // The exact WI-10675 shape, reproduced hermetically: a polluted ANCESTOR
    // (the stand-in for `/tmp`) holding a `blueprints/base/blueprint.yaml`.
    const polluted = mk();
    mkAsset(polluted);
    const start = join(polluted, 'nested', 'start');
    mkdirSync(start, { recursive: true });

    // Bounded below the pollutant: the walk stops at `nested` and reports null.
    expect(resolveHarnessPackageRoot([start], { stopAt: join(polluted, 'nested') })).toBeNull();

    // Calibration — without the bound the SAME fixture is adopted, so the
    // assertion above is falsifiable and not vacuously true.
    expect(resolveHarnessPackageRoot([start])).toBe(polluted);
  });

  it('a WORLD-WRITABLE ancestor holding harness assets is never adopted, even inside stopAt (EI-19481118729454265)', () => {
    // The actual incident, reproduced hermetically: on 2026-08-03/04 a full
    // byte-identical copy of the built-in blueprint set sat at bare
    // `/tmp/blueprints/base/blueprint.yaml` — `/tmp` is other-writable
    // (mode 1777), so ANYONE on the box could have put it there. `stopAt`
    // only bounds the hermetic-test WALK; it says nothing about whether a
    // matched directory should be TRUSTED, so it must not be the only guard.
    const writable = mk();
    chmodSync(writable, 0o1777);
    mkAsset(writable);
    const start = join(writable, 'nested', 'start');
    mkdirSync(start, { recursive: true });

    // Even with `stopAt` pinned exactly at the polluted dir — which the
    // 'stopAt bounds…' case above proves is otherwise sufficient to adopt
    // it — the world-writable guard still refuses the match.
    expect(resolveHarnessPackageRoot([start], { stopAt: writable })).toBeNull();

    // Calibration: strip the world-writable bit and the identical structure
    // IS adopted — proving the guard (not the fixture shape, not `stopAt`)
    // is what excluded it above.
    chmodSync(writable, 0o755);
    expect(resolveHarnessPackageRoot([start], { stopAt: writable })).toBe(writable);
  });

  it('UNSET ⇒ returns the explicit fallback (byte-identical to pre-decouple)', () => {
    expect(promptHarnessRoot('/some/fallback')).toBe('/some/fallback');
  });

  it('UNSET + no fallback ⇒ defaults to harnessRoot()', () => {
    expect(promptHarnessRoot()).toBe(harnessRoot());
  });

  it('PAPERCUSP_PROMPT_ROOT (an existing dir) wins over the fallback', () => {
    const d = mk();
    process.env.PAPERCUSP_PROMPT_ROOT = d;
    expect(promptHarnessRoot('/fallback')).toBe(d);
  });

  it('PAPERCUSP_PROMPT_ROOT pointing at a non-existent dir falls through to the fallback', () => {
    process.env.PAPERCUSP_PROMPT_ROOT = join(tmpdir(), 'papercusp-prompt-root-does-not-exist-xyz');
    expect(promptHarnessRoot('/fallback')).toBe('/fallback');
  });

  it('PAPERCUSP_INTEGRATION_ROOT derives <root>/libs/papercusp/packages/harness', () => {
    const root = mk();
    const derived = join(root, 'libs', 'papercusp', 'packages', 'harness');
    mkdirSync(derived, { recursive: true });
    process.env.PAPERCUSP_INTEGRATION_ROOT = root;
    expect(promptHarnessRoot('/fallback')).toBe(derived);
  });

  it('PAPERCUSP_INTEGRATION_ROOT without the harness subtree falls through to the fallback', () => {
    const root = mk(); // no libs/papercusp/packages/harness created
    process.env.PAPERCUSP_INTEGRATION_ROOT = root;
    expect(promptHarnessRoot('/fallback')).toBe('/fallback');
  });

  it('PAPERCUSP_PROMPT_ROOT takes precedence over PAPERCUSP_INTEGRATION_ROOT', () => {
    const direct = mk();
    const root = mk();
    mkdirSync(join(root, 'libs', 'papercusp', 'packages', 'harness'), { recursive: true });
    process.env.PAPERCUSP_PROMPT_ROOT = direct;
    process.env.PAPERCUSP_INTEGRATION_ROOT = root;
    expect(promptHarnessRoot('/fallback')).toBe(direct);
  });
});
