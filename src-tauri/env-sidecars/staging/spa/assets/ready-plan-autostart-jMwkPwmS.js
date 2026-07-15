import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-C4H77EbW.js";import{i as r,o as i}from"./started-DGJ4xoBr.js";import{f as a,i as o,p as s}from"./watchdog-CziXkPhv.js";import{_ as c,b as l,u}from"./placement-watchdog-CdONBQ_h.js";import{n as d,t as f}from"./plan-workitem-promotion-run-0tI4UnIi.js";function p(){return{}.PAPERCUSP_SCOUT_READY_AUTOSTART!==`0`}function m(e){let t=[],n=[];for(let r of e)(r.hasOpenItems?t:n).push(r);return{startable:t,itemless:n}}async function h(e,t,n,r={}){return(await e`
    SELECT plan_slug, title,
           (content ~ ('- [*][*]P-[0-9]+[*][*] ' || chr(96) || '(todo|wip)' || chr(96))) AS has_open_items
      FROM harness_shared.harness_plans
     WHERE workspace_id = ${t}
       AND harness_slug = ${n}
       AND status = 'ready'
       AND archived = false
       AND (op_status IS NULL OR op_status <> 'started')
       AND content LIKE ${`%
origin: scout
%`}
     ORDER BY updated_at ASC
     LIMIT ${r.limit??20}`).map(e=>({planSlug:e.plan_slug,title:e.title,hasOpenItems:!!e.has_open_items}))}async function g(e,t){let n=new Date().toISOString(),r=await e`
    UPDATE harness_shared.harness_plans AS p
       SET op_status     = 'started',
           op_started_at = COALESCE(p.op_started_at, ${n}),
           op_updated_at = ${n}
      FROM (
        SELECT plan_slug, op_status AS prev_op_status
          FROM harness_shared.harness_plans
         WHERE workspace_id = ${t.workspaceId}
           AND harness_slug = ${t.installSlug}
           AND plan_slug    = ${t.planSlug}
           FOR UPDATE
      ) prev
     WHERE p.workspace_id = ${t.workspaceId}
       AND p.harness_slug = ${t.installSlug}
       AND p.plan_slug    = prev.plan_slug
    RETURNING prev.prev_op_status`;if(!(r.length>0&&r[0].prev_op_status!==`started`))return{transitioned:!1,promoted:0,flagOff:!1};let i=await d({workspaceId:t.workspaceId,harnessSlug:t.installSlug,planSlug:t.planSlug,createdBy:`scout-ready-autostart`});return{transitioned:!0,promoted:i.promoted,flagOff:i.flagOff===!0}}async function _(e,t,n,r=null){let i=n.slice(0,5).map(e=>`• ${e.planSlug}${e.title?` — ${e.title}`:``}`).join(`
`);await l({workspaceId:e,mugOwner:t,summary:`Scout ready-plan autostart: ${n.length} RATIFIED scout plan(s) have NO open items, so they cannot start (nothing to promote to work_items). Decompose each into 1–5 concrete items (plans:add-item) — the autostart sweep then starts it and promotes the items into your surveyable frontier automatically. Do not leave a ratified plan itemless (that is the plan-rail dead end, WI-1574).\n\n${i}`,payload:{kind:`scout-ready-decompose`,slugs:n.map(e=>e.planSlug)},source:`scout-ready-decompose`,body:`${i}`,harnessSlug:r})}async function v(){let e=[];if(!p())return e;try{let n=await i();if(n.length===0)return e;let{sql:r}=t();for(let{workspaceId:t,installSlug:i}of n)try{let n=await h(r,t,i);if(n.length===0)continue;let{startable:o,itemless:l}=m(n);for(let n of o)try{let a=await g(r,{workspaceId:t,installSlug:i,planSlug:n.planSlug});e.push({workspaceId:t,installSlug:i,outcome:a.transitioned?`started`:`skipped`,planSlug:n.planSlug,promoted:a.promoted,reason:a.transitioned?a.flagOff?`auto-started BUT promotion no-oped: PLAN_WORKITEM_PROMOTION flag is OFF — items will NOT reach the Queen until it is flipped`:`auto-started ratified scout plan; promoted ${a.promoted} item(s)`:`already started (race)`})}catch(r){e.push({workspaceId:t,installSlug:i,outcome:`error`,planSlug:n.planSlug,reason:r instanceof Error?r.message:String(r)})}l.length>0&&(await a(t,i,1,`scout-ready-decompose`)>0||(await _(t,await c(r,t,i),l,i),await s({workspaceId:t,installSlug:i,source:`scout-ready-decompose`,reason:`${l.length} ratified itemless scout plan(s): ${l.slice(0,5).map(e=>e.planSlug).join(`, `)}`,wakeAt:null}),e.push({workspaceId:t,installSlug:i,outcome:`decompose-nudged`,reason:`${l.length} itemless ready plan(s)`})))}catch(n){e.push({workspaceId:t,installSlug:i,outcome:`error`,reason:n instanceof Error?n.message:String(n)})}}catch(e){console.warn(`[scout-ready-autostart] sweep failed: ${e instanceof Error?e.message:e}`)}return e}e((()=>{n(),r(),u(),o(),f()}))();export{v as scoutReadyAutostartSweep};