const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/_resolve-C4dVSqu0.js","assets/_resolve-BI5Az96B.js","assets/chunk-CMxvf4Kt.js","assets/src-C4H77EbW.js","assets/node-module-browser-BIpJATUS.js","assets/postgres-browser-zd-i1BMX.js","assets/resource-profile-CXmc9pS7.js","assets/__vite-browser-external-CM3Eme-n.js","assets/zod-Dj7LUnxx.js","assets/core-dwh4Ocgd.js","assets/harness-registry-CWycWYvL.js","assets/preload-helper-B_k_wMTD.js","assets/operator-state-pg-DEvpog4B.js","assets/db-encryption-Cexy6VC7.js","assets/workspace-registry-Bu1Yy540.js","assets/workspace-als-DigME466.js","assets/async-hooks-browser-DZKl_0H0.js","assets/workspace-id-constant-E7VkkAiJ.js","assets/hive-identity-D08seRYI.js","assets/hive-store-Cna6O5v1.js","assets/hive-keypair-DMSVDU3-.js","assets/ed25519-DcpIhM5m.js","assets/keychain-D7_9fD-P.js","assets/derive-swarm-topic-C4peUsR0.js","assets/wake-BmoO_Pj8.js","assets/src-CXfdPlCB.js","assets/cron-wBe2AScZ.js","assets/carry-note-BwBOWEpq.js","assets/coordination-event-log-browser-Dq_4i-_C.js","assets/registry-PEJRQ9wB.js","assets/src-DS6stHeO.js","assets/src-C0H6dNEO.js","assets/operator-home-harness-CAu4fYEf.js","assets/workspace-brain-scope-D2svr7MA.js","assets/server-Dbwl6Oih.js","assets/types-qZw2Z8cE.js","assets/src-C_84UHfx.js","assets/flag-distinct-id-BZ5cCTSq.js"])))=>i.map(i=>d[i]);
import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./preload-helper-B_k_wMTD.js";import{_ as r,t as i}from"./src-DW7JHyJi.js";import{J as a,t as o}from"./src-C4H77EbW.js";import{s}from"./workspace-registry-Bu1Yy540.js";import{G as c,J as l,K as u,Y as d}from"./issues-engineer-DoqjTsXQ.js";import{a as f,c as p}from"./harness-registry-CWycWYvL.js";import{n as m,t as h}from"./pg-transient-retry-DaH-NVVQ.js";import{d as g,p as _}from"./source-BK5RyRFU.js";import{F as v,L as y,P as b,R as x}from"./work-items-BvMM9X-J.js";import{X as S,Z as C}from"./boot-all-DSbgJZT8.js";import{m as w,p as ee,u as te}from"./store-DpWDRFmG.js";import{a as ne,c as re,i as ie,n as ae,o as oe,r as se,s as ce}from"./human-queue-BCcmymqS.js";import{m as T,u as le}from"./placement-watchdog-DV1FOHdL.js";function E(e){return e===`shipped`||e===`superseded`}function ue(e,t){return(e===`started`||e===`paused`)&&E(t)?`done`:e}var de=e((()=>{o(),s()})),fe=e((()=>{se(),ce(),re(),oe(),ne(),ae()}));function pe(e){return e?te.severity[e]??0:0}async function D(e){return ie(e,{},{features:P,getKey:e=>e.id,tieBreak:(e,t)=>{let n=e.opPriority??1/0,r=t.opPriority??1/0;return n===r?e.id.localeCompare(t.id):n-r}})}var O,k,A,j,M,N,P,me=e((()=>{i(),ee(),fe(),O=Object.fromEntries(r.map((e,t)=>[e,r.length-1-t])),k={importance:4,blockingImpact:1,staleness:3,escalationPressure:5},A={name:`plan-importance`,weight:k.importance,description:`Declared importance of the plan (its hottest open item) or work-item (urgent..low) — the primary "which plan matters" placement signal (B-08/P-010).`,score(e){let t=new Map;for(let n of e){let e=n.importance??`normal`,r=O[e]??O.normal;t.set(n.id,{value:r,reasons:e===`normal`?[]:[`${e} importance`]})}return t}},j={name:`blocking-impact`,weight:k.blockingImpact,description:"Downstream cost of leaving this unplaced: `blocks` out-edges, inbound references, severity prior — consuming consume-edges B-08 per-edge weights.",score(e){let t=te,n=new Map;for(let r of e){let e=r.blocksOut??0,i=r.inboundRefs??0,a=pe(r.severity),o=t.blocksOut*e+t.inboundRef*i+a,s=[];e>0&&s.push(`blocks ${e} downstream item(s)`),i>0&&s.push(`${i} inbound reference(s)`),(r.severity===`critical`||r.severity===`major`)&&s.push(`${r.severity} severity`),n.set(r.id,{value:o,reasons:s})}return n}},M={name:`staleness`,weight:k.staleness,description:`Anti-starvation aging (P-031): a long-unplaced candidate self-promotes on B-08's log staleness curve so the backlog tail never starves behind fresh arrivals.`,score(e){let t=new Map;for(let n of e){let e=Math.max(0,n.ageDays??0),r=Math.round((w(e)-1)*100)/100;t.set(n.id,{value:r,reasons:r>=.3?[`unplaced ${Math.round(e)}d (aging +${r})`]:[]})}return t}},N={name:`escalation-pressure`,weight:k.escalationPressure,description:`Open escalations / needs-human items waiting on this plan or work-item — unattended decisions gate the work behind them.`,score(e){let t=new Map;for(let n of e){let e=Math.max(0,n.escalations??0);t.set(n.id,{value:e,reasons:e>0?[`${e} open escalation(s)/needs-human`]:[]})}return t}},P=[A,j,M,N]}));function F(e,t){if(!e)return 0;let n=new Date(e).getTime();return Number.isFinite(n)?Math.max(0,(t-n)/Se):0}async function I(e,t,n=p){let r=(await n(e)).projects.filter(e=>e.hive_slug===t&&e.slug!==t).map(e=>e.slug),i=r.length>0?Array.from(new Set([t,...r])):[];return{home:t,members:r,surveySlugs:i,scope:i.length>0?`members`:`workspace`}}function L(e,t){return e?e.pauseNewWork?!0:typeof e.pausedUntil==`number`&&t<e.pausedUntil:!1}function R(e,t){return!t?.allowedHarnesses||t.allowedHarnesses.length===0?!0:t.allowedHarnesses.includes(e)}function z(e,t){return!t?.stoppedHarnesses||t.stoppedHarnesses.length===0?!0:!t.stoppedHarnesses.includes(e)}function B(e,t){return!t?.eligiblePlans||t.eligiblePlans.length===0?!0:t.eligiblePlans.includes(e)}function V(e,t){return e?!t?.eligiblePlans||t.eligiblePlans.length===0?!0:t.eligiblePlans.includes(e):t?.includeUnplannedWork!==!1}function he(e){let t=null;for(let n of e.items){if(n.status===`done`||n.status===`dropped`)continue;let e=r.includes(n.importance)?n.importance:`normal`;(t===null||Z[e]<Z[t])&&(t=e)}return t??`normal`}function H(e,t,n={}){let r=ue(e.opStatus,e.status),i=r===`started`;if(!i&&(!n.includeUnstarted||r===`done`||E(e.status)))return null;let a=0,o=0;for(let t of e.items)(t.status===`todo`||t.status===`wip`)&&(a+=1),t.status===`needs-human`&&(o+=1);return{id:e.planSlug,view:`plan`,harness:e.harnessSlug,title:e.title??e.planSlug,importance:he(e),ageDays:F(e.opUpdatedAt??e.updatedAt,t),opPriority:e.opPriority,escalations:o,openItems:a,...i?{}:{needsStart:!0}}}function U(e,t){return{id:e.feature_id,view:`work-item`,harness:e.harness_slug,title:e.title??e.feature_id,importance:`normal`,ageDays:F(e.created_ts,t),opPriority:e.feature_order,...e.severity?{severity:e.severity}:{}}}function W(e,t,n){let r=new Map;for(let t of e){let e=r.get(t.harness_slug);e?e.push(t):r.set(t.harness_slug,[t])}let i=[],a=0;for(let[e,o]of r){let r=t.get(e),s=o.some(e=>e.payload&&b(e.payload).length>0);if((!r||r.blockers.size===0)&&!s){i.push(...o);continue}let c=new Map;for(let e of o){let t=b(e.payload).map(e=>`${e.kind}:${e.capability}:${e.ref}`);c.set(e.feature_id,{id:e.feature_id,status:`todo`,blockedBy:r?.blockers.get(e.feature_id)??[],...t.length>0?{externalBlockers:t}:{}})}for(let e of o)for(let t of r?.blockers.get(e.feature_id)??[]){if(c.has(t))continue;let e=r?.statuses.get(t);e!=null&&c.set(t,{id:t,status:e,blockedBy:[]})}let{ready:l}=d([...c.values()],new Set,Q),u=new Set(l.map(e=>e.id));for(let e of o){if(!u.has(e.feature_id)){a+=1;continue}if(n&&e.payload&&typeof e.payload==`object`&&e.payload!==null&&`plan_item`in e.payload){let t=e.payload.plan_item;if(t&&typeof t==`object`&&t&&`plan_slug`in t&&`item_id`in t){let e=t.plan_slug,r=t.item_id,i=n.planItemBlockers.get(e)?.get(r)??[],o=!1;for(let t of i){let r=n.planItemStatuses.get(e)?.get(t);if(!r||!Ce.has(r)){o=!0;break}}if(o){a+=1;continue}}}i.push(e)}}return{ready:i,blockedCount:a}}async function G(e,t,n,r=50){let i=T().breakerThreshold;return await e`
    SELECT feature_id, harness_slug, title, item_kind, created_ts, feature_order,
           source_plan_slug AS plan_slug, payload
      FROM harness_shared.harness_features_consolidated f
     WHERE workspace_id = ${t}
       AND ${y(e,t)}
       AND status = 'todo'
       AND (taken_by IS NULL OR taken_by = '')
       AND ${S(e,t)}
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
     LIMIT ${r}`}async function K(e,t,n,r=10){let i=T().breakerThreshold;return await e`
    SELECT feature_id, harness_slug, title, item_kind, created_ts, feature_order,
           source_plan_slug AS plan_slug, payload,
           COALESCE(payload -> '_ei' ->> 'severity', 'minor') AS severity
      FROM harness_shared.work_items f
     WHERE workspace_id = ${t}
       AND item_kind IN ('bug', 'change', 'task')
       AND status = 'todo'
       AND (taken_by IS NULL OR taken_by = '')
       AND COALESCE(payload -> '_ei' ->> 'severity', 'minor') IN ('critical', 'major')
       AND ${S(e,t)}
       AND NOT EXISTS (
         SELECT 1 FROM harness_shared.pot_placements p
          WHERE p.workspace_id = f.workspace_id
            AND p.work_item_id = f.feature_id
            AND p.status = 'cursed'
            AND p.fail_count >= ${i}
            ${n.length>0?e`AND p.install_slug = ANY(${n})`:e``}
       )
       ${n.length>0?e`AND harness_slug = ANY(${n})`:e``}
       AND harness_slug !~* ${$}
     ORDER BY (COALESCE(payload -> '_ei' ->> 'severity', 'minor') = 'critical') DESC, created_ts ASC
     LIMIT ${r}`}async function q(e,t,n){let r=T().breakerThreshold,i=await e`
    SELECT count(*)::int AS n
      FROM harness_shared.harness_features_consolidated f
     WHERE workspace_id = ${t}
       AND ${y(e,t)}
       AND status = 'todo'
       AND (taken_by IS NULL OR taken_by = '')
       AND ${S(e,t)}
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
       AND harness_slug !~* ${$}`;return Number(i[0]?.n??0)}async function J(e,t,n){let r=T().breakerThreshold,i=await e`
    SELECT count(*)::int AS n
      FROM harness_shared.harness_features_consolidated f
     WHERE workspace_id = ${t}
       AND ${y(e,t)}
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
       AND COALESCE(${S(e,t)}, FALSE) = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM harness_shared.pot_placements p
          WHERE p.workspace_id = f.workspace_id
            AND p.work_item_id = f.feature_id
            AND p.status = 'cursed'
            AND p.fail_count >= ${r}
            ${n.length>0?e`AND p.install_slug = ANY(${n})`:e``}
       )
       ${n.length>0?e`AND harness_slug = ANY(${n})`:e``}
       AND harness_slug !~* ${$}`;return Number(i[0]?.n??0)}async function ge(e,t){let{sql:n}=a();return q(n,e,(await I(e,t)).surveySlugs)}async function Y(e,t,n){let r=await c.blockersFor(n),i=new Set;for(let e of r.values())for(let t of e)i.add(t);let a=new Map;if(i.size>0){let r=await e`
      SELECT feature_id, status
        FROM harness_shared.harness_features_consolidated
       WHERE workspace_id = ${t}
         AND harness_slug = ${n}
         AND feature_id = ANY(${Array.from(i)})`;a=new Map(r.map(e=>[e.feature_id,e.status]))}return{blockers:r,statuses:a}}function X(e){let t=new Map,n=new Map;for(let r of e)for(let e of r){let r=e.planSlug;t.has(r)||(t.set(r,new Map),n.set(r,new Map));let i=t.get(r),a=n.get(r),o=new Map;for(let t of e.items)o.set(t.id,t.status);for(let t of e.items){i.set(t.id,t.blockedBy??[]);for(let e of t.blockedBy??[]){let t=o.get(e);t&&a.set(e,t)}}}return{planItemBlockers:t,planItemStatuses:n}}function _e(e){return{loadRegistry:p,listPlanRows:t=>_({harnessSlug:t,workspaceId:e}),fetchFrontier:(t,n)=>{let{sql:r}=a();return G(r,e,t,n)},fetchEscalatedIssues:(t,n)=>{let{sql:r}=a();return K(r,e,t,n)},fetchBlockGraph:t=>{let{sql:n}=a();return Y(n,e,t)},fetchQuarantinedCount:async t=>{try{let{sql:n}=a();return await m(()=>J(n,e,t),{label:`pot-survey.countQuarantinedFrontier`})}catch(e){return console.warn(`[pot-survey] quarantined-frontier count failed — reporting 0:`,e instanceof Error?e.message:e),0}},now:()=>Date.now()}}async function ve(e,t,n={}){let r={..._e(e),...n.deps},i=r.now(),a=n.scopeFilter,o=await I(e,t,r.loadRegistry),s=o.surveySlugs.length>0&&(n.extraSurveySlugs?.length??0)>0?Array.from(new Set([...o.surveySlugs,...n.extraSurveySlugs])):o.surveySlugs,c;if(s.length>0)c=s;else{let n=await r.loadRegistry(e);c=Array.from(new Set([t,...n.projects.filter(e=>e.harness_kind===`hive`).map(e=>e.slug)]))}let[l,u,d,f]=await Promise.all([Promise.all(c.map(async e=>{try{return await m(()=>r.listPlanRows(e),{label:`pot-survey.listPlanRows`})}catch(t){return console.warn(`[pot-survey] plan read failed for '${e}' — skipped:`,t instanceof Error?t.message:t),[]}})),r.fetchFrontier(s,n.frontierLimit??50),r.fetchEscalatedIssues(s,10).catch(e=>(console.warn(`[pot-survey] escalated-issue frontier read failed — reporting none:`,e instanceof Error?e.message:e),[])),r.fetchQuarantinedCount(s)]),p=[...u,...d],h=[];for(let e of l)for(let t of e){let e=H(t,i,{includeUnstarted:(a?.eligiblePlans?.length??0)>0&&!!a?.eligiblePlans?.includes(t.planSlug)});e&&h.push(e)}let g=[...new Set(p.map(e=>e.harness_slug))],_=new Map;await Promise.all(g.map(async e=>{try{_.set(e,await r.fetchBlockGraph(e))}catch(t){console.warn(`[pot-survey] block-graph read failed for '${e}' — lanes treated unblocked:`,t instanceof Error?t.message:t)}}));let{ready:v,blockedCount:y}=W(p,_,X(l));y>0&&console.log(`[pot-survey] frontier: ${y} lane(s) held back by unsatisfied blocked_by; ${v.length} ready`);let b=L(a,i),x=b?[]:v.filter(e=>R(e.harness_slug,a)&&z(e.harness_slug,a)&&V(e.plan_slug,a));b&&console.log(`[pot-survey] new-work PAUSED (scopeFilter) — frontier emptied (${v.length} ready item(s) withheld); Mug drives existing placements to terminal.`);let S=x.map(e=>U(e,i)),[C,w]=await Promise.all([D(h.filter(e=>R(e.harness,a)&&z(e.harness,a)&&B(e.id,a))),D(S)]);return{home:o.home,members:o.members,scope:o.scope,plans:C,frontier:w,frontierBlocked:y,frontierQuarantined:f}}function ye(e){return`${e.view}:${e.harness}:${e.id}`}function be(e,t,n){let r=ye(t),i=e.get(r);(!i||i.scope===`workspace`&&n===`members`)&&e.set(r,{candidate:t,scope:n})}async function xe(e,t={}){let r=await(t.listPotSlugs??(async e=>{let{listPots:t}=await n(async()=>{let{listPots:e}=await import(`./_resolve-C4dVSqu0.js`);return{listPots:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37]));return(await t(e)).map(e=>e.slug)}))(e).catch(()=>[]);r.length===0&&t.fallbackHome&&(r=[t.fallbackHome]),r=Array.from(new Set(r));let i=await Promise.all(r.map(async n=>({pot:n,survey:await ve(e,n,{frontierLimit:t.frontierLimit,scopeFilter:t.scopeFilter,deps:t.deps})}))),a=new Map,o=new Map,s=0,c=0;for(let{pot:e,survey:t}of i){for(let n of t.plans)be(a,{...n,pot:e},t.scope);for(let n of t.frontier)be(o,{...n,pot:e},t.scope);s+=t.frontierBlocked,c+=t.frontierQuarantined}let[l,u]=await Promise.all([D([...a.values()].map(e=>e.candidate)),D([...o.values()].map(e=>e.candidate))]);return{perPot:i,crossPot:{plans:l,frontier:u,frontierBlocked:s,frontierQuarantined:c},hives:r}}var Se,Z,Ce,Q,$,we=e((()=>{o(),i(),h(),x(),C(),f(),g(),de(),me(),u(),l(),v(),le(),t(),Se=864e5,Z=Object.fromEntries(r.map((e,t)=>[e,t])),Ce=new Set([`passed`,`deprecated`,`done`]),Q=new Set([`todo`]),$=`(^|[^a-z0-9])(xbench|xbq[a-z0-9]{6}|hiveloop|memcap|memrun)|-instance[_-]|_instance[_-]|deleteme|^e2e-imp|^sb-gym|gym-eval|^bench-|smoke-p[0-9]`}));export{I as _,G as a,V as c,B as d,we as f,ge as g,H as h,K as i,U as l,z as m,q as n,Y as o,L as p,J as r,W as s,X as t,R as u,ve as v,xe as y};