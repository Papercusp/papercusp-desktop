# Operator persona — implementation status
URL: /internal/docs/agents/operator-persona

What ships, where it lives, and how to operate it. The voice operator's persona, narration, backstory, cost controls, and EL Conv AI integration as actually built.

# Operator persona — implementation status

**Status: shipped.** This document used to be a plan; it's now a map of
what's live and how to operate it. The original v2 plan is preserved
below as historical context; the §Implemented sections at the top
reflect the actual code.

The voice operator runs primarily on **ElevenLabs Conversational AI**
(STT + Claude Haiku/Gemini Flash via BYO LLM + TTS in one WebRTC
session), with **OpenAI Realtime** as fallback and a **legacy
Whisper+Claude+TTS** path for environments where neither realtime
provider is available.

## §Implemented — feature surface

### Persona injection (PR 1, commit `2368d33`)

Provider-agnostic persona prompt loaded at session start:

| Path                  | Where the persona lands                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| EL Conv AI            | `overrides.agent.prompt.prompt` at session-start (requires "Override prompt" enabled on the EL dashboard; see §EL setup) |
| OpenAI Realtime       | `RealtimeAgent.instructions` (set in code, no dashboard config needed)                                                   |
| Legacy STT+Claude+TTS | Claude system prompt; `prepareForTTS` enforces length caps + anti-pattern stripping                                      |

Source of truth: `apps/operator/prompts/operator.persona.md`. The
runtime constant `OPERATOR_PERSONA_PROMPT` in `packages/operator-core/lib/operator-persona.ts`
mirrors the .md exactly. Edit either; running `el-agent-sync.mjs`
pushes the .md to the EL dashboard.

### Long-op narration (PR 2, commits `5d447df` + `e063c39` + `97e0d6a`)

Side-channel TTS announces start/mid/completion for long ops. **Bypasses
the EL Conv AI agent** — uses the existing `/api/agent-mcp/operator-tts-preview`
endpoint with stored ElevenLabs/OpenAI/Cartesia keys. Doesn't burn
Conv AI minutes.

| Op         | Wired                                                                                                                                   | Kickoff                                           | Mid (cadence)                                                                     | Completion                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Replan     | `HarnessDashboard.replanHarness`                                                                                                        | `"Replanning {slug}."`                            | "Still scoping." (30s, 1×)                                                        | "Replan done — N added, M deprecated." (with PG counts from new `/scoper-result/<ID>` endpoint) |
| Cleanup    | `HarnessDashboard.cleanupHarness`                                                                                                       | "Cleaning up."                                    | "Still pruning." (30s, 1×)                                                        | "Cleanup done — M deprecated."                                                                  |
| Supervisor | command palette `supervisor`                                                                                                            | "Running supervisor."                             | "Still reviewing." (30s, 1×)                                                      | `Supervisor: &lt;outcome&gt;`                                                                   |
| Provision  | *no live caller* (`ForkProvisioningProgress` retired 2026-06-10 with the snapshot system; policy kind kept in `op-narration-policy.ts`) | `"Provisioning {plugin}."`                        | "Still working." (60s, max 4×)                                                    | "Provisioning complete." / `Provisioning failed: &lt;reason&gt;`                                |
| Smoke test | (caller wires)                                                                                                                          | (silent)                                          | —                                                                                 | `Smoke test: &lt;reason&gt;`                                                                    |
| Scan       | (caller wires)                                                                                                                          | (silent)                                          | —                                                                                 | (silent unless suggestions surfaced)                                                            |
| Delegate   | `OperatorDelegationListener`                                                                                                            | (silent — voice already said "looking into that") | "Still researching." → "Still on it." → "Still working through it." (30s, max 3×) | "Delegate finished — details in the panel."                                                     |

Templates + policy (`OP_POLICIES`, `kickoffText`/`midText`/`completionText`) in `packages/operator-core/lib/op-narration-policy.ts`. API in `packages/operator-core/lib/voice-narration.ts`: `announceOpStart(kind, ctx)` returns a `NarrationHandle`; `announceOpEnd(kind, ctx, handle?)` cancels pending mid timers and speaks completion. Failure narration is sober + concrete reason; never apologetic.

### Backstory beats (PR 3, commit `c822ef9`)

10 hand-written beats in `packages/operator-core/lib/op-backstory-bank.ts`:
migration-too-big, smoke-test-lied, skipped-checkpoint, sync-in-hot-path,
ignored-escalation, lost-work-to-replan, tests-covered-wrong-path,
provision-timeout, first-oncall-page, query-without-index. Each has a
trigger predicate and an eligible-mode list.

