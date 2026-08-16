import{n as e}from"./chunk-ChpBd9eV.js";import{st as i,t as d}from"./src-8fWtxfEz.js";async function u(t){if(!t.sessionId&&!t.ownerId)throw new Error("toolCallRowsFor: pass sessionId and/or ownerId");const a=Math.min(Math.max(t.limit??1e3,1),5e3),{sql:n}=i(),o=await n`
    SELECT id::text AS id, tool_name, phase, tool_use_id, status, summary, detail, kind,
           created_at::text AS created_at
    FROM harness_shared.agent_activity
    WHERE kind = 'tool'
      AND (${t.sessionId??null}::text IS NULL OR session_id = ${t.sessionId??null})
      AND (${t.ownerId??null}::text IS NULL OR owner_id = ${t.ownerId??null})
      AND (${t.sinceIso??null}::timestamptz IS NULL OR created_at > ${t.sinceIso??null}::timestamptz)
      AND (${t.untilIso??null}::timestamptz IS NULL OR created_at <= ${t.untilIso??null}::timestamptz)
    ORDER BY id::bigint DESC
    LIMIT ${a}
  `;return o.reverse(),o.map(s=>({id:s.id,toolName:s.tool_name,phase:s.phase,toolUseId:s.tool_use_id,status:s.status,summary:s.summary,detail:s.detail,kind:s.kind,createdAt:s.created_at}))}var r=e((()=>{d()}));export{u as n,r as t};
