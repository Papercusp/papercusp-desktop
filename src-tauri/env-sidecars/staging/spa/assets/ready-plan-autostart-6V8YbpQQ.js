import{n as f}from"./chunk-ChpBd9eV.js";import{st as g,t as S}from"./src-BmBNODK0.js";import{i as w,t as y}from"./pot-membership-_CBaMRYQ.js";import{a as E,i as A,o as R,u as _}from"./started-BElZSRWs.js";import{h as O,n as m,o as $}from"./watchdog-Hc_gipv9.js";import{C as I,d as N}from"./placement-watchdog-MA--n6Xb.js";import{n as k,t as D}from"./nudge-recipient-DzSTIYVp.js";import{n as v,r as T}from"./plan-workitem-promotion-run-DXLr7sa4.js";function b(){return{}.PAPERCUSP_SCOUT_READY_AUTOSTART!=="0"}function F(o){const t=[],a=[];for(const n of o)(n.hasOpenItems?t:a).push(n);return{startable:t,itemless:a}}async function W(o,t,a,n={}){return(await o`
    SELECT plan_slug, title,
           (content ~ ('- [*][*]P-[0-9]+[*][*] ' || chr(96) || '(todo|wip)' || chr(96))) AS has_open_items
      FROM harness_shared.harness_plans
     WHERE workspace_id = ${t}
       AND harness_slug = ${a}
       AND status = 'ready'
       AND archived = false
       AND (op_status IS NULL OR op_status <> 'started')
       AND content LIKE ${`%
origin: scout
%`}
     ORDER BY updated_at ASC
     LIMIT ${n.limit??20}`).map(r=>({planSlug:r.plan_slug,title:r.title,hasOpenItems:!!r.has_open_items}))}async function L(o,t,a={}){const n=a.mugKettleSystemEnabledFn?await a.mugKettleSystemEnabledFn():await _(),r=new Date().toISOString(),e=n?await o`
        UPDATE harness_shared.harness_plans AS p
           SET op_status     = 'started',
               op_started_at = COALESCE(p.op_started_at, ${r}),
               op_updated_at = ${r}
          FROM (
            SELECT plan_slug, op_status AS prev_op_status
              FROM harness_shared.harness_plans
             WHERE workspace_id = ${t.workspaceId}
               AND harness_slug = ${t.planStorageSlug}
               AND plan_slug    = ${t.planSlug}
               FOR UPDATE
          ) prev
         WHERE p.workspace_id = ${t.workspaceId}
           AND p.harness_slug = ${t.planStorageSlug}
           AND p.plan_slug    = prev.plan_slug
        RETURNING prev.prev_op_status`:await o`
        SELECT op_status AS prev_op_status
          FROM harness_shared.harness_plans
         WHERE workspace_id = ${t.workspaceId}
           AND harness_slug = ${t.planStorageSlug}
           AND plan_slug    = ${t.planSlug}`;if(e.length===0)return{outcome:"plan-not-found",promoted:0,flagOff:!1,axisWritten:!1};if(e[0].prev_op_status==="started")return{outcome:"already-started",promoted:0,flagOff:!1,axisWritten:!1};const s=await T({workspaceId:t.workspaceId,harnessSlug:t.planStorageSlug,planSlug:t.planSlug,createdBy:"scout-ready-autostart"});return{outcome:n?"started":"promoted",promoted:s.promoted,flagOff:s.flagOff===!0,axisWritten:n}}async function x(o,t,a,n=null){const r=a.slice(0,5).map(e=>`• ${e.planSlug}${e.title?` — ${e.title}`:""}`).join(`
`);await D({workspaceId:o,mugOwner:t,summary:`Scout ready-plan autostart: ${a.length} RATIFIED scout plan(s) have NO open items, so they cannot start (nothing to promote to work_items). Decompose each into 1–5 concrete items (plans:add-item) — the autostart sweep then starts it and promotes the items into your surveyable frontier automatically. Do not leave a ratified plan itemless (that is the plan-rail dead end, WI-1574).

${r}`,payload:{kind:"scout-ready-decompose",slugs:a.map(e=>e.planSlug)},source:"scout-ready-decompose",body:`${r}`,harnessSlug:n})}async function C(o){const{sql:t}=g(),a=await t`
    SELECT count(*)::text AS n
      FROM harness_shared.harness_plans
     WHERE workspace_id = ${o}
       AND status = 'ready'
       AND archived = false
       AND (op_status IS NULL OR op_status <> 'started')
       AND content LIKE ${`%
origin: scout
%`}`;return Number(a[0]?.n??0)}async function z(o={}){const t=[];if(!b())return t;try{const a=await E();if(a.length===0){let e=0;try{const s=(o.listBlenderMaintenanceWorkspaceIds??R)(),l=o.countEligibleReadyPlans??C;for(const c of s)e+=await l(c)}catch{return t}if(e>0){const s=`${e} ready scout plan(s) are eligible for autostart, but no registered Blender scopes were evaluated`;console.warn(`[scout-ready-autostart] ALERT: ${s}`),t.push({workspaceId:"*",installSlug:"*",outcome:"error",reason:s})}return t}const n=await _(),{sql:r}=g();for(const{workspaceId:e,installSlug:s}of a)try{const l=await w(s,e),c=await W(r,e,l);if(c.length===0)continue;const{startable:h,itemless:p}=F(c);for(const u of h)try{if(!n&&!await m({workspaceId:e,installSlug:s,source:"scout-ready-autostart",scopeKey:u.planSlug,windowHours:1,reason:`ready scout plan ${u.planSlug} promoted with the op_status axis retired`,wakeAt:null})){t.push({workspaceId:e,installSlug:s,outcome:"latched",planSlug:u.planSlug,reason:"retired-axis debounce still inside its quiet window"});continue}const i=await L(r,{workspaceId:e,planStorageSlug:l,planSlug:u.planSlug},{mugKettleSystemEnabledFn:async()=>n}),d=i.outcome==="started"||i.outcome==="promoted";t.push({workspaceId:e,installSlug:s,outcome:d?i.axisWritten?"started":"promoted":"skipped",planSlug:u.planSlug,promoted:i.promoted,reason:d?i.flagOff?"promotion no-oped: PLAN_WORKITEM_PROMOTION flag is OFF — items will NOT reach the queue until it is flipped":i.axisWritten?`auto-started ratified scout plan; promoted ${i.promoted} item(s)`:`promoted ${i.promoted} item(s) from a ratified scout plan; op_status NOT written — the operational axis is RETIRED (papercusp-mug-kettle-system is OFF, the delivered state), so su agents self-select these items via scheduler:get_next`:i.outcome==="plan-not-found"?"plan row vanished between the candidate read and the start":"already started (race)"})}catch(i){t.push({workspaceId:e,installSlug:s,outcome:"error",planSlug:u.planSlug,reason:i instanceof Error?i.message:String(i)})}p.length>0&&(await O(e,s,1,"scout-ready-decompose")>0||await m({workspaceId:e,installSlug:s,source:"scout-ready-decompose",windowHours:1,reason:`${p.length} ratified itemless scout plan(s): ${p.slice(0,5).map(u=>u.planSlug).join(", ")}`,wakeAt:null})&&(await x(e,await I(r,e,s),p,s),t.push({workspaceId:e,installSlug:s,outcome:"decompose-nudged",reason:`${p.length} itemless ready plan(s)`})))}catch(l){t.push({workspaceId:e,installSlug:s,outcome:"error",reason:l instanceof Error?l.message:String(l)})}}catch(a){console.warn(`[scout-ready-autostart] sweep failed: ${a instanceof Error?a.message:a}`)}return t}var M=f((()=>{S(),A(),N(),k(),$(),v(),y()}));M();export{z as scoutReadyAutostartSweep};
