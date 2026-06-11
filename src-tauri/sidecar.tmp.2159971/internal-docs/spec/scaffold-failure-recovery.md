# Scaffold failure recovery
URL: /internal/docs/spec/scaffold-failure-recovery

Runbook for partial scaffold failures (timeout, init failed, register failed). How to clean up and retry.

> **Webapp retired (2026-05-14).** Any `localhost:3055` or `localhost:3070` URL on this page is only reachable while the **Tauri dev shell** is running. Start it with `cd papercusp-desktop && npm run dev`.

`scaffold_harness` is the most complex executor verb (`doScaffoldHarness` in `packages/operator-core/lib/execute-action.ts`) — it shells out to `papercusp init`, writes `.papercusp/config.json`, scaffolds a PG schema, and registers the token. Any of these can fail mid-flight.

> **Token store changed.** The per-harness `config_token` table was retired (migration 121). `harness_shared.token_index` is now the single source of truth for bearer→slug auth; the recovery SQL below reflects that. The PG schema is provisioned by the inline `scaffoldHarnessSchema()` (`packages/operator-core/lib/scaffold-harness-schema.ts`) as views over `harness_shared.*_consolidated`, not by a bash script.

## Failure modes

### 1. `papercusp init` exited non-zero

* **Symptom**: `executeAction` returns `500 internal { detail: "papercusp init failed: ..." }`.
* **State**: any partial directory under `PAPERCUSP_PROJECTS_ROOT/<slug>` is rolled back automatically. No registry row, no schema.
* **Recovery**: re-run with same `actionId` (idempotency cache won't have it, since 500 errors aren't cached). Or pick a different slug.

### 2. 5-minute timeout

* **Symptom**: `executeAction` returns `500 internal { detail: "papercusp init timeout: ...", timeout: true }`.
* **State**: SIGTERM → SIGKILL fired. Partial directory rolled back. Same as case 1.
* **Recovery**: same as case 1. If the install is genuinely too slow (heavy `npm install`, `git clone`), re-publish the template with smaller dependencies, or move heavy work to the role's first iteration.

### 3. config.json merge failed

* **Symptom**: `internal { detail: "failed to write .papercusp/config.json: ..." }`.
* **State**: `papercusp init` succeeded, dir exists, but `.papercusp/config.json` (which carries the `harness_token`, `parent_slug`, `slug`) may be partially written. Token + schema NOT yet registered.
* **Recovery**: drop the partial state, then retry with a fresh `actionId`. The harness registry lives in PG (`harness_shared.harness_registry`, migration 025) — there is no home-directory `registry.json` to edit; the DELETE endpoint removes the registry row, and the default project dir is `~/.papercusp/projects/<slug>`.
  ```bash
  curl -X DELETE http://localhost:3055/api/harness/projects/<slug>
  rm -rf ~/.papercusp/projects/<slug>
  ```

### 4. Schema scaffold failed

* **Symptom**: `internal { detail: "schema scaffold failed: ..." }`.
* **State**: dir exists, config.json has token and parent\_slug, but the per-harness PG schema is partial or missing.
* **Recovery**: `scaffoldHarnessSchema()` is idempotent — re-running the scaffold (e.g. via a fresh `actionId` retry, or by calling the inline provisioner) re-creates the views cleanly. To re-mirror the token afterward:
  ```bash
  TOKEN=$(jq -r .harness_token <projectPath>/.papercusp/config.json)
  PGUSER=harness_admin psql -d papercusp -c \
    "INSERT INTO harness_shared.token_index (token, kind, harness_slug, workspace_id)
       VALUES ('$TOKEN', 'harness', '<slug>', 'default') ON CONFLICT (token) DO NOTHING;"
  ```

### 5. Token-index insert failed

* **Symptom**: surfaces as a generic `internal` (the token-index INSERT is unguarded; on failure the route's outer catch returns `500 internal`).
* **State**: harness exists on disk + registry, schema exists, but the token isn't in `harness_shared.token_index` → harness can't authenticate its own outbound `executeAction` calls.
* **Recovery**: the "re-mirror the token" SQL from case 4.

## Slug collisions

If `scaffold_harness` returns `409 slug_already_in_use`:

* A `harness_shared.token_index` row exists for that slug, or the on-disk path `~/.papercusp/projects/<slug>` already exists.
* Pick a different slug, OR delete the conflicting state:
  ```bash
  curl -X DELETE http://localhost:3055/api/harness/projects/<slug>
  rm -rf <projectPath>
  PGUSER=harness_admin psql -d papercusp -c "
    DELETE FROM harness_shared.token_index WHERE harness_slug = '<slug>';
    -- schema name sanitizes hyphens→underscores (harnessSchemaName), e.g. my-harness → harness_my_harness
    DROP SCHEMA IF EXISTS harness_<slug_underscored> CASCADE;
  "
  ```

## Idempotency replay

If you retry with the **same `actionId`** and the prior call succeeded, you'll get the cached `{ ok: true, ...result, cached: true }` even if the side effect was deleted out-of-band. Use a fresh `actionId` if you actually want to re-execute.

5xx errors (including the failure modes above) are NOT cached, so retries with the same `actionId` re-execute the verb.

## Bulk reset (for development)

```bash
PGUSER=postgres_app PGPASSWORD=postgres psql -d papercusp <<SQL
DELETE FROM harness_shared.token_index WHERE harness_slug LIKE 'smoke-%';
DELETE FROM harness_shared.projects WHERE slug LIKE 'smoke-%';
SQL
rm -rf /home/marsh-office/.papercusp/projects/smoke-* \
       /home/marsh-office/.papercusp-workspaces/default/.papercusp/projects/smoke-*
```

For schema drops: enumerate `\dn harness_*` in psql and drop the offending ones with `DROP SCHEMA ... CASCADE`.
