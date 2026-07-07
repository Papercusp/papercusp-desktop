import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-DTtGQmae.js";import{s as r}from"./workspace-registry-C3lTKlnO.js";function i(e,t,n,r){return!!(e==null||e===`local`||t===`admit`||n!=null&&r!=null&&r.has(n))}function a(e,t){return e`(origin = 'local' OR origin IS NULL OR audit_verdict = 'admit'${t?e` OR (verified_author_github_user_id IS NOT NULL AND verified_author_github_user_id IN (SELECT trusted_github_user_id FROM harness_shared.user_trust_list WHERE workspace_id = ${t}))`:e``})`}async function o(e,t){let n=(t.authorPubkey??``).trim();if(!n||!t.workspaceId)return null;try{let r=t.hiveHomeSlug?e`AND hive_home_slug = ${t.hiveHomeSlug}`:e``,i=await e`
      SELECT github_user_id
        FROM harness_shared.hive_members
       WHERE workspace_id = ${t.workspaceId}
         ${r}
         AND binding_status = 'verified'
         AND NOT (${n} = ANY(COALESCE(revoked_pubkeys, ARRAY[]::text[])))
         AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(COALESCE(device_attestations, '[]'::jsonb)) a
            WHERE a->>'device_pubkey' = ${n}
         )
       LIMIT 1`;if(!i[0])return null;let a=i[0].github_user_id,o=typeof a==`string`?Number(a):a;return Number.isFinite(o)?o:null}catch{return null}}async function s(e){let n=new Set;if(!e)return n;try{let{sql:r}=t(),i=await r`
      SELECT trusted_github_user_id FROM harness_shared.user_trust_list
       WHERE workspace_id = ${e}`;for(let e of i){let t=e.trusted_github_user_id,r=typeof t==`string`?Number(t):t;Number.isFinite(r)&&n.add(r)}}catch{}return n}var c=e((()=>{n(),r()}));export{o as a,s as i,c as n,i as r,a as t};