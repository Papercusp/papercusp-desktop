# Which schedulers deliberately stay OFF DBOS (and why)
URL: /internal/docs/agent-insights/schedulers-not-on-dbos

The audit (dbos-scheduler-consolidation-2026-06-03) moved every portable periodic job onto DBOS scheduled workflows. This is the catalog of the loops that deliberately did NOT move, with the one-line reason for each — so the next agent doesn't try to "finish the migration" by porting something that can't or shouldn't be a DBOS cron.

The scheduler-consolidation pass ported the portable periodic jobs (harness-status
sweep, backup orphan-cleanup, push-credential refresh, telemetry/scratch-gc/memory/
embed/completion-ref timers, test-runs prune) onto **DBOS scheduled workflows**
(`packages/operator-core/lib/dbos/periodic-workflows.ts`). A set of recurring loops were
**deliberately kept off DBOS**. If you're tempted to "finish the migration," check
this list first — these are conscious keeps, not stragglers.

## The keep list (consolidation D-002)

* **All Rust schedulers** (`papercusp-desktop/src-tauri`, `papercup-rust-server`,
  `papercup-native`, `papercup-rust-mobile`). DBOS is a Node/TS library — it cannot
  run a Rust `tokio`/thread loop. The work is runtime-bound: Axum SSE keepalives,
  PG `LISTEN` reconnect, PG/zero-cache process spawn+kill lifecycle, WebSocket/
  EventSource reconnect.

* **Per-connection / per-request / per-spawn loops.** `expert-dispatcher` (≈100ms
  result-file poll during one agent run), `pty-ws`/`pty-bridge`/`device-voice-ws`/
  `voice-engines/deepgram` keepalives, `run-command-sse`, the `pty` route,
  `agent-tools/locks/acquire` wait-poll, `voice-engine-health`, and `provision/
  runner`'s `drainFifo`. Each is bound to a live in-process handle (socket / child
  process / session) that a detached periodic cron has no reference to. Not crons.

* **In-memory sweepers.** `expirable-registry` sweeps a process-local `Map` of
  TTL'd entries; `harness-fs-watcher`'s 60s tick is a reconcile **backstop** to its
  event-driven (chokidar) watcher. A detached DBOS cron can't see in-process memory
  or the watcher's view. (Each carries an inline `// not a DBOS candidate` note.)

* **`sync/hyperbee/outbox-drain`** — native at-least-once draining is the right fit;
  DBOS is a worse fit here (prior DBOS plan D-006).

* **UI** — `ui/use-ui-presence` is a client-side React hook.

* **Infra / CI** — the systemd *services* (mac VM, cloudflared ×2, pg-tunnel) and
  the `.github` nightly Actions cron are OS/platform-level, not operator work.
  `llm-test-nightly.timer` stays systemd too (a heavy external test-suite runner
  needing `ANTHROPIC_API_KEY`, \~90min — CI-shaped, not operator maintenance; D-004).

## The rule of thumb

DBOS scheduled workflows are for **periodic, durable, operator-process maintenance
jobs that read/write Postgres**. If a loop (a) runs in another runtime (Rust),
(b) is bound to a live in-process handle (socket/child/session/Map), (c) is
genuinely event-driven with the timer only a backstop, or (d) is OS/CI infra —
it stays where it is.
