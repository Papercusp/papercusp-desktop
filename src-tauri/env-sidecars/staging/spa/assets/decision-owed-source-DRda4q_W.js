import{n as f}from"./chunk-ChpBd9eV.js";import{st as u,t as I}from"./src-8fWtxfEz.js";import{i as m,r as p}from"./gate-store-D81rWkD4.js";function S(i,r,c){const a=Date.parse(c),t=new Map;for(const s of r){const n=Date.parse(s.invokedAt);if(!s.ownerId||!Number.isFinite(n))continue;const o=t.get(s.ownerId)??[];o.push(n),t.set(s.ownerId,o)}return i.filter(s=>{if(!s.ownerId)return!1;const n=Date.parse(s.closedAt);if(!Number.isFinite(n))return!1;const o=t.get(s.ownerId);return!o||o.length===0?!0:!o.some(d=>d>=n&&d<=a)})}async function A(i){const{sql:r}=u(),c=i.lookbackHours??24,a=new Date(Date.now()-c*36e5).toISOString(),t=new Date().toISOString(),s=await m({workspaceId:i.workspaceId,sinceIso:a,limit:i.limit??100}),n=i.sessionId?s.filter(e=>e.session_id===i.sessionId):s;if(n.length===0)return[];const o=await r`
    SELECT DISTINCT ON (session_id) session_id, coord_owner_id
    FROM harness_shared.adv_sessions
    WHERE session_id = ANY(${[...new Set(n.map(e=>e.session_id))]})
    ORDER BY session_id, started_at DESC
  `,d=new Map(o.map(e=>[e.session_id,e.coord_owner_id])),_=n.map(e=>({sessionId:e.session_id,refId:e.ref_id,client:e.client,question:e.question,options:e.options,closedAt:e.closed_at,ownerId:d.get(e.session_id)??e.owner_id??null,harnessSlug:e.harness_slug})),w=[...new Set(_.map(e=>e.ownerId).filter(e=>!!e))];return w.length===0?[]:S(_,(await r`
    SELECT coord_owner_id, invoked_at::text AS invoked_at
    FROM harness_shared.tool_invocations
    WHERE coord_owner_id = ANY(${w})
      AND tool_name = ANY(${[...l]})
      AND invoked_at >= ${a}
  `).filter(e=>e.coord_owner_id).map(e=>({ownerId:e.coord_owner_id,invokedAt:e.invoked_at})),t)}var l,D=f((()=>{I(),p(),l=["plans:add-decision","plans:ratify-decision"]}));D();export{A as readDecisionsOwed};
