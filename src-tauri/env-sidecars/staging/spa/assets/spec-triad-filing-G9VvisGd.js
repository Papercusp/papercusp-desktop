import{n as i}from"./chunk-ChpBd9eV.js";import{st as r,t as o}from"./src-8fWtxfEz.js";import{G as l,O as d}from"./work-items-CNsmfKgm.js";function c(e){return`${e.workspaceId}/${e.harnessSlug}/${e.planSlug}`}function p(e,t){return`Plan \`${e}\` is in scope for the SPEC TRIAD (okf-frontmatter-adoption H(b)) and is missing: ${t}

Its items are held back from \`plans:items { actionable: true }\` and from plan→work-item promotion until the sections are written — so this is not paperwork, it is what unblocks that plan's lane.

**To resolve** (\`plans:set-content\` / \`plans:edit\`):
- \`## Requirements\` — what must be TRUE when the change is done. Not a task list.
- \`## Design\` — how it will be built, and the trade-off you settled.
- \`P-NNN\` items — the tasks themselves (\`plans:add-item\`).

A heading with nothing under it does NOT satisfy the check, and neither does \`TBD\` — the detector requires real body content (\`evaluateSpecTriad\`, @papercusp/plan-parser).

**If the triad genuinely does not apply to this plan**, that is a legitimate answer, not a failure: add \`specTriad: exempt\` to its frontmatter and close this item with that as the completion evidence. The requirement is a floor for new work, never a wall.`}async function f(e){const t=c(e);try{const{sql:a}=r();if((await a`
      SELECT 1
        FROM harness_shared.work_items
       WHERE payload->>'specTriadPlan' = ${t}
         AND status = ANY(${s})
       LIMIT 1
    `).length>0)return{outcome:"already-open",id:null,ref:t};const n=await d({kind:"task",harness:e.harnessSlug,workspaceId:e.workspaceId,createdBy:"system:spec-triad",title:`Write the spec triad for plan '${e.planSlug}' — missing ${e.missing.join(" + ")}`,summary:p(e.planSlug,e.gap),payload:{specTriadPlan:t,planSlug:e.planSlug,missing:e.missing}});return{outcome:"created",id:n.feature_id??n.id??null,ref:t}}catch(a){return{outcome:"error",id:null,ref:t,error:a.message}}}var s,w=i((()=>{o(),l(),s=["open","todo","wip","in_progress","blocked","needs-human","validating","failing"]}));export{c as a,p as i,f as n,w as r,s as t};
