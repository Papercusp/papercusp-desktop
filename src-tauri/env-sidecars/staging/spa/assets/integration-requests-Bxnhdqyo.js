import{n}from"./chunk-ChpBd9eV.js";import{st as o,t as h}from"./src-BmBNODK0.js";import{a as p,r as y}from"./comms-trust-rTe4Xdmp.js";import{a as _,c as k}from"./storage-C-BVGA6Q.js";async function l(e,r){const t=r??o().sql,a=e.nowMs??Date.now(),s=Math.max(1,e.cap??u);await t`
    INSERT INTO harness_shared.pot_integration_requests
      (workspace_id, pot_slug, repo_key, device_pubkey, head_sha,
       author_github_user_id, reason, state, created_ts)
    VALUES
      (${e.workspaceId}, ${e.potSlug}, ${e.repoKey}, ${e.devicePubkey},
       ${e.headSha}, ${e.authorGithubUserId??null},
       ${e.reason??"below-steer-tier"}, 'pending', ${a})
    ON CONFLICT (workspace_id, pot_slug, repo_key, device_pubkey, head_sha) DO NOTHING
  `,await t`
    DELETE FROM harness_shared.pot_integration_requests d
    USING (
      SELECT workspace_id, pot_slug, repo_key, device_pubkey, head_sha
      FROM harness_shared.pot_integration_requests
      WHERE workspace_id = ${e.workspaceId}
        AND pot_slug = ${e.potSlug}
        AND repo_key = ${e.repoKey}
        AND device_pubkey = ${e.devicePubkey}
      ORDER BY (state = 'ratified') DESC, created_ts DESC, head_sha
      OFFSET ${s}
    ) evict
    WHERE d.workspace_id = evict.workspace_id
      AND d.pot_slug = evict.pot_slug
      AND d.repo_key = evict.repo_key
      AND d.device_pubkey = evict.device_pubkey
      AND d.head_sha = evict.head_sha
  `}async function $(e,r){const t=r??o().sql,a=Math.min(Math.max(e.limit??100,1),500);return(await t`
    SELECT workspace_id, pot_slug, repo_key, device_pubkey, head_sha,
           author_github_user_id, reason, state, created_ts, ratified_ts
    FROM harness_shared.pot_integration_requests
    WHERE workspace_id = ${e.workspaceId}
      ${e.potSlug!==void 0?t`AND pot_slug = ${e.potSlug}`:t``}
      ${e.repoKey!==void 0?t`AND repo_key = ${e.repoKey}`:t``}
      ${e.devicePubkey!==void 0?t`AND device_pubkey = ${e.devicePubkey}`:t``}
      ${e.state!==void 0?t`AND state = ${e.state}`:t``}
    ORDER BY created_ts DESC, head_sha
    LIMIT ${a}
  `).map(s=>({workspaceId:s.workspace_id,potSlug:s.pot_slug,repoKey:s.repo_key,devicePubkey:s.device_pubkey,headSha:s.head_sha,authorGithubUserId:s.author_github_user_id==null?null:Number(s.author_github_user_id),reason:s.reason,state:s.state,createdTs:Number(s.created_ts),ratifiedTs:s.ratified_ts==null?null:Number(s.ratified_ts)}))}async function A(e,r){return(await(r??o().sql)`
    UPDATE harness_shared.pot_integration_requests
    SET state = 'ratified', ratified_ts = COALESCE(ratified_ts, ${e.nowMs??Date.now()})
    WHERE workspace_id = ${e.workspaceId}
      AND pot_slug = ${e.potSlug}
      AND repo_key = ${e.repoKey}
      AND device_pubkey = ${e.devicePubkey}
      AND head_sha = ${e.headSha}
    RETURNING head_sha
  `).length>0}async function g(e,r,t){if(r.length===0)return new Set;const a=t??o().sql,s=r.map(i=>i.devicePubkey),d=r.map(i=>i.headSha),c=await a`
    SELECT device_pubkey, head_sha
    FROM harness_shared.pot_integration_requests
    WHERE workspace_id = ${e.workspaceId}
      AND pot_slug = ${e.potSlug}
      AND repo_key = ${e.repoKey}
      AND state = 'ratified'
      AND (device_pubkey, head_sha) IN (
        SELECT * FROM UNNEST(${a.array(s)}::text[], ${a.array(d)}::text[])
      )
  `;return new Set(c.map(i=>`${i.device_pubkey}
${i.head_sha}`))}async function I(e){const r={integrate:[],queued:[],errors:[]};let t;try{t=await g({workspaceId:e.workspaceId,potSlug:e.potSlug,repoKey:e.repoKey},e.heads.filter(a=>a.sha).map(a=>({devicePubkey:a.devicePubkeyBase64,headSha:a.sha})),e.sql)}catch(a){t=new Set,r.errors.push({devicePubkeyBase64:"*",sha:"*",error:`ratified-set read failed: ${a instanceof Error?a.message:String(a)}`})}for(const a of e.heads)if(a.sha)try{const s=await e.resolveTier(a.devicePubkeyBase64);if(s&&y(s,"steer")){r.integrate.push({deviceHex:_(a.devicePubkeyBase64),sha:a.sha});continue}if(t.has(`${a.devicePubkeyBase64}
${a.sha}`)){r.integrate.push({deviceHex:_(a.devicePubkeyBase64),sha:a.sha});continue}const d=e.resolveAuthorGithubUserId?await e.resolveAuthorGithubUserId(a.devicePubkeyBase64):null;await l({workspaceId:e.workspaceId,potSlug:e.potSlug,repoKey:e.repoKey,devicePubkey:a.devicePubkeyBase64,headSha:a.sha,authorGithubUserId:d,nowMs:e.nowMs,cap:e.cap},e.sql),r.queued.push(a)}catch(s){r.errors.push({devicePubkeyBase64:a.devicePubkeyBase64,sha:a.sha,error:s instanceof Error?s.message:String(s)})}return r}var u,v,f=n((()=>{h(),p(),k(),u=Number({}.PAPERCUSP_INTEGRATION_REQUESTS_PER_AUTHOR_CAP)||50,v="steer"}));export{$ as a,A as c,f as i,u as n,g as o,I as r,l as s,v as t};
