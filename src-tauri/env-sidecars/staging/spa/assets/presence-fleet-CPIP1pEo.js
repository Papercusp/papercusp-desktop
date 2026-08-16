import{n as o}from"./chunk-ChpBd9eV.js";import{st as l,t as _}from"./src-8fWtxfEz.js";async function r(e){const a=new Map;if(e.length===0)return a;const{sql:s}=l(),t=await s`
    SELECT owner_id, fleet_slug, fleet_role
      FROM harness_shared.coord_presence
     WHERE owner_id = ANY(${e}::text[])
       AND fleet_slug IS NOT NULL
  `;for(const n of t)a.set(n.owner_id,{fleetSlug:n.fleet_slug,fleetRole:n.fleet_role});return a}async function d(e,a){const{sql:s}=l();return(await s`
    SELECT p.owner_id,
           p.started_at,
           p.heartbeat_at,
           (
             SELECT max(ti.invoked_at)
               FROM harness_shared.tool_invocations ti
              WHERE ti.workspace_id = p.workspace_id
                AND ti.coord_owner_id = p.owner_id
                AND ti.invoked_at >= p.started_at
           ) AS last_tool_call_at
      FROM harness_shared.coord_presence p
     WHERE p.workspace_id = ${e}
       AND p.fleet_slug = ${a}
     ORDER BY p.heartbeat_at DESC
  `).map(t=>({ownerId:t.owner_id,startedAt:t.started_at instanceof Date?t.started_at:new Date(t.started_at),heartbeatAt:t.heartbeat_at instanceof Date?t.heartbeat_at:new Date(t.heartbeat_at),lastToolCallAt:t.last_tool_call_at==null?null:t.last_tool_call_at instanceof Date?t.last_tool_call_at:new Date(t.last_tool_call_at)}))}async function p(e,a,s=r){if(!e)return a;try{return(await s([e])).get(e)??{fleetSlug:null,fleetRole:null}}catch{return a}}var u=o((()=>{_()}));export{p as i,u as n,d as r,r as t};
