# Writing a tool
URL: /internal/docs/endpoint-system/writing-a-tool

Recipe for writing a tool end-to-end — picking the right shape, declaring the manifest entry, and verifying both transports.

> **Webapp retired (2026-05-14).** Any `localhost:3055` or `localhost:3070` URL on this page is only reachable while the **Tauri dev shell** is running. Start it with `cd papercusp-desktop && npm run dev`.

## The two shapes

Before writing any code, decide which shape your tool needs:

### Built-in (`packages/operator-core/lib/agent-tools/**`)

Use when **the tool needs a real authenticated principal**. Bearer token in the request → resolved to a principal with workspace ID and a capability set. The wrapper throws `UnauthorizedToolError` (HTTP 401) if no principal is present.

* Most built-ins live in `packages/operator-core/lib/agent-tools/<group>/<verb>.ts`; the smaller read-side set lives in `packages/agent-mcp/src/tools/**`.
* Used today by: dashboard-only operations (settings reads/writes, credentials, marketplace tokens, budget, preferences)
* **Agents cannot call built-ins** today — agents pass URL spawn context, not a bearer token. If you make a tool a built-in, the dashboard sees it; agents do not.
* Auto-projected by `defineTool({ name, capability, args, handler })`. No manifest, no plugin folder.

### Plugin (`libs/papercusp/plugins/<name>/`)

Use when **agents must be able to call the tool** from their spawn URL. No principal required; gating is via role allowlist + per-window quota. Trust comes from the orchestrator's URL-baking guarantee.

* Used today by: every plugin in `libs/papercusp/plugins/` — repomix, fetch-plus, code2prompt, firecrawl-bridge
* Manifest lives in `papercusp.json`; handlers in `index.ts`'s `tools` export.

### Decision rule

> *Will an agent in a spawn ever call this with just URL params?*
> If yes → plugin. If no → built-in.

If both — agent **and** dashboard — need it, plugin is correct. The dashboard can call the same `/api/plugins/<plugin>/<tool>` URL the agent does. Loopback trust is the same boundary either way.

## The 6-step recipe

Every new tool follows the same six steps. Skip any of them and you ship a broken tool.

### Step 0 — `set_config` discipline (if your tool reads/writes workspace-scoped PG tables)

Use this pattern. Always.

```ts
await sql.begin(async (tx) => {
  await tx.unsafe(`SELECT set_config('app.workspace_id', $1, true)`, [ctx.workspaceId]);
  // ...your queries...
});
```

**Never** write `SET LOCAL app.workspace_id = $1`. PG's `SET` command does not accept bind parameters; you'll get a silent `syntax error at or near "$1"` and your quota/telemetry will fail open.

### Step 1 — Write the function (typed, no transport awareness)

```ts
import type { ToolContext } from '@papercusp/plugin-sdk';

export async function fetchSomething(
  input: { url: string; depth?: number },
  ctx: ToolContext,
): Promise<ToolResult> {
  // No header reads. No Response objects. Cancel via ctx.signal.
  if (ctx.signal.aborted) throw new Error('cancelled');
  ctx.progress(10, 'starting');
  // ...
  return { content: [{ type: 'text', text: '...' }] };
}
```

What the `ctx` argument has:

