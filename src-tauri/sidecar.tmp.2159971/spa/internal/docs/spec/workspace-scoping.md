# Workspace scoping (PG-enforced)
URL: /internal/docs/spec/workspace-scoping

Workspaces become a Postgres-enforced scoping key on `harness_shared.*` via session GUC + RLS. Filesystem-only workspace separation is replaced with row-level enforcement.

import { Aside } from '@astrojs/starlight/components';

**Largely implemented.** The pieces this amendment specifies now exist: the
`app.workspace_id` session GUC is set across the operator (`route-workspace.ts`,
`execute-action.ts`, …), workspace-scoped `harness_shared.*` tables carry a
`workspace_id` column with RLS policies (defined in migrations), and the backfill
script lives at `libs/papercusp/libs/db/scripts/backfill-workspace-id.ts`. The
design narrative below is preserved; only the run-command form is corrected (it's
a `tsx`-run `.ts`, not a `.mjs`).

## Why

The deployed substrate is one Postgres database with per-harness schemas (`harness_<slug>`) and a cross-cutting `harness_shared` schema. The workspace concept (separate directories under `~/.papercusp-workspaces/<id>/`, registry-tracked) is enforced at the **filesystem** layer only.

This means rows in `harness_shared.projects`, `harness_shared.audit_log`, `harness_shared.harness_features_consolidated`, etc. from different workspaces are commingled in the same tables. Any code path reading those tables sees rows from every workspace. Any future plugin or agent that reads them inherits that leak.

This amendment closes the leak by making workspace a Postgres-enforced scoping key.

This is a load-bearing fix. Until it lands, any read against `harness_shared.*` (Tier 3 REST endpoints, future Agent MCP tools, plugin-authored queries) sees cross-workspace data.

## Scope

In scope:

* Add `workspace_id` column to every `harness_shared.*` table that spans workspaces.
* Per-request session GUC (`app.workspace_id`) set inside a `transaction()`.
* RLS policies on every workspace-scoped table.
* Migration script that backfills `workspace_id` from the on-disk workspace registry and is **idempotent**, **dry-runnable**, and **loud-fails on indeterminate rows** (no default-tag).
* Retrofit existing Tier 3 REST endpoints and substrate services to use the GUC contract.
* Hindsight bank derivation: `workspace → company_id` registry config; bank ID auth-derived.

Out of scope:

* Per-harness schemas (`harness_<slug>`). These are already isolated by name; reads route through DI services that resolve workspace from session.
* Single-workspace desktop modes. The default desktop backend (`embedded-postgres`) and the legacy backend (`pglite`) each run their own per-workspace data directory; both are isolated by process + data dir, so the GUC contract is a no-op there but does not interfere.
* Cross-workspace queries. Not exposed through any v1 surface.

## Schema

Add to every workspace-scoped table:

```sql
ALTER TABLE harness_shared.<table>
  ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS <table>_workspace_idx
  ON harness_shared.<table>(workspace_id);
```

Tables in scope (initial enumeration):

* `harness_shared.projects`
* `harness_shared.audit_log`
* `harness_shared.harness_features_consolidated`
* `harness_shared.plugin_enables`
* `harness_shared.plugin_configs`
* `harness_shared.goals`
* `harness_shared.pending_events`
* `harness_shared.routines`
* `harness_shared.project_spec_revisions`
* `harness_shared.token_index`

Default `''` on the column lets the migration land additively before backfill; the migration script populates real values, after which `''` is rejected.

## Session GUC contract

Every read or write against a workspace-scoped table must execute inside a transaction that has `app.workspace_id` set:

```ts
await db.transaction(async (tx) => {
  await tx.execute(sql`SET LOCAL app.workspace_id = ${workspaceId}`);
  // ... queries via tx ...
});
```

`SET LOCAL` is reset at transaction end. **Bare-pool checkouts are not allowed for workspace-scoped queries** — a checkout without the GUC bypasses RLS silently. This is the canonical Drizzle/Knex RLS regression. Enforcement:

