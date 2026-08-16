import{n as T}from"./chunk-ChpBd9eV.js";import{n as w,r as S}from"./types-C_wWI2EW.js";import{st as d,t as I}from"./src-8fWtxfEz.js";function N(i,s){if(!i)return[];const o=[];for(const a of w){const t=s.panels[a],l=i.panels?.[a];!t||!l||l.status!==t.status&&o.push({panel:a,from:l.status,to:t.status,summary:t.summary??null})}return o}async function L(i,s){const{sql:o}=d(),a={};for(const n of w){const u=s.panels[n];u&&(a[n]=u.status)}const t=new Date(s.evaluatedAt).toISOString();await o`
    INSERT INTO harness_shared.system_health_ticks (workspace_id, at, overall, statuses)
    VALUES (${s.workspaceId}, ${t}, ${s.overall}, ${JSON.stringify(a)}::text::jsonb)
    ON CONFLICT (workspace_id, at) DO NOTHING`;const l=N(i,s);for(const n of l)await o`
      INSERT INTO harness_shared.system_health_transitions
        (workspace_id, panel, from_status, to_status, summary, at)
      VALUES (${s.workspaceId}, ${n.panel}, ${n.from}, ${n.to},
              ${n.summary?n.summary.slice(0,500):null}, ${t})`;Math.random()<1/R&&(await o`DELETE FROM harness_shared.system_health_ticks
               WHERE at < now() - make_interval(days => ${f})`,await o`DELETE FROM harness_shared.system_health_transitions
               WHERE at < now() - make_interval(days => ${f})`)}function $(i){const{workspaceId:s,now:o,windowMs:a,bucketMs:t,ticks:l,transitions:n}=i,u=Math.max(1,Math.round(a/t)),e=o-a,E={},m=new Array(u).fill(null),p=(r,c)=>r===null||h[c]>h[r]?c:r;for(const r of l){const c=Math.floor((r.at-e)/t);if(!(c<0||c>=u)){m[c]=p(m[c],r.overall);for(const[k,O]of Object.entries(r.statuses)){const y=E[k]??=new Array(u).fill(null);y[c]=p(y[c],O)}}}const _={};for(const r of n)_[r.panel]===void 0&&(_[r.panel]=r.at);return{workspaceId:s,windowMs:a,bucketMs:t,strips:E,overallStrip:m,since:_,transitions:n}}async function g(i,s=1440*6e4,o=30*6e4){const{sql:a}=d(),t=Date.now(),l=new Date(t-s).toISOString(),[n,u]=await Promise.all([a`
      SELECT at, overall, statuses
        FROM harness_shared.system_health_ticks
       WHERE workspace_id = ${i} AND at >= ${l}
       ORDER BY at ASC`,a`
      SELECT panel, from_status, to_status, summary, at
        FROM harness_shared.system_health_transitions
       WHERE workspace_id = ${i} AND at >= ${l}
       ORDER BY at DESC
       LIMIT 300`]);return $({workspaceId:i,now:t,windowMs:s,bucketMs:o,ticks:n.map(e=>({at:new Date(e.at).getTime(),overall:e.overall,statuses:e.statuses??{}})),transitions:u.map(e=>({panel:e.panel,from:e.from_status,to:e.to_status,summary:e.summary,at:new Date(e.at).getTime()}))})}var f,R,h,D=T((()=>{I(),S(),f=14,R=50,h={unknown:0,ok:1,warn:2,crit:3}}));D();export{$ as buildHealthHistory,N as diffHealthTransitions,g as readSystemHealthHistory,L as recordHealthHistory};
