import{n as E}from"./chunk-ChpBd9eV.js";import{n as m,t as d}from"./shadow-variant-origin-BD-fcM7k.js";function A(e,t){const o=e.byOrigin[t];return typeof o=="number"&&Number.isFinite(o)?o:e.fallbackMs}function L(e,t){const o={};let i=0,n=0,r=0,c=0;for(const a of e){const _=s(a.actionable);(_>0||a.origin)&&(o[a.origin]=_),i+=_,n+=s(a.all_ungraded),r+=s(a.pre_epoch),c+=s(a.terminal)}return{actionableByOrigin:o,actionable:i,allUngraded:n,excluded:{preEpoch:r,terminal:c},policy:t}}async function S(e,t){const{workspaceId:o,harnessSlug:i,policy:n}=t,r=JSON.stringify(n.byOrigin),c=n.fallbackMs;return L(i?await e`
        WITH scoped AS (
          SELECT origin, human_grade, outcome, routed_at,
                 coalesce((${r}::jsonb ->> origin)::bigint, ${c}::bigint) AS epoch_ms
            FROM harness_shared.scout_routed_ideas
           WHERE workspace_id = ${o} AND harness_slug = ${i}
             AND origin <> ${d}
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
                 coalesce((${r}::jsonb ->> origin)::bigint, ${c}::bigint) AS epoch_ms
            FROM harness_shared.scout_routed_ideas
           WHERE workspace_id = ${o}
             AND origin <> ${d}
        )
        SELECT origin,
               count(*) FILTER (WHERE human_grade IS NULL AND routed_at >= epoch_ms
                                  AND (outcome IS NULL OR outcome = 'pending'))::int AS actionable,
               count(*) FILTER (WHERE human_grade IS NULL)::int AS all_ungraded,
               count(*) FILTER (WHERE human_grade IS NULL AND routed_at < epoch_ms)::int AS pre_epoch,
               count(*) FILTER (WHERE human_grade IS NULL AND routed_at >= epoch_ms
                                  AND outcome IS NOT NULL AND outcome <> 'pending')::int AS terminal
          FROM scoped
         GROUP BY origin`,n)}var u,g,N,s,h=E((()=>{m(),u=Date.parse("2026-07-11T00:00:00Z"),g=Date.parse("2026-08-12T00:00:00Z"),N={byOrigin:{"su-ideate":u,scout:g},fallbackMs:u},s=e=>Math.max(0,Number(e??0))}));export{h as a,A as i,g as n,S as o,u as r,L as s,N as t};
