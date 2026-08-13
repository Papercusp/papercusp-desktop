import{n as u}from"./chunk-ChpBd9eV.js";import{a as _,i as l,o as p,t as f}from"./log-BwQLkm9I.js";function A(t,s){if(!t||typeof t!="object"||Array.isArray(t))return null;const e=t,o=i(e.itemId),n=i(e.member);if(!o||!n||!Number.isFinite(s.atMs)||s.atMs<=0)return null;const r=typeof e.specRevision=="number"&&Number.isFinite(e.specRevision)?e.specRevision:null;return{itemId:o,member:n,specId:i(e.specId),specRevision:r,code:i(e.code),action:a(e.action,160),reason:a(e.reason),msgId:s.msgId,atMs:s.atMs,occurrences:1}}function b(t,s=20){const e=new Map;for(const o of t){const n=`${o.itemId}\0${o.member}`,r=e.get(n);if(!r){e.set(n,{...o});continue}r.occurrences+=1,o.atMs>r.atMs&&e.set(n,{...o,occurrences:r.occurrences})}return[...e.values()].sort((o,n)=>n.atMs-o.atMs).slice(0,s)}async function O(t,s={}){if(!t||!f())return[];try{const e=(s.nowMs??Date.now())-(s.lookbackMs??864e5),o=await l()`
      SELECT e.body->>'msg_id' AS msg_id,
             (extract(epoch FROM (e.body->>'ts')::timestamptz) * 1000)::bigint AS ts_ms,
             e.body->${c} AS stamp
        FROM harness_shared.coord_event_log e
       WHERE e.workspace_id = ${_()}
         AND e.surface = 'messages'
         AND e.body->>'category' = ${d}
         AND e.body ? ${c}
         AND jsonb_typeof(e.body->'audience') = 'array'
         AND e.body->'audience' ? ${`@fleet-leader:${t}`}
         AND (e.body->>'ts')::timestamptz >= to_timestamp(${e}::double precision / 1000)
       ORDER BY (e.body->>'ts')::timestamptz DESC
       LIMIT ${s.scanCap??200}`,n=[];for(const r of o){const m=A(r.stamp,{msgId:String(r.msg_id??""),atMs:Number(r.ts_ms)});m&&n.push(m)}return b(n,s.rowCap??20)}catch{return[]}}var d,c,M,y,I,a,i,g=u((()=>{p(),d="fleet-scope-admission",c="fleetAdmissionBlock",M=24*3600*1e3,y=200,I=20,a=(t,s=240)=>{if(typeof t!="string")return null;const e=t.trim();return e?e.length>s?`${e.slice(0,s-1)}…`:e:null},i=t=>{if(typeof t!="string")return null;const s=t.trim();return s||null}}));export{O as a,b as i,M as n,g as o,c as r,A as s,d as t};
