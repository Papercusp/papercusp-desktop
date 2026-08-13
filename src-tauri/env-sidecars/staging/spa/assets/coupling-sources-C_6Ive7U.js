import{n as _}from"./chunk-ChpBd9eV.js";import{a as y,i as h,o as w,t as g}from"./log-BwQLkm9I.js";import{S as p,d as S}from"./source-Ca8i7FlY.js";import{l as b,o as k}from"./presence-snapshot-BvAUorfj.js";async function I(r){const o=r.trim();if(!o||!g())return[];try{const i=h(),s=new Date(Date.now()-u).toISOString(),c=await i`
      SELECT body->>'from' AS from_owner, body->'to' AS to_owners
        FROM harness_shared.coord_event_log
       WHERE workspace_id = ${y()}
         AND surface = 'messages'
         AND ts >= ${s}
         AND jsonb_typeof(body->'to') = 'array'
         AND (body->>'from' = ${o} OR jsonb_exists(body->'to', ${o}))
       ORDER BY ts DESC
       LIMIT ${300}
    `,n=new Set;for(const e of c){const d=(e.from_owner??"").trim(),m=Array.isArray(e.to_owners)?e.to_owners:[],l=[];let f=!1;for(const t of m){const a=typeof t=="string"?t.trim():"";if(a){if(a==="*"||a==="human"||a.startsWith("@")){f=!0;continue}l.push(a)}}if(!f)if(d===o)for(const t of l)t!==o&&n.add(t);else d&&l.includes(o)&&n.add(d)}return[...n]}catch{return[]}}async function A(r,o){const i=r.trim();if(!i)return[];try{const s=await p(i,{...o.harnessSlug?{harnessSlug:o.harnessSlug}:{},...o.workspaceId?{workspaceId:o.workspaceId}:{}});if(!s)return[];const c=s.row.items.length>0?s.row.items.map(e=>({id:e.id,blockedBy:Array.isArray(e.blockedBy)?e.blockedBy??[]:[]})):s.parsed.items.map(e=>({id:e.id,blockedBy:e.blockedBy??[]})),n=[];for(const e of c)e.id&&e.blockedBy.length>0&&n.push({item:e.id,blockedBy:e.blockedBy});return n}catch{return[]}}function O(r){return!!r.include_detail||!!r.include_coupling}function C(r){return{heldFiles:async()=>k(r.rosterOwnerIds,r.coordinationDomain??null),planEdges:o=>A(o,{harnessSlug:r.harnessSlug,workspaceId:r.workspaceId}),recentPartners:()=>I(r.selfOwnerId)}}var u,E,R=_((()=>{b(),w(),S(),u=1800*1e3,E=300}));export{I as a,A as i,u as n,R as o,C as r,O as s,E as t};
