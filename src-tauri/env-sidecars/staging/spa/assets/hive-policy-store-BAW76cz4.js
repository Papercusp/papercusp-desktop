import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-DTtGQmae.js";function r(e){if(Array.isArray(e))return e.map(r);if(e&&typeof e==`object`){let t=e,n={};for(let e of Object.keys(t).sort())n[e]=r(t[e]);return n}return e}function i(e){return JSON.stringify(r(e??{}))}function a(e){let t=[s,e.workspaceId,e.hiveHomeSlug,String(e.policyVersion),e.canonicalPolicyJson].join(`
`);return Buffer.from(t,`utf8`)}function o(e){if(!e)return{};try{let t=JSON.parse(e);return t&&typeof t==`object`&&!Array.isArray(t)?t:{}}catch{return{}}}var s,c=e((()=>{s=`papercusp-hive-policy-v1`}));function l(e){return e??t().sql}function u(e){return{workspaceId:e.workspace_id,hiveHomeSlug:e.harness_slug,policy:o(e.policy_json),policyVersion:Number(e.policy_version),ownerPubkey:e.owner_pubkey,signature:e.signature,policyJson:e.policy_json,fedHlc:e.fed_hlc,updatedAt:Number(e.updated_at)}}async function d(e,t,n){let r=await l(n).unsafe(`SELECT ${p} FROM harness_shared.hive_policy
      WHERE workspace_id = $1 AND harness_slug = $2 LIMIT 1`,[e,t]);return r[0]?u(r[0]):null}async function f(e,t){let n=l(t),r=Date.now();return u((await n.unsafe(`INSERT INTO harness_shared.hive_policy
       (workspace_id, harness_slug, policy_json, owner_pubkey, signature, policy_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (workspace_id, harness_slug) DO UPDATE SET
       policy_json    = EXCLUDED.policy_json,
       owner_pubkey   = EXCLUDED.owner_pubkey,
       signature      = EXCLUDED.signature,
       policy_version = EXCLUDED.policy_version,
       updated_at     = $7
     RETURNING ${p}`,[e.workspaceId,e.hiveHomeSlug,e.policyJson,e.ownerPubkey,e.signature,e.policyVersion,r]))[0])}var p,m=e((()=>{n(),c(),p=`workspace_id, harness_slug, policy_json, owner_pubkey, signature, policy_version, fed_hlc, updated_at`}));export{a,i,m as n,c as o,f as r,d as t};