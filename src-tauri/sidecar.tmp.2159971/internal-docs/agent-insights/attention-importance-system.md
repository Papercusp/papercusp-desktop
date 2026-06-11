# The attention/importance system (Planning tab)
URL: /internal/docs/agent-insights/attention-importance-system

How plan-item importance + the unified AttentionItem feed fit together, and two non-obvious gotchas — parseWarnings become lint ERRORS, and the Plans tab has no in-app chat host.

## What it is

Plan items carry an **importance** — a 4th axis orthogonal to status:
`urgent | high | normal | low` (default `normal`), written as an
`importance:` keyword on the item line and parsed glyph-agnostically like
`blocked-by:`. It drives the Planning-tab sort/badges, the orchestrator's
halt-on-`urgent`, and (eventually) the push threshold. Source of truth:
`@papercusp/plan-parser` (`IMPORTANCE_LEVELS`, `PlanItem.importance`); spec
at [plan-format §Importance](/internal/docs/spec/plan-format#importance);
rubric in [agent-policies §18](/internal/docs/agent-policies).

The Planning tab also shows a **unified attention feed**: one
`AttentionItem` read-model (`packages/operator-core/lib/attention/`) that every
"needs the human" surface adapts into — plan items, coord escalations,
coord messages-to-human, smoke-test failures, plans-awaiting-review. The
`plans:attention` tool unions them (best-effort per source), grouped by
plan + a synthetic per-harness "Alerts" bucket, importance-sorted. The UI
filter facets are ToDos / Needs Human / Blocked (plan-item statuses) +
Escalations / Messages / Smoke / Reviews (the non-plan-item kinds).

## Gotcha 1 — parseWarnings become lint ERRORS

`plans:lint` turns **every** `parsed.parseWarnings` entry into a hard
`parse_warning` **error** (`lint.ts`). So the parser must NOT push a
parseWarning for a recoverable condition like an unknown `importance:`
value — that would fail CI on a typo. Instead:

* the parser **degrades silently** to `normal` (no parseWarning), and
* `plans:lint` re-scans the item's `rawLine` and emits a soft
  `unknown_importance` **warning** (never an error).

If you add another tolerant item-keyword, follow the same split: degrade
in the parser, warn (don't error) in lint.

## Gotcha 2 — the Plans tab has no in-app chat host

The in-app agent chat (`ChatPanel` via `AdvChatPanel`) is hosted **only by
the `/adv` HarnessesDock**, opened by an `OPEN_CHAT_EVENT` that the dock
listens for (`openFeatureChat` → `POST /api/harness/:slug/agent-chats` →
dispatch event). The **Plans admin tab is not inside that dock**, so an
`openFeatureChat`-style call there creates a chat that opens nowhere
visible. The PlanItemPreview/PlanOtherList "Chat" buttons fall back to
`launchAgent` (an external OMP/claude terminal session), which on desktop
is invisible/no-op if the agent isn't configured — hence "Chat does
nothing."

To make Chat work in the Plans tab you must add a host (e.g. a modal that
creates a chat and renders `<ChatPanel slug chatId />` directly), and a
chat needs a **harness** (`agent_chats` is per-harness-schema) — pure SU
plans with no harness can't host one. This is the open work in
`planning-attention-importance-2026-05-31` P-017.
