import{n as o}from"./chunk-ChpBd9eV.js";import{st as t,t as _}from"./src-8fWtxfEz.js";import{d as i,s as d}from"./identity-HZdRK23v.js";import{d as w}from"./source-BL7J0oFl.js";function O(e){const n=i(e);return n.userId&&n.userId.length>0?n.userId:n.ownerId}async function u(e,n,a){const{sql:s}=t();return c((await s`
    INSERT INTO harness_shared.agent_names (workspace_id, agent_name, owner_user)
    VALUES (${e}, ${n}, ${a})
    ON CONFLICT (workspace_id, agent_name) DO UPDATE SET updated_at = now()
    RETURNING workspace_id, agent_name, owner_user, created_at, updated_at
  `)[0])}async function T(e,n,a,s){await u(e,a,s);const{sql:r}=t();return m((await r`
    INSERT INTO harness_shared.agent_name_sessions
      (workspace_id, session_owner_id, agent_name, owner_user)
    VALUES (${e}, ${n}, ${a}, ${s})
    ON CONFLICT (workspace_id, session_owner_id) DO UPDATE SET
      agent_name = EXCLUDED.agent_name,
      owner_user = EXCLUDED.owner_user,
      adopted_at = now()
    RETURNING workspace_id, session_owner_id, agent_name, owner_user, adopted_at
  `)[0])}async function f(e,n){const{sql:a}=t();return(await a`
    SELECT agent_name FROM harness_shared.agent_name_sessions
     WHERE workspace_id = ${e} AND session_owner_id = ${n}
  `)[0]?.agent_name??null}async function A(e,n){const{sql:a}=t();return(await a`
    SELECT owner_user FROM harness_shared.agent_names
     WHERE workspace_id = ${e} AND agent_name = ${n}
  `)[0]?.owner_user??null}function c(e){return{workspaceId:e.workspace_id,agentName:e.agent_name,ownerUser:e.owner_user,createdAt:e.created_at,updatedAt:e.updated_at}}function m(e){return{workspaceId:e.workspace_id,sessionOwnerId:e.session_owner_id,agentName:e.agent_name,ownerUser:e.owner_user,adoptedAt:e.adopted_at}}var D=o((()=>{_(),d(),w()}));export{u as a,D as i,A as n,f as o,O as r,T as t};
