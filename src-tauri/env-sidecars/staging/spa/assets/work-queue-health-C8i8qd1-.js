import{n as e}from"./chunk-CMxvf4Kt.js";import{s as t}from"./workspace-registry-C3lTKlnO.js";import{r as n,t as r}from"./work-item-dispatch-states-DUjVV9AI.js";import{r as i,t as a}from"./stale-claims-B1mA8P3F.js";import{n as o,r as s,t as c}from"./work-items-stale-claims-Dzbus2Zl.js";async function l(e,t){let n=await e`
    SELECT extract(epoch from last_run_at) * 1000 AS last_run_ms, last_released
      FROM harness_shared.periodic_sweep_runs WHERE sweep_name = ${t}`;return n[0]?{lastRunMs:Number(n[0].last_run_ms),lastReleased:Number(n[0].last_released)}:null}async function u(e,t={}){let n=Math.max(1,Math.round((t.graceMs??c)/1e3)),i=Math.max(1,Math.round((t.assignmentGraceMs??a)/1e3)),o=t.stalenessMs??f,u=t.nowMs??Date.now(),p=t.workspaceId??null,m=[...r],[h]=await e`
    WITH live_holder AS (${s(e,n)}),
         live_holder_asg AS (${s(e,i)})
    SELECT
      (SELECT count(*) FROM harness_shared.harness_features_consolidated f
         WHERE (${p}::text IS NULL OR f.workspace_id = ${p})
           AND f.taken_by IS NULL
           AND f.status IS NOT NULL
           AND f.status <> ALL(${m}::text[]))::int AS stuck_features,
      (SELECT count(*) FROM harness_shared.harness_features_consolidated f
         WHERE (${p}::text IS NULL OR f.workspace_id = ${p})
           AND f.taken_by IS NOT NULL AND f.taken_by <> ''
           -- A NULL taken_at counts as past grace (the dead-holder signal alone
           -- governs), matching the reaper's DEAD leg + the fleet_assignment
           -- view's orphaned state so the alarm SEES the EI-2534 strand class.
           AND (f.taken_at IS NULL OR (now() - f.taken_at) > make_interval(secs => ${n}))
           AND NOT EXISTS (SELECT 1 FROM live_holder h WHERE h.alias = f.taken_by))::int AS dead_held_features,
      (SELECT count(*) FROM harness_shared.engineer_issues e
         WHERE (${p}::text IS NULL OR e.workspace_id = ${p})
           AND e.state = 'open' AND e.kind IN ('bug', 'change')
           AND e.assignee IS NOT NULL AND e.assignee <> ''
           AND e.assigned_at IS NOT NULL
           AND (now() - e.assigned_at) > make_interval(secs => ${n})
           AND NOT EXISTS (SELECT 1 FROM live_holder h WHERE h.alias = e.assignee))::int AS dead_assigned_issues,
      -- The assignment analog (EI-2535): active reservations past the ASSIGNMENT
      -- grace whose name-aware holder is dead (neither the name nor any adopting
      -- session is a live alias). Mirrors reclaimStaleDeadHolderPlanItemAssignments.
      (SELECT count(*) FROM harness_shared.plan_item_assignments asg
         WHERE (${p}::text IS NULL OR asg.workspace_id = ${p})
           AND asg.released_ts IS NULL
           AND asg.assignee_name IS NOT NULL AND asg.assignee_name <> ''
           AND asg.assigned_ts IS NOT NULL
           AND (now() - asg.assigned_ts) > make_interval(secs => ${i})
           AND NOT EXISTS (SELECT 1 FROM live_holder_asg h WHERE h.alias = asg.assignee_name)
           AND NOT EXISTS (
             SELECT 1 FROM harness_shared.agent_name_sessions s
               JOIN live_holder_asg h ON h.alias = s.session_owner_id
              WHERE s.workspace_id = asg.workspace_id AND s.agent_name = asg.assignee_name
           ))::int AS dead_held_assignments`,g=await l(e,d),_=g?.lastRunMs??null,v=_==null?null:Math.max(0,u-_),y=v==null?!0:v>o;return{stuckFeatures:Number(h?.stuck_features??0),deadHeldFeatures:Number(h?.dead_held_features??0),deadAssignedIssues:Number(h?.dead_assigned_issues??0),deadHeldAssignments:Number(h?.dead_held_assignments??0),reaperLastRunMs:_,reaperAgeMs:v,reaperStale:y,reaperLastReleased:g?.lastReleased??null}}var d,f;e((()=>{o(),i(),n(),t(),d=`stale-claim-sweep`,f=(()=>{let e=Number({}.PAPERCUSP_SWEEP_STALENESS_MS??300*1e3);return Number.isFinite(e)&&e>0?e:300*1e3})()}))();export{u as readWorkQueueHealth};