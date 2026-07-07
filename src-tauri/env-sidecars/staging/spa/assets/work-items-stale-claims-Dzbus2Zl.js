import{n as e}from"./chunk-CMxvf4Kt.js";import{i as t,n}from"./liveness-C2akzkQ4.js";import{r,t as i}from"./work-item-dispatch-states-DUjVV9AI.js";function a(e,t){return e`
      -- Mig-225 alias-aware liveness: presence rows…
      SELECT owner_id AS alias
        FROM harness_shared.coord_presence
       WHERE heartbeat_at IS NOT NULL
         AND (now() - heartbeat_at) < make_interval(secs => ${t})
      UNION
      -- …plus every alias of a RUNNING nursery row with a fresh heartbeat.
      SELECT a.alias
        FROM harness_shared.spawned_agents n
        CROSS JOIN LATERAL (VALUES (n.spawn_id), (n.session_owner), (n.run_id)) AS a(alias)
       WHERE n.status IN ('running', 'restarting')
         AND n.heartbeat_at IS NOT NULL
         AND (now() - n.heartbeat_at) < make_interval(secs => ${t})
         AND a.alias IS NOT NULL AND a.alias <> ''`}var o,s=e((()=>{t(),r(),o=n,Array.from(new Set([...i,`done`,`resolved`,`closed`,`dropped`]))}));export{s as n,a as r,o as t};