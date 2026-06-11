# Smoke-test gate
URL: /internal/docs/harness/smoke-test

The DONE-blocking smoke gate — why it exists, what's wired today (the gate machinery + health signal), and what still awaits its port (the runner).

Validators verify code-level claims; they don't always start the real service
and hit real endpoints. A feature can "pass" — unit test green, contract
documented, migration applied — while the deployed service 500s from config
drift, a missing env var, or a startup race. The **smoke-test gate** exists to
catch that class of failure *before* a pipeline declares DONE. The principle
("quality through truth": verify service startup, don't trust test output
alone) came from the first harness generation and still holds.

## What is wired today

**The gate.** The durable finalizer's planner
(`planFinalization` in
`packages/operator-core/lib/dbos/orchestrator-finalize.ts`) treats the smoke
result as a first-class DONE gate, exactly like an open `needs-human` plan
item: when `smokeEnabled` is set and `smokePassed === false`, finalization is
**blocked** — no curator/documenter recipe runs and the pipeline does not
complete.

**The health signal.** The harness health read
(`packages/operator-core/lib/harness-readers.ts`) includes
`smoke_test_clean` among its composite checks: it fails whenever a
`smoke-failure.md` sentinel exists in the harness state dir, so a failed
smoke run is visible on every health surface.

**The hooks.** `on-smoke-pass` / `on-smoke-fail` remain valid
[lifecycle-hook](/internal/docs/harness/hooks) names the engine can run
(`runHook()` accepts any name), with tests covering the smoke-hook env shape.

## What is NOT yet wired: the runner

The piece that actually *executes* a smoke test — start the service if
needed, curl the configured URLs, write the pass/fail sentinel — was a
main-loop-internal of the retired engine and has **not been ported** to the
durable pipeline. The runner call site passes the gate explicitly off
(`packages/operator-core/lib/dbos/orchestrator-runner.ts`:

> "Smoke gate is config-gated-off for \~all harnesses; not yet ported into the
> durable finalizer (`runSmokeTest` is a main-loop-internal). Tracked as a
> Phase F follow-up; pass not-run so it never blocks here."

— `smokeEnabled: false, smokePassed: null`). Until that follow-up lands,
nothing in the live tree writes `smoke-pass.md`/`smoke-failure.md`, so
`smoke_test_clean` only fires on sentinels left by earlier engines or written
out-of-band.

In short: **gate machinery live, runner pending.** If you need a service-level
check on a harness today, the supported route is the testing surface (the
project's own test/E2E suites — see [Testing](/internal/docs/testing)) rather
than the harness smoke config.

## The bash-era design (reference for the port)

For whoever picks up the follow-up, the retired runner's behavior — still the
right shape — was: read the smoke config (`urls` of
`{ url, expectStatus, expectText? }`, optional `startupCmd` +
`startupWaitSeconds`), start the service if the first URL isn't responding,
curl each URL, then on all-pass write the pass sentinel (clearing any failure
sentinel) and on any-fail write `smoke-failure.md` and reopen the
most-recently-passed feature as failing. Gating ran in two modes: `onDone`
(block mission completion) and `onFeaturePass` (revert a feature before the
documenter runs, so docs are never generated for a broken state).

## Related

* [Lifecycle hooks](/internal/docs/harness/hooks) — `on-smoke-pass` /
  `on-smoke-fail`
* [Decision telemetry](/internal/docs/harness/decisions-timeline) — the
  health-check family `smoke_test_clean` belongs to
