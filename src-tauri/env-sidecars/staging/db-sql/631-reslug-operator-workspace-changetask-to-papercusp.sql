-- 631-reslug-operator-workspace-changetask-to-papercusp.sql
--
-- Owner-directed 2026-07-19 [owner:owner, "retype harness_slug" — P-009 Option B]:
-- second slice of the harness_slug retype. Migration 630 moved the BUG rows off
-- the invented slug 'operator:papercusp-workspace'; this moves the remaining
-- issue-family rows (change/task) to the real pot 'papercusp', fully emptying
-- that slug.
--
-- WHY / SAFETY (verified in PG at authoring, 2026-07-19)
-- * 'operator:papercusp-workspace' holds ONLY issue-family rows (bug already
--   moved; 5,450 change/task; ZERO feature-family / other kinds) — so there is
--   no feature_* satellite fan-out to update, and no risk to the feature views.
-- * ZERO (harness_slug, feature_id) PK collisions with existing 'papercusp'
--   rows for these kinds — so no de-dup/DELETE step is needed (unlike 630).
-- * The harness_slug-keyed satellites (work_item_claims / work_item_blocked /
--   work_item_replicas) hold ZERO rows for this slug.
-- * Only harness_slug changes; feature_id (EI-/WI- ids) preserved → deps and
--   threads keyed by id stay intact. workspace_id is already 'papercusp-workspace'
--   (matches papercusp rows) and is left untouched.
-- * Idempotent: after the first run no such rows remain (backup INSERT + UPDATE
--   match 0 on re-run); a no-op on a fresh embedded-pg build.

-- 1. Backup for reversibility.
CREATE TABLE IF NOT EXISTS harness_shared.bak_20260719_reslug_operator_changetask (
    feature_id        text        NOT NULL,
    old_harness_slug  text        NOT NULL,
    item_kind         text,
    status            text,
    moved_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO harness_shared.bak_20260719_reslug_operator_changetask (feature_id, old_harness_slug, item_kind, status)
SELECT feature_id, harness_slug, item_kind, status
FROM harness_shared.work_items
WHERE harness_slug = 'operator:papercusp-workspace'
  AND item_kind IN ('change', 'task');

-- 2. Re-slug to papercusp (no collisions → straight UPDATE).
UPDATE harness_shared.work_items
SET harness_slug = 'papercusp'
WHERE harness_slug = 'operator:papercusp-workspace'
  AND item_kind IN ('change', 'task');
