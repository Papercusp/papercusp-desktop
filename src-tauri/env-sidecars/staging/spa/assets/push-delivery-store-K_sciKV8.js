import{n as u}from"./chunk-ChpBd9eV.js";import{st as r,t as c}from"./src-BmBNODK0.js";function o(e){return{...e,id:Number(e.id),score:Number(e.score)}}async function N(e){const{sql:t}=r(),s=JSON.stringify(e.handleQuery??[]),a=await t`
    INSERT INTO harness_shared.push_delivery
      (target_owner_id, target_session_id, workspace_id, matcher_kind, severity,
       handle_kind, handle_ref, handle_query, teaser, score, source_session_id, status)
    VALUES (
      ${e.targetOwnerId}, ${e.targetSessionId??null}, ${e.workspaceId??"default"},
      ${e.matcherKind}, ${e.severity}, ${e.handleKind}, ${e.handleRef},
      ${s}::text::jsonb, ${e.teaser}, ${e.score},
      ${e.sourceSessionId??null}, 'queued'
    )
    RETURNING id
  `;return Number(a[0].id)}async function w(e,t=100){const{sql:s}=r();return(await s`
    SELECT id, target_owner_id, target_session_id, workspace_id, matcher_kind, severity,
           handle_kind, handle_ref, handle_query, teaser, score, source_session_id, status,
           drop_reason, enqueued_at::text AS enqueued_at, delivered_at::text AS delivered_at,
           pulled_at::text AS pulled_at, acted_at::text AS acted_at
    FROM harness_shared.push_delivery
    WHERE target_owner_id = ${e} AND status = 'queued'
    ORDER BY enqueued_at ASC
    LIMIT ${Math.min(Math.max(t,1),500)}
  `).map(o)}async function p(e){const t=[...new Set(e.filter(a=>Number.isFinite(a)))];if(t.length===0)return 0;const{sql:s}=r();return(await s`
    UPDATE harness_shared.push_delivery
    SET status = 'delivered', delivered_at = now()
    WHERE id = ANY(${t}) AND status = 'queued'
    RETURNING id
  `).length}async function R(e){const t=e.filter(d=>Number.isFinite(d.id));if(t.length===0)return 0;const{sql:s}=r();let a=0;const n=new Map;for(const d of t){const i=n.get(d.reason)??[];i.push(d.id),n.set(d.reason,i)}for(const[d,i]of n){const _=await s`
      UPDATE harness_shared.push_delivery
      SET status = 'dropped', drop_reason = ${d}
      WHERE id = ANY(${[...new Set(i)]}) AND status = 'queued'
      RETURNING id
    `;a+=_.length}return a}async function S(e,t){const{sql:s}=r();return(await s`
    UPDATE harness_shared.push_delivery
    SET pulled_at = now()
    WHERE target_owner_id = ${e}
      AND handle_ref = ${t}
      AND status = 'delivered'
      AND pulled_at IS NULL
    RETURNING id
  `).length}async function y(e,t){const{sql:s}=r();return(await s`
    UPDATE harness_shared.push_delivery
    SET acted_at = now()
    WHERE target_owner_id = ${e}
      AND handle_ref = ${t}
      AND status = 'delivered'
      AND acted_at IS NULL
    RETURNING id
  `).length}async function A(e,t){const{sql:s}=r(),a=await s`
    SELECT DISTINCT handle_ref
    FROM harness_shared.push_delivery
    WHERE target_owner_id = ${e}
      AND status = 'delivered'
      AND delivered_at > ${t}::timestamptz
  `;return new Set(a.map(n=>n.handle_ref))}async function v(e,t){const{sql:s}=r(),a=await s`
    SELECT DISTINCT handle_ref
    FROM harness_shared.push_delivery
    WHERE target_owner_id = ${e}
      AND matcher_kind = ${t}
      AND status = 'queued'
  `;return new Set(a.map(n=>n.handle_ref))}async function g(e,t){const{sql:s}=r(),a=await s`
    SELECT count(*)::int AS n
    FROM harness_shared.push_delivery
    WHERE target_owner_id = ${e}
      AND status = 'delivered'
      AND delivered_at > ${t}::timestamptz
  `;return Number(a[0]?.n??0)}async function m(e={}){const{sql:t}=r(),s=Math.min(Math.max(e.limit??100,1),500),a=e.since==null?null:typeof e.since=="string"?e.since:e.since.toISOString();return(await t`
    SELECT id, target_owner_id, target_session_id, workspace_id, matcher_kind, severity,
           handle_kind, handle_ref, handle_query, teaser, score, source_session_id, status,
           drop_reason, enqueued_at::text AS enqueued_at, delivered_at::text AS delivered_at,
           pulled_at::text AS pulled_at, acted_at::text AS acted_at
    FROM harness_shared.push_delivery
    WHERE TRUE
      ${e.targetOwnerId?t`AND target_owner_id = ${e.targetOwnerId}`:t``}
      ${e.status?t`AND status = ${e.status}`:t``}
      ${a?t`AND enqueued_at > ${a}::timestamptz`:t``}
    ORDER BY enqueued_at DESC
    LIMIT ${s}
  `).map(o)}async function $(e){const{sql:t}=r();return(await t`
    DELETE FROM harness_shared.push_delivery
    WHERE enqueued_at < ${typeof e=="string"?e:e.toISOString()}::timestamptz
    RETURNING id
  `).length}var f=u((()=>{c()}));export{w as a,m as c,R as d,S as f,f as i,y as l,A as n,$ as o,N as r,v as s,g as t,p as u};
