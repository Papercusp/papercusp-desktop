# Operator v5
URL: /internal/docs/spec/operator-v5

The Operator panel — proactive workspace concierge. Tier-classified suggestions, server-authoritative auto-dispatch, lifecycle telemetry, plugin-authored sources.

import { Aside } from '@astrojs/starlight/components';

The Operator is the always-on concierge accessed from the chrome's Operator
button. It scans the workspace, surfaces up to \~5 next-action suggestions
per scan, and dispatches the safe ones automatically while routing the
risky ones for explicit user approval.

This page documents the v5 architecture (May 2026).

The v5 **data layer** still ships and is accurate: the 3-variant suggestion
union + tier resolver (`packages/operator-core/lib/operator-suggestion-schema.ts`,
`resolveActualTier` / `clampSuggestion`), the substrate tier table
(`packages/plugin-sdk/src/tier-table.json` + `lookupTier` in `tier-table.ts`),
plugin-tier resolution (`operator-plugin-tier.ts`), plugin-authored suggestions
(`operator-plugin-suggestions.ts` + the `contributeOperatorSuggestions` hook in
`@papercusp/plugin-sdk`), budget / rate-limit / trigger-state / fuzzy-dedup /
ack-latency / standing-candidates / message-status / audit / preferences modules,
and the two PG tables (`harness_shared.operator_scan_locks`,
`harness_shared.operator_dismissed_cards`).

Two things have moved or been superseded since this page was written, so treat the
lower sections as design-of-record rather than a live file map:

* **Paths moved.** Operator libs are now under `packages/operator-core/lib/operator-*.ts`
  (prefixed `operator-`), not `apps/operator/lib/operator-*`. The HTTP routes are
  Hono handlers under `packages/operator-core/lib/endpoint-route/routes/agent-mcp/operator-*.ts`
  (+ `routes/operator/`), not Next.js `app/api/.../route.ts`. Migrations `014`/`015`
  are squashed into `libs/papercusp/libs/db/sql/000-baseline.sql` (incrementals now
  start at `107`).
* **Scan/card pipeline + UI superseded.** The standalone SSE-scan concierge with an
  `OperatorPanel` / `OperatorBackgroundScanner` and modules like `suggestion-parser`,
  `scan-lock`, `idle-snapshot`, `card-reconstruction`, `last-scan`, `dismissed-cache`
  no longer exist as named files; the operator is now a **converse/chat** surface
  (`OperatorChat.tsx`, `OperatorConversationProvider.tsx`) and runs as a privileged
  blueprint (the `pot`, `kind: 'hive'` — see the Pot/operator-as-blueprint spec).

## Pipeline at a glance

```
LLM emits <suggestion> JSON
       ↓
Zod validates against discriminated-union schema  ← bad blocks dropped
       ↓
Server-side tier lookup (substrate → plugin tierMap → high)
       ↓
Compare LLM-claimed tier vs server-derived (mismatch → degraded flag, force authoritative)
       ↓
Derive auto_dispatch from (actualTier, preferences standing approvals)
       ↓
Append to scan SSE stream + `last-scan.json` + idle snapshot cache
```

## Action variants (3)

The schema is a discriminated union on `action`:

| `action`         | `capability`     | Tier                 | Behavior                                   |
| ---------------- | ---------------- | -------------------- | ------------------------------------------ |
| `send_directive` | `messages:write` | substrate-classified | dispatches a Directive to `target_harness` |
| `navigate`       | `null`           | always `low`         | renders an `Open <resource>` link          |
| `inform`         | `null`           | always `low`         | renders body text in the card              |

The earlier v4 had 4 variants (`draft`, `advise`); v5 collapsed them into
`inform` because they did the same thing.

## Tier table — substrate-authoritative

`packages/plugin-sdk/src/tier-table.json` is the single source of truth for
substrate-defined capabilities. The Operator pipeline calls
`lookupTier(capability)` and forces the LLM's claim to match. Wildcards
(`secrets:read:*`) match by segment.

Plugin-defined capabilities (`http:fetch:slack.com`, `compute:exec:my-tool`)
fall through to `null` from the substrate; the Operator then consults each
loaded plugin's `Plugin.tierMap` (added in v5). A plugin **cannot
downgrade** a substrate-known capability — that override is silently
ignored. Anything still unresolved → `high` (fail-safe → always asks).

## Lifecycle reducer

```
                          ┌─→ dismissed (deliberate, with optional reason)
                          │
                          ├─→ superseded (newer scan with same id)
                          │
suggestion arrives ──→ pending  ──→ dispatched ──→ consumed
                          │            │              │
                          │            │              ├─→ escalated
                          │            │              │
                          │            │              └─→ rejected
                          │            │
                          │            └─→ failed
                          │
                          └─→ undo-cancelled (audit-only, no preferences entry)
```

`unconsumed` is **not a state** — it's a UI rule: when a card has been
in `dispatched` for longer than the per-harness threshold (median ack
latency × 1.5, computed from `audit_log`), the card shows a warning
glyph. v1.5 (current) computes thresholds adaptively per
`target_harness`; the static fallback is 4 minutes when there's no
sample.

