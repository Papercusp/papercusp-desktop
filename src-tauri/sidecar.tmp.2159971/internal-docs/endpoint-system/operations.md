# Operations
URL: /internal/docs/endpoint-system/operations

Day-to-day workflows for the endpoint system. Hot reload, host refresh, common failure modes, and when to stop and ask.

> **Webapp retired (2026-05-14).** Any `localhost:3055` or `localhost:3070` URL on this page is only reachable while the **Tauri dev shell** is running. Start it with `cd papercusp-desktop && npm run dev`.

## After every plugin manifest or handler edit

```bash
curl -X POST http://localhost:3055/api/plugins/host/refresh
```

The projection registry is module-level state. HMR is unreliable for it. If you don't refresh after editing a plugin, you're testing stale code and you won't know.

The endpoint returns the host status:

```json
{
  "ok": true,
  "status": {
    "loaded": 15,
    "errors": 2,
    "plugins": [...],
    "loadErrors": [...]
  }
}
```

`errors=2` is the steady-state baseline (two unrelated pre-existing manifest issues). If you push a change and `errors` goes up, your edit broke discovery — read the `loadErrors[]` list.

## Where the registry lives

Three module-level Maps in `libs/generic/tooldef/src/tool-projection.ts`:

* `REGISTRY` — keyed by `mcp:<name>` or `http:<path>`, value is the full `ProjectedTool`
* `BY_MCP_NAME` — `Map<string, ProjectedTool>` for `tools/call` lookups
* `BY_HTTP_PATH` — `Map<string, ProjectedTool>` for the catch-all routes

These are populated at startup as a side effect of:

1. Importing `@papercusp/agent-mcp` — every `defineTool(...)` auto-registers into the registry (PR 0c.D extension).
2. The first call to `getPluginHost()` — runs `loadPlugins({ projectDir, harnessSlugs, globalPluginsDir })`, then `registerPluginTools(loaded)` walks each plugin's `toolDefinitions[]` and calls `registerProjectedTool` per entry.

`registerPluginTools` is **idempotent** for same-plugin re-registration: it calls `unregisterProjectedToolsForPlugin(pluginName)` first, then re-registers. This means `/api/plugins/host/refresh` works correctly without producing collision errors. **Cross-plugin collisions still throw** — two different plugins claiming the same MCP name fails with `ToolRegistrationError`.

## Discovery sources

`loadPlugins` searches in this order:

1. `<projectDir>/plugins/<name>/` — for in-repo bundled plugins. The operator wires this via `findBundledPluginsParent()` in `packages/operator-core/lib/plugin-host-runtime.ts`.
2. `~/.papercusp/harnesses/<slug>/plugins/<name>/` — per-harness plugins.
3. `~/.papercusp/global-plugins/<name>/` — globally installed plugins.

Dedupe by `plugin.name` with priority `project > harness > global`. So if you have both `libs/papercusp/plugins/repomix/` and `~/.papercusp/global-plugins/repomix/`, the in-repo one wins.

This is why you don't need to symlink plugins into `~/.papercusp/global-plugins/` during development. Just put them in `libs/papercusp/plugins/` and they'll be discovered.

## Hot-reload watcher

`watchPluginsForReload` (in `plugin-host-runtime.ts`) sets up a debounced fs.watch over the global-plugins directory. Triggers on changes to `papercusp.json`, `index.{js,mjs,ts}`, or `dist/index.js`. On a hit, it calls `_resetPluginHostForTests()` which clears the host cache; next request to the host re-runs discovery.

It's gated behind `PAPERCUSP_DEV_PLUGIN_WATCH=1`. Off by default because filesystem-watch overhead is unwanted on shared hosts. Turn it on for plugin development if you don't want to keep curling `/api/plugins/host/refresh`.

## Migrations don't run on the system PG

