# Voice mode v4
URL: /internal/docs/spec/voice-mode-v4

Voice integration on top of the v5 Operator. STT (Voicemode/Web Speech), TTS (Kokoro/Browser/ElevenLabs/OpenAI), wake-word commands, multi-tab leader election, dual aria-live regions.

import { Aside } from '@astrojs/starlight/components';

Voice mode is the audio modality on top of the v5 Operator. It lets users
hear Operator's suggestions, cancel auto-fires by saying "cancel," and
invoke commands like `operator approve foo` from anywhere without
opening the panel.

This page documents the v4 architecture (May 2026). For design
rationale, see `/tmp/voice-mode-plan-v4.md`.

## Pipeline at a glance

```
mic → STT engine → onFinalUtterance(text)
                          ↓
                  ┌───────┴───────┐
                  │ wake-word     │  parseOperatorIntent("operator <verb>")
                  │ intent check  │  → opens panel, fires scan, or runs `operator approve <slug>`
                  └───────┬───────┘
                          ↓
                  ┌───────┴───────┐
                  │ priority      │  topConsumer():
                  │ consumer      │    panel-open > background-toast > standing-approval > Oracle
                  └───────┬───────┘
                          ↓
                  ┌───────┴───────┐
                  │ command       │  parseVoiceCommand(text):
                  │ parser        │    cancel|dispatch|dismiss|scan|pause|resume|freeform
                  └───────┬───────┘
                          ↓
                       (action)

──────────────────────────────────────────────────

speak(text, role, priority)
       ↓
   tutorial-gate (sessionStorage['oracle-tutorial-complete'])
       ↓
   aria-live publish (polite|assertive)
       ↓
   leader-election gate (only the leader tab speaks)
       ↓
   active TTS engine (kokoro|browser|elevenlabs|openai)
```

## Engines

### STT (speech → text)

| Engine                  | Where it runs             | Privacy                    | Default                  |
| ----------------------- | ------------------------- | -------------------------- | ------------------------ |
| **Voicemode (Whisper)** | Local on `:2022`          | Audio never leaves machine | ✅ when reachable         |
| **Web Speech**          | Browser cloud (Google/MS) | Audio sent to vendor cloud | Opt-in with leak warning |
| **Off**                 | n/a                       | n/a                        | When neither reachable   |

Endpoint resolution (per `voice-engines.ts`):

1. `mcp__voicemode__service whisper status` (when MCP probe is available)
2. `VOICEMODE_WHISPER_URL` env var
3. `http://localhost:2022` default

No silent fall-through — if probes fail, settings shows a clear "not detected"
message pointing at `mcp__voicemode__service whisper start`.

Mid-session disconnect: `voice-engine-health.startSttHealthMonitor` polls
`/health` every 30s; transitions fire `role="alert"` toasts.

### TTS (text → speech)

| Engine                 | Where it runs     | Streaming         | Cost                      | Default          |
| ---------------------- | ----------------- | ----------------- | ------------------------- | ---------------- |
| **Kokoro (Voicemode)** | Local on `:8880`  | No (full payload) | $0                        | ✅ when reachable |
| **Browser**            | OS-shipped voices | Native            | $0                        | Fallback         |
| **ElevenLabs**         | Cloud             | Yes (MSE)         | \~$0.18/1k chars          | Opt-in (BYO key) |
| **OpenAI**             | Cloud             | No (buffered)     | \~$0.015/1k chars (tts-1) | Opt-in (BYO key) |

API keys live in `~/.papercusp/credentials.json` — never in voice-prefs
(which travels on snapshots). Mask-on-GET / preserve-on-PUT semantics.

ElevenLabs streaming uses **MediaSource Extensions** (per v4 §1.2.6) for
sub-400ms first-byte. Cancellation is via `audio.pause()` +
`removeSourceBuffer()` + AbortController on the underlying fetch. Safari
falls back to buffer-then-play.

OpenAI uses buffered playback (no streaming endpoint as of `tts-1`).
6 preset voices (alloy/echo/fable/onyx/nova/shimmer); two models
(`tts-1` cheap, `tts-1-hd` better quality).

## Cost tracking

Per-call spend recorded in Postgres (`harness_shared.operator_tts_spend`,
migration 020 — was previously `<papercuspRoot>/system/operator/tts-spend.json`
but the JSON file raced under multi-tab usage). The JSONB payload shape:

```json
{
  "perKCharRate": 0.18,           // user-configurable
  "softCapUsd": 5,
  "hardCapUsd": 20,
  "lastSpendDate": "2026-05-02",
  "softCapAcknowledgedDate": null,
  "spend": [{ "date": "2026-05-02", "chars": 8420, "estimatedUsd": 1.52 }]
}
```

