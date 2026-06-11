import"./chunk-CMxvf4Kt.js";import"./src-DAkS6_jU.js";import{t as e}from"./__vite-browser-external-C3Gx4706.js";import{o as t}from"./operator-state-pg-BeLPSsRB.js";import{a as n,i as r,n as i,r as a,s as o,t as s}from"./capabilities-BMQakP_V.js";import"./harness-core-rwVmqbOn.js";var c=new Map;function l(e,t){c.set(e,t)}function u(e){return typeof e==`string`?e:e==null?``:String(e)}l(`harness_features_consolidated`,{kind:`feature`,ref:e=>e,summary:(e,t,n)=>e===`del`?`feature ${n} removed`:`feature ${n}${t?.status?` → ${u(t.status)}`:``}${t?.title?`: ${u(t.title)}`:``}`,notifyKind:{put:`feature_updated`,del:`feature_removed`},isResolution:{op:{notEquals:`del`},"row.status":{in:[`passed`,`deprecated`]}}}),l(`harness_issues_consolidated`,{kind:`issue`,ref:e=>e,summary:(e,t,n)=>e===`del`?`issue ${n} removed`:`issue ${n}${t?.status?` → ${u(t.status)}`:``}${t?.title?`: ${u(t.title)}`:``}`,notifyKind:{put:`issue_updated`,del:`issue_removed`},isResolution:{op:{notEquals:`del`},"row.status":{in:[`resolved`,`closed`]}}}),l(`harness_plans`,{kind:`plan`,ref:e=>e,summary:(e,t,n)=>e===`del`?`plan ${n} removed`:`plan ${n}${t?.status?` → ${u(t.status)}`:``}${t?.title?`: ${u(t.title)}`:``}`,notifyKind:{put:`plan_updated`,del:`plan_removed`},isResolution:{op:{notEquals:`del`},"row.status":{equals:`shipped`}}});var d={getSql:()=>t().sql,ensureSchema:async()=>{},workspaceId:o};new s(d),new a(d),new n(d),e();var f={getSql:()=>t().sql,ensureSchema:async()=>{},workspaceId:o};new a(f),new r(f),new s(f),new i(f);var p=[`feature`,`research-task`,`chunk`],m=[`bug`,`change`,`task`];[...p,...m];var h={getSql:()=>t().sql,ensureSchema:async()=>{},workspaceId:o};new a(h),new r(h),new s(h),new i(h);var g=`operator`;function _(e){return e==null?``:e instanceof Date?e.toISOString():String(e)}function v(e,t=[]){return{id:e.id,agentSessionId:e.agent_session_id??``,title:e.title,summary:e.summary,status:e.state===`open`?`open`:`archived`,createdAt:_(e.created_at),lastActiveAt:_(e.last_active_at),turnCount:Number(e.turn_count??0),origin:e.origin,transcript:t}}var y=`
  SELECT e.issue_id AS id,
         e.payload ->> 'agentSessionId' AS agent_session_id,
         e.title,
         e.body AS summary,
         e.state,
         e.payload ->> 'origin' AS origin,
         e.created_at,
         COALESCE(t.last_post_at, e.updated_at) AS last_active_at,
         COALESCE(t.post_count, 0) AS turn_count
    FROM harness_shared.engineer_issues e
    LEFT JOIN harness_shared.coord_threads t
      ON t.workspace_id = e.workspace_id AND t.parent_kind = 'issue' AND t.parent_ref = e.issue_id`;async function b(e={}){let{sql:n}=t(),r=e.status??`open`,i=Math.min(Math.max(1,e.limit??20),50),a=r===`open`?n`e.state = 'open'`:r===`archived`?n`e.state <> 'open'`:n`TRUE`;return(await n`
    ${n.unsafe(y)}
     WHERE e.workspace_id = ${o}
       AND e.kind = 'task'
       AND e.assigned_by = ${g}
       AND ${a}
     ORDER BY last_active_at DESC NULLS LAST
     LIMIT ${i}`).map(e=>v(e))}async function x(e,n=10){let{sql:r}=t(),i=`%${e.replace(/[%_]/g,e=>`\\`+e)}%`;return(await r`
    ${r.unsafe(y)}
     WHERE e.workspace_id = ${o}
       AND e.kind = 'task'
       AND e.assigned_by = ${g}
       AND (COALESCE(e.title, '') ILIKE ${i} OR COALESCE(e.body, '') ILIKE ${i})
     ORDER BY last_active_at DESC NULLS LAST
     LIMIT ${Math.min(Math.max(1,n),50)}`).map(e=>v(e))}var S=/^\*\*Request:\*\*\s([\s\S]*?)\n\n\*\*Response:\*\*\s([\s\S]*)$/;async function C(e){let{sql:n}=t(),r=await n`
    ${n.unsafe(y)}
     WHERE e.workspace_id = ${o}
       AND e.kind = 'task'
       AND (e.issue_id = ${e} OR e.payload ->> 'agentSessionId' = ${e})
     ORDER BY e.created_at DESC
     LIMIT 1`;if(!r[0])return null;let i=(await n`
    SELECT body, created_at FROM harness_shared.coord_thread_posts
     WHERE workspace_id = ${o} AND thread_id = ${`issue-thread-${r[0].id}`}
     ORDER BY created_at ASC`).map(e=>{let t=S.exec(e.body??``);return{ts:_(e.created_at),request:t?.[1]??``,response:t?.[2]??e.body??``}});return v(r[0],i)}export{C as getDelegatedSession,b as listDelegatedSessions,x as searchDelegatedSessions};