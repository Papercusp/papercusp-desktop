import{n as c}from"./chunk-ChpBd9eV.js";import{st as u,t as g}from"./src-BmBNODK0.js";function n(t){return typeof t=="string"?Number(t):t}function o(t,r){if(!Number.isInteger(t)||t<=0)throw new Error(`${r} — githubUserId must be a positive integer (got ${t})`)}async function w(t){if(!t)return[];const{sql:r}=u();return(await r`
    SELECT trusted_github_user_id, note, created_ts
      FROM harness_shared.user_trust_list
     WHERE workspace_id = ${t}
     ORDER BY created_ts DESC, trusted_github_user_id ASC`).map(e=>({githubUserId:n(e.trusted_github_user_id),note:e.note,createdTs:Number(e.created_ts)}))}async function $(t,r){if(!t)throw new Error("trust:add — no workspace");o(r.githubUserId,"trust:add");const{sql:e}=u(),i=r.note??null,[s]=await e`
    INSERT INTO harness_shared.user_trust_list (workspace_id, trusted_github_user_id, note, created_ts)
    VALUES (${t}, ${r.githubUserId}, ${i}, ${r.nowMs})
    ON CONFLICT (workspace_id, trusted_github_user_id) DO UPDATE SET note = EXCLUDED.note
    RETURNING trusted_github_user_id, note, created_ts`;return await a(e,r.actor,"trust:add",String(r.githubUserId),t,{note:i}),{githubUserId:n(s.trusted_github_user_id),note:s.note,createdTs:Number(s.created_ts)}}async function T(t,r,e){if(!t)throw new Error("trust:remove — no workspace");o(r,"trust:remove");const{sql:i}=u(),s=(await i`
    DELETE FROM harness_shared.user_trust_list
     WHERE workspace_id = ${t} AND trusted_github_user_id = ${r}
    RETURNING trusted_github_user_id`).length>0;return s&&await a(i,e,"trust:remove",String(r),t,{}),{removed:s}}async function a(t,r,e,i,s,_){try{await t`
      INSERT INTO harness_shared.audit_log (id, ts, actor, action, subject, details, workspace_id)
      VALUES (${`trust-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`}, ${Date.now()}, ${r}, ${e}, ${i},
              ${JSON.stringify(_)}::text::jsonb, ${s})`}catch(d){console.warn("[trust] audit write failed:",d?.message)}}var h=c((()=>{g()}));h();export{$ as addTrustedUser,w as listTrustedUsers,T as removeTrustedUser};
