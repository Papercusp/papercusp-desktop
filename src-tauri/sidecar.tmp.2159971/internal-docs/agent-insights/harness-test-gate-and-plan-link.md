# Harness tests gate feature approval, and link to plans through the VAL
URL: /internal/docs/agent-insights/harness-test-gate-and-plan-link

The V2 tester writes one black-box test per VAL; the validator runs them as the approval gate. VALs live in harness_plan_assertions (inline plan bullets via plans:promote) — NOT validation-contract.md or a validation_criteria table. The plan↔test link is a rollup join on the VAL.

import { Aside } from '@astrojs/starlight/components';

How the harness testing system fits together after
`harness-tests-tab-and-tester-promotion-2026-05-26` (phases A–E + G). If you're
touching the tester, validator, the harness Tests tab, or anything that reads
VAL assertions, start here.

## The VAL is the single join key

A **VAL** (`VAL-{plan-slug}-{NNN}`) is one binding behavioral assertion. It is
the only thing that links plans, features, tests, and the validator:

* **Plan item** authors VALs as inline `[VAL-…]` sub-bullets (`Verify:` /
  `Evidence:` / `Status:` / optional `RequiresTest:`). `plans:promote` parses
  them (`packages/operator-core/lib/agent-tools/plans/val-assertions.ts`) and writes them to PG.
* **Feature** carries them in `claims[]` (set by `plans:promote`).
* **Test** declares `coversVALs[]` in `.papercusp/tests.json`.
* **Validator** resolves them by id to decide pass/fail.

Do **not** read `.papercusp/validation-contract.md` (retired by
plans-central-harness-ux-2026-05-26 D-005) and do **not** add a
`validation_criteria` table (the original plan proposed one; it was dropped).
The canonical store is `harness_shared.harness_plan_assertions`, keyed by
`(workspace_id, harness_slug, val_id)`, with `plan_slug` / `item_id` /
`verify_text` / `evidence_text` / `status` / `requires_test`. Resolve a VAL via
`GET /api/harness/:slug/assertion/:valId`.

## The gate: tester writes, validator runs, approval requires green

The staging loop (`libs/papercusp/.../prompts/staging/`) gates feature approval
on tests:

1. A feature is `validating` (worker committed). The orchestrator's **C0**
   decision emits `NEXT_TESTER <F> <VAL>` for each claim VAL with no passing
   covering test. (`NEXT_TESTER` is wired in the **DBOS pipeline** —
   `packages/operator-core/lib/dbos/orchestrator-decide.ts` dispatches the
   `tester` role; bash `run.sh` AND the TS run-loop (`main-loop.ts`, archived
   2026-06-06 to `_retired/orchestrator-run-loop/`) are both retired. The
   prompt just needed to start emitting it.)
2. The **tester** (`staging/tester.md`) writes one black-box test per VAL,
   registers it in `.papercusp/tests.json` with `coversVALs`, exits.
3. Once every test-requiring VAL has a passing test, the orchestrator sends the
   feature to the **validator** (`staging/validator.md` V2), whose primary gate
   is **running** the VAL-covering tests. An untested required claim is a FAIL.

A VAL with `requires_test: false` (copy, design-spec, judgement) is **exempt** —
the gate skips it; the validator verifies it by inspection. Default is `true`.

## The plan↔test link is a rollup, not a new edge

There is **no** `test → plan-item` foreign key. The link is computed by joining
through the VAL (`packages/operator-core/lib/harness-test-rollup.ts`, pure + unit-tested):

* `/api/internal/test-snapshot` drives `harness_plan_assertions.status` from
  covering-test outcomes (`deriveAssertionStatus`) and stamps `plan_slug` /
  `item_ids` onto each test row.
* `GET /api/harness/:slug/plan-items-test-status` and `plans:get`'s
  `planItemTests` both call `computePlanItemTestStatus` → per-plan-item
  `{ valsTotal, valsRequiringTest, valsCovered, valsPassing }`.
* The Plans UI badge (`decoratePlanItemTestBadges`) and the harness Tests tab's
  Acceptance view render from that.

Built-in/universal tests (lint, typecheck, smoke — the `universalDomains` tier
from `@papercusp/testing-shell`, formerly "generalized") have no `coversVALs`, so
they match no assertion and contribute to no plan item. Only behavioral/Project
tests link to plans.

## Where things live

* **`@papercusp/testing-shell`** — `TestingShell` (left-rail + panel host),
  `DomainTestPanel`, the `universalDomains` registry (Built-in/Universal tier,
  pure data — `src/registry/universal.ts`), and the `TestingDataSource`
  interface. The lib↔operator boundary *is* the universal↔Papercusp boundary.
* **operator** — `packages/operator-core/lib/testing-domains-registry.ts`
  (`papercuspRegistry`, \~30 Papercusp domains, composed with the lib's universal
  tier into `adminRegistry`), the harness `/testing/*` routes, and the `/adv`
  `HarnessTestsView` + `AcceptancePanel`.

The harness Tests tab is an `/adv` dock panel (`adv:tests`), not a
`HarnessDashboard` tab — that monolith was deleted by the `/adv` migration.
