import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-BvZp-r10.js";import{n as r,s as i}from"./workspace-registry-Bu1Yy540.js";import{n as a,t as o}from"./pg-jsonb-B0anZ9e-.js";import{r as s,t as c}from"./affinity-Cvfcl0oQ.js";async function l(e){try{let{sql:n}=t();return await n`
      INSERT INTO harness_shared.owner_interactions
        (workspace_id, kind, subject_kind, subject_id, payload)
      VALUES (${r()}, ${e.kind}, ${e.subjectKind},
              ${e.subjectId}, ${JSON.stringify(e.payload??{})}::text::jsonb)`,!0}catch(e){return console.warn(`[owner-preference] interaction capture failed (ignored):`,e instanceof Error?e.message:e),!1}}function u(e){if(!(typeof e!=`string`||e===``))return e.startsWith(`wi:`)?e.slice(3):e}async function d(){let{sql:e}=t(),[n,r]=await Promise.all([e`
      SELECT kind, subject_id, payload
        FROM harness_shared.owner_interactions
       WHERE kind IN ('grade', 'regrade')
         AND ts > now() - ${`${f} days`}::interval
       ORDER BY ts DESC
       LIMIT 2000`,e`
      SELECT payload
        FROM harness_shared.owner_interactions
       WHERE kind = 'queue-view'
         AND ts > now() - ${`${p} days`}::interval
       ORDER BY ts DESC
       LIMIT 1000`]),i=n.map(e=>u(o(e.payload)?.routedRef)),a=new Map,s=0;for(let e of r){let t=o(e.payload),n=Array.isArray(t?.ids)?t.ids:[];for(let e of n)typeof e==`string`&&(a.set(e,(a.get(e)??0)+1),s+=1)}let l=[...new Set([...a.keys(),...i.filter(e=>!!e)])],d=new Map;if(l.length>0){let t=await e`
      SELECT issue_id, severity, scope
        FROM harness_shared.engineer_issues
       WHERE issue_id = ANY(${l})`;for(let e of t)d.set(e.issue_id,{severity:e.severity,scope:e.scope})}let m=n.map((e,t)=>{let n=i[t],r=n?d.get(n):void 0;return{kind:e.kind===`regrade`?`regrade`:`grade`,...n?{itemId:n}:{},...r?.severity?{severity:r.severity}:{},...r?.scope?{scope:r.scope}:{}}}),h=new Map;for(let[e,t]of a){let n=d.get(e);if(n)for(let e of c(n))h.set(e,(h.get(e)??0)+t)}return{engagements:m,exposureCountById:a,exposureCountByBucket:h,totalExposures:s}}var f,p;e((()=>{n(),a(),i(),s(),f=90,p=30}))();export{d as readOwnerSignal,l as recordOwnerInteraction};