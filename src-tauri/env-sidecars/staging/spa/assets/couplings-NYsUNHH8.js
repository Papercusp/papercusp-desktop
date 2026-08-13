import{n as A}from"./chunk-ChpBd9eV.js";import{st as h,t as R}from"./src-BmBNODK0.js";import{c as D,r as w}from"./workspace-registry-Du2UbhlH.js";import{g as N,r as I}from"./adv-sessions-DM5DCFPw.js";function k(e,a){const n=e.trim(),r=a.trim();return!n||!r||n===r?null:n<r?{agentA:n,agentB:r}:{agentA:r,agentB:n}}async function U(e){return f({...e,state:"coupled"})}async function $(e){return f({...e,state:"suppressed"})}async function f(e){const a=k(e.agentA,e.agentB);if(!a)return null;const n=e.workspaceId??w(),r=O(e.reason),i=e.ttlSec!=null&&Number.isFinite(e.ttlSec)&&e.ttlSec>0?Math.floor(e.ttlSec):null,{sql:d}=h(),l=await d`
    INSERT INTO harness_shared.agent_couplings
      (workspace_id, agent_a, agent_b, state, declared_by, reason, expires_at)
    VALUES
      (${n}, ${a.agentA}, ${a.agentB}, ${e.state}, ${e.declaredBy}, ${r},
       ${i==null?null:d`clock_timestamp() + make_interval(secs => ${i})`})
    ON CONFLICT (workspace_id, agent_a, agent_b) DO UPDATE SET
      state       = EXCLUDED.state,
      declared_by = EXCLUDED.declared_by,
      reason      = EXCLUDED.reason,
      expires_at  = EXCLUDED.expires_at,
      updated_at  = clock_timestamp()
    RETURNING agent_a, agent_b, state, declared_by, reason,
              created_at::text, updated_at::text, expires_at::text
  `;return l[0]?m(l[0]):null}async function F(e,a){const n=e.trim();if(!n)return[];const r=a??w(),{sql:i}=h();return(await i`
    WITH live_owner AS (
      -- coord_presence is the retained live-roster projection. Do not add a
      -- heartbeat-age predicate here: an old heartbeat with a standing wake can
      -- still be a parked, dispatchable session, and the presence reaper is the
      -- authority that distinguishes that case from an ended owner.
      SELECT cp.workspace_id, cp.owner_id
        FROM harness_shared.coord_presence cp
      UNION
      -- Presence is self-registered, so the session log is the authoritative
      -- fallback during the launch/first-heartbeat window. Keep the same 12h
      -- zombie bound as listRecordedLiveSessions.
      SELECT s.workspace_id, s.coord_owner_id
        FROM harness_shared.adv_sessions s
       WHERE s.coord_owner_id IS NOT NULL
         AND s.ended_at IS NULL
         AND s.started_at > clock_timestamp() - make_interval(secs => ${b})
    )
    SELECT c.agent_a, c.agent_b, c.state, c.declared_by, c.reason,
           created_at::text, updated_at::text, expires_at::text
      FROM harness_shared.agent_couplings c
     WHERE c.workspace_id = ${r}
       AND (c.agent_a = ${n} OR c.agent_b = ${n})
       AND (c.expires_at IS NULL OR c.expires_at > clock_timestamp())
       AND (
         c.state = 'suppressed'
         OR (
           EXISTS (
             SELECT 1
               FROM live_owner l
              WHERE l.workspace_id = c.workspace_id
                AND l.owner_id = c.agent_a
           )
           AND EXISTS (
             SELECT 1
               FROM live_owner l
              WHERE l.workspace_id = c.workspace_id
                AND l.owner_id = c.agent_b
           )
         )
       )
     ORDER BY c.updated_at DESC
  `).map(m)}function L(e,a){return e.agentA===a?e.agentB:e.agentA}function X(e,a,n){const r=e.trim(),i=new Set,d=new Map;for(const t of n){const s=L(t,r);!s||s===r||(t.state==="suppressed"?i.add(s):d.set(s,t))}const l=new Map,p=new Map;for(const t of a){const s=(t?.ownerId??"").trim();if(!s||s===r)continue;const o=(t?.because??"").trim(),_=l.get(s);_?o&&!_.includes(o)&&_.push(o):l.set(s,o?[o]:[]);const c=t?.relation;if(c&&S.includes(c)){const u=p.get(s);u?u.includes(c)||u.push(c):p.set(s,[c])}}const g=[],E=new Set;for(const[t,s]of l){if(i.has(t))continue;E.add(t);const o=d.get(t),_=s.join("; "),c=p.get(t),u={..._?{derivedBecause:_}:{},...c&&c.length>0?{derivedRelations:c}:{}};g.push(o?{ownerId:t,source:"both",reason:o.reason,declaredBy:o.declaredBy,...u}:{ownerId:t,source:"derived",...u})}for(const[t,s]of d)i.has(t)||E.has(t)||g.push({ownerId:t,source:"declared",reason:s.reason,declaredBy:s.declaredBy});return g.sort((t,s)=>t.ownerId.localeCompare(s.ownerId))}function O(e){const a=(e??"").trim();return a?a.length>500?a.slice(0,499)+"…":a:null}function m(e){return{agentA:e.agent_a,agentB:e.agent_b,state:e.state??"coupled",declaredBy:e.declared_by,reason:e.reason,createdAt:e.created_at,updatedAt:e.updated_at,expiresAt:e.expires_at}}var C,S,y,b,P=A((()=>{R(),D(),N(),C="self",S=["holds-a-lock-on","awaits","blocks-me","blocked-by-me","coord-exchange"],y=500,b=Math.max(1,Math.round(I/1e3))}));export{P as a,L as c,U as i,X as l,S as n,F as o,C as r,k as s,y as t,$ as u};
