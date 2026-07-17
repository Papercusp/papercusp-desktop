import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CwW4br4q.js";async function r(e){if(!e.sessionId&&!e.ownerId)throw Error(`toolCallRowsFor: pass sessionId and/or ownerId`);let n=Math.min(Math.max(e.limit??1e3,1),5e3),{sql:r}=t(),i=await r`
    SELECT id::text AS id, tool_name, phase, tool_use_id, status, summary, detail, kind,
           created_at::text AS created_at
    FROM harness_shared.agent_activity
    WHERE kind = 'tool'
      AND (${e.sessionId??null}::text IS NULL OR session_id = ${e.sessionId??null})
      AND (${e.ownerId??null}::text IS NULL OR owner_id = ${e.ownerId??null})
      AND (${e.sinceIso??null}::timestamptz IS NULL OR created_at > ${e.sinceIso??null}::timestamptz)
      AND (${e.untilIso??null}::timestamptz IS NULL OR created_at <= ${e.untilIso??null}::timestamptz)
    ORDER BY id::bigint DESC
    LIMIT ${n}
  `;return i.reverse(),i.map(e=>({id:e.id,toolName:e.tool_name,phase:e.phase,toolUseId:e.tool_use_id,status:e.status,summary:e.summary,detail:e.detail,kind:e.kind,createdAt:e.created_at}))}e((()=>{n()}))();export{r as toolCallRowsFor};