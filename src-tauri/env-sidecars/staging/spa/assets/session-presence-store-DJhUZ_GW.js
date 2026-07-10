import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-pJSq82rz.js";async function r(e,n){let r=n??t().sql,i=[];for(let t of e.sessions)i.push(t.owner_id),await r`
      INSERT INTO harness_shared.shared_session_presence
        (workspace_id, pot_slug, harness_slug, owner_id, kind, intent, plan_slug,
         github_user_id, machine_label, device_pubkey, last_seen_at, schema_version,
         fleet_slug, fleet_role)
      VALUES
        (${e.workspaceId}, ${e.potSlug}, ${t.harness_slug}, ${t.owner_id},
         ${t.kind}, ${t.intent}, ${t.plan_slug}, ${e.githubUserId},
         ${e.machineLabel}, ${e.devicePubkey},
         to_timestamp(${e.frameTs} / 1000.0), 1,
         ${t.fleet_slug??null}, ${t.fleet_role??null})
      ON CONFLICT (workspace_id, owner_id, machine_label) DO UPDATE SET
        pot_slug = EXCLUDED.pot_slug,
        harness_slug = EXCLUDED.harness_slug,
        kind = EXCLUDED.kind,
        intent = EXCLUDED.intent,
        plan_slug = EXCLUDED.plan_slug,
        github_user_id = EXCLUDED.github_user_id,
        device_pubkey = EXCLUDED.device_pubkey,
        last_seen_at = EXCLUDED.last_seen_at,
        fleet_slug = EXCLUDED.fleet_slug,
        fleet_role = EXCLUDED.fleet_role
      -- Never regress a newer beat with an out-of-order stale frame.
      WHERE shared_session_presence.last_seen_at <= EXCLUDED.last_seen_at
    `;i.length>0?await r`
      DELETE FROM harness_shared.shared_session_presence
      WHERE workspace_id = ${e.workspaceId}
        AND device_pubkey = ${e.devicePubkey}
        AND machine_label = ${e.machineLabel}
        AND last_seen_at <= to_timestamp(${e.frameTs} / 1000.0)
        AND owner_id NOT IN ${r(i)}
    `:await r`
      DELETE FROM harness_shared.shared_session_presence
      WHERE workspace_id = ${e.workspaceId}
        AND device_pubkey = ${e.devicePubkey}
        AND machine_label = ${e.machineLabel}
        AND last_seen_at <= to_timestamp(${e.frameTs} / 1000.0)
    `}async function i(e,n){let r=n??t().sql,i=e.nowMs??Date.now(),a=new Date(i-e.staleMs);return(await r`
    SELECT workspace_id, pot_slug, harness_slug, owner_id, kind, intent, plan_slug,
           github_user_id, machine_label, device_pubkey, last_seen_at,
           fleet_slug, fleet_role
    FROM harness_shared.shared_session_presence
    WHERE workspace_id = ${e.workspaceId}
      AND last_seen_at > ${a}
      ${e.potSlug?r`AND pot_slug = ${e.potSlug}`:r``}
    ORDER BY last_seen_at DESC
  `).map(e=>({workspace_id:e.workspace_id,pot_slug:e.pot_slug,harness_slug:e.harness_slug,owner_id:e.owner_id,kind:e.kind,intent:e.intent,plan_slug:e.plan_slug,github_user_id:Number(e.github_user_id),machine_label:e.machine_label,device_pubkey:e.device_pubkey,last_seen_ms:new Date(e.last_seen_at).getTime(),fleet_slug:e.fleet_slug??null,fleet_role:e.fleet_role??null}))}async function a(e,n){let r=n??t().sql,i=e.nowMs??Date.now(),a=new Date(i-e.staleMs);return(await r`
    SELECT owner_id, fleet_role
      FROM harness_shared.shared_session_presence
     WHERE workspace_id = ${e.workspaceId}
       AND fleet_slug = ${e.fleetSlug}
       AND last_seen_at > ${a}
  `).map(e=>({ownerId:e.owner_id,fleetRole:e.fleet_role??null}))}var o=e((()=>{n()}));export{i,o as n,a as r,r as t};