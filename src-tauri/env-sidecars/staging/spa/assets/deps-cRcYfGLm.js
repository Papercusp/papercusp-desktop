import{n as d}from"./chunk-ChpBd9eV.js";import{Q as u,st as c,t as l}from"./src-8fWtxfEz.js";import{c as f,r as o}from"./workspace-registry-Du2UbhlH.js";import{ot as I,st as D}from"./messages-33LAQAG-.js";import{D as y,k}from"./work-item-blocking-D8P-UbTl.js";import{i as N,r as v}from"./handoffs-D1lDZ1Bd.js";import{a as L,i as $}from"./escalations-BC3KNJwG.js";import{a as A,n as O}from"./external-blockers-Do8Nx6Qk.js";import{n as T,r as R}from"./plan-events-BDrEY48Q.js";import{i as b,r as C,t as M}from"./operator-conversations-C_RVvTBi.js";import{a as U,i as W}from"./sync-sse-VXiL_m-9.js";import{f as x,p as B}from"./compute-CRNLltCQ.js";import{i as F,o as H}from"./work-items-stale-claims-JRmtHGUv.js";async function P(t=p){const r=o(),s=Math.max(1,Math.floor(t)),e=await u(r,async n=>n`
      SELECT signal_id
        FROM harness_shared.operator_curation_log
       WHERE workspace_id = ${r}
         AND surfaced_at > now() - (${s}::bigint * interval '1 millisecond')
    `);return new Set(e.map(n=>n.signal_id))}async function Y(t,r){if(t.length===0)return;const s=o();await u(s,async e=>{for(const n of t)await e`
        INSERT INTO harness_shared.operator_curation_log
          (workspace_id, signal_id, kind, policy_version, title, surfaced_at)
        VALUES (${s}, ${n.id}, ${n.kind}, ${r}, ${n.title??null}, now())
        ON CONFLICT (workspace_id, signal_id) DO UPDATE
          SET surfaced_at = EXCLUDED.surfaced_at,
              kind = EXCLUDED.kind,
              policy_version = EXCLUDED.policy_version,
              title = EXCLUDED.title
      `})}async function X(t=m,r=200){if(t.length===0)return[];const s=o(),e=Math.max(1,Math.min(r,1e3));return(await u(s,async n=>n`
      SELECT o.signal_id, o.kind, o.title
        FROM harness_shared.operator_curation_log o
       WHERE o.workspace_id = ${s}
         AND o.kind = ANY(${t}::text[])
         AND NOT EXISTS (
           SELECT 1 FROM harness_shared.operator_curation_log c
            WHERE c.workspace_id = o.workspace_id
              AND c.signal_id = 'cleared:' || o.signal_id
              AND c.surfaced_at >= o.surfaced_at
         )
       ORDER BY o.surfaced_at DESC
       LIMIT ${e}
    `)).map(n=>({id:n.signal_id,kind:n.kind,title:n.title}))}var p,m,q=d((()=>{l(),f(),p=1440*60*1e3,m=["escalation","blocker"]}));async function K(t,r){const s=await C(),e=await M({conversationId:s.id,role:"assistant",text:t,source:"system",report:r??null});return U("operatorTurns.page",{conversationId:s.id}).catch(()=>{}),{conversationId:s.id,turnId:e.id}}var j=d((()=>{b(),W()}));function G(t){if(typeof t.summary=="string"&&t.summary.trim())return t.summary;const r=typeof t.plan_slug=="string"&&t.plan_slug?t.plan_slug:void 0,s=typeof t.detail=="string"&&t.detail?t.detail:void 0,e=typeof t.before=="string"&&t.before?t.before:void 0,n=typeof t.after=="string"&&t.after?t.after:void 0;if(!r&&!s&&!n)return"plan update";const a=`${r??"plan"}${s?` ${s}`:""}`;return n?`${a}: ${e&&e!==n?`${e} → ${n}`:n}`:`${a} updated`}var Q=d((()=>{}));async function V(){return(await L({status:"open"})).map(t=>({msgId:t.msg_id,severity:t.severity,summary:t.summary??"(escalation)",from:t.from,planSlug:t.plan_slug,ts:t.ts}))}async function z(){const t=o(),{sql:r}=c();return(await r`
    SELECT harness_slug, feature_id, title, summary, payload, updated_ts::text
      FROM harness_shared.work_items
     WHERE workspace_id = ${t}
       AND status = 'blocked'
     ORDER BY updated_ts DESC NULLS LAST
     LIMIT ${E}
  `).map(s=>{const e=O(s.payload),n=e.length>0?e.map(a=>a.summary).join("; "):s.summary?.trim()||"marked blocked";return{ref:`${s.harness_slug}#${s.feature_id}`,harness:s.harness_slug,title:s.title?.trim()||s.feature_id,reason:n,workItemId:s.feature_id,ts:s.updated_ts?new Date(Number(s.updated_ts)).toISOString():void 0}})}async function J(){const[t,r]=await Promise.all([y(),z()]),s=[];for(const[e,n]of t)s.push({ref:e,title:e,reason:`blocked by ${n.length} open issue${n.length===1?"":"s"}: ${n.join(", ")}`});return s.push(...r),s}async function Z(){const t=[],r=await N({status:"open"});for(const a of r){const i=a.record;!Array.isArray(i.to)||!i.to.includes("human")||t.push({id:`handoff:${i.msg_id}`,title:i.summary??"handoff",ref:`coord:handoff:${i.msg_id}`,ts:i.ts})}const s=o(),{sql:e}=c(),n=await e`
    SELECT harness_slug, feature_id, title, needs_design, updated_ts::text
      FROM harness_shared.harness_features_consolidated
     WHERE workspace_id = ${s}
       AND (needs_human_review = true OR (needs_design = true AND design_status = 'pending'))
       AND COALESCE(status, '') <> 'deprecated'
     ORDER BY updated_ts DESC NULLS LAST
     LIMIT 50
  `;for(const a of n)t.push({id:`review:${a.harness_slug}#${a.feature_id}`,harness:a.harness_slug,title:a.title??a.feature_id,detail:a.needs_design?"design review":"review",workItemId:a.feature_id,ref:`wi:${a.harness_slug}#${a.feature_id}`,ts:a.updated_ts?new Date(Number(a.updated_ts)).toISOString():new Date().toISOString()});return t}async function tt(){const t=o(),r=Date.now()-_,{sql:s}=c();return(await s`
    SELECT harness_slug, feature_id, title, created_by_github_user_id::text, updated_ts::text
      FROM harness_shared.work_items
     WHERE workspace_id = ${t}
       AND status = ANY(${[...g]}::text[])
       AND terminal_owner IS NOT NULL AND terminal_owner <> ''
       AND terminal_completion_ref IS NOT NULL AND terminal_completion_ref <> ''
       AND updated_ts IS NOT NULL
       AND updated_ts > ${r}
     ORDER BY updated_ts DESC
     LIMIT 50
  `).map(e=>({workItemId:`${e.harness_slug}#${e.feature_id}`,harness:e.harness_slug,title:e.title??e.feature_id,userRequested:e.created_by_github_user_id!=null,ref:`wi:${e.harness_slug}#${e.feature_id}`,ts:e.updated_ts?new Date(Number(e.updated_ts)).toISOString():new Date().toISOString()}))}async function et(){const t=Date.now()-_,r=await R({events:["item_status_changed"],filesBack:1}),s=[];for(const e of r){const n=typeof e.ts=="string"?e.ts:new Date().toISOString(),a=Date.parse(n);if(Number.isFinite(a)&&a<t)continue;const i=typeof e.plan_slug=="string"?e.plan_slug:void 0,w=G(e);s.push({id:`plan-event:${e.msg_id}`,title:w,ref:i?`plan:${i}`:void 0,ts:n})}return s.slice(0,25)}function st(t){const r=new Date(t.evaluatedAt).toISOString(),s=[];for(const e of Object.values(t.panels))e.ack||e.status!=="warn"&&e.status!=="crit"||s.push({panelId:e.key,status:e.status,label:e.label,summary:e.summary,ts:r});return s}async function at(){const t=await x();return t?st(t):[]}async function nt(){const t=o(),{sql:r}=c(),s=await r`
    SELECT harness_slug, feature_id, title, taken_by, updated_ts::text
      FROM harness_shared.work_items
     WHERE workspace_id = ${t}
       AND taken_by IS NOT NULL AND taken_by <> ''
       AND status <> ALL(${F}::text[])
     ORDER BY updated_ts DESC NULLS LAST
     LIMIT ${h}
  `;if(s.length===0)return[];const e=await D([...new Set(s.map(a=>a.taken_by))].map(a=>({ownerId:a})),{hydratePerId:!0}),n=[];for(const a of s)e.get(a.taken_by)?.sessionState==="ended"&&n.push({ref:`${a.harness_slug}#${a.feature_id}`,harness:a.harness_slug,title:a.title?.trim()||a.feature_id,holder:a.taken_by,workItemId:a.feature_id,ts:a.updated_ts?new Date(Number(a.updated_ts)).toISOString():void 0});return n.slice(0,S)}function rt(){return{escalations:V,blocked:J,decisions:Z,completions:tt,progress:et,health:at,deadClaims:nt}}function It(){return{readers:rt(),loadSurfaced:t=>P(t),recordSurfaced:(t,r)=>Y(t,r),surface:(t,r)=>K(t,r),loadOpenRecoverable:()=>X()}}var _,g,E,h,S,Dt=d((()=>{l(),f(),$(),v(),T(),k(),A(),q(),j(),Q(),B(),I(),H(),_=1440*60*1e3,g=["done","passed","resolved","closed"],E=50,h=200,S=50}));export{st as i,rt as n,Dt as r,It as t};
