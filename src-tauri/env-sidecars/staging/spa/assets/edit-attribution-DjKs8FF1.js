import{n as p}from"./chunk-ChpBd9eV.js";import{st as l,t as g}from"./src-BmBNODK0.js";import{_t as I,ht as k}from"./messages-DA3ma2xE.js";import{d as h,s as w}from"./work-item-claims-DBmfo-bY.js";import{i as _,r as S}from"./presence-payload-BplumyXZ.js";async function T(t){try{const s=(t.files??[]).filter(Boolean);if(s.length===0||!t.agentId||!t.repoRoot)return;let e=null,r=null;if(t.workspaceId){const c=await w(t.workspaceId,t.agentId).catch(()=>null);c&&(e=c.harnessSlug??null,r=c.workItemId??null)}let a=null;const o=await k(t.agentId).catch(()=>null);o?.currentPlanSlug&&(a=o.currentPlanSlug);const n=t.intent?.trim()||null,i=_(n),u=o?.intent?.trim()||null,d=i?_(u)?null:u:n,m=i?n:null,{sql:f}=l();await f`
      INSERT INTO harness_shared.edit_attribution_ledger
        (repo_root, file, agent_id, session_id, contributor, workspace_id,
         harness_slug, work_item_id, plan_slug, intent, acquired_via)
      SELECT ${t.repoRoot}, f, ${t.agentId}, ${t.sessionId??null},
             ${t.contributor??null}, ${t.workspaceId??null},
             ${e}, ${r}, ${a}, ${d}, ${m}
        FROM unnest(${s}::text[]) AS f
    `}catch{}}async function A(t){try{const{workspaceId:s,lookbackHours:e=24}=t;if(!s)return[];const{sql:r}=l(),a=await r`
      SELECT DISTINCT ON (file)
             agent_id, file, work_item_id, plan_slug, intent, session_id, contributor
        FROM harness_shared.edit_attribution_ledger
       WHERE workspace_id = ${s}
         AND ts >= now() - make_interval(hours => ${e})
       ORDER BY file, ts DESC
    `,o=new Map;for(const n of a){let i=o.get(n.agent_id);i||(i={agent:n.agent_id,files:[],workItems:[]},o.set(n.agent_id,i)),i.files.includes(n.file)||i.files.push(n.file),n.work_item_id&&!i.workItems.includes(n.work_item_id)&&i.workItems.push(n.work_item_id),n.plan_slug&&!i.planSlug&&(i.planSlug=n.plan_slug),n.intent&&!i.intent&&(i.intent=n.intent),n.session_id&&!i.sessionId&&(i.sessionId=n.session_id),n.contributor&&!i.contributor&&(i.contributor=n.contributor)}return[...o.values()]}catch{return[]}}function R(t){const s={workItems:[]};for(const e of(t??"").split(`
`)){const r=/^(Papercusp-Agent|Papercusp-Work-Item|Papercusp-Session|Papercusp-Plan):\s*(.+)$/.exec(e.trim());if(!r)continue;const a=r[2].trim();r[1]==="Papercusp-Agent"?s.agent=a:r[1]==="Papercusp-Work-Item"?s.workItems=a.split(",").map(o=>o.trim()).filter(Boolean):r[1]==="Papercusp-Session"?s.sessionId=a:r[1]==="Papercusp-Plan"&&(s.planSlug=a)}return s}async function x(t){try{if(!t||t.length===0)return;const{sql:s}=l();await s`
      INSERT INTO harness_shared.git_sync_commit_attribution
        (workspace_id, harness_slug, repo, commit_sha, file, agent_id, session_id, work_item_id, plan_slug)
      SELECT * FROM unnest(
        ${t.map(e=>e.workspaceId)}::text[],
        ${t.map(e=>e.harnessSlug)}::text[],
        ${t.map(e=>e.repo)}::text[],
        ${t.map(e=>e.commitSha)}::text[],
        ${t.map(e=>e.file)}::text[],
        ${t.map(e=>e.agentId??null)}::text[],
        ${t.map(e=>e.sessionId??null)}::text[],
        ${t.map(e=>e.workItemId??null)}::text[],
        ${t.map(e=>e.planSlug??null)}::text[]
      )
    `}catch{}}async function O(t,s={}){const e=new Map;try{const r=[...new Set((t??[]).filter(Boolean))];if(r.length===0)return e;const{sql:a}=l(),o=await a`
      SELECT DISTINCT file, work_item_id
        FROM harness_shared.git_sync_commit_attribution
       WHERE file = ANY(${r})
         AND work_item_id IS NOT NULL
         ${s.harnessSlug?a`AND harness_slug = ${s.harnessSlug}`:a``}
         AND ts >= now() - make_interval(hours => ${s.lookbackHours??336})
    `;for(const n of o){const i=e.get(n.file)??[];i.includes(n.work_item_id)||i.push(n.work_item_id),e.set(n.file,i)}return e}catch{return e}}var C=p((()=>{g(),h(),I(),S()}));export{x as a,A as i,O as n,T as o,R as r,C as t};
