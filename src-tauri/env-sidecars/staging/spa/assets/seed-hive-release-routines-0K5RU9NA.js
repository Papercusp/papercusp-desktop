const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/server-B1pdzCNE.js","assets/server-BnQHKcnx.js","assets/chunk-CMxvf4Kt.js","assets/types-BVF2mMkr.js","assets/path-Blx-PRXi.js","assets/__vite-browser-external-CM3Eme-n.js","assets/src-IEiM_KHA.js","assets/src-hh0DlH_5.js"])))=>i.map(i=>d[i]);
import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./preload-helper-B_k_wMTD.js";import{i as r,n as i}from"./hive-release-env-D14sZXJm.js";async function a(e){let[{getFlag:t},{FLAGS:i}]=await Promise.all([n(()=>import(`./server-B1pdzCNE.js`),__vite__mapDeps([0,1,2,3,4,5])),n(()=>import(`./src-IEiM_KHA.js`),__vite__mapDeps([6,7,2,3]))]);if(!await t(i.PER_HIVE_RELEASE_GATE,`system`))return{seeded:!1,reason:`flag_off`,undo:o};let a=await r(e.potSlug,e.workspaceId);if(a.isOperatorHome)return{seeded:!1,reason:`operator_home`,undo:o};if(!a.enabled)return{seeded:!1,reason:a.reason??`gate_disabled`,undo:o};let l=e.active??!0,u=a.hasDeploy?[s,c]:[s],d=[];for(let t of u){let n=`rt_${e.potSlug}_${t.name}`.replace(/[^a-z0-9_]/gi,`_`).toLowerCase();await e.sql`
      INSERT INTO harness_shared.routines
        (id, install_slug, workspace_id, name, trigger_kind, trigger_config, target_role,
         concurrency, catchup, active, next_fire_at)
      VALUES (${n}, ${e.potSlug}, ${e.workspaceId}, ${t.name}, 'cron',
              ${JSON.stringify({cron:t.cron})}::text::jsonb, ${t.target},
              'skip', 'skip-old', ${l}, now())
      ON CONFLICT (install_slug, name) DO UPDATE SET
        target_role = EXCLUDED.target_role,
        trigger_config = EXCLUDED.trigger_config,
        active = EXCLUDED.active,
        workspace_id = EXCLUDED.workspace_id,
        updated_at = now()
    `,d.push(t.name)}return{seeded:!0,routines:d,undo:async()=>{for(let t of u)try{await e.sql`DELETE FROM harness_shared.routines WHERE install_slug = ${e.potSlug} AND name = ${t.name}`}catch{}}}}var o,s,c;e((()=>{i(),t(),o=async()=>{},s={name:`green-checkpoint`,target:`system:green-checkpoint`,cron:`0 15 * * * *`},c={name:`release-trigger`,target:`system:release-trigger`,cron:`0 */15 * * * *`}}))();export{a as seedHiveReleaseRoutines};