import{n as f}from"./chunk-ChpBd9eV.js";function E(e){return m.includes(e)}function w(e){return String(e).trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")}function D(e){return/ies$/.test(e)&&e.length>4?`${e.slice(0,-3)}y`:/(s|x|z|ch|sh)es$/.test(e)?e.slice(0,-2):/s$/.test(e)&&!/ss$/.test(e)&&e.length>3?e.slice(0,-1):e}function $(e){let t=e;for(let i=0;i<4;i++){const a=D(t);if(a===t)return t;t=a}return t}function _(e){return w(e).split("-").filter(Boolean).map($).join("-")}async function k(e,t,i,a){const r=_(i);if(!r)return null;const o=await e`
    SELECT id, title
      FROM harness_shared.datatype_registry
     WHERE workspace_id = ${t} AND status = 'active'`;for(const s of o)if(!(a&&s.id===a)&&_(s.id)===r)return{id:s.id,title:s.title};return null}function p(e){if(e==null)return null;if(typeof e=="string")try{const t=JSON.parse(e);return t&&typeof t=="object"?t:null}catch{return null}return typeof e=="object"?e:null}function u(e){return{id:e.id,workspaceId:e.workspace_id,potSlug:e.pot_slug,title:e.title,description:e.description,tier:E(e.tier)?e.tier:"generic-kind",workItemKind:e.work_item_kind,payloadSchema:p(e.payload_schema),authoritativeWriter:e.authoritative_writer,selfImprovement:p(e.self_improvement),status:e.status,published:e.published,reviewStatus:e.review_status,tags:e.tags??[],hasEmbedding:e.has_embedding,createdBy:e.created_by,createdAt:l(e.created_at),updatedAt:l(e.updated_at)}}async function S(e,t){const i=t.embedding&&t.embedding.length>0?`[${t.embedding.join(",")}]`:null;return u((await e`
    INSERT INTO harness_shared.datatype_registry
      (id, workspace_id, pot_slug, title, description, tier, work_item_kind,
       payload_schema, authoritative_writer, self_improvement, published, tags,
       embedding, created_by, updated_at)
    VALUES (
      ${t.id}, ${t.workspaceId}, ${t.potSlug??null}, ${t.title},
      ${t.description}, ${t.tier}, ${t.workItemKind??null},
      ${t.payloadSchema?JSON.stringify(t.payloadSchema):null}::text::jsonb,
      ${t.authoritativeWriter??"papercusp"},
      ${t.selfImprovement?JSON.stringify(t.selfImprovement):null}::text::jsonb,
      ${t.published??!1}, ${t.tags??[]},
      ${i}::vector, ${t.createdBy??null}, now()
    )
    ON CONFLICT (workspace_id, id) DO UPDATE SET
      pot_slug            = EXCLUDED.pot_slug,
      title                = EXCLUDED.title,
      description          = EXCLUDED.description,
      tier                 = EXCLUDED.tier,
      work_item_kind       = EXCLUDED.work_item_kind,
      payload_schema       = EXCLUDED.payload_schema,
      authoritative_writer = EXCLUDED.authoritative_writer,
      self_improvement     = EXCLUDED.self_improvement,
      published            = EXCLUDED.published,
      tags                 = EXCLUDED.tags,
      -- keep the existing embedding when this write carries none (no embedder)
      embedding            = COALESCE(EXCLUDED.embedding, harness_shared.datatype_registry.embedding),
      updated_at           = now()
    RETURNING ${c(e)}`)[0])}async function b(e,t,i){const a=await e`
    SELECT ${c(e)} FROM harness_shared.datatype_registry
     WHERE workspace_id = ${t} AND id = ${i}
     LIMIT 1`;return a[0]?u(a[0]):null}function y(e){return e==null||!Number.isFinite(e)?h:Math.max(1,Math.min(g,Math.floor(e)))}async function v(e,t,i={}){const a=y(i.limit),r=i.tier?e`AND tier = ${i.tier}`:e``,o=i.activeOnly===!1?e``:e`AND status = 'active'`;return(await e`
    SELECT ${c(e)} FROM harness_shared.datatype_registry
     WHERE workspace_id = ${t} ${r} ${o}
     ORDER BY updated_at DESC, id
     LIMIT ${a}`).map(u)}async function T(e,t){return(await e`
    SELECT count(*)::int AS n FROM harness_shared.datatype_registry
     WHERE workspace_id = ${t} AND status = 'active'`)[0]?.n??0}async function I(e,t){const i=await e`
    SELECT tier, review_status, published, count(*)::int AS n
      FROM harness_shared.datatype_registry
     WHERE workspace_id = ${t} AND status = 'active'
     GROUP BY tier, review_status, published`,a={},r={};let o=0,s=0;for(const n of i)o+=n.n,a[n.tier]=(a[n.tier]??0)+n.n,r[n.review_status]=(r[n.review_status]??0)+n.n,n.published&&(s+=n.n);return{total:o,byTier:a,byReviewStatus:r,published:s}}async function R(e,t,i){const a=`${i.title} ${i.description??""}`.toLowerCase().split(/[^a-z0-9]+/).filter(d=>d.length>=2);if(a.length===0)return[];const r=a.join(" | "),o=Math.max(1,Math.min(20,i.limit??5)),s=i.embedding&&i.embedding.length>0?`[${i.embedding.join(",")}]`:null,n=i.excludeId?e`AND id <> ${i.excludeId}`:e``;return(await e`
    SELECT id, title, description, tier,
      ${s?e`GREATEST(
                  ts_rank(title_tsv, to_tsquery('english', ${r})),
                  CASE WHEN embedding IS NULL THEN 0
                       ELSE 0.4 * ts_rank(title_tsv, to_tsquery('english', ${r}))
                            + 0.6 * (1 - (embedding <=> ${s}::vector)) END
                )`:e`ts_rank(title_tsv, to_tsquery('english', ${r}))`} AS score
      FROM harness_shared.datatype_registry
     WHERE workspace_id = ${t} AND status = 'active' ${n}
       AND (
         title_tsv @@ to_tsquery('english', ${r})
         ${s?e`OR embedding IS NOT NULL`:e``}
       )
     ORDER BY score DESC
     LIMIT ${o}`).map(d=>({id:d.id,title:d.title,description:d.description,tier:E(d.tier)?d.tier:"generic-kind",score:Number(d.score)||0})).filter(d=>d.score>0)}async function N(e,t,i){return i?!!(await e`
    SELECT TRUE AS ok FROM harness_shared.datatype_registry
     WHERE workspace_id = ${t} AND status = 'active'
       AND tier = 'generic-kind' AND work_item_kind = ${i}
     LIMIT 1`)[0]?.ok:!1}async function A(e,t,i){if(!i)return null;const a=await e`
    SELECT ${c(e)} FROM harness_shared.datatype_registry
     WHERE workspace_id = ${t} AND status = 'active'
       AND tier = 'generic-kind' AND work_item_kind = ${i}
     LIMIT 1`;return a[0]?u(a[0]):null}async function C(e,t){return(await e`
    SELECT id FROM harness_shared.datatype_registry
     WHERE workspace_id = ${t} AND status = 'active'`).map(i=>i.id)}async function O(e,t,i){const a=await e`
    UPDATE harness_shared.datatype_registry
       SET published = true, review_status = 'pending', updated_at = now()
     WHERE workspace_id = ${t} AND id = ${i} AND review_status = 'none'
    RETURNING ${c(e)}`;return a[0]?u(a[0]):null}async function M(e,t={}){const i=y(t.limit);return(await e`
    SELECT ${c(e)} FROM harness_shared.datatype_registry
     WHERE review_status = 'approved'
     ORDER BY updated_at DESC, id
     LIMIT ${i}`).map(u)}async function U(e,t,i){const a=await e`
    SELECT ${c(e)} FROM harness_shared.datatype_registry
     WHERE id = ${t} AND review_status = 'approved'
     LIMIT 1`;if(!a[0])return{ok:!1,reason:"not_found"};if(await b(e,i,t))return{ok:!1,reason:"already_present"};const r=u(a[0]);return{ok:!0,datatype:await S(e,{id:r.id,workspaceId:i,potSlug:null,title:r.title,description:r.description,tier:r.tier,workItemKind:r.workItemKind,payloadSchema:r.payloadSchema,authoritativeWriter:r.authoritativeWriter,selfImprovement:r.selfImprovement,published:!1,tags:r.tags,embedding:null,createdBy:null})}}var m,l,c,h,g,F=f((()=>{m=["generic-kind","first-class","projection"],l=e=>e instanceof Date?e.toISOString():String(e),c=e=>e`
  id, workspace_id, pot_slug, title, description, tier, work_item_kind,
  payload_schema, authoritative_writer, self_improvement, status, published, review_status, tags,
  (embedding IS NOT NULL) AS has_embedding, created_by, created_at, updated_at
`,h=1e3,g=2e3}));export{w as _,k as a,A as c,U as d,E as f,O as g,C as h,I as i,N as l,v as m,_ as n,R as o,M as p,T as r,b as s,m as t,F as u,S as v};
