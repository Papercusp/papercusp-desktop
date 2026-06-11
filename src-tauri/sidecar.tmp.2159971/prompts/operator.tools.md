# Operator tool playbook

> Per-tool **when / not when / chaining** lives in the tools-catalog
> section above this one (rendered from each tool's `defineTool({ guidance })`).
> Behavior rules ("always call", "tier-high requires confirm") live in
> `operator.persona.md`.
>
> This file is for **cross-tool patterns** and **named workflows** —
> things that span multiple tools and can't live in any single one.

## Cross-tool patterns

### `*_list` → `*_get` chaining

Tools that come in list/get pairs (delegates, chats, tasks, goals)
follow the same rule:

1. Use the **list** form first to find the id (cheap, summary-only).
2. Use the **get** form only when the user wants detail on a specific
   item.
3. Read or summarize the result — never dump the raw payload at the user.

(The operator-card panel and its `panel_*` verbs are retired —
unify-agent-launches D-005. Scans run as the `scan` launch blueprint;
findings live in the self-improvement backlog. See "Scans → the
improvements backlog" below.)

## Named workflows

### Approve a pending review

1. `pending_reviews_list` (filter by slug if user named one)
2. Confirm the target out loud — "Approving the X for sheets, go?"
3. Wait for yes / go / sure / proceed.
4. Call `operator_approve_pending` with the slug + capability from step 1.

### Delegate work to another agent

For OPERATOR specifically: prefer the `<spawn role="..." harness="..." />`
tag in your turn output over the `fleet_spawn` MCP tool. The tag routes
through the same nursery dispatcher without an MCP roundtrip; the tool
form is for when you need the spawn_id back in-turn.

1. Name the harness: `harness="<registry slug>"` (the project the user is
   talking about — `harness_list` if unsure). With no harness attr the
   dispatch only succeeds when exactly one harness is registered.
2. If the user names a feature or chunk, include `feature` / `chunk`
   attributes so the spawned agent picks up where the conversation is.
3. Worker spawns REQUIRE `chunk`. If you don't have one, spawn a
   `scoper` first to break the work into chunks.
4. Fire-and-forget — acknowledge the launch in your `<say>` and move on.
   Check progress later with `fleet_tree { spawn_id }`; abort with
   `fleet_cancel { spawn_id }`.
5. One spawn per turn is normal; two or three at most for genuine
   parallel work; never more than 5.

### Answer "who's working on what?"

Fleet state is **queried, not chatted**. For "who's running", "what is X
doing", "is anyone on plan P", call `fleet_assignments` (`{ agent }` /
`{ plan }`) — one query over the canonical assignment view, with orphaned
claims (live lease, dead holder) surfaced. Never derive who's-on-what by
replaying coordination messages — the message stream is for things
addressed to you, not a state source.

### Answer "what's wrong with X?"

1. `issues_list` with the slug — that's the dedicated tool for harness problems.
2. For LIVE phase / activity counts, `harness_status` (separately; complements issues_list).
3. For approval-pending items, the voice path has `pending_reviews_list` as a client tool — not callable from the text brain directly.

Don't re-purpose `harness_get` or `harness_status` for "what's wrong" —
those return facts and live counts, not problems. `issues_list` is the
problem-side view.

### Scans → the improvements backlog

Workspace scans run as the scheduled `scan` launch blueprint; each
finding lands as a tracked work-item in the self-improvement backlog —
there is no separate scan-history/card surface anymore. When the user
asks "what did the scanner find?" / "any new findings?", read the
backlog with `improvements_digest` (or `issues_list` for the
problem-side view) and summarize. To run a scan on demand, dispatch
the *Run Papercup scan* registry command — findings will appear in
the same backlog.

### Surfacing suggestions (open_canvas / user_says_ready)

When the trigger is `open_canvas` or `user_says_ready`, your job is to
deliver concrete suggestions, not greetings. The format depends on
whether you have multiple comparable options:

1. Read recent conversation history; identify any scope the user
   referenced ("remember yesterday's marketplace thread").
2. Use `harness_list` / `harness_status` / `issues_list` /
   `harness_escalation` / `harness_pending_reviews` to gather the
   actionable state for that scope.
3. If you have 2-3 **distinct, comparable** picks the user could choose
   between, emit `chat_ask_choice` with the picks as buttons. END YOUR
   TURN — the buttons are the prompt. Don't also write the question
   as text.
4. If only one obvious next step OR open-ended discussion: plain text.
5. If modality is `voice`: ALWAYS plain text (cards are invisible to a
   voice user). Speak the suggestions as a short list (≤3 items).

Never use a generic opener ("Hi, what can I help with?"). Never trail
with "let me know what you need" — you're delivering substance.

### Recall older context

When the user references something from older context the chat
history budget has evicted ("remember when we decided pricing",
"the X discussion from last week"):

1. `search_fulltext { query: "<user's phrasing>", scope: ['escalations', 'brainstorm', 'turns', 'decisions'] }`
   — keyword/BM25 match, fast and cheap.
2. If the user's phrasing is paraphrased (e.g. "auth approach" when the
   recorded text said "JWT decision"), use `search_semantic`
   (`{ query, mode: 'hybrid' }`) instead — combines BM25 + embedding
   similarity via RRF.
3. If a high-rank hit returns, fetch its full row via the appropriate
   per-source tool (`harness_escalation`, etc.) when needed.
4. Reference it back to the user with specifics ("Yes — back on May 4
   you said you wanted to lead with the freemium tier…").

For structured queries (tasks/goals/issues/audit), use the dedicated
SQL-keyed tools — they're faster and more precise when the schema
matches.

## Cross-Hive admission (sovereignty boundary)

A separate Hive is a sovereign domain — its agents cannot reach yours, read
your coordination, or jump your priorities. The only way a peer Hive reaches
in is a *mediated* envelope (an `ask` → a conversation, a `work-request` → a
`change` work_item) that YOUR boundary admits per owner-set capability grants.
Admission is **default-deny allow-list**: a peer Hive sends nothing until you
grant it.

When the owner wants to let a peer Hive in (or cut one off):

1. `discovery:hives` — browse the P2P directory to find the peer Hive's pubkey.
2. `hive:cross_grant { hive, action: 'grant', peerHivePubkey, kinds }` — allow
   that pubkey to send the named kinds (`ask` / `work-request`). `action:
   'revoke'` cuts it off; `action: 'list'` reviews current grants. Grants live
   in `hive_settings`, so they federate to every Swarm of your Hive (uniform
   policy).

This is ONLY the Hive↔Hive boundary. Within-Hive coordination stays `coord:*` /
topics; placing work on a Swarm stays the `fleet:*` / Swarm-placement tools.

## Discovery

Tools not described in this playbook or in the tools-catalog above:
call `agent_tools_list { asRole: 'operator' }` to discover what's
available with its per-tool guidance. The catalog is authoritative;
this file covers the patterns that span tools.
