const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/harness-registry-DuxxIfCX.js","assets/harness-registry-Dmj_75ju.js","assets/chunk-CMxvf4Kt.js","assets/preload-helper-B_k_wMTD.js","assets/src-CRqYcphb.js","assets/node-module-browser-BIpJATUS.js","assets/postgres-browser-zd-i1BMX.js","assets/resource-profile-CXmc9pS7.js","assets/__vite-browser-external-CM3Eme-n.js","assets/zod-Dj7LUnxx.js","assets/core-dwh4Ocgd.js","assets/operator-state-pg-fVlIOz6P.js","assets/db-encryption-Cexy6VC7.js","assets/workspace-registry-Bu1Yy540.js","assets/workspace-als-DigME466.js","assets/async-hooks-browser-DZKl_0H0.js","assets/workspace-id-constant-E7VkkAiJ.js","assets/wake-6n07Db2Y.js","assets/carry-note-_Ny4-AR-.js","assets/coordination-event-log-browser-Dq_4i-_C.js","assets/wake-B5PEncfY.js","assets/src-CXfdPlCB.js","assets/cron-wBe2AScZ.js","assets/registry-PEJRQ9wB.js","assets/src-DS6stHeO.js","assets/src-C0H6dNEO.js","assets/operator-home-harness-CAu4fYEf.js","assets/workspace-brain-scope-CB6nVQ7N.js","assets/server-WINkLZx9.js","assets/types-DWFvb24U.js","assets/src-CufTLG1h.js","assets/flag-distinct-id-BZ5cCTSq.js"])))=>i.map(i=>d[i]);
import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./preload-helper-B_k_wMTD.js";import{J as r,t as i}from"./src-CRqYcphb.js";import{i as a,n as o,r as s,t as c}from"./workspace-brain-scope-CB6nVQ7N.js";async function l(e,t,n){let{sql:i}=r();await i`
    INSERT INTO harness_shared.operator_settings (key, value, description, updated_at, workspace_id)
    VALUES (
      ${C(e,t)},
      ${n?`true`:`false`},
      ${`Pause provenance (WI-3261). true = the CURRENT pause was owner-initiated (pot:pause) — the paused-pot recovery watchdog must never auto-resume it, only alert. Cleared on every resume.`},
      ${Date.now()},
      ${e}
    )
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `}async function u(e,t){let{sql:n}=r(),i=await o();for(let r of s(e,t,i)){let t=(await n`
      SELECT value FROM harness_shared.operator_settings WHERE key = ${x(e,r)} LIMIT 1`)[0]?.value;if(t!=null)return t===`true`}return!1}async function d(e,t,n,i={}){let{sql:s}=r(),c=a(e,t,await o());await s`
    INSERT INTO harness_shared.operator_settings (key, value, description, updated_at, workspace_id)
    VALUES (
      ${x(e,c)},
      ${n?`true`:`false`},
      ${`Start/Pause Pot state (start-pot-wake P-004 / D-006). true = the colony should be running; the watchdog holds the liveness invariant only while true.`},
      ${Date.now()},
      ${e}
    )
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `,await l(e,c,n?!1:i.deliberate??!1)}async function f(e,t){let{sql:n}=r();return(await n`
    SELECT value FROM harness_shared.operator_settings WHERE key = ${x(e,t)} LIMIT 1`)[0]?.value===`true`}async function p(e,t,n,i={}){let{sql:a}=r();await a`
    INSERT INTO harness_shared.operator_settings (key, value, description, updated_at, workspace_id)
    VALUES (
      ${x(e,t)},
      ${n?`true`:`false`},
      ${`Per-pot Start/Stop placement bit (per-pot start-stop 2026-06-30). true = this pot's work is placed by the workspace Mug.`},
      ${Date.now()},
      ${e}
    )
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `,await l(e,t,n?!1:i.deliberate??!1)}async function m(e,t){let r=(await h()).filter(n=>n.workspaceId===e&&n.installSlug!==e&&n.installSlug!==t);if(r.length===0)return!1;try{let{loadHarnessRegistry:t}=await n(async()=>{let{loadHarnessRegistry:e}=await import(`./harness-registry-DuxxIfCX.js`);return{loadHarnessRegistry:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16])),i=await t(e),a=new Set(i.projects.filter(e=>e.harness_kind===`hive`).map(e=>e.slug));return r.some(e=>a.has(e.installSlug))}catch{return r.length>0}}async function h(){let{sql:e}=r(),t=await e`
    SELECT key FROM harness_shared.operator_settings
    WHERE key LIKE ${`hive_started:%`} AND value = 'true'
  `,n=[];for(let e of t){let t=e.key.slice(13),r=t.indexOf(`:`);r<=0||n.push({workspaceId:t.slice(0,r),installSlug:t.slice(r+1)})}return n}async function g(){return h()}async function _(){let e=await h();if(!await o())return e;let{resolvePotHomeSlug:t}=await n(async()=>{let{resolvePotHomeSlug:e}=await import(`./wake-6n07Db2Y.js`);return{resolvePotHomeSlug:e}},__vite__mapDeps([17,18,2,19,4,5,6,7,8,9,10,13,14,15,16,20,3,21,22,23,24,25,26,11,12,27,28,29,30,31])),r=new Set,i=[];for(let a of e){if(r.has(a.workspaceId))continue;r.add(a.workspaceId);let o;try{let{loadHarnessRegistry:e}=await n(async()=>{let{loadHarnessRegistry:e}=await import(`./harness-registry-DuxxIfCX.js`);return{loadHarnessRegistry:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16])),t=await e(a.workspaceId);o=new Set(t.projects.filter(e=>e.harness_kind===`hive`).map(e=>e.slug))}catch{continue}let s=[t(void 0,void 0),...e.filter(e=>e.workspaceId===a.workspaceId).map(e=>e.installSlug)].find(e=>e&&o.has(e));s&&i.push({workspaceId:a.workspaceId,installSlug:s})}return i}function v(e){if(e==null)return null;if(typeof e==`number`)return Number.isFinite(e)?e:null;if(e instanceof Date)return e.getTime();let t=String(e);if(/^\d+$/.test(t))return Number(t);let n=Date.parse(t);return Number.isFinite(n)?n:null}async function y(){let{sql:e}=r(),[t,n]=await Promise.all([e`
      SELECT key, updated_at FROM harness_shared.operator_settings
      WHERE key LIKE ${`hive_started:%`} AND value = 'false'
    `,e`
      SELECT key FROM harness_shared.operator_settings
      WHERE key LIKE ${`hive_paused_deliberate:%`} AND value = 'true'
    `]),i=new Set(n.map(e=>e.key.slice(23))),a=[];for(let e of t){let t=e.key.slice(13),n=t.indexOf(`:`);n<=0||a.push({workspaceId:t.slice(0,n),installSlug:t.slice(n+1),pausedAtMs:v(e.updated_at),deliberate:i.has(t)})}return a}var b,x,S,C,w=e((()=>{i(),c(),t(),b=`hive_started:`,x=(e,t)=>`${b}${e}:${t}`,S=`hive_paused_deliberate:`,C=(e,t)=>`${S}${e}:${t}`}));export{y as a,p as c,w as i,d as l,f as n,g as o,u as r,_ as s,m as t};