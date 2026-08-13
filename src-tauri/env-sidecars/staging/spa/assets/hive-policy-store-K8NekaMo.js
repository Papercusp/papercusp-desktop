import{n as _}from"./chunk-ChpBd9eV.js";import{st as d,t as g}from"./src-BmBNODK0.js";function t(e){if(Array.isArray(e))return e.map(t);if(e&&typeof e=="object"){const o=e,s={};for(const n of Object.keys(o).sort())s[n]=t(o[n]);return s}return e}function $(e){return JSON.stringify(t(e??{}))}function m(e){const o=[l,e.workspaceId,e.potHomeSlug,String(e.policyVersion),e.canonicalPolicyJson].join(`
`);return Buffer.from(o,"utf8")}function w(e){if(!e)return{};try{const o=JSON.parse(e);return o&&typeof o=="object"&&!Array.isArray(o)?o:{}}catch{return{}}}var l,h=_((()=>{l="papercusp-hive-policy-v1"}));function p(e){return e??d().sql}function f(e){return{workspaceId:e.workspace_id,potHomeSlug:e.harness_slug,policy:w(e.policy_json),policyVersion:Number(e.policy_version),ownerPubkey:e.owner_pubkey,signature:e.signature,policyJson:e.policy_json,fedHlc:e.fed_hlc,updatedAt:Number(e.updated_at)}}async function v(e,o,s){const n=await p(s).unsafe(`SELECT ${a} FROM harness_shared.pot_policy
      WHERE workspace_id = $1 AND harness_slug = $2 LIMIT 1`,[e,o]);return n[0]?f(n[0]):null}async function P(e,o,s){const n=s?.ttlMs??2e3,c=`${e}::${o}`,r=i.get(c),u=Date.now();if(r&&u-r.at<n)return r.value;const y=await v(e,o,s?.sql);return i.set(c,{at:u,value:y}),y}async function b(e,o){const s=p(o),n=Date.now();return f((await s.unsafe(`INSERT INTO harness_shared.pot_policy
       (workspace_id, harness_slug, policy_json, owner_pubkey, signature, policy_version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (workspace_id, harness_slug) DO UPDATE SET
       policy_json    = EXCLUDED.policy_json,
       owner_pubkey   = EXCLUDED.owner_pubkey,
       signature      = EXCLUDED.signature,
       policy_version = EXCLUDED.policy_version,
       updated_at     = $7
     RETURNING ${a}`,[e.workspaceId,e.potHomeSlug,e.policyJson,e.ownerPubkey,e.signature,e.policyVersion,n]))[0])}var a,i,I=_((()=>{g(),h(),a="workspace_id, harness_slug, policy_json, owner_pubkey, signature, policy_version, fed_hlc, updated_at",i=new Map}));export{$ as a,b as i,P as n,m as o,I as r,h as s,v as t};
