# Routines are claimed by WHICHEVER host's tick wins — green and staging race on one table
URL: /internal/docs/agent-insights/routines-two-host-version-lottery

Green (:3070, release tree) and staging (:3170, main) both run routinesTick against one harness_shared.routines table, so which CODE VERSION handles a fire is a lottery — new-code-only payloads fail intermittently until the release deploy.

**What.** Since the 2026-06-05 release-gate cutover the dev box runs TWO
operators — green `:3070` from the `papercup-release` checkout (the `ready`
ref) and staging `:3170` from `main` — and **both** register the DBOS
`routinesTick` against the **same** `harness_shared.routines` table (they
share `apps/operator/.env.local`, so both see `PAPERCUSP_DBOS_ROUTINES=1`).
The atomic claim in `claimDueRoutine` guarantees exactly ONE host fires a due
routine, but **which one wins is a race** — so the code version that executes
a routine's payload is a per-fire lottery.

**Why it matters.** A routine whose payload only newer code understands fails
intermittently-to-always until the next release deploy. Observed live
(autoloop-pot-operator-rebuild D-010): a
`system:blueprint-run {blueprintId:'pot'}` wake was claimed by the green
host, whose release tree
had no `pot` blueprint — `fireLaunchBlueprint` threw, and (second, compounding
bug fixed on `main` in `packages/operator-core/lib/harness/routines/claim.ts`) the old claim
semantics left the one-shot row ACTIVE with `next_fire_at=NULL`, which means
"due now" — an infinite 30s refire loop until the row was deactivated by hand.

**How to apply.**

* Don't arm (activate) a routine whose `target_role`/payload needs code that
  hasn't reached the **green** checkout yet — seed it INACTIVE and flip it
  after the release deploy, or verify green has the code first
  (`journalctl --user -u papercup-dev-api` paths name the serving tree).
* A misfiring routine loop is stopped with
  `UPDATE harness_shared.routines SET active=false WHERE name='<name>'`.
* If you change routine CLAIM/fire semantics on `main`, remember the live
  ticker is green's until a deploy — your fix is not protecting production
  rows yet.
