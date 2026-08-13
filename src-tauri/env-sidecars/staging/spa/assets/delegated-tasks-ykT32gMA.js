import{n as S}from"./chunk-ChpBd9eV.js";import{st as _,t as g}from"./src-BmBNODK0.js";import{r as A,t as r}from"./coordination-event-log-browser-s_EyGDm7.js";import{B as D,C as y,G as R,Mt as l,O as k}from"./work-items-B3XMqSf_.js";import{T as f,b as I}from"./issues-engineer-DdQR2cKv.js";import{n as O,t as $}from"./pg-timestamp-Bl0ZIv9y.js";async function M(e){const t={agentSessionId:e.agentSessionId,origin:e.origin,backend:e.backend};return k({kind:p,title:e.title,summary:e.summary,harness:e.harness,createdBy:i,assignedBy:i,assignee:`delegate:${e.agentSessionId}`,payload:t})}async function W(e){const t=await I(e);return t?D(t.id):null}function m(e){return`delegate:${e}`}async function B(e,t,s){await y(e,`**Request:** ${s.request}

**Response:** ${s.response}`,m(t)).catch(()=>{})}async function q(e,t){await l(e,"resolved",{by:m(t),completionRef:`Delegated task resolved by session ${t}`}).catch(()=>{})}function u(e,t=[]){return{id:e.id,agentSessionId:e.agent_session_id??"",title:e.title,summary:e.summary,status:e.state==="open"?"open":"archived",createdAt:d(e.created_at),lastActiveAt:d(e.last_active_at),turnCount:Number(e.turn_count??0),origin:e.origin,transcript:t}}async function K(e={}){const{sql:t}=_(),s=e.status??"open",n=Math.min(Math.max(1,e.limit??20),50),a=s==="open"?t`e.state = 'open'`:s==="archived"?t`e.state <> 'open'`:t`TRUE`;return(await t`
    ${t.unsafe(c)}
     WHERE e.workspace_id = ${r}
       AND e.kind = 'task'
       AND e.assigned_by = ${i}
       AND ${a}
     ORDER BY last_active_at DESC NULLS LAST
     LIMIT ${n}`).map(o=>u(o))}async function U(e,t=10){const{sql:s}=_(),n=`%${e.replace(/[%_]/g,a=>"\\"+a)}%`;return(await s`
    ${s.unsafe(c)}
     WHERE e.workspace_id = ${r}
       AND e.kind = 'task'
       AND e.assigned_by = ${i}
       AND (COALESCE(e.title, '') ILIKE ${n} OR COALESCE(e.body, '') ILIKE ${n})
     ORDER BY last_active_at DESC NULLS LAST
     LIMIT ${Math.min(Math.max(1,t),50)}`).map(a=>u(a))}async function h(e){const{sql:t}=_(),s=await t`
    ${t.unsafe(c)}
     WHERE e.workspace_id = ${r}
       AND e.kind = 'task'
       AND (e.issue_id = ${e} OR e.payload ->> 'agentSessionId' = ${e})
     ORDER BY e.created_at DESC
     LIMIT 1`;if(!s[0])return null;const n=(await t`
    SELECT body, created_at FROM harness_shared.coord_thread_posts
     WHERE workspace_id = ${r} AND thread_id = ${`issue-thread-${s[0].id}`}
     ORDER BY created_at ASC`).map(a=>{const o=E.exec(a.body??"");return{ts:d(a.created_at),request:o?.[1]??"",response:o?.[2]??a.body??""}});return u(s[0],n)}async function x(e){const t=await h(e);t&&await l(t.id,"closed",{by:i,completionRef:`Delegated session ${t.id} archived by operator`}).catch(()=>{})}var i,p,d,c,E,F=S((()=>{g(),A(),R(),f(),$(),i="operator",p="task",d=O,c=`
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
      ON t.workspace_id = e.workspace_id AND t.parent_kind = 'issue' AND t.parent_ref = e.issue_id`,E=/^\*\*Request:\*\*\s([\s\S]*?)\n\n\*\*Response:\*\*\s([\s\S]*)$/}));export{m as a,F as c,q as d,U as f,M as i,K as l,i as n,W as o,x as r,h as s,p as t,B as u};
