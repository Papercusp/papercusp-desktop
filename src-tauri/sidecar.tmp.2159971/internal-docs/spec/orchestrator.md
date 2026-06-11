# 6. Orchestrator + pending_events
URL: /internal/docs/spec/orchestrator



Papercusp uses a centralized orchestrator rather than per-agent heartbeats. Why:

Implemented (with evolution). The single all-deciding LLM "orchestrator" role of this
design shipped as a split: the orchestrator is now the deterministic code selector
(`packages/operator-core/lib/dbos/orchestrator-loop.ts`) that starts a durable per-feature pipeline, and the
per-feature LLM decider keeps the distinct name director (the legacy
`prompts/orchestrator.md` is archived under `_archived/`). External events still land in
`harness_shared.pending_events` (NOTIFY/LISTEN via `pending-events-listener.ts`), but the scheduled-tick
path is the DBOS routines engine (see §9): a cron routine now fires the
`system:blueprint-run` action directly rather than enqueuing a `pending_events` row for the orchestrator to
consume. The decision verbs below are real (`NEXT_WORKER`, `NEXT_VALIDATOR`, …); each blueprint declares its
own vocabulary in `spine.edges`.

No wasted wakeups — only the orchestrator polls. The other agents stay asleep until summoned.
Centralized auditing — every decision is one orchestrator output you can trace.
Cheap state visibility — orchestrator sees the whole picture in one prompt.
Drift control — sequential decisions, predictable order.

External events (cron, webhook, API) write to a `pending_events` queue. The orchestrator consumes it on each tick, alongside its other inputs:

```
     pending_events
     (queue)
        ▲
        │ inserts from:
        ├── cron-routine ticker (substrate)
        ├── webhook handlers
        ├── API triggers
        └── completion-delta hooks (e.g. task→passed → notify reviewer)
        │
        ▼
  ┌────────────────────────────────┐
  │   ORCHESTRATOR (1 per harness) │
  │                                 │
  │   reads:                        │
  │     - tasks (queue state)       │
  │     - pending_events            │
  │     - issues, worker_log        │
  │     - goal lineage              │
  │                                 │
  │   emits:                        │
  │     NEXT_WORKER | NEXT_VALIDATOR│
  │     | NEXT_NARRATOR | NEXT_<plugin>│
  │     | DONE | ESCALATE           │
  └─────────┬───────────────────────┘
            │
            ▼ (substrate dispatches the named role)
```

Tick triggering can be:

Timer-based — a routine fires every N seconds, inserting a \{\{kind: 'routine', target\_role: 'orchestrator'}} event
Event-triggered — substrate notices a new `pending_events` row (NOTIFY/LISTEN) and wakes the orchestrator immediately

For idle harnesses, this is strictly better than per-agent heartbeats: zero wakeups when there's nothing to do.
