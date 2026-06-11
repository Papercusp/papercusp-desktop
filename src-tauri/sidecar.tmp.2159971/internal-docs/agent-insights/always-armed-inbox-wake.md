# Turn-lifecycle control: always-arm wake + turn-interrupt
URL: /internal/docs/agent-insights/always-armed-inbox-wake

The two halves of turn-lifecycle control. WAKE: arming your inbox-wake watch is automatic at SessionStart — you are wakeable even if you never call coord:await-inbox (standing-row model, the woken:0 warning, the migration-183-rides-the-deploy hazard, why you still must not poll). INTERRUPT: turn:interrupt ends a RUNNING peer's turn — cooperative yield (glyph |) vs force, operator-mediated + audited + storm-limited.

## What changed

You no longer have to *remember* to make yourself wakeable. The operator now
**arms your inbox-wake watch automatically at SessionStart** — server-side, in the
lifecycle endpoint that `~/.papercusp/hooks/cc/lifecycle-report.sh` already POSTs to
(`activity:report`, `kind:lifecycle`). It is client-agnostic (claude / omp / codex)
and armed for the whole session, not just between turns. So every psu/Queen-launched
agent is re-invokable on a `coord:send {wake:true}` **even when it has no idea it
will ever be woken**.

Plan: `turn-lifecycle-control-2026-06-08` (Phase 1, D-001). The old rule — "call
`coord:await-inbox` when you go idle or you won't be wakeable" — is dead. Forgetting
to arm no longer strands you.

## The model: one standing row per agent

Your watch is a single row in `harness_shared.event_awaits`, keyed
`(workspace_id, subscriber_id, event_key)` with `event_key = coord:inbox-wake:<you>`.

* **Idempotent (D-002).** SessionStart re-arms by **upsert** (`upsertInboxWakeAwait`,
  `ON CONFLICT … DO UPDATE`): re-arming refreshes the captured wake-handle + idle
  note + floor on the one row — it never inserts a duplicate. A partial unique index
  (migration 183) enforces exactly one live standing inbox-wake await per agent.
* **The rendezvous.** `coord:send {wake:true, to:[you]}` (and `coord:message-agent`)
  fires exactly `coord:inbox-wake:<you>` — a key only you watch. It is targeted,
  never a broadcast; `*`/`human` are not wakeable (no thunder-herd).
* **SessionEnd cancels it (D-003).** A clean session end cancels your standing
  watch, so a wake can't race a just-exited session and phantom-resume it. If work
  arrives later, a fresh session is spawned by whoever needs it.

## `coord:await-inbox` is now just an annotation (D-005)

Because arming is automatic, `coord:await-inbox` is **no longer the gate** that makes
you wakeable. It survives as an *annotation*: it refreshes the "why I'm idle" note on
your already-armed standing row (the note rides your wake turn) and lets you tune your
`min_sleep_sec` floor. Call it to explain your idle state if you like — but forgetting
to no longer makes you unwakeable, which was the whole point.

## You still must not poll

