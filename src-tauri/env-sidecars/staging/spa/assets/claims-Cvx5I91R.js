import{n as D}from"./chunk-ChpBd9eV.js";import{st as o,t as R}from"./src-BmBNODK0.js";import{n as w,t as x}from"./agent-orders-notify-ChDuQYtG.js";import{n as f,t as $}from"./workspace-id-constant-AQ2MH5pQ.js";function A(){return g}function G(e){g=e}var T,g,C=D((()=>{T=class{async isSelf(e){return!0}async route(e,a){return a.local()}},g=new T}));async function X(e){return A().route(e.harnessSlug,{local:()=>L(e),remote:{kind:h.acquire,payload:e,decode:a=>a}})}async function L(e){const a=e.livenessMode??"availability",s=p(e.ttlSec??(a==="activity"?1800:1200)),{sql:t}=o(),n=await t`
    INSERT INTO harness_shared.plan_item_claims
      (workspace_id, harness_slug, plan_slug, item_id, owner, owner_label, owner_name,
       intent, liveness_mode, ttl_sec, acquired_ts, expires_ts, last_activity_ts)
    VALUES
      (${e.workspaceId}, ${e.harnessSlug}, ${e.planSlug}, ${e.itemId},
       ${e.owner}, ${e.ownerLabel??null}, ${e.ownerName??null},
       ${e.intent??""}, ${a}, ${s}, clock_timestamp(),
       clock_timestamp() + make_interval(secs => ${s}), clock_timestamp())
    ON CONFLICT (workspace_id, harness_slug, plan_slug, item_id) DO UPDATE SET
      claim_id         = gen_random_uuid(),
      owner            = EXCLUDED.owner,
      owner_label      = EXCLUDED.owner_label,
      owner_name       = EXCLUDED.owner_name,
      intent           = EXCLUDED.intent,
      liveness_mode    = EXCLUDED.liveness_mode,
      ttl_sec          = EXCLUDED.ttl_sec,
      acquired_ts      = clock_timestamp(),
      expires_ts       = clock_timestamp() + make_interval(secs => ${s}),
      last_activity_ts = clock_timestamp()
    WHERE harness_shared.plan_item_claims.owner = EXCLUDED.owner
       -- EI-8997: steal an EXPIRED claim only when its holder has been quiet past the
       -- activity grace. A lapsed-but-ACTIVE holder is busy, not dead (one long turn
       -- outlasting the TTL / the bg-host renewal consumer down) — the held-branch
       -- below auto-renews its lease instead of handing the item to a second agent.
       OR (harness_shared.plan_item_claims.expires_ts <= clock_timestamp()
           AND NOT EXISTS (
             SELECT 1 FROM harness_shared.agent_activity aa
              WHERE aa.owner_id = harness_shared.plan_item_claims.owner
                AND aa.created_at > clock_timestamp() - make_interval(secs => ${E})))
    RETURNING workspace_id, harness_slug, plan_slug, item_id, claim_id, owner,
           owner_label, owner_name, intent, liveness_mode, ttl_sec, acquired_ts, expires_ts,
           last_activity_ts, (expires_ts <= clock_timestamp()) AS expired
  `;if(n[0])return await w(e.owner),{ok:!0,claim:d(n[0])};const i=await t`
    SELECT workspace_id, harness_slug, plan_slug, item_id, claim_id, owner,
           owner_label, owner_name, intent, liveness_mode, ttl_sec, acquired_ts, expires_ts,
           last_activity_ts, (expires_ts <= clock_timestamp()) AS expired
      FROM harness_shared.plan_item_claims
     WHERE workspace_id = ${e.workspaceId} AND harness_slug = ${e.harnessSlug}
       AND plan_slug = ${e.planSlug} AND item_id = ${e.itemId}
      FOR UPDATE
  `;if(i[0]){const r=d(i[0]);if(r.expired){const m=await t`
        UPDATE harness_shared.plan_item_claims
           SET expires_ts = clock_timestamp() + make_interval(secs => ttl_sec)
         WHERE workspace_id = ${e.workspaceId} AND harness_slug = ${e.harnessSlug}
           AND plan_slug = ${e.planSlug} AND item_id = ${e.itemId}
           AND claim_id = ${r.claimId}::uuid AND owner = ${r.owner}
           AND expires_ts <= clock_timestamp()
           AND EXISTS (
             SELECT 1 FROM harness_shared.agent_activity aa
              WHERE aa.owner_id = ${r.owner}
                AND aa.created_at > clock_timestamp() - make_interval(secs => ${E}))
        RETURNING workspace_id, harness_slug, plan_slug, item_id, claim_id, owner,
               owner_label, owner_name, intent, liveness_mode, ttl_sec, acquired_ts, expires_ts,
               last_activity_ts, (expires_ts <= clock_timestamp()) AS expired
      `;if(m[0])return{ok:!1,conflict:d(m[0]),reason:"holder-active-lease-renewed"}}return{ok:!1,conflict:r}}const l=await t`
    INSERT INTO harness_shared.plan_item_claims
      (workspace_id, harness_slug, plan_slug, item_id, owner, owner_label, owner_name,
       intent, liveness_mode, ttl_sec, acquired_ts, expires_ts, last_activity_ts)
    VALUES
      (${e.workspaceId}, ${e.harnessSlug}, ${e.planSlug}, ${e.itemId},
       ${e.owner}, ${e.ownerLabel??null}, ${e.ownerName??null},
       ${e.intent??""}, ${a}, ${s}, clock_timestamp(),
       clock_timestamp() + make_interval(secs => ${s}), clock_timestamp())
    ON CONFLICT (workspace_id, harness_slug, plan_slug, item_id) DO NOTHING
    RETURNING workspace_id, harness_slug, plan_slug, item_id, claim_id, owner,
           owner_label, owner_name, intent, liveness_mode, ttl_sec, acquired_ts, expires_ts,
           last_activity_ts, (expires_ts <= clock_timestamp()) AS expired
  `;if(l[0])return await w(e.owner),{ok:!0,claim:d(l[0])};const _=await v(e.workspaceId,e.harnessSlug,e.planSlug,e.itemId);return _?{ok:!1,conflict:_}:{ok:!1,conflict:U(e)}}async function V(e,a,s,t,n,i,l="activity",_){const r={workspaceId:e,harnessSlug:a,planSlug:s,itemId:t,claimId:n,owner:i,kind:l,ttlSecOverride:_};return A().route(a,{local:()=>b(r),remote:{kind:h.heartbeat,payload:r,decode:m=>m}})}async function b(e){const{workspaceId:a,harnessSlug:s,planSlug:t,itemId:n,claimId:i,owner:l,ttlSecOverride:_}=e,r=e.kind??"activity",m=r==="activity"||r==="extend",{sql:k}=o(),N=await k`
    UPDATE harness_shared.plan_item_claims
       SET ttl_sec = ${_!=null?p(_):k`ttl_sec`},
           expires_ts = clock_timestamp() + make_interval(secs => ${_!=null?p(_):k`ttl_sec`}),
           last_activity_ts = CASE WHEN ${m} THEN clock_timestamp() ELSE last_activity_ts END
     WHERE workspace_id = ${a} AND harness_slug = ${s}
       AND plan_slug = ${t} AND item_id = ${n}
       AND claim_id = ${i}::uuid AND owner = ${l}
       AND expires_ts > clock_timestamp()
       AND (liveness_mode = 'availability' OR ${m})
    RETURNING expires_ts
  `;if(N[0])return{renewed:!0,held:!0,expiresTs:N[0].expires_ts};const c=await v(a,s,t,n);if(c&&c.claimId===i&&c.owner===l&&!c.expired)return{renewed:!1,held:!0,expiresTs:c.expiresTs,reason:"activity-mode claim not renewed by a keepalive — send an activity/extend heartbeat"};const y=c!=null&&c.claimId===i&&c.owner===l&&c.expired;return{renewed:!1,held:!1,expiresTs:null,reason:c&&!y?"claim is held by another owner or under a new claim_id":"claim has lapsed or was released — re-acquire it"}}async function Y(e,a,s,t,n,i){const l={workspaceId:e,harnessSlug:a,planSlug:s,itemId:t,claimId:n,owner:i};return A().route(a,{local:()=>O(l),remote:{kind:h.release,payload:l,decode:_=>_}})}async function O(e){const{workspaceId:a,harnessSlug:s,planSlug:t,itemId:n,claimId:i,owner:l}=e,{sql:_}=o(),r=await _`
    DELETE FROM harness_shared.plan_item_claims
     WHERE workspace_id = ${a} AND harness_slug = ${s}
       AND plan_slug = ${t} AND item_id = ${n}
       AND claim_id = ${i}::uuid AND owner = ${l}
    RETURNING item_id
  `;return r.length>0&&await w(l),r.length>0}async function B(e,a){const{sql:s}=o(),t=await s`
    DELETE FROM harness_shared.plan_item_claims
     WHERE workspace_id = ${e} AND owner = ${a}
    RETURNING item_id
  `;return t.length>0&&await w(a),t.length}async function K(e,a){const{sql:s}=o();return(await s`
    UPDATE harness_shared.plan_item_claims
       SET expires_ts = clock_timestamp() + make_interval(secs => ttl_sec),
           last_activity_ts = clock_timestamp()
     WHERE (workspace_id = ${e} OR workspace_id = ${$})
       AND owner = ${a}
       -- BOTH liveness modes renew here (EI-295 residual): no explicit
       -- availability-heartbeat path exists yet, so the per-turn renewal is
       -- the ONLY thing keeping a turn-active owner's availability lane from
       -- lapsing mid-session (activity-claim-renewal.integration.test.ts).
       AND expires_ts > clock_timestamp()
    RETURNING item_id
  `).map(t=>t.item_id)}async function j(e,a,s){const t=p(s),{sql:n}=o();return(await n`
    UPDATE harness_shared.plan_item_claims
       SET expires_ts = GREATEST(expires_ts, clock_timestamp() + make_interval(secs => ${t}))
     WHERE (workspace_id = ${e} OR workspace_id = ${$})
       AND owner = ${a}
       AND expires_ts > clock_timestamp()
    RETURNING item_id
  `).map(i=>i.item_id)}async function v(e,a,s,t){const{sql:n}=o(),i=await n`
    SELECT workspace_id, harness_slug, plan_slug, item_id, claim_id, owner,
             owner_label, owner_name, intent, liveness_mode, ttl_sec, acquired_ts, expires_ts,
             last_activity_ts, (expires_ts <= clock_timestamp()) AS expired FROM harness_shared.plan_item_claims
     WHERE workspace_id = ${e} AND harness_slug = ${a}
       AND plan_slug = ${s} AND item_id = ${t}
  `;return i[0]?d(i[0]):null}async function z(e,a,s){const{sql:t}=o();return(await t`
    SELECT workspace_id, harness_slug, plan_slug, item_id, claim_id, owner,
             owner_label, owner_name, intent, liveness_mode, ttl_sec, acquired_ts, expires_ts,
             last_activity_ts, (expires_ts <= clock_timestamp()) AS expired FROM harness_shared.plan_item_claims
     WHERE workspace_id = ${e} AND harness_slug = ${a} AND plan_slug = ${s}
     ORDER BY item_id
  `).map(d)}async function J(e,a){const{sql:s}=o();return(await s`
    DELETE FROM harness_shared.plan_item_claims
     WHERE workspace_id = ${e}
       AND ${a?s`harness_slug = ${a}`:s`TRUE`}
       AND expires_ts <= clock_timestamp()
       AND NOT EXISTS (
         SELECT 1 FROM harness_shared.agent_activity aa
          WHERE aa.owner_id = harness_shared.plan_item_claims.owner
            AND aa.created_at > clock_timestamp() - make_interval(secs => ${E}))
    RETURNING item_id
  `).length}function p(e){return!Number.isFinite(e)||e<=0?S:Math.min(Math.floor(e),I)}function d(e){return{workspaceId:e.workspace_id,harnessSlug:e.harness_slug,planSlug:e.plan_slug,itemId:e.item_id,claimId:e.claim_id,owner:e.owner,ownerLabel:e.owner_label,ownerName:e.owner_name,intent:e.intent,livenessMode:e.liveness_mode??"availability",ttlSec:Number(e.ttl_sec),acquiredTs:e.acquired_ts,expiresTs:e.expires_ts,lastActivityTs:e.last_activity_ts,expired:!!e.expired}}function U(e){const a=new Date().toISOString();return{workspaceId:e.workspaceId,harnessSlug:e.harnessSlug,planSlug:e.planSlug,itemId:e.itemId,claimId:"00000000-0000-0000-0000-000000000000",owner:"unknown",ownerLabel:null,ownerName:null,intent:"",livenessMode:"availability",ttlSec:0,acquiredTs:a,expiresTs:a,lastActivityTs:a,expired:!0}}var S,q,I,u,E,h,Q=D((()=>{R(),f(),C(),x(),S=1200,q=1800,I=7200,u=Number({}.PAPERCUSP_CLAIM_LAPSE_ACTIVITY_GRACE_SEC??600),E=Number.isFinite(u)&&u>=0?Math.min(Math.floor(u),3600):600,h={acquire:"plan-item.claim.acquire",heartbeat:"plan-item.claim.heartbeat",release:"plan-item.claim.release"}}));export{K as _,h as a,G as b,j as c,b as d,Q as f,O as g,Y as h,I as i,v as l,B as m,q as n,X as o,z as p,S as r,L as s,E as t,V as u,J as v,C as y};
