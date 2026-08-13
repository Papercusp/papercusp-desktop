import{n as E}from"./chunk-ChpBd9eV.js";function l(e,t){const o=e.byOrigin[t];return typeof o=="number"&&Number.isFinite(o)?o:e.fallbackMs}function g(e,t){const o={};let r=0,a=0,i=0,c=0;for(const n of e){const u=s(n.actionable);(u>0||n.origin)&&(o[n.origin]=u),r+=u,a+=s(n.all_ungraded),i+=s(n.pre_epoch),c+=s(n.terminal)}return{actionableByOrigin:o,actionable:r,allUngraded:a,excluded:{preEpoch:i,terminal:c},policy:t}}async function p(e,t){const{workspaceId:o,harnessSlug:r,policy:a}=t,i=JSON.stringify(a.byOrigin),c=a.fallbackMs;return g(r?await e`
        WITH scoped AS (
          SELECT origin, human_grade, outcome, routed_at,
                 coalesce((${i}::jsonb ->> origin)::bigint, ${c}::bigint) AS epoch_ms
            FROM harness_shared.scout_routed_ideas
           WHERE workspace_id = ${o} AND harness_slug = ${r}
        )
        SELECT origin,
               count(*) FILTER (WHERE human_grade IS NULL AND routed_at >= epoch_ms
                                  AND (outcome IS NULL OR outcome = 'pending'))::int AS actionable,
               count(*) FILTER (WHERE human_grade IS NULL)::int AS all_ungraded,
               count(*) FILTER (WHERE human_grade IS NULL AND routed_at < epoch_ms)::int AS pre_epoch,
               count(*) FILTER (WHERE human_grade IS NULL AND routed_at >= epoch_ms
                                  AND outcome IS NOT NULL AND outcome <> 'pending')::int AS terminal
          FROM scoped
         GROUP BY origin`:await e`
        WITH scoped AS (
          SELECT origin, human_grade, outcome, routed_at,
                 coalesce((${i}::jsonb ->> origin)::bigint, ${c}::bigint) AS epoch_ms
            FROM harness_shared.scout_routed_ideas
           WHERE workspace_id = ${o}
        )
        SELECT origin,
               count(*) FILTER (WHERE human_grade IS NULL AND routed_at >= epoch_ms
                                  AND (outcome IS NULL OR outcome = 'pending'))::int AS actionable,
               count(*) FILTER (WHERE human_grade IS NULL)::int AS all_ungraded,
               count(*) FILTER (WHERE human_grade IS NULL AND routed_at < epoch_ms)::int AS pre_epoch,
               count(*) FILTER (WHERE human_grade IS NULL AND routed_at >= epoch_ms
                                  AND outcome IS NOT NULL AND outcome <> 'pending')::int AS terminal
          FROM scoped
         GROUP BY origin`,a)}var _,d,m,s,S=E((()=>{_=Date.parse("2026-07-11T00:00:00Z"),d=Date.parse("2026-08-12T00:00:00Z"),m={byOrigin:{"su-ideate":_,scout:d},fallbackMs:_},s=e=>Math.max(0,Number(e??0))}));export{S as a,l as i,d as n,p as o,_ as r,g as s,m as t};
