import{n as e}from"./chunk-CMxvf4Kt.js";import{n as t,r as n}from"./types-CyjElHn-.js";import{J as r,t as i}from"./src-BiEJ-vhU.js";function a(e,n){if(!e)return[];let r=[];for(let i of t){let t=n.panels[i],a=e.panels?.[i];!t||!a||a.status!==t.status&&r.push({panel:i,from:a.status,to:t.status,summary:t.summary??null})}return r}async function o(e,n){let{sql:i}=r(),o={};for(let e of t){let t=n.panels[e];t&&(o[e]=t.status)}let l=new Date(n.evaluatedAt).toISOString();await i`
    INSERT INTO harness_shared.system_health_ticks (workspace_id, at, overall, statuses)
    VALUES (${n.workspaceId}, ${l}, ${n.overall}, ${JSON.stringify(o)}::jsonb)
    ON CONFLICT (workspace_id, at) DO NOTHING`;let u=a(e,n);for(let e of u)await i`
      INSERT INTO harness_shared.system_health_transitions
        (workspace_id, panel, from_status, to_status, summary, at)
      VALUES (${n.workspaceId}, ${e.panel}, ${e.from}, ${e.to},
              ${e.summary?e.summary.slice(0,500):null}, ${l})`;Math.random()<1/c&&(await i`DELETE FROM harness_shared.system_health_ticks
               WHERE at < now() - make_interval(days => ${s})`,await i`DELETE FROM harness_shared.system_health_transitions
               WHERE at < now() - make_interval(days => ${s})`)}var s,c;e((()=>{i(),n(),s=14,c=50}))();export{o as recordHealthHistory};