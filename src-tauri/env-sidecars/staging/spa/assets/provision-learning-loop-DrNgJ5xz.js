import{n as E}from"./chunk-ChpBd9eV.js";import{i as y,n as m,t as w}from"./workspace-brain-scope-CSTdDbOD.js";import{a as h,c as D,s as $}from"./core-DRHbIRj9.js";import{i as f,t as i}from"./store-Dz4TrzNu.js";import{a as R,p as L}from"./control-plane-8zkkVijI.js";function T(s){let t=2166136261;for(let o=0;o<s.length;o++)t^=s.charCodeAt(o),t=t+((t<<1)+(t<<4)+(t<<7)+(t<<8)+(t<<24))>>>0;return t>>>0}function C(s){const t=T(s),o=t%30;return`${Math.floor(t/30)%60} ${`${o},${o+30}`} * * * *`}function A(s){return`rt_${s}_${n}`.replace(/[^a-z0-9_]/gi,"_").toLowerCase()}async function O(s,t){return y(s,t,await m())}async function F(s){const{sql:t,workspaceId:o,potSlug:a}=s,e=s.now??Date.now(),c=s.scoutMaxCostUsd??.5,r=await O(o,a),l=s.scoutCron??C(r),u=A(r),p=(await t`
    SELECT id FROM harness_shared.routines
     WHERE workspace_id = ${o} AND install_slug = ${r} AND name = ${n}
     LIMIT 1`).length>0;await L(t,{workspaceId:o,harnessSlug:a,enabled:!1,budgetUsd:null,now:e});const g=!0,d=JSON.stringify({budget:{maxCostUsd:c}});return await t`
    INSERT INTO harness_shared.routines
      (id, install_slug, workspace_id, name, trigger_kind, trigger_config, target_role,
       payload_template, concurrency, catchup, active, next_fire_at)
    VALUES (${u}, ${r}, ${o}, ${n}, 'cron',
            ${JSON.stringify({cron:l})}::text::jsonb, ${_},
            ${d}::text::jsonb, 'skip', 'skip-old', false, now())
    ON CONFLICT (install_slug, name) DO UPDATE SET
      target_role = EXCLUDED.target_role,
      trigger_config = EXCLUDED.trigger_config,
      payload_template = EXCLUDED.payload_template,
      workspace_id = EXCLUDED.workspace_id,
      updated_at = now()`,{ok:!0,potSlug:a,gymAutoloop:g,scoutRoutine:!0,scoutRoutineId:u,scoutMaxCostUsd:c,undo:async()=>{try{await t`
        DELETE FROM harness_shared.gym_autoloop_config
         WHERE workspace_id = ${o} AND harness_slug = ${a}`}catch{}try{await t`
        DELETE FROM harness_shared.routines
         WHERE workspace_id = ${o} AND install_slug = ${r} AND name = ${n}
           AND ${!p}`}catch{}}}}async function P(s){const{sql:t,workspaceId:o,potSlug:a}=s,e={potSlug:a,gymAutoloop:!1,scoutRoutine:!1,governorRegistrants:!1,gitSyncRoutines:!1};try{await t`
      DELETE FROM harness_shared.gym_autoloop_config
       WHERE workspace_id = ${o} AND harness_slug = ${a}`,e.gymAutoloop=!0}catch{}try{await t`
      DELETE FROM harness_shared.routines
       WHERE workspace_id = ${o} AND install_slug = ${a} AND name = ${n}`,e.scoutRoutine=!0}catch{}try{await i(t,{workspaceId:o,loopId:h(a)}),await i(t,{workspaceId:o,loopId:D(a)}),await i(t,{workspaceId:o,loopId:`scout:${a}`}),e.governorRegistrants=!0}catch{}try{await t`
      DELETE FROM harness_shared.routines
       WHERE workspace_id = ${o} AND install_slug = ${a}
         AND target_role IN (
           'system:git-sync',
           'system:green-checkpoint',
           'system:release-trigger',
           'system:cross-pot-outbox-drain',
           'system:cross-hive-outbox-drain'
         )`,e.gitSyncRoutines=!0}catch{}return e}var n,_,N,S,W=E((()=>{R(),$(),f(),w(),n="scout-cycle",_="system:scout-cycle",N=30,S=.5}));export{A as a,P as c,W as i,n,F as o,_ as r,C as s,S as t};
