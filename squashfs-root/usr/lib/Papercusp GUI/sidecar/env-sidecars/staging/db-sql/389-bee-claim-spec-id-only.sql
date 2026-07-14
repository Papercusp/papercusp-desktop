-- 389: bee_claim_specs.id_only — the id-pin observability tripwire (claim-spec id-filter, 2026).
--
-- WHY: the claim-spec vocabulary now allows `view.filter: { field:'id', op:'in', value:[...] }` —
-- a STATIC pin of a fixed work-item set, the intended exception for a hotfix / cutover / re-drive
-- wave (it forfeits auto-inflow + work-stealing, so it is the wrong tool for a standing lane). A
-- Queen who pins by id for ONGOING work has quietly fallen back to hand-listing items (the old
-- `tasks` habit). This column denormalizes `isIdOnlySelector(spec)` per stored spec so over-reliance
-- is a one-line COUNT (`SELECT count(*) FROM bee_claim_specs WHERE id_only`) rather than a jsonb
-- scan — keeping the describe-by-property discipline visible. setClaimSpec writes it on every upsert.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE harness_shared.bee_claim_specs
  ADD COLUMN IF NOT EXISTS id_only boolean NOT NULL DEFAULT false;
