import{n as p}from"./chunk-ChpBd9eV.js";import{n as f,r as g}from"./rubric-template-DTNahpRp.js";import{a as b,i as _,n as v,s as y}from"./scout-plan-draft-CVxsPO5M.js";function s(e){return(e??"").replace(/\s+/g," ").trim()}function u(e,t){const r=s(e);return r.length>t?`${r.slice(0,t-1)}…`:r}function w(e){const t=s(e).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,50).replace(/-+$/,"");return t.length>0?`scout-rubric-${t}`:"scout-rubric-gap"}function k(e){return`Rubric proposal: ${u(e.summary,80)}`}function $(e){const{slug:t,title:r,date:o,gap:n}=e,i=s(n.detail??"")||"a recurring cross-author friction cluster",a=s(n.ref??"");return`---
title: ${r}
slug: ${t}
status: draft
origin: scout
template: ${f}
created: ${o}
updated: ${o}
---

# ${r}

## Now

**State:** Draft rubric proposal — the Blender loop's auto-crystallization rail detected a RUBRIC GAP: a recurring friction the Pot keeps hitting with NO covering active rubric (plan-templates-and-rubric-v2 P-009 / D-003). Awaiting independent review and ratification; NOT a live standard until promoted (active + templateData).

**Next:** ${b}

## Background — the gap evidence (the rubric's model/method/drift seed)

**Theme:** ${u(n.summary,200)}

**Signal:** ${i}${a?` (drill-back: ${a})`:""}

The Pot repeatedly hit this cluster (≥3 distinct authors across ≥2 cycles) yet has no
shared standard to grade it by — that absence is the gap. The clustered observations
above are the raw material for the rubric's per-criterion model (how it should work),
method (how to investigate it), and drift markers (what degraded/broken looks like).

## Proposed rubric — reviewer/Blender fills the structured \`templateData\` on ratification

Define the rubric with \`plans:set-template-data\` (validated against the \`rubric\`
template schema), then an independent reviewer promotes this draft to \`active\` via
\`rubrics:ratify\` (the proposer must not self-ratify):

- **characteristic:** the umbrella domain this rubric measures (Blender's digest groups by this).
- **criteria:** one or more \`{ key, title, model, method, driftMarkers }\` — what a structured observation grades.
- **ratingScale:** the default rating vocabulary, e.g. \`["healthy","degraded","broken","unknown"]\`.

## Decisions

(Use plans:add-decision to append.)
`}async function A(e,t={},r={}){const o=r.createDraft??v,n=t.maxPerCycle??5,i={authored:[],existing:[],failed:[]};for(const a of e.slice(0,Math.max(0,n)))try{const c=k(a),{slug:d,created:l}=await o({slug:w(a.summary),title:c,...t.harnessSlug?{harnessSlug:t.harnessSlug}:{},...t.workspaceId?{workspaceId:t.workspaceId}:{},...t.date?{date:t.date}:{},buildBody:({slug:h,date:m})=>$({slug:h,title:c,date:m,gap:a})});(l?i.authored:i.existing).push(d)}catch(c){i.failed.push({ref:s(a.ref??"")||s(a.summary),error:D(c)})}return i}function D(e){return e instanceof Error?e.message:String(e)}var R,S=p((()=>{_(),y(),g(),R=5}));S();export{A as authorRubricGapPlans};
