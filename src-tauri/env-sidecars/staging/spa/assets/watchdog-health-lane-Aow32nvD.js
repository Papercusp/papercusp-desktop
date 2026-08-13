import{n as l}from"./chunk-ChpBd9eV.js";import{st as k,t as h}from"./src-BmBNODK0.js";import{c as m,r as g}from"./workspace-registry-Du2UbhlH.js";function d(o,c,a={}){const i=a.minActiveTicks??3,s=a.limit??10,n=[],r=o.filter(t=>t.activeTicks>=i||t.brokenTicks>0).sort((t,e)=>e.activeTicks-t.activeTicks||e.totalSignals-t.totalSignals);for(const t of r)n.push({ref:`watchdog:${t.name}`,summary:t.brokenTicks>0?`watchdog collector ${t.name} is itself FAILING (${t.brokenTicks} broken tick(s)/24h)`:`${t.name}: signalling on ${t.activeTicks} of the last 24h's watchdog ticks`,detail:`${t.totalSignals} signal(s) across ${t.activeTicks} active tick(s) in 24h — chronic, not a blip`});for(const t of c)n.push({ref:`watchdog:open:${t}`,summary:`standing OPEN watchdog condition: ${t}`,detail:"open across consecutive watchdog ticks — nobody has resolved the underlying cause"});return n.slice(0,Math.max(1,s))}async function E(o={}){try{const c=o.workspaceId??g(),{sql:a}=k(),i=await a`
      SELECT c->>'name' AS name,
             coalesce(sum((c->>'signalCount')::int), 0)::int AS total,
             count(*) FILTER (WHERE (c->>'signalCount')::int > 0)::int AS active,
             count(*) FILTER (WHERE (c->>'ok')::boolean IS DISTINCT FROM true)::int AS broken
        FROM harness_shared.watchdog_ticks, jsonb_array_elements(collectors) c
       WHERE workspace_id = ${c} AND tick_at > now() - interval '24 hours'
       GROUP BY 1`,s=await a`
      SELECT known_open_keys
        FROM harness_shared.watchdog_ticks
       WHERE workspace_id = ${c}
       ORDER BY tick_at DESC
       LIMIT 1`;return d(i.map(n=>({name:n.name,totalSignals:Number(n.total)||0,activeTicks:Number(n.active)||0,brokenTicks:Number(n.broken)||0})),s[0]?.known_open_keys??[])}catch{return[]}}var u=l((()=>{h(),m()}));u();export{E as buildWatchdogHealthLane};
