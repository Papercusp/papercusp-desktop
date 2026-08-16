const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/hive-policy-store-DSyaE4ZX.js","assets/hive-policy-store-DwT3R2HY.js","assets/chunk-ChpBd9eV.js","assets/src-8fWtxfEz.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/src-6Py4l2MU.js","assets/drizzle-orm-BbO4Lkx2.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js"])))=>i.map(i=>d[i]);
import{n as E}from"./chunk-ChpBd9eV.js";import{n as h,t as w}from"./preload-helper-CcgcQsTF.js";import{st as o,t as T}from"./src-8fWtxfEz.js";function u(t){return typeof t=="string"&&m.includes(t)}function x(t,e){return n[t]>=n[e]}function f(t){return typeof t=="string"?Number(t):t}function d(t,e){if(!Number.isInteger(t)||t<=0)throw new Error(`${e} — githubUserId must be a positive integer (got ${t})`)}function _(t){return{githubUserId:f(t.trusted_github_user_id),tier:u(t.tier)?t.tier:null,gate:t.gate===!0,note:t.note,expiresAtMs:t.expires_at==null?null:new Date(t.expires_at).getTime(),createdTs:Number(t.created_ts),updatedTs:Number(t.updated_ts)}}async function M(t,e){return t?(await(e??o().sql)`
    SELECT trusted_github_user_id, tier, gate, note, expires_at, created_ts, updated_ts
      FROM harness_shared.comms_trust_list
     WHERE workspace_id = ${t}
     ORDER BY updated_ts DESC, trusted_github_user_id ASC`).map(_):[]}async function A(t,e,a){if(!t)throw new Error("comms-trust set — no workspace");if(d(e.githubUserId,"comms-trust set"),!u(e.tier))throw new Error(`comms-trust set — invalid tier ${String(e.tier)}`);const r=a??o().sql,s=e.expiresAtMs==null?null:new Date(e.expiresAtMs),[i]=await r`
    INSERT INTO harness_shared.comms_trust_list
      (workspace_id, trusted_github_user_id, tier, note, expires_at, created_ts, updated_ts)
    VALUES (${t}, ${e.githubUserId}, ${e.tier}, ${e.note??null},
            ${s}, ${e.nowMs}, ${e.nowMs})
    ON CONFLICT (workspace_id, trusted_github_user_id) DO UPDATE SET
      tier = EXCLUDED.tier,
      note = EXCLUDED.note,
      expires_at = EXCLUDED.expires_at,
      updated_ts = EXCLUDED.updated_ts
    RETURNING trusted_github_user_id, tier, gate, note, expires_at, created_ts, updated_ts`;return await c(r,e.actor,"trust:comms-set",String(e.githubUserId),t,{tier:e.tier,...e.expiresAtMs?{expiresAtMs:e.expiresAtMs}:{}}),_(i)}async function N(t,e,a,r){if(!t)throw new Error("comms-trust remove — no workspace");d(e,"comms-trust remove");const s=r??o().sql,i=(await s`
    DELETE FROM harness_shared.comms_trust_list
     WHERE workspace_id = ${t} AND trusted_github_user_id = ${e}
    RETURNING trusted_github_user_id`).length>0;return i&&await c(s,a,"trust:comms-remove",String(e),t,{}),{removed:i}}async function C(t,e,a){if(!t)throw new Error("gate-trust set — no workspace");d(e.githubUserId,"gate-trust set");const r=a??o().sql,s=e.expiresAtMs==null?null:new Date(e.expiresAtMs),[i]=await r`
    INSERT INTO harness_shared.comms_trust_list
      (workspace_id, trusted_github_user_id, tier, gate, note, expires_at, created_ts, updated_ts)
    VALUES (${t}, ${e.githubUserId}, NULL, ${e.granted},
            ${e.note??null}, ${s}, ${e.nowMs}, ${e.nowMs})
    ON CONFLICT (workspace_id, trusted_github_user_id) DO UPDATE SET
      gate = EXCLUDED.gate,
      expires_at = EXCLUDED.expires_at,
      updated_ts = EXCLUDED.updated_ts
    RETURNING trusted_github_user_id, tier, gate, note, expires_at, created_ts, updated_ts`;return await c(r,e.actor,e.granted?"trust:gate-grant":"trust:gate-revoke",String(e.githubUserId),t,e.expiresAtMs?{expiresAtMs:e.expiresAtMs}:{}),_(i)}async function U(t,e=g,a){const r=t.nowMs??Date.now();try{const s=await(a??o().sql)`
      SELECT trusted_github_user_id, tier, gate, note, expires_at, created_ts, updated_ts
        FROM harness_shared.comms_trust_list
       WHERE workspace_id = ${t.workspaceId}
         AND trusted_github_user_id = ${t.githubUserId}
       LIMIT 1`;if(s.length>0){const i=_(s[0]);if(i.tier!==null&&(i.expiresAtMs==null||i.expiresAtMs>r))return{tier:i.tier,source:"override"}}}catch{}try{const s=await e.loadPolicyDefaultTier(t.workspaceId,t.potHomeSlug);if(u(s))return{tier:s,source:"policy"}}catch{}return{tier:l,source:"fallback"}}async function c(t,e,a,r,s,i){try{await t`
      INSERT INTO harness_shared.audit_log (id, ts, actor, action, subject, details, workspace_id)
      VALUES (${`ctrust-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`}, ${Date.now()}, ${e}, ${a}, ${r},
              ${JSON.stringify(i)}::text::jsonb, ${s})`}catch{}}var m,n,l,g,y=E((()=>{T(),h(),m=["observe","message","wake","steer"],n={observe:0,message:1,wake:2,steer:3},l="message",g={loadPolicyDefaultTier:async(t,e)=>{const{getHivePolicy:a}=await w(async()=>{const{getHivePolicy:r}=await import("./hive-policy-store-DSyaE4ZX.js");return{getHivePolicy:r}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11]));return(await a(t,e))?.policy?.comms?.defaultTier}}}));export{y as a,N as c,U as i,A as l,l as n,u as o,x as r,M as s,m as t,C as u};
