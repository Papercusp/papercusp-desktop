const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/operator-home-harness-BzEDWrC0.js","assets/operator-home-harness-MSlRvOkW.js","assets/chunk-ChpBd9eV.js"])))=>i.map(i=>d[i]);
import{n as f}from"./chunk-ChpBd9eV.js";import{n as p,t as h}from"./preload-helper-CcgcQsTF.js";import{r as v,t as w}from"./coordination-event-log-browser-s_EyGDm7.js";function E(t,n={}){const o=n.minSettled??5,a=n.degenerateRatePct??10,r=[];for(const e of t){const s=e.fired_event+e.fired_timeout;if(s<o)continue;const i=Math.round(e.fired_event/s*1e3)/10;i>a||r.push({eventKey:e.event_key,fired:e.fired_event,timedOut:e.fired_timeout,settled:s,pctRealFire:i})}return r.sort((e,s)=>e.pctRealFire-s.pctRealFire||s.settled-e.settled),r}async function m(t,n,o,a=d){const r=[];for(const e of n){const s=a.find(c=>c.matches(e.eventKey));if(!s){r.push({...e,verdict:"suspect",witness:null});continue}const i=await s.check(t,e.eventKey,o);i?.occurred?r.push({...e,verdict:"convicted",witness:{name:s.name,owner:s.owner,evidence:i.evidence}}):r.push({...e,verdict:"suspect",witness:null})}return r}async function g(t,n){return await t`
    SELECT event_key,
           count(*) FILTER (WHERE fired_reason = 'event')::int   AS fired_event,
           count(*) FILTER (WHERE fired_reason = 'timeout')::int AS fired_timeout
    FROM harness_shared.event_awaits
    WHERE workspace_id = ${w}
      AND fired_at >= now() - ${`${Math.round(n/1e3)} seconds`}::interval
      AND fired_reason IN ('event', 'timeout')
    GROUP BY event_key
  `}async function W(t,n={}){const o=n.sinceMs??6048e5;return m(t,E(await g(t,o),n),o,n.witnesses??d)}var l,d,A=f((()=>{v(),p(),l={name:"green-checkpoint-pipeline-events",owner:"apps/operator/lib/release/green-checkpoint.ts",matches:t=>t==="release:green"||t.startsWith("release:green:")||t==="green-checkpoint:red"||t.startsWith("green-checkpoint:red:"),async check(t,n,o){const a=n.startsWith("release:green"),r=a?["advanced","advanced-prefix"]:["not-green"],e=n.includes(":",a?13:20)?n.slice(n.lastIndexOf(":")+1):null;try{const{operatorHomeHarnessSlug:s}=await h(async()=>{const{operatorHomeHarnessSlug:_}=await import("./operator-home-harness-BzEDWrC0.js");return{operatorHomeHarnessSlug:_}},__vite__mapDeps([0,1,2])),i=e??s(),c=await t`
        SELECT count(*)::int AS n, max(created_at) AS latest
        FROM harness_shared.pipeline_events
        WHERE kind = 'green_checkpoint'
          AND install_slug = ${i}
          AND status = ANY(${r}::text[])
          AND created_at >= now() - ${`${Math.round(o/1e3)} seconds`}::interval
      `,u=c[0]?.n??0;return u===0?{occurred:!1,evidence:`no ${r.join("/")} pipeline_events row for install_slug=${i} in the window`}:{occurred:!0,evidence:`${u} ${r.join("/")} pipeline_events row(s) for install_slug=${i} in the window (latest ${c[0]?.latest}) — the verdict was produced independently of the await log`}}catch{return null}}},d=[l]}));export{A as n,W as t};
