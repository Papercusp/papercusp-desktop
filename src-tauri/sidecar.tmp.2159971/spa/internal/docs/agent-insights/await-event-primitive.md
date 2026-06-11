# await-event: don't poll or block — register a wake and sleep
URL: /internal/docs/agent-insights/await-event-primitive

The universal subscription primitive (events:await/emit/cancel/status + locks:acquire{wake_on_grant}): durable one-shot wake subscriptions with liveness-adaptive delivery (pty-inject / session-resume / inbox-park). What to await, what never wakes, and the cost discipline.

## What it is

Agents that needed X-to-happen-before-proceeding used to **poll, block, or
pivot blind** — a lock conflict said "pivot/retry", resource waits held the
turn, plan-run completion was a poll-based sweep. As of
`await-event-primitive-2026-06-05` there is ONE primitive:

```
events:await { event: '<key>', note, timeout_sec, on_timeout: 'wake'|'expire' }
→ END YOUR TURN. You are re-invoked when the key fires (or at the deadline).
```

Sources fire keys with `events:emit { event, summary, payload, to? }` (agents)
or `emitAwaitedEvent(...)` (host code). The layering (plan D-001): the
**source** resolves who an event concerns (a lock grants to ONE waiter and
emits a targeted key; CI-green broadcasts); the **delivery** layer is dumb —
per recipient, honor their declared policy. `wake` re-invokes you (one-shot by
construction — it can never wake-loop); `notify` (topics, follows) goes to your
coord inbox and **never** wakes.

## The delivery ladder (liveness-adaptive, D-003/D-009)

The wake handle is stamped at **registration** (your coord SID →
`adv_sessions`): it can't be fetched at fire time because you're asleep.
On fire, the executor walks:

1. **Live managed pty** (pid-matched in pty-bridge) → the wake turn is
   injected directly.
2. **Process exited** → your session is **resumed** under a managed pty
   (`claude --resume <native-id>` / `omp -r <thread>`) with the wake reason as
   the prompt; `PAPERCUSP_SID` is re-exported so identity, lock hooks, and
   your other awaits survive. claude resume REQUIRES the native session UUID —
   `--continue` would resume a random peer's conversation on the shared cwd.
3. **Alive but uninjectable** (a detached terminal — the common psu case, or a
   pid-less session row with fresh presence) → **parked** + a one-time inbox
   nudge; the parked wake converts to a resume when your process exits.
   **If the nudge reaches you while awake and you act on it, ACK it:**
   `events:cancel { delivery_id }` — otherwise you'll also be resumed later
   (a wasted turn).
4. **Nothing live, nothing resumable** → dropped VISIBLY (logged + metered),
   never silently.

Delivery is durable (PG queue, at-least-once + idempotent wake): a host
restart re-claims stuck deliveries; a missed lock-grant NOTIFY is re-derived
from waiter-table truth each 30s sweep.

## The patterns

* **Blocked on a file lock:** `locks:acquire { paths, intent, wake_on_grant: true }`
  → returns `queued_for_wake` + a ticket — end your turn. The wake carries your
  `lock_id` with the TTL **already running**: edit, then `locks:release`. The
  old "pivot/retry" advice is retired.
* **Blocked on a peer:** they tell you a key (or you agree on one) → you
  `events:await`, they `events:emit`. Built-in keys that fire today:
  `work-item:done:<id>`, `work-item:unblocked:<id>` (last blocker settled),
  `plan-run:finished:<runId>`, `plan:draft-ready:<slug>`,
  `conversation:answered:<id>` (coord:ask's miss path names it),
  `release:green`, `release:deployed` / `release:deploy-failed`,
  `escalation:resolved:<msgId>`, `handoff:accepted:<msgId>`,
  `rate-limit:paused/reset:gym-judge|gym-ab`, `lock:grant:<ticket>`.
* **Wake-at-reset for a rate limit:** you hold a `retryAfterMs` →
  `events:await { event: 'rate-limit:reset:<scope>', timeout_sec: ceil(ms/1000), on_timeout: 'wake' }`
  — the deadline IS the reset wake; an earlier reset emit just arrives sooner.
* **"Re-verify after the next deploy":** await `release:deployed` instead of
  hand-tracking the deferral.

## Cost discipline (D-007) — and what NOT to await

A wake = a re-invocation = a turn = tokens. Hence: `notify` is the default and
never wakes; `wake` requires the explicit verb; wakes are **metered**
(`events:status { meter: true }` — per-agent counts by channel = the
wake-storm detector); mass unblocks re-admit paced (per-tick resume cap +
per-agent single-flight + the fleet governor's `await-wake` admission scope).
Don't await sub-minute bounded waits (just block — a wake costs more than the
wait), ambient interest (that's `topics:subscribe`), or recurring schedules
(the pot/routines own time-wakes; an await is one-shot).

## Gotchas

* **Workspace scoping is normalized.** Awaits/deliveries live in the ONE coord
  workspace regardless of your identity's scoping — an early build registered
  '\*'-scoped awaits that never matched system emits. Event keys embed
  globally-unique ids, so one namespace is collision-free by construction.
* **Exact-key match, no globs.** `events:await` matches the literal string.
* **codex sessions park instead of resuming** (the per-session CODEX\_HOME
  isn't re-derivable yet) — visible in the delivery row.
* The store + engine live at
  `packages/operator-core/lib/events/await/` (migration 163:
  `event_awaits` + `event_wake_deliveries`); the lock bridge at
  `agent-tools/locks/lock-grant-bridge.ts`.
