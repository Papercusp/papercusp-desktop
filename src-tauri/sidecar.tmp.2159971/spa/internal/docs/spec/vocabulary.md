# 2. Vocabulary
URL: /internal/docs/spec/vocabulary



Term
Definition
Example

Harness
A long-running iteration loop made of named roles invoked with fresh contexts that hand off via a structured state store.
The 4-role substrate in `libs/papercusp/packages/harness/`.

Install
A specific configured harness — its goal, its plugins, its UI, its DB schema. An install is what users actually run.
Papercup (papercupai.com): the 5-director autonomous-AI-company demo install.

Role
A named agent invocation — a prompt file + an entry in the orchestrator's decision table. Always with fresh context.
Scoper, Architect, Worker, Validator, Orchestrator (the shipped pipeline roles — see AGENT\_ROLES in packages/agent-mcp/src/role-config.ts). Plus user-defined roles via plugins.

Harness template
A reusable recipe for spinning up a harness. One template → many concrete harness instances; each instance has its own goal, project dir, state. Templates declare their roles, default models, and the plugins they recommend.
papercup-coding (the solo coding harness) and papercup-org (the 5-department company). One user spins up one instance of papercup-coding per project.

Plugin
A package that extends one or more harness instances with new capabilities — actions (buttons), routes, lifecycle hooks, DB schemas, custom UI tabs. Plugins are installed once globally and mounted into harness instances at runtime; their behaviour is gated by capability tiers (§10).
@papercupai/cloudflare-pages contributes a "Publish" button; @papercupai/vscode-server contributes a code-server tab; @papercupai/slack-notifier sends a Slack message on mission.done. Multiple plugins compose per instance.

Marketplace package kind
The discriminator that tells the marketplace + Cupboard which install pipeline a published artifact follows. Implemented as a three-kind storefront: plugin (default), pack (a runtime-less code-tool pack), and blueprint (a GitHub-repo-backed harness recipe — the term that superseded the original template).
All three go through the same publish + signing + retraction infrastructure; only the install handler differs.

Goal
The top-level mission. Every task traces back to a goal through a parent chain. Goals can themselves nest.
"Build a habit-tracker mobile app and ship to TestFlight" or "Run an autonomous marketing agency."

Pending event
An entry in the queue the orchestrator reads on each tick. Sources: cron routines, webhooks, API triggers, completion deltas.
Routine "weekly-briefing" fires at 9am Monday → inserts \{\{role: narrator, due: 09:00}}.
