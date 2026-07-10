import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-pJSq82rz.js";import{n as r,t as i}from"./event-log-DlTwD7ps.js";import{y as a}from"./issues-engineer-D6_Jq29d.js";import{v as o}from"./work-items-N9uCSFd0.js";function s(e){return e==null?``:e instanceof Date?e.toISOString():String(e)}function c(e,t=[]){return{id:e.id,agentSessionId:e.agent_session_id??``,title:e.title,summary:e.summary,status:e.state===`open`?`open`:`archived`,createdAt:s(e.created_at),lastActiveAt:s(e.last_active_at),turnCount:Number(e.turn_count??0),origin:e.origin,transcript:t}}async function l(e={}){let{sql:n}=t(),i=e.status??`open`,a=Math.min(Math.max(1,e.limit??20),50),o=i===`open`?n`e.state = 'open'`:i===`archived`?n`e.state <> 'open'`:n`TRUE`;return(await n`
    ${n.unsafe(p)}
     WHERE e.workspace_id = ${r}
       AND e.kind = 'task'
       AND e.assigned_by = ${f}
       AND ${o}
     ORDER BY last_active_at DESC NULLS LAST
     LIMIT ${a}`).map(e=>c(e))}async function u(e,n=10){let{sql:i}=t(),a=`%${e.replace(/[%_]/g,e=>`\\`+e)}%`;return(await i`
    ${i.unsafe(p)}
     WHERE e.workspace_id = ${r}
       AND e.kind = 'task'
       AND e.assigned_by = ${f}
       AND (COALESCE(e.title, '') ILIKE ${a} OR COALESCE(e.body, '') ILIKE ${a})
     ORDER BY last_active_at DESC NULLS LAST
     LIMIT ${Math.min(Math.max(1,n),50)}`).map(e=>c(e))}async function d(e){let{sql:n}=t(),i=await n`
    ${n.unsafe(p)}
     WHERE e.workspace_id = ${r}
       AND e.kind = 'task'
       AND (e.issue_id = ${e} OR e.payload ->> 'agentSessionId' = ${e})
     ORDER BY e.created_at DESC
     LIMIT 1`;if(!i[0])return null;let a=(await n`
    SELECT body, created_at FROM harness_shared.coord_thread_posts
     WHERE workspace_id = ${r} AND thread_id = ${`issue-thread-${i[0].id}`}
     ORDER BY created_at ASC`).map(e=>{let t=m.exec(e.body??``);return{ts:s(e.created_at),request:t?.[1]??``,response:t?.[2]??e.body??``}});return c(i[0],a)}var f,p,m,h=e((()=>{n(),i(),o(),a(),f=`operator`,p=`
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