import{n as _}from"./chunk-ChpBd9eV.js";import{st as i,t as u}from"./src-BmBNODK0.js";import{L as d,s as p,x as E}from"./thresholds-YVAEcMsA.js";async function w(s){const{sql:a}=i(),t=await a`
    SELECT panel, status, reason, acked_by, acked_at, snooze_until
      FROM harness_shared.system_health_acks
     WHERE workspace_id = ${s}`,o=new Map;for(const e of t)l.has(e.status)&&o.set(e.panel,{status:e.status,reason:e.reason,ackedBy:e.acked_by,ackedAt:new Date(e.acked_at).getTime(),snoozeUntil:e.snooze_until?new Date(e.snooze_until).getTime():null});return o}async function A(s){const{sql:a}=i();await a`
    INSERT INTO harness_shared.system_health_acks
      (workspace_id, panel, status, reason, acked_by, snooze_until)
    VALUES (${s.workspaceId}, ${s.panel}, ${s.status}, ${s.reason},
            ${s.ackedBy}, ${s.snoozeUntil?new Date(s.snoozeUntil).toISOString():null})
    ON CONFLICT (workspace_id, panel) DO UPDATE SET
      status = EXCLUDED.status, reason = EXCLUDED.reason,
      acked_by = EXCLUDED.acked_by, acked_at = now(),
      snooze_until = EXCLUDED.snooze_until`}async function T(s,a){const{sql:t}=i();return(await t`
    DELETE FROM harness_shared.system_health_acks
     WHERE workspace_id = ${s} AND panel = ${a}
     RETURNING panel`).length>0}function f(s,a,t){let o=0;const e=[];for(const[r,n]of Object.entries(s.panels)){const c=a.get(r);c&&p(c,n.status,t)?(n.ack=c,o+=1):(delete n.ack,e.push(n.status))}return s.overall=d(e),s.ackedCount=o,s}async function U(s,a){const t=await w(s.workspaceId);if(t.size===0)return;const{sql:o}=i();for(const[e,r]of t){const n=s.panels[e],c=n!==void 0&&n.status==="ok",k=r.snoozeUntil!==null&&a>r.snoozeUntil;(c||k||n===void 0)&&(await o`
        DELETE FROM harness_shared.system_health_acks
         WHERE workspace_id = ${s.workspaceId} AND panel = ${e}`,t.delete(e))}f(s,t,a)}var l,z=_((()=>{u(),E(),l=new Set(["warn","crit"])}));export{U as a,w as i,T as n,A as o,z as r,f as t};
