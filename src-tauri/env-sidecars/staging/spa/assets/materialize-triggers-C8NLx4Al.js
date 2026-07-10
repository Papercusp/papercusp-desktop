const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/ephemeral-executor-sCcClNPD.js","assets/chunk-CMxvf4Kt.js","assets/src-DiYBo7B9.js","assets/src-BbbWoCsk.js","assets/node-module-browser-BIpJATUS.js","assets/postgres-browser-zd-i1BMX.js","assets/resource-profile-BTaEU3Bl.js","assets/__vite-browser-external-CM3Eme-n.js","assets/zod-Dj7LUnxx.js","assets/core-dwh4Ocgd.js","assets/workspace-als-Cj-bQU9A.js","assets/workspace-registry-C3lTKlnO.js","assets/workspace-id-constant-E7VkkAiJ.js"])))=>i.map(i=>d[i]);
import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./preload-helper-B_k_wMTD.js";import{a as r}from"./types-3cwwxpZc.js";import{t as i}from"./src-BOSa0o7e.js";import{a,c as o}from"./server-C2rhPpnt.js";import{q as s,t as c,v as l}from"./src-BbbWoCsk.js";import{n as u,s as d}from"./workspace-registry-C3lTKlnO.js";import{n as f,t as p}from"./cron-wBe2AScZ.js";function m(e){return e!==void 0&&!S.has(e)}async function h(e={}){return(e.flag??(e=>a(e,`platform-improvement-loops`)))(r.PLATFORM_IMPROVEMENT_LOOPS)}async function g(e={}){return(e.flag??(e=>a(e,`ephemeral-cadence`)))(r.EPHEMERAL_CADENCE)}function _(e){return e===`scout`?{cycleTimeoutMs:w}:{}}function v(e){return(e.triggers?.schedule??[]).map((t,n)=>{let r=t.singleton??!1;if(r&&!e.id)throw Error("materializeBlueprintTriggers: a `singleton: true` schedule trigger requires the blueprint id (the routine name must be blueprint-unique under the shared reserved host-slug). Pass the full blueprint, not just its triggers.");let i=t.tier??`durable`;if(i===`ephemeral`){if(t.intervalSec==null)throw Error(`materializeBlueprintTriggers: tier:'ephemeral' schedule entry ${n} requires intervalSec`);if(r)throw Error(`materializeBlueprintTriggers: tier:'ephemeral' is not supported for a singleton trigger (entry ${n})`)}else if(t.cron==null)throw Error(`materializeBlueprintTriggers: tier:'durable' schedule entry ${n} requires cron`);return{name:r?`bp-singleton-${e.id}-${n}`:`bp-schedule-${n}`,tier:i,cron:t.cron,intervalSec:t.intervalSec,targetRole:t.action||`system:blueprint-run`,singleton:r,singletonActive:r?t.singletonActive??!1:!1}})}async function y(e,t){let n=C,r=`rt_${n}_${t.name}`.replace(/[^a-z0-9_]/gi,`_`).toLowerCase(),i=p(t.cron,new Date),a=JSON.stringify({cron:t.cron}),o=JSON.stringify({blueprintId:t.blueprintId,..._(t.blueprintId)});return{id:(await e`
    INSERT INTO harness_shared.routines
      (id, install_slug, name, trigger_kind, trigger_config, target_role,
       payload_template, concurrency, catchup, active, next_fire_at, workspace_id)
    VALUES (
      ${r}, ${n}, ${t.name}, 'cron',
      ${a}::text::jsonb, ${t.targetRole},
      ${o}::text::jsonb, 'skip', 'skip-old', ${t.seedActive},
      ${i?i.toISOString():null}::timestamptz, ${t.workspaceId}
    )
    ON CONFLICT (install_slug, name) DO UPDATE SET
      trigger_kind     = EXCLUDED.trigger_kind,
      trigger_config   = EXCLUDED.trigger_config,
      target_role      = EXCLUDED.target_role,
      payload_template = ${o}::text::jsonb
        || COALESCE(harness_shared.routines.payload_template - 'blueprintId', '{}'::jsonb),
      catchup          = EXCLUDED.catchup,
      updated_at       = now()
    RETURNING id
  `)[0].id}}async function b(e,t){let n=`rt_${t.installSlug}_${t.name}`.replace(/[^a-z0-9_]/gi,`_`).toLowerCase(),r=JSON.stringify({interval_sec:t.intervalSec});return{id:(await e`
    INSERT INTO harness_shared.routines
      (id, install_slug, name, trigger_kind, trigger_config, target_role,
       concurrency, catchup, active, tier, next_fire_at, workspace_id)
    VALUES (
      ${n}, ${t.installSlug}, ${t.name}, 'cron',
      ${r}::text::jsonb, ${t.targetRole},
      'skip', 'skip-old', TRUE, 'ephemeral', NULL, ${t.workspaceId}
    )
    ON CONFLICT (install_slug, name) DO UPDATE SET
      trigger_kind   = EXCLUDED.trigger_kind,
      trigger_config = EXCLUDED.trigger_config,
      target_role    = EXCLUDED.target_role,
      tier           = EXCLUDED.tier,
      updated_at     = now()
    RETURNING id
  `)[0].id}}async function x(e,t,r={}){let i=v(t);if(i.length===0)return[];let a=r.sql??s().sql,o=r.workspaceId??u(),c=i.some(e=>e.singleton&&m(t.id))?await h({flag:r.flag}):!0,d=i.some(e=>e.tier===`ephemeral`)?await g({flag:r.ephemeralFlag}):!0,f=[];for(let r of i){if(r.tier===`ephemeral`){if(!d)continue;let t=await b(a,{workspaceId:o,installSlug:e,name:r.name,intervalSec:r.intervalSec,targetRole:r.targetRole});f.push({...r,id:t.id,hostSlug:e});try{let{syncEphemeralRoutine:i}=await n(async()=>{let{syncEphemeralRoutine:e}=await import(`./ephemeral-executor-sCcClNPD.js`);return{syncEphemeralRoutine:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12]));i({id:t.id,workspaceId:o,installSlug:e,name:r.name,targetRole:r.targetRole,intervalSec:r.intervalSec,payloadTemplate:null,triggerConfig:{interval_sec:r.intervalSec}})}catch{}continue}let i=r.cron;if(r.singleton){if(!c&&m(t.id))continue;let e=await y(a,{workspaceId:o,name:r.name,cron:i,targetRole:r.targetRole,blueprintId:t.id,seedActive:r.singletonActive});f.push({...r,id:e.id,hostSlug:C});continue}let s=await l(a,{workspaceId:o,installSlug:e,name:r.name,triggerKind:`cron`,triggerConfig:{cron:i},targetRole:r.targetRole,active:!0},p);f.push({...r,id:s.id,hostSlug:e})}return f}var S,C,w;e((()=>{c(),o(),i(),d(),f(),t(),S=new Set([`scout`]),C=`@singleton`,w=6e5}))();export{x as materializeBlueprintTriggers};