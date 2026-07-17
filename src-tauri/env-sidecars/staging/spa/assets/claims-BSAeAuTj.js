import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CwW4br4q.js";import{n as r,t as i}from"./workspace-id-constant-E7VkkAiJ.js";var a,o=e((()=>{a=class{async isSelf(e){return!0}async route(e,t){return t.local()}},new a}));async function s(e,n){let{sql:r}=t();return(await r`
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
  `).map(e=>e.item_id)}async function c(e,n,r,i){let{sql:a}=t(),o=await a`
    SELECT workspace_id, harness_slug, plan_slug, item_id, claim_id, owner,
             owner_label, owner_name, intent, liveness_mode, ttl_sec, acquired_ts, expires_ts,
             last_activity_ts, (expires_ts <= clock_timestamp()) AS expired FROM harness_shared.plan_item_claims
     WHERE workspace_id = ${e} AND harness_slug = ${n}
       AND plan_slug = ${r} AND item_id = ${i}
  `;return o[0]?l(o[0]):null}function l(e){return{workspaceId:e.workspace_id,harnessSlug:e.harness_slug,planSlug:e.plan_slug,itemId:e.item_id,claimId:e.claim_id,owner:e.owner,ownerLabel:e.owner_label,ownerName:e.owner_name,intent:e.intent,livenessMode:e.liveness_mode??`availability`,ttlSec:Number(e.ttl_sec),acquiredTs:e.acquired_ts,expiresTs:e.expires_ts,lastActivityTs:e.last_activity_ts,expired:!!e.expired}}var u=e((()=>{n(),r(),o(),Number({}.PAPERCUSP_CLAIM_LAPSE_ACTIVITY_GRACE_SEC??600)}));export{u as n,s as r,c as t};