Always-arm makes you *reliably wakeable*; it does not make polling OK. When you have
no queued work: **end your turn.** You are re-invoked when someone `coord:send`s you
with `{wake:true}` (bursts inside your floor coalesce into one wake). For a specific
one-shot readiness (a lock grant, a peer's artifact, a plan-run finishing) use
`events:await` on that exact key and end the turn. A wake costs a whole turn — await
only what genuinely blocks you; ambient interest stays a `topics:subscribe`.

## The woken:0 warning — don't trust a silent ok (D-010)

`coord:send {wake:true}` now returns a `wake.warning` when it fired but woke **nobody**
(`woken: 0` while it had concrete targets):

```
wake fired but no live wake-watch was registered for the addressee(s) — the message
was injected to their inbox (seen on their next natural turn) but no session was
re-invoked now.
```

This is the exact gap that once made a wake *look* successful when nothing was
listening. Always-arm makes `woken: 0` rare for fleet agents, but the warning still
catches a not-yet-armed / non-fleet / dead-handle target. If you see it, your "wake"
degraded to a plain inbox inject — the addressee sees it on their next natural turn,
not now.

## The one deploy-time hazard: migration 183 rides the deploy (D-012)

If you are deploying or debugging the live DB: **never manually apply migration 183
(the partial unique index) to the shared `papercusp` database.** The green-main
operator (`:3070`, the live fleet) still *plain-inserts* `coord:inbox-wake:*` rows
(no `ON CONFLICT`) until the Phase-1 upsert code is deployed. Applying the unique
index first would dedup to one row/agent and then make green-main's next idle insert
throw a `unique_violation` → live-fleet idle-arm regression.

The index is correct and applies clean empty→head; it must land **coupled with the
upsert code**, which only happens through the green-main deploy
(green-checkpoint → release-trigger → `deploy-cli applyStagedMigrations`). It is not
triggerable by accident: boot-migrate is gated off on `:3170`, and `:3070` reads the
release SQL dir. So "apply 183 to live PG" is a no-op-by-design that rides the deploy
— not a pending manual step.

## Where it lives

* `armInboxWake` / `cancelInboxWake` — `packages/operator-core/lib/events/await/inbox-wake-arm.ts`
* `upsertInboxWakeAwait` / `cancelInboxWakeAwaits` + the standing-row SQL — `packages/operator-core/lib/events/await/store.ts`
* SessionStart→arm / SessionEnd→cancel wiring — `packages/operator-core/lib/agent-tools/activity/report.ts`
* The `woken:0` warning — `packages/operator-core/lib/agent-tools/coordination/tools/send.ts`
* `coord:await-inbox` (annotation) — `packages/operator-core/lib/agent-tools/coordination/tools/await-inbox.ts`
* Migration — `libs/papercusp/libs/db/sql/183-event-awaits-inbox-wake-one-per-agent.sql`

## The dual: turn-interrupt — ending a RUNNING peer's turn

Wake re-invokes a *sleeping* agent; **`turn:interrupt`** ends a *running* one's
turn. It is **operator-mediated** (D-008): every fleet agent runs as the same OS
user, so authorization / attribution / rate-limit can't live at the OS socket —
they live in the tool. `turn:interrupt { owner, mode, reason }` — `reason` is
REQUIRED and audited.

**Two modes:**

* **`cooperative`** (the polite default) — injects a high-priority `yield` coord
  message (glyph `|`) into the peer's `[coord+N]` block mid-turn. The peer follows
  the yield policy every role's prompt now carries (the dual clause to this page's
  wake guidance): reach a safe checkpoint, persist partial state to the work\_item,
  release locks, write a one-line successor note, end the turn. It is **not** killed.
  It **DEFERS** when the target holds file locks (a critical section) — a hard yield
  mid-edit can orphan a lock or half-write a file, so it lets the atomic edit finish
  and the lock release first, then you retry.
* **`force`** — ends the turn NOW, mid-thinking. A managed-pty session gets Ctrl+C
  over its control socket (the Phase-3 `interruptViaPty` seam); a headless spawn gets
  SIGINT to the session pid. The **turn** ends, not the agent — the session stays
  resumable by id. On a critical section `force` WARNS (orphaned-edit hazard) but
  proceeds.

**Guardrails (D-009):** `reason` required; every call audited
(`turn.interrupt_cooperative` / `_force` / `_deferred` / `_rate_limited` / `_failed`
in `harness_shared.audit_log`); storm-limited to 10/min/actor (the audit log is the
rate source) so a confused or looping agent can't halt the fleet; self-interrupt
refused.

**Reach for cooperative first**; use `force` only when cooperative was ignored or
there's no time. To re-invoke an *idle* peer use `coord:send {wake:true}` — interrupt
is for a *running* peer. The `yield` glyph + every other line type are sourced from
the one `COORD_LEGEND`; see [the coord injection protocol](/internal/docs/agent-insights/coord-injection-protocol).

**Known gaps (2026-06-08):** the managed-pty typing-parity feel-check and the
default-on flip (`PAPERCUSP_PSU_PTY` is opt-in today), and a full live interactive
force-interrupt-mid-thinking e2e, are not yet run — the transport and the logic are
each covered separately (`turn:interrupt` unit tests 8/8 + the Phase-3 control-socket
e2e). Where it lives: `packages/operator-core/lib/agent-tools/turn/interrupt.ts`
(`performInterrupt` is the dep-injected, testable core).
