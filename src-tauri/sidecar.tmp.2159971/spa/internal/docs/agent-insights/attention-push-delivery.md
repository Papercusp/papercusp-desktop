# Attention push-notification delivery
URL: /internal/docs/agent-insights/attention-push-delivery

How needs-human / escalation / smoke / plan-review notifications get delivered — event-driven at the source (notifyAttention), to mobile push + a native desktop notification. No more 60s poll.

## What it is

The flip side of [the attention/importance system](/internal/docs/agent-insights/attention-importance-system):
how an attention item that needs a human becomes a **push notification** on
the user's devices. Implemented by `planning-attention-importance-2026-05-31`
P-020/P-021/D-007 (2026-05-31). This is the map.

## One helper, two channels, event-driven

Everything funnels through **`notifyAttention()`** in
`packages/operator-core/lib/attention-notify.ts`. Producers call it at the source the
moment a ≥high attention item appears; it fans out to two independently
fail-safe channels (a delivery error is logged and swallowed — it never
propagates into the producer's write path):

1. **Mobile** — `notifyWorkspace(wsId, payload)` →
   `packages/operator-core/lib/device-push-dispatcher.ts` → APNs/FCM to devices paired
   in `harness_shared.mobile_push_tokens`. No-op when none are paired. `data`
   must be string-valued and `kind` a `PushKind` — the helper coerces/maps.
2. **Desktop-native** — emits an `attention.notify` event on the sync SSE bus
   (`notifySyncInvalidate`). The webview's `DesktopAttentionNotifier`
   (`apps/operator/app/_components/`, mounted once at the root, app-level so
   `@papercusp/sync` stays domain-free) shows an in-app **sonner toast**
   always, and in the Tauri shell invokes the **`show_attention_notification`**
   Rust command (`papercusp-desktop`, `tauri-plugin-notification`) for a
   native OS notification. Driven from Rust, so no JS-facing notification
   capability is needed; the command is app-defined → allowed by default.

**No 60s poll.** The old `device-intervention-watcher` (a `setInterval(60s)`
catch-all that SELECTed the three tables) was **deleted** in P-021 — its
triggers now emit at the source.

## Where those rows are written (the producer chokepoints)

The fs-watcher mirror for these three tables is **retired** (see the long
comment block in `harness-fs-watcher.ts`). They're now written **at producer
time** by three internal endpoints, called by `bash run.sh` / `bin/supervisor.sh`
/ `bin/service-smoke-test.sh`:

* `POST /api/internal/escalation-event`  → `harness_escalations`
* `POST /api/internal/smoke-test-event`  → `harness_smoke_test`
* `POST /api/internal/plan-review-event` → `harness_plan_review`

So an event-driven emit for these has a clean home (those 3 endpoints) — but
see the coupling gotcha below.

## The importance map (what the ≥high gate includes)

P-020 pushes only at importance **≥ high**. The per-kind importance lives in
`packages/operator-core/lib/attention/adapters.ts`:

| Kind                   | importance                                                                      |
| ---------------------- | ------------------------------------------------------------------------------- |
| smoke-fail             | `high` (fixed)                                                                  |
| plan-review            | `high` (fixed)                                                                  |
| coord escalation       | `severityToImportance(sev)` — blocker→`urgent`, question→`high`, advisory→`low` |
| coord message-to-human | `normal`                                                                        |
| plan item              | the item's own `importance:` keyword                                            |

Note `harness_escalations` (the table the watcher polls) has **no severity
column** — it's a harness-level escalation, distinct from a *coord* escalation.
Treat it as inherently high. Net: the watcher's three triggers are all already
high, so the watcher never pushed low-importance noise to begin with.

## The four producer call-sites + their once-per-event gating

`notifyAttention()` is called at exactly the points that *create* a ≥high
attention item — there's no poll, so each must fire **once per genuine event**:

| Source      | Where                           | Fire condition                                                                                 |
| ----------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| escalation  | `internal/escalation-event.ts`  | `escalation != null` (skip notes-only updates)                                                 |
| smoke-fail  | `internal/smoke-test-event.ts`  | **transition** into failing — reads prior `status`, fires only on `pass→fail` / first fail     |
| plan-review | `internal/plan-review-event.ts` | every call (the producer posts once per completed review)                                      |
| needs-human | `plans:set-status`              | transition INTO `needs-human` at importance ≥ high (`shouldPushNeedsHuman` + `itemImportance`) |

Why this was safe to do at once: each source is its own chokepoint, so there's
**no double-fire** (the poll that used to also push escalation/smoke/plan-review
is gone). The gating above prevents re-pushing on idempotent re-writes. The
trade vs the old poll: the poll was a catch-all that fired regardless of write
path; source emits only fire from these four sites — if a *new* write path for
those tables appears, wire `notifyAttention` into it too.

## Extending it

* **New attention source:** call `notifyAttention({ kind, title, body,
  harnessSlug, importance })` at the write site. Add the kind to
  `AttentionNotifyKind` + `MOBILE_KIND` if it needs a distinct mobile route.
* **The desktop native notification needs a cargo rebuild** of
  `papercusp-desktop` to pick up `tauri-plugin-notification` + the
  `show_attention_notification` command. The toast + mobile push work without
  it; the native OS notification is a no-op (caught) until the rebuild.
* End-to-end delivery (APNs/FCM, native OS notification) is **not
  headless-testable** — verify in the desktop shell. The `notifyAttention`
  fan-out + the gates are unit-tested (`attention-notify.test.ts`,
  `set-status.test.ts`).
