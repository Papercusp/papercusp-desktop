import{n as s}from"./chunk-ChpBd9eV.js";import{G as i,s as l,vt as E}from"./work-items-CNsmfKgm.js";import{c as w,l as c,o as p,t as S}from"./work-items-stale-claims-JRmtHGUv.js";import{i as h,t as m}from"./work-items-hold-open-DlFy8ofo.js";async function M(e,r={}){const d=Math.max(1,Math.round((r.graceMs??S)/1e3)),_=Math.max(d,Math.round((r.parkedGraceMs??18e5)/1e3)),t=Math.max(1,Math.round((r.ownerGraceMs??72e5)/1e3)),n=Math.max(1,Math.round((r.holdOpenGraceMs??72e5)/1e3)),a=(await e`
    WITH live_holder AS (${w(e,d)}),
    parked_holder AS (${c(e,_)}),
    dead_owner AS (
      SELECT DISTINCT r.target_owner_id AS owner_id
        FROM harness_shared.routines r
       WHERE r.active = TRUE
         AND r.reschedule_interval_sec IS NOT NULL
         AND r.target_owner_id IS NOT NULL AND r.target_owner_id <> ''
         AND r.updated_at < now() - make_interval(secs => ${t})
         AND NOT EXISTS (SELECT 1 FROM live_holder h WHERE h.alias = r.target_owner_id)
         AND NOT EXISTS (SELECT 1 FROM parked_holder p WHERE p.alias = r.target_owner_id)
    ),
    ended_loop AS (
      UPDATE harness_shared.routines r
         SET active = FALSE, updated_at = now(),
             metadata = COALESCE(r.metadata, '{}'::jsonb)
               - 'last_error' - 'last_error_at' - 'last_error_source'
               || jsonb_build_object('dead_owner_swept_at', now()::text)
        FROM dead_owner d
       WHERE r.target_owner_id = d.owner_id
         AND r.active = TRUE AND r.reschedule_interval_sec IS NOT NULL
      RETURNING r.target_owner_id
    ),
    lifted_hold AS (
      UPDATE harness_shared.work_items w
         -- Same park-preservation as reclaimStaleHoldOpens: a durable park (claim_hold_by)
         -- is not liveness-bound — lift only the dead lease, keep _claimHold with it.
         SET payload = CASE
               WHEN COALESCE(w.payload, '{}'::jsonb) ? 'claim_hold_by'
               THEN COALESCE(w.payload, '{}'::jsonb)
                      - 'held_open_by' - 'held_open_reason' - 'held_open_at'
               ELSE COALESCE(w.payload, '{}'::jsonb)
                      - '_claimHold' - 'held_open_by' - 'held_open_reason' - 'held_open_at'
             END,
             updated_ts = ${Date.now()}
        FROM dead_owner d
       WHERE w.payload->>'held_open_by' = d.owner_id
         AND COALESCE(
               ${e.unsafe(m)} < now() - make_interval(secs => ${n}),
               true)
         -- WI-6774: a POLICY-TIER hold (D-NNN / triageDecision:"gate" / literal
         -- "policy-tier" in the reason) survives dead-owner-liveness cleanup — same rule,
         -- same shared pattern constant, as reclaimStaleHoldOpens. Only the audited,
         -- ownerOverride-gated work_items:hold_open clear may lift one of these.
         AND NOT COALESCE(w.payload->>'held_open_reason', '') ~* ANY(${l})
      RETURNING d.owner_id, w.workspace_id, w.feature_id
    )
    SELECT (SELECT array_agg(owner_id ORDER BY owner_id) FROM dead_owner) AS owners,
           (SELECT count(*) FROM ended_loop) AS loops_terminated,
           (SELECT count(*) FROM lifted_hold) AS holds_lifted,
           (SELECT COALESCE(json_agg(json_build_object(
                     'workspace_id', workspace_id, 'feature_id', feature_id, 'former_holder', owner_id
                   )), '[]'::json)
              FROM lifted_hold) AS lifted_items`)[0];return E(e,(a?.lifted_items??[]).map(o=>({id:o.feature_id,workspaceId:o.workspace_id,formerHolder:o.former_holder})),{actor:"dead-owner-control-sweep",sweepName:"sweepDeadOwnerControlState"}),{owners:a?.owners??[],loopsTerminated:Number(a?.loops_terminated??0),holdsLifted:Number(a?.holds_lifted??0)}}var A,N=s((()=>{p(),h(),i(),A=7200*1e3}));N();export{M as sweepDeadOwnerControlState};