1. **Tx-only ESLint rule** on the Agent-MCP package and substrate service code paths: bare-`db.X()` calls inside a `transaction()` callback are flagged. The callback must use the `tx` parameter.
2. **CI cross-workspace probe**: programmatic test authenticates as workspace B, attempts to read workspace A's data through every endpoint, asserts denial.

## RLS policies

For every workspace-scoped table:

```sql
ALTER TABLE harness_shared.<table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY <table>_workspace_isolation
  ON harness_shared.<table>
  USING (workspace_id = current_setting('app.workspace_id', true))
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true));
```

The `harness_admin` role bypasses RLS for migrations and tooling; application code uses `harness_app` which is subject to it.

## Migration script

Phase A deliverable. Lives at `libs/papercusp/libs/db/scripts/backfill-workspace-id.ts`.

Properties:

* **Walks** the on-disk workspace registry at `~/.papercusp-workspaces/registry.json` plus per-workspace harness lists at `~/.papercusp-workspaces/<id>/.papercusp/harnesses/`.
* **Backfills** `workspace_id` on `harness_shared.projects` from the registry's filesystem mapping.
* **Cascades** to every dependent table (matching by `slug`/`harness_slug`/`project_id` joins back to `projects`).
* **Idempotent**: rerunning produces no further writes.
* **Dry-runnable**: prints intended changes without applying; review before commit.
* **Loud-fails** on rows whose workspace cannot be determined; does not default-tag. Failed rows are reported with their primary keys and the reason.

Operator runs the script via `tsx libs/db/scripts/backfill-workspace-id.ts --dry-run` first, reviews the output, then re-runs with `--apply`. After `--apply` succeeds, the column default is altered from `''` to RAISE on insert (a CHECK constraint), enforcing future correctness.

## Hindsight bank derivation

Hindsight banks are `paperclip::<COMPANY_ID>`, a global namespace. The mapping is added to the workspace registry:

```json
{
  "current": "default",
  "workspaces": [
    {
      "id": "default",
      "name": "Default",
      "createdAt": 1777581445411,
      "companyId": "abc-123-def"
    }
  ]
}
```

`hindsight:recall` derives the bank from the calling principal's workspace's `companyId`. Body-supplied scope is rejected.

If `companyId` is null, `hindsight:recall` returns `degraded: true, degradedReasons: ["hindsight_not_configured_for_workspace"]` with empty results. It does not throw.

v1 enforces 1:1 — workspace registry rejects multi-company configuration.

## Observable invariants (post-migration)

These hold by construction once the migration completes:

1. Every row in every workspace-scoped table has a non-empty `workspace_id`.
2. No SELECT/UPDATE/DELETE against a workspace-scoped table returns or affects rows from another workspace, regardless of the query shape.
3. A query executed without `app.workspace_id` set returns zero rows (RLS predicate fails on null).
4. The CI cross-workspace probe asserts (2) for every existing endpoint on every PR.

## Threats it addresses

* **Cross-workspace data leak.** Today's dominant failure mode. Closed by RLS.
* **Future plugin/agent leak.** A plugin querying `harness_shared.audit_log` directly inherits the same RLS. There is no surface that bypasses the policy.
* **Hindsight cross-bank read.** Auth-derived bank ID prevents an agent in workspace A from recalling memories scoped to workspace B's company.

## Threats it does not address

* **A compromised `harness_admin` role.** Admin bypasses RLS by design (migrations).
* **A leaked workspace bearer token.** Token holder can act as that workspace; recovery is workspace-level (analogous to the per-harness recovery in `auth-and-identity`).
* **Single-workspace desktop modes.** Both the default `embedded-postgres` backend and the legacy `pglite` backend run one PG instance per workspace, so RLS is redundant but not harmful.

## Compatibility

* Adding the column with a default is non-breaking.
* RLS policies are added in a follow-up migration after backfill completes.
* Existing reads continue to work during the transition because `harness_admin` bypasses RLS; application code (`harness_app`) is cut over only after backfill is complete and verified.
