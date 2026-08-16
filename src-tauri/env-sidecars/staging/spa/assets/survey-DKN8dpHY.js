const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/_resolve-M8z8c_vD.js","assets/_resolve-DBbXngn0.js","assets/chunk-ChpBd9eV.js","assets/src-8fWtxfEz.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/src-6Py4l2MU.js","assets/drizzle-orm-BbO4Lkx2.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js","assets/harness-registry-Diy1vc1F.js","assets/preload-helper-CcgcQsTF.js","assets/operator-state-pg-Cytj1dEs.js","assets/db-encryption-ByK3NqqK.js","assets/workspace-registry-Du2UbhlH.js","assets/workspace-als-CSW21ZcE.js","assets/workspace-id-constant-AQ2MH5pQ.js","assets/platform-pot-slug-C6n7Eole.js","assets/hive-identity-eavOoeas.js","assets/hive-store-BZ7bIdOV.js","assets/hive-keypair-SUE_ORXU.js","assets/ed25519-Ca2TnM8n.js","assets/keychain-BbDRFZ2g.js","assets/derive-swarm-topic-DcZJQuLU.js","assets/wake-DZGTDp-E.js","assets/src-B-ourlv1.js","assets/cron-CQ-fl78O.js","assets/carry-note-D0tlwvr1.js","assets/coordination-event-log-browser-s_EyGDm7.js","assets/agent-orders-notify-DSzp1kSm.js","assets/registry-cwbEj3Sv.js","assets/src-rhu3PqlJ.js","assets/src-DZqanng7.js","assets/operator-home-harness-MSlRvOkW.js","assets/workspace-brain-scope-2KYVIPTn.js","assets/server-BXcXKvn3.js","assets/types-DoRTXl1W.js","assets/src-DduH0PES.js","assets/flag-distinct-id-CCLxG4xU.js","assets/lazy-flag-refresh-Rr70cDYT.js"])))=>i.map(i=>d[i]);
import{n as O}from"./chunk-ChpBd9eV.js";import{n as pe,t as fe}from"./preload-helper-CcgcQsTF.js";import{st as w,t as he}from"./src-8fWtxfEz.js";import{A as R,I as me,t as j}from"./src-BB4lVSvl.js";import{S as I,x as _e}from"./git-pipeline-stats-Cj-Hnuaj.js";import{l as K,o as ge}from"./harness-registry-Diy1vc1F.js";import{c as ye,h as we,m as Ee,s as be}from"./work-item-blocking-D8P-UbTl.js";import{G as ke,Jt as Ne,k as Ae,ot as Se,qt as T,v as P}from"./work-items-CNsmfKgm.js";import{M as ve,N as Re,_t as A,vt as De}from"./boot-all-Kp7MAHFZ.js";import{a as Te,n as B}from"./external-blockers-Do8Nx6Qk.js";import{d as Le,p as X}from"./source-BL7J0oFl.js";import{m as $e,p as Ie,u as z}from"./store-DIptaH7t.js";import{d as Me,y as S}from"./placement-watchdog-BmpG5Qpg.js";import{n as Oe,r as Pe}from"./plan-start-state-LpIgP5Nt.js";import{a as Ce,c as Fe,i as xe,l as Be,o as He,s as Ue,u as We}from"./human-queue-Cds0qal3.js";var Ye=O((()=>{Be(),Fe(),Ue(),He(),Ce(),xe()}));function Ge(e){return e?z.severity[e]??0:0}async function D(e){return We(e,{},{features:J,getKey:t=>t.id,tieBreak:(t,a)=>{const s=t.opPriority??Number.POSITIVE_INFINITY,n=a.opPriority??Number.POSITIVE_INFINITY;return s!==n?s-n:t.id.localeCompare(a.id)}})}var $,N,H,U,W,Y,J,Qe=O((()=>{j(),Ie(),Ye(),$=Object.fromEntries(R.map((e,t)=>[e,R.length-1-t])),N={importance:4,blockingImpact:1,staleness:3,escalationPressure:5},H={name:"plan-importance",weight:N.importance,description:'Declared importance of the plan (its hottest open item) or work-item (urgent..low) — the primary "which plan matters" placement signal (B-08/P-010).',score(e){const t=new Map;for(const a of e){const s=a.importance??"normal",n=$[s]??$.normal;t.set(a.id,{value:n,reasons:s!=="normal"?[`${s} importance`]:[]})}return t}},U={name:"blocking-impact",weight:N.blockingImpact,description:"Downstream cost of leaving this unplaced: `blocks` out-edges, inbound references, severity prior — consuming consume-edges B-08 per-edge weights.",score(e){const t=z,a=new Map;for(const s of e){const n=s.blocksOut??0,r=s.inboundRefs??0,o=Ge(s.severity),i=t.blocksOut*n+t.inboundRef*r+o,d=[];n>0&&d.push(`blocks ${n} downstream item(s)`),r>0&&d.push(`${r} inbound reference(s)`),(s.severity==="critical"||s.severity==="major")&&d.push(`${s.severity} severity`),a.set(s.id,{value:i,reasons:d})}return a}},W={name:"staleness",weight:N.staleness,description:"Anti-starvation aging (P-031): a long-unplaced candidate self-promotes on B-08's log staleness curve so the backlog tail never starves behind fresh arrivals.",score(e){const t=new Map;for(const a of e){const s=Math.max(0,a.ageDays??0),n=Math.round(($e(s)-1)*100)/100;t.set(a.id,{value:n,reasons:n>=.3?[`unplaced ${Math.round(s)}d (aging +${n})`]:[]})}return t}},Y={name:"escalation-pressure",weight:N.escalationPressure,description:"Open escalations / needs-human items waiting on this plan or work-item — unattended decisions gate the work behind them.",score(e){const t=new Map;for(const a of e){const s=Math.max(0,a.escalations??0);t.set(a.id,{value:s,reasons:s>0?[`${s} open escalation(s)/needs-human`]:[]})}return t}},J=[H,U,W,Y]}));function Z(e,t){if(!e)return 0;const a=new Date(e).getTime();return Number.isFinite(a)?Math.max(0,(t-a)/re):0}async function q(e,t,a=K){const s=(await a(e)).projects.filter(r=>r.hive_slug===t&&r.slug!==t).map(r=>r.slug),n=s.length>0?Array.from(new Set([t,...s])):[];return{home:t,members:s,surveySlugs:n,scope:n.length>0?"members":"workspace"}}function Ve(e,t){return e?e.pauseNewWork?!0:typeof e.pausedUntil=="number"&&t<e.pausedUntil:!1}function G(e,t){return!t?.allowedHarnesses||t.allowedHarnesses.length===0?!0:t.allowedHarnesses.includes(e)}function Q(e,t){return!t?.stoppedHarnesses||t.stoppedHarnesses.length===0?!0:!t.stoppedHarnesses.includes(e)}function je(e,t){return!t?.eligiblePlans||t.eligiblePlans.length===0?!0:t.eligiblePlans.includes(e)}function Ke(e,t){return e?!t?.eligiblePlans||t.eligiblePlans.length===0?!0:t.eligiblePlans.includes(e):t?.includeUnplannedWork!==!1}function Xe(e){let t=null;for(const a of e.items){if(a.status==="done"||a.status==="dropped")continue;const s=R.includes(a.importance)?a.importance:"normal";(t===null||M[s]<M[t])&&(t=s)}return t??"normal"}function ze(e,t,a={}){const s=Pe(e.opStatus,e.status),n=s==="started";if(!n&&(!a.includeUnstarted||s==="done"||me(e.status)))return null;let r=0,o=0;for(const i of e.items)(i.status==="todo"||i.status==="wip")&&(r+=1),i.status==="needs-human"&&(o+=1);return{id:e.planSlug,view:"plan",harness:e.harnessSlug,title:e.title??e.planSlug,importance:Xe(e),ageDays:Z(e.opUpdatedAt??e.updatedAt,t),opPriority:e.opPriority,escalations:o,openItems:r,...n?{}:{needsStart:!0}}}function Je(e,t){return{id:e.feature_id,view:"work-item",harness:e.harness_slug,title:e.title??e.feature_id,importance:"normal",ageDays:Z(e.created_ts,t),opPriority:e.feature_order,...e.severity?{severity:e.severity}:{}}}function ee(e,t,a){const s=new Map;for(const o of e){const i=s.get(o.harness_slug);i?i.push(o):s.set(o.harness_slug,[o])}const n=[];let r=0;for(const[o,i]of s){const d=t.get(o),m=i.some(l=>l.payload&&B(l.payload).length>0);if((!d||d.blockers.size===0)&&!m){n.push(...i);continue}const p=new Map;for(const l of i){const f=B(l.payload).map(g=>`${g.kind}:${g.capability}:${g.ref}`);p.set(l.feature_id,{id:l.feature_id,status:"todo",blockedBy:d?.blockers.get(l.feature_id)??[],...f.length>0?{externalBlockers:f}:{}})}for(const l of i)for(const f of d?.blockers.get(l.feature_id)??[]){if(p.has(f))continue;const g=d?.statuses.get(f);g!=null&&p.set(f,{id:f,status:g,blockedBy:[]})}const{ready:c}=we([...p.values()],new Set,oe),_=new Set(c.map(l=>l.id));for(const l of i){if(!_.has(l.feature_id)){r+=1;continue}if(a&&l.payload&&typeof l.payload=="object"&&l.payload!==null&&"plan_item"in l.payload){const f=l.payload.plan_item;if(f&&f!==null&&typeof f=="object"&&"plan_slug"in f&&"item_id"in f){const g=f.plan_slug,v=f.item_id,L=a.planItemBlockers.get(g)?.get(v)??[];let b=!1;for(const k of L){const y=a.planItemStatuses.get(g)?.get(k);if(!y||!ie.has(y)){b=!0;break}}if(b){r+=1;continue}}}n.push(l)}}return{ready:n,blockedCount:r}}async function te(e,t,a,s=50){const n=S().breakerThreshold;return await e`
    SELECT feature_id, harness_slug, title, item_kind, created_ts, feature_order,
           source_plan_slug AS plan_slug, payload
      FROM harness_shared.harness_features_consolidated wi
     WHERE workspace_id = ${t}
       AND ${T(e,t)}
       -- work-item-status-full-unify (2026-07-19, migration 638): feature-family status
       -- 'todo' was rewritten to the unified claimable token 'open' (issue-family already
       -- used 'open'). This literal was never updated, so every genuinely-placeable
       -- feature-family row has been silently invisible to the Mug's survey since that
       -- migration ran (EI-13699 2026-07-17 pre-dates it and had a different proximate
       -- cause; EI-18690462961089460 2026-07-26 is the post-migration recurrence this
       -- fixes — pot:survey read frontier:0 while work_items:claimable read ~1062).
       AND status = 'open'
       AND (taken_by IS NULL OR taken_by = '')
       AND ${A(e,t)}
       -- EI-13501: a claim-held item (payload._claimHold — the SAME general-purpose
       -- "do not self-place" marker claimFloorsWhereSql already honors for the scheduler
       -- claim path, e.g. a leader-held feature or an owner GO/NO-GO gate) is structurally
       -- NOT cup-placeable. Without this the Mug's own frontier count disagreed with what
       -- claim_next/scheduler:get_next would actually serve — every item in the live feature
       -- frontier was claim-held on 2026-07-17 (WI-321/357/662/1281/1774), so this floor was
       -- previously a 100% false-positive "N ready to place" signal, not an edge case.
       AND ${P(e)}
       AND NOT EXISTS (
         SELECT 1 FROM harness_shared.pot_placements p
          WHERE p.workspace_id = wi.workspace_id
            AND p.work_item_id = wi.feature_id
            AND p.status = 'cursed'
            AND p.fail_count >= ${n}
            -- Scope the curse to THIS pot's own installs (papercup→papercusp migration follow-up,
            -- 2026-06-20): a curse from a RETIRED/foreign install must not hide the item from the
            -- home pot's frontier. Unscoped only in the workspace-wide fallback (surveySlugs empty).
            ${a.length>0?e`AND p.install_slug = ANY(${a})`:e``}
       )
       -- EI-13695: a row carrying a surviving work-item checkpoint was already
       -- attempted (a cup died before converging state) — it is RECONCILE work
       -- (fetchReconcileFrontier), never fresh placeable frontier.
       AND NOT ${ae(e)}
       ${a.length>0?e`AND harness_slug = ANY(${a})`:e``}
       AND harness_slug !~* ${E}
     ORDER BY created_ts ASC
     LIMIT ${s}`}async function Ze(e,t,a,s=10){const n=S().breakerThreshold;return await e`
    SELECT feature_id, harness_slug, title, item_kind, created_ts, feature_order,
           source_plan_slug AS plan_slug, payload,
           COALESCE(payload -> '_ei' ->> 'severity', 'minor') AS severity
      FROM harness_shared.work_items wi
     WHERE workspace_id = ${t}
       AND item_kind IN ('bug', 'change', 'task')
       -- work-item-status-full-unify (2026-07-19, migration 638): feature-family status
       -- 'todo' was rewritten to the unified claimable token 'open' (issue-family already
       -- used 'open'). This literal was never updated, so every genuinely-placeable
       -- feature-family row has been silently invisible to the Mug's survey since that
       -- migration ran (EI-13699 2026-07-17 pre-dates it and had a different proximate
       -- cause; EI-18690462961089460 2026-07-26 is the post-migration recurrence this
       -- fixes — pot:survey read frontier:0 while work_items:claimable read ~1062).
       AND status = 'open'
       AND (taken_by IS NULL OR taken_by = '')
       AND COALESCE(payload -> '_ei' ->> 'severity', 'minor') IN ('critical', 'major')
       AND ${A(e,t)}
       -- EI-13501: this escalated-issue slice grew up alongside the feature frontier
       -- (see fetchFrontierRows) and never inherited the self-select exclusion floors
       -- claimNextIssueWorkItem already enforces for the SAME kinds — so an item that is
       -- structurally cup-forbidden (owner-decision/needs-human, an explicit GO/NO-GO
       -- claim-hold, or last-mile LIVE-rig/VM verification) still counted as a "ready to
       -- place" frontier item, driving recurring false Mug-dark blocker escalations
       -- (live-verified 2026-07-17: 4/10 of the current escalated-issue frontier carried
       -- payload.needsHuman:true). Mirror the SAME three floors, one source of truth.
       AND ${Se(e)}
       AND ${P(e)}
       AND ${Ae(e,!1)}
       AND NOT EXISTS (
         SELECT 1 FROM harness_shared.pot_placements p
          WHERE p.workspace_id = wi.workspace_id
            AND p.work_item_id = wi.feature_id
            AND p.status = 'cursed'
            AND p.fail_count >= ${n}
            ${a.length>0?e`AND p.install_slug = ANY(${a})`:e``}
       )
       ${a.length>0?e`AND harness_slug = ANY(${a})`:e``}
       AND harness_slug !~* ${E}
     ORDER BY (COALESCE(payload -> '_ei' ->> 'severity', 'minor') = 'critical') DESC, created_ts ASC
     LIMIT ${s}`}async function qe(e,t,a){const s=S().breakerThreshold,n=await e`
    SELECT count(*)::int AS n
      FROM harness_shared.harness_features_consolidated wi
     WHERE workspace_id = ${t}
       AND ${T(e,t)}
       -- work-item-status-full-unify (2026-07-19, migration 638): feature-family status
       -- 'todo' was rewritten to the unified claimable token 'open' (issue-family already
       -- used 'open'). This literal was never updated, so every genuinely-placeable
       -- feature-family row has been silently invisible to the Mug's survey since that
       -- migration ran (EI-13699 2026-07-17 pre-dates it and had a different proximate
       -- cause; EI-18690462961089460 2026-07-26 is the post-migration recurrence this
       -- fixes — pot:survey read frontier:0 while work_items:claimable read ~1062).
       AND status = 'open'
       AND (taken_by IS NULL OR taken_by = '')
       AND ${A(e,t)}
       -- EI-13501: MUST mirror fetchFrontierRows' claim-hold exclusion (this count
       -- gates starvation/throughput signals — the same drift class this comment
       -- already warns about for the checkpoint exclusion below).
       AND ${P(e)}
       AND NOT EXISTS (
         SELECT 1 FROM harness_shared.pot_placements p
          WHERE p.workspace_id = wi.workspace_id
            AND p.work_item_id = wi.feature_id
            AND p.status = 'cursed'
            AND p.fail_count >= ${s}
            -- Scope the curse to THIS pot's own installs (papercup→papercusp migration follow-up,
            -- 2026-06-20): a curse from a RETIRED/foreign install must not hide the item from the
            -- home pot's frontier. Unscoped only in the workspace-wide fallback (surveySlugs empty).
            ${a.length>0?e`AND p.install_slug = ANY(${a})`:e``}
       )
       -- EI-13695: checkpoint-carrying rows are RECONCILE, not placeable — MUST
       -- mirror fetchFrontierRows (this count gates starvation/throughput signals).
       AND NOT ${ae(e)}
       ${a.length>0?e`AND harness_slug = ANY(${a})`:e``}
       AND harness_slug !~* ${E}`;return Number(n[0]?.n??0)}async function et(e,t,a){const s=S().breakerThreshold,n=await e`
    SELECT count(*)::int AS n
      FROM harness_shared.harness_features_consolidated f
     WHERE workspace_id = ${t}
       AND ${T(e,t)}
       -- work-item-status-full-unify (2026-07-19, migration 638): feature-family status
       -- 'todo' was rewritten to the unified claimable token 'open' (issue-family already
       -- used 'open'). This literal was never updated, so every genuinely-placeable
       -- feature-family row has been silently invisible to the Mug's survey since that
       -- migration ran (EI-13699 2026-07-17 pre-dates it and had a different proximate
       -- cause; EI-18690462961089460 2026-07-26 is the post-migration recurrence this
       -- fixes — pot:survey read frontier:0 while work_items:claimable read ~1062).
       AND status = 'open'
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
       AND COALESCE(${A(e,t)}, FALSE) = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM harness_shared.pot_placements p
          WHERE p.workspace_id = f.workspace_id
            AND p.work_item_id = f.feature_id
            AND p.status = 'cursed'
            AND p.fail_count >= ${s}
            ${a.length>0?e`AND p.install_slug = ANY(${a})`:e``}
       )
       ${a.length>0?e`AND harness_slug = ANY(${a})`:e``}
       AND harness_slug !~* ${E}`;return Number(n[0]?.n??0)}function ae(e){return e`EXISTS (
    SELECT 1 FROM harness_shared.carry_notes cn
     WHERE cn.workspace_id = wi.workspace_id
       AND cn.scope IN ('workitem:' || wi.harness_slug || ':' || wi.feature_id, 'workitem:*:' || wi.feature_id)
       AND btrim(cn.note) <> '')`}async function tt(e,t,a,s=10){const n=S().breakerThreshold,r=await e`
    SELECT f.feature_id, f.harness_slug, f.title, f.item_kind,
           left(btrim(cn.note), 240) AS checkpoint_head,
           cn.updated_ts AS checkpoint_updated_ts,
           count(*) OVER ()::int AS total
      FROM harness_shared.harness_features_consolidated f
      JOIN LATERAL (
        SELECT note, updated_ts FROM harness_shared.carry_notes cn
         WHERE cn.workspace_id = f.workspace_id
           AND cn.scope IN ('workitem:' || f.harness_slug || ':' || f.feature_id, 'workitem:*:' || f.feature_id)
           AND btrim(cn.note) <> ''
         ORDER BY cn.updated_ts DESC NULLS LAST
         LIMIT 1
      ) cn ON true
     WHERE workspace_id = ${t}
       AND ${T(e,t)}
       -- work-item-status-full-unify (2026-07-19, migration 638): feature-family status
       -- 'todo' was rewritten to the unified claimable token 'open' (issue-family already
       -- used 'open'). This literal was never updated, so every genuinely-placeable
       -- feature-family row has been silently invisible to the Mug's survey since that
       -- migration ran (EI-13699 2026-07-17 pre-dates it and had a different proximate
       -- cause; EI-18690462961089460 2026-07-26 is the post-migration recurrence this
       -- fixes — pot:survey read frontier:0 while work_items:claimable read ~1062).
       AND status = 'open'
       AND (taken_by IS NULL OR taken_by = '')
       AND ${A(e,t)}
       AND NOT EXISTS (
         SELECT 1 FROM harness_shared.pot_placements p
          WHERE p.workspace_id = f.workspace_id
            AND p.work_item_id = f.feature_id
            AND p.status = 'cursed'
            AND p.fail_count >= ${n}
            ${a.length>0?e`AND p.install_slug = ANY(${a})`:e``}
       )
       ${a.length>0?e`AND harness_slug = ANY(${a})`:e``}
       AND harness_slug !~* ${E}
     ORDER BY cn.updated_ts DESC NULLS LAST
     LIMIT ${s}`;return{rows:r.map(({total:o,...i})=>({...i,checkpoint_updated_ts:i.checkpoint_updated_ts==null||!Number.isFinite(Number(i.checkpoint_updated_ts))?null:Number(i.checkpoint_updated_ts)})),total:Number(r[0]?.total??0)}}function Nt(e){return e.placeable===0&&e.quarantined>0}async function At(e,t){const{sql:a}=w(),s=await q(e,t),n=await qe(a,e,s.surveySlugs);if(n===0)return{ready:0,blocked:0,placeableShaped:0};const r=await te(a,e,s.surveySlugs,Math.min(Math.max(n,50),200)),o=new Map;await Promise.all([...new Set(r.map(p=>p.harness_slug))].map(async p=>{try{o.set(p,await se(a,e,p))}catch(c){console.warn(`[pot-frontier-depth] block-graph read failed for '${p}' — lanes treated unblocked:`,c instanceof Error?c.message:c)}}));const i=s.surveySlugs.length>0?s.surveySlugs:[t],{ready:d,blockedCount:m}=ee(r,o,ne(await Promise.all(i.map(async p=>{try{return await X({harnessSlug:p,workspaceId:e})}catch(c){return console.warn(`[pot-frontier-depth] plan read failed for '${p}' — plan-item lanes treated unblocked:`,c instanceof Error?c.message:c),[]}}))));return{ready:d.length,blocked:m,placeableShaped:n}}async function se(e,t,a){const s=await be.blockersFor(a),n=new Set;for(const o of s.values())for(const i of o)n.add(i);let r=new Map;if(n.size>0){const o=await e`
      SELECT feature_id, status
        FROM harness_shared.harness_features_consolidated
       WHERE workspace_id = ${t}
         AND harness_slug = ${a}
         AND feature_id = ANY(${Array.from(n)})`;r=new Map(o.map(i=>[i.feature_id,i.status]))}return{blockers:s,statuses:r}}function ne(e){const t=new Map,a=new Map;for(const s of e)for(const n of s){const r=n.planSlug;t.has(r)||(t.set(r,new Map),a.set(r,new Map));const o=t.get(r),i=a.get(r),d=new Map;for(const m of n.items)d.set(m.id,m.status);for(const m of n.items){o.set(m.id,m.blockedBy??[]);for(const p of m.blockedBy??[]){const c=d.get(p);c&&i.set(p,c)}}}return{planItemBlockers:t,planItemStatuses:a}}function at(e){return{loadRegistry:K,listPlanRows:t=>X({harnessSlug:t,workspaceId:e}),fetchFrontier:(t,a)=>{const{sql:s}=w();return te(s,e,t,a)},fetchEscalatedIssues:(t,a)=>{const{sql:s}=w();return Ze(s,e,t,a)},fetchBlockGraph:t=>{const{sql:a}=w();return se(a,e,t)},fetchQuarantinedCount:async t=>{try{const{sql:a}=w();return await I(()=>et(a,e,t),{label:"pot-survey.countQuarantinedFrontier"})}catch(a){return console.warn("[pot-survey] quarantined-frontier count failed — reporting 0:",a instanceof Error?a.message:a),0}},fetchReconcile:async(t,a)=>{try{const{sql:s}=w();return await I(()=>tt(s,e,t,a),{label:"pot-survey.fetchReconcileFrontier"})}catch(s){return console.warn("[pot-survey] reconcile-frontier read failed — reporting none:",s instanceof Error?s.message:s),{rows:[],total:0}}},now:()=>Date.now()}}async function st(e,t,a={}){const s={...at(e),...a.deps},n=s.now(),r=a.scopeFilter,o=await q(e,t,s.loadRegistry),i=o.surveySlugs.length>0&&(a.extraSurveySlugs?.length??0)>0?Array.from(new Set([...o.surveySlugs,...a.extraSurveySlugs])):o.surveySlugs;let d;if(i.length>0)d=i;else{const u=await s.loadRegistry(e);d=Array.from(new Set([t,...u.projects.filter(h=>h.harness_kind==="hive").map(h=>h.slug)]))}const[m,p,c,_,l]=await Promise.all([Re(d,2,async u=>{try{return await I(()=>s.listPlanRows(u),{label:"pot-survey.listPlanRows"})}catch(h){return console.warn(`[pot-survey] plan read failed for '${u}' — skipped:`,h instanceof Error?h.message:h),[]}}),s.fetchFrontier(i,a.frontierLimit??50),s.fetchEscalatedIssues(i,10).catch(u=>(console.warn("[pot-survey] escalated-issue frontier read failed — reporting none:",u instanceof Error?u.message:u),[])),s.fetchQuarantinedCount(i),s.fetchReconcile(i,10)]),f=[...p,...c],g=[],v=new Set;for(const u of m)for(const h of u){const F=`${h.harnessSlug}::${h.planSlug}`;if(v.has(F))continue;v.add(F);const x=ze(h,n,{includeUnstarted:(r?.eligiblePlans?.length??0)>0&&!!r?.eligiblePlans?.includes(h.planSlug)});x&&g.push(x)}const L=[...new Set(f.map(u=>u.harness_slug))],b=new Map;await Promise.all(L.map(async u=>{try{b.set(u,await s.fetchBlockGraph(u))}catch(h){console.warn(`[pot-survey] block-graph read failed for '${u}' — lanes treated unblocked:`,h instanceof Error?h.message:h)}}));const{ready:k,blockedCount:y}=ee(f,b,ne(m));y>0&&console.log(`[pot-survey] frontier: ${y} lane(s) held back by unsatisfied blocked_by; ${k.length} ready`);const C=Ve(r,n),le=C?[]:k.filter(u=>G(u.harness_slug,r)&&Q(u.harness_slug,r)&&Ke(u.plan_slug,r));C&&console.log(`[pot-survey] new-work PAUSED (scopeFilter) — frontier emptied (${k.length} ready item(s) withheld); Mug drives existing placements to terminal.`);const ce=le.map(u=>Je(u,n)),[ue,de]=await Promise.all([D(g.filter(u=>G(u.harness,r)&&Q(u.harness,r)&&je(u.id,r))),D(ce)]);return{home:o.home,members:o.members,scope:o.scope,plans:ue,frontier:de,frontierBlocked:y,frontierQuarantined:_,frontierReconcile:l.total,reconcileRows:l.rows}}function nt(e){return`${e.view}:${e.harness}:${e.id}`}function V(e,t,a){const s=nt(t),n=e.get(s);(!n||n.scope==="workspace"&&a==="members")&&e.set(s,{candidate:t,scope:a})}async function St(e,t={}){let a=await(t.listPotSlugs??(async c=>{const{listPots:_}=await fe(async()=>{const{listPots:l}=await import("./_resolve-M8z8c_vD.js");return{listPots:l}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41]));return(await _(c)).map(l=>l.slug)}))(e).catch(()=>[]);a.length===0&&t.fallbackHome&&(a=[t.fallbackHome]),a=Array.from(new Set(a));const s=await Promise.all(a.map(async c=>({pot:c,survey:await st(e,c,{frontierLimit:t.frontierLimit,scopeFilter:t.scopeFilter,deps:t.deps})}))),n=new Map,r=new Map;let o=0,i=0,d=0;for(const{pot:c,survey:_}of s){for(const l of _.plans)V(n,{...l,pot:c},_.scope);for(const l of _.frontier)V(r,{...l,pot:c},_.scope);o+=_.frontierBlocked,i+=_.frontierQuarantined,d+=_.frontierReconcile}const[m,p]=await Promise.all([D([...n.values()].map(c=>c.candidate)),D([...r.values()].map(c=>c.candidate))]);return{perPot:s,crossPot:{plans:m,frontier:p,frontierBlocked:o,frontierQuarantined:i,frontierReconcile:d},hives:a}}var re,rt,M,ie,oe,E,vt=O((()=>{he(),j(),_e(),Ne(),De(),ke(),ge(),Le(),Oe(),Qe(),ye(),Ee(),Te(),Me(),ve(),pe(),re=864e5,rt=2,M=Object.fromEntries(R.map((e,t)=>[e,t])),ie=new Set(["passed","deprecated","done"]),oe=new Set(["todo"]),E="(^|[^a-z0-9])(xbench|xbq[a-z0-9]{6}|hiveloop|memcap|memrun)|-instance[_-]|_instance[_-]|deleteme|^e2e-imp|^sb-gym|gym-eval|^bench-|smoke-p[0-9]"}));export{ze as _,te as a,st as b,ee as c,G as d,je as f,Q as g,Ve as h,Ze as i,Ke as l,Nt as m,qe as n,se as o,vt as p,et as r,tt as s,ne as t,Je as u,At as v,St as x,q as y};
