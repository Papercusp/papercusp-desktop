import{n as d}from"./chunk-ChpBd9eV.js";import{st as c,t as i}from"./src-8fWtxfEz.js";function l(e){return e??c().sql}function _(e,s){return e==null?"leave":s==="leader"?"lead":"join"}async function h(e,s){const t=l(s),r=e.event??_(e.fleetSlug,e.fleetRole);await t`
    INSERT INTO harness_shared.fleet_membership_events
      (workspace_id, owner_id, owner_label, fleet_slug, fleet_role, event)
    VALUES (${e.workspaceId}, ${e.ownerId}, ${e.ownerLabel??null},
            ${e.fleetSlug}, ${e.fleetRole}, ${r})
  `}async function $(e,s){const t=l(s),r=e.event??_(e.fleetSlug,e.fleetRole);await t`
    INSERT INTO harness_shared.fleet_membership_events
      (workspace_id, owner_id, owner_label, fleet_slug, fleet_role, event)
    SELECT ${e.workspaceId}, ${e.ownerId}, ${e.ownerLabel??null},
           ${e.fleetSlug}, ${e.fleetRole}, ${r}
     WHERE NOT EXISTS (
       SELECT 1 FROM harness_shared.fleet_membership_events e
        WHERE e.workspace_id = ${e.workspaceId} AND e.owner_id = ${e.ownerId}
     )
  `}async function R(e,s={},t){const r=l(t),n=s.workspaceId??"",f=await r`
    SELECT DISTINCT owner_id
      FROM harness_shared.fleet_membership_events
     WHERE fleet_slug = ${e}
       AND (${n} = '' OR workspace_id = ${n} OR workspace_id = 'default')
  `,o=new Set;for(const a of f)a.owner_id&&o.add(a.owner_id);return o}async function v(e,s,t){const r=await l(t)`
    SELECT fleet_slug, fleet_role
      FROM harness_shared.fleet_membership_events
     WHERE workspace_id = ${e} AND owner_id = ${s}
     ORDER BY id DESC
     LIMIT 1
  `;return r[0]?{fleetSlug:r[0].fleet_slug,fleetRole:r[0].fleet_role}:null}var I=d((()=>{i()}));export{I as a,R as i,$ as n,v as o,_ as r,h as t};
