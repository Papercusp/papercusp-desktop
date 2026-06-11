# Overview
URL: /internal/docs/endpoint-system/overview

One function, three transports — what the endpoint system is and why we built it this way.

## The one-line version

You write **one typed function**. The framework projects it onto:

* An **HTTP route** at `/api/plugins/<plugin>/<tool>` (or `/api/agent-tools/<tool>` for built-ins)
* An **MCP `tools/call` entry** under `<plugin>.<tool>` (or `<scope>:<verb>` for built-ins)
* An **in-process call** any TypeScript caller can `await` directly

You declare exposure, role allowlist, capabilities, and quotas in a manifest. The framework handles auth gating, role enforcement, quota windows, telemetry persistence, streaming progress, and per-spawn URL context — none of which you write per tool.

## Why "endpoint system" not "MCP migration"

The first instinct was to call this an MCP migration. That framing is wrong.

**The function is the source of truth.** HTTP and MCP are projections of it. Once a function is decoupled from any specific transport, all three callers — your dashboard, an AI agent over MCP, another module in the same Node process — get it for free, with the same auth/role/quota/telemetry behavior.

The hard part isn't writing the MCP wrapper. The hard part is pulling a function out of its current transport-coupled form so that the wrapper *can be* generated. The "MCP-callable" part is the smallest-and-easiest consequence of that decoupling.

## What this gets you

* **No duplicated route+handler code.** A new feature is one typed function plus six lines of manifest. Both the dashboard and the agent get it.
* **Single test surface.** You test the function. Both transports inherit correct behavior because they both go through the same dispatcher.
* **Uniform observability.** Every invocation lands in `harness_shared.tool_invocations` with role, window key, status, duration, output size — regardless of transport. You can answer "which agents called which tools when" without per-route instrumentation.
* **Uniform gating.** Role allowlist, capability check, and per-window quota all enforce in the same dispatcher. Adding a new sensitive tool means setting `roles: ["operator"]` + `rolesQuota: { operator: { perRun: 5 } }` and you're done.
* **Stream-or-not, no rewrite.** A function that calls `ctx.progress(pct, msg)` automatically gets MCP `notifications/progress` events on the MCP transport and SSE events on the HTTP transport. No transport-specific wiring.
* **Token-efficient by default.** A function returns structured `data`; the dispatcher serializes it in the most compact format the data's shape allows (TOON for arrays, lossless JSON otherwise) — agents read ≈ −20–35% fewer tokens on list results with no change to how they call. Declaring `result: <schema>` unlocks CSV + MCP `outputSchema` advertisement. See [Transports → Result formats](/internal/docs/endpoint-system/transports).

## What this is not

* Not a replacement for SSE chat, WebSocket voice, or anything else that holds a long-lived bidirectional connection. Those stay on dedicated routes; the endpoint system is for request → response (with optional streamed progress).
* Not a way to expose your dashboard to the public internet. The trust model is **loopback bind + HMAC-signed per-spawn URL params** (see [Spawn-URL signing](/internal/docs/endpoint-system/spawn-signing)), suitable for local dev + Tauri desktop. Off-loopback exposure needs a real principal/auth layer in front, since same-UID code can still read the signing key from PG.
* Not a generic RPC framework. The contract is narrow on purpose: `(input, ctx) => ToolResult`. Trying to make it accommodate exotic shapes (callbacks, multi-response, file uploads >5MB) defeats the point of having one function as truth.

## The route projection — `defineTool` also defines plumbing

Not every endpoint is an agent tool. The browser, the desktop shell, an
orchestrator, a webhook — they call **routes**: HTTP plumbing that must
*not* appear in the agent tool catalog. `defineTool` produces those too.

`defineTool` accepts a **route-shaped** input — discriminated by the
`method` field — and returns a `RouteDefinition` instead of a
`ToolDefinition`:

```ts
defineTool({
  method: 'GET',
  path: '/desktop/version',
  auth: 'public',                    // or a PrincipalRequirements gate
  input: z.object({ verbose: z.coerce.boolean().optional() }), // optional
  handler(req, ctx) {                // Web-standard Request in, Response out
    return Response.json({ version: '…' });
  },
});
```

A route runs through the same cross-cutting machinery — auth, input
validation, timeout, telemetry, uniform errors — but it is **not**
projected onto the MCP catalog. `tools/list` never sees it; an agent
cannot call it. That guarantee is what keeps plumbing out of the agent
surface.

Route files import `defineTool` directly — the former `defineRoute`
alias was **removed** when the primitives were unified (Phase E6,
`endpoint-unification-2026-05-21`). A route is *declared* with
`defineTool` and *mounted* host-side by `registerRoute`
(`packages/operator-core/lib/endpoint-route/`).

### Paired-phone routes — `auth: { kind: ['device'] }` + `cors`

A route reachable from the paired phone declares the device-JWT auth
gate and opts into cross-origin reachability — there is no implicit
folding:

```ts
defineTool({
  method: 'POST', path: '/device/heartbeat',
  auth: { kind: ['device'] },        // gate on the device-JWT principal
  cors: true,                        // CORS allowlist (paired-device + tauri + localhost)
  handler(req, ctx) { /* ctx.principal is the device */ },
});
```

`cors: true` mounts the shared CORS middleware (OPTIONS preflight +
headers); `auth: { kind: ['device'] }` makes the route-stack reject
anything that doesn't resolve to a device principal. Paired-phone
routes live under `/api/device/*`. Built-in tools are reachable from
the phone for free — the device JWT is a bearer token, and the
`/api/agent-tools/*` catch-all resolves it like any other.

## Two channels at a glance

A tool handler has two outbound channels available, projected uniformly across transports:

| Channel    | API                                                   | Wire                                                   | Replay on reconnect                               |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| **Events** | `ctx.emit('name', payload)`, `ctx.progress(pct, msg)` | typed SSE events / MCP notifications                   | Ring buffer (T2.2), bounded by `replayBufferSize` |
| **State**  | `ctx.askUser(spec)`, `ctx.publishState(snapshot)`     | `state-snapshot` SSE on `/api/operator/state-snapshot` | Current snapshot only — replay does not re-prompt |

Cards (`ctx.askUser`) and tool state (`ctx.publishState`) live on the state channel because they're not append-only — a reconnecting client wants the latest answered/unanswered card state, not history of every snapshot. The framework auto-installs `askUser` / `publishState` on the ctx when the call has a `workspaceId + runId` (always present for HTTP-projected calls). See [ctx.askUser](/internal/docs/endpoint-system/ask-user) and [state-shaped tools](/internal/docs/endpoint-system/state-tools).

## How it's packaged

The endpoint system started life inside `@papercusp/agent-mcp`. It has since been
**carved into a host-agnostic engine plus thin adapters** (plan
`papercusp-tooldef-extraction-2026-05-29`), so the same dispatcher can be used outside
Papercusp:

| Package                              | Role                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@papercusp/tooldef`**             | The engine — `defineTool`, the registry, the dispatch pipeline, the state/card/replay channels, OpenAPI assembly, core types. **Zero** Papercusp / PG / Next / `@restart` deps. Validator-agnostic ([Standard Schema](https://standardschema.dev)); every host-specific rule is injected (table below).                                                                                                           |
| **`@papercusp/tooldef-http`**        | The HTTP transport adapter (`handleHttpToolRequest` / `…Streaming`). Resolves a request → tool, builds the ctx from `X-Papercusp-*` headers, dispatches. Depends only on the engine + `@papercusp/sse`.                                                                                                                                                                                                           |
| **`@papercusp/ipc-endpoint-server`** | The IPC (unix-socket) transport adapter.                                                                                                                                                                                                                                                                                                                                                                          |
| **`@papercusp/agent-mcp`**           | The **Papercusp host adapter** — supplies the injected deps (PG-backed quota/telemetry, the role config, quota-window policy, capability→tier table, gate-bypass mapping, HMAC spawn verification) and re-exports the engine + HTTP surface so existing import sites are untouched. The **MCP bridge** (Vercel `mcp-handler` glue + spawn-context auth) currently still lives here / in the operator route layer. |

Everything Papercusp-specific is a **host-injected seam** with a generic engine default:

| Concern                          | Seam                                                                              | Engine default                |
| -------------------------------- | --------------------------------------------------------------------------------- | ----------------------------- |
| Roles                            | augment the `RoleRegistry` interface → shapes `AgentRole`                         | `string` (any role)           |
| Quota window + ceiling           | `DispatchProjectedDeps.computeQuotaWindow(ctx, roleQuota)`                        | run-scoped / `perRun`         |
| Capability → tier                | `setCapabilityTierResolver` (read via `tierFor`)                                  | `'low'`                       |
| Gate bypass (privileged callers) | `ctx.gateBypass { role?, capability?, quota? }`                                   | absent ⇒ all gates enforce    |
| Schema validation                | `args` / `state` / card `dataSchema` typed `StandardSchemaV1`; `standardValidate` | any Standard Schema validator |
| Schema → JSON Schema             | `setJsonSchemaAdapter` (read via `toJsonSchema`)                                  | Zod 4 `toJSONSchema`          |
| Quota / telemetry I/O            | `DispatchProjectedDeps.readQuotaState` / `recordInvocation`                       | no-ops                        |
| Transaction handle               | `ToolContext<Tx = any>`                                                           | `any`                         |

The engine is provably standalone — see `libs/generic/tooldef/examples/standalone-inprocess.ts`
(registers + dispatches a tool importing **only** `@papercusp/tooldef`). It is also
mirrored to a standalone `Papercusp/tooldef` repo for external consumers.

## Where to read next

* [Function-as-truth](/internal/docs/endpoint-system/function-as-truth) — the architectural spine: why the function comes first
* [Writing a tool](/internal/docs/endpoint-system/writing-a-tool) — the recipe for built-ins and plugins, end to end
* [Transports](/internal/docs/endpoint-system/transports) — how MCP, HTTP, IPC, and in-process callers all reach the same function
* [Voice modality](/internal/docs/endpoint-system/voice-modality) — how tools surface in the ElevenLabs Conv AI integration and how cards collapse to `fallbackText` on voice
* [ctx.askUser](/internal/docs/endpoint-system/ask-user) — interactive prompts mid-run; the state channel; `askUserLocal` client-only variant
* [State-shaped tools](/internal/docs/endpoint-system/state-tools) — `ctx.publishState`; when to publish snapshots instead of streaming events
* [Gating](/internal/docs/endpoint-system/gating) — auth, capabilities, roles, quotas — what blocks what when
* [Spawn-URL signing](/internal/docs/endpoint-system/spawn-signing) — HMAC verification of the seven per-spawn URL params; what it defends against and what it doesn't
* [Telemetry](/internal/docs/endpoint-system/telemetry) — `tool_invocations` schema and how to read it
* [Operations](/internal/docs/endpoint-system/operations) — host refresh, hot reload, common failure modes
* [Superuser mode](/internal/docs/endpoint-system/superuser-mode) — `?superuser=1` loopback escape hatch for dev/admin scripts
* [Tool catalog](/internal/docs/endpoint-system/tool-catalog) — every projected tool snapshot (live source: `/settings/plugins/tools`)
* [Reference](/internal/docs/endpoint-system/reference) — manifest schema, error codes, file map
* [Agents → Prompt assembly](/internal/docs/agents/prompt-assembly) — adjacent layer: how a role's system prompt is built from persona, tools catalog (powered by `defineTool({ guidance })`), and role playbook
