# Voice mode
URL: /internal/docs/spec/voice-mode

Browser-side voice runtime for app-level + Operator-panel voice control. STT/TTS via the Web Speech API, no backend.

import { Aside } from '@astrojs/starlight/components';

## Why

Voice mode lets a user direct the app by speech instead of (or alongside) clicks and keystrokes. Two scopes:

1. **In-Operator-panel** — utterances drive Operator's scan loop; suggestion text is read aloud as it streams.
2. **App-level** — when the Operator panel is closed, utterances route to Oracle, whose UI-routing tools (navigate, listHarnesses, dispatchToAgent) provide whole-app control.

## Modes

```
off ──click──▶ push-to-talk ──click──▶ always-on ──click──▶ off
```

* **off**: STT/TTS disabled. Voice button shows 🎤 with no border tint.
* **push-to-talk** (PTT): hold the voice button; STT runs while held; release submits.
* **always-on**: continuous wake-word listening. When the wake phrase is detected, the runtime switches to active listening for the rest of the utterance, then submits.

## Wake word

Default: `"hey operator"`. Configurable per-browser at `/settings/voice`.

A 3-syllable phrase that doesn't appear in normal speech works best. Single-word wake words misfire often (per round-2 design discussion). The phrase must be in the user's spoken sentence; everything after it is captured as the utterance.

## Barge-in

User starting to speak (always-on or PTT) cancels any TTS that is currently playing. Implementation: every utterance start calls `cancelAllSpeech()` before recognition begins.

## Per-role voices

Each role gets its own voice, stable across harnesses, browser sessions, and restarts. Implementation:

* The runtime hashes the role name (e.g. `system:operator`, `orchestrator`) to a stable index into the available browser voices.
* The assignment is persisted to localStorage (`papercusp.voice.config.v1`).
* Users can override per role at `/settings/voice` with a Test button.

When the same role speaks (e.g. `system:operator` from two different harnesses), the same voice plays.

## Single-utterance queue

Only one utterance plays at a time, FIFO. If multiple agents emit text concurrently:

* Operator panel: only the in-focus speaker is queued (the panel routes one role at a time).
* VoiceAppBridge: speaks Oracle's deltas; queues across sentence boundaries.

This prevents overlapping voices.

## Consumer priority

The chrome runs both Operator panel and the VoiceAppBridge. Only one should consume utterances at a time:

* Operator panel calls `registerVoiceConsumer('OperatorPanel')` while open.
* VoiceAppBridge checks `hasHigherPriorityConsumer()` before routing to Oracle. Returns `true` if any registered consumer is active.

So utterances go to:

* Operator panel when open.
* Oracle (via VoiceAppBridge) when Operator is closed.

## Browser support

The runtime uses the Web Speech API (`SpeechRecognition`, `SpeechSynthesis`). Chrome, Edge, and Safari support it; Firefox does not as of writing. The voice button shows a degraded state with `cursor: not-allowed` when unsupported.

No external service is required. STT and TTS run entirely in the browser.

## Privacy

* STT audio is processed by the browser's speech engine (Chrome routes to Google's cloud transcription; Safari uses Apple's; Edge uses Microsoft's). No traffic touches the operator backend.
* The runtime does not record or persist audio.
* TTS is synthesized locally by the browser.

## Surfaces

* `apps/operator/app/_components/voice/voice-mode.ts` — runtime singleton (modes, queue, voice assignment).
* `apps/operator/app/_components/voice/VoiceButton.tsx` — chrome header toggle.
* `apps/operator/app/_components/voice/VoiceAppBridge.tsx` — app-level routing to Oracle when no priority consumer is registered.
* `apps/operator/app/settings/voice/page.tsx` — settings (wake word, rate, per-role voice picker, Test).
* `packages/operator-core/lib/voice-node/operator-voice-session.ts` — the shared realtime-session **host** (below); `operator-voice-host.ts` boots it.
* `packages/operator-core/lib/voice-node/operator-voice-bus.ts` — the typed session-bus codec (frame block `0x10–0x1F`).
* `apps/operator/app/_components/voice/desktop-operator-voice-client.ts` — the desktop webview's bus client.
* `apps/tui/src/voice_convai.rs` + `apps/tui/src/operator_voice_bus.rs` — the pui's bus client + Rust codec.

## Shared realtime session — desktop + tui on ONE EL/operator session

universal-voice-interface-2026-06-05 (Model A). The realtime operator voice session is **hosted once by the voice service**, not per surface, so desktop and the pui are two windows onto one conversation rather than two private sessions.

The realtime path (ElevenLabs Conv-AI shell + the `operator:converse` brain) runs as **one session hosted by the operator**; desktop and the pui (tui) both **attach as full clients**. Both see the same input transcript AND the same response (audio + transcript + control tags), and either can drive controls.

* **Host.** `OperatorVoiceSession` owns the single EL WebSocket: it mints the signed URL, runs the `ask_operator` brain once (in-process), decodes the response, and broadcasts input transcript + response audio/transcript/tags + session state to **every** attached client. A control (mute / PTT / start / stop / set-mode / force-host) from any client is applied **once** and the new state is broadcast back.
* **Bus.** Typed session messages ride the **same** `local-audio-socket` + `desktop-voice-ws` byte-pipe the P2P voice channels use (frame block `0x10–0x1F`) — no new socket. The pui attaches over the unix socket directly; the desktop webview over the loopback WS bridge.
* **Model A — single elected playout.** The cross-surface **voice-lease** elects ONE client as host + **player**: only that client renders response audio and captures the mic, so audio never doubles/echoes. Non-holders are **never refused** — they stay receive + display + control clients. `force=1` (force-host) takes over playout; a plain `start` while another client hosts does **not** steal the role. If the player drops, the host re-elects another attached client, so the session survives either UI closing.
* **One thread.** Input + response turns persist **once** to the single workspace operator conversation (the host is the sole writer), deduped by the EL conversation id — desktop, tui, and history are one thread.

## Tests

* `voice-mode.test.ts` — 6 tests: init, support detection, voice listing, persistence, wake word config, voice assignment.
* `voice-consumers.test.ts` — 3 tests: register/deregister, multiple consumers, idempotency.

## Out of scope (deferred)

* **Custom wake-word models** (e.g. Porcupine) for higher accuracy and lower CPU than browser STT-based detection. v1.5.
* **Multi-lingual voice** (current default is `en-US`). v1.5.
* **Voice-only login / lock-screen control**. Out of scope.
* **Per-harness voice override** (currently per-role only). Possible v1.5 if useful.
