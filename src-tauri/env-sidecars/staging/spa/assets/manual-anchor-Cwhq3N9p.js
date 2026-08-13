import{n as u,o as E}from"./chunk-ChpBd9eV.js";import{yt as I}from"./src-l3Ts7dqj.js";import{st as l,t as L}from"./src-BmBNODK0.js";import{t as p}from"./__vite-browser-external-56mrcCg8.js";import{t as J}from"./src-D8obk7J1.js";import{t as V,z as B}from"./src-t4Mg1mJS.js";import{n as G,t as z}from"./workspace-id-constant-AQ2MH5pQ.js";import{f as K,l as C,o as j}from"./harness-registry-Cyujgx97.js";import{a as Y,i as k,t as Q}from"./git-runner-0qeA0BIG.js";import{n as Z,r as ee}from"./completion-ref-types-C-kDQ6d5.js";import{n as c,t as x}from"./workspace-for-harness-DBX8J2P3.js";async function te(e){return(await C()).projects.find(t=>t.slug===e)?.path??null}async function H(e){try{const t=await h.promises.readFile((0,d.join)(e,".papercusp","docs.json"),"utf8"),s=JSON.parse(t);if(typeof s.root=="string"&&s.root.trim()){const r=O(e,s.root.trim());if(r&&(0,h.existsSync)(r))return r}}catch{}return(0,d.join)(e,"docs")}async function se(e){const t=[];async function s(r){let n;try{n=await h.promises.readdir(r,{withFileTypes:!0})}catch{return}for(const a of n){if(a.name.startsWith("."))continue;const o=(0,d.join)(r,a.name);a.isDirectory()?await s(o):a.isFile()&&/\.(md|mdx)$/i.test(a.name)&&t.push((0,d.relative)(e,o))}}return await s(e),t.sort()}function O(e,t){const s=(0,d.resolve)(e,t),r=(0,d.resolve)(e)+d.sep;return s!==(0,d.resolve)(e)&&!s.startsWith(r)?null:s}function ne(e){return e.length===0?null:e.find(t=>/^index\.(md|mdx)$/i.test(t))??e.find(t=>/^README\.(md|mdx)$/i.test(t))??e[0]}var h,d,re,ae=u((()=>{h=E(p(),1),d=E(p(),1),J(),j(),re=I({method:"GET",path:"/harness/:slug/project-docs",auth:"public",async handler(e,t){const s=t.params.slug,r=new URL(e.url).searchParams.get("path")?.trim()??"",n=await te(s);if(!n)return Response.json({ok:!1,reason:"unknown_harness",files:[],activePath:null,content:null});const a=await H(n);if(!(0,h.existsSync)(a))return Response.json({ok:!0,reason:"no_docs_dir",projectPath:n,files:[],activePath:null,content:null});const o=await se(a);if(o.length===0)return Response.json({ok:!0,reason:"empty",projectPath:n,files:[],activePath:null,content:null});const i=r&&o.includes(r)?r:ne(o),f=i?O(a,i):null,g=f&&(0,h.existsSync)(f)?await h.promises.readFile(f,"utf8"):null;return Response.json({ok:!0,projectPath:n,files:o,activePath:i,content:g})}})}));async function oe(e){return K(await C(),e)??null}async function P(e){const t=await oe(e);return t?{repoRoot:t,docsRoot:await H(t)}:null}var ie=u((()=>{j(),ae()}));async function qe(e){const t=[];async function s(r){let n;try{n=await $.promises.readdir(r,{withFileTypes:!0})}catch{return}for(const a of n){if(a.name.startsWith("."))continue;const o=(0,m.join)(r,a.name);a.isDirectory()?await s(o):a.isFile()&&/\.(md|mdx)$/i.test(a.name)&&t.push((0,m.relative)(e,o))}}return await s(e),t.sort()}function ce(e,t){const s=(0,m.resolve)(e,t),r=(0,m.resolve)(e)+m.sep;return s!==(0,m.resolve)(e)&&!s.startsWith(r)?null:s}async function le(e,t){const s=ce(e,t);if(!s||!(0,$.existsSync)(s))return null;try{return await $.promises.readFile(s,"utf8")}catch{return null}}function Me(e){return e.length===0?null:e.find(t=>/^index\.(md|mdx)$/i.test(t))??e.find(t=>/^README\.(md|mdx)$/i.test(t))??e[0]}var $,m,fe=u((()=>{$=E(p(),1),m=E(p(),1)}));function de(e,t=z){return async s=>{const{sql:r}=l(),n=(await r`
      SELECT completion_ref
        FROM harness_shared.harness_features_consolidated
       WHERE workspace_id = ${t} AND harness_slug = ${e} AND feature_id = ${s}
       LIMIT 1`)[0]?.completion_ref;return n&&ee(n)&&n.commit_sha?[n.commit_sha]:[]}}var ue=u((()=>{L(),G(),Z()}));function A(e){const t=e.trim();if(!t)return null;if(N.test(t))return{kind:"feature",ref:t.toUpperCase()};const s=t.indexOf("::");if(s!==-1){const r=t.slice(0,s).trim(),n=t.slice(s+2).trim();return r&&n?{kind:"symbol",file:r,name:n}:r?{kind:"path",globs:[r]}:null}return{kind:"path",globs:[t]}}function U(e){if(e==null)return[];if(typeof e=="string"){const t=A(e);return t?[t]:[]}if(Array.isArray(e)){const t=[],s=[];for(const r of e)if(typeof r=="string"){const n=A(r);if(!n)continue;n.kind==="path"?s.push(...n.globs):t.push(n)}else if(r&&typeof r=="object"){const n=r;if(typeof n.feature=="string"&&N.test(n.feature.trim()))t.push({kind:"feature",ref:n.feature.trim().toUpperCase()});else if(typeof n.symbol=="string"||typeof n.file=="string"&&typeof n.name=="string"){if(typeof n.file=="string"&&typeof n.name=="string"&&n.file.trim()&&n.name.trim())t.push({kind:"symbol",file:n.file.trim(),name:n.name.trim()});else if(typeof n.symbol=="string"){const a=A(n.symbol);a&&t.push(a)}}else if(typeof n.path=="string"&&n.path.trim())s.push(n.path.trim());else if(Array.isArray(n.paths))for(const a of n.paths)typeof a=="string"&&a.trim()&&s.push(a.trim())}return s.length&&t.unshift({kind:"path",globs:s}),t}return typeof e=="object"?U([e]):[]}function _e(e){const t=/^---\r?\n([\s\S]*?)\r?\n---/.exec(e);if(!t)return;const s=t[1],r=/^documents:[ \t]*(.*)$/m.exec(s);if(!r)return;const n=r[1].trim();if(n&&n!=="|"&&n!==">")return n.startsWith("[")?n.replace(/^\[|\]$/g,"").split(",").map(i=>i.trim().replace(/^['"]|['"]$/g,"")).filter(Boolean):n.replace(/^['"]|['"]$/g,"");const a=s.slice((r.index??0)+r[0].length),o=[];for(const i of a.split(`
`)){const f=/^\s*-\s+(.*)$/.exec(i);if(f)o.push(f[1].trim().replace(/^['"]|['"]$/g,""));else if(i.trim()&&!/^\s/.test(i))break}return o.length?o:void 0}function he(e){switch(e.kind){case"path":return e.globs.join(", ");case"symbol":return`${e.file} :: ${e.name}`;case"feature":return e.ref}}function Xe(e){return e.map(he).join("; ")}async function me(e,t){switch(e.kind){case"path":return[...e.globs];case"symbol":return[e.file];case"feature":{const s=await t.resolveFeatureCommits?.(e.ref)??[];if(!s.length)return[];const r=new Set;for(const n of s){const a=await t.runGit(["show","--name-only","--format=",n],t.repoRoot);if(a.code===0)for(const o of a.stdout.split(`
`)){const i=o.trim();i&&r.add(i)}}return[...r]}}}async function Ee(e,t){const s=new Set;for(const r of e)for(const n of await me(r,t))s.add(n);return[...s]}var N,pe=u((()=>{N=/^(?:F|WI|EI)-\d+$/i}));function ge(e){return["# ⚠ GENERATED PROJECTION — DO NOT EDIT THIS FILE BY HAND.",`# ${W} (doc_id=${e}).`,"# Edit the doc with docs:author { overwrite: true } — a hand-edit here is REFUSED by","# the next projection (it cannot tell your edit from corruption), so it blocks the","# whole corpus instead of shipping. See agent-insights/authoring-docs-pg-canonical."]}function ye(e){const t=e.startsWith("\uFEFF")?"\uFEFF":"",s=t?e.slice(1):e,r=/^---[ \t]*(\r?\n)([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(s);return r?{present:!0,bom:t,offset:r[0].indexOf(r[1])+r[1].length,eol:r[1],yaml:r[2]}:{present:!1,bom:t,offset:0,eol:`
`,yaml:""}}function Ie(e,t){const s=ye(e);if(!s.present)return e;const r=s.bom?e.slice(1):e,n=ge(t).join(s.eol)+s.eol;return`${s.bom}${r.slice(0,s.offset)}${n}${r.slice(s.offset)}`}function we(e){const t=B(e,{dates:"string"});return t.present&&t.ok&&t.data?t.data:null}var T,F,W,De=u((()=>{T=E(p(),1),V(),F=e=>(0,T.createHash)("sha256").update(e,"utf8").digest("hex"),W="Projected from Postgres: harness_shared.harness_docs.content"}));function S(e){const t=Array.isArray(e.subject_ref)?e.subject_ref:[];return{workspaceId:e.workspace_id,harnessSlug:e.harness_slug,docId:e.doc_id,source:e.source??"manual",subjectRef:t,anchorPaths:e.anchor_paths??[],generatedFromSha:e.generated_from_sha,lastVerifiedSha:e.last_verified_sha,lastVerifiedAt:_(e.last_verified_at),overlay:e.overlay,status:e.status??"untracked",statusDetail:e.status_detail,statusCheckedAt:_(e.status_checked_at),regenEnqueuedAt:_(e.regen_enqueued_at),reverifyFlaggedAt:_(e.reverify_flagged_at),regenAttempts:e.regen_attempts??0,reverifyAttempts:e.reverify_attempts??0,title:e.title,createdAt:_(e.created_at)??"",updatedAt:_(e.updated_at)??""}}async function $e(e,t,s){s=await c(e,s);const{sql:r}=l(),n=await r`
    SELECT * FROM harness_shared.harness_docs
     WHERE workspace_id = ${s} AND harness_slug = ${e} AND doc_id = ${t}
     LIMIT 1`;return n[0]?S(n[0]):null}async function Je(e,t,s){s=await c(e,s);const{sql:r}=l(),n=await r`
    SELECT content FROM harness_shared.harness_docs
     WHERE workspace_id = ${s} AND harness_slug = ${e} AND doc_id = ${t}
     LIMIT 1`;return typeof n[0]?.content=="string"&&n[0].content.length>0?n[0].content:null}async function Ve(e,t){t=await c(e,t);const{sql:s}=l(),r=await s`
    SELECT * FROM harness_shared.harness_docs
     WHERE workspace_id = ${t} AND harness_slug = ${e}`,n=new Map;for(const a of r)n.set(a.doc_id,S(a));return n}async function ve(e){const t=await c(e.harnessSlug,e.workspaceId),s=e.source==="manual"?"manual":"generated",r=e.overlay??null,n=e.content??null,a=n===null?null:F(n),o=n===null?null:we(n),i=o===null?null:JSON.stringify(o),{sql:f}=l();return S((await f`
    INSERT INTO harness_shared.harness_docs
      (workspace_id, harness_slug, doc_id, source, subject_ref, anchor_paths,
       generated_from_sha, last_verified_sha, last_verified_at, overlay,
       status, status_detail, status_checked_at, title,
       content, content_hash, frontmatter)
    VALUES (
      ${t}, ${e.harnessSlug}, ${e.docId},
      ${r!==null?"augmented":s},
      ${JSON.stringify(e.subjectRef??[])}::text::jsonb,
      ${e.anchorPaths??[]}::text[],
      ${e.generatedFromSha??null}, ${e.lastVerifiedSha??null}, ${e.lastVerifiedAt??null},
      ${r},
      ${e.status??"untracked"}, ${e.statusDetail??null}, now(), ${e.title??null},
      COALESCE(${n}::text, ''), COALESCE(${a}::text, ''), ${i}::jsonb
    )
    ON CONFLICT (workspace_id, harness_slug, doc_id) DO UPDATE SET
      source = CASE WHEN harness_shared.harness_docs.overlay IS NOT NULL THEN 'augmented' ELSE ${s} END,
      subject_ref = EXCLUDED.subject_ref,
      anchor_paths = EXCLUDED.anchor_paths,
      generated_from_sha = EXCLUDED.generated_from_sha,
      last_verified_sha = COALESCE(EXCLUDED.last_verified_sha, harness_shared.harness_docs.last_verified_sha),
      last_verified_at = COALESCE(EXCLUDED.last_verified_at, harness_shared.harness_docs.last_verified_at),
      status = EXCLUDED.status,
      status_detail = EXCLUDED.status_detail,
      status_checked_at = now(),
      title = COALESCE(EXCLUDED.title, harness_shared.harness_docs.title),
      -- Prose, and the two values derived from it. Two guards, both deliberate:
      --
      --   1. COALESCE on the PARAMETER, not on EXCLUDED. EXCLUDED.content is the
      --      already-defaulted empty string from the INSERT list above, so keying off it
      --      would blank the prose on every metadata-only upsert -- the catastrophic
      --      reading of "absent".
      --   2. A composed row is NEVER touched. For those docs harness_doc_parts is
      --      canonical and the content column is scripts/project-doc-parts.mjs's cached
      --      output (D-010); letting a metadata upsert write prose there would corrupt
      --      the cache that projector's overwrite guard trusts to recognise its own
      --      output. This writer only ever authors the authored side of that split.
      content = CASE WHEN harness_shared.harness_docs.content_mode = 'composed'
                     THEN harness_shared.harness_docs.content
                     ELSE COALESCE(${n}::text, harness_shared.harness_docs.content) END,
      content_hash = CASE WHEN harness_shared.harness_docs.content_mode = 'composed'
                     THEN harness_shared.harness_docs.content_hash
                     ELSE COALESCE(${a}::text, harness_shared.harness_docs.content_hash) END,
      frontmatter = CASE WHEN harness_shared.harness_docs.content_mode = 'composed'
                     THEN harness_shared.harness_docs.frontmatter
                     ELSE COALESCE(${i}::jsonb, harness_shared.harness_docs.frontmatter) END
    RETURNING *`)[0])}async function Be(e,t,s,r=null,n){n=await c(e,n);const{sql:a}=l();await a`
    UPDATE harness_shared.harness_docs
       SET status = ${s}, status_detail = ${r}, status_checked_at = now(),
           regen_enqueued_at = CASE WHEN ${s} = 'fresh' THEN NULL ELSE regen_enqueued_at END,
           reverify_flagged_at = CASE WHEN ${s} = 'fresh' THEN NULL ELSE reverify_flagged_at END,
           regen_attempts = CASE WHEN ${s} = 'fresh' THEN 0 ELSE regen_attempts END,
           reverify_attempts = CASE WHEN ${s} = 'fresh' THEN 0 ELSE reverify_attempts END
     WHERE workspace_id = ${n} AND harness_slug = ${e} AND doc_id = ${t}`}async function Ae(e,t,s,r){r=await c(e,r);const{sql:n}=l();await n`
    UPDATE harness_shared.harness_docs
       SET last_verified_sha = ${s}, last_verified_at = now(),
           status = 'fresh', status_detail = NULL, status_checked_at = now(),
           reverify_flagged_at = NULL, reverify_attempts = 0
     WHERE workspace_id = ${r} AND harness_slug = ${e} AND doc_id = ${t}`}async function Ge(e,t,s,r){r=await c(e,r);const{sql:n}=l();await n`
    UPDATE harness_shared.harness_docs
       SET overlay = ${s},
           source = CASE
             WHEN ${s}::text IS NOT NULL THEN 'augmented'
             WHEN generated_from_sha IS NOT NULL THEN 'generated'
             ELSE 'manual' END
     WHERE workspace_id = ${r} AND harness_slug = ${e} AND doc_id = ${t}`}async function ze(e,t,s){s=await c(e,s);const{sql:r}=l();await r`
    UPDATE harness_shared.harness_docs
       SET regen_enqueued_at = now(), regen_attempts = regen_attempts + 1
     WHERE workspace_id = ${s} AND harness_slug = ${e} AND doc_id = ${t}`}async function Ke(e,t,s){s=await c(e,s);const{sql:r}=l();await r`
    UPDATE harness_shared.harness_docs
       SET reverify_flagged_at = now(), reverify_attempts = reverify_attempts + 1
     WHERE workspace_id = ${s} AND harness_slug = ${e} AND doc_id = ${t}`}async function Ye(e,t,s){s=await c(e,s);const{sql:r}=l();await r`
    UPDATE harness_shared.harness_docs
       SET regen_enqueued_at = now()
     WHERE workspace_id = ${s} AND harness_slug = ${e} AND doc_id = ${t}`}async function Qe(e,t,s){s=await c(e,s);const{sql:r}=l();await r`
    UPDATE harness_shared.harness_docs
       SET reverify_flagged_at = now()
     WHERE workspace_id = ${s} AND harness_slug = ${e} AND doc_id = ${t}`}async function Ze(e,t,s){s=await c(e,s);const{sql:r}=l();await r`
    DELETE FROM harness_shared.harness_docs
     WHERE workspace_id = ${s} AND harness_slug = ${e} AND doc_id = ${t}`}var _,Ne=u((()=>{L(),x(),De(),_=e=>e==null?null:e instanceof Date?e.toISOString():String(e)}));function Se(e){const t=new Set,s=e.match(/`([^`]+)`/g)??[],r=e.match(/```[^\n]*\b(?:title|file)=["']?([^\s"'`]+)/gi)??[],n=[...s.map(a=>a.replace(/`/g,"").trim()),...r.map(a=>/["']?([^\s"'`]+)$/.exec(a)?.[1]??"")];for(const a of n)/^[\w./-]+\/[\w./-]+\.(ts|tsx|js|jsx|rs|py|go|sql|mjs|cjs|json|md|mdx|css|sh)$/i.test(a)&&t.add(a);return t.size?[{kind:"path",globs:[...t]}]:[]}async function et(e){const t=e.docId.trim().replace(/^\.?\//,"");if(!t)return{ok:!1,error:"doc_id_required"};const s=await P(e.harnessSlug);if(!s)return{ok:!1,error:"unknown_harness"};const{repoRoot:r,docsRoot:n}=s,a=await c(e.harnessSlug,e.workspaceId);let o=e.documents;if(o==null){const v=e.content??await le(n,t);if(v&&(o=_e(v),o==null)){const R=Se(v);if(R.length){const X=(0,D.relative)(r,(0,D.join)(n,t)).split(D.sep).join("/"),b=R.flatMap(w=>w.kind==="path"?w.globs:[]).filter(w=>w!==X&&(0,q.existsSync)((0,D.join)(r,w)));b.length&&(o=b)}}}const i=U(o),f=await Ee(i,{runGit:Y,repoRoot:r,resolveFeatureCommits:de(e.harnessSlug,a)}),g=i.length>0;let y=null;e.verify&&g&&(y=await k(r));const M=g?y?"fresh":"review":"untracked";return{ok:!0,record:await ve({harnessSlug:e.harnessSlug,docId:t,workspaceId:a,source:"manual",subjectRef:i,anchorPaths:f,lastVerifiedSha:y,...y?{lastVerifiedAt:new Date().toISOString()}:{},status:M,statusDetail:g?y?null:"anchored — verify to set a baseline":"not drift-tracked (no subject_ref)",...e.title?{title:e.title}:{},...e.content!==void 0?{content:e.content}:{}}),subjectRef:i,anchored:g}}async function tt(e,t,s){const r=t.trim().replace(/^\.?\//,""),n=await P(e);if(!n)return{ok:!1,error:"unknown_harness"};s=await c(e,s);const a=await $e(e,r,s);if(!a)return{ok:!1,error:"unknown_doc"};if(!a.subjectRef||a.subjectRef.length===0)return{ok:!1,error:"unanchored — declare documents: before verifying"};const o=await k(n.repoRoot);return o?(await Ae(e,r,o,s),{ok:!0,verifiedSha:o}):{ok:!1,error:"no_head_sha"}}var q,D,st=u((()=>{q=E(p(),1),D=E(p(),1),Q(),ie(),fe(),ue(),pe(),Ne(),x()}));export{qe as A,Ee as C,de as D,ue as E,oe as F,ce as M,ie as N,Me as O,P,A as S,Xe as T,Ie as _,Ze as a,pe as b,Ne as c,Ke as d,Ge as f,ve as g,Qe as h,tt as i,le as j,fe as k,Ve as l,Ye as m,Se as n,Je as o,Be as p,st as r,$e as s,et as t,ze as u,De as v,me as w,U as x,_e as y};
