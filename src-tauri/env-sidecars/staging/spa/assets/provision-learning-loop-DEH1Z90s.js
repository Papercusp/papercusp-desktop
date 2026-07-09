import{n as e}from"./chunk-CMxvf4Kt.js";import{d as t,f as n,l as r,r as i,t as a}from"./store-B7yk0XO6.js";import{i as o,n as s,t as c}from"./workspace-brain-scope-CwTZ5C5C.js";import{a as l,n as u}from"./control-plane-DhvMMBMj.js";function d(e){let t=2166136261;for(let n=0;n<e.length;n++)t^=e.charCodeAt(n),t=t+((t<<1)+(t<<4)+(t<<7)+(t<<8)+(t<<24))>>>0;return t>>>0}function f(e){let t=d(e),n=t%30;return`${Math.floor(t/30)%60} ${`${n},${n+30}`} * * * *`}function p(e){return`rt_${e}_${_}`.replace(/[^a-z0-9_]/gi,`_`).toLowerCase()}async function m(e,t){return o(e,t,await s())}async function h(e){let{sql:t,workspaceId:n,potSlug:r}=e,i=e.now??Date.now(),a=e.scoutMaxCostUsd??.5,o=await m(n,r),s=e.scoutCron??f(o),c=p(o),u=(await t`
    SELECT id FROM harness_shared.routines
     WHERE workspace_id = ${n} AND install_slug = ${o} AND name = ${_}
     LIMIT 1`).length>0;await l(t,{workspaceId:n,harnessSlug:r,enabled:!1,budgetUsd:null,now:i});let d=JSON.stringify({budget:{maxCostUsd:a}});return await t`
    INSERT INTO harness_shared.routines
      (id, install_slug, workspace_id, name, trigger_kind, trigger_config, target_role,
       payload_template, concurrency, catchup, active, next_fire_at)
    VALUES (${c}, ${o}, ${n}, ${_}, 'cron',
            ${JSON.stringify({cron:s})}::text::jsonb, ${v},
            ${d}::text::jsonb, 'skip', 'skip-old', false, now())
    ON CONFLICT (install_slug, name) DO UPDATE SET
      target_role = EXCLUDED.target_role,
      trigger_config = EXCLUDED.trigger_config,
      payload_template = EXCLUDED.payload_template,
      workspace_id = EXCLUDED.workspace_id,
      updated_at = now()`,{ok:!0,potSlug:r,gymAutoloop:!0,scoutRoutine:!0,scoutRoutineId:c,scoutMaxCostUsd:a,undo:async()=>{try{await t`
        DELETE FROM harness_shared.gym_autoloop_config
         WHERE workspace_id = ${n} AND harness_slug = ${r}`}catch{}try{await t`
        DELETE FROM harness_shared.routines
         WHERE workspace_id = ${n} AND install_slug = ${o} AND name = ${_}
           AND ${!u}`}catch{}}}}async function g(e){let{sql:t,workspaceId:i,potSlug:o}=e,s={potSlug:o,gymAutoloop:!1,scoutRoutine:!1,governorRegistrants:!1,gitSyncRoutines:!1};try{await t`
      DELETE FROM harness_shared.gym_autoloop_config
       WHERE workspace_id = ${i} AND harness_slug = ${o}`,s.gymAutoloop=!0}catch{}try{await t`
      DELETE FROM harness_shared.routines
       WHERE workspace_id = ${i} AND install_slug = ${o} AND name = ${_}`,s.scoutRoutine=!0}catch{}try{await a(t,{workspaceId:i,loopId:r(o)}),await a(t,{workspaceId:i,loopId:n(o)}),await a(t,{workspaceId:i,loopId:`scout:${o}`}),s.governorRegistrants=!0}catch{}try{await t`
      DELETE FROM harness_shared.routines
       WHERE workspace_id = ${i} AND install_slug = ${o}
         AND target_role IN ('system:git-sync', 'system:green-checkpoint', 'system:release-trigger', 'system:cross-hive-outbox-drain')`,s.gitSyncRoutines=!0}catch{}return s}var _,v,y,b=e((()=>{u(),t(),i(),c(),_=`scout-cycle`,v=`system:scout-cycle`,y=.5}));export{b as a,g as c,p as i,_ as n,h as o,v as r,f as s,y as t};