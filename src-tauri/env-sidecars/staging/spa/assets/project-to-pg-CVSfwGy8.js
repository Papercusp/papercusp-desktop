import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";import{D as r,a as i,n as a,t as o}from"./blueprint-CRMpO27b.js";import{a as s,r as c}from"./browser-CLhMtDLO.js";import{a as l,n as u,o as d,t as f}from"./proxy-LwEnxjuW.js";function p(e){try{let t=s((0,_.readFileSync)(e,`utf8`));t&&Array.isArray(t.ops)&&u(t.ops)}catch{}}async function m(e,t){let n=t.contentHash??a(t.blueprint);return await e`
    INSERT INTO harness_shared.blueprints
      (workspace_id, harness_slug, blueprint_id, version, resolved, content_hash, source_path, source_commit)
    VALUES (
      ${t.workspaceId}, ${t.harnessSlug}, ${t.blueprint.id}, ${t.blueprint.version},
      ${JSON.stringify(t.blueprint)}::text::jsonb, ${n},
      ${t.sourcePath??null}, ${t.sourceCommit??null}
    )
    ON CONFLICT (workspace_id, harness_slug) DO UPDATE SET
      blueprint_id  = EXCLUDED.blueprint_id,
      version       = EXCLUDED.version,
      resolved      = EXCLUDED.resolved,
      content_hash  = EXCLUDED.content_hash,
      source_path   = EXCLUDED.source_path,
      source_commit = EXCLUDED.source_commit,
      projected_at  = now()
  `,{contentHash:n}}async function h(e,t,n){let i=await e`
    SELECT resolved FROM harness_shared.blueprints
    WHERE workspace_id = ${t} AND harness_slug = ${n}
    LIMIT 1
  `;return i.length===0?null:r.parse(i[0].resolved)}async function g(e,t){let n=await h(e,t.workspaceId,t.harnessSlug);if(n)return u(n.ops??[]),n;if(!t.blueprintPath||!(0,_.existsSync)(t.blueprintPath))return null;p(t.blueprintPath);let r=i(t.blueprintPath,void 0,l());return u(r.blueprint.ops??[]),await m(e,{workspaceId:t.workspaceId,harnessSlug:t.harnessSlug,blueprint:r.blueprint,contentHash:r.contentHash,sourcePath:r.sourcePath}),r.blueprint}var _,v=e((()=>{_=t(n(),1),c(),o(),d(),f()}));export{v as n,g as t};