import{n as p}from"./chunk-ChpBd9eV.js";import{a as u,i as _,o as y,t as A}from"./log-CmoS19XU.js";function f(n,e){if(!n||typeof n!="object"||Array.isArray(n))return null;const s=n,r=i(s.itemId),t=i(s.member);if(!r||!t||!Number.isFinite(e.atMs)||e.atMs<=0)return null;const o=typeof s.specRevision=="number"&&Number.isFinite(s.specRevision)?s.specRevision:null;return{itemId:r,member:t,specId:i(s.specId),specRevision:o,code:i(s.code),action:a(s.action,160),reason:a(s.reason),msgId:e.msgId,atMs:e.atMs,occurrences:1,dependencyEscape:l(s.dependencyEscape)}}function b(n,e=20){const s=new Map;for(const r of n){const t=`${r.itemId}\0${r.member}`,o=s.get(t);if(!o){s.set(t,{...r});continue}o.occurrences+=1,r.atMs>o.atMs&&s.set(t,{...r,occurrences:o.occurrences})}return[...s.values()].sort((r,t)=>t.atMs-r.atMs).slice(0,e)}async function g(n,e={}){if(!n||!A())return[];try{const s=(e.nowMs??Date.now())-(e.lookbackMs??864e5),r=await _()`
      SELECT e.body->>'msg_id' AS msg_id,
             (extract(epoch FROM (e.body->>'ts')::timestamptz) * 1000)::bigint AS ts_ms,
             e.body->${c} AS stamp
        FROM harness_shared.coord_event_log e
       WHERE e.workspace_id = ${u()}
         AND e.surface = 'messages'
         AND e.body->>'category' = ${m}
         AND e.body ? ${c}
         AND jsonb_typeof(e.body->'audience') = 'array'
         AND e.body->'audience' ? ${`@fleet-leader:${n}`}
         AND (e.body->>'ts')::timestamptz >= to_timestamp(${s}::double precision / 1000)
       ORDER BY (e.body->>'ts')::timestamptz DESC
       LIMIT ${e.scanCap??200}`,t=[];for(const o of r){const d=f(o.stamp,{msgId:String(o.msg_id??""),atMs:Number(o.ts_ms)});d&&t.push(d)}return b(t,e.rowCap??20)}catch{return[]}}var m,c,I,M,E,a,i,l,O=p((()=>{y(),m="fleet-scope-admission",c="fleetAdmissionBlock",I=24*3600*1e3,M=200,E=20,a=(n,e=240)=>{if(typeof n!="string")return null;const s=n.trim();return s?s.length>e?`${s.slice(0,e-1)}…`:s:null},i=n=>{if(typeof n!="string")return null;const e=n.trim();return e||null},l=n=>{if(!n||typeof n!="object"||Array.isArray(n))return null;const e=n,s=e.dependency,r=(Array.isArray(e.routes)?e.routes:[]).map(t=>t&&typeof t=="object"&&!Array.isArray(t)?t.kind:null);return e.kind!=="dependency_escape"||e.ownershipPreserved!==!0||!i(s?.id)||!i(s?.kind)||!i(e.member)||!Array.isArray(e.blockedHeldItemIds)||e.blockedHeldItemIds.length===0||!e.blockedHeldItemIds.every(t=>!!i(t))||!r.includes("spec_widen")||!r.includes("outside_lane_placement")||!r.includes("leader_claim")?null:n}}));export{g as a,b as i,I as n,O as o,c as r,f as s,m as t};