The embedded-postgres-server has a migration runner that walks `libs/papercusp/libs/db/sql/*.sql` on boot and applies missing files via `harness_shared.schema_migrations`. The system PG (`localhost:5432`) does not — there's no boot hook.

Every new SQL file requires manual application:

```bash
PGPASSWORD=harness_admin_pwd psql -h localhost -p 5432 -U harness_admin -d papercusp \
  -f libs/papercusp/libs/db/sql/048-my-table.sql

PGPASSWORD=harness_admin_pwd psql -h localhost -p 5432 -U harness_admin -d papercusp \
  -tAc "SELECT to_regclass('harness_shared.my_table')"
```

This bites every time. If your tool depends on a table that doesn't exist, the queries throw, the dispatcher catches and continues, the tool returns 200 with `output` text — and your quota tracking + telemetry are silently dead until you apply the migration. **Verify with `to_regclass` before testing the tool.**

## Common failure modes

### Tool returns 404 `unknown_tool` after a manifest edit

You forgot to refresh. `curl -X POST /api/plugins/host/refresh`.

Or HMR wiped the registry. Same fix.

### Tool returns 200 but `tool_invocations` is empty

Two likely causes:

1. **Workspace GUC not set.** The HOST\_EXTRAS.deps insert calls `SELECT set_config('app.workspace_id', $1, true)` — but if the request didn't include `?workspace=<id>`, `ctx.workspaceId` is `undefined`, and the insert silently fails. Make sure the test request has the workspace param.
2. **Migration not applied.** The table doesn't exist. See above.

### Tool returns 500 `handler_error`

The function threw an unhandled error. Check the `tool_invocations.error_message` for that call. If the message is `spawn <bin> ENOENT`, the binary isn't installed on the machine running the operator (e.g. `code2prompt` not present in dev). Either install it or skip that tool.

### Tool returns 401 `unauthorized` for a tool you expected to work without bearer

You wrote a built-in (`defineTool(...)`) when you needed a plugin. Built-ins require `ctx.principal`; agents over MCP only have URL spawn context, no bearer. Move the tool to `libs/papercusp/plugins/<name>/`.

### `/api/plugins/host/refresh` shows error count > 2

Something in your manifest broke discovery. The response body has `loadErrors[]` — read it.

Common causes: `name` collision with an existing tool from a different plugin; `expose.mcp.name` missing the namespace separator (must contain `.` or `:`); orphan handler (manifest declares `tools[].name = 'foo'` but `index.ts` has no `tools.foo` export).

### Tool works on MCP but returns "ctx.X is unset" on HTTP

The HTTP catch-all needs the same `ctx.spawn` / `ctx.secret` / `ctx.projectDir` resolvers as MCP. Check that the plugins catch-all (`packages/operator-core/lib/endpoint-route/routes/plugins/catchall.ts`) builds its `HttpToolHostExtras` with `spawn` (`pluginSpawnImpl`), `secret` (`secretImpl`/`makeSecretResolver`), and `resolveHarnessPaths`. If it doesn't, that's a regression of audit-2/3 fixes.

### Tool works on dev but agents in spawned subprocesses don't see it

Check the orchestrator's `.mcp.json` URL. In dev (`NODE_ENV=development`) it should point at `http://localhost:3055/api/sse`; in prod, `http://localhost:3070/api/sse`. Override with `PAPERCUSP_OPERATOR_URL` if neither default applies.

### Search-provider env vars don't reach spawned agents

The orchestrator's `invoke()` path (`libs/papercusp/packages/orchestrator/src/invoke.ts`) decrypts search-provider keys from PG via `buildSearchProviderSpawnEnv` (`spawn-env-from-pg.ts`) and attaches them to `InvokeContext.extraSpawnEnv`. They land in every `invoke()` call's spawn env.

The operator harness-launch path does this independently: `packages/operator-core/lib/harness-launch.ts` calls `buildSpawnEnv` from `packages/operator-core/lib/search-provider-credentials.ts`. Both paths are wired; if a worker doesn't see `TAVILY_API_KEY` etc., the keys aren't in PG (check `harness_shared.operator_search_provider_credentials`) or the encryption key is missing (`~/.papercusp/db-encryption-key`).

