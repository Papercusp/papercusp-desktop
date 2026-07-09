import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-BbbWoCsk.js";function r(){return a}var i,a,o=e((()=>{i=class{async isSelf(e){return!0}async route(e,t){return t.local()}},a=new i}));function s(e){return e.potSlug&&e.potSlug.length>0?e.potSlug:e.harnessSlug}async function c(e){return r().route(s(e),{local:()=>l(e),remote:{kind:C.acquire,payload:e,decode:e=>e}})}async function l(e){let n=v(e.ttlSec??1800),{sql:r}=t(),i=await r`
    INSERT INTO harness_shared.work_item_claims
      (workspace_id, harness_slug, work_item_id, pot_slug, owner, owner_label, holder_pubkey,
       intent, ttl_sec, acquired_ts, expires_ts, last_activity_ts)
    VALUES
      (${e.workspaceId}, ${e.harnessSlug}, ${e.workItemId}, ${e.potSlug??null},
       ${e.owner}, ${e.ownerLabel??null}, ${e.holderPubkey??null},
       ${e.intent??``}, ${n}, clock_timestamp(),
       clock_timestamp() + make_interval(secs => ${n}), clock_timestamp())
    ON CONFLICT (workspace_id, harness_slug, work_item_id) DO UPDATE SET
      claim_id         = gen_random_uuid(),
      pot_slug         = EXCLUDED.pot_slug,
      owner            = EXCLUDED.owner,
      owner_label      = EXCLUDED.owner_label,
      holder_pubkey    = EXCLUDED.holder_pubkey,
      intent           = EXCLUDED.intent,
      ttl_sec          = EXCLUDED.ttl_sec,
      acquired_ts      = clock_timestamp(),
      expires_ts       = clock_timestamp() + make_interval(secs => ${n}),
      last_activity_ts = clock_timestamp()
    WHERE harness_shared.work_item_claims.expires_ts <= clock_timestamp()
       OR harness_shared.work_item_claims.owner = EXCLUDED.owner
    RETURNING workspace_id, harness_slug, work_item_id, pot_slug, claim_id, owner,
           owner_label, holder_pubkey, intent, ttl_sec, acquired_ts, expires_ts,
           last_activity_ts, (expires_ts <= clock_timestamp()) AS expired
  `;if(i[0])return{ok:!0,claim:y(i[0])};let a=await r`
    SELECT workspace_id, harness_slug, work_item_id, pot_slug, claim_id, owner,
           owner_label, holder_pubkey, intent, ttl_sec, acquired_ts, expires_ts,
           last_activity_ts, (expires_ts <= clock_timestamp()) AS expired
      FROM harness_shared.work_item_claims
     WHERE workspace_id = ${e.workspaceId} AND harness_slug = ${e.harnessSlug}
       AND work_item_id = ${e.workItemId}
      FOR UPDATE
  `;if(a[0])return{ok:!1,conflict:y(a[0])};let o=await r`
    INSERT INTO harness_shared.work_item_claims
      (workspace_id, harness_slug, work_item_id, pot_slug, owner, owner_label, holder_pubkey,
       intent, ttl_sec, acquired_ts, expires_ts, last_activity_ts)
    VALUES
      (${e.workspaceId}, ${e.harnessSlug}, ${e.workItemId}, ${e.potSlug??null},
       ${e.owner}, ${e.ownerLabel??null}, ${e.holderPubkey??null},
       ${e.intent??``}, ${n}, clock_timestamp(),
       clock_timestamp() + make_interval(secs => ${n}), clock_timestamp())
    ON CONFLICT (workspace_id, harness_slug, work_item_id) DO NOTHING
    RETURNING workspace_id, harness_slug, work_item_id, pot_slug, claim_id, owner,
           owner_label, holder_pubkey, intent, ttl_sec, acquired_ts, expires_ts,
           last_activity_ts, (expires_ts <= clock_timestamp()) AS expired
  `;if(o[0])return{ok:!0,claim:y(o[0])};let s=await g(e.workspaceId,e.harnessSlug,e.workItemId);return s?{ok:!1,conflict:s}:{ok:!1,conflict:b(e)}}async function u(e){return r().route(s(e),{local:()=>d(e),remote:{kind:C.heartbeat,payload:e,decode:e=>e}})}async function d(e){let{workspaceId:n,harnessSlug:r,workItemId:i,claimId:a,owner:o,ttlSecOverride:s}=e,{sql:c}=t(),l=await c`
    UPDATE harness_shared.work_item_claims
       SET ttl_sec = ${s==null?c`ttl_sec`:v(s)},
           expires_ts = clock_timestamp() + make_interval(secs => ${s==null?c`ttl_sec`:v(s)}),
           last_activity_ts = clock_timestamp()
     WHERE workspace_id = ${n} AND harness_slug = ${r}
       AND work_item_id = ${i}
       AND claim_id = ${a}::uuid AND owner = ${o}
       AND expires_ts > clock_timestamp()
    RETURNING expires_ts
  `;if(l[0])return{renewed:!0,held:!0,expiresTs:l[0].expires_ts};let u=await g(n,r,i),d=u!=null&&u.claimId===a&&u.owner===o&&u.expired;return{renewed:!1,held:!1,expiresTs:null,reason:u&&!d?`claim is held by another owner or under a new claim_id`:`claim has lapsed or was released — re-acquire it`}}async function f(e){return r().route(s(e),{local:()=>p(e),remote:{kind:C.releaseForItem,payload:e,decode:e=>e}})}async function p(e){let{workspaceId:n,harnessSlug:r,workItemId:i,owner:a}=e,{sql:o}=t();return(await o`
    DELETE FROM harness_shared.work_item_claims
     WHERE workspace_id = ${n} AND harness_slug = ${r}
       AND work_item_id = ${i} AND owner = ${a}
    RETURNING work_item_id
  `).length>0}async function m(e){let{sql:n}=t();return(await n`
    DELETE FROM harness_shared.work_item_claims
     WHERE workspace_id = ${e.workspaceId} AND work_item_id = ${e.workItemId} AND owner = ${e.owner}
    RETURNING work_item_id
  `).length>0}async function h(){let{sql:e}=t();return(await e`
    DELETE FROM harness_shared.work_item_claims c
     USING harness_shared.engineer_issues e
     WHERE c.work_item_id = e.issue_id
       AND c.workspace_id = e.workspace_id
       AND c.intent = 'work-stealing claim (claim_next)'
       AND (e.assignee IS NULL OR e.assignee = '')
       AND e.state NOT IN ('resolved', 'closed')   -- = ISSUE_TERMINAL_STATUSES (work-item-blocking.ts)
    RETURNING c.work_item_id
  `).length}async function g(e,n,r){let{sql:i}=t(),a=await i`
    SELECT workspace_id, harness_slug, work_item_id, pot_slug, claim_id, owner,
             owner_label, holder_pubkey, intent, ttl_sec, acquired_ts, expires_ts,
             last_activity_ts, (expires_ts <= clock_timestamp()) AS expired
      FROM harness_shared.work_item_claims
     WHERE workspace_id = ${e} AND harness_slug = ${n} AND work_item_id = ${r}
  `;return a[0]?y(a[0]):null}async function _(e,n,r={}){let i=r.sql??t().sql;return(await i`
    SELECT c.work_item_id,
           (extract(epoch from c.acquired_ts) * 1000)::bigint      AS acquired_ms,
           (extract(epoch from c.last_activity_ts) * 1000)::bigint AS last_activity_ms,
           (SELECT max(cn.updated_ts)
              FROM harness_shared.carry_notes cn
             WHERE cn.scope = 'workitem:' || c.harness_slug || ':' || c.work_item_id
               AND cn.note IS NOT NULL)                            AS checkpoint_updated_ms
      FROM harness_shared.work_item_claims c
     WHERE c.owner = ${n}
       AND ${e==null?i`TRUE`:i`c.workspace_id = ${e}`}
       AND c.expires_ts > clock_timestamp()
     ORDER BY c.last_activity_ts DESC
  `).map(e=>({workItemId:e.work_item_id,acquiredMs:Number(e.acquired_ms),lastActivityMs:Number(e.last_activity_ms),checkpointUpdatedMs:e.checkpoint_updated_ms==null?null:Number(e.checkpoint_updated_ms)}))}function v(e){return!Number.isFinite(e)||e<=0?x:Math.min(Math.floor(e),S)}function y(e){return{workspaceId:e.workspace_id,harnessSlug:e.harness_slug,workItemId:e.work_item_id,potSlug:e.pot_slug,claimId:e.claim_id,owner:e.owner,ownerLabel:e.owner_label,holderPubkey:e.holder_pubkey,intent:e.intent,ttlSec:Number(e.ttl_sec),acquiredTs:e.acquired_ts,expiresTs:e.expires_ts,lastActivityTs:e.last_activity_ts,expired:!!e.expired}}function b(e){let t=new Date().toISOString();return{workspaceId:e.workspaceId,harnessSlug:e.harnessSlug,workItemId:e.workItemId,potSlug:e.potSlug??null,claimId:`00000000-0000-0000-0000-000000000000`,owner:`unknown`,ownerLabel:null,holderPubkey:null,intent:``,ttlSec:0,acquiredTs:t,expiresTs:t,lastActivityTs:t,expired:!0}}var x,S,C,w=e((()=>{n(),o(),x=1800,S=7200,C={acquire:`work-item.claim.acquire`,heartbeat:`work-item.claim.heartbeat`,release:`work-item.claim.release`,releaseForItem:`work-item.claim.release-for-item`}}));export{_ as a,w as i,h as n,f as o,u as r,m as s,c as t};