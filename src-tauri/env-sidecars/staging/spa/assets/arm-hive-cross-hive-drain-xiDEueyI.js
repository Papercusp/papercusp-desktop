import{n as c}from"./chunk-ChpBd9eV.js";function u(r){return`rt_${r}_cross_hive_outbox_drain`.replace(/[^a-z0-9_]/gi,"_").toLowerCase()}async function l(r){const{sql:i,workspaceId:n,potSlug:t,active:_=!0}=r,a=u(t);return await i`
    INSERT INTO harness_shared.routines
      (id, install_slug, workspace_id, name, trigger_kind, trigger_config, target_role,
       payload_template, concurrency, catchup, active, next_fire_at)
    VALUES (${a}, ${t}, ${n}, ${e}, 'cron',
            ${JSON.stringify({cron:s})}::text::jsonb, ${o},
            ${JSON.stringify({})}::text::jsonb, 'skip', 'skip-old', ${_}, now())
    ON CONFLICT (install_slug, name) DO UPDATE SET
      trigger_config = EXCLUDED.trigger_config,
      target_role = EXCLUDED.target_role,
      active = EXCLUDED.active,
      updated_at = now()`,{routineId:a,undo:async()=>{try{await i`
        DELETE FROM harness_shared.routines
         WHERE workspace_id = ${n} AND install_slug = ${t} AND name = ${e}`}catch{}}}}var e,o,s,E=c((()=>{e="cross-hive-outbox-drain",o="system:cross-hive-outbox-drain",s="30 */2 * * * *"}));E();export{l as armHiveCrossHiveDrainRoutine};
