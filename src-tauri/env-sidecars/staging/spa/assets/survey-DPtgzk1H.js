const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/_resolve-DLzyEjfG.js","assets/_resolve-AhngRC7k.js","assets/chunk-CMxvf4Kt.js","assets/src-CRqYcphb.js","assets/node-module-browser-BIpJATUS.js","assets/postgres-browser-zd-i1BMX.js","assets/resource-profile-CXmc9pS7.js","assets/__vite-browser-external-CM3Eme-n.js","assets/zod-Dj7LUnxx.js","assets/core-dwh4Ocgd.js","assets/harness-registry-Dmj_75ju.js","assets/preload-helper-B_k_wMTD.js","assets/operator-state-pg-fVlIOz6P.js","assets/db-encryption-Cexy6VC7.js","assets/workspace-registry-Bu1Yy540.js","assets/workspace-als-DigME466.js","assets/async-hooks-browser-DZKl_0H0.js","assets/workspace-id-constant-E7VkkAiJ.js","assets/hive-identity-D_2jd9Lk.js","assets/hive-store-htr1Z7pJ.js","assets/hive-keypair-D0ALPTDk.js","assets/ed25519-DcpIhM5m.js","assets/keychain-D7_9fD-P.js","assets/derive-swarm-topic-C4peUsR0.js","assets/wake-B5PEncfY.js","assets/src-CXfdPlCB.js","assets/cron-wBe2AScZ.js","assets/carry-note-_Ny4-AR-.js","assets/coordination-event-log-browser-Dq_4i-_C.js","assets/registry-PEJRQ9wB.js","assets/src-DS6stHeO.js","assets/src-C0H6dNEO.js","assets/operator-home-harness-CAu4fYEf.js","assets/workspace-brain-scope-CB6nVQ7N.js","assets/server-WINkLZx9.js","assets/types-DWFvb24U.js","assets/src-CufTLG1h.js","assets/flag-distinct-id-BZ5cCTSq.js"])))=>i.map(i=>d[i]);
import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./preload-helper-B_k_wMTD.js";import{_ as r,t as i}from"./src-DW7JHyJi.js";import{J as a,t as o}from"./src-CRqYcphb.js";import{s}from"./workspace-registry-Bu1Yy540.js";import{n as c,t as l}from"./pg-transient-retry-DaH-NVVQ.js";import{a as u,c as d}from"./harness-registry-Dmj_75ju.js";import{d as f,p}from"./source-D1ZHc-F5.js";import{at as m,it as h,nt as g,tt as _}from"./issues-engineer-BHeDuDS8.js";import{n as v,t as y}from"./work-items-admission-Cr0G7JYy.js";import{a as b,i as x,n as S,t as C}from"./external-blockers-B4kuN1X2.js";import{m as ee,p as te,u as w}from"./store-DjMNB4zI.js";import{a as ne,c as re,i as ie,n as ae,o as oe,r as se,s as ce}from"./human-queue-jMpOtY4E.js";import{l as le,p as T}from"./placement-watchdog-XZBME2uy.js";function E(e){return e===`shipped`||e===`superseded`}function ue(e,t){return(e===`started`||e===`paused`)&&E(t)?`done`:e}var de=e((()=>{o(),s()})),fe=e((()=>{se(),ce(),re(),oe(),ne(),ae()}));function pe(e){return e?w.severity[e]??0:0}async function D(e){return ie(e,{},{features:P,getKey:e=>e.id,tieBreak:(e,t)=>{let n=e.opPriority??1/0,r=t.opPriority??1/0;return n===r?e.id.localeCompare(t.id):n-r}})}var O,k,A,j,M,N,P,me=e((()=>{i(),te(),fe(),O=Object.fromEntries(r.map((e,t)=>[e,r.length-1-t])),k={importance:4,blockingImpact:1,staleness:3,escalationPressure:5},A={name:`plan-importance`,weight:k.importance,description:`Declared importance of the plan (its hottest open item) or work-item (urgent..low) — the primary "which plan matters" placement signal (B-08/P-010).`,score(e){let t=new Map;for(let n of e){let e=n.importance??`normal`,r=O[e]??O.normal;t.set(n.id,{value:r,reasons:e===`normal`?[]:[`${e} importance`]})}return t}},j={name:`blocking-impact`,weight:k.blockingImpact,description:"Downstream cost of leaving this unplaced: `blocks` out-edges, inbound references, severity prior — consuming consume-edges B-08 per-edge weights.",score(e){let t=w,n=new Map;for(let r of e){let e=r.blocksOut??0,i=r.inboundRefs??0,a=pe(r.severity),o=t.blocksOut*e+t.inboundRef*i+a,s=[];e>0&&s.push(`blocks ${e} downstream item(s)`),i>0&&s.push(`${i} inbound reference(s)`),(r.severity===`critical`||r.severity===`major`)&&s.push(`${r.severity} severity`),n.set(r.id,{value:o,reasons:s})}return n}},M={name:`staleness`,weight:k.staleness,description:`Anti-starvation aging (P-031): a long-unplaced candidate self-promotes on B-08's log staleness curve so the backlog tail never starves behind fresh arrivals.`,score(e){let t=new Map;for(let n of e){let e=Math.max(0,n.ageDays??0),r=Math.round((ee(e)-1)*100)/100;t.set(n.id,{value:r,reasons:r>=.3?[`unplaced ${Math.round(e)}d (aging +${r})`]:[]})}return t}},N={name:`escalation-pressure`,weight:k.escalationPressure,description:`Open escalations / needs-human items waiting on this plan or work-item — unattended decisions gate the work behind them.`,score(e){let t=new Map;for(let n of e){let e=Math.max(0,n.escalations??0);t.set(n.id,{value:e,reasons:e>0?[`${e} open escalation(s)/needs-human`]:[]})}return t}},P=[A,j,M,N]}));function F(e,t){if(!e)return 0;let n=new Date(e).getTime();return Number.isFinite(n)?Math.max(0,(t-n)/be):0}async function I(e,t,n=d){let r=(await n(e)).projects.filter(e=>e.hive_slug===t&&e.slug!==t).map(e=>e.slug),i=r.length>0?Array.from(new Set([t,...r])):[];return{home:t,members:r,surveySlugs:i,scope:i.length>0?`members`:`workspace`}}function L(e,t){return e?e.pauseNewWork?!0:typeof e.pausedUntil==`number`&&t<e.pausedUntil:!1}function R(e,t){return!t?.allowedHarnesses||t.allowedHarnesses.length===0?!0:t.allowedHarnesses.includes(e)}function z(e,t){return!t?.stoppedHarnesses||t.stoppedHarnesses.length===0?!0:!t.stoppedHarnesses.includes(e)}function B(e,t){return!t?.eligiblePlans||t.eligiblePlans.length===0?!0:t.eligiblePlans.includes(e)}function V(e,t){return e?!t?.eligiblePlans||t.eligiblePlans.length===0?!0:t.eligiblePlans.includes(e):t?.includeUnplannedWork!==!1}function he(e){let t=null;for(let n of e.items){if(n.status===`done`||n.status===`dropped`)continue;let e=r.includes(n.importance)?n.importance:`normal`;(t===null||Z[e]<Z[t])&&(t=e)}return t??`normal`}function H(e,t,n={}){let r=ue(e.opStatus,e.status),i=r===`started`;if(!i&&(!n.includeUnstarted||r===`done`||E(e.status)))return null;let a=0,o=0;for(let t of e.items)(t.status===`todo`||t.status===`wip`)&&(a+=1),t.status===`needs-human`&&(o+=1);return{id:e.planSlug,view:`plan`,harness:e.harnessSlug,title:e.title??e.planSlug,importance:he(e),ageDays:F(e.opUpdatedAt??e.updatedAt,t),opPriority:e.opPriority,escalations:o,openItems:a,...i?{}:{needsStart:!0}}}function U(e,t){return{id:e.feature_id,view:`work-item`,harness:e.harness_slug,title:e.title??e.feature_id,importance:`normal`,ageDays:F(e.created_ts,t),opPriority:e.feature_order}}function W(e,t){let n=new Map;for(let t of e){let e=n.get(t.harness_slug);e?e.push(t):n.set(t.harness_slug,[t])}let r=[],i=0;for(let[e,a]of n){let n=t.get(e),o=a.some(e=>e.payload&&C(e.payload).length>0);if((!n||n.blockers.size===0)&&!o){r.push(...a);continue}let s=new Map;for(let e of a){let t=C(e.payload).map(e=>`${e.kind}:${e.ref}`);s.set(e.feature_id,{id:e.feature_id,status:`todo`,blockedBy:n?.blockers.get(e.feature_id)??[],...t.length>0?{externalBlockers:t}:{}})}for(let e of a)for(let t of n?.blockers.get(e.feature_id)??[]){if(s.has(t))continue;let e=n?.statuses.get(t);e!=null&&s.set(t,{id:t,status:e,blockedBy:[]})}let{ready:c}=m([...s.values()],new Set,Q),l=new Set(c.map(e=>e.id));for(let e of a)l.has(e.feature_id)?r.push(e):i+=1}return{ready:r,blockedCount:i}}async function G(e,t,n,r=50){let i=T().breakerThreshold;return await e`
    SELECT feature_id, harness_slug, title, item_kind, created_ts, feature_order,
           source_plan_slug AS plan_slug, payload
      FROM harness_shared.harness_features_consolidated f
     WHERE workspace_id = ${t}
       AND ${x(e,t)}
       AND status = 'todo'
       AND (taken_by IS NULL OR taken_by = '')
       AND ${y(e,t)}
       AND NOT EXISTS (
         SELECT 1 FROM harness_shared.pot_placements p
          WHERE p.workspace_id = f.workspace_id
            AND p.work_item_id = f.feature_id
            AND p.status = 'cursed'
            AND p.fail_count >= ${i}
            -- Scope the curse to THIS pot's own installs (papercup→papercusp migration follow-up,
            -- 2026-06-20): a curse from a RETIRED/foreign install must not hide the item from the
            -- home pot's frontier. Unscoped only in the workspace-wide fallback (surveySlugs empty).
            ${n.length>0?e`AND p.install_slug = ANY(${n})`:e``}
       )
       ${n.length>0?e`AND harness_slug = ANY(${n})`:e``}
       AND harness_slug !~* ${$}
     ORDER BY created_ts ASC
     LIMIT ${r}`}async function K(e,t,n){let r=T().breakerThreshold,i=await e`
    SELECT count(*)::int AS n
      FROM harness_shared.harness_features_consolidated f
     WHERE workspace_id = ${t}
       AND ${x(e,t)}
       AND status = 'todo'
       AND (taken_by IS NULL OR taken_by = '')
       AND ${y(e,t)}
       AND NOT EXISTS (
         SELECT 1 FROM harness_shared.pot_placements p
          WHERE p.workspace_id = f.workspace_id
            AND p.work_item_id = f.feature_id
            AND p.status = 'cursed'
            AND p.fail_count >= ${r}
            -- Scope the curse to THIS pot's own installs (papercup→papercusp migration follow-up,
            -- 2026-06-20): a curse from a RETIRED/foreign install must not hide the item from the
            -- home pot's frontier. Unscoped only in the workspace-wide fallback (surveySlugs empty).
            ${n.length>0?e`AND p.install_slug = ANY(${n})`:e``}
       )
       ${n.length>0?e`AND harness_slug = ANY(${n})`:e``}
       AND harness_slug !~* ${$}`;return Number(i[0]?.n??0)}async function q(e,t,n){let r=T().breakerThreshold,i=await e`
    SELECT count(*)::int AS n
      FROM harness_shared.harness_features_consolidated f
     WHERE workspace_id = ${t}
       AND ${x(e,t)}
       AND status = 'todo'
       AND (taken_by IS NULL OR taken_by = '')
       -- The ONE inverted leg: everything else mirrors countPlaceableFrontier, so
       -- the two partition the same row set into admissible vs. quarantined.
       --
       -- COALESCE(..., FALSE) IS LOAD-BEARING — do not "simplify" it to a bare NOT.
       -- SQL three-valued logic: for the rows this counter EXISTS to find (remote,
       -- never audited) the audit_verdict = 'admit' test is NULL, not FALSE, so the
       -- whole admission expression is NULL — and NOT NULL is NULL, which a WHERE
       -- treats as no-match. A bare NOT (...) therefore returns ZERO quarantined for
       -- precisely the deadlock this counter is meant to detect, and every unit test
       -- still passes (fixtures pass booleans, never NULL). Caught against the live
       -- DB on 2026-07-13. The positive form in countPlaceableFrontier is safe as-is
       -- (a NULL there is falsy in WHERE, which correctly EXCLUDES the row) — it is
       -- only the NEGATION that must pin NULL to FALSE.
       -- NB: no backticks anywhere in this comment — it lives inside a tagged template
       -- literal, so a markdown-style quote would terminate the SQL and break the build.
       AND COALESCE(${y(e,t)}, FALSE) = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM harness_shared.pot_placements p
          WHERE p.workspace_id = f.workspace_id
            AND p.work_item_id = f.feature_id
            AND p.status = 'cursed'
            AND p.fail_count >= ${r}
            ${n.length>0?e`AND p.install_slug = ANY(${n})`:e``}
       )
       ${n.length>0?e`AND harness_slug = ANY(${n})`:e``}
       AND harness_slug !~* ${$}`;return Number(i[0]?.n??0)}async function ge(e,t){let{sql:n}=a();return K(n,e,(await I(e,t)).surveySlugs)}async function J(e,t,n){let r=await _.blockersFor(n),i=new Set;for(let e of r.values())for(let t of e)i.add(t);let a=new Map;if(i.size>0){let r=await e`
      SELECT feature_id, status
        FROM harness_shared.harness_features_consolidated
       WHERE workspace_id = ${t}
         AND harness_slug = ${n}
         AND feature_id = ANY(${Array.from(i)})`;a=new Map(r.map(e=>[e.feature_id,e.status]))}return{blockers:r,statuses:a}}function _e(e){return{loadRegistry:d,listPlanRows:t=>p({harnessSlug:t,workspaceId:e}),fetchFrontier:(t,n)=>{let{sql:r}=a();return G(r,e,t,n)},fetchBlockGraph:t=>{let{sql:n}=a();return J(n,e,t)},fetchQuarantinedCount:async t=>{try{let{sql:n}=a();return await c(()=>q(n,e,t),{label:`pot-survey.countQuarantinedFrontier`})}catch(e){return console.warn(`[pot-survey] quarantined-frontier count failed — reporting 0:`,e instanceof Error?e.message:e),0}},now:()=>Date.now()}}async function Y(e,t,n={}){let r={..._e(e),...n.deps},i=r.now(),a=n.scopeFilter,o=await I(e,t,r.loadRegistry),s=o.surveySlugs.length>0&&(n.extraSurveySlugs?.length??0)>0?Array.from(new Set([...o.surveySlugs,...n.extraSurveySlugs])):o.surveySlugs,l;if(s.length>0)l=s;else{let n=await r.loadRegistry(e);l=Array.from(new Set([t,...n.projects.filter(e=>e.harness_kind===`hive`).map(e=>e.slug)]))}let[u,d,f]=await Promise.all([Promise.all(l.map(async e=>{try{return await c(()=>r.listPlanRows(e),{label:`pot-survey.listPlanRows`})}catch(t){return console.warn(`[pot-survey] plan read failed for '${e}' — skipped:`,t instanceof Error?t.message:t),[]}})),r.fetchFrontier(s,n.frontierLimit??50),r.fetchQuarantinedCount(s)]),p=[];for(let e of u)for(let t of e){let e=H(t,i,{includeUnstarted:(a?.eligiblePlans?.length??0)>0&&!!a?.eligiblePlans?.includes(t.planSlug)});e&&p.push(e)}let m=[...new Set(d.map(e=>e.harness_slug))],h=new Map;await Promise.all(m.map(async e=>{try{h.set(e,await r.fetchBlockGraph(e))}catch(t){console.warn(`[pot-survey] block-graph read failed for '${e}' — lanes treated unblocked:`,t instanceof Error?t.message:t)}}));let{ready:g,blockedCount:_}=W(d,h);_>0&&console.log(`[pot-survey] frontier: ${_} lane(s) held back by unsatisfied blocked_by; ${g.length} ready`);let v=L(a,i),y=v?[]:g.filter(e=>R(e.harness_slug,a)&&z(e.harness_slug,a)&&V(e.plan_slug,a));v&&console.log(`[pot-survey] new-work PAUSED (scopeFilter) — frontier emptied (${g.length} ready item(s) withheld); Mug drives existing placements to terminal.`);let b=y.map(e=>U(e,i)),[x,S]=await Promise.all([D(p.filter(e=>R(e.harness,a)&&z(e.harness,a)&&B(e.id,a))),D(b)]);return{home:o.home,members:o.members,scope:o.scope,plans:x,frontier:S,frontierBlocked:_,frontierQuarantined:f}}function ve(e){return`${e.view}:${e.harness}:${e.id}`}function X(e,t,n){let r=ve(t),i=e.get(r);(!i||i.scope===`workspace`&&n===`members`)&&e.set(r,{candidate:t,scope:n})}async function ye(e,t={}){let r=await(t.listPotSlugs??(async e=>{let{listPots:t}=await n(async()=>{let{listPots:e}=await import(`./_resolve-DLzyEjfG.js`);return{listPots:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37]));return(await t(e)).map(e=>e.slug)}))(e).catch(()=>[]);r.length===0&&t.fallbackHome&&(r=[t.fallbackHome]),r=Array.from(new Set(r));let i=await Promise.all(r.map(async n=>({pot:n,survey:await Y(e,n,{frontierLimit:t.frontierLimit,scopeFilter:t.scopeFilter,deps:t.deps})}))),a=new Map,o=new Map,s=0,c=0;for(let{pot:e,survey:t}of i){for(let n of t.plans)X(a,{...n,pot:e},t.scope);for(let n of t.frontier)X(o,{...n,pot:e},t.scope);s+=t.frontierBlocked,c+=t.frontierQuarantined}let[l,u]=await Promise.all([D([...a.values()].map(e=>e.candidate)),D([...o.values()].map(e=>e.candidate))]);return{perPot:i,crossPot:{plans:l,frontier:u,frontierBlocked:s,frontierQuarantined:c},hives:r}}var be,Z,Q,$,xe=e((()=>{o(),i(),l(),b(),v(),u(),f(),de(),me(),g(),h(),S(),le(),t(),be=864e5,Z=Object.fromEntries(r.map((e,t)=>[e,t])),Q=new Set([`todo`]),$=`(^|[^a-z0-9])(xbench|xbq[a-z0-9]{6}|hiveloop|memcap|memrun)|-instance[_-]|_instance[_-]|deleteme|^e2e-imp|^sb-gym|gym-eval|^bench-|smoke-p[0-9]`}));export{ye as _,W as a,R as c,L as d,z as f,Y as g,I as h,J as i,B as l,ge as m,q as n,V as o,H as p,G as r,U as s,K as t,xe as u};