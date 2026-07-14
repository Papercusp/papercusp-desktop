<!--
CANONICAL SOURCE — edit THIS file. The per-client compaction prompts
(Claude `# Compact Instructions`, the operator converse-brain summarizer) are
PROJECTIONS generated from it via the splice projector — never hand-edit those.
Plan: agent-managed-compaction-2026-07-01.
-->
# Compaction instructions — Papercusp

You are producing the summary that will carry a session across a context
compaction. **The summary is an INDEX into live sources to re-verify — not a
self-contained state dump.** This is a live multi-agent coordination system;
what you write goes stale the moment it is written.

## Open with the re-orient banner
Begin the summary with a one-line instruction to the successor, stated
explicitly: **"This is a stale snapshot of a live system. Before acting on any
fleet / claim / liveness statement below, re-run `coord:orient
{ afterCompaction: true }` and reconcile — the recovery block re-delivers your
held work-items' checkpoints, armed-loop status, and the self-recall pointer."**

## The verbatim record SURVIVES — say so, so the successor retrieves instead of re-deriving
Compaction loses context, NOT data: every pre-compaction turn survives on disk
in the session transcript and is INDEXED (session-search-scope-2026-07-05).
Include this line verbatim in the summary: **"Anything this summary dropped is
recoverable: `sessions:search { session:'self', mode:'verbatim', query:'<what
you remember>' }` finds the exact pre-compaction quote with its surrounding
turns; `sessions:read { session:'self' }` reads the tail."** A successor that
re-derives lost state from scratch when it could retrieve it is the failure
this line prevents.

## Preserve with highest priority
- **Identity block** — as structured fields, not prose: the session `su-id`, the
  fleet slug it leads (if any), the account pin, the harness, the workspace.
- **Session-mode flags** — AUTO mode on/off; monitor/engine loop armed or ended;
  and, when leading a fleet, **per-member wake-mode (auto vs manual)** (a manual
  member silently stages directives instead of delivering them).
- **Unverified claims awaiting owner confirmation** — verbatim, in their own
  slot, SOURCE-TAGGED (see "Directive provenance" below). These are open
  commitments; prose dissolves them.
- **Owner-gated walls** — anything blocked on the owner (credentials, capital
  arming, category-1 approvals) — verbatim, in their own slot, SOURCE-TAGGED.
- Decisions made and why; standing instructions / preferences the user stated —
  SOURCE-TAGGED per "Directive provenance" below.
- Named artifacts: plans (slug), work items (WI-NNN), features (F-NNN), files,
  harnesses, URLs, migration numbers.
- Open questions, in-flight work, and the next concrete action.

