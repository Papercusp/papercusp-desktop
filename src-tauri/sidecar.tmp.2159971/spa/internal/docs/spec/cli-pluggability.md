# 16. CLI pluggability
URL: /internal/docs/spec/cli-pluggability



import { Aside } from '@astrojs/starlight/components';

The substrate invokes role agents by spawning a CLI subprocess. The default is `omp -p` (routes through Meridian + Claude Max OAuth); `claude -p` is also fully supported via `AGENT_BACKEND=claude-code`. That CLI is a **substitution point**, not a hard dependency. Anything that satisfies a small contract can drive a role.

## The CLI contract

To be usable as a Papercusp role driver, a CLI must:

1. Accept a non-interactive flag that prints the model's response and exits (e.g. `claude -p`, `pi -p`, `aider --message`).
2. Accept a system prompt as a flag or file (`--system-prompt`, `--append-system-prompt`, etc.). Papercusp injects the role prompt this way.
3. Read the user prompt from stdin **or** from a positional argument.
4. Be stateless across invocations by default (or have a flag that forces stateless, e.g. `--no-session`). The substrate's "fresh context per role" contract ([§3.2](/spec/harness-contract/#32-fresh-context-per-role)) demands no carryover between calls.
5. Optionally emit a structured event stream the substrate can parse for cost, tool calls, and decision verbs (`stream-json`, JSONL, JSON-RPC, etc.).

CLIs that satisfy 1–4 work today as-is. Item 5 is required only for full audit/cost integration; without it the substrate falls back to plain-text parsing.

### Auth pass-through

The CLI subprocess inherits the user's shell environment, so the substrate never sees credentials. Both `claude -p` and `pi -p` honor `ANTHROPIC_OAUTH_TOKEN` (set when the user is logged into Claude Code), making **Claude Max subscriptions usable through any compliant CLI** without API keys flowing through the substrate. Anything else (OpenAI keys, Gemini, Bedrock profile, etc.) flows the same way: the user's env is the source of truth.

### Structured output modes

CLIs that satisfy item 5 expose richer integration:

| Mode                   | Use                                                                                           | Shape                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `text` (default)       | Plain output to stdout. Parser scrapes the decision verb from the tail.                       | Loose.                                                                          |
| `stream-json` / `json` | One JSON event per line. Session header, then tool calls, message deltas, completion.         | Tightly typed; substrate can plumb individual events into the audit log.        |
| `rpc` (JSON-RPC)       | Handshake-first bidirectional protocol. Driver sends method calls; CLI emits events with ids. | Strongest; lets the substrate steer mid-call (e.g. cancel a long-running tool). |

The reference runtime's `invoke.ts` parses claude's `stream-json` today; pi emits a compatible JSONL event stream under `--mode=json` (verified empirically). The `rpc` mode is a future optimization for richer driving.

## Three substitution patterns

### Whole-harness substitution

Set `CLAUDE` (or its equivalent) at startup and the entire harness runs through the chosen CLI. Lowest-friction path; useful for whole-harness experiments (e.g. validating a different model family).

### Per-role substitution

Per-role config in `config.json` already supports model + prompt + timeout overrides. Add `cliBin` to the same shape and a single role can run on a different CLI than its peers. Concrete pattern:

* `worker` runs on a CLI with a strong tool harness (e.g. `pi`) where breadth of tool access matters.
* `orchestrator` / `validator` / `planner` stay on the default (e.g. `claude`) where structured-decision reliability matters more than tool surface area.

This is the recommended split — control roles are decision-heavy and short, worker roles are tool-heavy and long.

### Embedded interactive driver

The harness UI can host an interactive instance of the CLI (alongside the autonomous loop) so a human operator can drop in mid-mission and steer. The mechanism is a PTY in the sidecar bridged to an `xterm.js` pane in the dashboard. See [Pi integration](/internal/docs/implementation/pi-integration) for the reference design — it generalizes to any CLI that ships a TUI.

## Two-layer pluggability (a worked example)

Papercusp's role-CLI substitution is the outer layer. Modern CLIs increasingly expose their *own* model-pluggability layer underneath. Pi (`omp`) is the cleanest example — it has four model slots, each independently selectable:

| Pi slot       | Flag / env                 | Intent                                                                      | Suggested papercusp pairing                                                            |
| ------------- | -------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Default model | `--model` / (none)         | The agent's main reasoning model.                                           | Worker role's main calls.                                                              |
| Smol model    | `--smol` / `PI_SMOL_MODEL` | Cheap fast model for lightweight subtasks (file lookups, short tool plans). | Cost-sensitive roles like the orchestrator's own tick or the validator's verdict scan. |
| Slow model    | `--slow` / `PI_SLOW_MODEL` | Strong reasoning model for thorough analysis.                               | Architect role; debugger when feature attempts ≥ threshold.                            |
| Plan model    | `--plan` / `PI_PLAN_MODEL` | Architectural planning model.                                               | Pre-loop scoper / planner role.                                                        |

The result: **per-role CLI selection (papercusp) × per-slot model selection (pi) = a 16-cell cost/quality matrix** the user controls without writing code. A user can run orchestrator + worker on pi (with cheap smol + expensive worker) and validator on claude (for decision-trace consistency), all via config.

This pattern isn't pi-specific. Any CLI that exposes role-flavored model selection composes the same way — papercusp's substitution layer doesn't need to know about it; the CLI's own flags carry the meaning.

## Why this isn't in the harness contract

CLI pluggability is a property of the **reference runtime**, not the substrate contract. A different runtime could embed an SDK directly, run a local model, or call a hosted endpoint — what makes it Papercusp is the four-role contract, structured state, fresh context, named decisions, and atomic checkout. The CLI subprocess pattern is one implementation choice the reference runtime makes for two reasons:

1. **Auth pass-through.** The user's existing Claude Max / pi / aider session is reused without the substrate ever seeing API keys.
2. **Provider-portability.** New CLIs ship monthly; swapping one in is a config change, not a substrate change.

A future spec revision may codify a `RoleDriver` interface (`invoke(prompt, ctx) → AsyncIterable<Event>`) that wraps either a CLI subprocess or an in-process SDK. For now the contract is informal; the reference runtime's TS orchestrator (`libs/papercusp/packages/orchestrator/src/invoke.ts`) is the de-facto definition.