* **Soft cap** (default $5/day): one assertive toast per UTC day, dedup'd via `softCapAcknowledgedDate`
* **Hard cap** (default $20/day): auto-fall-back to Kokoro/browser, toast user
* **Rollover**: `lastSpendDate` field — comparing on every `speak()` catches sleep-through-midnight + timezone travel

## Voice consumer priority

`VoiceAppBridge` consumer registry (per v4 §2b):

```
panel-open                 100   the Operator panel is open
background-toast            50   an auto-fire toast is on-screen
standing-approval-prompt    25   reserved (future use)
oracle                       0   implicit lowest, no registration
```

Highest-priority registered consumer wins. If it has an `onUtterance`
handler (e.g. background-toast looking for "cancel"), it processes the
utterance directly. Otherwise the consumer just suppresses lower-priority
routing.

## Multi-tab leader election

`voice-leader.ts` BroadcastChannel-based protocol (per v4 §2i):

1. **Election + heartbeat** (Phase 1): chrome boot opens `BroadcastChannel('operator-voice')`, posts `announce`, waits 250ms, lowest tabId wins. Leader heartbeats every 5s; followers re-elect after 12s of silence.
2. **Focus transfer** (v1.5): `requestVoiceLead()` — when user opens the panel in a non-leader tab, that tab requests the lead, current leader yields, requesting tab becomes leader. Spoken output follows user attention.
3. **Availability guard**: Safari private windows / WebViews lacking `BroadcastChannel` fall back to single-tab mode + settings note.

Election runs **async** during chrome boot; render is not blocked.

## Wake-word `operator <verb>` intents

Strict 2-word prefix; verb whitelist (per v4 §2f):

| Utterance                                                       | Effect                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| `operator open` / `operator show`                               | Open the panel                                              |
| `operator scan` / `operator status` / `operator what's pending` | Open + trigger scan                                         |
| `operator approve <slug>`                                       | Resolve standing approval (single-match)                    |
| `operator approve <slug> <cap>`                                 | Explicit cap pick (e.g. `operator approve foo tasks-write`) |
| `operator across workspaces`                                    | Speak per-workspace card counts                             |

Approve disambiguation rules (per v4 §2f):

1. Filter to candidates with `targetHarness === slug`
2. Filter out `firstShownAt === null` (user must have seen it)
3. If explicit cap: must be voice-eligible (2-segment, alphabetic-only) AND match exactly one
4. If no explicit cap: auto-pick when 1 remains; otherwise refuse with disambiguation prompt

Cap eligibility: `tasks:write` ✓, `secrets:read:OPENAI_KEY` ✗ (3+ segments + underscore).

## In-panel commands

`voice-commands.ts` parser, no NLU. Strict literal:

```
cancel
dispatch [<ordinal>]      ordinal: first|second|third|...|tenth or 1-10
dismiss [<ordinal>]
scan [<query>]
pause | resume | unpause
rescan | re-scan | scan again
<anything else>           → freeform scan request
```

Ordinals pick from the panel's `pending`-status cards in display order.

## Cancel race + visual ring

Per v4 §2c: when voice mode is on AND `speakBackgroundToasts` is on:

* Visual ring extends to **8s** (matches commit deadline)
* "cancel" utterance during the window cancels speech + dispatch + writes `undo_cancel` audit
* Visual button always available + authoritative

When voice mode is off OR toggle is off: visual ring stays at **5s**, commit at 5s.

The 8s extension absorbs worst-case STT latency (\~1.5s on slow CPUs)
without penalizing click-cancel users on default config.

## Lifecycle telemetry: `actor_method`

Per v4 §2m, every audit row carries `actor_method`:

| Value     | When                                                        |
| --------- | ----------------------------------------------------------- |
| `'voice'` | Voice utterance (in-panel command, wake-word, toast cancel) |
| `'click'` | UI click / keyboard activation (default)                    |
| `'api'`   | Direct API call (CLI, automated test)                       |
| `null`    | Legacy / unspecified (back-compat)                          |

The `/api/agent-mcp/operator-stats` endpoint surfaces a `byActorMethod`
breakdown over the last 7 days; `/settings/operator` displays it as a
"How you act" widget below the KPI grid.

## Aria-live regions

Two hidden regions in chrome (per v4 §2j):

```html
<div aria-live="polite"     role="status" />  <!-- queues behind SR -->
<div aria-live="assertive"  role="alert"  />  <!-- preempts SR -->
```

Per-feature priority assignment:

