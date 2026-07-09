const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/harness-registry-3WaG4VsP.js","assets/harness-registry-CttOF-YA.js","assets/chunk-CMxvf4Kt.js","assets/preload-helper-B_k_wMTD.js","assets/src-DTtGQmae.js","assets/node-module-browser-BIpJATUS.js","assets/postgres-browser-zd-i1BMX.js","assets/resource-profile-BTaEU3Bl.js","assets/__vite-browser-external-CM3Eme-n.js","assets/zod-Dj7LUnxx.js","assets/core-dwh4Ocgd.js","assets/operator-state-pg-CuOVF3AN.js","assets/db-encryption-Cexy6VC7.js","assets/workspace-registry-C3lTKlnO.js","assets/workspace-als-Cj-bQU9A.js","assets/workspace-id-constant-E7VkkAiJ.js","assets/wake-D0t0Ykl-.js","assets/carry-note-DGFTx7C-.js","assets/event-log-DlTwD7ps.js","assets/wake-C0EHaojm.js","assets/src-CXfdPlCB.js","assets/cron-wBe2AScZ.js","assets/registry-IMbjaTuk.js","assets/src-CdvH5tWp.js","assets/src-CFOeSMcp2.js","assets/operator-home-harness-CuO9bc6b.js","assets/workspace-brain-scope-DS4vxSAh.js","assets/src-IyG-iRKL.js","assets/types-DpojiHk_.js","assets/server-Dl8wHwHt.js","assets/path-Blx-PRXi.js","assets/flag-distinct-id-BZ5cCTSq.js"])))=>i.map(i=>d[i]);
import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./preload-helper-B_k_wMTD.js";import{q as r,t as i}from"./src-DTtGQmae.js";import{i as a,n as o,r as s,t as c}from"./workspace-brain-scope-DS4vxSAh.js";async function l(e,t,n){let{sql:i}=r();await i`
    INSERT INTO harness_shared.operator_settings (key, value, description, updated_at, workspace_id)
    VALUES (
      ${C(e,t)},
      ${n?`true`:`false`},
      ${`Pause provenance (WI-3261). true = the CURRENT pause was owner-initiated (pot:pause) — the paused-hive recovery watchdog must never auto-resume it, only alert. Cleared on every resume.`},
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
      ${`Start/Pause Hive state (start-hive-wake P-004 / D-006). true = the colony should be running; the watchdog holds the liveness invariant only while true.`},
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
      ${`Per-hive Start/Stop placement bit (per-hive start-stop 2026-06-30). true = this hive's work is placed by the workspace Queen.`},
      ${Date.now()},
      ${e}
    )
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `,await l(e,t,n?!1:i.deliberate??!1)}async function m(e,t){let r=(await h()).filter(n=>n.workspaceId===e&&n.installSlug!==e&&n.installSlug!==t);if(r.length===0)return!1;try{let{loadHarnessRegistry:t}=await n(async()=>{let{loadHarnessRegistry:e}=await import(`./harness-registry-3WaG4VsP.js`);return{loadHarnessRegistry:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15])),i=await t(e),a=new Set(i.projects.filter(e=>e.harness_kind===`hive`).map(e=>e.slug));return r.some(e=>a.has(e.installSlug))}catch{return r.length>0}}async function h(){let{sql:e}=r(),t=await e`
    SELECT key FROM harness_shared.operator_settings
    WHERE key LIKE ${`hive_started:%`} AND value = 'true'
  `,n=[];for(let e of t){let t=e.key.slice(13),r=t.indexOf(`:`);r<=0||n.push({workspaceId:t.slice(0,r),installSlug:t.slice(r+1)})}return n}async function g(){return h()}async function _(){let e=await h();if(!await o())return e;let{resolveHiveHomeSlug:t}=await n(async()=>{let{resolveHiveHomeSlug:e}=await import(`./wake-D0t0Ykl-.js`);return{resolveHiveHomeSlug:e}},__vite__mapDeps([16,17,2,18,8,4,5,6,7,9,10,13,14,15,19,3,20,21,22,23,24,25,11,12,26,27,28,29,30,31])),r=new Set,i=[];for(let n of e){if(r.has(n.workspaceId))continue;r.add(n.workspaceId);let e=t(void 0,void 0)??n.installSlug;i.push({workspaceId:n.workspaceId,installSlug:e})}return i}function v(e){if(e==null)return null;if(typeof e==`number`)return Number.isFinite(e)?e:null;if(e instanceof Date)return e.getTime();let t=String(e);if(/^\d+$/.test(t))return Number(t);let n=Date.parse(t);return Number.isFinite(n)?n:null}async function y(){let{sql:e}=r(),[t,n]=await Promise.all([e`
      SELECT key, updated_at FROM harness_shared.operator_settings
      WHERE key LIKE ${`hive_started:%`} AND value = 'false'
    `,e`
      SELECT key FROM harness_shared.operator_settings
      WHERE key LIKE ${`hive_paused_deliberate:%`} AND value = 'true'
    `]),i=new Set(n.map(e=>e.key.slice(23))),a=[];for(let e of t){let t=e.key.slice(13),n=t.indexOf(`:`);n<=0||a.push({workspaceId:t.slice(0,n),installSlug:t.slice(n+1),pausedAtMs:v(e.updated_at),deliberate:i.has(t)})}return a}var b,x,S,C,w=e((()=>{i(),c(),t(),b=`hive_started:`,x=(e,t)=>`${b}${e}:${t}`,S=`hive_paused_deliberate:`,C=(e,t)=>`${S}${e}:${t}`}));export{y as a,p as c,w as i,d as l,f as n,g as o,u as r,_ as s,m as t};