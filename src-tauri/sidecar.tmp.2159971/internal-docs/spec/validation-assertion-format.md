# Validation assertion format (VAL-*)
URL: /internal/docs/spec/validation-assertion-format

Inline format for embedding behavioral validation assertions directly inside plan items. Replaces the standalone validation-contract.md file.

import { Aside } from '@astrojs/starlight/components';

Validation assertions define the exact **pass/fail criteria** a validator
agent checks when certifying a feature. In the new plan-central model,
assertions live **inline inside the owning plan item** rather than in a
separate `validation-contract.md` file. This spec defines the format, ID
scheme, and tooling contract.

The `validation-contract.md` write path is deprecated. Existing
assertions in that file remain valid until their owning features are
re-promoted through a plan with inline VAL-\* items. No automated
migration.

## Assertion syntax

An assertion is a **nested bullet block** appended to a plan item line.
The item itself stays on its own line; the assertion(s) follow as
indented sub-bullets:

```markdown
- **P-007** `todo` Implement CSV export for the report grid.
  - **[VAL-my-plan-2026-05-26-001]**
    - **Verify:** `GET /api/reports/:id/csv` returns `Content-Type: text/csv`
      with a non-empty body when the report has at least one row.
    - **Evidence:** `tests/api/reports.csv.test.ts` — `GET /api/reports/:id/csv`
    - **Status:** `todo`
  - **[VAL-my-plan-2026-05-26-002]**
    - **Verify:** The exported CSV contains a header row matching the visible
      column order in the UI.
    - **Evidence:** `tests/api/reports.csv.test.ts` — `header row matches`
    - **Status:** `todo`
  - **[VAL-my-plan-2026-05-26-003]**
    - **Verify:** The "Export" button copy reads "Download CSV", not "Export".
    - **Evidence:** Visual — design-spec match, no automated test.
    - **Status:** `todo`
    - **RequiresTest:** `false`
```

### Sub-bullet fields

| Field           | Required | Meaning                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Verify:`       | Yes      | One or two sentences stating the observable behavior to check. Falsifiable — a validator must be able to write a test that fails before and passes after.                                                                                                                                                                                                                                |
| `Evidence:`     | Yes      | Where the check lives: file path + test name / selector / curl command. Enough for the validator to locate or recreate the check.                                                                                                                                                                                                                                                        |
| `Status:`       | Yes      | `todo` / `validating` / `passed` / `failed`. Updated by the validator after each run.                                                                                                                                                                                                                                                                                                    |
| `RequiresTest:` | No       | `false` exempts this VAL from the test gate — non-testable claims (copy, design-spec match, judgement). The staging orchestrator's `NEXT_TESTER` gate and the validator's test gate skip exempt VALs; the validator still verifies them by inspection. Defaults to `true` (a claim needs a passing covering test). Stored on `harness_plan_assertions.requires_test` by `plans:promote`. |

### Assertion ID scheme

```
VAL-{plan-slug}-{NNN}
```

* **`plan-slug`** — the filename stem of the owning plan (e.g.
  `my-plan-2026-05-26`). Anchors the assertion to its plan; avoids
  collisions across harnesses.
* **`{NNN}`** — 3-digit zero-padded sequence, unique within the plan.
  Allocated by `plans:promote` during feature extraction (see
  [Tooling](#tooling)).

IDs are **globally unique within a harness** because the plan-slug
prefix makes them self-segregating. Two plans in the same harness can
each have `VAL-…-001` without collision.

## Status lifecycle

```
todo → validating → passed
               ↓
            failed → (worker retries) → validating → passed
```

* `todo` — assertion written; no validation run yet.
* `validating` — validator is actively checking this cycle.
* `passed` — validator confirmed; feature certified on this assertion.
* `failed` — validator's last run found a violation; validator writes
  evidence to the `Evidence:` line and leaves a note in the issue queue.

The validator updates `Status:` in-place via `plans:set-content` (or
the assertion endpoint described below). The scoper never changes
`Status:`; it only writes `todo` at creation time.

## Tooling

### `plans:promote` extraction

When `plans:promote` converts a plan item into a harness feature:

1. It scans the item's sub-bullets for `[VAL-…-NNN]` blocks.
2. Each block is stored in `harness_plan_assertions`
   (`plan_slug`, `item_id`, `val_id`, `verify_text`, `evidence_text`,
   `status`).
3. The assertion IDs are written into `feature.claims` (string array).
4. The plan item's VAL-\* blocks are not removed from the plan — they
   remain as the source-of-truth display. The PG row is a projection.

### Assertion endpoint

```
GET /api/harness/:slug/assertion/:valId
```

Returns:

```json
{
  "val_id": "VAL-my-plan-2026-05-26-001",
  "verify_text": "…",
  "evidence_text": "…",
  "status": "todo",
  "plan_slug": "my-plan-2026-05-26",
  "item_id": "P-007"
}
```

Returns `404` if not found — **no fallback** to `validation-contract.md`.
A 404 means the feature was not promoted from a plan with inline
assertions; the validator must fail with:

> `assertion not found — feature must be promoted from a plan with inline VAL-* assertions`

### Validator read flow

```
for each claim_id in feature.claims:
  GET /api/harness/:slug/assertion/:claim_id
  → use verify_text as the check definition
  → write evidence, update status via plans:set-content
```

### Scoper write flow

The scoper writes VAL-\* bullets directly into the plan item text when
creating or updating a feature chunk in the plan. It does **not** call
any endpoint — writing to the plan file is the canonical act. The PG
projection happens at `plans:promote` time.

```markdown
- **P-NNN** `todo` <feature description>
  - **[VAL-{plan-slug}-{NNN}]**
    - **Verify:** <falsifiable behavioral check>
    - **Evidence:** <test file and selector>
    - **Status:** `todo`
```

Allocation rule: the scoper must scan the existing plan for the
highest existing `{NNN}` for this plan-slug and increment by 1. The
`plans:promote` tool validates uniqueness at extraction time and
rejects duplicate IDs with an error.

## Rules

* **One assertion = one falsifiable check.** Don't bundle two
  conditions into one VAL-\* block. Split them.
* **Evidence is a locator, not a description.** It must be specific
  enough for a fresh-context validator to find or recreate the check.
  Vague evidence (`"the test suite"`) is rejected by lint.
* **No inline VAL-* = no validation.*\* A feature without claims
  cannot be validated and will remain `validating` forever. The
  scoper is responsible for always writing at least one assertion per
  chunk.
* **Assertions are immutable after `passed`.** A `passed` assertion
  may not be edited. To change the check, write a new VAL-\* block
  and deprecate the old one (mark `Status: dropped` and add a note).

## Relation to the plan format spec

See [Plan format](/internal/docs/spec/plan-format) for the full plan
item syntax. VAL-\* sub-bullets are an extension of the standard item
line — the plan parser ignores them (they're free prose sub-bullets),
but `plans:promote` and `plans:lint` understand the structure.

`plans:lint` will gain a `missing_assertions` warning when an item has
`effectiveStatus: todo` and no VAL-\* sub-bullets once P-019 ships.
