import{n as g}from"./chunk-ChpBd9eV.js";import{st as c,t as I}from"./src-8fWtxfEz.js";import{_t as k,ht as h}from"./messages-33LAQAG-.js";import{t as w,u as $}from"./work-item-dispatch-states-jkwfzC7Z.js";import{d as S,s as E}from"./work-item-claims-DNd3hpi4.js";import{i as m,r as A}from"./presence-payload-DkQePzMS.js";async function O(t){try{const i=(t.files??[]).filter(Boolean);if(i.length===0||!t.agentId||!t.repoRoot)return;const{sql:e}=c();let r=null,a=null;if(t.workspaceId){const d=t.goalRef?.trim()||null;if(d){const l=(await e`
          SELECT harness_slug, feature_id
            FROM harness_shared.work_items
           WHERE workspace_id = ${t.workspaceId}
             AND feature_id = ${d}
             AND taken_by = ${t.agentId}
             AND NOT (status = ANY(${[...w]}::text[]))
           LIMIT 1
        `.catch(()=>[]))[0];l&&(r=l.harness_slug,a=l.feature_id)}else{const l=await E(t.workspaceId,t.agentId).catch(()=>null);l&&(r=l.harnessSlug??null,a=l.workItemId??null)}}let o=null;const s=await h(t.agentId).catch(()=>null);s?.currentPlanSlug&&(o=s.currentPlanSlug);const n=t.intent?.trim()||null,u=m(n),_=s?.intent?.trim()||null,f=u?m(_)?null:_:n,p=u?n:null;await e`
      INSERT INTO harness_shared.edit_attribution_ledger
        (repo_root, file, agent_id, session_id, contributor, workspace_id,
         harness_slug, work_item_id, plan_slug, intent, acquired_via)
      SELECT ${t.repoRoot}, f, ${t.agentId}, ${t.sessionId??null},
             ${t.contributor??null}, ${t.workspaceId??null},
             ${r}, ${a}, ${o}, ${f}, ${p}
        FROM unnest(${i}::text[]) AS f
    `}catch{}}async function D(t){try{const{workspaceId:i,lookbackHours:e=24}=t;if(!i)return[];const{sql:r}=c(),a=await r`
      SELECT DISTINCT ON (file)
             agent_id, file, work_item_id, plan_slug, intent, session_id, contributor
        FROM harness_shared.edit_attribution_ledger
       WHERE workspace_id = ${i}
         AND ts >= now() - make_interval(hours => ${e})
       ORDER BY file, ts DESC
    `,o=new Map;for(const s of a){let n=o.get(s.agent_id);n||(n={agent:s.agent_id,files:[],workItems:[]},o.set(s.agent_id,n)),n.files.includes(s.file)||n.files.push(s.file),s.work_item_id&&!n.workItems.includes(s.work_item_id)&&n.workItems.push(s.work_item_id),s.plan_slug&&!n.planSlug&&(n.planSlug=s.plan_slug),s.intent&&!n.intent&&(n.intent=s.intent),s.session_id&&!n.sessionId&&(n.sessionId=s.session_id),s.contributor&&!n.contributor&&(n.contributor=s.contributor)}return[...o.values()]}catch{return[]}}function L(t){const i={workItems:[]};for(const e of(t??"").split(`
`)){const r=/^(Papercusp-Agent|Papercusp-Work-Item|Papercusp-Session|Papercusp-Plan):\s*(.+)$/.exec(e.trim());if(!r)continue;const a=r[2].trim();r[1]==="Papercusp-Agent"?i.agent=a:r[1]==="Papercusp-Work-Item"?i.workItems=a.split(",").map(o=>o.trim()).filter(Boolean):r[1]==="Papercusp-Session"?i.sessionId=a:r[1]==="Papercusp-Plan"&&(i.planSlug=a)}return i}async function C(t){try{if(!t||t.length===0)return;const{sql:i}=c();await i`
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
    `}catch{}}async function M(t,i={}){const e=new Map;try{const r=[...new Set((t??[]).filter(Boolean))];if(r.length===0)return e;const{sql:a}=c(),o=await a`
      SELECT DISTINCT file, work_item_id
        FROM harness_shared.git_sync_commit_attribution
       WHERE file = ANY(${r})
         AND work_item_id IS NOT NULL
         ${i.harnessSlug?a`AND harness_slug = ${i.harnessSlug}`:a``}
         AND ts >= now() - make_interval(hours => ${i.lookbackHours??336})
    `;for(const s of o){const n=e.get(s.file)??[];n.includes(s.work_item_id)||n.push(s.work_item_id),e.set(s.file,n)}return e}catch{return e}}var q=g((()=>{I(),S(),k(),A(),$()}));export{C as a,D as i,M as n,O as o,L as r,q as t};
