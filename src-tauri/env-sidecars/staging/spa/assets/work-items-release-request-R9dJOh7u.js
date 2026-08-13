import{n as q}from"./chunk-ChpBd9eV.js";import{st as _,t as p}from"./src-BmBNODK0.js";import{c as f,r as w}from"./workspace-registry-Du2UbhlH.js";async function u(r,e,t){const s=await r`
    SELECT harness_slug, workspace_id
      FROM harness_shared.work_items
     WHERE feature_id = ${e}
       AND ${t?r`harness_slug = ${t}`:r`TRUE`}
     ORDER BY (workspace_id = ${w()}) DESC, updated_ts DESC NULLS LAST
     LIMIT 1`;return s[0]?{harnessSlug:s[0].harness_slug,workspaceId:s[0].workspace_id}:null}function i(r){if(!r||typeof r!="object")return null;const e=r;if(typeof e.release_request_by!="string"||!e.release_request_by||typeof e.release_request_holder!="string"||!e.release_request_holder)return null;const t=Number(e.release_request_deadline_at);if(!Number.isFinite(t))return null;const s=e.release_request_on_silence,a=s==="reclaim"||s==="escalate"||s==="nothing"?s:"nothing",n=o=>{if(o==null)return null;const l=Number(o);return Number.isFinite(l)?l:null},d=n(e.release_request_requested_at),c=n(e.release_request_resolved_at);return{by:e.release_request_by,holder:e.release_request_holder,reason:typeof e.release_request_reason=="string"?e.release_request_reason:"",onSilence:a,deadlineAt:t,requestedAt:d??t,resolved:e.release_request_resolved===!0||e.release_request_resolved==="true",resolution:typeof e.release_request_resolution=="string"?e.release_request_resolution:null,resolvedAt:c}}async function b(r,e){const{sql:t}=_(),s=await u(t,r,e.harness);if(!s)return null;const a=Date.now();return await t`
    UPDATE harness_shared.work_items
       SET payload = COALESCE(payload, '{}'::jsonb) || ${JSON.stringify({release_request_by:e.by,release_request_holder:e.holder,release_request_reason:e.reason,release_request_on_silence:e.onSilence,release_request_deadline_at:e.deadlineAt,release_request_requested_at:a,release_request_resolved:!1,release_request_resolution:null,release_request_resolved_at:null})}::text::jsonb,
           updated_ts = ${Date.now()}
     WHERE workspace_id = ${s.workspaceId} AND feature_id = ${r}`,{id:r,harness:s.harnessSlug,workspaceId:s.workspaceId}}async function m(r,e){const{sql:t}=_(),s=await u(t,r,e.harness);if(!s)return null;const a=Date.now(),n=await t`
    UPDATE harness_shared.work_items
       SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
             'release_request_resolved', true,
             'release_request_resolution', ${e.resolution}::text,
             'release_request_resolved_at', ${a}::bigint
           ),
           updated_ts = ${Date.now()}
     WHERE workspace_id = ${s.workspaceId} AND feature_id = ${r}
       AND payload ? 'release_request_by'
       AND COALESCE(payload->>'release_request_resolved', 'false') <> 'true'
     RETURNING payload`;return n[0]?i(n[0].payload):null}async function A(r,e){const t=await r`
    SELECT feature_id, harness_slug, workspace_id, taken_by, payload
      FROM harness_shared.work_items
     WHERE payload ? 'release_request_by'
       AND COALESCE(payload->>'release_request_resolved', 'false') <> 'true'
       AND (payload->>'release_request_deadline_at')::bigint <= ${e.nowMs}
     ORDER BY (payload->>'release_request_deadline_at')::bigint ASC
     LIMIT ${e.limit??200}`,s=[];for(const a of t){const n=i(a.payload);n&&s.push({id:a.feature_id,harness:a.harness_slug,workspaceId:a.workspace_id,holderNow:a.taken_by,request:n})}return s}var R=q((()=>{p(),f()}));export{b as a,m as i,R as n,i as r,A as t};
