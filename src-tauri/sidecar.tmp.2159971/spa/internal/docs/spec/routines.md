# 9. Routines
URL: /internal/docs/spec/routines



A routine is a scheduled or triggered event source. Routines insert into `pending_events`; the orchestrator decides what to do with them.

Implemented (with evolution). The routines engine shipped as a durable DBOS scheduled
workflow (`packages/operator-core/lib/dbos/routines-workflow.ts`) reading the
`harness_shared.routines` table (the schema below). The default tick is `*/30 * * * * *` (every 30s,
skip-missed) with a concurrency-4 fire queue. A routine's `target_role` now dispatches one of two ways:
`system:<action>` runs a registered handler inline (the live `system:git-sync`,
`system:green-checkpoint`, `system:release-trigger`, `system:blueprint-run`, … actions —
`packages/operator-core/lib/harness/routines/register-system-actions.ts`), and an agent role spawns that
role via the harness invoke route. The legacy "routine → `pending_events` → orchestrator" hop is retired
for cron routines: a cron routine fires its action directly. The per-plugin/system cost caps and the
`audit.routine_fires` / `audit.system_pressure` telemetry tables in §9.4 below are design intent —
the shipped fire telemetry is the autoloop `recordFire` / `checkFireGate` error-backoff
(`packages/operator-core/lib/autoloop.ts`), not a dedicated `audit` schema.

```
CREATE TABLE routines (
  id              text PRIMARY KEY,
  install_slug    text NOT NULL,
  name            text NOT NULL,
  trigger_kind    text NOT NULL,    -- 'cron' | 'webhook' | 'api'
  trigger_config  jsonb NOT NULL,   -- { cron: '0 9 * * MON' } | { webhook_token: '...' }
  target_role     text NOT NULL,    -- e.g. 'narrator', or 'orchestrator' for ticks
  payload_template jsonb,            -- additional context to pass to the role
  concurrency     text NOT NULL DEFAULT 'queue',     -- 'queue' | 'skip' | 'cancel-prev'
  catchup         text NOT NULL DEFAULT 'skip-old',  -- 'skip-old' | 'run-all-backlog'
  active          boolean NOT NULL DEFAULT true,
  last_fired_at   timestamptz,
  next_fire_at    timestamptz
);
```

### 9.1 Lifecycle

Register — plugin manifest declares routines OR user creates one via UI
Tick — substrate's "routine ticker" runs every \~30s, evaluates cron expressions, computes `next_fire_at`
Fire — when due (or on webhook receipt / API trigger), insert into `pending_events`
Orchestrator picks up — sees the event on its next tick, decides whether to dispatch (or queue / defer)
Substrate dispatches the target role; marks the event consumed; updates routine's `last_fired_at`

### 9.2 What routines replace

Today's `auto-loop: on/off + intervalSeconds` per harness becomes one routine: \{\{kind: 'cron', expr: '\*/30 \* \* \* \* \*', target\_role: 'orchestrator'}}
Webhook handlers (e.g., GitHub PR opened → wake the reviewer) become webhook routines
Scheduled work (weekly briefings, daily cost reports, hourly health checks) is now first-class

### 9.3 Why this matters

Without routines, the orchestrator's prompt has to know about every scheduled thing. With routines, scheduling is data, not prompt-engineered. Plugin authors can ship a complete "weekly briefings" feature as a single manifest entry — they don't write any cron-parsing or webhook-receiving code.

### 9.4 Cost containment & kill switches

Routines are dangerous: a plugin that registers `cron: '* * * * * *'` (every second) and spawns an LLM call per fire can drain a budget overnight. The substrate enforces three layers, all per-install:

9.4.1 Per-routine rate limit

Every routine has a `min_interval_seconds` (default 60) regardless of what the cron expression says. A routine that asks for `cron: '* * * * * *'` will fire at most once per minute. Plugins can request a tighter limit via the `routines:rate-limit-bypass` capability — the user must approve at install time.

```typescript
const routine: RoutineDefinition = {
name: 'high-frequency-poll',
trigger: { kind: 'cron', expr: '*/5 * * * * *' },
// Substrate ignores the cron's "every 5s" and uses min_interval_seconds.
// To actually fire every 5s, plugin manifest must declare:
//   capabilities: ['routines:rate-limit-bypass:high-frequency-poll']
target_role: 'orchestrator',
};
```

9.4.2 Per-plugin budget cap

Each plugin has a daily LLM-spend budget enforced by the substrate's existing budget guard (§3.7). Default cap is $5/day per plugin. Plugins request a higher cap via `budget:daily:&lt;n&gt;-usd` capability. When a plugin's daily spend hits the cap, all of its routines and role invocations are paused for the remainder of the UTC day. The substrate emits a `plugin.budget-exhausted` event that other plugins (or the user UI) can react to.

9.4.3 Kill switches

The user can pause any routine immediately:

```
papercusp routines pause briefings/weekly-summary
papercusp routines resume briefings/weekly-summary
papercusp routines pause-plugin briefings        # all routines from briefings
papercusp routines stats                          # see which plugins fired what, and what cost
```

UI surface: each plugin's settings page shows live routine activity (last fired, fires/hr, $ spent today) with a one-click pause toggle. The substrate auto-pauses any routine that errors 5 times in a row — it stays paused until the user explicitly resumes.

9.4.4 Telemetry the substrate guarantees

Every routine fire is recorded in `audit.routine_fires` with: routine id, plugin name, fire timestamp, target role, dispatch outcome, total LLM cost, total wall time. This lets users (and the substrate's UI) answer "which plugin is consuming my budget?" without instrumentation in the plugin itself.

#### 9.4.5 System-wide caps and back-pressure

Per-plugin caps (§9.4.1, §9.4.2) catch a single misbehaving plugin.
They don't protect against aggregate overload — twenty
well-behaved plugins each within their own caps can collectively
exhaust LLM rate limits, DB connections, or wall-clock concurrency.
The substrate enforces three system-wide caps:

Global daily LLM budget (default $50/day, configurable per install). Hits across all plugins; when exhausted, every plugin's routines pause until UTC rollover. The user's own non-plugin LLM calls (orchestrator ticks, ad-hoc queries) take priority over plugin routines once 80% of budget is consumed.
Concurrent routine fires (default 4). The routine ticker dispatches at most N routines simultaneously; queued routines wait. Prevents 50 cron expressions all firing at minute :00 from spawning 50 simultaneous LLM calls.
Per-minute LLM call rate (default 60/min across all plugins, calibrated to provider rate limits). When breached, routines are deferred (not failed) — the next-fire-at slips forward.

All three system caps emit metrics to `audit.system_pressure` so
operators can see when they're regularly close to the limit (signal
to either raise the cap or prune low-value routines). The UI surfaces
a "system at 87% of daily budget; 3 plugins competing for next fire"
indicator when caps are stressed.

Per-plugin caps interact with system caps multiplicatively, not additively. A plugin can hit either ceiling first; whichever triggers first stops the plugin. Authors should size their per-plugin caps assuming the system cap might constrain them earlier than their own.
