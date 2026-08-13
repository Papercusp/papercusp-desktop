import{n as u}from"./chunk-ChpBd9eV.js";import{st as o,t as d}from"./src-BmBNODK0.js";async function h(e,r){const a=r??o().sql,_=e.nowMs??Date.now();await a`
    INSERT INTO harness_shared.coord_quarantine
      (workspace_id, msg_id, harness_slug, surface, body, author_github_user_id,
       author_device_pubkey, reason, msg_ts, created_ts)
    VALUES
      (${e.workspaceId}, ${e.msgId}, ${e.harnessSlug}, ${e.surface},
       ${JSON.stringify(e.body)}::text::jsonb, ${e.authorGithubUserId},
       ${e.authorDevicePubkey}, ${e.reason}, ${e.msgTs}, ${_})
    ON CONFLICT (workspace_id, msg_id) DO NOTHING
  `,await a`
    DELETE FROM harness_shared.coord_quarantine
    WHERE workspace_id = ${e.workspaceId}
      AND author_device_pubkey = ${e.authorDevicePubkey}
      AND msg_id IN (
        SELECT msg_id FROM harness_shared.coord_quarantine
        WHERE workspace_id = ${e.workspaceId}
          AND author_device_pubkey = ${e.authorDevicePubkey}
        ORDER BY created_ts DESC, msg_id
        OFFSET ${t}
      )
  `}async function E(e,r){const a=r??o().sql,_=Math.min(Math.max(e.limit??100,1),500);return(await a`
    SELECT msg_id, harness_slug, surface, body, author_github_user_id,
           author_device_pubkey, reason, msg_ts, created_ts
    FROM harness_shared.coord_quarantine
    WHERE workspace_id = ${e.workspaceId}
      ${e.authorGithubUserId!=null?a`AND author_github_user_id = ${e.authorGithubUserId}`:a``}
    ORDER BY created_ts DESC
    LIMIT ${_}
  `).map(s=>({msgId:s.msg_id,harnessSlug:s.harness_slug,surface:s.surface,body:s.body,authorGithubUserId:s.author_github_user_id==null?null:Number(s.author_github_user_id),authorDevicePubkey:s.author_device_pubkey,reason:s.reason,msgTs:Number(s.msg_ts),createdTs:Number(s.created_ts)}))}async function b(e,r){return{cleared:(await(r??o().sql)`
    DELETE FROM harness_shared.coord_quarantine
    WHERE workspace_id = ${e.workspaceId}
      AND author_github_user_id = ${e.authorGithubUserId}
  `).count??0}}var t,g=u((()=>{d(),t=Number({}.PAPERCUSP_COORD_QUARANTINE_PER_AUTHOR_CAP)||200}));export{h as a,E as i,b as n,g as r,t};
