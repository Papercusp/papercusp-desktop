import{n as e}from"./chunk-CMxvf4Kt.js";import{q as t,t as n}from"./src-pJSq82rz.js";import{i as r}from"./work-item-claims-_r15lz4t.js";async function i(e,n=24){try{if(!e)return[];let{sql:r}=t(),i=await r`
      SELECT DISTINCT ON (file)
             agent_id, file, work_item_id, plan_slug, intent, session_id, contributor
        FROM harness_shared.edit_attribution_ledger
       WHERE repo_root = ${e}
         AND ts >= now() - make_interval(hours => ${n})
       ORDER BY file, ts DESC
    `,a=new Map;for(let e of i){let t=a.get(e.agent_id);t||(t={agent:e.agent_id,files:[],workItems:[]},a.set(e.agent_id,t)),t.files.includes(e.file)||t.files.push(e.file),e.work_item_id&&!t.workItems.includes(e.work_item_id)&&t.workItems.push(e.work_item_id),e.plan_slug&&!t.planSlug&&(t.planSlug=e.plan_slug),e.intent&&!t.intent&&(t.intent=e.intent),e.session_id&&!t.sessionId&&(t.sessionId=e.session_id),e.contributor&&!t.contributor&&(t.contributor=e.contributor)}return[...a.values()]}catch{return[]}}function a(e){let t={workItems:[]};for(let n of(e??``).split(`
`)){let e=/^(Papercusp-Agent|Papercusp-Work-Item|Papercusp-Session|Papercusp-Plan):\s*(.+)$/.exec(n.trim());if(!e)continue;let r=e[2].trim();e[1]===`Papercusp-Agent`?t.agent=r:e[1]===`Papercusp-Work-Item`?t.workItems=r.split(`,`).map(e=>e.trim()).filter(Boolean):e[1]===`Papercusp-Session`?t.sessionId=r:e[1]===`Papercusp-Plan`&&(t.planSlug=r)}return t}async function o(e){try{if(!e||e.length===0)return;let{sql:n}=t();await n`
      INSERT INTO harness_shared.git_sync_commit_attribution
        (workspace_id, harness_slug, repo, commit_sha, file, agent_id, session_id, work_item_id, plan_slug)
      SELECT * FROM unnest(
        ${e.map(e=>e.workspaceId)}::text[],
        ${e.map(e=>e.harnessSlug)}::text[],
        ${e.map(e=>e.repo)}::text[],
        ${e.map(e=>e.commitSha)}::text[],
        ${e.map(e=>e.file)}::text[],
        ${e.map(e=>e.agentId??null)}::text[],
        ${e.map(e=>e.sessionId??null)}::text[],
        ${e.map(e=>e.workItemId??null)}::text[],
        ${e.map(e=>e.planSlug??null)}::text[]
      )
    `}catch{}}async function s(e,n={}){let r=new Map;try{let i=[...new Set((e??[]).filter(Boolean))];if(i.length===0)return r;let{sql:a}=t(),o=await a`
      SELECT DISTINCT file, work_item_id
        FROM harness_shared.git_sync_commit_attribution
       WHERE file = ANY(${i})
         AND work_item_id IS NOT NULL
         ${n.harnessSlug?a`AND harness_slug = ${n.harnessSlug}`:a``}
         AND ts >= now() - make_interval(hours => ${n.lookbackHours??336})
    `;for(let e of o){let t=r.get(e.file)??[];t.includes(e.work_item_id)||t.push(e.work_item_id),r.set(e.file,t)}return r}catch{return r}}var c=e((()=>{n(),r()}));export{o as a,i,s as n,a as r,c as t};