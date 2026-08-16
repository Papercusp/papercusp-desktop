const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/harness-registry-BtRgjvBY.js","assets/harness-registry-Diy1vc1F.js","assets/chunk-ChpBd9eV.js","assets/preload-helper-CcgcQsTF.js","assets/src-8fWtxfEz.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/src-6Py4l2MU.js","assets/drizzle-orm-BbO4Lkx2.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js","assets/operator-state-pg-Cytj1dEs.js","assets/db-encryption-ByK3NqqK.js","assets/workspace-registry-Du2UbhlH.js","assets/workspace-als-CSW21ZcE.js","assets/workspace-id-constant-AQ2MH5pQ.js","assets/platform-pot-slug-C6n7Eole.js","assets/wake-Bs1r92sn.js","assets/carry-note-D0tlwvr1.js","assets/coordination-event-log-browser-s_EyGDm7.js","assets/agent-orders-notify-DSzp1kSm.js","assets/wake-DZGTDp-E.js","assets/src-B-ourlv1.js","assets/cron-CQ-fl78O.js","assets/registry-cwbEj3Sv.js","assets/src-rhu3PqlJ.js","assets/src-DZqanng7.js","assets/operator-home-harness-MSlRvOkW.js","assets/workspace-brain-scope-2KYVIPTn.js","assets/server-BXcXKvn3.js","assets/types-DoRTXl1W.js","assets/src-DduH0PES.js","assets/flag-distinct-id-CCLxG4xU.js","assets/lazy-flag-refresh-Rr70cDYT.js"])))=>i.map(i=>d[i]);
import{n as g}from"./chunk-ChpBd9eV.js";import{n as S,t as d}from"./preload-helper-CcgcQsTF.js";import{st as c,t as m}from"./src-8fWtxfEz.js";import{c as k,i as P}from"./workspace-registry-Du2UbhlH.js";import{l as v,o as D,s as R}from"./harness-registry-Diy1vc1F.js";import{i as $,n as p,r as T,t as L}from"./workspace-brain-scope-2KYVIPTn.js";async function I(){return!1}async function y(e,s,t){const{sql:r}=c();await r`
    INSERT INTO harness_shared.operator_settings (key, value, description, updated_at, workspace_id)
    VALUES (
      ${h(e,s)},
      ${t?"true":"false"},
      ${"Pause provenance (WI-3261). true = the CURRENT pause was owner-initiated (pot:pause) — the paused-pot recovery watchdog must never auto-resume it, only alert. Cleared on every resume."},
      ${Date.now()},
      ${e}
    )
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `}async function W(e,s){if(!await I())return!1;const{sql:t}=c(),r=await p();for(const a of T(e,s,r)){const n=(await t`
      SELECT value FROM harness_shared.operator_settings WHERE key = ${u(e,a)} LIMIT 1`)[0]?.value;if(n!=null)return n==="true"}return!1}async function X(e,s,t,r={}){const{sql:a}=c(),n=$(e,s,await p());await a`
    INSERT INTO harness_shared.operator_settings (key, value, description, updated_at, workspace_id)
    VALUES (
      ${u(e,n)},
      ${t?"true":"false"},
      ${"Start/Pause Pot state (start-pot-wake P-004 / D-006). true = the colony should be running; the watchdog holds the liveness invariant only while true."},
      ${Date.now()},
      ${e}
    )
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `,await y(e,n,t?!1:r.deliberate??!1)}async function q(e,s){const{sql:t}=c();return(await t`
    SELECT value FROM harness_shared.operator_settings WHERE key = ${u(e,s)} LIMIT 1`)[0]?.value==="true"}async function K(e,s,t,r={}){const{sql:a}=c();await a`
    INSERT INTO harness_shared.operator_settings (key, value, description, updated_at, workspace_id)
    VALUES (
      ${u(e,s)},
      ${t?"true":"false"},
      ${"Per-pot Start/Stop placement bit (per-pot start-stop 2026-06-30). true = this pot's work is placed by the workspace Mug."},
      ${Date.now()},
      ${e}
    )
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `,await y(e,s,t?!1:r.deliberate??!1)}async function V(e,s){const t=(await _()).filter(r=>r.workspaceId===e&&r.installSlug!==e&&r.installSlug!==s);if(t.length===0)return!1;try{const{loadHarnessRegistry:r}=await d(async()=>{const{loadHarnessRegistry:o}=await import("./harness-registry-BtRgjvBY.js");return{loadHarnessRegistry:o}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18])),a=await r(e),n=new Set(a.projects.filter(o=>o.harness_kind==="hive").map(o=>o.slug));return t.some(o=>n.has(o.installSlug))}catch{return t.length>0}}async function _(){const{sql:e}=c(),s=await e`
    SELECT key FROM harness_shared.operator_settings
    WHERE key LIKE ${"hive_started:%"} AND value = 'true'
  `,t=[];for(const r of s){const a=r.key.slice(13),n=a.indexOf(":");n<=0||t.push({workspaceId:a.slice(0,n),installSlug:a.slice(n+1)})}return t}async function j(){return _()}function O(){return[...new Set(P().filter(e=>e&&e!=="*"))]}async function B(){const e=[],s=new Set;for(const t of O()){const r=await v(t);for(const a of r.projects){if(a.harness_kind!=="hive"||R(a))continue;const n=a.slug?.trim();if(!n)continue;const o=`${t}\0${n}`;s.has(o)||(s.add(o),e.push({workspaceId:t,installSlug:n}))}}return e}async function x(){const e=await _();if(!await p())return e;const{resolvePotHomeSlug:s}=await d(async()=>{const{resolvePotHomeSlug:a}=await import("./wake-Bs1r92sn.js");return{resolvePotHomeSlug:a}},__vite__mapDeps([19,20,2,21,4,5,6,7,8,9,10,11,12,22,3,15,16,17,23,24,25,26,27,28,29,13,14,30,31,32,33,34,35])),t=new Set,r=[];for(const a of e){if(t.has(a.workspaceId))continue;t.add(a.workspaceId);let n;try{const{loadHarnessRegistry:i}=await d(async()=>{const{loadHarnessRegistry:l}=await import("./harness-registry-BtRgjvBY.js");return{loadHarnessRegistry:l}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18])),w=await i(a.workspaceId);n=new Set(w.projects.filter(l=>l.harness_kind==="hive").map(l=>l.slug))}catch{continue}const o=[s(void 0,void 0),...e.filter(i=>i.workspaceId===a.workspaceId).map(i=>i.installSlug)].find(i=>i&&n.has(i));o&&r.push({workspaceId:a.workspaceId,installSlug:o})}return r}function C(e){if(e==null)return null;if(typeof e=="number")return Number.isFinite(e)?e:null;if(e instanceof Date)return e.getTime();const s=String(e);if(/^\d+$/.test(s))return Number(s);const t=Date.parse(s);return Number.isFinite(t)?t:null}async function z(){const{sql:e}=c(),[s,t]=await Promise.all([e`
      SELECT key, updated_at FROM harness_shared.operator_settings
      WHERE key LIKE ${"hive_started:%"} AND value = 'false'
    `,e`
      SELECT key FROM harness_shared.operator_settings
      WHERE key LIKE ${"hive_paused_deliberate:%"} AND value = 'true'
    `]),r=new Set(t.map(n=>n.key.slice(23))),a=[];for(const n of s){const o=n.key.slice(13),i=o.indexOf(":");i<=0||a.push({workspaceId:o.slice(0,i),installSlug:o.slice(i+1),pausedAtMs:C(n.updated_at),deliberate:r.has(o)})}return a}var f,u,E,h,G=g((()=>{m(),L(),k(),D(),S(),f="hive_started:",u=(e,s)=>`${f}${e}:${s}`,E="hive_paused_deliberate:",h=(e,s)=>`${E}${e}:${s}`}));export{B as a,j as c,K as d,X as f,G as i,x as l,q as n,O as o,W as r,z as s,V as t,I as u};
