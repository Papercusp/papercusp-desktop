import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-BvZp-r10.js";import{r,t as i}from"./coordination-event-log-browser-Dq_4i-_C.js";import{v as a}from"./work-items-CE58uA4l.js";import{b as o}from"./issues-engineer-BEg2nh5w.js";function s(e){return e==null?``:e instanceof Date?e.toISOString():String(e)}function c(e,t=[]){return{id:e.id,agentSessionId:e.agent_session_id??``,title:e.title,summary:e.summary,status:e.state===`open`?`open`:`archived`,createdAt:s(e.created_at),lastActiveAt:s(e.last_active_at),turnCount:Number(e.turn_count??0),origin:e.origin,transcript:t}}async function l(e={}){let{sql:n}=t(),r=e.status??`open`,a=Math.min(Math.max(1,e.limit??20),50),o=r===`open`?n`e.state = 'open'`:r===`archived`?n`e.state <> 'open'`:n`TRUE`;return(await n`
    ${n.unsafe(p)}
     WHERE e.workspace_id = ${i}
       AND e.kind = 'task'
       AND e.assigned_by = ${f}
       AND ${o}
     ORDER BY last_active_at DESC NULLS LAST
     LIMIT ${a}`).map(e=>c(e))}async function u(e,n=10){let{sql:r}=t(),a=`%${e.replace(/[%_]/g,e=>`\\`+e)}%`;return(await r`
    ${r.unsafe(p)}
     WHERE e.workspace_id = ${i}
       AND e.kind = 'task'
       AND e.assigned_by = ${f}
       AND (COALESCE(e.title, '') ILIKE ${a} OR COALESCE(e.body, '') ILIKE ${a})
     ORDER BY last_active_at DESC NULLS LAST
     LIMIT ${Math.min(Math.max(1,n),50)}`).map(e=>c(e))}async function d(e){let{sql:n}=t(),r=await n`
    ${n.unsafe(p)}
     WHERE e.workspace_id = ${i}
       AND e.kind = 'task'
       AND (e.issue_id = ${e} OR e.payload ->> 'agentSessionId' = ${e})
     ORDER BY e.created_at DESC
     LIMIT 1`;if(!r[0])return null;let a=(await n`
    SELECT body, created_at FROM harness_shared.coord_thread_posts
     WHERE workspace_id = ${i} AND thread_id = ${`issue-thread-${r[0].id}`}
     ORDER BY created_at ASC`).map(e=>{let t=m.exec(e.body??``);return{ts:s(e.created_at),request:t?.[1]??``,response:t?.[2]??e.body??``}});return c(r[0],a)}var f,p,m,h=e((()=>{n(),r(),a(),o(),f=`operator`,p=`
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
      ON t.workspace_id = e.workspace_id AND t.parent_kind = 'issue' AND t.parent_ref = e.issue_id`,m=/^\*\*Request:\*\*\s([\s\S]*?)\n\n\*\*Response:\*\*\s([\s\S]*)$/}));export{u as a,l as i,d as n,h as r,f as t};