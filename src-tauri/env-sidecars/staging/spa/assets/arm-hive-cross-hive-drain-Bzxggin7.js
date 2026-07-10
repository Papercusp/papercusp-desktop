import{n as e}from"./chunk-CMxvf4Kt.js";function t(e){return`rt_${e}_cross_hive_outbox_drain`.replace(/[^a-z0-9_]/gi,`_`).toLowerCase()}async function n(e){let{sql:n,workspaceId:o,potSlug:s,active:c=!0}=e,l=t(s);return await n`
    INSERT INTO harness_shared.routines
      (id, install_slug, workspace_id, name, trigger_kind, trigger_config, target_role,
       payload_template, concurrency, catchup, active, next_fire_at)
    VALUES (${l}, ${s}, ${o}, ${r}, 'cron',
            ${JSON.stringify({cron:a})}::text::jsonb, ${i},
            ${JSON.stringify({})}::text::jsonb, 'skip', 'skip-old', ${c}, now())
    ON CONFLICT (install_slug, name) DO UPDATE SET
      trigger_config = EXCLUDED.trigger_config,
      target_role = EXCLUDED.target_role,
      active = EXCLUDED.active,
      updated_at = now()`,{routineId:l,undo:async()=>{try{await n`
        DELETE FROM harness_shared.routines
         WHERE workspace_id = ${o} AND install_slug = ${s} AND name = ${r}`}catch{}}}}var r,i,a;e((()=>{r=`cross-hive-outbox-drain`,i=`system:cross-hive-outbox-drain`,a=`30 */2 * * * *`}))();export{n as armHiveCrossHiveDrainRoutine};