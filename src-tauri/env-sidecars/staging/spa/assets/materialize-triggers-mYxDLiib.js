const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/ephemeral-executor-CjqNDOZ7.js","assets/chunk-ChpBd9eV.js","assets/workspace-als-CSW21ZcE.js","assets/src-CynoHxv9.js","assets/src-6Py4l2MU.js","assets/src-BmBNODK0.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/drizzle-orm-BbO4Lkx2.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js","assets/workspace-registry-Du2UbhlH.js","assets/workspace-id-constant-AQ2MH5pQ.js"])))=>i.map(i=>d[i]);
import{n as L}from"./chunk-ChpBd9eV.js";import{n as R,t as v}from"./preload-helper-CcgcQsTF.js";import{s as m}from"./types-B6UfiA7g.js";import{t as O}from"./src-CL56NiZm.js";import{D as I,st as C,t as D}from"./src-BmBNODK0.js";import{l as N,o as d}from"./server-CB1HiStO.js";import{c as $,r as y}from"./workspace-registry-Du2UbhlH.js";import{n as U,t as p}from"./cron-CQ-fl78O.js";function _(t){return t!==void 0&&!f.has(t)}async function A(t={}){return(t.flag??(e=>d(e,"platform-improvement-loops")))(m.PLATFORM_IMPROVEMENT_LOOPS)}async function k(t={}){return(t.flag??(e=>d(e,"ephemeral-cadence")))(m.EPHEMERAL_CADENCE)}function b(t){return t==="scout"?{cycleTimeoutMs:E}:{}}function P(t){return(t.triggers?.schedule??[]).map((e,i)=>{const n=e.singleton??!1;if(n&&!t.id)throw new Error("materializeBlueprintTriggers: a `singleton: true` schedule trigger requires the blueprint id (the routine name must be blueprint-unique under the shared reserved host-slug). Pass the full blueprint, not just its triggers.");const a=e.tier??"durable";if(a==="ephemeral"){if(e.intervalSec==null)throw new Error(`materializeBlueprintTriggers: tier:'ephemeral' schedule entry ${i} requires intervalSec`);if(n)throw new Error(`materializeBlueprintTriggers: tier:'ephemeral' is not supported for a singleton trigger (entry ${i})`)}else if(e.cron==null)throw new Error(`materializeBlueprintTriggers: tier:'durable' schedule entry ${i} requires cron`);return{name:n?`bp-singleton-${t.id}-${i}`:`bp-schedule-${i}`,tier:a,cron:e.cron,intervalSec:e.intervalSec,targetRole:e.action||"system:blueprint-run",singleton:n,singletonActive:n?e.singletonActive??!1:!1}})}async function F(t,e){const i=g,n=`rt_${i}_${e.name}`.replace(/[^a-z0-9_]/gi,"_").toLowerCase(),a=p(e.cron,new Date),o=JSON.stringify({cron:e.cron}),s=JSON.stringify({blueprintId:e.blueprintId,...b(e.blueprintId)});return{id:(await t`
    INSERT INTO harness_shared.routines
      (id, install_slug, name, trigger_kind, trigger_config, target_role,
       payload_template, concurrency, catchup, active, next_fire_at, workspace_id)
    VALUES (
      ${n}, ${i}, ${e.name}, 'cron',
      ${o}::text::jsonb, ${e.targetRole},
      ${s}::text::jsonb, 'skip', 'skip-old', ${e.seedActive},
      ${a?a.toISOString():null}::timestamptz, ${e.workspaceId}
    )
    ON CONFLICT (install_slug, name) DO UPDATE SET
      trigger_kind     = EXCLUDED.trigger_kind,
      trigger_config   = EXCLUDED.trigger_config,
      target_role      = EXCLUDED.target_role,
      payload_template = ${s}::text::jsonb
        || COALESCE(harness_shared.routines.payload_template - 'blueprintId', '{}'::jsonb),
      catchup          = EXCLUDED.catchup,
      updated_at       = now()
    RETURNING id
  `)[0].id}}async function x(t,e){const i=`rt_${e.installSlug}_${e.name}`.replace(/[^a-z0-9_]/gi,"_").toLowerCase(),n=JSON.stringify({interval_sec:e.intervalSec});return{id:(await t`
    INSERT INTO harness_shared.routines
      (id, install_slug, name, trigger_kind, trigger_config, target_role,
       concurrency, catchup, active, tier, next_fire_at, workspace_id)
    VALUES (
      ${i}, ${e.installSlug}, ${e.name}, 'cron',
      ${n}::text::jsonb, ${e.targetRole},
      'skip', 'skip-old', TRUE, 'ephemeral', NULL, ${e.workspaceId}
    )
    ON CONFLICT (install_slug, name) DO UPDATE SET
      trigger_kind   = EXCLUDED.trigger_kind,
      trigger_config = EXCLUDED.trigger_config,
      target_role    = EXCLUDED.target_role,
      tier           = EXCLUDED.tier,
      updated_at     = now()
    RETURNING id
  `)[0].id}}async function Y(t,e,i={}){const n=P(e);if(n.length===0)return[];const a=i.sql??C().sql,o=i.workspaceId??y(),s=n.some(r=>r.singleton&&_(e.id))?await A({flag:i.flag}):!0,h=n.some(r=>r.tier==="ephemeral")?await k({flag:i.ephemeralFlag}):!0,l=[];for(const r of n){if(r.tier==="ephemeral"){if(!h)continue;const c=await x(a,{workspaceId:o,installSlug:t,name:r.name,intervalSec:r.intervalSec,targetRole:r.targetRole});l.push({...r,id:c.id,hostSlug:t});try{const{syncEphemeralRoutine:T}=await v(async()=>{const{syncEphemeralRoutine:w}=await import("./ephemeral-executor-CjqNDOZ7.js");return{syncEphemeralRoutine:w}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14]));T({id:c.id,workspaceId:o,installSlug:t,name:r.name,targetRole:r.targetRole,intervalSec:r.intervalSec,payloadTemplate:null,triggerConfig:{interval_sec:r.intervalSec}})}catch{}continue}const u=r.cron;if(r.singleton){if(!s&&_(e.id))continue;const c=await F(a,{workspaceId:o,name:r.name,cron:u,targetRole:r.targetRole,blueprintId:e.id,seedActive:r.singletonActive});l.push({...r,id:c.id,hostSlug:g});continue}const S=await I(a,{workspaceId:o,installSlug:t,name:r.name,triggerKind:"cron",triggerConfig:{cron:u},targetRole:r.targetRole,active:!0},p);l.push({...r,id:S.id,hostSlug:t})}return l}var z,f,g,E,Q=L((()=>{D(),N(),O(),$(),U(),R(),z="system:blueprint-run",f=new Set(["scout"]),g="@singleton",E=6e5}));export{Q as a,A as c,k as i,b as l,E as n,_ as o,g as r,Y as s,z as t,P as u};