## Spawn-signing admin endpoints

The HMAC signing scheme (see [Spawn-URL signing](/internal/docs/endpoint-system/spawn-signing)) ships with two loopback + superuser-bearer-gated admin routes for incident response and observability.

### Rotate the signing key

```bash
TOKEN=$(cat ~/.papercusp/superuser-token)
curl -X POST http://localhost:3070/api/admin/spawn-signing/rotate \
  -H "Authorization: Bearer $TOKEN"
```

Rotates the PG row **and** bumps the operator's in-process cache. Every in-flight signed URL fails its next call with `invalid_signature`. The orchestrator must re-spawn affected workers. Wrapper script: `bun run rotate:spawn-key`.

### Read the verification audit log

```bash
TOKEN=$(cat ~/.papercusp/superuser-token)
curl "http://localhost:3070/api/admin/spawn-signing/failures?limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

Query params: `limit` (max 1000, default 100), `since` (ISO timestamp), `reason` (filter). Returns `{ rows, summary: { byReason, window } }`.

A non-zero rate of `invalid_signature` outside explicit test runs is a real signal. Correlate `claimed_spawn` with orchestrator spawn IDs to identify the culprit.

## When to stop and ask

You should stop and ask before doing any of these:

* The component you want to wrap doesn't fit one of the four shipped plugin shapes (subprocess single-tool, HTTP+optional-secret, subprocess multi-tool, HTTP+required-secret-with-schema). Don't invent a fifth shape; the function-as-truth design doc lists which patterns are blessed.
* You want to extend the manifest contract with a new field. Each existing field corresponds to a dispatcher behavior; adding one is an architecture decision, not a cleanup.
* You hit one of the known open issues and need to work around it. The workaround usually masks a real bug — better to surface it and get the framework fix.
* The handler signature you'd want isn't `(input, ctx) => ToolResult`. The framework can't accommodate exotic shapes. If you want a callback-based contract, a multi-response stream, or anything else non-request/response, it doesn't belong here.
* You're tempted to delete a legacy `app/api/agent-mcp/*/route.ts` route that the dashboard fetches from. **Always grep for UI callers first.** The same JSON is now served at `/api/plugins/<plugin>/<tool>`; UI can switch URLs in the same PR. Delete only when zero UI callers remain.

## Per-tool migration checklist

When you're moving an existing route to the endpoint system, run through this list. Each step is mandatory; skip any and you ship a broken tool:

1. Grep for UI callers of the legacy route. Decide replace-with-redirect or full-delete.
2. If new PG schema, write the SQL file in `libs/papercusp/libs/db/sql/` and apply it manually.
3. Write the typed function with no transport awareness.
4. Write the manifest entry. JSON Schema directly. No `zodToJsonSchema`.
5. `curl` the HTTP transport. Verify status code + body shape.
6. `curl` the MCP transport. Verify the same.
7. `psql` the telemetry row. Verify `status='ok'` and `app.workspace_id` was set.
8. Quota smoke test: fire perChunk+1 → second is 429.
9. Role gate smoke test: wrong role → 403.
10. `curl /api/plugins/host/refresh`. Confirm error count unchanged.
11. Delete the legacy route in the same commit (only if step 1 said zero UI callers).
12. Submodule commit first if you touched `libs/papercusp/`, then bump the parent's submodule pointer in a second commit.

## Per-turn commit discipline

When you're working across the operator app and the `libs/papercusp/` submodule:

* Commit the submodule first.
* Bump the parent's submodule pointer in a second commit.

Otherwise the parent commit references a submodule SHA that isn't pushed and the next agent sees a broken checkout. This is observed-from-experience guidance; multiple agents have shipped half-broken trees by inverting the order.
