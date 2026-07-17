import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CwW4br4q.js";import{s as r,u as i}from"./workspace-registry-Bu1Yy540.js";import{f as a,m as o,o as s,u as c}from"./carry-note-BRtmQiik.js";function l(e){return e&&e!==h?e:h}async function u(e,n){try{let{sql:r}=t();e.harness&&e.harness!==h&&await r`
        UPDATE harness_shared.work_items
           SET last_progress_at = now()
         WHERE workspace_id = ${n} AND harness_slug = ${e.harness} AND feature_id = ${e.workItemId}`,await r`
      UPDATE harness_shared.engineer_issues
         SET assigned_at = now(), updated_at = now()
       WHERE workspace_id = ${n}
         AND issue_id = ${e.workItemId}
         AND assignee IS NOT NULL
         AND assignee <> ''
         AND state = 'open'`}catch{}}async function d(e,t){return(await f(e,t)).stored}async function f(e,t){let n=i(e.workspaceId);if(!n||!e.workItemId)throw Error(`setWorkItemCheckpoint — workspaceId and workItemId are required`);let{stored:r,priorLength:s}=await a({scope:o(l(e.harness),e.workItemId),workspaceId:n},t,{journal:!1});return r!==null&&await u(e,n),{stored:r,priorLength:s}}async function p(e){let t=i(e.workspaceId);return!t||!e.workItemId?null:s({scope:o(l(e.harness),e.workItemId),workspaceId:t})}async function m(e){let n=i(e.workspaceId);if(!n||!e.workItemId)return{checkpoint:null,updatedAtMs:null};let r=o(l(e.harness),e.workItemId);try{let{sql:e}=t(),i=await e`
      SELECT note, updated_ts FROM harness_shared.carry_notes
       WHERE workspace_id = ${n} AND scope = ${r} LIMIT 1`,a=(i[0]?.note??``).trim();if(a.length===0)return{checkpoint:null,updatedAtMs:null};let o=i[0]?.updated_ts==null?NaN:Number(i[0].updated_ts);return{checkpoint:a,updatedAtMs:Number.isFinite(o)?o:null}}catch{return{checkpoint:null,updatedAtMs:null}}}var h,g=e((()=>{n(),r(),c(),h=`*`}));export{f as a,d as i,m as n,g as r,p as t};