### Receiving-state derivation

After a successful `send_message` dispatch, the panel captures the
returned `messageId` and polls `papercup_shared.messages.status` every
10s. Mapping:

* `pending` → still `dispatched`
* `acknowledged` / `actioned` / `archived` → `consumed`

`escalated` is detected when the recipient harness sends a new message
TO `system:operator` (referencing the original) — the polling effect
flips the card and writes an `operator.escalated` audit row.

## Telemetry — every flip lands in `audit_log`

All 9 lifecycle states write to `harness_shared.audit_log` with
`actor='system:operator'` and `action='operator.<kind>'`. The minimum
needed for the Path-(a) escalation criterion (>25% of cards
dispatched-pending-ack for >2× cadence over a week) is `dispatched_at` +
`acked_at`; the others are now also written so a future analytics
consumer doesn't need a backfill.

## The four files in `<papercuspRoot>/system/operator/`

| File                       | Purpose                                                       | Lifecycle                                                                               |
| -------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `prompt-user.md`           | User-editable voice/tone, free-form prefs                     | edit at `/settings/operator`                                                            |
| `preferences.md`           | Workspace-scoped learned preferences                          | append-only via dismiss-with-reason + standing-approval; per-entry remove from settings |
| `last-scan.json`           | Most recent scan's emitted cards                              | rewritten on every scan; consumed for hydration                                         |
| `idle-snapshot.json`       | Cached cards keyed by trigger-state fingerprint               | 30 min TTL; short-circuits background scans on stable workspaces                        |
| `dismissed.json`           | Local cooldown cache (1h default)                             | mirrored to `harness_shared.operator_dismissed_cards` for multi-machine sync            |
| `first-run.json`           | `{shownAt, shownToUserIds}` for the intro modal               | per-(workspace, user) gate                                                              |
| `budget.json`              | Daily cap + last-7-days spend                                 | sized at first launch via Light/Active/Heavy modal                                      |
| `standing-candidates.json` | (capability, target) pairs Operator wants to standing-approve | recomputed after every dispatched audit-write                                           |

The substrate-owned `prompt-system.md` (tier rules, schema,
anti-patterns) ships as a TypeScript export
(`packages/operator-core/lib/operator-prompt-system.ts`) so it survives
bundling and can't be edited from the UI.

## Server-side policies

| Concern                  | Module                                                    | Behavior                                                                                                    |
| ------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Multi-tab dedup          | `operator-scan-lock.ts`                                   | PG row in `harness_shared.operator_scan_locks` (RLS-scoped, 60s TTL); concurrent tabs get 429 + Retry-After |
| Per-workspace rate limit | `operator-rate-limit.ts`                                  | 2 background scans/min default; manual rescans bypass                                                       |
| 503 circuit breaker      | `operator-rate-limit.ts`                                  | 5 consecutive PG 503s → 10 min cooldown; manual scans surface errors                                        |
| Idle short-circuit       | `operator-idle-snapshot.ts` + `operator-trigger-state.ts` | trigger-state fingerprint (unconsumed\_events + project statuses + operator inbox); 30 min TTL ceiling      |
| Daily budget             | `operator-budget.ts`                                      | first-launch sizing prompt; 402 from scan route on overrun                                                  |
| Dismissed cooldown       | `operator-dismissed-cache.ts`                             | 1h default per id; PG-mirrored for multi-machine sync (migration 015)                                       |
| Suggestion fuzzy dedup   | `operator-fuzzy-dedup.ts`                                 | Levenshtein-on-normalized-titles, 0.82 similarity threshold                                                 |
| Plugin-tier resolution   | `operator-plugin-tier.ts`                                 | walks loaded plugin manifests; substrate caps cannot be downgraded                                          |

## Client-side surfaces

`OperatorBackgroundScanner` is mounted in the chrome layout. It polls
`/api/agent-mcp/operator-trigger-state` every 30s; on a fingerprint
change it schedules a 60s debounced background scan (max-stall 5 min).
Auto-fire suggestions arrive via Sonner toasts with a 5s Cancel
countdown; the toast respects pause and never fires when the panel is
open (the panel is a stronger surface).

`OperatorPanel` hosts the three-pane layout. Reopening hydrates from
`/api/agent-mcp/operator-last-scan`, which the server merges with
`audit_log` lifecycle events (last 1h) + dismissed cooldown so cards
come back with their actual current state — not always `pending`.

## Plugin-authored suggestions

A plugin can implement `contributeOperatorSuggestions(ctx)` (in
`PluginHooks`) to inject deterministic suggestions into every scan.
Returns are validated against the same Zod union the LLM is held to,
then enriched through the same tier + auto\_dispatch pipeline. Cards
get `provenanceFlags.pluginAuthored: true` for UI display. Per-plugin
errors are isolated — a thrown hook never blocks LLM output.

Use case example: a Linear plugin can synthesize a suggestion when a
PR comment goes unanswered for >24h, without relying on the LLM to
notice it.

