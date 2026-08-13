import{n as f}from"./chunk-ChpBd9eV.js";import{Q as m,t as b}from"./src-BmBNODK0.js";import{c as L,r as w}from"./workspace-registry-Du2UbhlH.js";import{i as y,r as x}from"./fleet-signals-B1nDJkLo.js";import{l as U,n as q,o as F,r as j,u as P}from"./salience-policy-DCgwNZv8.js";function B(t){return t.slice(0,8)}function H(t){return t&&t.replace(S,n=>B(n)).replace(E,"$1").replace(D,"").replace(A,"$1")}var S,E,D,A,G=f((()=>{S=/\bsu-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,E=/\b(su-[0-9a-f]{5,8})\s*\(\1\)/g,D=/\s*\(system:[a-z0-9][a-z0-9:._-]*\)/g,A=/\b(?:packages|apps|libs|scripts)\/(?:[A-Za-z0-9._-]+\/)*([A-Za-z0-9._-]+\.(?:tsx?|mts|cts|mjs|cjs|jsx?|sql|css|md))\b/g}));function $(t,n=Date.now){const{signal:e}=t;let a=`**${R[e.kind]??e.kind}**${e.harness?` [${e.harness}]`:""}${e.kind==="completion"&&e.userRequested?" (you asked for this)":""} — ${e.title}`;e.detail&&(a+=` · ${e.detail}`);const i=j(e,n());return i&&(a+=` · ${i}`),H(a)}function K(t,n=Date.now){let e=`${v[t.signal.kind]??"•"} ${$(t,n)}`;return t.signal.ref&&(e+=` · drill in: \`${t.signal.ref}\``),e}function k(t,n=Date.now){return{text:$(t,n),status:T[t.signal.kind]??t.signal.kind,...typeof t.signal.ref=="string"&&t.signal.ref.trim()?{ref:t.signal.ref}:{}}}function Q(t,n=Date.now){return{plans:[{title:"Fleet status",items:t.map(e=>k(e,n))}]}}function V(t,n=Date.now){return{title:C(t).split(`
`)[0]??"📋 Fleet update",plans:[{title:"Recent",items:t.slice(0,I).map(e=>k(e,n))}]}}function W(t,n=Date.now){return t.map(e=>K(e,n)).join(`
`)}function C(t){const n=new Map;for(const r of t)n.set(r.signal.kind,(n.get(r.signal.kind)??0)+1);const e=[],a=n.get("progress")??0,i=n.get("completion")??0;a&&e.push(`${a} item${a===1?"":"s"} progressed`),i&&e.push(`${i} completed`);const s=n.get("health")??0;s&&e.push(`${s} health warning${s===1?"":"s"}`);for(const[r,o]of n)r==="progress"||r==="completion"||r==="health"||e.push(`${o} ${r}`);return[`📋 Fleet update — ${e.join(" · ")||`${t.length} updates`}`,...t.slice(0,3).map(r=>`· ${r.signal.title}`)].join(`
`)}function z(t,n,e=Date.now){const a=new Date(e()).toISOString(),i=[];for(const s of n)t.has(s.id)||i.push({id:`cleared:${s.id}`,kind:"cleared",title:s.title??s.id,ref:s.id,ts:a});return i}async function ot(t,n={}){const e=await x(t.readers),a=await t.loadSurfaced(t.windowMs),i=t.loadOpenRecoverable?await t.loadOpenRecoverable():[],s=z(new Set(e.map(c=>c.id)),i,t.now),r=s.length>0?[...e,...s]:e,{surfaceNow:o,batch:l,hasUrgent:O}=P(r,F(r,{alreadySurfaced:a})),M=typeof n.canEmitDigest=="function"?n.canEmitDigest(l.length):n.canEmitDigest??!0,d=[],_=[];if(o.length>0){const c=W(o,t.now??Date.now);await t.surface(c,Q(o,t.now??Date.now)),d.push(c);for(const u of o)_.push({id:u.signal.id,kind:u.signal.kind,title:u.signal.title})}let g=!1,p=0,h=0;if(l.length>0)if(M){const c=C(l);await t.surface(c,V(l,t.now??Date.now)),d.push(c),g=!0,p=l.length;for(const u of l)_.push({id:u.signal.id,kind:u.signal.kind,title:u.signal.title})}else h=l.length;return _.length>0&&await t.recordSurfaced(_,q),{surfacedCount:o.length,batchedCount:p,deferredBatchCount:h,digestEmitted:g,hasUrgent:O,messages:d}}function lt(t,n){if(n)return 120;const e=Math.round((t||120)*1.5);return Math.min(900,Math.max(120,e))}function ct(t,n,e){return t==null?!0:e-t>=Math.max(1,n)*1e3}function ut(t,n,e){return n<=0?!1:n>=8||t==null?!0:e-t>=300*1e3}var X,Y,Z,J,v,R,T,I,tt=f((()=>{U(),y(),G(),X=120,Y=900,Z=300,J=8,v={escalation:"⚠",blocker:"🚧",decision:"❓",completion:"✓",progress:"·",health:"🩺",cleared:"✓"},R={escalation:"Escalation",blocker:"Blocked",decision:"Decision needed",completion:"Done",progress:"Progress",health:"System health",cleared:"Cleared"},T={escalation:"blocked",blocker:"blocked",decision:"needs-human",completion:"done",progress:"wip",health:"failing",cleared:"resolved"},I=20}));async function _t(){const t=w(),n=await m(t,async a=>a`
      SELECT last_run_at::text, last_digest_at::text, current_interval_seconds,
             consecutive_quiet, last_surfaced_count
        FROM harness_shared.operator_curation_state
       WHERE workspace_id = ${t}
       LIMIT 1
    `);if(!n.length)return{...N};const e=n[0];return{lastRunAtMs:e.last_run_at?new Date(e.last_run_at).getTime():null,lastDigestAtMs:e.last_digest_at?new Date(e.last_digest_at).getTime():null,currentIntervalSeconds:Number(e.current_interval_seconds)||120,consecutiveQuiet:Number(e.consecutive_quiet)||0,lastSurfacedCount:Number(e.last_surfaced_count)||0}}async function dt(t){const n=w(),e=t.lastRunAtMs!=null?new Date(t.lastRunAtMs).toISOString():null,a=t.lastDigestAtMs!=null?new Date(t.lastDigestAtMs).toISOString():null,i=t.currentIntervalSeconds??null,s=t.consecutiveQuiet??null,r=t.lastSurfacedCount??null;await m(n,async o=>{await o`
      INSERT INTO harness_shared.operator_curation_state
        (workspace_id, last_run_at, last_digest_at, current_interval_seconds,
         consecutive_quiet, last_surfaced_count, updated_at)
      VALUES (
        ${n},
        ${e},
        ${a},
        ${i??120},
        ${s??0},
        ${r??0},
        now()
      )
      ON CONFLICT (workspace_id) DO UPDATE SET
        last_run_at = COALESCE(${e}, harness_shared.operator_curation_state.last_run_at),
        last_digest_at = COALESCE(${a}, harness_shared.operator_curation_state.last_digest_at),
        current_interval_seconds = COALESCE(${i}, harness_shared.operator_curation_state.current_interval_seconds),
        consecutive_quiet = COALESCE(${s}, harness_shared.operator_curation_state.consecutive_quiet),
        last_surfaced_count = COALESCE(${r}, harness_shared.operator_curation_state.last_surfaced_count),
        updated_at = now()
    `})}var N,ft=f((()=>{b(),L(),tt(),N={lastRunAtMs:null,lastDigestAtMs:null,currentIntervalSeconds:120,consecutiveQuiet:0,lastSurfacedCount:0}}));export{tt as a,ct as c,ut as i,_t as n,lt as o,dt as r,ot as s,ft as t};
