# Cross-harness coordination
URL: /internal/docs/spec/cross-harness-coordination

Tiered visibility, send_message bus, and the inspect-on-demand capabilities that let any harness coordinate with any other.

> **Webapp retired (2026-05-14).** Any `localhost:3055` or `localhost:3070` URL on this page is only reachable while the **Tauri dev shell** is running. Start it with `cd papercusp-desktop && npm run dev`.

import { Aside } from '@astrojs/starlight/components';

Cross-harness coordination is built on three primitives:

1. **Tiered visibility** in every role's prompt — Tier 1 (substrate self-description), Tier 2 (depth-1 neighbor view), Tier 3 (read APIs to inspect anyone on demand).
2. **`send_message` action** — any harness with `send_message` in its role's `allowedActions` can post to any other harness's inbox. Server derives `from_slug` from the bearer token; spoofing prevented at the protocol level.
3. **Bounded inbox in prompt-build** — each role's prompt includes pending messages from its `parent_slug`. Auto-acknowledged on DONE/NEXT\_\*; preserved on ESCALATE/REVIEW.

## Tier 1 — substrate self-description

Every role's prompt opens with a short preamble explaining what Papercusp is, what `parent_slug` means, and which actions are gated by `allowedActions`. Identical text across every harness; \~300 tokens.

## Tier 2 — neighbor view

Depth-1 view, fetched at prompt build time:

```markdown
## Neighbor harnesses

### Parent: papercup-org
- 0 features, spawned 6
- Last message between us: 2026-05-01T15:51 [Priority] "focus on auth"

### Children (3) — aggregate: 23 features, 15 passed, 5 in_progress, 3 todo
- papercup-coding-helloworld: 12 features, 8 passed, 1 in_progress, spawned 0
- papercup-coding-stripe-int: 4 features, 0 passed, 2 in_progress, spawned 0
- papercup-service-billing: 7 features, 7 passed, spawned 2

### Siblings (5, share parent papercup-org)
- papercup-org-business: in_progress, 18 features
- papercup-org-rd: in_progress, 9 features
- ...
```

`spawned_count` per child surfaces grandchild existence without paying for a deeper recursive view; the agent can drill down via Tier 3 if a grandchild matters to its current task.

## Tier 3 — inspect-on-demand

Every prompt lists curl commands the agent can use:

```markdown
## Available read capabilities

- curl http://localhost:3055/api/harness/projects                       — full registry
- curl http://localhost:3055/api/harness/<slug>/status                  — full state of any harness
- curl http://localhost:3055/api/harness/<slug>/inbox                   — any harness's inbox
- curl http://localhost:3055/api/harness/<slug>/outbox                  — any harness's outbox
- curl http://localhost:3055/api/harness/all/recent-activity?limit=N    — global audit feed
- curl http://localhost:3055/api/marketplace/spawnable                  — templates you can spawn
```

These are **operator-local reads** — no auth needed. Writes always go through `/api/admin/execute-action` with a bearer token.

The curl path works because agent CLI invocations from the orchestrator (whether `omp -p`, `claude -p`, or `codex`) don't restrict `--allowed-tools` — `Bash` is available by default. The same reads are also exposed as first-class `cross_harness:*` MCP tools (`inbox` / `outbox` / `recent_activity` / `plans_*` / `docs_*`), which an agent can call directly without shelling out to curl. (The legacy bash `run.sh` run-loop is retired.)

## `send_message` action

```ts
{ "op": "send_message",
  "to": ["recipient-slug-1", "recipient-slug-2"],
  "kind": "Directive" | "Decision" | "Priority" | "Budget" | "Completion" | "Status" | string,
  "subject": "<short>",
  "body": "<details>",
  "parentMessageId": "<optional UUID to thread>",
  "reason": "<≥10 chars explaining why this message is being sent>" }
```

### `reason` quality

* Minimum 10 characters (rejected with `validation_error` otherwise)
* Placeholder regex (`/^(test|todo|asdf|reason|tbd|na|x+|y+|\.+)$/i`) is flagged in the audit log but **not blocked** — author can pass through if they want, but the audit feed will surface low-quality reasons.
* Goes into `harness_<caller>.executed_actions.reason` (indexed) for retrospective audit.

### Side effects

* One row per recipient inserted into `harness_<recipient>.messages` with `from_slug = <derivedCallingHarness>` (token-bound), `status = 'pending'`.
* If `kind === 'Directive'`, the substrate also appends to `harness_<recipient>.supervisor_notes` so the receiver's next prompt-build surfaces fresh guidance.
* Senders cannot pre-acknowledge; status changes only via `mark_message_status` from the recipient's own bearer.

## Auto-acknowledge

The bounded-inbox prompt-build section (Step 4.6) is auto-cleared by the substrate when the iteration's orchestrator decision is in the "happy progression" set:

* Cleared on: `DONE`, `NEXT_WORKER`, `NEXT_VALIDATOR`, `NEXT_ARCHITECT`, `NEXT_HARNESS`, `NEXT_TESTER`, `NEXT_SECURITY`, `NEXT_MONITOR`, `NEXT_DEBUGGER`, `GENERATE_TESTS`, `RUN_TESTS`
* **Preserved on: `ESCALATE`, `REVIEW`, `FEATURE_FREEZE`, non-zero exit** — so a user who escalates and then redirects sees their original message again.

## Discovery convention

Use Tier 2 (depth-1 view) for the common case. Use Tier 3 only when:

* You need state of a sibling at >depth-1 (e.g. a child's children)
* You need a specific message body, not just metadata
* You need the audit feed for forensics

This keeps prompt size bounded; Tier 3 calls are paid for only when the agent decides they're warranted.
