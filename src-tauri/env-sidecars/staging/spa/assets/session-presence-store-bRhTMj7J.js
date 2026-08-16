import{n as i}from"./chunk-ChpBd9eV.js";import{st as t,t as r}from"./src-8fWtxfEz.js";async function u(e,n){const a=n??t().sql,l=[];for(const _ of e.sessions)l.push(_.owner_id),await a`
      INSERT INTO harness_shared.shared_session_presence
        (workspace_id, pot_slug, harness_slug, owner_id, kind, intent, plan_slug,
         github_user_id, machine_label, device_pubkey, last_seen_at, schema_version,
         fleet_slug, fleet_role)
      VALUES
        (${e.workspaceId}, ${e.potSlug}, ${_.harness_slug}, ${_.owner_id},
         ${_.kind}, ${_.intent}, ${_.plan_slug}, ${e.githubUserId},
         ${e.machineLabel}, ${e.devicePubkey},
         to_timestamp(${e.frameTs} / 1000.0), 1,
         ${_.fleet_slug??null}, ${_.fleet_role??null})
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
    `;l.length>0?await a`
      DELETE FROM harness_shared.shared_session_presence
      WHERE workspace_id = ${e.workspaceId}
        AND device_pubkey = ${e.devicePubkey}
        AND machine_label = ${e.machineLabel}
        AND last_seen_at <= to_timestamp(${e.frameTs} / 1000.0)
        AND owner_id NOT IN ${a(l)}
    `:await a`
      DELETE FROM harness_shared.shared_session_presence
      WHERE workspace_id = ${e.workspaceId}
        AND device_pubkey = ${e.devicePubkey}
        AND machine_label = ${e.machineLabel}
        AND last_seen_at <= to_timestamp(${e.frameTs} / 1000.0)
    `}async function E(e,n){const a=n??t().sql,l=e.nowMs??Date.now(),_=new Date(l-e.staleMs);return(await a`
    SELECT workspace_id, pot_slug, harness_slug, owner_id, kind, intent, plan_slug,
           github_user_id, machine_label, device_pubkey, last_seen_at,
           fleet_slug, fleet_role
    FROM harness_shared.shared_session_presence
    WHERE workspace_id = ${e.workspaceId}
      AND last_seen_at > ${_}
      ${e.potSlug?a`AND pot_slug = ${e.potSlug}`:a``}
    ORDER BY last_seen_at DESC
  `).map(s=>({workspace_id:s.workspace_id,pot_slug:s.pot_slug,harness_slug:s.harness_slug,owner_id:s.owner_id,kind:s.kind,intent:s.intent,plan_slug:s.plan_slug,github_user_id:Number(s.github_user_id),machine_label:s.machine_label,device_pubkey:s.device_pubkey,last_seen_ms:new Date(s.last_seen_at).getTime(),fleet_slug:s.fleet_slug??null,fleet_role:s.fleet_role??null}))}async function g(e,n){const a=n??t().sql,l=e.nowMs??Date.now(),_=new Date(l-e.staleMs);return(await a`
    SELECT owner_id, fleet_role
      FROM harness_shared.shared_session_presence
     WHERE workspace_id = ${e.workspaceId}
       AND fleet_slug = ${e.fleetSlug}
       AND last_seen_at > ${_}
  `).map(s=>({ownerId:s.owner_id,fleetRole:s.fleet_role??null}))}var h=i((()=>{r()}));export{E as i,h as n,g as r,u as t};