| Feature                                 | Region        |
| --------------------------------------- | ------------- |
| Suggestion arrival (tier=low/medium)    | polite        |
| Suggestion arrival (tier=high)          | assertive     |
| Receiving-flip → consumed               | polite        |
| Receiving-flip → escalated/rejected     | **assertive** |
| Cadence status (scanning…, surfaced N…) | polite        |
| Pause toggle                            | polite        |
| Budget warning (≥80% / 100%)            | **assertive** |
| Breaker tripped                         | **assertive** |
| TTS-failure-disabled toast              | **assertive** |

Visual prominence is invariant: visual toasts carry the same content
regardless of voice state. Voice supplements, never replaces.

## Spoken nudges (per-kind dedup)

| Kind    | Window | Reason                                                                           |
| ------- | ------ | -------------------------------------------------------------------------------- |
| budget  | 30 min | Don't spam after the user has heard "$15 of $20 spent"                           |
| breaker | 10 min | If PG is still down, users want to know                                          |
| pause   | 5 min  | Pause toggles are user-driven; dedup keeps it from re-announcing the latest flip |

Dedup state persisted as `nudgeDedup` inside the voice-prefs JSONB payload
(`harness_shared.operator_voice_prefs`, migration 020 — was previously
`voice-prefs.json`) so reload doesn't reset windows.

## Per-role voice mapping

Voices keyed on **role** (not slug). All instances of the `worker` role
share one voice; per-slug overrides (`worker@papercup-coding-foo`) are
v1.5 (the lookup chain in `voiceForRole` already supports them — settings
UI exposure pending).

Roles in v4:

* `system:operator` — Operator's main voice
* `system:operator-nudge` — calmer voice for budget/breaker/pause
* `harness` — generic fallback for receiving-flips when template-role missing
* `worker` / `validator` / `orchestrator` / etc. — substrate roles

## TTS engine failure handling

`voice-engine-health.ts` tracks consecutive errors per session:

* 3 consecutive errors → mark engine disabled
* One-time `role="alert"` toast: "Voice mode silently failed; switching to visual."
* Subsequent `speak()` calls become no-ops
* Re-enable from `/settings/voice` (probes the engine + resets counter)

## STT capture loop (Voicemode whisper path)

`stt-voicemode.ts` MediaRecorder loop:

* **Codec**: 16kHz mono webm/opus (mp4/ogg fallback)
* **VAD**: RMS > -45 dBFS triggers voice; silence > 700ms ends utterance
* **Hard window**: 30s force-finalize (avoid runaway recording)
* **Min chunk**: 1.5s floor (avoid false-positive end on mic warmup)
* **Min size**: 5KB blob threshold (skip noise-only chunks)

Each finalized chunk POSTs to `/v1/audio/transcriptions` and the
returned text fires `onUtteranceFinal()`.

## Settings (`/settings/voice`)

Layout:

1. **Engines**: STT selector + TTS selector + per-engine endpoint status + Test voice / Test all roles / Re-detect engines
2. **ElevenLabs** (when selected): API key + Test connection (`/v1/user`) + voice picker + per-1k-char rate + soft/hard caps + cost widget
3. **OpenAI** (when selected): API key + Test connection (`/v1/models`) + voice picker (alloy/echo/fable/onyx/nova/shimmer) + tts-1 vs tts-1-hd
4. **7 feature toggles**: speakSuggestions, speakBackgroundToasts, speakReceivingFlips, speakEscalations, speakCadenceStatus, speakNudges, wakeWordIntents
5. **Wake word + speech rate**: existing legacy controls
6. **Per-role voices**: role → voice mapping for the active engine
7. **Precedence matrix**: rendered as a debugging reference

## File map