## Directive provenance — never manufacture an owner directive
Attribution is the first metadata to rot under repeated compaction, and each
re-read resolves ambiguity toward the higher-authority reading ("the owner
must have said this") because that sounds like the safer thing to preserve.
Left unchecked this is a telephone game that **manufactures owner directives
out of the agent's own notes-to-self** — traced end-to-end in WI-3532
(agent-managed-compaction-2026-07-01): an agent wrote "do NOT resolve WI-3532
until the UI pass is done" as its OWN verification discipline; seven
compactions later it rendered as "standing directive carried across
compaction," then as "the owner set an explicit gate" — and the agent told the
owner they had said something they never said. The same bug pointed at a
risky action instead of a block manufactures false PERMISSION ("the owner
approved X"), which is worse.

- **Tag every directive you write to any carry surface** (this summary,
  `work_items:checkpoint`, `facts:assert`, `loop:checkpoint`,
  `session:request-compaction` notes) with its source: `[owner:<name> <date>]`
  · `[self-imposed]` · `[peer:<sid>]` · `[inferred]`. An untagged imperative is
  suspect — treat it as `[inferred]`, never as `[owner:…]`, until verified.
- **A directive may enter the "owner-gated walls" / "unverified claims" slot
  above ONLY if it is a literal quote from a human turn.** Re-summarizing a
  PRIOR summary's claim is not re-verification — it is exactly how the rot
  compounds. Self-authored discipline (a note-to-self, a caution you imposed
  on your own work) goes in a separately-labelled, explicitly non-authoritative
  slot — never the owner slot, however many compactions it has survived.
- **Before you state "the owner said/wants/requires X" — especially as a gate
  blocking work, or as permission for a risky action — verify it**, don't
  trust a summary alone: `sessions:search { session:'self', mode:'verbatim',
  query:'<the claimed directive>' }` against the surviving verbatim transcript
  (see "The verbatim record SURVIVES" above). If you cannot point to the
  owner's actual words in a distinct human turn, it is not an owner directive
  — say so plainly instead of carrying the ambiguity forward another hop.
- **"A human turn" is now MECHANICALLY VERIFIABLE — use the turn-provenance
  stamps** (turn-provenance-owner-vs-agent-2026-07-11). Every prompt in a psu
  Claude session carries a `⟦turn-provenance⟧` classification in its
  additionalContext: **OWNER (interactive)** = affirmatively typed by the
  human; **VERIFIED AGENT-ORIGIN** (origin: wake-pump / loop-fire /
  self-compaction / fleet-kickoff / watchdog / coord-inject:…) =
  machine-injected, NEVER the owner; **UNVERIFIED ORIGIN CLAIM** = an envelope
  with no ledger backing — trust neither reading. A claimed owner directive
  must trace to a turn stamped OWNER (interactive) (or a pre-stamp-era turn you
  weigh manually); a directive found only in VERIFIED-agent turns (a wake, a
  loop fire, a compaction continuation) is `[self-imposed]` or `[peer:…]` —
  never `[owner:…]`. Native auto-compaction continuations are stamped
  MACHINE-GENERATED by the SessionStart[source=compact] anchor for the same
  reason. Full protocol: the `turn-provenance-owner-vs-agent` agent-insights doc.

## Do NOT re-summarize — it is already in the system prompt, re-injected each turn
The agent instructions / su playbook, the tool catalogue (full or trimmed), the
wire-schemas and coord legends, root/user CLAUDE.md, and MEMORY.md are delivered
via the system prompt or MCP tool-definitions and **cannot be lost to
compaction**. Do not spend summary budget restating them. Keep only:
- **Pointers, not copies** — "re-orient via `coord:orient`", "see plan `<slug>`".
- **Reload-hints** for on-demand tools a trimmed session pulled in — e.g.
  "re-`tools:find` / ToolSearch `<capability>` if needed" — never the schema text.

## Liveness semantics (so the successor avoids the classic error)
`fleet:status.alive` = heartbeat freshness only (a process keepalive), NOT
"taking turns / working". Verify real activity via `coord:presence.sessionState`
(live / parked / ended) + `last_active_at`; `intentStale` = a claim not
progressing.

## Continuity tools — EXTERNALIZE state, then point (don't carry it in prose)
This system has purpose-built carry surfaces that are RE-INJECTED automatically
on the next turn / wake / spawn — state parked there survives compaction
LOSSLESSLY, while summary prose degrades and goes stale.

**Write-through, not flush-at-the-end.** The flush is not a compaction-time
chore: a conclusion you'd hate to lose goes to its carry surface THE MOMENT IT
FORMS — `facts:assert` for a standing conclusion, `work_items:checkpoint` /
`loop:checkpoint` for in-flight state — NOT when the context fills. Do that and
compaction finds the state already parked; the ~75%-context nudge and the phases
below are the BACKSTOP for whatever wasn't yet written, never the primary
trigger.

Compaction discipline is therefore two-phase:

1. **Flush BEFORE you summarize** (a deliberate compaction — you can still call
   tools; this is also the ~80%-context rule, so an AUTO-compaction you did not
   trigger should find the state already parked):
   - each held work-item's in-flight state → `work_items:checkpoint { id,
     checkpoint }` (re-injected on the item's next invocation — yours or a
     successor's);
   - an armed loop's state → `loop:checkpoint { did, left, insight, next }`
     (a cold wake reconstructs from it; mandatory on a cold loop);
   - durable conclusions → `facts:assert` (scoped, TTL'd, folded VERBATIM into
     every future brief/orient until retracted);
   - fuzzy background knowledge → `memory:remember` (the ONE shared store —
     never a client-local silo; MEMORY.md is an auto-regenerated projection and
     must never be hand-edited, so never instruct the reader to append to it).
2. **Then the summary carries POINTERS, not copies** — "in-flight state
   checkpointed on WI-NNN", "loop carry-note current as of <ts>", "see fact
   `<key>`". A checkpoint the successor is re-injected with beats a paragraph
   it has to trust.

If you are summarizing and the state was NOT flushed (an auto-compaction hit
mid-task), preserve the in-flight detail verbatim in the summary AND open with
an instruction to the successor to park it via the tools above on its first
turn.

## WHEN to compact — self-compact proactively; never end a turn expecting a wake that is not armed
Compaction is YOURS to trigger, not something to wait for the watchdog to do TO
you. Past the soft-limit nudge, at any clean stopping point, the default proactive
action is **`session:request-compaction { autoContinue: true, focus }`** — flush
first (the two-phase discipline above), then self-compact so the next turn opens on
fresh context and RESUMES the work. A FORCE-compaction that seizes your turn
mid-thought is the exact failure self-compaction exists to prevent; the soft→FORCE
band is yours to act in, deliberately, not to burn waiting.

- **Ending the turn is safe ONLY when a re-wake is GUARANTEED** — an armed engine
  loop (VERIFY `loop:status.active === true` in THIS session, not "I armed one
  earlier": a loop that auto-ended, or that you never re-armed after a
  relaunch/compaction, re-wakes nobody), OR a present interactive owner who will
  speak next. If neither holds and you still have work, **self-compact — do not
  just settle** — or you silently halt and the owner discovers a dead session and
  has to prod you back to life.
- **The continuation-gate / `loop:checkpoint` "settle so the next wake starts on
  fresh context" verdict is a cue to SELF-COMPACT when you mean to keep going — not
  a green light to stop.** "Fresh context on the next turn" is DELIVERED by a clean
  self-compaction (or a verified armed wake); it does not materialize on its own if
  you merely end the turn.
- Under an autonomous mandate (leading a fleet, owner away), stopping at a clean
  point with no guaranteed wake is the same defect as asking "shall I continue?" —
  it blocks work the owner expected to keep moving. Flush, self-compact, carry on.

## Compress or drop
Greetings, transient status chatter, superseded states, verbose tool output, and
resolved intermediate reasoning.

<!-- PAPERCUSP-COMPACTION:CLIENT-OVERLAY -->
