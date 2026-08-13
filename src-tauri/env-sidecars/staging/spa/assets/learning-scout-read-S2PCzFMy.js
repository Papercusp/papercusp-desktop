const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/success-metrics-_VSHVpxS.js","assets/success-metrics-eCz7LPzk.js","assets/chunk-ChpBd9eV.js","assets/preload-helper-CcgcQsTF.js","assets/rubric-template-DTNahpRp.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js","assets/template-registry-D6i5To6C.js","assets/federated-priming-DWrpJQki.js","assets/scheduler-9KmHbqG0.js","assets/cadence-B3FYrF9H.js","assets/capacity-errors-3NVhSgTZ.js","assets/agent-C_2PutXi.js","assets/__vite-browser-external-56mrcCg8.js","assets/capacity-probe-hmHPCNg1.js","assets/routed-ledger-lXqnXidN.js","assets/src-BmBNODK0.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/src-6Py4l2MU.js","assets/drizzle-orm-BbO4Lkx2.js","assets/change-feed-deps-CBpHvodj.js","assets/types-Csy-8Ape.js","assets/workspace-brain-scope-CSTdDbOD.js","assets/server-CB1HiStO.js","assets/types-B6UfiA7g.js","assets/src-CL56NiZm.js","assets/flag-distinct-id-CCLxG4xU.js","assets/lazy-flag-refresh-C5_zF7pP.js","assets/workspace-registry-Du2UbhlH.js","assets/workspace-als-CSW21ZcE.js","assets/workspace-id-constant-AQ2MH5pQ.js","assets/tick-ledger-D5mjMs9W.js","assets/pot-scope-DYK3r_aB.js","assets/hive-federation-CBwEfakT.js","assets/harness-registry-Cyujgx97.js","assets/operator-state-pg-DNPN5cby.js","assets/db-encryption-ByK3NqqK.js","assets/platform-pot-slug-C6n7Eole.js","assets/hive-directory-meta-BYz1LoCV.js","assets/hive-store-Bq5Drf--.js","assets/pot-membership-_CBaMRYQ.js","assets/invariants-C_hRulyl.js","assets/critique-core-CjkK1mtu.js","assets/digest-DOuanECE.js","assets/policy-ChCrXBc4.js","assets/lenses-B9ZkYICQ.js","assets/routed-ledger-Ba_VCSyk.js","assets/signal-accumulator-CKdJ-o5O.js","assets/started-BElZSRWs.js","assets/cadence-4-_zGOTn.js","assets/lenses-dEHOnSRc.js"])))=>i.map(i=>d[i]);
import{n as x}from"./chunk-ChpBd9eV.js";import{n as j,t as L}from"./preload-helper-CcgcQsTF.js";import{i as z,t as J}from"./src-CxtpAvdw.js";import"./platform-pot-slug-C6n7Eole.js";import{c as K,i as Q,n as X,r as Z}from"./work-item-blocking-CPkS3jV-.js";import{t as q}from"./pot-membership-_CBaMRYQ.js";import{i as N,r as ee}from"./degraded-snapshot-dcpcqMtk.js";function b(t){if(t instanceof Date)return t.toISOString();if(typeof t=="string"&&t){const n=Date.parse(t);return Number.isNaN(n)?null:new Date(n).toISOString()}return typeof t=="number"&&Number.isFinite(t)?new Date(t).toISOString():null}function I(t,n){for(const l of n){const d=t[l];if(typeof d=="string"&&d)return d}return null}function te(t){if(!t)return null;const n=t.detail&&typeof t.detail=="object"&&!Array.isArray(t.detail)?t.detail:null;return{at:b(t.tick_at??t.ticked_at??t.created_at??t.at),outcome:I(t,["status","gate_outcome","outcome","decision"]),detail:I(t,["gate","gate_reason","reason","note"])??(n?I(n,["reason","error","stop"]):null)}}function ne(t){const n=t.detail&&typeof t.detail=="object"&&!Array.isArray(t.detail)?t.detail:null,l=I(t,["status"]),d=n?I(n,["error","reason"]):null,g=(n?I(n,["stop"]):null)??I(t,["gate"])??(l==="error"&&d?d.slice(0,120):null),i=t.budget_used_usd==null?null:Number(t.budget_used_usd),a=n?I(n,["cycleId"]):null,R={},m=n?.groundingLanes;if(m&&typeof m=="object"&&!Array.isArray(m))for(const[E,S]of Object.entries(m)){const h=typeof S=="string"?Number(S):S;typeof h=="number"&&Number.isFinite(h)&&h>0&&(R[E]=h)}return{at:b(t.tick_at??t.ticked_at??t.created_at??t.at),status:l,stop:g,generated:w(t.ideas_generated),routed:w(t.ideas_routed),deduped:w(t.ideas_deduped),spendUsd:i!=null&&Number.isFinite(i)?i:null,cycleId:a,lenses:{},groundingLanes:R}}function se(t){const n=[],l=t.scoutLensSample.filter(a=>typeof a=="string"&&a.length>0);if(l.length>=P){const a=new Map;for(const E of l)a.set(E,(a.get(E)??0)+1);const[R,m]=[...a.entries()].sort((E,S)=>S[1]-E[1])[0];m/l.length>=W&&n.push({key:"single-lens-collapse",severity:m===l.length?"bad":"warn",rubricCriterion:"multi-lens-routing",summary:`${m} of the newest ${l.length} ${z("scout",{lower:!0})}-routed ideas are '${R}' — the per-lens learning subsystem has a dimension that never varies (the 17-day WI-4482 shape).`})}let d=0;for(const a of t.ticks)if(a.status==="ran")if(a.stop==="budget-exhausted"&&a.routed===0)d+=1;else break;d>=2&&n.push({key:"budget-exhausted-streak",severity:d>=4?"bad":"warn",rubricCriterion:"multi-lens-routing",summary:`${d} consecutive cycles exhausted their budget with 0 ideas routed — spend with no yield; the knobs are likely sized for a smaller roster.`});const g=t.recent.length,i=t.recent.filter(a=>a.humanGrade!=null).length;return g>=H&&i===0&&n.push({key:"grading-starvation",severity:"warn",rubricCriterion:"grading-loop-closure",summary:`0 of the newest ${g} routed ideas are graded — the grade→learn half of the loop is starving.`}),{status:n.some(a=>a.severity==="bad")?"bad":n.length>0?"warn":t.ticks.length===0&&t.recent.length===0?"neutral":"good",markers:n}}function U(t,{hive:n,memberSlugs:l}){return l?.length?n==="papercusp"?t`AND (sri.harness_slug IN ${t(l)} OR sri.harness_slug IS NULL)`:t`AND sri.harness_slug IN ${t(l)}`:t``}async function re({workspaceId:t,sql:n,hive:l=null,hiveMemberSlugs:d=null}){try{const g=typeof l=="string"&&l.trim()?l.trim():null;return(await n`
      SELECT DISTINCT ON (sri.idea_id)
             sri.idea_id, sri.title, sri.routed_at,
             substring(sri.routed_ref from 'plan:(.*)') AS plan_slug,
             p.status AS plan_status, p.version AS plan_version, p.updated_at AS plan_updated_at
        FROM harness_shared.scout_routed_ideas sri
        LEFT JOIN harness_shared.harness_plans p
          ON p.workspace_id = sri.workspace_id
         AND p.plan_slug = substring(sri.routed_ref from 'plan:(.*)')
       WHERE sri.workspace_id = ${t}
         AND sri.rail = 'plan'
         AND sri.routed_ref LIKE 'plan:%'
         ${U(n,{hive:g,memberSlugs:g?d?.length?d:[g]:null})}
       ORDER BY sri.idea_id, p.updated_at DESC NULLS LAST
    `).map(i=>{const a=i.plan_version==null?null:Number(i.plan_version);return{ideaId:String(i.idea_id??""),planSlug:String(i.plan_slug??""),title:typeof i.title=="string"&&i.title?i.title:null,routedAt:b(typeof i.routed_at=="string"?Number(i.routed_at):i.routed_at),planStatus:typeof i.plan_status=="string"&&i.plan_status?i.plan_status:null,planVersion:a!=null&&Number.isFinite(a)?a:null,planUpdatedAt:b(i.plan_updated_at),revised:a!=null&&Number.isFinite(a)&&a>1}}).filter(i=>i.planSlug).sort((i,a)=>(a.routedAt??"").localeCompare(i.routedAt??"")).slice(0,12)}catch(g){return N(g)||console.warn("[learning.scout] drafts read failed:",g instanceof Error?g.message:g),[]}}async function me(t,n,l={}){const d=typeof l.hive=="string"&&l.hive.trim()?l.hive.trim():null,g=d?l.hiveMemberSlugs?.length?l.hiveMemberSlugs:[d]:null,i=U(t,{hive:d,memberSlugs:g}),a=(await t`
    SELECT rail, count(*)::int AS count
      FROM harness_shared.scout_routed_ideas sri
     WHERE sri.workspace_id = ${n}
       ${i}
     GROUP BY rail
     ORDER BY count DESC, rail ASC
  `).map(e=>({rail:String(e.rail??""),count:Number(e.count??0)})),R=a.reduce((e,o)=>e+o.count,0),m=(await t`
    SELECT idea_id, lens, rail, routed_ref, title, routed_at, outcome,
           human_grade, human_feedback, graded_by, origin, cycle_id,
           addresses_pattern_refs, harness_slug
      FROM harness_shared.scout_routed_ideas sri
     WHERE sri.workspace_id = ${n}
       ${i}
     ORDER BY routed_at DESC
     LIMIT 50
  `).map(e=>({ideaId:String(e.idea_id??""),lens:String(e.lens??""),rail:String(e.rail??""),routedRef:String(e.routed_ref??""),title:typeof e.title=="string"&&e.title?e.title:null,routedAt:b(typeof e.routed_at=="string"?Number(e.routed_at):e.routed_at),outcome:typeof e.outcome=="string"&&e.outcome?e.outcome:null,humanGrade:e.human_grade==null?null:Number(e.human_grade),humanFeedback:typeof e.human_feedback=="string"&&e.human_feedback?e.human_feedback:null,gradedBy:typeof e.graded_by=="string"&&e.graded_by?e.graded_by:null,origin:typeof e.origin=="string"&&e.origin?e.origin:null,cycleId:typeof e.cycle_id=="string"&&e.cycle_id?e.cycle_id:null,addressesPatternRefs:Array.isArray(e.addresses_pattern_refs)?e.addresses_pattern_refs.filter(o=>typeof o=="string"&&o.length>0):[],harnessSlug:typeof e.harness_slug=="string"&&e.harness_slug?e.harness_slug:null}));let E={};try{const e=[...new Set(m.flatMap(o=>o.addressesPatternRefs).filter(o=>o.startsWith("wi:")).map(o=>o.slice(3)).filter(Boolean))];if(e.length>0){const o=await t`
        SELECT issue_id, title /* grounding-titles */
          FROM harness_shared.engineer_issues
         WHERE workspace_id = ${n}
           AND issue_id IN ${t(e)}
      `;for(const r of o){const p=typeof r.issue_id=="string"?r.issue_id:"",u=typeof r.title=="string"&&r.title?r.title:null;p&&u&&(E[`wi:${p}`]=u)}}}catch(e){N(e)||console.warn("[learning.scout] grounding-title read failed:",e instanceof Error?e.message:e),E={}}let S=null,h=[];try{const e=await t`
      SELECT * FROM harness_shared.scout_ticks
       WHERE workspace_id = ${n}
         AND origin = 'scout'
         ${d?t`AND pot_slug = ${d}`:t``}
       ORDER BY tick_at DESC
       LIMIT 12
    `;S=te(e[0]),h=e.map(ne);const o=[...new Set(h.map(r=>r.cycleId).filter(r=>!!r))];if(o.length>0){const r=await t`
        SELECT cycle_id, lens, count(*)::int AS count
          FROM harness_shared.scout_routed_ideas
         WHERE workspace_id = ${n}
           AND cycle_id IN ${t(o)}
         GROUP BY cycle_id, lens
      `,p=new Map;for(const u of r){const s=typeof u.cycle_id=="string"?u.cycle_id:"",_=typeof u.lens=="string"&&u.lens?u.lens:"unknown";if(!s)continue;const c=p.get(s)??{};c[_]=(c[_]??0)+Number(u.count??0),p.set(s,c)}h=h.map(u=>u.cycleId&&p.has(u.cycleId)?{...u,lenses:p.get(u.cycleId)}:u)}}catch(e){N(e)||console.warn("[learning.scout] tick read failed:",e instanceof Error?e.message:e)}let k=[];try{const{LENS_DIVERSITY_SAMPLE:e}=await L(async()=>{const{LENS_DIVERSITY_SAMPLE:o}=await import("./success-metrics-_VSHVpxS.js");return{LENS_DIVERSITY_SAMPLE:o}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47]));k=(await t`
      SELECT lens /* newest-lens-sample */
        FROM harness_shared.scout_routed_ideas
       WHERE workspace_id = ${n}
         AND origin = 'scout'
       ORDER BY routed_at DESC
       LIMIT ${e}
    `).map(o=>String(o.lens??"")).filter(Boolean)}catch(e){N(e)||console.warn("[learning.scout] lens-sample read failed:",e instanceof Error?e.message:e)}let C=null;try{const{readScoutLensWeights:e}=await L(async()=>{const{readScoutLensWeights:r}=await import("./routed-ledger-Ba_VCSyk.js");return{readScoutLensWeights:r}},__vite__mapDeps([48,15,2,3,16,17,18,19,13,20,21,5,6,22,23,24,25,26,27,28,29,30,31,32])),o=await e({workspaceId:n,sql:t});C=Object.keys(o).length>0?o:null}catch(e){N(e)||console.warn("[learning.scout] lens-weight read failed:",e instanceof Error?e.message:e)}let $=null;try{const{readAccumulatorCounts:e,weightedSignalScore:o,DEFAULT_LANE_WEIGHTS:r,SIGNAL_LANES:p}=await L(async()=>{const{readAccumulatorCounts:c,weightedSignalScore:y,DEFAULT_LANE_WEIGHTS:A,SIGNAL_LANES:D}=await import("./signal-accumulator-CKdJ-o5O.js");return{readAccumulatorCounts:c,weightedSignalScore:y,DEFAULT_LANE_WEIGHTS:A,SIGNAL_LANES:D}},__vite__mapDeps([49,2,16,17,18,19,13,20,21,5,6,50,3,36,37,38,30,31,32,39,24,25,26,27,28,29,33,34,35,40,41,42])),{SCOUT_CADENCE_DEFAULTS:u}=await L(async()=>{const{SCOUT_CADENCE_DEFAULTS:c}=await import("./cadence-4-_zGOTn.js");return{SCOUT_CADENCE_DEFAULTS:c}},__vite__mapDeps([51,10,2])),{counts:s,watermarkAt:_}=await e({workspaceId:n,sql:t});$={lanes:p.map(c=>({lane:c,count:s[c]??0,weight:r[c]})),score:o(s),threshold:u.signalScoreThreshold,minVolumeIntervalSec:u.minVolumeIntervalSec,maxIntervalSec:u.maxIntervalSec,watermarkAt:_?_.toISOString():null}}catch(e){N(e)||console.warn("[learning.scout] cadence read failed:",e instanceof Error?e.message:e)}const G=await re({workspaceId:n,sql:t,hive:d,hiveMemberSlugs:g});let F=null,M=[];try{const e=await t`
      SELECT cycle_id, watermark_at, digest, created_at
        FROM harness_shared.scout_digest_snapshots
       WHERE workspace_id = ${n}
       ORDER BY created_at DESC
       LIMIT ${Y}
    `,{flattenDigest:o}=await L(async()=>{const{flattenDigest:s}=await import("./lenses-dEHOnSRc.js");return{flattenDigest:s}},__vite__mapDeps([52,47,2,23])),r=[];for(const s of e){if(!s.digest||typeof s.digest!="object")continue;const _=s.digest,c=o(_)??[],y=new Set(Array.isArray(_.previousCycleRefs)?_.previousCycleRefs.filter(A=>typeof A=="string"):[]);r.push({row:s,flat:c,prevRefs:y})}for(let s=0;s<r.length;s+=1){const _=r[s],c=r[s+1];_.prevRefs.size===0&&c&&(_.prevRefs=new Set(c.flat.map(y=>y.ref)))}M=r.map(({row:s,flat:_,prevRefs:c})=>{const y=c.size>0?_.filter(A=>!c.has(A.ref)).length:0;return{cycleId:typeof s.cycle_id=="string"&&s.cycle_id?s.cycle_id:null,at:b(s.created_at),totalEntries:_.length,newCount:y,standingCount:_.length-y}});const p=l.selectedCycleId?r.findIndex(({row:s})=>s.cycle_id===l.selectedCycleId):-1,u=r[p>=0?p:0];if(u){const{row:s,flat:_,prevRefs:c}=u,y=f=>({lane:f.category??"unknown",summary:typeof f.summary=="string"?f.summary.slice(0,240):"",ref:f.ref,weight:typeof f.weight=="number"&&Number.isFinite(f.weight)?f.weight:null}),A=(f,T)=>(T.weight??0)-(f.weight??0),D=c.size>0?_.filter(f=>!c.has(f.ref)).map(y).sort(A):[],V=_.filter(f=>c.size===0||c.has(f.ref)).map(y).sort(A),O={};for(const f of _){const T=f.category??"unknown";O[T]=(O[T]??0)+1}F={cycleId:typeof s.cycle_id=="string"&&s.cycle_id?s.cycle_id:null,at:b(s.created_at),watermarkAt:b(s.watermark_at),totalEntries:_.length,laneCounts:O,newEntries:D,standingEntries:V,truncated:!1}}}catch(e){N(e)||console.warn("[learning.scout] digest read failed:",e instanceof Error?e.message:e)}const B=se({ticks:h,recent:m,scoutLensSample:k});let v=null;try{const e=[...Z],o=[...X],r=(await t`
      SELECT count(*)::int AS filed,
             count(*) FILTER (
               WHERE ei.state IS NOT NULL
                 AND NOT (ei.state = ANY(${[...Q]}::text[]))
                 AND ei.assignee IS NOT NULL
             )::int AS claimed,
             count(*) FILTER (WHERE ei.state = ANY(${e}::text[]))::int AS done,
             count(*) FILTER (WHERE ei.state = ANY(${o}::text[]))::int AS dropped
        FROM harness_shared.scout_routed_ideas sri
        LEFT JOIN harness_shared.engineer_issues ei
          ON ei.workspace_id = ${n}
         AND ei.issue_id = substring(sri.routed_ref FROM 4)
       WHERE sri.workspace_id = ${n}
         AND sri.rail = 'improvement'
         AND sri.routed_ref LIKE 'wi:%'
         ${i}
    `)[0];r&&(v={routed:R,filed:Number(r.filed??0),claimed:Number(r.claimed??0),done:Number(r.done??0),dropped:Number(r.dropped??0)})}catch(e){N(e)||console.warn("[learning.scout] improve-funnel read failed:",e instanceof Error?e.message:e)}return{totalRouted:R,railCounts:a,recent:m,lastTick:S,ticks:h,health:B,lensWeights:C,groundingTitles:E,cadence:$,drafts:G,digest:F,digestHistory:M,improveFunnel:v}}var w,W,P,H,Y,pe=x((()=>{J(),ee(),q(),K(),j(),w=t=>{const n=typeof t=="string"?Number(t):t;return typeof n=="number"&&Number.isFinite(n)?n:0},W=.9,P=5,H=10,Y=10}));export{re as a,ne as i,pe as n,me as o,te as r,U as s,se as t};