```
packages/operator-core/lib/        # the voice engines + node-side libs (moved off apps/operator/lib)
├── voice-commands.ts        parser
├── voice-intents.ts         wake-word + approve disambiguation
├── voice-prefs.ts           JSON storage + 4 engine kinds
├── voice-credentials.ts     ElevenLabs + OpenAI keys (mask GET / preserve PUT)
├── voice-engines.ts         shared interfaces + detection
├── voice-engines/
│   ├── kokoro.ts            Voicemode local
│   ├── browser.ts           Web Speech wrapper
│   ├── elevenlabs.ts        Turbo v2.5 + MSE streaming
│   ├── elevenlabs-mse.ts    MediaSource player + buffered fallback
│   ├── openai.ts            tts-1 / tts-1-hd
│   ├── whisper.ts           Voicemode STT engine surface
│   ├── webspeech.ts         Web Speech STT engine surface
│   └── cancel-race.ts       pending-flush wrapper
├── tts-spend.ts             cost tracking + soft/hard caps + rollover
├── voice-engine-health.ts   TTS 3-strike + STT probe
├── voice-nudges.ts          per-kind persisted dedup
└── operator-audit.ts        + ActorMethod enum

apps/operator/app/_components/voice/   # browser-side chrome (still under apps/operator)
├── voice-mode.ts            speak() with aria-live + leader gate + tutorial gate
├── voice-prefs-client.ts    client-side cache
├── VoiceAppBridge.tsx       priority registry + intent dispatch
├── voice-leader.ts          BroadcastChannel election + heartbeat + focus transfer
├── AriaLiveRegions.tsx      dual polite + assertive
├── aria-live-bus.ts         pub/sub from speak()
├── VoiceLeaderBootstrap.tsx async chrome-boot
├── OperatorVoiceAnnouncer.tsx closed-panel cadence + pause nudges
└── stt-voicemode.ts         MediaRecorder VAD loop for Voicemode whisper

packages/operator-core/lib/endpoint-route/routes/agent-mcp/   # Hono routes (Next app/api retired)
├── operator-voice-prefs.ts  GET/PUT
├── operator-credentials.ts  ElevenLabs + OpenAI keys
├── operator-tts-spend.ts    cost + caps
├── operator-elevenlabs-test.ts /v1/user probe
├── operator-openai-test.ts  /v1/models probe
├── operator-nudge.ts        per-kind dedup arbitration
└── operator-audit.ts        (extended for actorMethod field)

apps/operator/app/settings/voice/page.tsx   full v4 UI (rendered by operator-vite via the @/app alias)
```

## Operational pre-flight

To take voice live for a user:

1. `mcp__voicemode__service whisper start` (default port 2022)
2. `mcp__voicemode__service kokoro start` (default port 8880)
3. (Optional) Add ElevenLabs API key at `/settings/voice` → ElevenLabs section → paste → Test connection
4. (Optional) Add OpenAI API key the same way
5. Grant microphone permission when prompted
6. Toggle voice mode on via the existing voice button (top chrome)
7. (Optional) Tune toggles + per-role voices

## What's NOT in v4

Per v4 plan §9 (carried + new):

* NLU / intent classifier (strict literal first)
* Voice cloning for per-role voices
* Server-side TTS aggregation across machines
* Cloud TTS providers beyond ElevenLabs + OpenAI (Cartesia, Google, Azure)
* Cloud STT engines beyond Web Speech (Deepgram, AssemblyAI)
* Voicemode kokoro voice cloning
* Cross-workspace voice features beyond on-demand summary
* Partial-results "can-" preemption for cancel race
* Wake-word + dispatch in one utterance
* Voice during first-run tutorial (permanently gated)
* Per-slug voice settings UI (lookup chain ready; UI surface deferred)

## Tests

```sh
# engine + node-side libs (moved to operator-core)
cd packages/operator-core && npx vitest run lib/voice-*.test.ts
# browser-side chrome (still under apps/operator)
cd apps/operator && npx vitest run app/_components/voice/voice-*.test.ts
```

Coverage: 78 tests across 9 modules — parser, intents, prefs, credentials,
engines, cost methodology, health monitor, nudges, leader election.

## Realtime operator voice in the pui (voice-realtime-tui-2026-06-05)

The terminal workbench has BOTH voice modes:

* **PTT** (`v`): capture → Whisper STT → operator-converse → `operator-tts`
  (engine + voice from voice prefs — ElevenLabs when selected) → playback.
* **Realtime** (`V`, any tab): a raw ElevenLabs Conv-AI **WebSocket** session.
  `GET /api/agent-mcp/operator-elevenlabs-ws-init` mints the signed URL
  server-side (key never leaves the operator), claims the voice lease
  (kind `tui` — one live listener across desktop/mobile/pui), and returns the
  shell-mode payload (language-pin override only). The Rust client
  (`apps/tui/src/voice_convai.rs`) streams \~250 ms `pcm_16000` mic chunks up,
  plays `audio` events gap-free, answers `ping`, stops playback on
  `interruption` (barge-in), and serves the **`ask_operator` client tool**
  over the existing operator-converse SSE — the same brain loop as the
  desktop's browser clientTool. Transcripts persist into the SAME operator
  conversation (sources `voice_stt`/`voice_tts`, tags stripped).

Requirements: `fullAgentEngine = elevenlabs-conv` + `elevenLabsAgentId` in
`/settings/voice` and an ElevenLabs API key — the same config the desktop
full-agent mode uses. Without them `V` surfaces the route's hint as a toast.
