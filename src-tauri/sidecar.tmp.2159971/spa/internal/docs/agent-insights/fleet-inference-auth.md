# Don't infer the fleet's inference plan from credential presence — check the wire
URL: /internal/docs/agent-insights/fleet-inference-auth

Agents repeatedly conclude "the fleet runs on the Claude Max subscription" from the presence of a `subscriptionType: max` OAuth in `~/.claude/.credentials.json`, without checking what the spawned `claude -p` bee actually presents on the wire. Credential presence ≠ the subscription serving the workload. Cost telemetry and 429s reinforce the wrong conclusion. Run `npm run check:fleet-auth` for the ground truth.

## The recurring mistake

When the fleet is rate-limited and someone asks "are we on the API or the Max plan?", agents
check `~/.claude/.credentials.json`, see a `claudeAiOauth` block with `subscriptionType: max`, and
conclude **"we're on Max, this is just a transient throttle."** This conclusion is reached over and
over, and it skips the one thing that actually answers the question: **what the spawned `claude -p`
process authenticates with on the wire, and whether that auth is the right one for a headless fleet.**

The presence of OAuth credentials does **not** prove the subscription is usefully serving the
workload. Two signals actively mislead:

1. **Cost telemetry looks like API billing.** claude-code reports a **non-zero `total_cost_usd`
   even on a subscription** — it's an *equivalent-cost estimate* (tokens × list price), not a bill.
   `harness_shared.agent_usage_samples` stores it with `cost_source: provider`. So agents see real
   dollar figures and conclude "API key." Wrong — the number is the same shape on both plans.
2. **It 429s, so it "looks like it's working, just busy."** A rate-limited bee is *authenticated*
   (429, not 401), so the auth obviously "works" — which gets read as "Max is fine, back off and
   retry." But on a consumer subscription driven headless at fleet concurrency, the throttle is the
   **structural** symptom, not a transient blip.

## The ground truth: check the wire, not the config

Run:

```bash
npm run check:fleet-auth        # scripts/check-fleet-auth.mjs
```

It runs one real `claude -p` call with `ANTHROPIC_LOG=debug` (the SDK's HTTP logging — **this**, not
the `--debug` flag, dumps the request) and classifies the **actual request auth**:

* **`x-api-key` header present** ⇒ an **API key** (pay-per-token, proper API rate-limit tiers).
* **`authorization: Bearer …` + `anthropic-beta: oauth-…`** ⇒ the **subscription OAuth**.

It also greps every spawn-relevant env (`process.env`, `.env.local`, the `papercup-{dev,staging}-api`
host process envs via `/proc`) for `ANTHROPIC_API_KEY` — the only thing that flips a `claude` spawn
off the OAuth path (claude precedence: `ANTHROPIC_API_KEY` env → `apiKeyHelper` → OAuth file).

## What was verified on this box (2026-06-08)

Every layer was traced, not inferred:

| Layer           | Finding                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Command         | `AGENT_CMD=claude` on both hosts → bees run raw `claude -p` (not omp/Meridian)                                                         |
| API key         | **None** anywhere — host envs, `.env.local`, shell, `~/.claude.json`, `settings.json`, no `apiKeyHelper`/`forceLoginMethod`            |
| Per-spawn creds | `writeSpawnClaudeConfig` (spawn-mcp.ts) **symlinks `~/.claude/.credentials.json`** (the Max OAuth) into each bee's `CLAUDE_CONFIG_DIR` |
| **Wire**        | request sends `authorization: Bearer …` + `anthropic-beta: oauth-2025-04-20` — **subscription OAuth, not `x-api-key`**                 |

So the fleet **does** authenticate with the Max OAuth. But that is the trap's other half:

## The part that matters — a consumer subscription is the wrong auth for a headless fleet

A consumer **Pro/Max** subscription is gated for **interactive, single-session** Claude Code.
Driving it **headless (`claude -p`) at fleet concurrency** (a hive of opus-xhigh agents + N bees
through one OAuth) gets throttled hard — `"Server is temporarily limiting requests (not your usage
limit)"`. The subscription is technically the auth, but the fleet is **not getting usable Max
throughput** from it. In the sense that matters, *the Max subscription is not actually serving the
fleet* — which is the real thing to discover, and the thing the "creds exist → Max → fine" shortcut
misses.

**The fix for a production fleet is a real `ANTHROPIC_API_KEY`** (or Bedrock / Vertex) with an
appropriate rate-limit tier — set it in the spawning host's env so `claude` picks it up
(`x-api-key`), and lean on the API's proper rate-limit headers instead of fighting a consumer
throttle. The fleet's AIMD concurrency back-off + the Apiary runner's rate-limit relaunch
(`bee-instance.ts`) mitigate the throttle but cannot fix an auth/workload mismatch.

## TL;DR for the next agent

* **Do not** answer "API vs subscription" from `~/.claude/.credentials.json`. Run `npm run check:fleet-auth`.
* A non-zero `total_cost_usd` does **not** mean API billing (it's an estimate even on a subscription).
* A 429 means *authenticated-but-throttled*, not "working fine."
* If the fleet is persistently rate-limited on subscription OAuth, that's a structural mismatch —
  recommend a real API key, don't just back off.
