import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";import{T as r,t as i}from"./src-D-SUCKNE.js";import{n as a}from"./change-ledger-Btl6ez63.js";function o(e){return e.runs>0?e.succeeded/e.runs:null}function s(e,t,n={}){let r=Math.max(1,n.minRuns??5),i=Math.max(0,n.neutralBand??.05),a=o(e),s=o(t),c=a!==null&&s!==null?s-a:null;return e.runs<r||t.runs<r||c===null?{successRateDelta:c,verdict:`insufficient-data`}:Math.abs(c)<=i?{successRateDelta:c,verdict:`neutral`}:{successRateDelta:c,verdict:c>0?`improved`:`regressed`}}function c(e,t){return e.length<=t?e:`${e.slice(0,Math.max(0,t-1)).trimEnd()}…`}function l(e){let t=`- [${e.role} · ${e.verdict}]`,n=e.baselineDevAnchorDelta===null?``:`; accept-time dev-anchor Δ ${_(e.baselineDevAnchorDelta)}`;if(e.verdict===`insufficient-data`||e.successRateDelta===null||!e.post){let r=e.post?.runs??0;return`${t} cycle ${e.cycle}: ${e.baseline.runs} baseline / ${r} post live runs — too thin to judge${n}`}let r=o(e.baseline),i=o(e.post),a=r!==null&&i!==null?`${r.toFixed(2)}→${i.toFixed(2)}`:`?`;return`${t} cycle ${e.cycle}: live success ${a} (Δ ${_(e.successRateDelta)}, ${e.baseline.runs}→${e.post.runs} runs)${n}`}function u(e,t={}){let n=Math.max(0,t.maxEntries??8),r=Math.max(0,t.maxBlockChars??1200),i=Math.max(1,t.maxEntryChars??140),a=e.filter(e=>e.verdict!==`pending`).sort((e,t)=>t.acceptedAt-e.acceptedAt).slice(0,n).map(e=>c(l(e),i));for(;a.length>0&&[`## Recent champion outcomes (live post-acceptance measurement)`,...a].join(`
`).length>r;)a.pop();return a}function d(e){let t=v(e.post_runs);return{proposalId:String(e.proposal_id),workspaceId:String(e.workspace_id),harnessSlug:String(e.harness_slug),role:String(e.role),variantId:y(e.variant_id),cycle:Number(e.cycle),acceptedAt:Number(e.accepted_at),baselineDevAnchorDelta:v(e.baseline_dev_anchor_delta),baselineCostDelta:v(e.baseline_cost_delta),baselineProbeStatus:y(e.baseline_probe_status),baseline:{runs:Number(e.baseline_runs??0),succeeded:Number(e.baseline_succeeded??0),failed:Number(e.baseline_failed??0)},postWindowEndsAt:Number(e.post_window_ends_at),post:t===null?null:{runs:t,succeeded:Number(e.post_succeeded??0),failed:Number(e.post_failed??0)},successRateDelta:v(e.success_rate_delta),verdict:String(e.verdict),evaluatedAt:v(e.evaluated_at)}}async function f(e,t){let n=await e`
    SELECT
      count(*) FILTER (WHERE status = 'done')   AS succeeded,
      count(*) FILTER (WHERE status = 'failed') AS failed
    FROM harness_shared.spawned_agents
    WHERE workspace_id = ${t.workspaceId} AND harness_slug = ${t.harnessSlug}
      AND child_role = ${t.role}
      AND status IN ('done', 'failed')
      AND started_at >= to_timestamp(${t.fromMs} / 1000.0)
      AND started_at <  to_timestamp(${t.toMs} / 1000.0)`,r=Number(n[0]?.succeeded??0),i=Number(n[0]?.failed??0);return{runs:r+i,succeeded:r,failed:i}}async function p(e,t){let n=Math.min(Math.max(t.limit??50,1),200);return(await e`
    SELECT * FROM harness_shared.gym_champion_outcomes
     WHERE verdict = 'pending' AND post_window_ends_at <= ${t.now}
       ${t.workspaceId?e`AND workspace_id = ${t.workspaceId}`:e``}
     ORDER BY post_window_ends_at ASC
     LIMIT ${n}`).map(d)}async function m(e,t={}){let n=t.now??Date.now(),r=t.log??(()=>{}),i=await p(e,{now:n,workspaceId:t.workspaceId}),a=0;for(let o of i)try{let i=await f(e,{workspaceId:o.workspaceId,harnessSlug:o.harnessSlug,role:o.role,fromMs:o.acceptedAt,toMs:o.postWindowEndsAt}),c=s(o.baseline,i,t.verdictOpts);await e`
        UPDATE harness_shared.gym_champion_outcomes
           SET post_runs = ${i.runs}, post_succeeded = ${i.succeeded}, post_failed = ${i.failed},
               success_rate_delta = ${c.successRateDelta}, verdict = ${c.verdict}, evaluated_at = ${n}
         WHERE proposal_id = ${o.proposalId} AND verdict = 'pending'`,a++,r(`champion ${o.proposalId} (${o.harnessSlug}/${o.role}) finalized: ${c.verdict}`)}catch(e){r(`champion ${o.proposalId} finalize failed: ${e instanceof Error?e.message:e}`)}return a}async function h(e,t){let n=Math.min(Math.max(t.limit??8,1),50);return(await e`
    SELECT * FROM harness_shared.gym_champion_outcomes
     WHERE workspace_id = ${t.workspaceId} AND harness_slug = ${t.harnessSlug}
     ORDER BY accepted_at DESC
     LIMIT ${n}`).map(d)}async function g(e,t){try{return u(await h(e,{workspaceId:t.workspaceId,harnessSlug:t.harnessSlug,limit:Math.max(16,t.maxEntries??0)}),t)}catch(e){return console.warn(`[gym/post-acceptance-outcomes] outcome read failed — no champion priming this cycle:`,e instanceof Error?e.message:e),[]}}var _,v,y,b=e((()=>{_=e=>`${e>=0?`+`:``}${e.toFixed(2)}`,v=e=>e==null?null:Number(e),y=e=>e==null?null:String(e)}));function x(e){return{workspaceId:k(e.workspace_id),harnessSlug:k(e.harness_slug),enabled:e.enabled===!0||e.enabled===`t`,budgetUsd:O(e.budget_usd),spentUsd:Number(e.spent_usd??0),status:k(e.status),lastCycle:O(e.last_cycle),lastCycleAt:O(e.last_cycle_at),updatedAt:Number(e.updated_at)}}async function S(e,t){let n=t.id??(t.variantId?`${t.variantId}__${t.role}`:(0,D.randomUUID)()),r=t.now??Date.now();return await e`
    INSERT INTO harness_shared.gym_proposals
      (id, workspace_id, harness_slug, cycle, variant_id, role, original_md, proposed_md, rationale,
       dev_anchor_delta, cost_delta, probe_status, status, created_at)
    VALUES (${n}, ${t.workspaceId}, ${t.harnessSlug}, ${t.cycle}, ${t.variantId??null}, ${t.role},
       ${t.originalMd??null}, ${t.proposedMd}, ${t.rationale??null},
       ${t.devAnchorDelta??null}, ${t.costDelta??null}, ${t.probeStatus??null}, 'pending', ${r})
    ON CONFLICT (id) DO UPDATE SET
       proposed_md = EXCLUDED.proposed_md, original_md = EXCLUDED.original_md, rationale = EXCLUDED.rationale,
       dev_anchor_delta = EXCLUDED.dev_anchor_delta, cost_delta = EXCLUDED.cost_delta,
       probe_status = EXCLUDED.probe_status, cycle = EXCLUDED.cycle
     WHERE gym_proposals.status = 'pending'`,n}async function C(e,t){return(await e`
    SELECT * FROM harness_shared.gym_autoloop_config
     WHERE workspace_id = ${t.workspaceId}
       ${t.harnessSlug?e`AND harness_slug = ${t.harnessSlug}`:e``}
     ORDER BY updated_at DESC`).map(x)}async function w(e,t){let n=await e`
    SELECT * FROM harness_shared.gym_autoloop_config
     WHERE workspace_id = ${t.workspaceId} AND harness_slug = ${t.harnessSlug} LIMIT 1`;return n.length?x(n[0]):null}async function T(e,t){let n=t.now??Date.now(),r=await w(e,{workspaceId:t.workspaceId,harnessSlug:t.harnessSlug}),i={workspaceId:t.workspaceId,harnessSlug:t.harnessSlug,enabled:t.enabled??r?.enabled??!1,budgetUsd:t.budgetUsd===void 0?r?.budgetUsd??null:t.budgetUsd,spentUsd:t.spentUsd??r?.spentUsd??0,status:t.status??r?.status??`idle`,lastCycle:t.lastCycle===void 0?r?.lastCycle??null:t.lastCycle,lastCycleAt:t.lastCycleAt===void 0?r?.lastCycleAt??null:t.lastCycleAt,updatedAt:n};return await e`
    INSERT INTO harness_shared.gym_autoloop_config
      (workspace_id, harness_slug, enabled, budget_usd, spent_usd, status, last_cycle, last_cycle_at, updated_at)
    VALUES (${i.workspaceId}, ${i.harnessSlug}, ${i.enabled}, ${i.budgetUsd}, ${i.spentUsd},
       ${i.status}, ${i.lastCycle}, ${i.lastCycleAt}, ${i.updatedAt})
    ON CONFLICT (workspace_id, harness_slug) DO UPDATE SET
       enabled = EXCLUDED.enabled, budget_usd = EXCLUDED.budget_usd, spent_usd = EXCLUDED.spent_usd,
       status = EXCLUDED.status, last_cycle = EXCLUDED.last_cycle, last_cycle_at = EXCLUDED.last_cycle_at,
       updated_at = EXCLUDED.updated_at`,i}function E(e,t){let n=t.now??(()=>Date.now());return async r=>{let i=r.parentOverlay.promptOverrides,a=n();for(let[n,o]of Object.entries(r.overlay.promptOverrides)){let s=i[n]??null;s!==o&&await S(e,{workspaceId:t.workspaceId,harnessSlug:t.harnessSlug,cycle:r.cycle,variantId:r.candidateId,role:n,originalMd:s,proposedMd:o,rationale:r.rationale,devAnchorDelta:r.devAnchorDelta,costDelta:r.costDelta,probeStatus:r.probeStatus,now:a})}await T(e,{workspaceId:t.workspaceId,harnessSlug:t.harnessSlug,lastCycle:r.cycle,lastCycleAt:a,now:a})}}var D,O,k,A=e((()=>{D=t(n(),1),i(),a(),[...r],new Set(r),O=e=>e==null?null:Number(e),k=e=>String(e)}));export{T as a,b as c,E as i,A as n,m as o,C as r,g as s,w as t};