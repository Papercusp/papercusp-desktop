import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-DTtGQmae.js";function r(e){return e??t().sql}function i(e,t){return e==null?`leave`:t===`leader`?`lead`:`join`}async function a(e,t){let n=r(t),a=e.event??i(e.fleetSlug,e.fleetRole);await n`
    INSERT INTO harness_shared.fleet_membership_events
      (workspace_id, owner_id, owner_label, fleet_slug, fleet_role, event)
    VALUES (${e.workspaceId}, ${e.ownerId}, ${e.ownerLabel??null},
            ${e.fleetSlug}, ${e.fleetRole}, ${a})
  `}async function o(e,t){let n=r(t),a=e.event??i(e.fleetSlug,e.fleetRole);await n`
    INSERT INTO harness_shared.fleet_membership_events
      (workspace_id, owner_id, owner_label, fleet_slug, fleet_role, event)
    SELECT ${e.workspaceId}, ${e.ownerId}, ${e.ownerLabel??null},
           ${e.fleetSlug}, ${e.fleetRole}, ${a}
     WHERE NOT EXISTS (
       SELECT 1 FROM harness_shared.fleet_membership_events e
        WHERE e.workspace_id = ${e.workspaceId} AND e.owner_id = ${e.ownerId}
     )
  `}async function s(e,t,n){let i=await r(n)`
    SELECT fleet_slug, fleet_role
      FROM harness_shared.fleet_membership_events
     WHERE workspace_id = ${e} AND owner_id = ${t}
     ORDER BY id DESC
     LIMIT 1
  `;return i[0]?{fleetSlug:i[0].fleet_slug,fleetRole:i[0].fleet_role}:null}var c=e((()=>{n()}));export{s as a,c as i,o as n,i as r,a as t};