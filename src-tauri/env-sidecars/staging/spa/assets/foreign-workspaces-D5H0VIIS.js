import{n as c,o as p}from"./chunk-ChpBd9eV.js";import{st as o,t as u}from"./src-8fWtxfEz.js";import{t as f}from"./__vite-browser-external-56mrcCg8.js";function _(e){if(e==null)return 0;if(e instanceof Date)return e.getTime();if(typeof e=="number")return e;const t=Date.parse(e);return Number.isNaN(t)?0:t}function n(e){return{workspaceId:e.workspace_id,offerId:e.offer_id,fleetSlug:e.fleet_slug,originGithubUserId:Number(e.origin_github_user_id),executorDevice:e.executor_device,rootPath:e.root_path,clonePath:e.clone_path,sessionId:e.session_id,executionEpoch:Number(e.execution_epoch),state:e.state,parkReason:e.park_reason,baseSha:e.base_sha??null,createdAt:_(e.created_at),updatedAt:_(e.updated_at)}}async function w(e,t={},a=o().sql){return(t.state?await a`
        SELECT * FROM harness_shared.p2p_foreign_workspaces
        WHERE workspace_id = ${e} AND state = ${t.state}
        ORDER BY created_at`:await a`
        SELECT * FROM harness_shared.p2p_foreign_workspaces
        WHERE workspace_id = ${e}
        ORDER BY created_at`).map(n)}async function m(e,t=o().sql){const a=await t`
    SELECT * FROM harness_shared.p2p_foreign_workspaces
    WHERE offer_id = ${e}
    LIMIT 1
  `;return a.length?n(a[0]):null}async function R(e,t,a,r={},s=o().sql){const i=await s`
    UPDATE harness_shared.p2p_foreign_workspaces
    SET state = ${a},
        park_reason = ${r.parkReason??null},
        updated_at = now()
    WHERE workspace_id = ${e} AND offer_id = ${t}
      AND ${r.fromStates?s`state = ANY(${r.fromStates}::text[])`:s`TRUE`}
    RETURNING *
  `;return i.length?n(i[0]):null}var d,k=c((()=>{u(),d=p(f(),1)}));export{R as i,k as n,w as r,m as t};
