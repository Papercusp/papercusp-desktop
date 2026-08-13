-- 815 — EI-20288042426947475
--
-- The claim-spec SQL compiler reads these five values from the shared
-- work_items base row. The issue-family JS path reads the engineer_issues
-- compatibility view, which previously dropped them, so issue rows silently
-- fell back to payload-only values (or to defaults) and could disagree with
-- the SQL admission path. The columns already exist on work_items; append them
-- to preserve every existing engineer_issues view ordinal and its DML trigger.

CREATE OR REPLACE VIEW harness_shared.engineer_issues AS
 SELECT workspace_id,
    feature_id AS issue_id,
        CASE
            WHEN harness_slug ~~ 'operator:%'::text OR harness_slug = ''::text THEN 'operator'::text
            ELSE 'harness:'::text || harness_slug
        END AS scope,
    title,
    COALESCE(summary, ''::text) AS body,
    COALESCE((payload -> '_ei'::text) ->> 'severity'::text, 'minor'::text) AS severity,
    COALESCE((payload -> '_ei'::text) ->> 'source'::text, 'engineer'::text) AS source,
    status AS state,
    taken_by AS assignee,
    (payload -> '_ei'::text) ->> 'found_during'::text AS found_during,
    (payload -> '_ei'::text) ->> 'linked_feature_id'::text AS linked_feature_id,
    (payload -> '_ei'::text) ->> 'created_by'::text AS created_by,
    to_timestamp((created_ts::numeric / 1000.0)::double precision) AS created_at,
    to_timestamp((updated_ts::numeric / 1000.0)::double precision) AS updated_at,
    author_pubkey,
    origin,
    _search,
    item_kind AS kind,
    payload - '_ei'::text AS payload,
    (payload -> '_ei'::text) ->> 'assigned_by'::text AS assigned_by,
    taken_at AS assigned_at,
    assignee_rank,
    rank_writer,
    rank_updated_at,
    fed_ts,
    COALESCE((payload -> '_ei'::text) ->> 'signal_origin'::text, 'organic'::text) AS signal_origin,
    fed_hlc,
    terminal_owner,
    terminal_completion_ref,
    last_progress_at,
    harness_slug AS base_harness_slug,
    origin AS base_origin,
    feature_order,
    terminal_reason,
    authority,
    closed_ts,
    lane,
    embedding,
    embedding_mode,
    goal_id,
    parent_id,
    -- WI-20288042426947475: claim-spec projection, appended for view stability.
    tags,
    source_plan_slug,
    source_plan_item_ids,
    redundancy,
    expected_cost_cents
   FROM harness_shared.work_items
  WHERE item_kind = ANY (ARRAY['bug'::text, 'change'::text, 'task'::text]);
