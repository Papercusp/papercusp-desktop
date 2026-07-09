import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";import{q as r,t as i}from"./src-DTtGQmae.js";import{n as a,s as o}from"./workspace-registry-C3lTKlnO.js";import{n as s,t as c}from"./papercusp-root-BnAoNWG3.js";import{a as l,o as u}from"./operator-home-harness-CuO9bc6b.js";import{n as d,r as f,t as p}from"./rubric-template-C1aCC6y5.js";import{n as m,t as h}from"./with-plan-lock-A6tyONSM.js";function g(e,t){let n={}[e];return n&&n.length>0?n:t}function _(e){return(0,x.existsSync)((0,S.join)(e,`package.json`))&&(0,x.existsSync)((0,S.join)(e,`packages`))}function v(e){let t=e;for(let e=0;e<24;e+=1){if(_(t))return t;let e=(0,S.dirname)(t);if(e===t)break;t=e}return null}function ee(e,t){return(0,S.join)(v((0,S.dirname)((0,C.fileURLToPath)(t)))??v(process.cwd())??process.cwd(),e)}function y(e){return[{dir:g(e.envVar,e.devFallbackDir),layer:`bundled`},{dir:s(e.userSubdir),layer:`user`}]}function b(e,t){let n=new Map;for(let r of e){if(!(0,x.existsSync)(r.dir))continue;let e;try{e=(0,x.readdirSync)(r.dir)}catch{continue}for(let i of e){let e=(0,S.join)(r.dir,i),a=!1;try{a=(0,x.statSync)(e).isDirectory()}catch{a=!1}if(!a)continue;let o=t(e,i,r.layer);o&&n.set(i,o)}}return[...n.entries()].sort(([e],[t])=>e.localeCompare(t)).map(([,e])=>e)}var x,S,C,w=e((()=>{x=t(n(),1),S=t(n(),1),C=t(n(),1),c()}));function T(){return y({envVar:`PAPERCUSP_RUBRICS_DIR`,devFallbackDir:A,userSubdir:`rubrics`})}function E(e){if(!Array.isArray(e)||e.length===0)return null;let t=[];for(let n of e){if(typeof n!=`object`||!n)return null;let e=n,r=j(e.key),i=j(e.title),a=j(e.model),o=j(e.method),s=j(e.driftMarkers);if(!r||!i||!a||!o||!s)return null;let c=Array.isArray(e.ratingScale)&&e.ratingScale.every(e=>typeof e==`string`)?e.ratingScale:void 0;t.push({key:r,title:i,model:a,method:o,driftMarkers:s,...c?{ratingScale:c}:{}})}return t}function D(e){try{if(!(0,O.existsSync)(e))return null;let t=JSON.parse((0,O.readFileSync)(e,`utf8`));return typeof t==`object`&&t?t:null}catch{return null}}function te(e,t,n){let r=D((0,k.join)(e,`rubric.json`));if(!r)return null;let i=D((0,k.join)(e,`listing.json`))??{},a=j(r.rubricId)??j(i.id)??t,o=j(r.title)??j(i.title),s=j(r.characteristic)??j(i.category),c=E(r.criteria),l=Array.isArray(r.ratingScale)&&r.ratingScale.every(e=>typeof e==`string`)?r.ratingScale:null;return!o||!s||!c||!l||l.length===0?null:{ref:t,rubricId:a,title:o,characteristic:s,description:j(r.description)??j(i.description)??``,ratingScale:l,methodRef:j(r.methodRef)??null,criteria:c,version:j(r.version)??j(i.version)??`0.1.0`,source:j(r.source)??j(i.source)??(n===`user`?`installed`:`first-party`),dir:e,layer:n}}function ne(e=T()){return b(e,te)}function re(e,t){return e.filter(e=>!t.has(e.rubricId))}var O,k,A,j,M=e((()=>{O=t(n(),1),k=t(n(),1),c(),w(),A=ee(`rubrics`,import.meta.url),j=e=>typeof e==`string`&&e!==``?e:void 0}));function N(){return a()}function P(){return u()}function F(e){return typeof e==`string`?e:e.toISOString()}function I(e,t=!1){if(t)return`retired`;switch(e){case`active`:case`ready`:return`active`;case`superseded`:case`shipped`:return`retired`;default:return`proposed`}}function L(e){switch(e){case`active`:return`active`;case`retired`:return`superseded`;default:return`draft`}}function R(e){let t=f.safeParse(e.template_data);if(!t.success)return null;let n=t.data,r=F(e.updated_at),i=I(e.status,e.archived);return{rubricId:e.plan_slug,workspaceId:e.workspace_id,characteristic:n.characteristic,title:e.title??e.plan_slug,description:n.description??``,criteria:n.criteria.map(e=>({key:e.key,title:e.title,model:e.model,method:e.method,driftMarkers:e.driftMarkers,...e.ratingScale?{ratingScale:e.ratingScale}:{}})),ratingScale:n.ratingScale,methodRef:n.methodRef??null,status:i,createdBy:e.owner??null,proposedBy:e.owner??null,ratifiedBy:i===`active`?e.owner??null:null,createdAt:e.created??r,updatedAt:r}}function z(e){return e.sort((e,t)=>Z[e.status]-Z[t.status]||t.updatedAt.localeCompare(e.updatedAt))}async function B(){return{}.VITEST||await U(),V()}async function V(){try{let{sql:e}=r();return(await e`
      SELECT plan_slug, workspace_id, harness_slug, title, status, created, updated, updated_at,
             owner, archived, template_data
        FROM harness_shared.harness_plans
       WHERE workspace_id = ${N()}
         AND template = ${p}
         AND template_slug IS NULL
       LIMIT 500`).map(R).filter(e=>e!==null)}catch{return[]}}async function H(){let{sql:e}=r(),t=await e`
    SELECT plan_slug
      FROM harness_shared.harness_plans
     WHERE workspace_id = ${N()}
       AND template = ${p}`;return new Set(t.map(e=>e.plan_slug))}async function U(){if($!==`pending`)return;$=`running`;let e=!0;try{let t=ne();if(t.length>0){let n=re(t,await H());for(let t of n)try{await Y({rubricId:t.rubricId,characteristic:t.characteristic,title:t.title,...t.description?{description:t.description}:{},criteria:t.criteria,ratingScale:t.ratingScale,...t.methodRef?{methodRef:t.methodRef}:{},by:Q,status:`active`})}catch(n){e=!1,console.warn(`[rubrics] first-party seed failed for '${t.rubricId}' (will retry on a later read):`,n instanceof Error?n.message:n)}}}catch(t){e=!1,console.warn(`[rubrics] first-party seed deferred (store/bundle unavailable; will retry on a later read):`,t instanceof Error?t.message:t)}$=e?`done`:`pending`}async function W(e={}){let t=await B();return e.status&&(t=t.filter(t=>t.status===e.status)),e.characteristic&&(t=t.filter(t=>t.characteristic===e.characteristic)),z(t).slice(0,Math.min(e.limit??100,500))}async function G(e){return(await B()).find(t=>t.rubricId===e)??null}function K(e){let t={characteristic:e.characteristic,criteria:e.criteria,ratingScale:e.ratingScale??[...X],...e.methodRef?{methodRef:e.methodRef}:{},...e.description===void 0?{}:{description:e.description}},n=f.safeParse(t);if(!n.success){let t=n.error.issues.map(e=>`${e.path.join(`.`)||`(root)`}: ${e.message}`).join(`; `);throw Error(`proposeRubric: invalid rubric data for '${e.rubricId}': ${t}`)}return n.data}function q(e){let{slug:t,title:n,planStatus:r,owner:i,date:a,description:o}=e,s=i?`\nowner: ${i}`:``,c=o?.trim()?o.trim():`A shared standard for a system characteristic — its criteria grade structured observations.`;return`---
