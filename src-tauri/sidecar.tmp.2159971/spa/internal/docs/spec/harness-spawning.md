# Harness spawning
URL: /internal/docs/spec/harness-spawning

How harnesses spawn child harnesses, how parent_slug works, and how completion reporting flows back.

import { Aside } from '@astrojs/starlight/components';

**Implemented.** The `scaffold_harness` verb described here is live in
`packages/operator-core/lib/execute-action.ts` (`doScaffoldHarness`), behind
`POST /api/admin/execute-action`
(`packages/operator-core/lib/endpoint-route/routes/admin/execute-action.ts`).
Two design details below have since changed and are corrected inline: the
per-harness `config_token` table was **retired** (migration 121) — `harness_shared.token_index`
is now the single source of truth for bearer→slug resolution — and the schema is
provisioned by the inline `scaffoldHarnessSchema()`
(`packages/operator-core/lib/scaffold-harness-schema.ts`), not a bash script.
The newer agent-authorable path to a harness is the `harness:create` MCP tool
(blueprint-instantiated) — see [spawning-harnesses](/internal/docs/spec/spawning-harnesses).

Harness spawning is a substrate feature: any harness whose role config grants `scaffold_harness` in `allowedActions` can call the `/api/admin/execute-action` endpoint to materialize a child harness from a marketplace template.

## The verb

```ts
{ "op": "scaffold_harness",
  "projectSlug": "<unique-slug>",
  "template": "<spawnable-template-name>",
  "spec":  "<initial SPEC.md content>" }
```

`parent_slug` is **server-derived from the bearer token**, never accepted from the request body. This makes the parent/child relationship cryptographically sealed — a harness cannot claim someone else as its parent or claim parentage of a sibling.

## What happens on success

1. Cycle/depth guard: rejects a self-spawn or a request that would cycle or exceed `PAPERCUSP_MAX_SPAWN_DEPTH` (default 8) by walking the `parent_slug` chain (`validation_error`).
2. Executor verifies the `template` is in `GET /api/marketplace/spawnable` (rejects with 400 `template_not_spawnable` otherwise).
3. Slug uniqueness check against `harness_shared.token_index` (the authoritative harness-slug store) and the on-disk path (409 `slug_already_in_use` on collision).
4. Shells out to `papercusp init <slug> --from <template>` (default target `~/.papercusp/projects/<slug>`, overridable via `PAPERCUSP_PROJECTS_ROOT`) with a 5-minute timeout. The `spec` arg is required for validation but is not itself written to disk by the executor — the template's `init` flow owns `SPEC.md`.
5. Generates a 256-bit `harness_token`, writes it to `<projectDir>/.papercusp/config.json` (mode 0600), and merges in `parent_slug = <derivedCallingHarness>` and `slug`.
6. Calls the inline `scaffoldHarnessSchema(slug)` to provision the per-harness PG schema. That schema now holds **only auto-updatable views** over the slug-keyed `harness_shared.*_consolidated` tables (messages, supervisor\_notes, executed\_actions, harness\_features, …) — there are no physical per-harness tables, and the per-harness `config_token` was retired (migration 121).
7. Inserts the token into `harness_shared.token_index` (workspace-owned; the single source of truth for bearer→slug resolution).
8. Updates `harness_shared.projects.parent_slug` for cross-harness lineage queries.

## Failure modes & rollback

* **`papercusp init` exits non-zero**: rollback any partial directory creation. Returns `internal` with stderr.
* **5-minute timeout**: SIGTERM → SIGKILL the CLI process. Same rollback. Response includes `{ timeout: true }`.
* **Schema scaffold fails**: harness exists on disk + in file registry, but partial PG state. Returns `internal` with `detail: "schema scaffold failed: …"`. `scaffoldHarnessSchema` is idempotent, so a fresh-`actionId` retry re-runs it cleanly.
* **Token-index insert fails**: harness usable for reads but cannot authenticate its own outbound `executeAction` calls (its token isn't in `harness_shared.token_index`). Surfaces as `internal`.

## Authoring a spawning harness

Set `roles.<role>.allowedActions` to include `scaffold_harness`:

```json
{
  "harness_kind": "org",
  "roles": {
    "director": {
      "allowedActions": ["spinup_project", "scaffold_harness", "send_message"]
    }
  }
}
```

The director's prompt sees the available templates listed in the Tier 3 capabilities section of its substrate context (sourced from `GET /api/marketplace/spawnable`).

See: [spawning-harnesses](/internal/docs/spec/spawning-harnesses), [spawnable-templates](/internal/docs/spec/spawnable-templates), [auth-and-identity](/internal/docs/spec/auth-and-identity).
