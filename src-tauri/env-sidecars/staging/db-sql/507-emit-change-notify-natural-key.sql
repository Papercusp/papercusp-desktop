-- 507-emit-change-notify-natural-key.sql
--
-- clear-papercusp-backlog-2026-07-02 (EI-7433) — additively teach the GENERIC
-- harness_shared.emit_change_notify() trigger (000-baseline.sql; corrected for
-- workspace_id + args.id by 368-fix-emit-change-notify-guc.sql) to also emit a
-- NATURAL-KEY fallback so id-less tables can be per-row SCOPED instead of
-- always full-busting.
--
-- WHY: the scoped (per-row) invalidation bridge in table-to-query-names.ts
-- keys off `args.id` (the changed row's PK, mig 368). Most `harness_shared.*`
-- tables have a surrogate `id`, but `harness_plans` keys on a natural
-- composite (workspace_id, harness_slug, plan_slug) with NO `id` column, so
-- `to_jsonb(row)->'id'` is JSON null and EVERY entry mapped to it falls back
-- to a full-bust (8 query names busted on every one of the ~1,075/24h plan
-- writes) — see EI-7433 for the live evidence.
--
-- FIX (CREATE OR REPLACE, idempotent, no table/trigger rewrite — all ~19+
-- triggered tables keep pointing at the same function and pick up the new
-- body immediately): additively include `args.plan_slug` —
-- `to_jsonb(COALESCE(NEW,OLD))->'plan_slug'` — which is JSON null (absent,
-- harmless) for every table other than harness_plans. table-to-query-names.ts
-- prefers `args.id` and falls back to `args.plan_slug` as the scope key, so a
-- `harness_plans` write can now resolve `plans.get`'s per-slug scope instead
-- of unconditionally full-busting.
--
-- BACKWARD-COMPATIBLE: the payload shape gains one additive field
-- (`args.plan_slug`); every existing consumer ignores unknown fields.
-- Generic on purpose (not a harness_plans-only special case) so the SAME
-- pattern (nominate a natural-key column) extends to the next id-less table
-- that needs scoping without another trigger-body edit — just add its column
-- name to the COALESCE chain here.

CREATE OR REPLACE FUNCTION harness_shared.emit_change_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  payload    jsonb;
  ws_id      text;
  q_name     text;
  row_id     jsonb;
  row_jsonb  jsonb;
  plan_slug  jsonb;
BEGIN
  ws_id := current_setting('app.workspace_id', true);
  q_name := TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME || '.changed';

  row_jsonb := to_jsonb(COALESCE(NEW, OLD));

  -- Additive: the changed row's primary key, generically. NULL (absent) when the
  -- triggered table has no `id` column — consumers ignore the extra field either way.
  row_id := row_jsonb -> 'id';

  -- Additive natural-key fallback (EI-7433): only `harness_plans` carries a
  -- `plan_slug` column today, so this is JSON null for every other table.
  -- A future id-less table needing scoping nominates its own key column the
  -- same way (add it here + teach table-to-query-names.ts's extractor).
  plan_slug := row_jsonb -> 'plan_slug';

  payload := jsonb_build_object(
    'name', q_name,
    'args', jsonb_build_object(
      'workspace_id', ws_id,
      'op',           TG_OP,
      'id',           row_id,
      'plan_slug',    plan_slug
    )
  );

  PERFORM pg_notify('sync_invalidate', payload::text);

  -- For DELETE triggers, the legal return is OLD. For INSERT/UPDATE,
  -- return NEW. The trigger is declared AFTER so the value is unused,
  -- but PostgreSQL still requires a structurally-valid return.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
