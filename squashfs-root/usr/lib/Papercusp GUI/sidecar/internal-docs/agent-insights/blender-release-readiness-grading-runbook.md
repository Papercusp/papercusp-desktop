# Grading Blender public-release readiness
URL: /internal/docs/agent-insights/blender-release-readiness-grading-runbook

Deterministic runbook for the blender-release-readiness rubric: live watch metrics, DBOS grading-watchdog liveness, tenant-scoped grade flow, drill freshness, ledger reconciliation, red-path integrity, and complete scorecard filing.

# Grading Blender public-release readiness

This is the rubric-level `methodRef` for `blender-release-readiness`. The active
rubric owns the exact model, bar, drift markers, and replication procedure for
each criterion; this page owns the shared grading sequence and the evidence
rules that keep six individually-correct checks from becoming a misleading
release verdict.

Release is **GO only when one complete, fresh scorecard rates all six criteria
`pass`**. `at-risk`, `fail`, or `unknown` is NO-GO. An empty window never
certifies health, and old evidence does not substitute for an on-demand drill.

## One grading pass

1. Read `rubrics:get { rubricRef: 'blender-release-readiness' }`. Never grade a
   remembered revision; this rubric is deliberately improved as live defects
   teach us better probes.
2. Run `blender:success-metrics { harnessSlug: 'papercusp' }`, then run the
   saved hourly-watch recipe for the post-fix timeout window, signal-lane
   activation, and grading-watchdog fires. The success-metrics window and the
   post-fix watch answer different questions; record both.
3. Gather the criterion-specific evidence below. Scope every raw ledger query
   to `workspace_id='papercusp-workspace'` and its real `harness_slug`. A
   workspace-wide count silently mixes `@singleton`, `papercusp`, and other
   Pots and is not admissible release evidence.
4. File one complete rubric observation, then read `rubrics:trend`. Worsening is
   surfaced immediately; it is not deferred to the next hourly wake.
5. Act on an actionable failure. Passive waiting is valid only while the
   criterion's own eligibility window is genuinely empty.

## Deterministic evidence bundle

### Cycle error rate

Use the post-fix watermark from WI-4475's current checkpoint. Split cycles into
timeout-class, explicit no-capacity, and clean. Capacity stays outside the
genuine-error numerator; timeout-class stays inside it. Do not use a newest-N
window when the active rubric requires 48 hours or a post-fix watermark.

The WI-4475 soak bar (roughly ten clean RAN cycles) is stricter than the
criterion's arithmetic bar and remains the completion guard for that incident.
A background-host restart invalidates its old watermark; reset the window to
the observed restart timestamp rather than combining generations.

### Multi-lens routing

Read the newest 20 `origin='scout'` routed rows, not lifetime history. Require at
least two distinct lenses and check recent tick reasons for a consecutive
`budget-exhausted + 0 routed` streak. Judge the configured roster's outcome;
do not turn an owner cost choice into a hardcoded roster-size requirement.

### Grading-loop closure

The ungraded-filings sweep is **not** a `harness_shared.routines` row. It is the
DBOS step `su-ideate-ungraded-sweep` inside the scheduled `routinesTick`
workflow. Absence from `routines:list` therefore proves nothing.

Prove the real execution path:

```sql
SELECT count(*) AS executions,
       max(o.completed_at_epoch_ms) AS latest_completed_ms,
       count(*) FILTER (WHERE o.error IS NOT NULL) AS errors
FROM dbos.operation_outputs o
JOIN dbos.workflow_status w ON w.workflow_uuid = o.workflow_uuid
WHERE w.name = 'routinesTick'
  AND o.function_name = 'su-ideate-ungraded-sweep'
  AND o.started_at_epoch_ms >
      extract(epoch FROM now() - interval '15 minutes') * 1000;
```

Then scope the teaching signal:

```sql
SELECT origin,
       count(*) FILTER (WHERE human_grade IS NOT NULL) AS graded,
       count(*) AS total
FROM harness_shared.scout_routed_ideas
WHERE workspace_id = 'papercusp-workspace'
  AND harness_slug = 'papercusp'
GROUP BY origin;
```

Count eligible rows using the **live** `suIdeateUngradedStaleSec` value (default
seven days; a deployed environment override wins), the enablement epoch
`2026-07-11T00:00:00Z`, `origin='su-ideate'`, `human_grade IS NULL`, and a
pending/null outcome. Zero watchdog fires is healthy only when the DBOS step is
executing without errors and eligible rows are zero. Once eligible rows exist,
require a fire, grades landing afterward, priming/win-rate refresh, and one
observed low-grade-with-feedback revision wake.

### On-demand drill

The repeatable P-013/WI-4457 integration drill proves the code path, but public
release also requires the deployed generation to run it. Confirm an
`origin='drill'` signal flows through digest, rubric-seeded ideation, routing,
and the grading surface, while organic metrics remain unchanged. No live drill
row after the release-candidate generation is `fail`, not “previously tested.”

### Ledger reconciliation

For each recent routed Scout cycle, compare the tick's claimed routed count to
`scout_routed_ideas` grouped by `cycle_id` (not `cycle`). Exclude rows with
`cycle_id IS NULL`; su-ideate rows legitimately have no Scout cycle. Any
mismatch fails. If no post-fix cycle routed anything, rate `unknown` instead of
reusing an older pass.

### Instrument integrity

Every bar needs a demonstrated red path. Point to a failing fixture or a live
`origin='drill'` break for each criterion, then show it returns green after the
break is removed. A declared guard with no call site, a cited test that does not
exist, a lifetime window masking current collapse, or a zero-row query that
cannot distinguish healthy from dead all fail this criterion.

## Filing the scorecard

Use `improvements:capture` with `lane:'observation'` and:

```text
observation: {
  kind: 'reinforce',
  rubricRef: 'blender-release-readiness',
  ratings: { <all six criterion keys>: { rating, evidence } },
  linkTo: ['WI-4458']
}
```

Every criterion is mandatory and every rating needs concrete evidence. Use
`unknown` when there was no activity to measure. After the write, read
`scorecards:list` and require `missingKeys: []`, then read `rubrics:trend` for
direction. The scorecard is the release record; a prose status report is not.
