const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/projects-lite-DCFljOES.js","assets/chunk-ChpBd9eV.js","assets/src-6Py4l2MU.js","assets/harness-core-ZShh-qPN.js","assets/preload-helper-CcgcQsTF.js","assets/src-BmBNODK0.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/drizzle-orm-BbO4Lkx2.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js","assets/harness-phases-BpsRIn3_.js","assets/harness-registry-Cyujgx97.js","assets/operator-state-pg-DNPN5cby.js","assets/db-encryption-ByK3NqqK.js","assets/workspace-registry-Du2UbhlH.js","assets/workspace-als-CSW21ZcE.js","assets/workspace-id-constant-AQ2MH5pQ.js","assets/platform-pot-slug-C6n7Eole.js","assets/operator-home-harness-MSlRvOkW.js","assets/hive-groups-FD3WCUsg.js","assets/pr-poll-routine-CQLx8PMH.js","assets/pr-poll-routine-dwzj-0F4.js","assets/cron-CQ-fl78O.js","assets/clone-github-DKa1QN-d.js"])))=>i.map(i=>d[i]);
import{n as y}from"./chunk-ChpBd9eV.js";import{n as N,t as p}from"./preload-helper-CcgcQsTF.js";import{yt as m}from"./src-l3Ts7dqj.js";import{st as b,t as I}from"./src-BmBNODK0.js";import{t as k}from"./src-D8obk7J1.js";import{c as L,r as w}from"./workspace-registry-Du2UbhlH.js";import{i as C,n as P}from"./resolve-local-github-identity-BjMgRqRG.js";import{i as T,n as g}from"./types-BQl8SdZj.js";import{n as A,r as M}from"./binding-types-DpQ6HWKb.js";function f(r){return{harness_slug:r.harness_slug,github_user_id:r.github_user_id,pr_reviewer_role_enabled:!1,auto_review:!1,auto_merge:!1,merge_method:"squash",updated_at:r.now,schema_version:1}}function H(r,t,e){if(t.merge_method!==void 0&&!g.includes(t.merge_method))throw new TypeError("merge_method must be one of "+g.join(", "));return{...r,...t.pr_reviewer_role_enabled!==void 0?{pr_reviewer_role_enabled:t.pr_reviewer_role_enabled}:{},...t.auto_review!==void 0?{auto_review:t.auto_review}:{},...t.auto_merge!==void 0?{auto_merge:t.auto_merge}:{},...t.merge_method!==void 0?{merge_method:t.merge_method}:{},updated_at:e}}var j,F=y((()=>{T(),j=1}));function W(r,t){const e=r[t]??r[String(t)];return typeof e=="string"&&e.length>0?e:null}function q(r,t,e,i){if(r==="claimed"&&t.length>0){const s=t[0].login?`@${t[0].login}`:`user ${t[0].githubUserId}`,n=t.length-1;return n>0?`Claimed by ${s} + ${n} other${n===1?"":"s"}.`:`Claimed by ${s}.`}return r==="stale"?"The last claimant lost their GitHub permission — provisional-owner controls are re-enabled.":r==="superseded"?"This harness has been superseded by a newer canonical binding.":i?"Unclaimed — you're the provisional owner.":e?`Unclaimed — @${e} is the provisional owner.`:"Unclaimed — no provisional owner recorded."}function U(r,t){if(!r)return{status:"unclaimed",bindingId:null,claimantLogin:null,claimants:[],provisionalOwnerLogin:null,isProvisionalOwner:!1,isClaimant:!1,viewerCanClaim:!1,supersededByHref:null,claimantSummary:"This harness has no shared binding yet."};const e=r,i=(e.claimed_by_github_user_ids??[]).map(o=>({githubUserId:Number(o),login:W(e.claimant_logins??{},Number(o))})),s=e.provisional_owner_github_login&&e.provisional_owner_github_login.length>0?e.provisional_owner_github_login:null,n=t!=null&&Number(e.provisional_owner_github_user_id)===t,a=t!=null&&i.some(o=>o.githubUserId===t),d=(e.claim_status==="unclaimed"||e.claim_status==="stale")&&t!=null,u=e.claim_status==="superseded"&&e.superseded_by_harness_topic?`papercusp://harness?topic=${e.superseded_by_harness_topic}`:null;return{status:e.claim_status,bindingId:A("github",Number(e.github_repository_id)),claimantLogin:i[0]?.login??null,claimants:i,provisionalOwnerLogin:s,isProvisionalOwner:n,isClaimant:a,viewerCanClaim:d,supersededByHref:u,claimantSummary:q(e.claim_status,i,s,n)}}var x=y((()=>{M()}));function v(r){return{pr_reviewer_role_enabled:r.pr_reviewer_role_enabled,auto_review:r.auto_review,auto_merge:r.auto_merge,merge_method:r.merge_method}}function B(r){if(!r||typeof r!="object")return{ok:!1,error:"body required"};const t=r,e={};for(const i of["pr_reviewer_role_enabled","auto_review","auto_merge"])if(t[i]!==void 0){if(typeof t[i]!="boolean")return{ok:!1,error:`${i} must be a boolean`};e[i]=t[i]}if(t.merge_method!==void 0){if(typeof t.merge_method!="string"||!g.includes(t.merge_method))return{ok:!1,error:`merge_method must be one of ${g.join(", ")}`};e.merge_method=t.merge_method}return Object.keys(e).length===0?{ok:!1,error:"no recognised fields to update"}:{ok:!0,patch:e}}function V(r){if(!r||typeof r!="object")return{ok:!1,error:"body required"};const t=r.trusted_github_user_id,e=typeof t=="number"?t:Number.parseInt(String(t),10);return!Number.isInteger(e)||e<=0?{ok:!1,error:"trusted_github_user_id must be a positive integer"}:{ok:!0,trustedId:e}}function X(r){return r.auto_review!==void 0||r.auto_merge!==void 0}function G(r){return r.editable&&r.claimOwner}function J(r){if(r==null)return[];let t;if(Array.isArray(r))t=r;else{const e=String(r).trim();if(!e||e==="{}"||e==="[]")return[];if(e.startsWith("{")&&e.endsWith("}"))t=e.slice(1,-1).split(",");else try{const i=JSON.parse(e);t=Array.isArray(i)?i:[]}catch{return[]}}return t.map(e=>typeof e=="number"?e:Number.parseInt(String(e).trim(),10)).filter(e=>Number.isInteger(e)&&e>0)}async function D(r,t,e,i){if(i==null)return!1;try{const s=(await r`
      SELECT github_repository_id, claim_status,
             provisional_owner_github_user_id, provisional_owner_github_login,
             claimed_by_github_user_ids, superseded_by_harness_topic
        FROM harness_shared.shared_repo_binding_cache
       WHERE workspace_id = ${t}
         AND harness_slug = ${e}
       LIMIT 1
    `)[0];if(!s)return!0;const n=U({github_repository_id:Number(s.github_repository_id),claim_status:s.claim_status,provisional_owner_github_user_id:Number(s.provisional_owner_github_user_id),provisional_owner_github_login:s.provisional_owner_github_login??"",claimed_by_github_user_ids:J(s.claimed_by_github_user_ids),claimant_logins:{},superseded_by_harness_topic:s.superseded_by_harness_topic},i);return n.status==="claimed"&&n.isClaimant}catch{return!1}}function O(r,t,e,i){return r?{harness_slug:t,github_user_id:e,pr_reviewer_role_enabled:!!r.pr_reviewer_role_enabled,auto_review:!!r.auto_review,auto_merge:!!r.auto_merge,merge_method:g.includes(r.merge_method)?r.merge_method:"squash",updated_at:new Date(r.updated_at).getTime()}:f({harness_slug:t,github_user_id:e,now:i})}async function Y(r){try{const{buildProjectsLitePayload:t}=await p(async()=>{const{buildProjectsLitePayload:i}=await import("./projects-lite-DCFljOES.js");return{buildProjectsLitePayload:i}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22])),{hives:e}=await t();return e.find(i=>i.members.some(s=>s.slug===r))?.root.slug??null}catch{return null}}async function z(r,t,e){try{return(await r`
      SELECT 1 FROM harness_shared.pots
       WHERE workspace_id = ${t} AND pot_home_slug = ${e}
       LIMIT 1`).length>0}catch{return!1}}function K(r){return r.hasExplicitRow?"explicit":r.ownsHome?"ownership":r.homeRoleEnabled?"inherited":"none"}async function E(){try{const r=await C();return r.kind==="ok"?{id:r.githubUserId,login:r.githubLogin}:null}catch{return null}}async function Q(r){const t=w(),e=await E(),i=Date.now();try{const{sql:s}=b();let n=f({harness_slug:r,github_user_id:e?.id??0,now:i}),a=null,d=!1;if(e){const _=await s`
        SELECT pr_reviewer_role_enabled, auto_review, auto_merge, merge_method, updated_at
          FROM harness_shared.pr_reviewer_settings
         WHERE workspace_id = ${t}
           AND harness_slug = ${r}
           AND github_user_id = ${e.id}
         LIMIT 1
      `;if(n=O(_[0],r,e.id,i),!_[0]){const l=await Y(r),R=l?await z(s,t,l):!1,h=l&&l!==r?l:null;let $=!1;!R&&h&&($=!!(await s`
            SELECT pr_reviewer_role_enabled, auto_review, auto_merge, merge_method, updated_at
              FROM harness_shared.pr_reviewer_settings
             WHERE workspace_id = ${t}
               AND harness_slug = ${h}
               AND github_user_id = ${e.id}
             LIMIT 1
          `)[0]?.pr_reviewer_role_enabled);const S=K({hasExplicitRow:!1,ownsHome:R,homeRoleEnabled:$});S==="ownership"?(n={...n,pr_reviewer_role_enabled:!0},d=!0,a=h):S==="inherited"&&(n={...n,pr_reviewer_role_enabled:!0},a=h)}}const u=[];if(e){const _=await s`
        SELECT t.trusted_github_user_id, t.trusted_at, c.github_username
          FROM harness_shared.trusted_authors t
          LEFT JOIN harness_shared.contributors c
            ON c.workspace_id = t.workspace_id
           AND c.github_user_id = t.trusted_github_user_id
         WHERE t.workspace_id = ${t}
           AND t.harness_slug = ${r}
           AND t.trusted_by_github_user_id = ${e.id}
         ORDER BY t.trusted_at DESC
      `;for(const l of _)u.push({trusted_github_user_id:Number(l.trusted_github_user_id),trusted_login:l.github_username??null,trusted_at:new Date(l.trusted_at).toISOString()})}const o=(await s`
      SELECT id, pr_number, pr_url, author_github_id, action, detail, ts
        FROM harness_shared.auto_review_audit
       WHERE workspace_id = ${t}
         AND harness_slug = ${r}
       ORDER BY ts DESC
       LIMIT 50
    `).map(_=>({id:Number(_.id),pr_number:Number(_.pr_number),pr_url:_.pr_url,author_github_id:_.author_github_id==null?null:Number(_.author_github_id),action:_.action,detail:_.detail,ts:new Date(_.ts).toISOString()})),c=await D(s,t,r,e?.id??null);return{settings:v(n),trustList:u,audit:o,viewer:e?{github_user_id:e.id,github_login:e.login}:null,editable:!!e,claimOwner:c,autoModeEditable:G({editable:!!e,claimOwner:c}),inheritedFrom:a,grantedByOwnership:d}}catch(s){const n=s instanceof Error?s.message:String(s);if(/does not exist|relation .* does not exist/i.test(n))return{settings:v(f({harness_slug:r,github_user_id:e?.id??0,now:i})),trustList:[],audit:[],viewer:e?{github_user_id:e.id,github_login:e.login}:null,editable:!!e,claimOwner:!1,autoModeEditable:!1};throw s}}var Z,ee,re,te=y((()=>{k(),I(),L(),P(),F(),T(),x(),N(),Z=m({method:"GET",path:"/harness/:slug/pr-reviewer-settings",auth:"public",async handler(r,t){const e=t.params.slug,i=await Q(e);return Response.json(i)}}),ee=m({method:"POST",path:"/harness/:slug/pr-reviewer-settings",auth:"loopback",async handler(r,t){const e=t.params.slug,i=w(),s=await E();if(!s)return Response.json({error:"gh auth required to change PR-reviewer settings"},{status:401});const n=B(await r.json().catch(()=>null));if(!n.ok)return Response.json({error:n.error},{status:400});const{sql:a}=b(),d=Date.now();if(X(n.patch)&&!await D(a,i,e,s.id))return Response.json({error:"Only the claimed owner of this harness can change auto-mode. Claim the harness to configure auto-apply.",code:"NOT_CLAIMED_OWNER"},{status:403});const u=H(O((await a`
      SELECT pr_reviewer_role_enabled, auto_review, auto_merge, merge_method, updated_at
        FROM harness_shared.pr_reviewer_settings
       WHERE workspace_id = ${i}
         AND harness_slug = ${e}
         AND github_user_id = ${s.id}
       LIMIT 1
    `)[0],e,s.id,d),n.patch,d);await a`
      INSERT INTO harness_shared.pr_reviewer_settings
        (workspace_id, harness_slug, github_user_id,
         pr_reviewer_role_enabled, auto_review, auto_merge, merge_method, updated_at)
      VALUES
        (${i}, ${e}, ${s.id},
         ${u.pr_reviewer_role_enabled}, ${u.auto_review}, ${u.auto_merge},
         ${u.merge_method}, now())
      ON CONFLICT (workspace_id, harness_slug, github_user_id) DO UPDATE SET
        pr_reviewer_role_enabled = EXCLUDED.pr_reviewer_role_enabled,
        auto_review              = EXCLUDED.auto_review,
        auto_merge               = EXCLUDED.auto_merge,
        merge_method             = EXCLUDED.merge_method,
        updated_at               = now()
    `;try{if(u.pr_reviewer_role_enabled){const{seedPrPollRoutineForHarness:o}=await p(async()=>{const{seedPrPollRoutineForHarness:c}=await import("./pr-poll-routine-CQLx8PMH.js");return{seedPrPollRoutineForHarness:c}},__vite__mapDeps([23,24,1,4,5,6,7,8,9,2,10,11,12,25,26,17,18,19]));await o({workspaceId:i,installSlug:e,active:!0},{sql:a})}else{const{setPrPollRoutineActive:o}=await p(async()=>{const{setPrPollRoutineActive:c}=await import("./pr-poll-routine-CQLx8PMH.js");return{setPrPollRoutineActive:c}},__vite__mapDeps([23,24,1,4,5,6,7,8,9,2,10,11,12,25,26,17,18,19]));await o(a,e,!1)}}catch(o){console.warn(`[pr-reviewer-settings] pr-poll routine sync failed for ${e}: ${o instanceof Error?o.message:o}`)}return Response.json({ok:!0,settings:v(u)})}}),re=m({method:"POST",path:"/harness/:slug/pr-reviewer-settings/trust/remove",auth:"loopback",async handler(r,t){const e=t.params.slug,i=w(),s=await E();if(!s)return Response.json({error:"gh auth required to edit the trust list"},{status:401});const n=V(await r.json().catch(()=>null));if(!n.ok)return Response.json({error:n.error},{status:400});const{sql:a}=b();return await a`
      DELETE FROM harness_shared.trusted_authors
       WHERE workspace_id = ${i}
         AND harness_slug = ${e}
         AND trusted_by_github_user_id = ${s.id}
         AND trusted_github_user_id = ${n.trustedId}
    `,Response.json({ok:!0})}})}));te();export{Q as buildPrReviewerSettingsResponse};
