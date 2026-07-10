import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-pJSq82rz.js";import{n as r,s as i}from"./workspace-registry-C3lTKlnO.js";import{i as a,r as o}from"./octokit-client-E6BpJXMf.js";var s,c=e((()=>{s=class extends Error{error;constructor(e){super(e.code),this.error=e,this.name=`BindingServiceErrorThrowable`}}}));function l(e){if(e==null)throw Error(`toIso: null/undefined timestamp (NOT NULL column violated)`);return new Date(e).toISOString()}function u(e){let t={provider:e.provider,github_repository_id:Number(e.github_repository_id),github_full_name:e.github_full_name,harness_topic:e.harness_topic,harness_slug:e.harness_slug,harness_link:e.harness_link,privacy:e.privacy,claim_status:e.claim_status,provisional_owner_github_user_id:Number(e.provisional_owner_github_user_id),provisional_owner_github_login:e.provisional_owner_github_login??``,claimed_by_github_user_ids:(e.claimed_by_github_user_ids??[]).map(Number),created_at:l(e.created_at)};return e.claimed_at&&(t.claimed_at=l(e.claimed_at)),e.last_permission_verified_at&&(t.last_permission_verified_at=l(e.last_permission_verified_at)),e.superseded_by_harness_topic&&(t.superseded_by_harness_topic=e.superseded_by_harness_topic),t}function d(e){if(typeof e!=`string`||e.length===0)return null;let t=e.trim(),n=t.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?\/?$/);if(n)return{owner:n[1],repo:n[2]};let r=t.match(/^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/);return r?{owner:r[1],repo:r[2]}:null}async function f(e,t){let n=await o();n||_({code:`GITHUB_API_DOWN`,message:`gh-token not authenticated`});try{let{data:r}=await n.repos.get({owner:e,repo:t});return{id:r.id,full_name:r.full_name,private:r.private}}catch(e){let t=e?.status;if(t===404&&_({code:`GITHUB_REPO_NOT_FOUND`}),t===403){if(e?.response?.headers?.[`x-ratelimit-remaining`]===`0`){let t=Number(e?.response?.headers?.[`x-ratelimit-reset`]??`0`),n=Math.floor(Date.now()/1e3);_({code:`GITHUB_API_RATE_LIMIT`,retry_after_ms:Math.max(0,(t-n)*1e3)})}_({code:`GITHUB_REPO_PRIVATE_NO_ACCESS`})}_({code:`GITHUB_API_DOWN`,message:String(e?.message??e)})}throw Error(`unreachable`)}async function p(){let e=await o();e||_({code:`GITHUB_API_DOWN`,message:`gh-token not authenticated`});try{let{data:t}=await e.users.getAuthenticated();return{login:t.login,id:t.id}}catch(e){throw _({code:`GITHUB_API_DOWN`,message:String(e?.message??e)}),Error(`unreachable`)}}async function m(e,n){let{sql:r}=t(),i=await r`
    SELECT * FROM harness_shared.shared_repo_binding_cache
    WHERE workspace_id = ${e}
      AND provider = 'github'
      AND github_repository_id = ${n}
    LIMIT 1
  `;return i.length===0?null:u(i[0])}async function h(e,n){let{sql:r}=t();await r`
    INSERT INTO harness_shared.shared_repo_binding_cache
      (workspace_id, provider, github_repository_id, github_full_name,
       harness_topic, harness_slug, harness_link, privacy, claim_status,
       provisional_owner_github_user_id, provisional_owner_github_login,
       claimed_by_github_user_ids,
       created_at, claimed_at, last_permission_verified_at,
       superseded_by_harness_topic, cached_at)
    VALUES
      (${e}, ${n.provider}, ${n.github_repository_id}, ${n.github_full_name},
       ${n.harness_topic}, ${n.harness_slug}, ${n.harness_link}, ${n.privacy}, ${n.claim_status},
       ${n.provisional_owner_github_user_id}, ${n.provisional_owner_github_login},
       ${n.claimed_by_github_user_ids},
       ${n.created_at}, ${n.claimed_at??null}, ${n.last_permission_verified_at??null},
       ${n.superseded_by_harness_topic??null}, now())
    ON CONFLICT (workspace_id, provider, github_repository_id) DO UPDATE SET
      github_full_name = EXCLUDED.github_full_name,
      harness_topic = EXCLUDED.harness_topic,
      harness_slug = EXCLUDED.harness_slug,
      harness_link = EXCLUDED.harness_link,
      privacy = EXCLUDED.privacy,
      claim_status = EXCLUDED.claim_status,
      provisional_owner_github_user_id = EXCLUDED.provisional_owner_github_user_id,
      provisional_owner_github_login = EXCLUDED.provisional_owner_github_login,
      claimed_by_github_user_ids = EXCLUDED.claimed_by_github_user_ids,
      claimed_at = EXCLUDED.claimed_at,
      last_permission_verified_at = EXCLUDED.last_permission_verified_at,
      superseded_by_harness_topic = EXCLUDED.superseded_by_harness_topic,
      cached_at = now()
  `}async function g(e){let t=d(e.githubUrl);t||_({code:`GITHUB_API_DOWN`,message:`unparseable GitHub URL: `+e.githubUrl});let n=r(),{id:i,full_name:a}=await f(t.owner,t.repo),o=await m(n,i);o&&o.claim_status!==`superseded`&&_({code:`BINDING_EXISTS`,binding:o});let s=await p(),c=`papercusp://harness?topic=`+e.harness_topic+`&github=`+a+`&repo_id=`+String(i),l={provider:`github`,github_repository_id:i,github_full_name:a,harness_topic:e.harness_topic,harness_slug:e.harness_slug,harness_link:c,privacy:e.privacy,claim_status:`unclaimed`,provisional_owner_github_user_id:s.id,provisional_owner_github_login:s.login,claimed_by_github_user_ids:[],created_at:new Date().toISOString()};return await h(n,l),l}var _;e((()=>{n(),i(),a(),c(),_=e=>{throw new s(e)}}))();export{g as createUnclaimedBinding};