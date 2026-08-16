const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/src-DVvNgMXY.js","assets/src-8fWtxfEz.js","assets/chunk-ChpBd9eV.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/src-6Py4l2MU.js","assets/drizzle-orm-BbO4Lkx2.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js"])))=>i.map(i=>d[i]);
import{n as S}from"./chunk-ChpBd9eV.js";import{n as f,t as p}from"./preload-helper-CcgcQsTF.js";async function g(t){const r=t.windowHours??24,{getOrgPg:a}=await p(async()=>{const{getOrgPg:n}=await import("./src-DVvNgMXY.js");return{getOrgPg:n}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10])),e=a().sql,s=[...m],l=await e`
    SELECT source_kind AS client, count(DISTINCT session_id)::int AS sessions
      FROM harness_shared.session_turns
     WHERE workspace_id = ${O}
       AND source_kind = ANY(${s})
       AND ts > now() - (${r}::text || ' hours')::interval
     GROUP BY 1
  `;return{windowHours:r,...R({clients:s,windowRows:await e`
    SELECT client, port, outcome, tool, sum(n)::int AS n
      FROM harness_shared.context_injection_coverage
     WHERE workspace_id = ${t.workspaceId}
       AND day >= (now() - (${r}::text || ' hours')::interval)::date
     GROUP BY 1, 2, 3, 4
  `,everRows:await e`
    SELECT DISTINCT client, port
      FROM harness_shared.context_injection_coverage
     WHERE workspace_id = ${t.workspaceId}
  `,sessionsBy:new Map(l.map(n=>[n.client,Number(n.sessions)||0]))})}}function R(t){const r=new Set(t.everRows.map(e=>`${e.client}\0${e.port}`)),a=t.clients.map(e=>{const s=_(),l=[];let n=0;const w=E.map(i=>{const c=_(),d=[];let u=0;for(const o of t.windowRows){if(o.client!==e||o.port!==i)continue;const v=Number(o.n)||0;u+=v,o.outcome in c&&(c[o.outcome]+=v),o.outcome==="unknown-tool"&&o.tool&&d.push(o.tool)}n+=u;for(const o of Object.keys(c))s[o]+=c[o];return l.push(...d),{port:i,events:u,byOutcome:c,driftTools:[...new Set(d)].sort(),everObserved:r.has(`${e}\0${i}`)}});return{client:e,sessions:t.sessionsBy.get(e)??0,events:n,byOutcome:s,driftTools:[...new Set(l)].sort(),everObserved:w.some(i=>i.everObserved),ports:w}});return{clients:a,totalEvents:a.reduce((e,s)=>e+s.events,0)}}var E,m,O,_,T=S((()=>{f(),E=["turn-start","mid-turn"],m=["claude","codex","omp"],O="default",_=()=>({recalled:0,"no-recall":0,"no-signal":0,"unknown-tool":0})}));T();export{g as readInjectionDeliveryCoverage};
