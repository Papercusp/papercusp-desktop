import{n as N}from"./chunk-ChpBd9eV.js";import{i as f,n as E}from"./schedule-next-9n6Z_X1N.js";async function A(t,c){const{workspaceId:r,harnessSlug:l}=c;return(await t`
    SELECT plan_slug, harness_slug, title, schedule, schedule_active, scheduled_at, expires_at, tzid
      FROM harness_shared.harness_plans
     WHERE workspace_id = ${r}
       AND template_slug IS NULL
       AND (schedule IS NOT NULL OR scheduled_at IS NOT NULL)
       ${l?t`AND harness_slug = ${l}`:t``}
  `).map(s=>({templateSlug:s.plan_slug,harnessSlug:s.harness_slug,title:s.title,schedule:s.schedule??null,scheduledAt:s.scheduled_at?s.scheduled_at.toISOString():null,expiresAt:s.expires_at?s.expires_at.toISOString():null,tzid:s.tzid??null,scheduleActive:s.schedule_active??!1}))}async function D(t,c){const{workspaceId:r,harnessSlug:l,rangeStartMs:s,rangeEndMs:d,limitPerPlan:o=500}=c;if(d<s)return[];const g=new Date(s),p=new Date(d),i=await t`
    SELECT plan_slug, harness_slug, title, schedule, schedule_active, scheduled_at, expires_at
      FROM harness_shared.harness_plans
     WHERE workspace_id = ${r}
       AND template_slug IS NULL
       AND (schedule IS NOT NULL OR scheduled_at IS NOT NULL)
       ${l?t`AND harness_slug = ${l}`:t``}
  `;if(i.length===0)return[];const S=await t`
    SELECT DISTINCT ON (plan_slug) plan_slug, outcome
      FROM harness_shared.plan_runs
     WHERE plan_slug = ANY(${i.map(e=>e.plan_slug)}) AND run_type = 'scheduled'
     ORDER BY plan_slug, launched_at DESC
  `,m=new Map(S.map(e=>[e.plan_slug,e.outcome])),n=[];for(const e of i){const u=e.schedule_active??!1,_=m.get(e.plan_slug)??null,h=e.expires_at&&e.expires_at.getTime()<d?e.expires_at:p;if(e.schedule)for(const a of E(e.schedule,g,h,o))n.push({templateSlug:e.plan_slug,title:e.title,harnessSlug:e.harness_slug,occurrenceMs:a.getTime(),kind:"recurring",scheduleActive:u,lastOutcome:_});if(e.scheduled_at){const a=e.scheduled_at.getTime();a>=s&&a<=h.getTime()&&n.push({templateSlug:e.plan_slug,title:e.title,harnessSlug:e.harness_slug,occurrenceMs:a,kind:"one-shot",scheduleActive:u,lastOutcome:_})}}return n.sort((e,u)=>e.occurrenceMs-u.occurrenceMs),n}var O=N((()=>{f()}));O();export{D as gatherScheduledOccurrences,A as listPlanSchedules};
