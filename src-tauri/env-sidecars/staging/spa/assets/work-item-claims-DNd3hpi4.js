import{n as E}from"./chunk-ChpBd9eV.js";import{st as i,t as S}from"./src-8fWtxfEz.js";function d(){return w}function x(e){w=e}var p,w,A=E((()=>{p=class{async isSelf(e){return!0}async route(e,t){return t.local()}},w=new p}));function k(e){return e.potSlug&&e.potSlug.length>0?e.potSlug:e.harnessSlug}async function O(e){return d().route(k(e),{local:()=>R(e),remote:{kind:o.acquire,payload:e,decode:t=>t}})}async function R(e){const t=u(e.ttlSec??1800),{sql:s}=i(),r=await s`
    INSERT INTO harness_shared.work_item_claims
      (workspace_id, harness_slug, work_item_id, pot_slug, owner, owner_label, holder_pubkey,
       intent, ttl_sec, acquired_ts, expires_ts, last_activity_ts)
    VALUES
      (${e.workspaceId}, ${e.harnessSlug}, ${e.workItemId}, ${e.potSlug??null},
       ${e.owner}, ${e.ownerLabel??null}, ${e.holderPubkey??null},
       ${e.intent??""}, ${t}, clock_timestamp(),
       clock_timestamp() + make_interval(secs => ${t}), clock_timestamp())
    ON CONFLICT (workspace_id, harness_slug, work_item_id) DO UPDATE SET
      claim_id         = gen_random_uuid(),
      pot_slug         = EXCLUDED.pot_slug,
      owner            = EXCLUDED.owner,
      owner_label      = EXCLUDED.owner_label,
      holder_pubkey    = EXCLUDED.holder_pubkey,
      intent           = EXCLUDED.intent,
      ttl_sec          = EXCLUDED.ttl_sec,
      acquired_ts      = clock_timestamp(),
      expires_ts       = clock_timestamp() + make_interval(secs => ${t}),
      last_activity_ts = clock_timestamp()
    WHERE harness_shared.work_item_claims.expires_ts <= clock_timestamp()
       OR harness_shared.work_item_claims.owner = EXCLUDED.owner
    RETURNING workspace_id, harness_slug, work_item_id, pot_slug, claim_id, owner,
           owner_label, holder_pubkey, intent, ttl_sec, acquired_ts, expires_ts,
           last_activity_ts, (expires_ts <= clock_timestamp()) AS expired
  `;if(r[0])return{ok:!0,claim:c(r[0])};const a=await s`
    SELECT workspace_id, harness_slug, work_item_id, pot_slug, claim_id, owner,
           owner_label, holder_pubkey, intent, ttl_sec, acquired_ts, expires_ts,
           last_activity_ts, (expires_ts <= clock_timestamp()) AS expired
      FROM harness_shared.work_item_claims
     WHERE workspace_id = ${e.workspaceId} AND harness_slug = ${e.harnessSlug}
       AND work_item_id = ${e.workItemId}
      FOR UPDATE
  `;if(a[0])return{ok:!1,conflict:c(a[0])};const l=await s`
    INSERT INTO harness_shared.work_item_claims
      (workspace_id, harness_slug, work_item_id, pot_slug, owner, owner_label, holder_pubkey,
       intent, ttl_sec, acquired_ts, expires_ts, last_activity_ts)
    VALUES
      (${e.workspaceId}, ${e.harnessSlug}, ${e.workItemId}, ${e.potSlug??null},
       ${e.owner}, ${e.ownerLabel??null}, ${e.holderPubkey??null},
       ${e.intent??""}, ${t}, clock_timestamp(),
       clock_timestamp() + make_interval(secs => ${t}), clock_timestamp())
    ON CONFLICT (workspace_id, harness_slug, work_item_id) DO NOTHING
    RETURNING workspace_id, harness_slug, work_item_id, pot_slug, claim_id, owner,
           owner_label, holder_pubkey, intent, ttl_sec, acquired_ts, expires_ts,
           last_activity_ts, (expires_ts <= clock_timestamp()) AS expired
  `;if(l[0])return{ok:!0,claim:c(l[0])};const n=await I(e.workspaceId,e.harnessSlug,e.workItemId);return n?{ok:!1,conflict:n}:{ok:!1,conflict:g(e)}}async function C(e){return d().route(k(e),{local:()=>T(e),remote:{kind:o.heartbeat,payload:e,decode:t=>t}})}async function T(e){const{workspaceId:t,harnessSlug:s,workItemId:r,claimId:a,owner:l,ttlSecOverride:n}=e,{sql:m}=i(),h=await m`
    UPDATE harness_shared.work_item_claims
       SET ttl_sec = ${n!=null?u(n):m`ttl_sec`},
           expires_ts = clock_timestamp() + make_interval(secs => ${n!=null?u(n):m`ttl_sec`}),
           last_activity_ts = clock_timestamp()
     WHERE workspace_id = ${t} AND harness_slug = ${s}
       AND work_item_id = ${r}
       AND claim_id = ${a}::uuid AND owner = ${l}
       AND expires_ts > clock_timestamp()
    RETURNING expires_ts
  `;if(h[0])return{renewed:!0,held:!0,expiresTs:h[0].expires_ts};const _=await I(t,s,r),D=_!=null&&_.claimId===a&&_.owner===l&&_.expired;return{renewed:!1,held:!1,expiresTs:null,reason:_&&!D?"claim is held by another owner or under a new claim_id":"claim has lapsed or was released — re-acquire it"}}async function q(e){const{workspaceId:t,harnessSlug:s,workItemId:r,claimId:a,owner:l}=e,{sql:n}=i();return(await n`
    DELETE FROM harness_shared.work_item_claims
     WHERE workspace_id = ${t} AND harness_slug = ${s}
       AND work_item_id = ${r}
       AND claim_id = ${a}::uuid AND owner = ${l}
    RETURNING work_item_id
  `).length>0}async function v(e){return d().route(k(e),{local:()=>$(e),remote:{kind:o.releaseForItem,payload:e,decode:t=>t}})}async function $(e){const{workspaceId:t,harnessSlug:s,workItemId:r,owner:a}=e,{sql:l}=i();return(await l`
    DELETE FROM harness_shared.work_item_claims
     WHERE workspace_id = ${t} AND harness_slug = ${s}
       AND work_item_id = ${r} AND owner = ${a}
    RETURNING work_item_id
  `).length>0}async function U(e){const{sql:t}=i();return(await t`
    DELETE FROM harness_shared.work_item_claims
     WHERE workspace_id = ${e.workspaceId} AND work_item_id = ${e.workItemId} AND owner = ${e.owner}
    RETURNING work_item_id
  `).length>0}async function F(){const{sql:e}=i();return(await e`
    DELETE FROM harness_shared.work_item_claims c
     USING harness_shared.engineer_issues e
     WHERE c.work_item_id = e.issue_id
       AND c.workspace_id = e.workspace_id
       AND c.intent = 'work-stealing claim (claim_next)'
       AND (e.assignee IS NULL OR e.assignee = '')
       AND e.state NOT IN ('resolved', 'closed', 'done', 'dropped')   -- ISSUE_TERMINAL_STATUSES, transitional legacy∪unified (work-item-status-full-unify)
    RETURNING c.work_item_id
  `).length}async function M(e,t){const{sql:s}=i();return(await s`
    DELETE FROM harness_shared.work_item_claims
     WHERE workspace_id = ${e} AND owner = ${t}
    RETURNING work_item_id
  `).length}async function I(e,t,s){const{sql:r}=i(),a=await r`
    SELECT workspace_id, harness_slug, work_item_id, pot_slug, claim_id, owner,
             owner_label, holder_pubkey, intent, ttl_sec, acquired_ts, expires_ts,
             last_activity_ts, (expires_ts <= clock_timestamp()) AS expired
      FROM harness_shared.work_item_claims
     WHERE workspace_id = ${e} AND harness_slug = ${t} AND work_item_id = ${s}
  `;return a[0]?c(a[0]):null}async function W(e,t){const{sql:s}=i(),r=await s`
    SELECT workspace_id, harness_slug, work_item_id, pot_slug, claim_id, owner,
             owner_label, holder_pubkey, intent, ttl_sec, acquired_ts, expires_ts,
             last_activity_ts, (expires_ts <= clock_timestamp()) AS expired
      FROM harness_shared.work_item_claims
     WHERE workspace_id = ${e} AND owner = ${t}
       AND expires_ts > clock_timestamp()
     ORDER BY last_activity_ts DESC
     LIMIT 1
  `;return r[0]?c(r[0]):null}async function H(e,t,s={}){const r=s.sql??i().sql;return(await r`
    SELECT c.work_item_id,
           (extract(epoch from c.acquired_ts) * 1000)::bigint      AS acquired_ms,
           (extract(epoch from c.last_activity_ts) * 1000)::bigint AS last_activity_ms,
           (SELECT max(cn.updated_ts)
              FROM harness_shared.carry_notes cn
             WHERE cn.scope = 'workitem:' || c.harness_slug || ':' || c.work_item_id
               AND cn.note IS NOT NULL)                            AS checkpoint_updated_ms
      FROM harness_shared.work_item_claims c
     WHERE c.owner = ${t}
       AND ${e!=null?r`c.workspace_id = ${e}`:r`TRUE`}
       AND c.expires_ts > clock_timestamp()
     ORDER BY c.last_activity_ts DESC
  `).map(a=>({workItemId:a.work_item_id,acquiredMs:Number(a.acquired_ms),lastActivityMs:Number(a.last_activity_ms),checkpointUpdatedMs:a.checkpoint_updated_ms==null?null:Number(a.checkpoint_updated_ms)}))}async function G(e,t){const{sql:s}=i();return(await s`
    DELETE FROM harness_shared.work_item_claims
     WHERE workspace_id = ${e}
       AND ${t?s`harness_slug = ${t}`:s`TRUE`}
       AND expires_ts <= clock_timestamp()
    RETURNING work_item_id
  `).length}function u(e){return!Number.isFinite(e)||e<=0?N:Math.min(Math.floor(e),y)}function c(e){return{workspaceId:e.workspace_id,harnessSlug:e.harness_slug,workItemId:e.work_item_id,potSlug:e.pot_slug,claimId:e.claim_id,owner:e.owner,ownerLabel:e.owner_label,holderPubkey:e.holder_pubkey,intent:e.intent,ttlSec:Number(e.ttl_sec),acquiredTs:e.acquired_ts,expiresTs:e.expires_ts,lastActivityTs:e.last_activity_ts,expired:!!e.expired}}function g(e){const t=new Date().toISOString();return{workspaceId:e.workspaceId,harnessSlug:e.harnessSlug,workItemId:e.workItemId,potSlug:e.potSlug??null,claimId:"00000000-0000-0000-0000-000000000000",owner:"unknown",ownerLabel:null,holderPubkey:null,intent:"",ttlSec:0,acquiredTs:t,expiresTs:t,lastActivityTs:t,expired:!0}}function P(e){return{ok:!1,conflict:{...g(e),intent:"refused: caller revoked"},refused:"caller_revoked"}}var N,y,o,X=E((()=>{S(),A(),N=1800,y=7200,o={acquire:"work-item.claim.acquire",heartbeat:"work-item.claim.heartbeat",release:"work-item.claim.release",releaseForItem:"work-item.claim.release-for-item"}}));export{$ as _,R as a,A as b,I as c,X as d,H as f,U as g,v as h,O as i,C as l,M as m,y as n,F as o,P as p,o as r,W as s,N as t,T as u,q as v,x,G as y};
