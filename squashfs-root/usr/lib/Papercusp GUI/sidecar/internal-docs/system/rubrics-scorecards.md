# Rubrics and scorecards — measuring what "good" means
URL: /internal/docs/system/rubrics-scorecards

The shared grading standards agents propose and ratify (rubrics), the graded observations emitted against them (scorecards), and the freshness/trend machinery that monitors the monitor.

Free-text observations tell you *something* is off; they don't tell you whether
it's getting better. **Rubrics** fix that: a rubric is the shared, ratified
definition of what "good" means for one system characteristic — named criteria,
a rating scale — so different agents grading at different times produce
comparable signal. **Scorecards** are the graded observations emitted against
a rubric.

## The lifecycle

1. **Propose** — `rubrics:propose`. Any agent may; the typical trigger is
   noticing a cluster of free-text observations about one characteristic with
   no rubric covering it. Status `proposed`; idempotent on `rubric_id`
   (re-propose updates content).
2. **Ratify** — `rubrics:ratify` (the Mug/owner gate). An `active` rubric
   becomes the standard every agent grades against.
3. **Grade** — a rubric-graded observation is an `improvements:capture` with
   `rubricRef` + per-criterion `{ rating, evidence }` — never a bare score.
   The Overwatch emits a scorecard every wake; any agent can grade when a
   ratified rubric covers what it just measured.
4. **Read back** — `scorecards:list` (filter by rubricRef / sourceHive /
   since; each row exposes completeness via `nKeys` + `missingKeys`) and
   `rubrics:trend` (per-criterion direction over time: improving / worsening /
   stable / unknown).

Discovery: `rubrics:list` / `rubrics:search` show what the system already
knows how to measure — check before proposing a near-duplicate.

## Monitoring the monitor

Scorecards are only useful if they keep arriving, complete:

* **`scorecards:freshness`** — has a COMPLETE scorecard landed for a rubric
  since a given time? `fresh` / `partial-only` (silent truncation) / `stale`
  (silent emission gap).
* **`rubrics:trend`'s staleness signal** — criteria the grader persistently
  rates `unknown` mean the rubric's model has drifted from reality; it should
  re-enter the propose↔ratify loop.

A stale scorecard is itself a finding — ideation passes treat it as a prompt
("why did we stop being able to measure this?").

## How this feeds the loop

Rubric-graded signal is the quantitative backbone of the
[observations pipeline](/internal/docs/system/observations) and the
[scout loop](/internal/docs/system/scout-loop): trends tell the Mug where to
aim work, and graded evidence makes "this improved" a claim with data behind
it. Grading **enriches** ideation but never gates it — a low self-grade is
context for the owner, not a reason to withhold a proposal.
