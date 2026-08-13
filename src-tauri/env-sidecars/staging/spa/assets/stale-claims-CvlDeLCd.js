import{n as _}from"./chunk-ChpBd9eV.js";import{i as t}from"./liveness-CJbX_ngm.js";async function g(s,e={}){const a=Math.max(1,Math.round((e.graceMs??6e5)/1e3));return{released:await s`
    WITH live_holder AS (
      -- Mig-225 alias-aware liveness: fresh presence rows…
      SELECT owner_id AS alias
        FROM harness_shared.coord_presence
       WHERE heartbeat_at IS NOT NULL
         AND (now() - heartbeat_at) < make_interval(secs => ${a})
      UNION
      -- …plus every alias of a RUNNING nursery row with a fresh heartbeat.
      SELECT a.alias
        FROM harness_shared.spawned_agents n
        CROSS JOIN LATERAL (VALUES (n.spawn_id), (n.session_owner), (n.run_id)) AS a(alias)
       WHERE n.status IN ('running', 'restarting')
         AND n.heartbeat_at IS NOT NULL
         AND (now() - n.heartbeat_at) < make_interval(secs => ${a})
         AND a.alias IS NOT NULL AND a.alias <> ''
    ),
    dead AS (
      SELECT c.workspace_id, c.harness_slug, c.plan_slug, c.item_id,
             c.owner AS former_owner,
             EXTRACT(EPOCH FROM (clock_timestamp() - c.expires_ts))::float8 AS lapsed_secs
        FROM harness_shared.plan_item_claims c
       WHERE c.expires_ts < clock_timestamp() - make_interval(secs => ${a})
         AND NOT EXISTS (SELECT 1 FROM live_holder h WHERE h.alias = c.owner)
         FOR UPDATE OF c SKIP LOCKED
    )
    DELETE FROM harness_shared.plan_item_claims c
      USING dead d
     WHERE c.workspace_id = d.workspace_id AND c.harness_slug = d.harness_slug
       AND c.plan_slug = d.plan_slug AND c.item_id = d.item_id
    RETURNING d.workspace_id, d.harness_slug, d.plan_slug, d.item_id,
              d.former_owner, d.lapsed_secs`}}async function o(s,e={}){const a=Math.max(1,Math.round((e.graceMs??i)/1e3));return{released:await s`
    WITH live_alias AS (
      -- Mig-225 alias-aware liveness: fresh presence rows…
      SELECT owner_id AS alias
        FROM harness_shared.coord_presence
       WHERE heartbeat_at IS NOT NULL
         AND (now() - heartbeat_at) < make_interval(secs => ${a})
      UNION
      -- …plus every alias of a RUNNING nursery row with a fresh heartbeat.
      SELECT a.alias
        FROM harness_shared.spawned_agents n
        CROSS JOIN LATERAL (VALUES (n.spawn_id), (n.session_owner), (n.run_id)) AS a(alias)
       WHERE n.status IN ('running', 'restarting')
         AND n.heartbeat_at IS NOT NULL
         AND (now() - n.heartbeat_at) < make_interval(secs => ${a})
         AND a.alias IS NOT NULL AND a.alias <> ''
    ),
    dead AS (
      SELECT asg.workspace_id, asg.harness_slug, asg.plan_slug, asg.item_id,
             asg.assignee_name AS former_assignee,
             EXTRACT(EPOCH FROM (now() - asg.assigned_ts))::float8 AS reserved_secs
        FROM harness_shared.plan_item_assignments asg
       WHERE asg.released_ts IS NULL
         AND asg.assignee_name IS NOT NULL AND asg.assignee_name <> ''
         AND asg.assigned_ts IS NOT NULL
         AND (now() - asg.assigned_ts) > make_interval(secs => ${a})
         -- name-aware DEAD: neither the name itself (session-id case) nor any
         -- session that ADOPTED the name (stable-name case) is a live alias.
         AND NOT EXISTS (SELECT 1 FROM live_alias h WHERE h.alias = asg.assignee_name)
         AND NOT EXISTS (
           SELECT 1 FROM harness_shared.agent_name_sessions s
             JOIN live_alias h ON h.alias = s.session_owner_id
            WHERE s.workspace_id = asg.workspace_id AND s.agent_name = asg.assignee_name
         )
         FOR UPDATE OF asg SKIP LOCKED
    )
    UPDATE harness_shared.plan_item_assignments asg
       SET released_ts = now(), origin = 'local'
      FROM dead d
     WHERE asg.workspace_id = d.workspace_id AND asg.harness_slug = d.harness_slug
       AND asg.plan_slug = d.plan_slug AND asg.item_id = d.item_id
    RETURNING d.workspace_id, d.harness_slug, d.plan_slug, d.item_id,
              d.former_assignee, d.reserved_secs`}}async function A(s,e={}){const a=Math.max(1,Math.round((e.activityMs??r)/1e3)),n=Math.max(1,Math.round((e.livenessMs??6e5)/1e3));return{released:await s`
    WITH
    -- Process-ALIVE aliases (fresh heartbeat within the tight liveness window).
    live_alias AS (
      SELECT owner_id AS alias
        FROM harness_shared.coord_presence
       WHERE heartbeat_at IS NOT NULL
         AND (now() - heartbeat_at) < make_interval(secs => ${n})
      UNION
      SELECT a.alias
        FROM harness_shared.spawned_agents n
        CROSS JOIN LATERAL (VALUES (n.spawn_id), (n.session_owner), (n.run_id)) AS a(alias)
       WHERE n.status IN ('running', 'restarting')
         AND n.heartbeat_at IS NOT NULL
         AND (now() - n.heartbeat_at) < make_interval(secs => ${n})
         AND a.alias IS NOT NULL AND a.alias <> ''
    ),
    -- GENUINELY-ACTIVE aliases (fresh last_active_at) — the real-work clock (mig 277),
    -- NOT the keepalive heartbeat. A holder in live_alias but NOT here is "stalled".
    active_alias AS (
      SELECT owner_id AS alias
        FROM harness_shared.coord_presence
       WHERE last_active_at IS NOT NULL
         AND (now() - last_active_at) < make_interval(secs => ${a})
    ),
    dead AS (
      SELECT asg.workspace_id, asg.harness_slug, asg.plan_slug, asg.item_id,
             asg.assignee_name AS former_assignee,
             EXTRACT(EPOCH FROM (now() - asg.assigned_ts))::float8 AS reserved_secs
        FROM harness_shared.plan_item_assignments asg
       WHERE asg.released_ts IS NULL
         AND asg.assignee_name IS NOT NULL AND asg.assignee_name <> ''
         AND asg.assigned_ts IS NOT NULL
         AND (now() - asg.assigned_ts) > make_interval(secs => ${a})
         -- Holder is process-ALIVE (name itself OR an adopting session heartbeats)…
         AND (
           EXISTS (SELECT 1 FROM live_alias h WHERE h.alias = asg.assignee_name)
           OR EXISTS (
             SELECT 1 FROM harness_shared.agent_name_sessions s
               JOIN live_alias h ON h.alias = s.session_owner_id
              WHERE s.workspace_id = asg.workspace_id AND s.agent_name = asg.assignee_name
           )
         )
         -- …but NOT genuinely active anywhere (name itself NOR any adopting session).
         AND NOT EXISTS (SELECT 1 FROM active_alias h WHERE h.alias = asg.assignee_name)
         AND NOT EXISTS (
           SELECT 1 FROM harness_shared.agent_name_sessions s
             JOIN active_alias h ON h.alias = s.session_owner_id
            WHERE s.workspace_id = asg.workspace_id AND s.agent_name = asg.assignee_name
         )
         FOR UPDATE OF asg SKIP LOCKED
    )
    UPDATE harness_shared.plan_item_assignments asg
       SET released_ts = now(), origin = 'local'
      FROM dead d
     WHERE asg.workspace_id = d.workspace_id AND asg.harness_slug = d.harness_slug
       AND asg.plan_slug = d.plan_slug AND asg.item_id = d.item_id
    RETURNING d.workspace_id, d.harness_slug, d.plan_slug, d.item_id,
              d.former_assignee, d.reserved_secs`}}var l,i,r,S=_((()=>{t(),l=600*1e3,i=(()=>{const s=Number({}.PAPERCUSP_PLAN_ASSIGNMENT_GRACE_MS??36e5);return Number.isFinite(s)&&s>0?s:3600*1e3})(),r=(()=>{const s=Number({}.PAPERCUSP_PLAN_ASSIGNMENT_ACTIVITY_MS??18e5);return Number.isFinite(s)&&s>0?s:1800*1e3})()}));export{g as a,S as i,i as n,o,l as r,A as s,r as t};
