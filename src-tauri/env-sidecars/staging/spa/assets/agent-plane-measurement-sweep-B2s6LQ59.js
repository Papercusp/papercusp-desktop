import{n as N}from"./chunk-ChpBd9eV.js";import{st as d,t as R}from"./src-8fWtxfEz.js";import{s as p,t as E}from"./agent-state-divergence-sweep-BjrQtc05.js";import{c as h,d as y,f as $,g as L,i as M,l as I,o as b,r as k}from"./agent-plane-measurement-B86PDTLC.js";function o(e){const a=typeof e=="string"?Number(e):e;return typeof a=="number"&&Number.isFinite(a)?a:0}async function v(e){const a=e.sql??d().sql,s=new Date(e.windowStartMs).toISOString(),t=new Date(e.windowEndMs).toISOString(),n=[...g],c=[...S];return(await a`
    SELECT count(*)                                                       AS calls,
           count(coord_owner_id)                                          AS attributed,
           count(*) FILTER (WHERE tool_name = ANY(${n}))       AS clarification_calls,
           count(*) FILTER (WHERE tool_name = ANY(${c}))            AS enriched_calls,
           count(*) FILTER (WHERE tool_name = ANY(${c})
                              AND output_size IS NOT NULL)                 AS enriched_sized,
           coalesce(sum(output_size) FILTER (WHERE tool_name = ANY(${c})), 0) AS enriched_bytes
      FROM harness_shared.tool_invocations
     WHERE workspace_id = ${e.workspaceId}
       AND invoked_at >= ${s}
       AND invoked_at <  ${t}
  `)[0]??{calls:0,attributed:0,clarification_calls:0,enriched_calls:0,enriched_sized:0,enriched_bytes:0}}async function D(e){return(await(e.sql??d().sql)`
    SELECT count(*)                                        AS live_facts,
           count(*) FILTER (WHERE depends_on IS NOT NULL)   AS with_deps
      FROM harness_shared.agent_facts
     WHERE workspace_id = ${e.workspaceId}
       AND superseded_at IS NULL AND retracted_at IS NULL AND expires_at > now()
  `)[0]??{live_facts:0,with_deps:0}}async function C(e){return(e.sql??d().sql)`
    WITH declared AS (
      SELECT e.entry
        FROM harness_shared.work_items w
        CROSS JOIN LATERAL jsonb_array_elements(w.payload->'_assumptions'->'declared') AS e(entry)
       WHERE w.workspace_id = ${e.workspaceId}
         AND jsonb_typeof(w.payload->'_assumptions'->'declared') = 'array'
    )
    SELECT d.entry->>'condition'                AS condition_at_close,
           (d.entry->>'versionId')              AS pinned_version,
           cur.current_version                  AS current_version,
           coalesce(cur.retracted_now, false)   AS retracted_now,
           coalesce(cur.expired_now, false)     AS expired_now
      FROM declared d
      LEFT JOIN LATERAL (
        SELECT a.id                            AS current_version,
               a.retracted_at IS NOT NULL      AS retracted_now,
               a.expires_at <= now()           AS expired_now
          FROM harness_shared.agent_facts a
         WHERE a.workspace_id = ${e.workspaceId}
           AND a.source_hive IS NULL
           AND a.key = d.entry->>'key'
           AND a.scope = d.entry->>'scope'
           AND coalesce(a.scope_ref, '') = coalesce(d.entry->>'scopeRef', '')
         ORDER BY a.id DESC
         LIMIT 1
      ) cur ON true
  `}async function T(e){const a=(await(e.sql??d().sql)`
    SELECT count(*)                                                                    AS closes_declaring,
           count(*) FILTER (WHERE jsonb_typeof(payload->'_assumptions'->'declared') = 'array') AS closes_naming_keys
      FROM harness_shared.work_items
     WHERE workspace_id = ${e.workspaceId}
       AND payload ? '_assumptions'
  `)[0]??{closes_declaring:0,closes_naming_keys:0};return{closes_declaring:o(a.closes_declaring),closes_naming_keys:o(a.closes_naming_keys)}}function O(e,a){let s=0,t=0,n=0,c=0;for(const r of e){const l=r.condition_at_close??null;$(l)&&(s+=1,L(l)&&(t+=1));const i=I({conditionAtClose:l,pinnedVersion:w(r.pinned_version),currentVersion:w(r.current_version),retractedNow:r.retracted_now===!0,expiredNow:r.expired_now===!0});i!=="undeterminable"&&(n+=1,h(i)&&(c+=1))}return{closesDeclaring:a.closes_declaring,closesNamingKeys:a.closes_naming_keys,comparableAtClose:s,staleAtClose:t,comparableNow:n,movedSince:c}}function w(e){if(e==null)return null;const a=typeof e=="number"?e:Number(e);return Number.isFinite(a)?Math.trunc(a):null}async function q(e,a,s){const t=await(s??d().sql)`
    SELECT measured_at
      FROM harness_shared.agent_plane_measurements
     WHERE workspace_id = ${e} AND harness_slug = ${a}
     ORDER BY measured_at DESC
     LIMIT 1
  `;if(t.length===0)return null;const n=new Date(t[0].measured_at).getTime();return Number.isFinite(n)?n:null}async function F(e,a,s){const t=s??d().sql;await t`
    INSERT INTO harness_shared.agent_plane_measurements
      (workspace_id, harness_slug, measured_at, window_start, window_end,
       metrics, interpretable_count, metric_count, summary, producer_version)
    VALUES (${a.workspaceId}, ${a.harnessSlug}, ${e.measuredAt},
            ${new Date(e.windowStartMs).toISOString()}, ${new Date(e.windowEndMs).toISOString()},
            ${t.json(e.metrics)}, ${e.interpretableCount}, ${e.metrics.length},
            ${e.summary}, ${2})
  `}function B(e){const a=e.divergence?.coverage??null,s=a?.callsExamined??o(e.calls.calls),t=e.divergence?.divergences.filter(l=>l.kind==="goal-drift-within-intent").length??0,n=o(e.calls.attributed),c=o(e.calls.enriched_calls),r=(l,i,_,u)=>({population:l,eligible:i,comparable:_,observed:u});return{"intent-action-divergence-stamped":r(s,a?.stampedCalls??0,a?.comparableBuckets??0,t),"intent-action-divergence-sampling":r(s,a?.failuresSeen??0,a?.failuresSeen??0,a?.thrashRuns??0),"clarification-rate":r(o(e.calls.calls),n,n,o(e.calls.clarification_calls)),"acted-on-stale-or-wrong-value":r(o(e.facts.live_facts),o(e.facts.with_deps),e.staleness?.determinable??0,e.staleness?.stale??0),"acted-on-stale-declared-basis":r(e.commitmentBasis?.closesDeclaring??0,e.commitmentBasis?.closesNamingKeys??0,e.commitmentBasis?.comparableAtClose??0,e.commitmentBasis?.staleAtClose??0),"closed-work-basis-moved":r(e.commitmentBasis?.closesDeclaring??0,e.commitmentBasis?.closesNamingKeys??0,e.commitmentBasis?.comparableNow??0,e.commitmentBasis?.movedSince??0),"plane-token-cost":r(o(e.calls.calls),c,o(e.calls.enriched_sized),o(e.calls.enriched_bytes))}}async function j(e={}){const a=e.now??Date.now(),s=e.workspaceId??"papercusp-workspace",t=e.harnessSlug??"papercusp";try{const n=await(e.lastMeasuredAtMs?e.lastMeasuredAtMs():q(s,t,e.sql));if(n!=null&&a-n<m)return{outcome:"skipped",reason:`last reading ${Math.round((a-n)/6e4)}min ago (< ${Math.round(m/6e4)}min window)`};const c=a-E,[r,l]=await Promise.all([(e.loadCallAggregates??v)({workspaceId:s,windowStartMs:c,windowEndMs:a,sql:e.sql}),(e.loadFactAggregates??D)({workspaceId:s,sql:e.sql})]),i=e.evaluateStaleness&&o(l.with_deps)>0?await e.evaluateStaleness([]):null;let _=null;try{const[A,f]=await Promise.all([(e.loadCommitmentBasisRows??C)({workspaceId:s,sql:e.sql}),(e.loadCommitmentDeclarationTotals??T)({workspaceId:s,sql:e.sql})]);_=O(A,f)}catch{_=null}const u=k({counts:B({divergence:e.divergence??null,calls:r,facts:l,commitmentBasis:_,staleness:i}),windowStartMs:c,windowEndMs:a});return await(e.recordMeasurement?e.recordMeasurement(u,{workspaceId:s,harnessSlug:t}):F(u,{workspaceId:s,harnessSlug:t},e.sql)),{outcome:"recorded",measurement:u}}catch(n){return{outcome:"error",reason:n instanceof Error?n.message:String(n)}}}function K(e){const a=e.metrics.map(s=>{switch(b(s)){case"unmeasured":return`${s.id}=UNMEASURED(${s.zeroReason}; fill=${s.fillRate??"n/a"}; awaiting ${s.inputProducer})`;case"never-observed":return`${s.id}=NEVER-OBSERVED(0 of ${s.comparable} ${s.unit}s — measured, not a pass)`;case"gauge":return`${s.id}=GAUGE(${s.rate}/${s.verdictUnit} over ${s.comparable})`;default:return`${s.id}=${s.observed}/${s.comparable}${s.rate==null?"":` (${s.rate})`}`}});return`[plane-measurement] ${e.summary} | ${a.join(" · ")}`}var m,H,g,S,U=N((()=>{R(),p(),y(),M(),m=E,H=2,g=["coord:ask","coord:ask-owner","conversations:post","conversations:answer"],S=["coord:orient","coord:presence","coord:send","work_items:list","work_items:get","work_items:claim","scheduler:get_next","locks:queue","facts:assert","state:read"]}));U();export{K as formatMeasurementLog,j as planeMeasurementSweep};
