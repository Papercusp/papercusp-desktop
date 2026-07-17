const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/unanswered-directed-Cs2WMzZr.js","assets/unanswered-directed-DVBtnzp2.js","assets/chunk-CMxvf4Kt.js","assets/log-D6QBfU78.js","assets/coordination-event-log-browser-Dq_4i-_C.js","assets/server-CpNzVSR6.js","assets/types-C34bIVeX.js","assets/src-DaYvPdEB.js","assets/src-CwW4br4q.js","assets/node-module-browser-BIpJATUS.js","assets/postgres-browser-zd-i1BMX.js","assets/resource-profile-CXmc9pS7.js","assets/__vite-browser-external-CM3Eme-n.js","assets/zod-Dj7LUnxx.js","assets/core-dwh4Ocgd.js","assets/flag-distinct-id-BZ5cCTSq.js","assets/workspace-registry-Bu1Yy540.js","assets/workspace-als-DigME466.js","assets/async-hooks-browser-DZKl_0H0.js","assets/workspace-id-constant-E7VkkAiJ.js","assets/machine-authored-CZmWpnxp.js"])))=>i.map(i=>d[i]);
import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./preload-helper-B_k_wMTD.js";import{J as r,t as i}from"./src-CwW4br4q.js";import{n as a,s as o}from"./workspace-registry-Bu1Yy540.js";function s(e){return e.toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-+|-+$/g,``).slice(0,48)||`unknown`}function c(e,t){return e.length>t?`${e.slice(0,t-1)}…`:e}function l(e){let t=Math.round(e/6e4);if(t<60)return`${t}m`;let n=Math.floor(t/60),r=t%60;return r?`${n}h${r}m`:`${n}h`}function u(e,t={}){let n=t.minEscalationReMounts??3,r=t.minUnanswered??5,i=t.minWakeStorm??200,a=t.minClaimConflicts??3,o=t.limit??10,u=[],d=[...e.escalationStorms].filter(e=>e.severity===`blocker`&&e.count>=1||e.count>=n).sort((e,t)=>(t.severity===`blocker`)-+(e.severity===`blocker`)||t.count-e.count);for(let e of d)u.push({category:`coord-health`,ref:`coord:escalation-storm:${s(e.signature)}`,summary:`escalation re-mounted ${e.count}× in 24h (${e.severity}): ${c(e.signature,80)} — a repeating cascade, not a one-off`,detail:`${e.count} escalation event(s)/24h on the same signature${e.sample?`; e.g. "${c(e.sample,120)}"`:``}. A known-benign transient re-mounting a full escalation cascade (fresh work-item + probe + owner alert) means the "is this the same incident" dedup gate is too narrow (EI-9492): widen the dedup key or add a recently-resolved suppression so the same condition can't re-page every wake.`,weight:e.severity===`blocker`?1:.8});let f=[...e.unansweredTargets].filter(e=>e.count>=r).sort((e,t)=>t.count-e.count);if(f.length>0){let e=f.reduce((e,t)=>e+t.count,0),t=f.slice(0,5).map(e=>`${e.recipient} ${e.count} (${l(e.oldestAgeMs)})`).join(`, `);u.push({category:`coord-health`,ref:`coord:unanswered`,summary:`${f.length} agent(s) hold ≥${r} unanswered directed message(s) (${e} total) — directed comms are stalling`,detail:`worst: ${t}. A directed message OUTRANKS the recipient's own work; a per-agent backlog that grows across wakes despite landed nudges is a coordination-comms stall (agents alive, producing turns, but not converting into reply-drain or claim progress) — the reply-obligation surfacing or the wake→reply path may be failing.`,weight:.7})}e.claimConflicts>=a&&u.push({category:`coord-health`,ref:`coord:claim-conflict`,summary:`${e.claimConflicts} claim conflict(s) in 24h — agents contending for the same work-item`,detail:`repeated claim conflicts mean the scheduler/claim-spec is surfacing the same item to multiple agents, or a stale claim is not releasing on session death; check claim TTLs, the hold-open sweep cadence, and scheduler dedup.`,weight:.6});let p=[...e.wakeStorms].filter(e=>e.count>=i).sort((e,t)=>t.count-e.count);for(let e of p)u.push({category:`coord-health`,ref:`coord:wake-storm:${s(e.recipient)}`,summary:`${e.recipient} received ${e.count} coord message(s) in 24h — an inbox/wake flood`,detail:`${e.count} deliveries/24h to one recipient. A subscription firehose or a re-firing sender is flooding this inbox — if most are near-duplicates the coalescing/dedup is leaking; heavy wake traffic burns turns and buries real directed mail under noise.`,weight:Math.min(.6,.2+e.count/5e3)});return u.slice(0,Math.max(1,o))}async function d(e={}){try{let t=e.workspaceId??a(),{sql:i}=r(),o=await i`
      SELECT
        coalesce(
          body->>'subjectSignature',
          body->>'livenessSignature',
          left(body->>'summary', 80)
        ) AS sig,
        count(*)::int AS n,
        max(
          CASE body->>'severity'
            WHEN 'blocker' THEN 2
            WHEN 'advisory' THEN 1
            ELSE 0
          END
        )::int AS sev_rank,
        (array_agg(body->>'summary' ORDER BY ts DESC))[1] AS sample
        FROM harness_shared.coord_event_log
       WHERE workspace_id = ${t}
         AND surface = 'escalations'
         AND body->>'kind' = 'escalation'
         AND ts > now() - interval '24 hours'
       GROUP BY 1`,s=await i`
      SELECT r AS recipient, count(*)::int AS n
        FROM harness_shared.coord_event_log
        CROSS JOIN LATERAL jsonb_array_elements_text(body->'to') AS r
       WHERE workspace_id = ${t}
         AND surface = 'messages'
         AND ts > now() - interval '24 hours'
         AND jsonb_typeof(body->'to') = 'array'
         AND r NOT IN ('human', '*')
         AND r NOT LIKE '@%'
       GROUP BY 1
      HAVING count(*) >= 100`,c=await i`
      SELECT count(*)::int AS n
        FROM harness_shared.coord_event_log
       WHERE workspace_id = ${t}
         AND surface = 'messages'
         AND ts > now() - interval '24 hours'
         AND (
           body->>'summary' ILIKE '%claim%conflict%'
           OR body::text ILIKE '%claim_conflict%'
         )`,l=[];try{let e=(await i`
        SELECT DISTINCT r
          FROM harness_shared.coord_event_log
          CROSS JOIN LATERAL jsonb_array_elements_text(body->'to') AS r
         WHERE workspace_id = ${t}
           AND surface = 'messages'
           AND ts > now() - interval '3 days'
           AND r ~ '^(su-|s-|cup-)'
         LIMIT 300`).map(e=>e.r).filter(Boolean);if(e.length>0){let{fetchUnansweredDirected:t}=await n(async()=>{let{fetchUnansweredDirected:e}=await import(`./unanswered-directed-Cs2WMzZr.js`);return{fetchUnansweredDirected:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]));l=[...(await t(e)).entries()].map(([e,t])=>({recipient:e,count:t.count,oldestAgeMs:t.oldestAgeMs}))}}catch{}return u({escalationStorms:o.map(e=>({signature:e.sig||`unknown`,count:Number(e.n)||0,severity:e.sev_rank>=2?`blocker`:e.sev_rank>=1?`advisory`:`unknown`,sample:e.sample??``})),wakeStorms:s.map(e=>({recipient:e.recipient,count:Number(e.n)||0})),unansweredTargets:l,claimConflicts:Number(c[0]?.n)||0})}catch{return[]}}e((()=>{i(),o(),t()}))();export{d as buildCoordHealthLane};