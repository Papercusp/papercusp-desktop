# Inbox items are durable cards — reuse the renderer, not the ctx.askUser lifecycle
URL: /internal/docs/agent-insights/inbox-cards

The Planning inbox renders every human-facing AttentionItem through the same AskChoiceCard/InputCard the chat uses, via a durable third emitter — NOT by routing items through the run-blocking ctx.askUser. Terminal vs navigate options is the key convention.

## The trap

The operator has a nice "card system" — `AskChoiceCard` / `InputCard`
(`app/_components/chat/`) — that agents drive via `chat:ask_choice` →
`ctx.askUser`. It's tempting to route the whole Planning **inbox** (escalations,
coord messages, needs-human plan items, smoke-fails, plan reviews) through the
same `ctx.askUser` so everything that reaches the human is "a card".

**Don't.** `ctx.askUser` is a *live, synchronous, ephemeral* handshake: the card
exists only while an agent is **blocked inside the tool call**, and the human's
click is the tool's return value. The inbox is the opposite — *durable,
asynchronous* records that are resolved later and read by the agent on its
**next** run. Nothing is blocked waiting. Forcing the inbox through `ctx.askUser`
would mean pinning agents alive blocking on a human.

## The split that actually works

Reuse the **renderer**, keep the **lifecycle** separate:

* **Renderers** (`AskChoiceCard`, `InputCard`) are pure presentational
  components — no context, no hooks, no transport coupling. Reuse them anywhere.
* There are now **three emitters** feeding those renderers, all dispatching by
  presentation:
  1. server SSE state-channel → `PendingCardsBar` (the live `ctx.askUser` path),
  2. client `askUserLocal` registry → `LocalCardHost`,
  3. the **durable inbox** → `app/admin/plans/attention-card.ts`.

The inbox emitter is two pure functions:

* `attentionItemToCardSpec(item)` maps an `AttentionItem` → `AskChoiceArgs`.
  `item.actions[]` is the single source of truth (so the adapter in
  `packages/operator-core/lib/attention/adapters.ts` must emit the *complete*
  set — see the gotcha).
* `resolveAttentionAction(item, optionId)` dispatches a **terminal** pick to the
  item's existing backend helper (`resolveEscalation` / `ackCoordMessage` /
  `setItemStatus`) via the `/api/admin/coord/:verb` proxy — no new route, because
  `defineTool` already projects the coord tools onto HTTP.

## Terminal vs navigate — the option convention

`AskChoiceOption` has an optional `terminal?: boolean` (default `true`):

* **terminal** options *answer* the card: click → `{action:'submit'}`, card
  disables. Inbox: `resolve` / `mark-done` / `drop` / `ack`.
* **navigate** options (`terminal:false`) *open a sub-surface* and leave the card
  live: click → `{action:'navigate', option_id}`. Inbox: `chat` (inline
  `PlanChat`), `answer` (inline `InputCard`), `view-log` / `open` (harness view).

`resolveAttentionAction` only handles terminal ids; the component owns navigate.

## Gotchas that will bite you

* **The adapter must emit the full action set.** `AttentionActionId` originally
  lacked `answer` and `drop`, and a needs-human item's `actions[]` was only
  `[mark-done, chat]` — Answer/Drop were **hard-coded in the UI**
  (`InboxItemActions`). An `actions[]`-driven mapper silently loses anything the
  adapter doesn't emit. Add the action to `AttentionActionId` *and*
  `planItemToAttention`, and mirror the union in the client wire type
  (`plans-api.ts`).
* **Preserve `resumeLoop`.** Plan-item Resolve/Answer POST
  `/api/harness/:slug/launch?phase=staging` to resume the orchestrator; **Drop
  deliberately does not**. Centralizing the dispatch must keep that distinction
  (parity-test it).
* **No "Skip" on durable cards.** `AskChoiceCard` shows a Skip (`decline`) by
  default; `decline` is undefined for a durable record. Render inbox cards with
  `allowDecline={false}`.
* **Inline chat needs a bounded height.** `ChatPanel` is `height:100%`; give the
  inline host (`.pc-plan-chat-inline`) a fixed height or it collapses.

See the plan `inbox-cards-unification-2026-05-31` and the predecessor
`planning-attention-importance-2026-05-31` (P-017, superseded).
