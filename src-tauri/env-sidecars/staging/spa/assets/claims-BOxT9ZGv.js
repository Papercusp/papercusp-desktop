import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CgbVJkBN.js";import{n as r,t as i}from"./workspace-id-constant-E7VkkAiJ.js";var a,o=e((()=>{a=class{async isSelf(e){return!0}async route(e,t){return t.local()}},new a}));async function s(e,n){let{sql:r}=t();return(await r`
    UPDATE harness_shared.plan_item_claims
       SET expires_ts = clock_timestamp() + make_interval(secs => ttl_sec),
           last_activity_ts = clock_timestamp()
     WHERE (workspace_id = ${e} OR workspace_id = ${i})
       AND owner = ${n}
       -- BOTH liveness modes renew here (EI-295 residual): no explicit
       -- availability-heartbeat path exists yet, so the per-turn renewal is
       -- the ONLY thing keeping a turn-active owner's availability lane from
       -- lapsing mid-session (activity-claim-renewal.integration.test.ts).
       AND expires_ts > clock_timestamp()
    RETURNING item_id
  `).map(e=>e.item_id)}var c=e((()=>{n(),r(),o(),Number({}.PAPERCUSP_CLAIM_LAPSE_ACTIVITY_GRACE_SEC??600)}));export{s as n,c as t};