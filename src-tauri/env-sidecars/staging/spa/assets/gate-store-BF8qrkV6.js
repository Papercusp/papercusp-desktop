import{n as t}from"./chunk-ChpBd9eV.js";import{st as a,t as i}from"./src-BmBNODK0.js";async function l(e){const{sql:s}=a(),o=e.options?JSON.stringify(e.options):null,d=(await s`
    INSERT INTO harness_shared.session_pending_gates
      (workspace_id, session_id, client, kind, ref_id, owner_id, question, options, source, raw_ref, harness_slug)
    VALUES (
      ${e.workspaceId}, ${e.sessionId}, ${e.client}, ${e.kind}, ${e.refId},
      ${e.ownerId??null}, ${e.question??null}, ${o}::text::jsonb,
      ${e.source}, ${e.rawRef??null}, ${e.harnessSlug??null}
    )
    ON CONFLICT (workspace_id, session_id, ref_id) DO UPDATE
      SET updated_at = now()
      WHERE session_pending_gates.closed_at IS NULL
    RETURNING id::text AS id, opened_at::text AS opened_at, updated_at::text AS touched_opened_at
  `)[0];if(!d)return{id:(await s`
      SELECT id::text AS id FROM harness_shared.session_pending_gates
      WHERE workspace_id = ${e.workspaceId} AND session_id = ${e.sessionId} AND ref_id = ${e.refId}
    `)[0]?.id??"",outcome:"already_open"};const n=d.opened_at===d.touched_opened_at?"opened":"already_open";return{id:d.id,outcome:n}}async function w(e){const{sql:s}=a();return(await s`
    UPDATE harness_shared.session_pending_gates
       SET closed_at = now(), closed_reason = ${e.reason}, updated_at = now()
     WHERE workspace_id = ${e.workspaceId}
       AND session_id = ${e.sessionId}
       AND ref_id = ${e.refId}
       AND closed_at IS NULL
     RETURNING id::text AS id
  `).length>0?"closed":(await s`
    SELECT closed_at::text AS closed_at FROM harness_shared.session_pending_gates
    WHERE workspace_id = ${e.workspaceId} AND session_id = ${e.sessionId} AND ref_id = ${e.refId}
  `).length===0?"not_found":"already_closed"}async function E(e){const{sql:s}=a();return(await s`
    UPDATE harness_shared.session_pending_gates
       SET closed_at = now(), closed_reason = 'tool_result_observed', updated_at = now()
     WHERE workspace_id = ${e.workspaceId}
       AND session_id = ${e.sessionId}
       AND ref_id = ${e.toolUseId}
       AND closed_at IS NULL
     RETURNING id::text AS id
  `).length}async function I(e){const{sql:s}=a(),o=Math.min(Math.max(e.limit??50,1),200);return await s`
    SELECT id::text AS id, workspace_id, session_id, client, kind, ref_id, owner_id, question, options,
           source, raw_ref, harness_slug, opened_at::text AS opened_at, closed_at::text AS closed_at,
           closed_reason, created_at::text AS created_at
    FROM harness_shared.session_pending_gates
    WHERE workspace_id = ${e.workspaceId}
      ${e.includeClosed?s``:s`AND closed_at IS NULL`}
      ${e.sessionId?s`AND session_id = ${e.sessionId}`:s``}
    ORDER BY opened_at ${e.order==="newest"?s`DESC`:s`ASC`}
    LIMIT ${o}
  `}async function A(e){const{sql:s}=a(),o=Math.min(Math.max(e.limit??100,1),500);return await s`
    SELECT id::text AS id, workspace_id, session_id, client, kind, ref_id, owner_id, question, options,
           source, raw_ref, harness_slug, opened_at::text AS opened_at, closed_at::text AS closed_at,
           closed_reason, created_at::text AS created_at
    FROM harness_shared.session_pending_gates
    WHERE workspace_id = ${e.workspaceId}
      AND kind = 'ask'
      AND closed_at IS NOT NULL
      AND closed_at >= ${e.sinceIso}
    ORDER BY closed_at DESC
    LIMIT ${o}
  `}var S=t((()=>{i()}));export{I as a,A as i,E as n,l as o,S as r,w as t};
