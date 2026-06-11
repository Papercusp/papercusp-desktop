# PG is canonical state, not a transport
URL: /internal/docs/agent-insights/db-not-transport

Don't poll PG to send messages between apps. Use HTTP/SSE/in-process; persist to PG after the message is delivered, never as the channel itself.

## What

Postgres holds **canonical state** in this codebase, but it is **not
a transport**. The common anti-pattern is having app A write a row
to PG that app B polls for, treating the row as a "message." This is
wrong for our topology.

The right shape:

```
app A  ──HTTP/SSE/in-process call──►  app B
                                       │
                                       └─►  persist outcome to PG
```

Not:

```
app A  ──INSERT INTO messages──►  PG
                                   ▲
                                   └── app B SELECT…WHERE handled=false
```

## Why it matters

PG-as-transport has bitten us in three concrete ways:

1. **Polling latency.** B has to choose between polling often (CPU
   burn) and rarely (user-visible delay). Neither is acceptable.
2. **Backpressure invisibility.** If B is slow, A keeps writing rows
   that pile up. There's no flow control, no backpressure, no signal
   to A that B is overloaded.
3. **Coupling on schema.** A and B share table layout. Schema migrations
   require coordinated deploy; a column rename breaks the channel.

Live HTTP/SSE/in-process calls give you backpressure, structured
errors, request/response correlation, and decoupled schemas for free.

The other shape that looks like PG-as-transport but isn't:
`pg_notify`. That's a real PG-level publish/subscribe with kernel-
level wakeups, not polling. It's fine for *event* notification (use
case: "tell me when a row changed") but not for *request/response*
(use case: "send this command and tell me the result").

## How to apply

* **Cross-app communication**: HTTP (with a typed endpoint via
  `defineTool`, which also produces the route projection) or in-process
  call. SSE for streaming.
* **Persist outcomes to PG** after the call returns. PG holds the
  authoritative state, not the message itself.
* **`pg_notify` is OK** for "wake up and re-read state" patterns —
  e.g., a UI subscribing to row changes. Not for command dispatch.
* **If you find yourself writing a polling loop**, stop and ask
  whether the right answer is an HTTP call or an SSE subscription.

The endpoint system docs at [`/docs/endpoint-system/overview`](/internal/docs/endpoint-system/overview)
describe the canonical "function as truth, transports as projections"
shape. Use it.
