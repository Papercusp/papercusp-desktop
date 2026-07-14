import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-BvZp-r10.js";import{s as r}from"./workspace-registry-Bu1Yy540.js";function i(e,t,n,r,i,a){return!!(e==null||e===`local`||t===`admit`||i!=null&&i!==``&&a!=null&&a.has(i)||n!=null&&r!=null&&r.has(n))}function a(e,t){return e`(origin = 'local' OR origin IS NULL OR audit_verdict = 'admit'${t?e` OR (verified_author_github_user_id IS NOT NULL AND verified_author_github_user_id IN (SELECT trusted_github_user_id FROM harness_shared.user_trust_list WHERE workspace_id = ${t}))`:e``}${t?e` OR ${o(e,t)}`:e``})`}function o(e,t){return e`(author_pubkey IS NOT NULL AND author_pubkey <> '' AND author_pubkey IN (
    SELECT DISTINCT author_pubkey
      FROM harness_shared.harness_features_consolidated
     WHERE workspace_id = ${t}
       AND (origin = 'local' OR origin IS NULL)
       AND author_pubkey IS NOT NULL
       AND author_pubkey <> ''
  ))`}async function s(e,t){let n=(t.authorPubkey??``).trim();if(!n||!t.workspaceId)return null;try{let r=t.potHomeSlug?e`AND pot_home_slug = ${t.potHomeSlug}`:e``,i=await e`
      SELECT github_user_id
        FROM harness_shared.pot_members
       WHERE workspace_id = ${t.workspaceId}
         ${r}
         AND binding_status = 'verified'
         AND NOT (${n} = ANY(COALESCE(revoked_pubkeys, ARRAY[]::text[])))
         AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(COALESCE(device_attestations, '[]'::jsonb)) a
            WHERE a->>'device_pubkey' = ${n}
         )
       LIMIT 1`;if(!i[0])return null;let a=i[0].github_user_id,o=typeof a==`string`?Number(a):a;return Number.isFinite(o)?o:null}catch{return null}}async function c(e){let n=new Set;if(!e)return n;try{let{sql:r}=t(),i=await r`
      SELECT trusted_github_user_id FROM harness_shared.user_trust_list
       WHERE workspace_id = ${e}`;for(let e of i){let t=e.trusted_github_user_id,r=typeof t==`string`?Number(t):t;Number.isFinite(r)&&n.add(r)}}catch{}return n}var l=e((()=>{n(),r()}));export{s as a,c as i,l as n,i as r,a as t};