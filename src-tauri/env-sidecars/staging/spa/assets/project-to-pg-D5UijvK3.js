import{n as i,o}from"./chunk-ChpBd9eV.js";import{t as c}from"./__vite-browser-external-56mrcCg8.js";import{D as l,a as u,c as _,t as p}from"./blueprint-Y2T1McXM.js";import{a as h,r as d}from"./browser-EuA9NEWL.js";import{a as b,n,o as m,t as E}from"./proxy-CNzMWgF_.js";function f(e){try{const r=h((0,a.readFileSync)(e,"utf8"));r&&Array.isArray(r.ops)&&n(r.ops)}catch{}}async function g(e,r){const s=r.contentHash??u(r.blueprint);return await e`
    INSERT INTO harness_shared.blueprints
      (workspace_id, harness_slug, blueprint_id, version, resolved, content_hash, source_path, source_commit)
    VALUES (
      ${r.workspaceId}, ${r.harnessSlug}, ${r.blueprint.id}, ${r.blueprint.version},
      ${JSON.stringify(r.blueprint)}::text::jsonb, ${s},
      ${r.sourcePath??null}, ${r.sourceCommit??null}
    )
    ON CONFLICT (workspace_id, harness_slug) DO UPDATE SET
      blueprint_id  = EXCLUDED.blueprint_id,
      version       = EXCLUDED.version,
      resolved      = EXCLUDED.resolved,
      content_hash  = EXCLUDED.content_hash,
      source_path   = EXCLUDED.source_path,
      source_commit = EXCLUDED.source_commit,
      projected_at  = now()
  `,{contentHash:s}}async function w(e,r,s){const t=await e`
    SELECT resolved FROM harness_shared.blueprints
    WHERE workspace_id = ${r} AND harness_slug = ${s}
    LIMIT 1
  `;return t.length===0?null:l.parse(t[0].resolved)}async function I(e,r){const s=await w(e,r.workspaceId,r.harnessSlug);if(s)return n(s.ops??[]),s;if(!r.blueprintPath||!(0,a.existsSync)(r.blueprintPath))return null;f(r.blueprintPath);const t=_(r.blueprintPath,void 0,b());return n(t.blueprint.ops??[]),await g(e,{workspaceId:r.workspaceId,harnessSlug:r.harnessSlug,blueprint:t.blueprint,contentHash:t.contentHash,sourcePath:t.sourcePath}),t.blueprint}var a,O=i((()=>{a=o(c(),1),d(),p(),m(),E()}));export{O as n,I as t};