## Preferences learning

| Trigger                                                 | Provenance tag                                            | Effect                                                       |
| ------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| User dismisses with reason                              | `[USER-TYPED] [DISMISS]`                                  | appended to `preferences.md` + recent-undo strip in settings |
| User edits a directive then dispatches (Phase 4 future) | `[USER-TYPED] [EDIT]`                                     | appended                                                     |
| User pauses Operator mid-scan (Phase 4 future)          | `[USER-TYPED] [PAUSE]`                                    | appended                                                     |
| 3 silent dispatches of (capability, target) in 24h      | `[OPERATOR-PROPOSED-USER-CONFIRMED-…] [STANDING-APPROVE]` | candidate appears in settings; user approves                 |
| Undo-window cancel of an auto-fire toast                | (audit only)                                              | NOT a learning event — only `audit_log`                      |

The settings page (`/settings/operator`) renders the preferences with
per-entry remove + filter (All / User-typed / Operator-proposed). Recent
entries (last 24h) get an additional undo strip so a single misclick
doesn't lock in a wrong learning.

A CLI exists at `apps/operator/scripts/audit-prefs.ts` for users with
many entries:

```sh
npx tsx apps/operator/scripts/audit-prefs.ts list --filter user-typed
npx tsx apps/operator/scripts/audit-prefs.ts remove <key>
npx tsx apps/operator/scripts/audit-prefs.ts purge --before 2026-01-01
```

## Migrations

| Table                                     | Adds                                                             |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `harness_shared.operator_scan_locks`      | multi-tab dedup (PK `workspace_id`, `expires_at`)                |
| `harness_shared.operator_dismissed_cards` | multi-machine dismissed-card sync (PK `(workspace_id, card_id)`) |

Both ship in the squashed `libs/papercusp/libs/db/sql/000-baseline.sql`
(the original `014`/`015` increments were folded into the baseline). Both
are RLS-scoped to `app.workspace_id` per the standard substrate pattern.

## What's NOT in v5 (and why)

* **Auto-dispatch for `tier=high`** — would defeat the safety model.
* **Editable `prompt-system.md`** — would defeat substrate guardrails.
* **`dispatch_role` (Path a)** — held as documented fallback; activation criterion is measurable via lifecycle telemetry.
* **`pending_events`-based dispatch (Path c)** — substrate orchestrator polls (`TICK_INTERVAL_MS=30_000`) rather than `LISTEN`-ing, so this path is *slower* than `send_message`, not faster. Becomes viable when substrate is rewired.
* **Embedding-based suggestion dedup** — Levenshtein dedup ships in v5; embedding upgrade adds a service dependency for marginal gain.
* **Multi-workspace Operator view** — product/UX decision, not implementation gap.

## Module map

Live modules (`packages/operator-core/lib/operator-*.ts`). Entries marked
**(superseded)** were named in the original v5 design but no longer exist as
files — the scan/card pipeline they implemented was folded into the
converse/chat operator + the `pot` blueprint (see the caution box above).

```
packages/operator-core/lib/operator-*
  operator-prompt-system.ts    ← substrate prompt as TS export (read-only)
  operator-prompt.ts           ← assembles substrate + user + prefs
  operator-preferences.ts      ← preferences.md parser + writer
  operator-suggestion-schema.ts ← Zod 3-variant union + resolveActualTier/clampSuggestion
  operator-budget.ts           ← daily cap + spend
  operator-rate-limit.ts       ← per-workspace + 503 breaker (in-process)
  operator-trigger-state.ts    ← {events, projects, inbox} digest
  operator-audit.ts            ← writes to harness_shared.audit_log
  operator-message-status.ts   ← polls papercup_shared.messages.status
  operator-ack-latency.ts      ← median ack latency per harness
  operator-fuzzy-dedup.ts      ← Levenshtein on normalized titles
  operator-plugin-tier.ts      ← walks Plugin.tierMap (substrate-protected)
  operator-plugin-suggestions.ts ← gathers contributeOperatorSuggestions
  operator-standing-candidates.ts ← detector for auto-upgrade prompts
  (superseded) suggestion-parser / scan-lock / idle-snapshot /
               card-reconstruction / last-scan / dismissed-cache

Hono route handlers (packages/operator-core/lib/endpoint-route/routes/)
  agent-mcp/operator-config.ts          ← prompt-user + preferences read/write
  agent-mcp/operator-budget.ts
  agent-mcp/operator-preferences.ts     ← list/append/remove
  agent-mcp/operator-standing-approvals.ts
  agent-mcp/operator-audit.ts
  agent-mcp/operator-trigger-state.ts
  agent-mcp/operator-message-status.ts
  agent-mcp/operator-dispatch.ts
  operator/card-response.ts, operator/state-snapshot.ts, …

apps/operator/app/_components/ (operator UI — now converse/chat, not a scan panel)
  OperatorChat.tsx, OperatorConversationProvider.tsx, OperatorActionLog.tsx, …
```
