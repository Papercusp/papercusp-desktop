import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,t as n}from"./rubric-template-C1aCC6y5.js";import{a as r,i,n as a,s as o}from"./scout-plan-draft-D5OdSxSE.js";function s(e){return(e??``).replace(/\s+/g,` `).trim()}function c(e,t){let n=s(e);return n.length>t?`${n.slice(0,t-1)}…`:n}function l(e){let t=s(e).toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-+|-+$/g,``).slice(0,50).replace(/-+$/,``);return t.length>0?`scout-rubric-${t}`:`scout-rubric-gap`}function u(e){return`Rubric proposal: ${c(e.summary,80)}`}function d(e){let{slug:t,title:i,date:a,gap:o}=e,l=s(o.detail??``)||`a recurring cross-author friction cluster`,u=s(o.ref??``);return`---
title: ${i}
slug: ${t}
status: draft
origin: scout
template: ${n}
created: ${a}
updated: ${a}
---

# ${i}

## Now

**State:** Draft rubric proposal — the Blender loop's auto-crystallization rail detected a RUBRIC GAP: a recurring friction the Pot keeps hitting with NO covering active rubric (plan-templates-and-rubric-v2 P-009 / D-003). Awaiting Mug ratification; NOT a live standard until promoted (active + templateData).

**Next:** ${r}

## Background — the gap evidence (the rubric's model/method/drift seed)

**Theme:** ${c(o.summary,200)}

**Signal:** ${l}${u?` (drill-back: ${u})`:``}

The Pot repeatedly hit this cluster (≥3 distinct authors across ≥2 cycles) yet has no
shared standard to grade it by — that absence is the gap. The clustered observations
above are the raw material for the rubric's per-criterion model (how it should work),
method (how to investigate it), and drift markers (what degraded/broken looks like).

## Proposed rubric — Mug/Blender fills the structured \`templateData\` on ratification

Define the rubric with \`plans:set-template-data\` (validated against the \`rubric\`
template schema), then the Mug promotes this draft to \`active\`:

- **characteristic:** the umbrella domain this rubric measures (Blender's digest groups by this).
- **criteria:** one or more \`{ key, title, model, method, driftMarkers }\` — what a structured observation grades.
- **ratingScale:** the default rating vocabulary, e.g. \`["healthy","degraded","broken","unknown"]\`.

## Decisions

(Use plans:add-decision to append.)
`}async function f(e,t={},n={}){let r=n.createDraft??a,i=t.maxPerCycle??5,o={authored:[],existing:[],failed:[]};for(let n of e.slice(0,Math.max(0,i)))try{let e=u(n),{slug:i,created:a}=await r({slug:l(n.summary),title:e,...t.harnessSlug?{harnessSlug:t.harnessSlug}:{},...t.workspaceId?{workspaceId:t.workspaceId}:{},...t.date?{date:t.date}:{},buildBody:({slug:t,date:r})=>d({slug:t,title:e,date:r,gap:n})});(a?o.authored:o.existing).push(i)}catch(e){o.failed.push({ref:s(n.ref??``)||s(n.summary),error:p(e)})}return o}function p(e){return e instanceof Error?e.message:String(e)}e((()=>{i(),o(),t()}))();export{f as authorRubricGapPlans};