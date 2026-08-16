import{n as I}from"./chunk-ChpBd9eV.js";import{st as f,t as m}from"./src-8fWtxfEz.js";import{c as R,r as S}from"./workspace-registry-Du2UbhlH.js";import{n as k,t as _}from"./pg-jsonb-D6Z3WsbA.js";import{r as h,t as D}from"./affinity-D-3m7zbn.js";async function O(e){try{const{sql:n}=f();return await n`
      INSERT INTO harness_shared.owner_interactions
        (workspace_id, kind, subject_kind, subject_id, payload)
      VALUES (${S()}, ${e.kind}, ${e.subjectKind},
              ${e.subjectId}, ${JSON.stringify(e.payload??{})}::text::jsonb)`,!0}catch(n){return console.warn("[owner-preference] interaction capture failed (ignored):",n instanceof Error?n.message:n),!1}}async function C(e,n="improvements"){if(e.length===0)return!1;try{const{sql:a}=f(),i=await a`
      SELECT ts FROM harness_shared.owner_interactions
       WHERE kind = 'queue-view'
       ORDER BY ts DESC
       LIMIT 1`;if(i[0]){const c=i[0].ts instanceof Date?i[0].ts.getTime():Date.parse(String(i[0].ts));if(Date.now()-c<3e5)return!1}return await O({kind:"queue-view",subjectKind:"learning-tab",subjectId:n,payload:{ids:e.slice(0,l),total:e.length}})}catch(a){return console.warn("[owner-preference] exposure capture failed (ignored):",a instanceof Error?a.message:a),!1}}function v(e){if(!(typeof e!="string"||e===""))return e.startsWith("wi:")?e.slice(3):e}async function L(){const{sql:e}=f(),[n,a]=await Promise.all([e`
      SELECT kind, subject_id, payload
        FROM harness_shared.owner_interactions
       WHERE kind IN ('grade', 'regrade')
         AND ts > now() - ${`${g} days`}::interval
       ORDER BY ts DESC
       LIMIT 2000`,e`
      SELECT payload
        FROM harness_shared.owner_interactions
       WHERE kind = 'queue-view'
         AND ts > now() - ${`${y} days`}::interval
       ORDER BY ts DESC
       LIMIT 1000`]),i=n.map(t=>v(_(t.payload)?.routedRef)),c=new Map;let p=0;for(const t of a){const r=_(t.payload),o=Array.isArray(r?.ids)?r.ids:[];for(const s of o)typeof s=="string"&&(c.set(s,(c.get(s)??0)+1),p+=1)}const E=[...new Set([...c.keys(),...i.filter(t=>!!t)])],d=new Map;if(E.length>0){const t=await e`
      SELECT issue_id, severity, scope
        FROM harness_shared.engineer_issues
       WHERE issue_id = ANY(${E})`;for(const r of t)d.set(r.issue_id,{severity:r.severity,scope:r.scope})}const w=n.map((t,r)=>{const o=i[r],s=o?d.get(o):void 0;return{kind:t.kind==="regrade"?"regrade":"grade",...o?{itemId:o}:{},...s?.severity?{severity:s.severity}:{},...s?.scope?{scope:s.scope}:{}}}),u=new Map;for(const[t,r]of c){const o=d.get(t);if(o)for(const s of D(o))u.set(s,(u.get(s)??0)+r)}return{engagements:w,exposureCountById:c,exposureCountByBucket:u,totalExposures:p}}var M,l,g,y,T=I((()=>{m(),k(),R(),h(),M=300*1e3,l=100,g=90,y=30}));T();export{L as readOwnerSignal,O as recordOwnerInteraction,C as recordQueueExposure};