* `workspaceId, harnessSlug, role, runId, spawnId` — URL spawn context. `runId` is always present for HTTP-projected calls (defaulted by the catch-all when no `?run=` is supplied) so the state-channel hooks below always install.
* `featureId?, chunkId?, parentSpawnId?` — optional spawn context
* `projectDir, stateDir` — resolved by the framework via `loadHarnessRegistry()`
* `log(msg)` — appends to run.log.jsonl with plugin attribution
* `signal` — `AbortSignal` for the dispatcher's timeout / cancellation
* `progress(pct, msg)` — alias over the typed-event channel; emits MCP `notifications/progress` (always) AND `notifications/papercusp/event` (always) on MCP, plus `event: progress` on HTTP SSE
* `emit(name, payload)` — typed event channel. Declare the vocab via `defineTool({ events: { ... } })`. See [Typed event streams](./transports.mdx#typed-event-streams).
* `askUser(spec)` — mid-run interactive prompt; blocks until the user submits/declines/cancels. Returns the validated user payload. Installed when `workspaceId + runId` are set. See [ctx.askUser](./ask-user.mdx).
* `publishState(snapshot)` — push the current tool state to the state-channel SSE. Installed when the tool declared `state: ZodType<S>` AND ctx has `workspaceId + runId`. Validated against the declared schema. See [state-shaped tools](./state-tools.mdx).
* `spawn?(bin, argv, opts)` — capability-gated subprocess
* `secret?(name)` — async secret resolver (env vars, encrypted PG)
* `principal?, tx?` — only set for built-in tools called with a bearer

### Step 2 — Write the manifest entry

For plugins, this goes in `libs/papercusp/plugins/<name>/papercusp.json`:

```json
{
  "name": "do_thing",
  "description": "One-sentence description. Lead with the verb. Mention what to use it instead of.",
  "inputSchema": {
    "type": "object",
    "properties": { "url": { "type": "string" } },
    "required": ["url"]
  },
  "capabilities": ["http:fetch:example.com"],
  "roles": ["worker", "architect"],
  "rolesQuota": { "worker": { "perChunk": 1 }, "architect": { "perRun": 5 } },
  "timeoutSec": 60,
  "guidance": {
    "when": "When the user asks you to <X>; pair with <Y> for the chained-list case.",
    "notWhen": "Not for <Z> — use <other_tool> instead.",
    "chaining": "After <prerequisite_tool> if you need its id; before <successor_tool>."
  }
}
```

Notes:

* **Write JSON Schema directly.** Do not reach for `zodToJsonSchema` — it returns `{}` against Zod 4. If you have a Zod schema, use Zod 4's built-in `z.toJSONSchema(schema)`.
* **`capabilities` is descriptive for plugin tools** today (used by tooling/Intel UI). Built-in tools have it enforced via the principal's capability set.
* **`roles` is enforced.** Workers use `perChunk` quotas (resets per chunk); everyone else uses `perRun` (resets per orchestrator run).
* **Reads usually don't need a quota.** Only set `rolesQuota` for: external API spend, PG write bursts, subprocess fan-out.
* **`timeoutSec` defaults to 60** if omitted. The dispatcher aborts via `ctx.signal` when it fires.
* **`guidance` is optional but strongly recommended.** Rendered into the [prompt-assembly tools catalog](/internal/docs/agents/prompt-assembly#section-2--tools-catalog) so every role that's allowed to call the tool gets the same `when` / `notWhen` / `chaining` framing without you having to write it in N role files. Built-in tools pass `guidance` to `defineTool({...})` as a sibling of `capability`. Omit it and the catalog falls back to description-only.

### Step 2.5 — If you need a new PG schema, apply the migration manually

The system PG (`:5432`) is **not wired into the embedded-pg migration runner**. New SQL files do not run automatically.

```bash
# 1. Write libs/papercusp/libs/db/sql/048-my-new-table.sql
# 2. Apply manually:
PGPASSWORD=harness_admin_pwd psql -h localhost -p 5432 -U harness_admin -d papercusp -f libs/papercusp/libs/db/sql/048-my-new-table.sql

# 3. Verify:
PGPASSWORD=harness_admin_pwd psql -h localhost -p 5432 -U harness_admin -d papercusp -tAc "SELECT to_regclass('harness_shared.my_new_table')"
```

Skip this and your tool will return 200 in dev because reads/writes silently fail.

### Step 3 — curl HTTP transport

```bash
curl -X POST 'http://localhost:3055/api/plugins/<plugin>/<tool>?harness=sheets&workspace=default&role=architect&run=R&spawn=S' \
  -H "Content-Type: application/json" \
  -d '{...}'
```

The seven URL params (`harness, workspace, role, feature, chunk, run, spawn`, plus optional `parent_spawn`) are how the framework knows your spawn context. Without them, you get partial context and several gates will fail open or closed unexpectedly.

### Step 4 — curl MCP transport

```bash
curl -X POST 'http://localhost:3055/api/mcp?harness=sheets&workspace=default&role=architect&run=R&spawn=S' \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<plugin>.<tool>","arguments":{...}}}'
```

The MCP `name` is dotted (`<plugin>.<tool>`) for plugin tools, colon-namespaced (`<scope>:<verb>`) for built-ins. Both are valid.

### Step 5 — Verify telemetry row landed

```bash
PGPASSWORD=harness_admin_pwd psql -h localhost -p 5432 -U harness_admin -d papercusp -c \
  "SET app.workspace_id='default'; SELECT tool_name, role, status, duration_ms FROM harness_shared.tool_invocations ORDER BY id DESC LIMIT 1"
```

Should show `status='ok'` and a real duration. Note the `SET app.workspace_id` — the table has RLS, so reads without the GUC return zero rows.

### Step 6 — Smoke test the gates

```bash
# Quota: fire perChunk+1 with the same chunk → second is 429.
for i in 1 2; do curl -X POST '.../my/tool?...&role=worker&chunk=Q' -d '{...}'; done

# Role gate: call with a role NOT in roles[] → 403.
curl -X POST '.../my/tool?...&role=validator' -d '{...}'   # if validator not allowed

# Refresh and confirm host error count unchanged
curl -X POST http://localhost:3055/api/plugins/host/refresh | jq '.status.errors'
# expect: 2  (the two pre-existing unrelated errors). If higher → you broke something.
```

## After every plugin manifest or handler edit

```bash
curl -X POST http://localhost:3055/api/plugins/host/refresh
```

The projection registry is module-level state. HMR is unreliable. If you don't refresh, you're testing stale code and won't know.

## Don't write tools for these

* Voice WSS (true bidirectional stream — agent ↔ user audio mid-call). Use the ElevenLabs Conv AI integration.
* File uploads >5MB (multipart isn't wired)
* Browser-state actions (no server function to project; use `ui:dispatch` instead — those are client commands, not tools)

LLM streaming output *is* fine — declare typed events on the manifest and the framework projects them over HTTP/SSE and MCP. See [Typed event streams](/internal/docs/endpoint-system/transports#typed-event-streams).

Mid-run server-asks-client is *also* fine — use `ctx.askUser(spec)` (the state channel ships the prompt out-of-band; the handler blocks on a deferred until the user clicks). See [ctx.askUser](./ask-user.mdx).

If you find yourself wanting to wrap one of the three remaining above, stop and ask. The contract was deliberately kept narrow.
