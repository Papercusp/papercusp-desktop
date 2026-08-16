import{n as k}from"./chunk-ChpBd9eV.js";import{D as N,m}from"./agent-config-constants-CdA1I_Mk.js";import{st as d,t as q}from"./src-8fWtxfEz.js";import{r as D}from"./coordination-event-log-browser-s_EyGDm7.js";function E(e){return e==="trusted-members"||e==="whole-pot"}function h(e){return`${e.model}:${e.effort}:${e.account}`}function f(e){const t=e?.trim();return t&&t!=="*"&&t!=="default"?t:void 0}function w(e){return e==="account"||e==="gpu"||e==="agent_slot"}function O(e){return typeof e=="string"&&m.includes(e)}function y(e){return{workspaceId:e.workspace_id,fleetSlug:e.fleet_slug,potSlug:e.pot_slug,audience:E(e.audience)?e.audience:null,resourceKind:e.resource_kind,resourceRef:e.resource_ref,sharePct:Number(e.share_pct),quantity:e.quantity==null?null:Number(e.quantity),axis:e.axis??{},status:e.status,createdByGithubUserId:e.created_by_github_user_id==null?null:Number(e.created_by_github_user_id),createdAt:new Date(e.created_at).toISOString(),updatedAt:new Date(e.updated_at).toISOString()}}async function x(e,t){const r=f(e.workspaceId);if(!r)return[];const o=t??d().sql;return(await o`
    SELECT * FROM harness_shared.resource_allotments
     WHERE workspace_id = ${r}
       ${e.fleetSlug?o`AND fleet_slug = ${e.fleetSlug}`:o``}
       ${e.potSlug?o`AND pot_slug = ${e.potSlug}`:o``}
       ${e.includePaused?o``:o`AND status = 'active'`}
     ORDER BY fleet_slug, pot_slug, resource_kind, resource_ref
  `).map(y)}function R(e){const t=e.axis??{},r=typeof t.model=="string"?t.model.trim():"";if(!r||r.includes(":"))return{ok:!1,refusal:{code:"invalid_model",detail:`agent_slot requires axis.model (non-empty, no ':' — colons are the slot-ref separators); got ${JSON.stringify(t.model??null)}.`}};if(!O(t.effort))return{ok:!1,refusal:{code:"invalid_effort",detail:`agent_slot requires axis.effort ∈ ${m.join("|")}; got ${JSON.stringify(t.effort??null)}.`}};const o=typeof t.account=="string"?t.account.trim():"";if(!o||o.includes(":"))return{ok:!1,refusal:{code:"invalid_account",detail:`agent_slot requires axis.account (a gateway account/pool id or 'AUTO'; non-empty, no ':'); got ${JSON.stringify(t.account??null)}.`}};if(e.quantity==null)return{ok:!1,refusal:{code:"quantity_required",detail:"agent_slot allotments are COUNT-capped (D-002): quantity is required."}};if(!Number.isInteger(e.quantity)||e.quantity<1||e.quantity>1e3)return{ok:!1,refusal:{code:"quantity_out_of_range",detail:`quantity must be an integer 1..${$} (got ${String(e.quantity)}).`}};const n={model:r,effort:t.effort,account:o};return{ok:!0,axis:n,ref:h(n),quantity:e.quantity}}async function v(e,t){const r=f(e.workspaceId);if(!r)return{ok:!1,refusal:{code:"workspace_unresolved",detail:`Allotment write refused: unresolvable workspace partition (got ${JSON.stringify(e.workspaceId??null)}).`}};if(!w(e.resourceKind))return{ok:!1,refusal:{code:"invalid_resource_kind",detail:`resource_kind must be account|gpu|agent_slot (got '${String(e.resourceKind)}').`}};const o=e.fleetSlug?.trim()||void 0,n=e.potSlug?.trim()||void 0;if(!o&&!n)return{ok:!1,refusal:{code:"grantee_required",detail:"exactly one of fleetSlug/potSlug is required."}};if(o&&n)return{ok:!1,refusal:{code:"grantee_conflict",detail:"fleetSlug and potSlug are mutually exclusive — exactly one names the grantee."}};if(n&&!E(e.audience))return{ok:!1,refusal:{code:"audience_required",detail:`a pot-scoped allotment requires audience ∈ ${S.join("|")} (D-002 — no silent default); got ${JSON.stringify(e.audience??null)}.`}};if(o&&e.audience!=null)return{ok:!1,refusal:{code:"audience_not_applicable",detail:"audience only applies to a pot-scoped (potSlug) allotment, not a fleet-scoped one."}};const g=n?e.audience:null;let s,i,a,l;if(e.resourceKind==="agent_slot"){const u=R(e);if(!u.ok)return{ok:!1,refusal:u.refusal};s=u.ref,i=0,a=u.quantity,l={...e.axis??{},...u.axis}}else{if(!e.resourceRef?.trim())return{ok:!1,refusal:{code:"resource_required",detail:"resourceRef is required."}};if(typeof e.sharePct!="number"||!Number.isFinite(e.sharePct)||e.sharePct<0||e.sharePct>100)return{ok:!1,refusal:{code:"invalid_share_pct",detail:`sharePct must be 0–100 (got ${String(e.sharePct)}).`}};s=e.resourceRef,i=Math.round(e.sharePct),a=null,l=e.axis??{}}const _=t??d().sql,p=e.status??"active";let c;return n?c=await _`
      INSERT INTO harness_shared.resource_allotments
        (workspace_id, pot_slug, audience, resource_kind, resource_ref, share_pct, quantity, axis, status, created_by_github_user_id)
      VALUES
        (${r}, ${n}, ${g}, ${e.resourceKind}, ${s}, ${i}, ${a},
         ${JSON.stringify(l)}::text::jsonb, ${p}, ${e.createdByGithubUserId??null})
      ON CONFLICT (workspace_id, pot_slug, resource_kind, resource_ref) WHERE pot_slug IS NOT NULL
      DO UPDATE SET share_pct = EXCLUDED.share_pct,
                    quantity = EXCLUDED.quantity,
                    axis = EXCLUDED.axis,
                    status = EXCLUDED.status,
                    audience = EXCLUDED.audience,
                    updated_at = now()
      RETURNING *
    `:c=await _`
      INSERT INTO harness_shared.resource_allotments
        (workspace_id, fleet_slug, resource_kind, resource_ref, share_pct, quantity, axis, status, created_by_github_user_id)
      VALUES
        (${r}, ${o}, ${e.resourceKind}, ${s}, ${i}, ${a},
         ${JSON.stringify(l)}::text::jsonb, ${p}, ${e.createdByGithubUserId??null})
      ON CONFLICT (workspace_id, fleet_slug, resource_kind, resource_ref) WHERE fleet_slug IS NOT NULL
      DO UPDATE SET share_pct = EXCLUDED.share_pct,
                    quantity = EXCLUDED.quantity,
                    axis = EXCLUDED.axis,
                    status = EXCLUDED.status,
                    updated_at = now()
      RETURNING *
    `,{ok:!0,allotment:y(c[0])}}async function C(e,t){const r=f(e.workspaceId);if(!r)return{ok:!0,removed:0};const o=t??d().sql,n=e.potSlug?.trim()||void 0;return{ok:!0,removed:(await o`
    DELETE FROM harness_shared.resource_allotments
     WHERE workspace_id = ${r}
       AND ${n?o`pot_slug = ${n}`:o`fleet_slug = ${e.fleetSlug??""}`}
       AND resource_kind = ${e.resourceKind}
       AND resource_ref = ${e.resourceRef}
    RETURNING fleet_slug
  `).length}}var S,$,P=k((()=>{q(),D(),N(),S=["trusted-members","whole-pot"],$=1e3}));export{x as a,v as c,P as i,S as n,C as o,h as r,f as s,$ as t};