title: ${n}
slug: ${t}
status: ${r}
template: ${p}
created: ${a}
updated: ${a}${s}
---

# ${n}

## Now

**State:** Rubric-template plan (template:rubric). Its structured fields (characteristic,
criteria, ratingScale, methodRef) live in \`template_data\`, queried via
rubrics:list/get/search; this body is the narrative model/method context. Status
\`${r}\` ⇒ a ${I(r)} rubric.

**Next:** The Queen ratifies a proposed rubric by promoting this plan to \`active\`
(rubrics:ratify / plans:set-plan-status). Revise the criteria via plans:set-template-data.

## Background

${c}

## Criteria — the structured \`template_data\`

The per-criterion model / method / drift markers live in \`template_data\` (read via
rubrics:get or plans:get-template-data). Agents read/write the rubric structured, never
by parsing this markdown.

## Decisions

(Use plans:add-decision to append.)
`}async function J(e){let t=N();try{let{sql:n}=r(),i=await n`
      SELECT harness_slug
        FROM harness_shared.harness_plans
       WHERE workspace_id = ${t}
         AND plan_slug = ${e}
         AND template = ${p}
       LIMIT 1`;if(i[0]?.harness_slug)return{workspaceId:t,harnessSlug:i[0].harness_slug}}catch{}return{workspaceId:t,harnessSlug:P()}}async function Y(e){let t=L(e.status??`proposed`),n=K(e),r=await J(e.rubricId),i=new Date().toISOString().slice(0,10),a=q({slug:e.rubricId,title:e.title,planStatus:t,owner:e.by??null,date:i,...e.description===void 0?{}:{description:e.description}});if((await m(null,{slug:e.rubricId,intent:`rubrics:propose ${e.rubricId}`,...r},async()=>({newBody:a,value:!0}))).kind===`busy`)throw Error(`proposeRubric: plan '${e.rubricId}' is being written by another caller`);if((await m(null,{slug:e.rubricId,intent:`rubrics:propose:data ${e.rubricId}`,...r},async e=>e===null?{newBody:null,value:!1}:{newBody:null,templateData:{data:n},value:!0})).kind===`busy`)throw Error(`proposeRubric: template_data write for '${e.rubricId}' is busy`);let o=await G(e.rubricId);if(!o)throw Error(`proposeRubric: rubric '${e.rubricId}' did not resolve after write`);return o}var X,Z,Q,$,ie=e((()=>{i(),o(),d(),h(),l(),M(),X=[`healthy`,`degraded`,`broken`,`unknown`],Z={active:0,proposed:1,retired:2},Q=`first-party-bundle`,$=`pending`}));export{ie as n,W as r,G as t};