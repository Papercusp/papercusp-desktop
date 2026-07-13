import{n as e}from"./chunk-CMxvf4Kt.js";import{i as t,n,r,t as i}from"./work-items-stale-claims-BSoj6Sxt.js";async function a(e,n={}){let a=Math.max(1,Math.round((n.graceMs??i)/1e3)),o=Math.max(a,Math.round((n.parkedGraceMs??18e5)/1e3)),s=Math.max(1,Math.round((n.holdOpenGraceMs??72e5)/1e3));return{expired:await e`
    WITH live_holder AS (${r(e,a)}),
    parked_holder AS (${t(e,o)}),
    stale AS (
      SELECT w.workspace_id, w.feature_id,
             w.harness_slug, w.item_kind, w.status,
             w.payload->>'held_open_by'     AS former_holder,
             w.payload->>'held_open_reason' AS former_reason,
             w.payload->>'held_open_at'     AS held_open_at
        FROM harness_shared.work_items w
       WHERE w.payload->>'held_open_by' IS NOT NULL
         AND w.payload->>'held_open_by' <> ''
         -- (a) no fresh heartbeat on any alias (the shared mig-225 liveness rule)
         AND NOT EXISTS (SELECT 1 FROM live_holder h WHERE h.alias = w.payload->>'held_open_by')
         -- (b) not a briefly-parked/resumable session (WI-2689 churn guard)
         AND NOT EXISTS (SELECT 1 FROM parked_holder p WHERE p.alias = w.payload->>'held_open_by')
         -- (c) the hold itself is past grace (NULL/unparseable held_open_at ⇒ past grace)
         AND COALESCE(
               ${e.unsafe(l)} < now() - make_interval(secs => ${s}),
               true)
         FOR UPDATE OF w SKIP LOCKED
    )
    UPDATE harness_shared.work_items w
       SET payload = COALESCE(w.payload, '{}'::jsonb)
                       - '_claimHold' - 'held_open_by' - 'held_open_reason' - 'held_open_at',
           updated_ts = ${Date.now()}
      FROM stale s
     WHERE w.workspace_id = s.workspace_id AND w.feature_id = s.feature_id
    RETURNING s.workspace_id, s.harness_slug, s.feature_id, s.item_kind, s.status,
              s.former_holder, s.former_reason, s.held_open_at`}}async function o(e,n,a,o={}){if(!n.trim())return!1;let s=Math.max(1,Math.round((o.graceMs??i)/1e3)),c=Math.max(s,Math.round((o.parkedGraceMs??18e5)/1e3)),l=Math.max(1,Math.round((o.holdOpenGraceMs??72e5)/1e3)),u=a?Date.parse(a):NaN;if(!(Number.isNaN(u)||Date.now()-u>l*1e3))return!1;let d=await e`
    WITH live_holder AS (${r(e,s)}),
    parked_holder AS (${t(e,c)})
    SELECT (
      EXISTS (SELECT 1 FROM live_holder h WHERE h.alias = ${n})
      OR EXISTS (SELECT 1 FROM parked_holder p WHERE p.alias = ${n})
    ) AS alive`;return d[0]?!d[0].alive:!1}var s,c,l;e((()=>{n(),s=7200*1e3,c=1800*1e3,l=`CASE
        WHEN w.payload->>'held_open_at' ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}'
        THEN (w.payload->>'held_open_at')::timestamptz
      END`}))();export{s as HOLD_OPEN_GRACE_MS,c as HOLD_OPEN_PARKED_GRACE_MS,o as isHoldOpenExpired,a as reclaimStaleHoldOpens};