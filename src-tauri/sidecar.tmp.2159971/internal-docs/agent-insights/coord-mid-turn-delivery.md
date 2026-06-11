# Mid-turn coord delivery (Claude / Codex / OMP)
URL: /internal/docs/agent-insights/coord-mid-turn-delivery

How new coord:inbox messages reach a RUNNING agent between tool calls — not just at session/turn start — per client, why it's prompt-cache-safe, and the holder-intent enrichment on lock blocks.

## What it is

A peer's `coord:send` used to reach an agent only at **session start** (the
prompt tells SU agents to call `coord:inbox` once) or, for OMP, at
**turn start** (the `coord-hook.ts` reminder). A long turn could run for
minutes — many tool calls — blind to "stop, I'm refactoring that file."

Mid-turn delivery closes that: after **each tool call**, the agent's own
tool cadence is used to poll `coord:inbox` for messages newer than a cursor
and inject any new ones. No model discipline (an LLM can't keep a wall-clock
timer); the **system** rides the tool stream.

## Per client — three mechanisms, one behavior

| Client     | Where                                                                                 | Mechanism                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude** | `~/.claude/settings.json` PostToolUse, matcher `*`                                    | `apps/operator/scripts/hooks/cc/posttooluse-coord-inbox.sh` → `hookSpecificOutput.additionalContext` (exit 0, **no** `decision`).                                                                                                                                            |
| **Codex**  | per-session `$CODEX_HOME/hooks.json` PostToolUse, matcher `.*` (**SU sessions only**) | same script, written by `role-codex-home.ts` `writeSuCodexHome` with a **baked `PAPERCUSP_SID`**. Codex fires PostToolUse for **Bash / apply\_patch / MCP** (not WebSearch) — independent of the PreToolUse-on-edits gap (#20204) that keeps the *lock* hook inert on codex. |
| **OMP**    | `coord-hook.ts` `tool_result` handler                                                 | `pollInboxDelta()` → `pi.sendMessage(…, { deliverAs: 'steer' })`. `ToolResultEvent` carries no content, so steer-append is the vector (not content-replacement).                                                                                                             |

The shell hook **gates on `PAPERCUSP_SID`** (psu sessions only) + the su-token,
so a plain `claude`/`codex` on the box no-ops. `owner == PAPERCUSP_SID`, which is
the same id baked into the agent's MCP `&client=`, so the hook reads the *right*
inbox/watermark.

## The cursor / dedup protocol

* **Per-owner cursor.** Claude/Codex: a local file `coord-cursor-<owner>.json`
  in `~/.papercusp/locks-cache/`. OMP: a module var seeded at `turn_start` to
  the newest ts surfaced, advanced on each `tool_result`, persisted to the
  watermark at `turn_end`.
* **First run seeds to "now"** and injects nothing — the session-start
  `coord:inbox` already showed the backlog; only *new* arrivals inject.
* Each message injects **exactly once** (cursor advances past it); newest are
  shown when capping (8), older summarized as a count.
* **Fail-open + best-effort:** operator unreachable / no baseline → no-op, never
  blocks the tool, never crashes the turn.

## Why it does NOT bust the prompt cache

The injection is a **tail append** — it lands *after* the latest tool result,
past every cache breakpoint. The cached prefix (system prompt, tools, prior
turns) is untouched, so you keep the cache hit on the bulk of the context; only
the injected tokens (capped, and only when there's new mail) are processed once
as part of the new suffix, then themselves cached. What *would* bust it is
inserting/modifying content **earlier** in the conversation — the hook never
does that. So freshness is essentially free on cache terms.

## Companion: holder-intent on lock blocks

`locks:acquire` busy rows now carry **`holder_intent`** + **`holder_focused`**
(`acquire.ts` `enrichBusy` → `coord:presence`). The auto-acquire hook stamps a
generic `intent: 'PreToolUse:Edit'`, so a blocked peer used to see junk; now it
sees the holder's **declared** `coord:declare-intent` one-liner (and a flag when
the contended path is in their `current_files`). **Declare a real intent** so
your locks explain themselves.

## Gotchas

* **No MCP `tools/list_changed`** is emitted, so a tool-surface change (add/remove
  a verb) leaves *running* agent sessions with a **stale cached catalog** until
  they relaunch. New sessions are correct.
* **Codex coord hook is SU-only** (pipeline-role sessions coordinate via
  `messages:send`/`inbox`, not the SU coord bus) and activates server-side on the
  next operator restart (the `:3070` host has no hot-reload).
* **OMP `deliverAs:'steer'`** delivering mid-turn is verify-at-deploy — the
  fetch/format/dedup path is live-verified, but steer-into-a-running-turn needs a
  real OMP turn to observe.