**Injection**: at every EL Conv AI session-start, `buildBackstoryBlock()`
(in `packages/operator-core/lib/voice-engines/elevenlabs-conv.ts`)
filters the bank by current trigger context + recent-firings, picks up
to 3, and prepends them to the `overrides.agent.prompt.prompt` block
with "you may reference one of these if it fits naturally". The model
picks; we don't force.

**Rate limits** (`packages/operator-core/lib/op-backstory-state.ts`):

* 3 fires per session (sessionStorage)
* 30-min cooldown between fires
* 7-day no-repeat per beat id (localStorage)

Toggle with the **"Operator references past experience"** checkbox in
`/settings/voice` (default ON).

### Voice persona drift telemetry (PR 4, commits `fc9dcb7` + `4fa3d52`)

PG schema: `harness_shared.voice_utterances` (migration 004). Every
agent utterance lands here with mode + length + name-used flag +
backstory-detected flag + prepareForTTS modifications.

**Sources** wired:

* `legacy` — `prepareForTTS` posts to `/api/agent-mcp/voice-utterance-log` after every shaped utterance
* `elevenlabs-conv` — `/api/elevenlabs/post-call` webhook receives EL's post-call payload, logs every agent turn. Mode is heuristic-classified by `packages/operator-core/lib/classify-utterance-mode.ts` (apologetic > sober > wry > assertive > default precedence).

**Drift report**: `node apps/operator/scripts/voice-persona-audit.mjs`
queries the last 7 days, writes markdown to `docs/voice-persona-audit.md`.
Surfaces:

* Mode distribution (target \~5% wry, \~80% default)
* Name-use rate (target ≤1 per 5-min window)
* Backstory rate (target \~1%)
* prepareForTTS modification counts (preamble strips and company-name leakage flagged as drift)

### Operator panel card visibility + actions (commit `97e0d6a`)

The voice operator could read + act on cards in the panel via three
registry commands:

* `panel.cards` query — returns `{count, cards}` snapshot of the feed's `visibleSuggestions`
* `panel.dispatch-card({id})` — same effect as clicking the primary button on a card
* `panel.dismiss-card({id})` — same effect as the dismiss button

**Retired** (`unify-agent-launches` D-005): the `panel.*` `browser:'required'`
CommandDefs were removed along with the operator-card panel. The
`panel.cards` shape still survives in `operator-shared-state.ts` and the
device-tool-resolver fixtures, but the defs are gone and `el-agent-sync.mjs`
no longer pushes them — don't re-add them without re-registering the
`browser:'required'` defs first.

### Cost controls

Three layers of defense, all wired into `voice-mode.ts`:

| Layer                       | Default | Pref                        | What                                                                                                                                                                                                                                              |
| --------------------------- | ------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-session idle disconnect | 5 min   | `fullAgentIdleTimeoutMin`   | Mic streams continuously while connected; idle timer resets on every transcript/agent-text event. On expiry: end session, toast "voice idle Nm — disconnecting to save minutes."                                                                  |
| Per-session 80% warning     | —       | (auto, derived from cap)    | At session start, if `pct_used >= 0.8`, info toast: "EL usage 87% of monthly cap (520/600 min). Auto-disconnect after idle keeps the meter down."                                                                                                 |
| Hard monthly cap            | 600 min | `fullAgentMonthlyMinuteCap` | Sessions refuse to start when `pct_used >= 1.0`. PG-backed (migration 005, `harness_shared.el_conv_calls`). The post-call webhook records `metadata.call_duration_secs` per conversation; `/api/agent-mcp/operator-el-spend` aggregates by month. |

Live status visible in `/settings/voice` via the inline `<ElSpendStatus />` widget.

### Privacy modes (commit `7785ced`)

`voicePrivacyMode` pref:

* `'always-on'` (default) — mic streams continuously while session is connected
* `'wake-word-gated'` — local Porcupine/openWakeWord listens **on-device**; mic only streams to EL between wake-fire and gated-idle (default 20s, tunable via `wakeGatedIdleTimeoutSec`)

Trade-off: \~1.5s extra latency on first turn after wake. Win: audio
doesn't leave the box at rest, EL meter only runs during active turns.
Probably 60–80% reduction in monthly minutes for a typical workday.

Set on `/settings/voice`. Requires a wake-word engine (Porcupine BYO key or openWakeWord no-key).

### Webhook security (commit `d01cec4`)

Both `/api/elevenlabs/webhook` and `/api/elevenlabs/post-call` verify
EL's HMAC-SHA256 signature over `${timestamp}.${body}` with 5-min skew
protection. Configure on the EL dashboard:

```
Workspace → Settings → Webhooks → Authentication → Generate secret
```

Then set `ELEVENLABS_WEBHOOK_SECRET=<THAT>` in the operator's environment.

In dev (no secret set), unsigned webhooks are accepted with a console
warning so prod misconfiguration is visible.

### Delegate transcript view (commit `d69841a`)

