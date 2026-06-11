# claude-file memory: MEMORY.md is a capped projection — and over-cap it goes silently STALE
URL: /internal/docs/agent-insights/claude-file-memory-index-cap

The session-start index has a ~24.4KB hard cap. The projector evicts oldest project entries to fit a 20KB soft cap, PHYSICALLY ARCHIVING them (they leave the searchable store) — and when durables alone exceed the hard cap it ABORTS, leaving MEMORY.md stale. Measured at 111/1k/10k by the memory bench's index-cap probe.

import { Aside } from '@astrojs/starlight/components';

## The three-layer trap

The Claude Code file memory has **three different visibility layers**, and
they diverge at scale:

1. **Topic files** (`~/.claude/projects/<slug>/memory/*.md`) — the store.
   The `ClaudeFileMemoryBackend` searches these (full re-read + lexical
   score per query; `archive/` is invisible to it).
2. **`MEMORY.md`** — an auto-generated *projection* of the topic files
   (`~/.claude/scripts/memory-compact.mjs`, a SessionStart hook). This is
   what a booting agent actually loads. Native hard cap **\~24.4 KB** —
   past it Claude silently drops the tail.
3. **`archive/`** — where the projector moves evicted files. Recoverable,
   but **invisible to both the index and the backend's search**.

The gotcha: the projector keeps the index under a **20 KB soft cap** by
**physically archiving** overflow `project`-type files (oldest first;
`user`/`feedback`/`reference` are never auto-evicted). So the cap doesn't
just bound session-start visibility — **one compaction pass shrinks the
searchable store itself**.

When the durable set *alone* renders over the hard cap, the projector has
nothing mechanical left to shed and **ABORTS: it archives nothing and
leaves the existing MEMORY.md untouched — i.e. STALE**. New memories stop
appearing in the index entirely, with only a session-start
`memory-hygiene` notice as the signal. The real store on this box already
hit this state (113 durables → 26.3 KB > 24.4 KB).

## Measured (memory-backend-benchmark P-010, D-004)

The bench's index-cap probe (`packages/operator-core/lib/memory/bench/index-cap-cli.ts`,
pure FS — temp-dir stores seeded through the seam) recorded, with the
simulation pinned **exactly** to the real script's dry-run output:

| store size        | indexed | index KB | indexed % | behavior                                                    |
| ----------------- | ------- | -------- | --------- | ----------------------------------------------------------- |
| 114 (real corpus) | 113     | 26.3     | 99.1%     | over BOTH caps → projector aborts; index stale              |
| 1,000             | 113     | 26.3     | 11.3%     | 887 would-be-archived; durables still over hard cap → abort |
| 10,000            | 113     | 26.3     | 1.1%      | 9,887 would-be-archived; abort                              |

i.e. the file backend's *session-start reach* is bounded at roughly
**\~115–200 entries regardless of store size** (whatever fits \~20 KB of
one-line hooks), and on an all-durable store the index stops updating
altogether.

## What to do with this

* **Don't design features assuming the file store scales** — anything
  past a few hundred entries is invisible at boot and, after compaction,
  unsearchable. PG-backed memory (mem0) is the scale path; this is one of
  the falsifiable predictions the memory bench scores (D-006).
* **A stale MEMORY.md is a signal, not a bug in your change** — check the
  `memory-hygiene` SessionStart notice; the fix is deliberate curation of
  durables (merge/retire/tighten), never hand-editing the index.
* **Reproduce / re-measure** with
  `npx tsx packages/operator-core/lib/memory/bench/index-cap-cli.ts --sizes 1000,10000`
  (no PG, no keys needed). The simulation lives in `index-cap.ts` and its
  fidelity to the real script is pinned by `index-cap.test.ts` (auto-skips
  where `~/.claude/scripts/memory-compact.mjs` doesn't exist).

## See also

* [`mem0-unavailable-outage-or-swallowed-bug`](/internal/docs/agent-insights/mem0-unavailable-outage-or-swallowed-bug/) — the mem0 side's swallowed-failure trap (same benchmark arc).
