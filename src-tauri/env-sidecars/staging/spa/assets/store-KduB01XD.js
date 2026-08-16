import{n as $}from"./chunk-ChpBd9eV.js";import{a as I,l as f,n as y,r as g,u as E}from"./registry-EuM2NDjF.js";import{st as D,t as p}from"./src-8fWtxfEz.js";import{n as l,t as S}from"./agent-orders-notify-DSzp1kSm.js";function w(e){return e??D().sql}function k(e){return{workspaceId:String(e.workspace_id),ownerId:String(e.owner_id),axisKey:String(e.axis_key),mode:String(e.mode),reason:String(e.reason??""),setBy:String(e.set_by??""),ownerDirected:!!e.owner_directed,setAt:e.set_at instanceof Date?e.set_at.toISOString():String(e.set_at),subject:e.subject==null||e.subject===""?null:String(e.subject)}}async function T(e,n,o,d){const r=I(o);if(!r||!e||!n)return null;const t=await w(d)`
    SELECT subject FROM harness_shared.agent_modes
    WHERE workspace_id = ${e} AND owner_id = ${n}
      AND axis_key = ${y(r)} AND mode = ${r.id}
    LIMIT 1`,a=t.length?t[0].subject:null;return a==null||a===""?null:String(a)}async function b(e,n,o){return(await w(o)`
    SELECT * FROM harness_shared.agent_modes
    WHERE workspace_id = ${e} AND owner_id = ${n}
    ORDER BY axis_key`).map(k)}async function L(e,n,o){const d=new Map;if(!n.length)return d;const r=await w(o)`
    SELECT * FROM harness_shared.agent_modes
    WHERE workspace_id = ${e} AND owner_id IN ${w(o)(n)}
    ORDER BY axis_key`;for(const t of r){const a=k(t),s=d.get(a.ownerId)??[];s.push(a),d.set(a.ownerId,s)}return d}async function _(e,n){await e`
    INSERT INTO harness_shared.agent_mode_changes
      (workspace_id, owner_id, axis_key, old_mode, new_mode, reason, set_by, owner_directed)
    VALUES (${n.workspaceId}, ${n.ownerId}, ${n.axisKey}, ${n.oldMode}, ${n.newMode},
            ${n.reason}, ${n.setBy}, ${n.ownerDirected})`}async function m(e,n){const o=[];for(const d of E(n.modeId)){const r=I(d);if(!r)continue;if(f(r.id)){o.push({mode:r.id,status:"skipped",error:`'${r.id}' requires a subject, which an implication cannot supply — declare it explicitly, not via implies`});continue}const t=y(r),a=`implied by '${n.modeId}' — ${n.reason}`,s=!1;try{if((await e`
        INSERT INTO harness_shared.agent_modes
          (workspace_id, owner_id, axis_key, mode, reason, set_by, owner_directed, set_at, subject)
        VALUES (${n.workspaceId}, ${n.ownerId}, ${t}, ${r.id}, ${a},
                ${n.setBy}, ${s}, now(), ${null})
        ON CONFLICT (workspace_id, owner_id, axis_key) DO NOTHING
        RETURNING mode`).length){await _(e,{workspaceId:n.workspaceId,ownerId:n.ownerId,axisKey:t,oldMode:null,newMode:r.id,reason:a,setBy:n.setBy,ownerDirected:s}),o.push({mode:r.id,status:"set"});continue}const i=await e`
        SELECT mode FROM harness_shared.agent_modes
        WHERE workspace_id = ${n.workspaceId} AND owner_id = ${n.ownerId} AND axis_key = ${t}
        LIMIT 1`,c=i.length?String(i[0].mode):null;o.push(c&&c!==r.id?{mode:r.id,status:"axis-held",by:c}:{mode:r.id,status:"already-on"})}catch(i){o.push({mode:r.id,status:"failed",error:i instanceof Error?i.message:String(i)})}}return o}async function A(e){const n=w(e.sql),o=await b(e.workspaceId,e.ownerId,n),d=[];for(const r of o)E(r.mode).length&&d.push(...await m(n,{workspaceId:e.workspaceId,ownerId:e.ownerId,modeId:r.mode,reason:`reconciled: '${r.mode}' was already held when its implications were declared`,setBy:e.setBy??"mode-implies-reconcile"}));return d}async function C(e){const n=I(e.modeId);if(!n)return{ok:!1,error:`unknown mode '${e.modeId}'`};const o=w(e.sql),d=y(n),r=e.setBy===e.ownerId||!!e.callerIsOwnerAuthority,t=!!e.ownerDirected&&r,a=await o`
    SELECT * FROM harness_shared.agent_modes
    WHERE workspace_id = ${e.workspaceId} AND owner_id = ${e.ownerId} AND axis_key = ${d}`,s=a.length?k(a[0]):null;if(s?.ownerDirected&&!r)return{ok:!1,stickyConflict:!0,mode:n,switchedFrom:s.mode};if(!e.enabled)return!s||s.mode!==n.id?{ok:!0,noop:!0,mode:n}:(await o`
      DELETE FROM harness_shared.agent_modes
      WHERE workspace_id = ${e.workspaceId} AND owner_id = ${e.ownerId} AND axis_key = ${d}`,await _(o,{workspaceId:e.workspaceId,ownerId:e.ownerId,axisKey:d,oldMode:s.mode,newMode:null,reason:e.reason,setBy:e.setBy,ownerDirected:t}),await l(e.ownerId),{ok:!0,mode:n,switchedFrom:null});const i=e.subject!==void 0?e.subject:s?.mode===n.id?s.subject:null;if(s?.mode===n.id&&s.ownerDirected===t&&s.reason===e.reason&&s.subject===i){const u=await m(o,{workspaceId:e.workspaceId,ownerId:e.ownerId,modeId:n.id,reason:e.reason,setBy:e.setBy});return u.some(h=>h.status==="set")&&await l(e.ownerId),{ok:!0,noop:!0,mode:n,...u.length?{implied:u}:{}}}await o`
    INSERT INTO harness_shared.agent_modes
      (workspace_id, owner_id, axis_key, mode, reason, set_by, owner_directed, set_at, subject)
    VALUES (${e.workspaceId}, ${e.ownerId}, ${d}, ${n.id}, ${e.reason},
            ${e.setBy}, ${t}, now(), ${i})
    ON CONFLICT (workspace_id, owner_id, axis_key) DO UPDATE SET
      mode = EXCLUDED.mode, reason = EXCLUDED.reason, set_by = EXCLUDED.set_by,
      owner_directed = EXCLUDED.owner_directed, set_at = EXCLUDED.set_at,
      subject = EXCLUDED.subject`,await _(o,{workspaceId:e.workspaceId,ownerId:e.ownerId,axisKey:d,oldMode:s?.mode??null,newMode:n.id,reason:e.reason,setBy:e.setBy,ownerDirected:t});const c=await m(o,{workspaceId:e.workspaceId,ownerId:e.ownerId,modeId:n.id,reason:e.reason,setBy:e.setBy});return await l(e.ownerId),{ok:!0,mode:n,switchedFrom:s&&s.mode!==n.id?s.mode:null,...c.length?{implied:c}:{}}}var N,j=$((()=>{p(),g(),S(),N="mode-implies-reconcile"}));export{j as a,L as i,T as n,A as o,b as r,C as s,N as t};
