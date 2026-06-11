# Voice modality
URL: /internal/docs/endpoint-system/voice-modality

How tools declare which surface they make sense from, and how the EL Conv AI voice integration interacts with the framework.

# Voice modality

Tools can declare a `modality` field stating which surfaces they're meaningful from — `'text'` (chat sidebar, harness chat panel), `'voice'` (the ElevenLabs Conv AI integration), or both. The framework's prompt-assembly layer filters tools out of catalogs they don't belong in.

## Default behaviour

```ts
defineTool({
  name: 'tasks:list',
  // modality omitted → defaults to ['text', 'voice']
  args: TaskListArgs,
  handler: async (input, ctx) => { … },
});
```

A tool without a declared modality is available from **both** surfaces — it appears in the catalog rendered for text *and* for voice. (An earlier text-only default silently emptied the voice catalog for every tool that didn't opt in, so the default was flipped to `['text', 'voice']`.)

## Declaring a voice-capable tool

```ts
defineTool({
  name: 'operator:converse',
  modality: ['text', 'voice'],
  args: ConverseArgs,
  handler: async (input, ctx) => { … },
});
```

The catalog renderer will include this tool in both text and voice surfaces.

## Declaring a text-only tool explicitly

```ts
defineTool({
  name: 'some:button_only_tool',
  modality: ['text'],  // REQUIRED to keep it out of voice — the default is both
  // This drops the tool from voice catalogs.
  args: SomeArgs,
  handler: async (input, ctx) => { … },
});
```

This is a **real** carve-out, not just documentation: because the default is `['text', 'voice']`, a tool that should never reach a voice surface must declare `modality: ['text']` — otherwise it shows up in voice catalogs too.

## What the framework does NOT do

The framework's modality concept is **prompt-assembly metadata only**. The framework:

* ✅ Filters the rendered tool catalog by the caller's modality (via `renderToolsCatalog(role, names, modality)`)
* ✅ Surfaces `modality` on the `tools/list` MCP response so MCP clients can filter independently
* ❌ Does NOT auto-narrate `progress` / `done` events for voice surfaces
* ❌ Does NOT enforce modality at call-time — a voice surface can still invoke a text-only tool if it forces the call

The "narration" model from the original Phase 4 plan was a poor fit for the EL Conv AI integration. See [the spike memo](./../plans/voice-modality-spike-2026-05-13.md) for the analysis.

## How the EL Conv AI integration actually works

The browser opens a WebRTC session to EL's hosted Conv AI agent (Claude Haiku via BYO-LLM). When the agent decides to "ask the operator," the EL SDK invokes our `ask_operator` clientTool handler in the browser:

```ts
// packages/operator-core/lib/voice-engines/elevenlabs-conv.ts
tools.ask_operator = async (params) => askOperatorViaSse(params);
```

`askOperatorViaSse`:

1. POSTs `/api/agent-mcp/operator-converse` with the conversation history + the new user turn.
2. Drains the SSE stream into an `assembled` string.
3. Extracts the `<say>...</say>` body from the assembled text.
4. Returns that string to EL.
5. EL speaks the string via TTS.

The contract with EL is **one string in, one string out** per turn. EL is not subscribing to a typed-event channel — it reads the clientTool function's return value.

## The `<say>` tag protocol

The operator brain (Claude Sonnet 4.x running our prompt) wraps voice-mode replies in `<say>...</say>` tags. The brain may also emit other tags that the system parses:

| Tag                                                                         | Purpose                                        | Where parsed                                                      |
| --------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `<say>spoken text</say>`                                                    | TTS body. Required for voice turns.            | Client (`askOperatorViaSse`) extracts the body and returns to EL. |
| `<set_mode>active\|passive</set_mode>`                                      | Lifecycle hint.                                | Server + client (`operator-converse-tags.ts`).                    |
| `<sleep duration_minutes="N" reason="…">`                                   | "Stay silent for N minutes" (capped at 1 day). | Server + client.                                                  |
| `<spawn role="..." harness="..." feature="..." chunk="..." extras="K=V" />` | Server-side orchestrator dispatch.             | Server (`parseOperatorTurn`); never returned to EL.               |

## Sanitizer

The client-side `askOperatorViaSse` warn-logs when a voice turn arrives without a `<say>` tag — that's the silent-regression class where TTS would speak raw markup including `<set_mode>` / `<spawn>` tags verbatim. Console message:

```
[el-conv:ask_operator] voice turn returned without <say> tag; the raw body will be spoken via TTS: <text>
```

If you see this in production, the brain's voice-mode prompt regressed.

## Cards on voice — `fallbackText`

The bespoke-card-improvements arc (`ctx.askUser`) added a state channel that delivers card payloads to chat surfaces. Voice doesn't render cards — there are no buttons to click — but a tool that emits a card during a voice turn still wants the user to hear *something*.

The `CardSpec.fallbackText` field bridges this gap. When set, the operator-converse SSE forwarder picks up `state-snapshot` events and appends each card's `fallbackText` (or `prompt` as a fallback) to the spoken response:

```ts
ctx.askUser({
  prompt: 'Did you mean X or Y?',
  dataSchema: z.object({ choice: z.enum(['x', 'y']) }),
  presentation: { kind: 'radio', options: [...] },
  fallbackText: 'Did you mean X or Y?',   // voice surfaces speak this
});
```

Gating (audit5+): the `operator-converse` SSE only forwards `state-snapshot` events when `body.modality === 'voice'`, and only forwards snapshots with at least one openCard carrying `fallbackText`. This avoids cross-conversation leak (a text turn's card would otherwise be spoken in a concurrent voice turn) and keeps state-shaped tools (`ctx.publishState` without cards) off the voice path.

`chat:ask_choice` is available from **both** surfaces — it declares no `modality`, so it defaults to `['text', 'voice']`. On a voice turn its `fallbackText` (the question + options) is spoken, and by default the user still clicks the card on the chat surface to answer. A single-select card that sets `voiceAnswerable: true` (e.g. the silence-nudge "Ready" card) goes further: the client-side `voice-card-router` matches the user's spoken pick against the option labels/ids and submits it via `/card-response` — so voice **can** now answer those cards hands-free (gated by the `cardAnsweringEnabled` voice preference). Multi-select and non-`voiceAnswerable` cards still require a click.

## See also

* [Transports](./transports.mdx) — how typed events project across HTTP / MCP / IPC
* [Spike memo](./../plans/voice-modality-spike-2026-05-13.md) — why the original "ctx.narrate" design didn't fit
* `packages/operator-core/lib/voice-engines/elevenlabs-conv.ts` — the integration source
* `packages/operator-core/lib/operator-converse-tags.ts` — the tag parser
