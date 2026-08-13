import{n as w}from"./chunk-ChpBd9eV.js";import{st as l,t as f}from"./src-BmBNODK0.js";import{c as v,r as h}from"./workspace-registry-Du2UbhlH.js";import{i as y,r as d}from"./octokit-client-DFHLp1yQ.js";import{t as E}from"./binding-types-DpQ6HWKb.js";function u(e){if(e==null)throw new Error("toIso: null/undefined timestamp (NOT NULL column violated)");return new Date(e).toISOString()}function D(e){const i={provider:e.provider,github_repository_id:Number(e.github_repository_id),github_full_name:e.github_full_name,harness_topic:e.harness_topic,harness_slug:e.harness_slug,harness_link:e.harness_link,privacy:e.privacy,claim_status:e.claim_status,provisional_owner_github_user_id:Number(e.provisional_owner_github_user_id),provisional_owner_github_login:e.provisional_owner_github_login??"",claimed_by_github_user_ids:(e.claimed_by_github_user_ids??[]).map(Number),created_at:u(e.created_at)};return e.claimed_at&&(i.claimed_at=u(e.claimed_at)),e.last_permission_verified_at&&(i.last_permission_verified_at=u(e.last_permission_verified_at)),e.superseded_by_harness_topic&&(i.superseded_by_harness_topic=e.superseded_by_harness_topic),i}function p(e){if(typeof e!="string"||e.length===0)return null;const i=e.trim(),s=i.match(/^https?:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?\/?$/);if(s)return{owner:s[1],repo:s[2]};const t=i.match(/^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/);return t?{owner:t[1],repo:t[2]}:null}async function g(e,i){const s=await d();s||n({code:"GITHUB_API_DOWN",message:"gh-token not authenticated"});try{const{data:t}=await s.repos.get({owner:e,repo:i});return{id:t.id,full_name:t.full_name,private:t.private}}catch(t){const a=t?.status;if(a===404&&n({code:"GITHUB_REPO_NOT_FOUND"}),a===403){if(t?.response?.headers?.["x-ratelimit-remaining"]==="0"){const r=Number(t?.response?.headers?.["x-ratelimit-reset"]??"0"),_=Math.floor(Date.now()/1e3);n({code:"GITHUB_API_RATE_LIMIT",retry_after_ms:Math.max(0,(r-_)*1e3)})}n({code:"GITHUB_REPO_PRIVATE_NO_ACCESS"})}n({code:"GITHUB_API_DOWN",message:String(t?.message??t)})}throw new Error("unreachable")}async function I(){const e=await d();e||n({code:"GITHUB_API_DOWN",message:"gh-token not authenticated"});try{const{data:i}=await e.users.getAuthenticated();return{login:i.login,id:i.id}}catch(i){throw n({code:"GITHUB_API_DOWN",message:String(i?.message??i)}),new Error("unreachable")}}async function k(e,i,s){const t=await d();t||n({code:"GITHUB_API_DOWN",message:"gh-token not authenticated"});try{const{data:a}=await t.repos.getCollaboratorPermissionLevel({owner:e,repo:i,username:s}),r=a.permission;return r==="admin"||r==="maintain"||r==="write"||r==="triage"||r==="read"?r:"none"}catch(a){if(a?.status===404)return"none";throw n({code:"GITHUB_API_DOWN",message:String(a?.message??a)}),new Error("unreachable")}}async function m(e,i){const{sql:s}=l(),t=await s`
    SELECT * FROM harness_shared.shared_repo_binding_cache
    WHERE workspace_id = ${e}
      AND provider = 'github'
      AND github_repository_id = ${i}
    LIMIT 1
  `;return t.length===0?null:D(t[0])}async function b(e,i){const{sql:s}=l();await s`
    INSERT INTO harness_shared.shared_repo_binding_cache
      (workspace_id, provider, github_repository_id, github_full_name,
       harness_topic, harness_slug, harness_link, privacy, claim_status,
       provisional_owner_github_user_id, provisional_owner_github_login,
       claimed_by_github_user_ids,
       created_at, claimed_at, last_permission_verified_at,
       superseded_by_harness_topic, cached_at)
    VALUES
      (${e}, ${i.provider}, ${i.github_repository_id}, ${i.github_full_name},
       ${i.harness_topic}, ${i.harness_slug}, ${i.harness_link}, ${i.privacy}, ${i.claim_status},
       ${i.provisional_owner_github_user_id}, ${i.provisional_owner_github_login},
       ${i.claimed_by_github_user_ids},
       ${i.created_at}, ${i.claimed_at??null}, ${i.last_permission_verified_at??null},
       ${i.superseded_by_harness_topic??null}, now())
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
  `}async function A(e){const i=p(e);i||n({code:"GITHUB_API_DOWN",message:"unparseable GitHub URL: "+e});const s=h(),{id:t,full_name:a,private:r}=await g(i.owner,i.repo),_=await m(s,t);_&&_.github_full_name!==a&&(_.github_full_name=a,await b(s,_));const[c,o]=a.split("/");return{github_repository_id:t,github_owner:c??i.owner,github_repo:o??i.repo,github_full_name:a,private:r,existing_binding:_}}async function S(e){const i=p(e.githubUrl);i||n({code:"GITHUB_API_DOWN",message:"unparseable GitHub URL: "+e.githubUrl});const s=h(),{id:t,full_name:a}=await g(i.owner,i.repo),r=await m(s,t);r&&r.claim_status!=="superseded"&&n({code:"BINDING_EXISTS",binding:r});const _=await I(),c="papercusp://harness?topic="+e.harness_topic+"&github="+a+"&repo_id="+String(t),o={provider:"github",github_repository_id:t,github_full_name:a,harness_topic:e.harness_topic,harness_slug:e.harness_slug,harness_link:c,privacy:e.privacy,claim_status:"unclaimed",provisional_owner_github_user_id:_.id,provisional_owner_github_login:_.login,claimed_by_github_user_ids:[],created_at:new Date().toISOString()};return await b(s,o),o}var n,P=w((()=>{f(),v(),y(),n=e=>{throw new E(e)}}));export{A as a,p as i,k as n,D as o,P as r,S as t};
