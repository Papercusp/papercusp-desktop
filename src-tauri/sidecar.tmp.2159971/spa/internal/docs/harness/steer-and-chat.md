# Steering & chat
URL: /internal/docs/harness/steer-and-chat

Which surface to use to steer running agents — durable messages, role-scoped chats, live coord nudges, turn interruption, and human gates.

The first-generation harness had one steering surface: a chat box in the
retired web UI. Today steering is several purpose-built surfaces; picking the
right one matters because they differ in durability, latency, and who reads
them.

## Which surface for which job

| You want to…                                                        | Use                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------- |
| Leave durable direction/context for whoever works a feature next    | `messages:send` (work-item-scoped)                              |
| Have an interactive conversation with a role agent inside a harness | `agent_chats:*`                                                 |
| Nudge a *live* agent right now (or wake an idle one)                | `coord:send` (with `wake: true`)                                |
| Make a running agent stop / wrap up                                 | `turn:interrupt`                                                |
| Answer a question an agent asked                                    | the decision card / `conversations:answer` / `coord` escalation |
| Steer the whole Pot (not one agent)                                 | the operator chat surface                                       |

## Durable messages — `messages:*`

`messages:send` (`packages/operator-core/lib/agent-tools/messages/send.ts`)
writes a durable message that survives across spawns — the right surface for
inter-agent hand-offs and human direction tied to work. Messages are
**work-item-scoped**: with `to_feature_id` set they form that feature's
thread; without it they're harness-level
(`packages/agent-mcp/src/tools/messages/inbox.ts`). Every fresh spawn working
that item reads the thread via `messages:inbox` — this is how direction
reaches a [fresh context](/internal/docs/harness/decisions/fresh-contexts)
that didn't exist when you wrote it.

## Role-scoped chats — `agent_chats:*`

For an interactive back-and-forth with a role agent inside a harness (the
"pair" primitive): `agent_chats:create` opens a persistent chat,
`agent_chats:chat` streams a turn
(`packages/operator-core/lib/agent-tools/agent_chats/chat.ts` — transcripts,
cost rollup, and feature-lock checks handled server-side), and
`agent_chats:send_message` is the fire-and-forget non-streaming append used
by autonomous dispatches. Use this when you want a conversation; use
`messages:*` when you want durable direction.

## Live coordination — `coord:*`

`coord:send` reaches a *live* (or wakeable) agent's coordination inbox;
deltas are injected into the recipient mid-turn after its tool calls. With
`wake: true` it re-invokes an idle agent — agents are armed for inbox-wake at
session start, and a wake that woke nobody returns a `woken: 0` warning
rather than failing silently. `coord:escalate` raises a durable escalation a
human (or the operator) must resolve. Don't use coord for state that must
outlive the session — that's what messages and work items are for.

## Turn interruption — `turn:interrupt`

To make a running agent stop, `turn:interrupt`
(`packages/operator-core/lib/agent-tools/turn/interrupt.ts`) supports two
modes — operator-mediated, reason-required, audited, and storm-rate-limited:

* **cooperative** — injects a high-priority `yield` line into the target's
  coord stream; the agent finishes its atomic step, releases locks,
  checkpoints state, and ends its turn.
* **force** — ends the turn *now*, mid-thought (Ctrl+C to a managed pty /
  SIGINT headless); no checkpoint is guaranteed.

You cannot interrupt your own turn.

## Human gates: questions, escalations, approvals

Agents pause for humans through structured gates rather than free chat: a
mid-tool decision card (`ctx.askUser` / `chat:ask_choice`; with the
`papercusp-inbox-durable-escalations` flag the card is also mirrored to a
durable coord escalation so it can be answered later from the inbox),
knowledge-first questions routed by topic (`coord:ask` → a conversation
answered via `conversations:answer`), pipeline escalations
(`harness:escalation` surfaces the blocker; resolution re-enters the
pipeline), and plan items marked `needs-human` (which also block a DONE
finalization — see [Smoke-test gate](/internal/docs/harness/smoke-test) for
the gate family).

## Observing without steering

`fleet:bee_mail` renders what a specific agent has received/sent (the
bee-dossier view) — for *inspection*, not for reading your own inbox
(`coord:inbox`) or deriving who's-on-what (`fleet:assignments`). The
fleet-wide steering surface — scheduling, placement, prioritization — is the
operator/Queen's job; see
[Operator persona](/internal/docs/agents/operator-persona).
