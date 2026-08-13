const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/server-BdefWo3P.js","assets/server-CB1HiStO.js","assets/chunk-ChpBd9eV.js","assets/types-B6UfiA7g.js","assets/src-6Py4l2MU.js","assets/src-CcVVQee4.js","assets/src-CL56NiZm.js"])))=>i.map(i=>d[i]);
import{n as u}from"./chunk-ChpBd9eV.js";import{n as E,t as i}from"./preload-helper-CcgcQsTF.js";import{i as m,n as f}from"./hive-release-env-DBcTBTNZ.js";async function R(e){const[{getFlag:c},{FLAGS:l}]=await Promise.all([i(()=>import("./server-BdefWo3P.js"),__vite__mapDeps([0,1,2,3,4])),i(()=>import("./src-CcVVQee4.js"),__vite__mapDeps([5,6,2,3]))]);if(!await c(l.PER_POT_RELEASE_GATE,"system"))return{seeded:!1,reason:"flag_off",undo:t};const a=await m(e.potSlug,e.workspaceId);if(a.isOperatorHome)return{seeded:!1,reason:"operator_home",undo:t};if(!a.enabled)return{seeded:!1,reason:a.reason??"gate_disabled",undo:t};const d=e.active??!0,s=a.hasDeploy?[n,_]:[n],o=[];for(const r of s){const g=`rt_${e.potSlug}_${r.name}`.replace(/[^a-z0-9_]/gi,"_").toLowerCase();await e.sql`
      INSERT INTO harness_shared.routines
        (id, install_slug, workspace_id, name, trigger_kind, trigger_config, target_role,
         concurrency, catchup, active, next_fire_at)
      VALUES (${g}, ${e.potSlug}, ${e.workspaceId}, ${r.name}, 'cron',
              ${JSON.stringify({cron:r.cron})}::text::jsonb, ${r.target},
              'skip', 'skip-old', ${d}, now())
      ON CONFLICT (install_slug, name) DO UPDATE SET
        target_role = EXCLUDED.target_role,
        trigger_config = EXCLUDED.trigger_config,
        -- active intentionally NOT re-applied on conflict (EI-19301170070808928): a
        -- re-seed must never clobber an operator's runtime pause/resume of this routine.
        workspace_id = EXCLUDED.workspace_id,
        updated_at = now()
    `,o.push(r.name)}return{seeded:!0,routines:o,undo:async()=>{for(const r of s)try{await e.sql`DELETE FROM harness_shared.routines WHERE install_slug = ${e.potSlug} AND name = ${r.name}`}catch{}}}}var t,n,_,p=u((()=>{f(),E(),t=async()=>{},n={name:"green-checkpoint",target:"system:green-checkpoint",cron:"0 15 * * * *"},_={name:"release-trigger",target:"system:release-trigger",cron:"0 */15 * * * *"}}));p();export{R as seedHiveReleaseRoutines};
