import{n as A}from"./chunk-ChpBd9eV.js";import{a as E,i as S,o as g,t as I}from"./log-CmoS19XU.js";import{t as k,u as w}from"./work-item-dispatch-states-jkwfzC7Z.js";import{a as d,r as L}from"./agent-goal-ref-B7R7aDLX.js";import{N as R,j as T}from"./store-sTftUd-1.js";import{n as y,r as h}from"./claim-holder-D59tNrAt.js";async function c(r,a){const n=(r??"").trim();if(!n||!I())return{candidates:{},planItems:[]};const e=S(),s=E(),t=async(f,p)=>{try{return await f()}catch{return p}},[i,l,m,u]=await Promise.all([t(()=>D(e,s,n),[]),t(()=>v(e,s,n,a),[]),t(()=>N(e,s,n),null),t(()=>O(n),null)]);return{candidates:{override:u,workItems:i,planItems:l,fleet:m,links:await t(()=>$(e,s,i,l),[])},planItems:l}}async function D(r,a,n){return(await r`
    SELECT feature_id AS id, taken_at::text AS taken_at
      FROM harness_shared.work_items
     WHERE workspace_id = ${a}
       AND taken_by = ${n}
       AND status <> ALL(${_})
     ORDER BY taken_at DESC NULLS LAST
     LIMIT ${20}`).filter(e=>e.id).map(e=>({id:e.id,takenAt:e.taken_at}))}async function v(r,a,n,e){const s=e==="self";return(await r`
    SELECT plan_slug, item_id, acquired_ts::text AS acquired_ts, intent,
           (expires_ts > clock_timestamp()) AS lease_valid
      FROM harness_shared.plan_item_claims
     WHERE workspace_id = ${a}
       AND owner = ${n}
       AND (${s} OR expires_ts > clock_timestamp())
     ORDER BY (expires_ts > clock_timestamp()) DESC,
              last_activity_ts DESC NULLS LAST,
              item_id ASC
     LIMIT ${20}`).filter(t=>t.plan_slug&&t.item_id).map(t=>({planSlug:t.plan_slug,itemId:t.item_id,acquiredTs:t.acquired_ts,intent:t.intent,leaseValid:s?t.lease_valid!==!1:void 0}))}async function N(r,a,n){const e=(await r`
    SELECT fleet_slug, event, at::text AS at
      FROM harness_shared.fleet_membership_events
     WHERE workspace_id = ${a}
       AND owner_id = ${n}
     ORDER BY at DESC, id DESC
     LIMIT 1`)[0];return!e?.fleet_slug||e.event==="leave"?null:{slug:e.fleet_slug,joinedAt:e.at}}async function O(r){const a=(await T([{scope:"owner",scopeRef:r}],{limitPerSelector:1,keyPrefixes:[o],audiences:"all"})).find(n=>n.key===o);return a?.body?.trim()?{ref:a.body.trim(),declaredAt:a.updatedAt??null}:null}async function $(r,a,n,e){const s=n.map(t=>t.id).filter(Boolean);return s.length===0||e.length===0?[]:(await r`
    SELECT src_ref, dst_ref
      FROM harness_shared.coord_links
     WHERE workspace_id = ${a}
       AND dst_kind = 'plan_item'
       AND rel = 'implements'
       AND src_ref = ANY(${s})`).filter(t=>t.src_ref&&t.dst_ref).map(t=>({workItemId:t.src_ref,planItemRef:t.dst_ref}))}async function P(r,a){try{return d((await c(r,a)).candidates)}catch{return null}}async function W(r){try{const{candidates:a,planItems:n}=await c(r,"peer"),e=d(a);if(!e)return null;const s=e.source==="plan-item"?e.ref:e.corroboratedBy,t=s?n.find(i=>`${i.planSlug}#${i.itemId}`===s):void 0;return{itemId:e.ref,intent:t?y(t.intent,t.itemId).goalText:null,acquiredTs:e.declaredAt,agreement:e.agreement,competing:e.competing}}catch{return null}}var o,_,M,Y=A((()=>{L(),g(),R(),h(),w(),o="goal.override",_=k,M=20}));export{P as i,W as n,Y as r,o as t};
