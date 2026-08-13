import{n as i}from"./chunk-ChpBd9eV.js";import{st as a,t as _}from"./src-BmBNODK0.js";async function E(s){const{sql:t}=a(),n=s.cursor.terms??[],r=JSON.stringify(n),e=s.turnTs==null?null:typeof s.turnTs=="string"?s.turnTs:s.turnTs.toISOString();await t`
    INSERT INTO harness_shared.session_cursor
      (session_id, workspace_id, owner_id, harness_slug, turn_ts, note_count, term_count, terms, updated_at)
    VALUES (
      ${s.sessionId}, ${s.workspaceId}, ${s.ownerId}, ${s.harnessSlug},
      ${e}::timestamptz, ${s.cursor.noteCount??0}, ${n.length},
      ${r}::text::jsonb, now()
    )
    ON CONFLICT (session_id) DO UPDATE SET
      workspace_id = EXCLUDED.workspace_id,
      owner_id     = EXCLUDED.owner_id,
      harness_slug = EXCLUDED.harness_slug,
      turn_ts      = EXCLUDED.turn_ts,
      note_count   = EXCLUDED.note_count,
      term_count   = EXCLUDED.term_count,
      terms        = EXCLUDED.terms,
      updated_at   = now()
  `}async function m(s){const{sql:t}=a();return(await t`
    SELECT session_id, workspace_id, owner_id, harness_slug,
           turn_ts::text AS turn_ts, note_count, term_count, terms,
           updated_at::text AS updated_at
    FROM harness_shared.session_cursor
    WHERE session_id = ${s}
  `)[0]??null}async function w(s={}){const{sql:t}=a(),n=Math.min(Math.max(s.limit??100,1),500),r=s.updatedSince==null?null:typeof s.updatedSince=="string"?s.updatedSince:s.updatedSince.toISOString();return await t`
    SELECT session_id, workspace_id, owner_id, harness_slug,
           turn_ts::text AS turn_ts, note_count, term_count, terms,
           updated_at::text AS updated_at
    FROM harness_shared.session_cursor
    WHERE TRUE
      ${s.ownerId?t`AND owner_id = ${s.ownerId}`:t``}
      ${s.excludeSessionId?t`AND session_id <> ${s.excludeSessionId}`:t``}
      ${r?t`AND updated_at > ${r}::timestamptz`:t``}
    ORDER BY updated_at DESC
    LIMIT ${n}
  `}async function S(s){const t=[...new Set(s.filter(o=>typeof o=="string"&&o.length>0))],n=new Map;if(t.length===0)return n;const{sql:r}=a(),e=await r`
    SELECT DISTINCT ON (owner_id)
           session_id, workspace_id, owner_id, harness_slug,
           turn_ts::text AS turn_ts, note_count, term_count, terms,
           updated_at::text AS updated_at
    FROM harness_shared.session_cursor
    WHERE owner_id = ANY(${t})
    ORDER BY owner_id, updated_at DESC
  `;for(const o of e)o.owner_id&&n.set(o.owner_id,o);return n}async function p(s){const{sql:t}=a();return(await t`
    DELETE FROM harness_shared.session_cursor
    WHERE updated_at < ${typeof s=="string"?s:s.toISOString()}::timestamptz
    RETURNING session_id
  `).length}function g(s){const t=Array.isArray(s.terms)?s.terms:[],n=new Map,r=new Map;for(const e of t)!e||typeof e.term!="string"||(n.set(e.term,e.weight),r.set(e.term,e.termClass));return{sessionId:s.session_id,terms:t,weightByTerm:n,classByTerm:r,noteCount:s.note_count??0}}var D=i((()=>{_()}));export{w as a,p as i,m as n,g as o,D as r,E as s,S as t};
