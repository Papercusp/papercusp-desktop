import{n as i}from"./chunk-ChpBd9eV.js";import{st as r,t as o}from"./src-8fWtxfEz.js";async function c(t){const{sql:s}=r(),a=t.tripwire?JSON.stringify(t.tripwire):null,n=t.turnTs?t.turnTs.toISOString():null,e=(await s`
    INSERT INTO harness_shared.session_turn_journal
      (workspace_id, owner_id, agent, source_kind, session_id, turn_ts, note, source, flagged, tripwire, harness_slug)
    VALUES (
      ${t.workspaceId},
      ${t.ownerId}, ${t.agent}, ${t.sourceKind}, ${t.sessionId},
      ${n}::timestamptz, ${t.note}, ${t.source}, ${t.flagged},
      ${a}::text::jsonb, ${t.harnessSlug}
    )
    ON CONFLICT (session_id, COALESCE(turn_ts, 'epoch'::timestamptz)) DO NOTHING
    RETURNING id::text AS id
  `)[0]?.id??null;return{id:e,deduped:e===null}}async function u(t){const{sql:s}=r();return(await s`
    SELECT max(created_at)::text AS latest
    FROM harness_shared.session_turn_journal
    WHERE session_id = ${t}
  `)[0]?.latest??null}async function m(t,s,a=500){const{sql:n}=r();return(await n`
    SELECT tool_name, status, summary
    FROM harness_shared.agent_activity
    WHERE session_id = ${t} AND created_at > ${typeof s=="string"?s:s.toISOString()}::timestamptz
    ORDER BY id DESC
    LIMIT ${a}
  `).map(e=>({toolName:e.tool_name,status:e.status,summary:e.summary}))}async function E(t){const{sql:s}=r(),a=Math.min(Math.max(t.limit??50,1),200);return await s`
    SELECT id::text AS id, workspace_id, owner_id, agent, source_kind, session_id,
           turn_ts::text AS turn_ts, note, source, flagged, tripwire, harness_slug,
           created_at::text AS created_at
    FROM harness_shared.session_turn_journal
    WHERE TRUE
      ${t.ownerId?s`AND owner_id = ${t.ownerId}`:s``}
      ${t.sessionId?s`AND session_id = ${t.sessionId}`:s``}
      ${t.tripwiredOnly?s`AND tripwire IS NOT NULL`:s``}
    ORDER BY created_at DESC
    LIMIT ${a}
  `}async function S(t,s,a=200){const{sql:n}=r();return(await n`
    SELECT DISTINCT detail->>'file' AS file
    FROM harness_shared.agent_activity
    WHERE session_id = ${t}
      AND created_at > ${typeof s=="string"?s:s.toISOString()}::timestamptz
      AND detail ? 'file'
      AND summary LIKE '✎%'
    LIMIT ${a}
  `).map(e=>e.file).filter(Boolean)}async function I(t,s=200){const{sql:a}=r(),n=typeof t=="string"?new Date(t).getTime():t.getTime();return(await a`
    SELECT rel_path
    FROM harness_shared.harness_text_artifacts
    WHERE updated_at > ${Number.isFinite(n)?n:0}
    ORDER BY updated_at DESC
    LIMIT ${s}
  `).map(e=>e.rel_path).filter(Boolean)}var g=i((()=>{o()}));export{m as a,u as i,S as n,E as o,g as r,c as s,I as t};
