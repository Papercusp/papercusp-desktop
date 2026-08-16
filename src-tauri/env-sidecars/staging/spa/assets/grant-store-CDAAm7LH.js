import{n as s}from"./chunk-ChpBd9eV.js";import{st as n,t as i}from"./src-8fWtxfEz.js";import{r as o}from"./coordination-event-log-browser-s_EyGDm7.js";import{t as _}from"./capabilities-ByKQbq_Q.js";function p(e){const t=e?.trim();return t&&t!=="*"&&t!=="default"?t:void 0}function u(e){return{workspaceId:e.workspace_id,potSlug:e.harness_slug,grantorGithubUserId:Number(e.grantor_github_user_id),grantorLogin:e.grantor_login,granteeKind:e.grantee_kind,granteeRef:e.grantee_ref,capabilities:e.capabilities??[],preset:e.preset,status:e.status,grantorEpoch:Number(e.grantor_epoch),wakeRateCapPerHour:e.wake_rate_cap_per_hour,excludedDevicePubkeys:e.excluded_device_pubkeys??[],note:e.note}}async function E(e,t){const r=p(e.workspaceId);if(!r)return[];const a=t??n().sql;return(e.includeRevoked?await a`
        SELECT * FROM harness_shared.p2p_peer_grants
         WHERE workspace_id = ${r} AND harness_slug = ${e.potSlug}
         ORDER BY grantor_github_user_id, grantee_kind, grantee_ref`:await a`
        SELECT * FROM harness_shared.p2p_peer_grants
         WHERE workspace_id = ${r} AND harness_slug = ${e.potSlug} AND status = 'active'
         ORDER BY grantor_github_user_id, grantee_kind, grantee_ref`).map(u)}async function k(e,t){!Number.isFinite(e.epoch)||e.epoch<=0||await(t??n().sql)`
    INSERT INTO harness_shared.p2p_grantor_epochs
      (workspace_id, harness_slug, grantor_github_user_id, high_water_epoch, updated_at)
    VALUES (${e.workspaceId}, ${e.potSlug}, ${e.grantorGithubUserId}, ${e.epoch}, now())
    ON CONFLICT (workspace_id, harness_slug, grantor_github_user_id)
    DO UPDATE SET high_water_epoch = GREATEST(harness_shared.p2p_grantor_epochs.high_water_epoch, EXCLUDED.high_water_epoch),
                  updated_at = now()`}var b=s((()=>{i(),o(),_()}));export{p as i,b as n,E as r,k as t};
