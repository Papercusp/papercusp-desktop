# Attributing a change despite git-sync squash: git blame lies here — search sessions instead
URL: /internal/docs/agent-insights/attributing-a-change-despite-git-sync-squash

git-sync squashes every agent's commits under one bot identity, so git blame/log/show never name the agent who wrote a change. This doc gives the channels that actually work — timestamp-correlated sessions:search — versus the ones that look plausible but dead-end (git blame, change_ledger, audit:list), using a real hunt for the green-checkpoint quiet-cut feature as the worked example.

import { Aside } from '@astrojs/starlight/components';

`git blame` on this repo tells you the change happened, never who wrote it.
Every commit lands under one bot identity. To find the agent, correlate the
commit's **timestamp** against session transcripts with
`sessions:search { mode:'hybrid', include_coord:true }` — search by what the
change *is*, not by who touched the file.

## Why git blame is a dead end here

The shared `staging` checkout is committed by a single background **git-sync**
routine on a schedule (superproject + every submodule) — see
[repo-conventions § branch + commit](/internal/docs/system/repo-conventions).
No agent ever runs `git commit` themselves. The practical consequence:

* Every commit's author is the same bot identity (the box's configured
  `git user.name` / `user.email`), regardless of which agent wrote the diff.
* Every commit message is the fixed string `chore(git-sync): auto-commit
  papercusp [skip ci]` — no per-change summary, no agent id, no work-item
  reference.
* A commit is often a **squash of several agents' edits** that happened to
  land in the same \~3-minute git-sync tick, so even "this commit = one
  session" is not a safe assumption.

`git log`, `git blame`, and `git show` on a source file therefore answer
*when* a change landed and *what* the diff was, but structurally **cannot**
answer *who* wrote it. Don't spend time re-trying these with fancier flags —
the identity was never recorded there.

## Channels that look plausible but dead-end

Checked and ruled out during the worked example below — worth knowing so you
don't re-walk them:

* **`change_ledger:list`** — tracks *prompt-file* mutations only
  (`mutationClass: 'repo-prompt'`, scanned from the same squashed commits it's
  trying to explain). A code file like
  `apps/operator/lib/release/green-checkpoint.ts` never appears here at all;
  and even for prompt files, `actor` is still the squash-bot identity, not the
  agent — it inherits the same limitation, one layer up.
* **`audit:list`** — a write-log of tool-mediated actions (who called what
  MCP verb), not a code-diff attribution surface. It only helps if the change
  was itself made *through* an audited tool call (e.g. a `flags:set`), not a
  file edit via `Edit`/`Write`.
* **`decision_ledger:list`** — the Mug's governed-action log. Useful for
  autonomy decisions, not for "who edited this function."
* **Guessing from commit message content** — there is none; every git-sync
  commit message is identical, so keyword search over commit messages returns
  nothing file-specific.

None of these are wrong tools in general — they answer different questions.
The mistake is reaching for them *for attribution* on a git-sync-squashed
repo, where they were never going to have the answer.

## The channel that works: timestamp-correlated session search

The insight: **agent sessions are the actual record of who wrote what** — git
just isn't. Every session transcript (Claude/OMP/Codex + harness chats) is
indexed into `harness_shared.session_turns`, searchable, and — critically —
**timestamped**. A git-sync commit's timestamp lands within seconds to a few
minutes of the agent's own `Edit`/`Write` calls that produced it. So the
recipe is:

1. **Get the commit's timestamp and diff** from git (`git log -p -1 <sha> -- <path>`, or `git log --all -S'<distinctive symbol>' -- <path>` to find the
   introducing commit by content pickaxe if you don't have the sha yet).
2. **Search sessions by what the change *is*, not who touched the file** —
   `sessions:search { query: '<distinctive function/feature name>',
   mode:'hybrid', include_coord:true }`. Use the actual symbol names and
   concept from the diff (e.g. a new exported function name, a new env var,
   a comment phrase) as the query — that's what the authoring agent's own
   turns will contain.
3. **Confirm by timestamp, not just content match.** A hybrid search can
   return several plausible-sounding sessions; the one whose turn timestamps
   sit right at (or just before) the commit's timestamp is the real one. This
   is the load-bearing check — content similarity alone can point at a
   *later* session that merely *discusses* the feature.
4. **Read the surrounding window** (`sessions:read { session, around,
   context }`) to get the full narration — the authoring agent typically
   states in its own words what it built and why, which is far more precise
   than the diff alone.

## Worked example: the green-checkpoint quiet-cut feature

**Starting point:** commit `107d5bd337`, `apps/operator/lib/release/green-checkpoint.ts`,
introducing `quietCutSecFromEnv()` and the quiet-cut candidate-selection logic.
`git show 107d5bd337` gives the diff and the timestamp
(`2026-07-01 21:20:07 -0400`) but only the single git-sync bot identity for
author — the dead end described above.

**What worked:**

```
sessions:search {
  query: "quiet-cut quietCutSecFromEnv green-checkpoint",
  mode: "hybrid",
  include_coord: true,
  limit: 5
}
```

This surfaced session `eec9bea1-43dd-413b-84a0-f164010ebeaf`, owner
`su-cb139d4d-afff-4457-ac79-ffe5d5260df8`, with a turn at **21:21:18 -0400**
("Appending the quiet-cut suite:") and the completion summary at
**21:23:13 -0400** — both within two minutes of the commit's `21:20:07`
timestamp and describing exactly this feature ("cut candidates at quiet
moments... preferring a tick where no locks are held making torn snapshots
much r\[arer]" — the owner's own request one turn earlier, at 20:16:03,
literally asks for this).

Reading the window with `sessions:read { session: 'eec9bea1-...',
around: 617, context: 20 }` confirmed the full narrative: the owner listed
four process-improvement asks in one message (20:16:03), the agent worked
them sequentially over the next hour (fallback-on-red, the git-sync submodule
gitlink fix, the hermeticity guard, then the quiet-cut suite last), and
closed with a single summary enumerating all four as "done, tested, and
committed." **Attribution: `su-cb139d4d-afff-4457-ac79-ffe5d5260df8`,
implementing the owner's 20:16:03 request, landed in commit `107d5bd337`.**

This is the general shape of a successful hunt: the git diff alone named a
function; it took a session search anchored on that function's name plus a
timestamp cross-check to name the agent and the *reason* (an explicit owner
ask, itself recoverable from the same transcript).

## When it still won't resolve

Sometimes no session content-matches and no timestamp lines up — a squash
commit really can bundle work with no recoverable narration (a very old
session already past its retention window, or a change made via a raw shell
command with no descriptive turn text around it). In that case, **say so
plainly rather than approximating** — a confident wrong guess is worse than
an honest "not attributable from the available record." Naming the channels
you tried and why they came up empty (per the dead-end list above) is itself
useful signal for whoever asked.

## See also

* [Session search + compaction recovery](/internal/docs/agent-insights/session-search-and-compaction-recovery)
  — the general `sessions:*` tool surface and the four-memory-layers model
  this attribution technique relies on.
* [repo-conventions § branch + commit](/internal/docs/system/repo-conventions)
  — why git-sync squashes commits in the first place.
