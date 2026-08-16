import{n as E}from"./chunk-ChpBd9eV.js";import{G as c,s as m,vt as S}from"./work-items-CNsmfKgm.js";import{c as i,l as _,o as w,t as p}from"./work-items-stale-claims-JRmtHGUv.js";async function k(e,a={}){const r=Math.max(1,Math.round((a.graceMs??p)/1e3)),o=Math.max(r,Math.round((a.parkedGraceMs??18e5)/1e3)),d=Math.max(1,Math.round((a.holdOpenGraceMs??72e5)/1e3)),t=await e`
    WITH live_holder AS (${i(e,r)}),
    parked_holder AS (${_(e,o)}),
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
               ${e.unsafe(h)} < now() - make_interval(secs => ${d}),
               true)
         -- (d) WI-6774: a POLICY-TIER gate (D-NNN decision id / triageDecision:"gate" /
         -- literal "policy-tier" in the reason) must NEVER be auto-lifted by mere holder
         -- liveness expiry — it is deliberately set to survive ordinary session churn and
         -- may only be cleared via the audited, ownerOverride-gated work_items:hold_open
         -- clear path (looksLikePolicyGate). Same pattern list as that JS predicate, kept
         -- in one shared constant so the two cannot drift.
         AND NOT COALESCE(w.payload->>'held_open_reason', '') ~* ANY(${m})
         FOR UPDATE OF w SKIP LOCKED
    )
    UPDATE harness_shared.work_items w
       -- A durable PARK (claim_hold_by, from release {claimHold:true}) may coexist with the
       -- dead lease being lifted — it is deliberately NOT liveness-bound, so lift only the
       -- held_open_* lease and keep _claimHold when the park is present.
       SET payload = CASE
             WHEN COALESCE(w.payload, '{}'::jsonb) ? 'claim_hold_by'
             THEN COALESCE(w.payload, '{}'::jsonb)
                    - 'held_open_by' - 'held_open_reason' - 'held_open_at'
             ELSE COALESCE(w.payload, '{}'::jsonb)
                    - '_claimHold' - 'held_open_by' - 'held_open_reason' - 'held_open_at'
           END,
           updated_ts = ${Date.now()}
      FROM stale s
     WHERE w.workspace_id = s.workspace_id AND w.feature_id = s.feature_id
    RETURNING s.workspace_id, s.harness_slug, s.feature_id, s.item_kind, s.status,
              s.former_holder, s.former_reason, s.held_open_at`;return S(e,t.map(s=>({id:s.feature_id,workspaceId:s.workspace_id,formerHolder:s.former_holder})),{actor:"hold-open-sweep",sweepName:"reclaimStaleHoldOpens"}),{expired:t}}async function f(e,a,r,o={}){if(!a.trim())return!1;const d=Math.max(1,Math.round((o.graceMs??p)/1e3)),t=Math.max(d,Math.round((o.parkedGraceMs??18e5)/1e3)),s=Math.max(1,Math.round((o.holdOpenGraceMs??72e5)/1e3)),l=r?Date.parse(r):NaN;if(!(Number.isNaN(l)||Date.now()-l>s*1e3))return!1;const n=await e`
    WITH live_holder AS (${i(e,d)}),
    parked_holder AS (${_(e,t)})
    SELECT (
      EXISTS (SELECT 1 FROM live_holder h WHERE h.alias = ${a})
      OR EXISTS (SELECT 1 FROM parked_holder p WHERE p.alias = ${a})
    ) AS alive`;return n[0]?!n[0].alive:!1}var u,y,h,M=E((()=>{w(),c(),u=7200*1e3,y=1800*1e3,h=`CASE
        WHEN w.payload->>'held_open_at' ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}'
        THEN (w.payload->>'held_open_at')::timestamptz
      END`}));export{f as a,M as i,u as n,k as o,y as r,h as t};
