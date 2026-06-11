# ctx.publishState — state-shaped tools
URL: /internal/docs/endpoint-system/state-tools

Tools that publish their current state instead of streaming events. Reconnect-resilient by construction; clients see the latest snapshot, never event history.

# `ctx.publishState` — state-shaped tools

A **state-shaped tool** publishes its current snapshot rather than streaming events. Clients reconnecting mid-run receive the latest snapshot — never event history.

```ts
defineTool({
  name: 'search:semantic',
  state: z.object({
    results: z.array(z.object({ id: z.string(), score: z.number() })),
    progress: z.number(),
    phase: z.enum(['embedding', 'querying', 'ranking', 'done']),
  }),
  handler: async (args, ctx) => {
    ctx.publishState({ results: [], progress: 0, phase: 'embedding' });
    const embedded = await embed(args.query);
    ctx.publishState({ results: [], progress: 0.4, phase: 'querying' });
    const results = await query(embedded);
    ctx.publishState({ results, progress: 1, phase: 'done' });
    return results;
  },
});
```

## Why state-shaped instead of events?

Most streaming tools today emit events (`ctx.emit('progress', …)`, `ctx.emit('text-delta', …)`) and rely on a replay ring buffer (T2.2) to recover from disconnects. That's the right shape when output is **append-only** (LLM token streams). But for tools whose output is a **current value that supersedes prior values**, replay is the wrong shape:

| Aspect                | Event-shaped (`ctx.emit`)      | State-shaped (`ctx.publishState`)    |
| --------------------- | ------------------------------ | ------------------------------------ |
| Wire form             | typed events on the wire       | one `state-snapshot` per change      |
| Replay on reconnect   | Last N events from ring buffer | Latest snapshot                      |
| Memory                | Linear in stream length        | Bounded by state shape               |
| Long-lived disconnect | Buffer evicts past 5000 events | Snapshot persists across disconnects |
| Workspace switch      | Buffers cleared                | Snapshots cleared                    |

For a search tool with 100 results, state-shape is \~10KB regardless of how many internal updates happened. For a token stream, that same encoding would be lossy.

## Declaring a state-shaped tool

Add `state: ZodType<S>` to `defineTool`. The schema is the source of truth for the snapshot shape:

```ts
defineTool({
  name: 'whatever',
  state: z.object({ /* your shape */ }),
  ...
})
```

Tools that declare `state` automatically:

* Get `ctx.publishState` installed (when the call has both `workspaceId` and `runId` — the HTTP catch-all defaults a `runId` per-request, so plain JSON / SSE callers both work).
* Opt **out** of the replay ring buffer (no double-storage — state snapshots replace events on the wire).
* Become **streamable** — the HTTP catch-all's strict-streamable predicate recognizes `tool.state` as a valid trigger for `Accept: text/event-stream`, so the runId-bearing SSE path is reachable even when no `events` are declared.
* Persist snapshots for 5 minutes after run-end (reconnect window).

## Handler API

```ts
ctx.publishState(snapshot)
```

* **Validated** against `tool.state` at publish time. Bad shapes throw synchronously.
* **Replaces** the run's current snapshot (v1 is snapshot-only).
* **Reactive** — every call bumps the run's `version` and re-emits to subscribed clients.

### v1 limitations

* **Snapshot-only.** Passing a JSON-Patch array throws. Deltas are deferred to v1.1 once we measure full-snapshot perf on real tools.
* **In-process state.** Snapshots live in the operator's Node process. Dev HMR / server restart drops them. PG-backed persistence is a follow-up.

## Client-side consumption

The state-snapshot SSE stream (`GET /api/operator/state-snapshot`) carries `toolState` alongside `openCards`. Use `useStateSnapshots()` to subscribe and `selectToolStates()` to filter:

```ts
import { useStateSnapshots, selectToolStates } from '@/lib/use-state-snapshots';

function MyComponent() {
  const { byRun } = useStateSnapshots();
  const states = selectToolStates(byRun);
  // states is Map<runId, toolState>
}
```

The `useStateSnapshots` hook owns one EventSource per mount. `selectToolStates` is a pure helper — do not call `useStateSnapshots()` from inside it.

## How state-shape absorbs T4.3

The original Phase-4 plan had T4.3 "long-lived disconnected tools" as a separate Tier-4 item: detach `AbortSignal` from disconnect, manage the ring buffer's lifetime, decide when to *actually* abort.

State-shape collapses T4.3 to **zero engineering**:

* State outlives any single SSE connection.
* Reconnect serves the current snapshot — no buffer to evict, no history to replay.
* "Long-lived" is the default for state-shaped tools.

The tool author opts in by declaring `state`. The framework handles the rest.

## When NOT to use state

* **LLM token streams** (`runAgentChat` etc.) — those are inherently append-only. Use `ctx.emit('text-delta', …)` with `replayBufferSize` for reconnect.
* **One-shot tools** with a final result — no streaming, no need for state.
* **Tools that need to emit ordered events** (notifications, log lines) — state collapses ordering into "latest only."

For a tool that mixes a state-shaped result (`results`) with an append-only side stream (`log_lines`), declare `state` AND `events` — both surfaces work together.

## See also

* [ctx.askUser](./ask-user.mdx) — interactive prompts on the same state channel.
* Plan: `apps/operator/docs/plans/bespoke-card-improvements-2026-05-13.md` §5