`harness_shared.delegates.transcript` JSONB column (migration 007).
`delegate-chat` appends `{ts, request, response}` to the row on every
SSE `done`. The Delegates section in the operator panel renders the
transcript above the follow-up textarea — color-coded bubbles, scrollable, max 320px.

Lets the user follow up on a delegate hours later with full context
visible instead of having to remember what was already said.

## §EL setup — operator path

To take the operator from "engine selected in /settings/voice" to
"actually working with persona + tools":

### 1. Create the agent in the EL dashboard

* ElevenLabs → Conversational AI → New Agent
* Pick LLM (Gemini Flash recommended; Claude Haiku via BYO LLM also works)
* Pick voice (current operator agent uses Adam preset — change later via dashboard or A/B test)
* Set first\_message to e.g. "Hi, what can I help with?"
* **Settings → Security → enable "Override prompt"** (so our session-start persona injection works)

### 2. Configure the agent ID + API key

* `/settings/api-keys` → ElevenLabs key
* `/settings/voice` → ElevenLabs Agent ID (`agent_…`)

### 3. Sync persona + tools to the agent

```bash
# preflight first — verifies key + agent exist before touching anything
node apps/operator/scripts/el-agent-sync.mjs --dry-run

# real run — registers 14 client-tools, attaches by tool_id, pushes persona prompt
node apps/operator/scripts/el-agent-sync.mjs
```

The script is idempotent. Re-run after editing the persona or adding a registry tool.

### 4. Configure the post-call webhook (production)

* EL dashboard → Workspace → Settings → Webhooks → Post-call
* URL: `https://YOUR-PUBLIC-URL/api/elevenlabs/post-call`
* Generate workspace webhook secret → copy
* Set `ELEVENLABS_WEBHOOK_SECRET=&lt;secret&gt;` in the operator's environment

For local dev: skip this step. The drift report will only see legacy-path utterances until you set up a tunnel.

### 5. (Optional) tune cost ceilings

* `/settings/voice` → idle timeout (default 5 min)
* `/settings/voice` → monthly cap (default 600 min)
* `/settings/voice` → privacy mode (default always-on; switch to wake-word-gated for the privacy/cost win)

## §Operations playbook

### Run the drift report

```bash
node apps/operator/scripts/voice-persona-audit.mjs
# writes docs/voice-persona-audit.md
```

Run weekly. If wry rate is too high or banned-preamble strips are >0,
tighten the persona (`prompts/operator.persona.md`) and re-sync.

### Prune audit tables

```bash
DRY_RUN=1 node apps/operator/scripts/prune-audit-tables.mjs   # report only
node apps/operator/scripts/prune-audit-tables.mjs              # actually delete
```

Defaults: `agent_actions` 30d, `agent_queries` 14d, `voice_utterances` 90d.
Override via `ACTIONS_DAYS=`, `QUERIES_DAYS=`, `UTTERANCES_DAYS=`.
`el_conv_calls` is NOT pruned — current month sums drive the cap.

### Diagnose voice issues

* Open DevTools console: look for `[el-conv]` lines
  * `connected` → session up
  * `user: &lt;text&gt;` → EL got your transcript
  * `agent: &lt;text&gt;` → agent generated a reply
* Voice button visual state:
  * Green breathing ring → mic is open (`is-mic-active`)
  * Amber 2.5s flash + "wake word" badge → wake word detected
  * Cyan 2s flash + "heard you" badge → agent received your full utterance
* If "no audio reply": likely autoplay-policy blocked the audio element. The fix in commit `0f958cc` resumes AudioContexts before session start; if it still happens, click anywhere first to grant a user-gesture.

### Test EL pipeline without your mic

```bash
node apps/operator/scripts/el-connect-test.mjs
# end-to-end smoke: mints token, opens WS, sends probe, waits for reply
# (rate-limited if a real session is already active for your workspace)
```

## §Deferred (intentionally not shipping)

* **A/B voice pick (PR 4 §11)** — your call. 1-hour blind test of 3 candidate voices. Once chosen, edit `el-agent-sync.mjs` to PATCH `tts.voice_id`.
* **Realtime audit/cost parity** — Realtime is the OpenAI fallback path. If Realtime usage grows, mirror the EL post-call → voice\_utterances pipeline.
* **LLM-pass mode classifier** — current regex classifier in `classify-utterance-mode.ts` is good enough at this scale. Upgrade only if drift report noise becomes a problem.

## §Pre-implementation plan v2 (historical)

The original implementation plan committed in `f3faf22` is preserved
in git history at that commit. Its §15 "what's NOT trying to do"
section is now obsolete — wake-word-gated EL, panel cards visibility,
delegate streaming feedback, transcript view, and webhook auth all
shipped after that section was written. Read this status doc instead.
