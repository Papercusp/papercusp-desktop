import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-BiEJ-vhU.js";import{n as r,s as i}from"./workspace-registry-Bu1Yy540.js";function a(e,t,n={}){let r=n.minActiveTicks??3,i=n.limit??10,a=[],o=e.filter(e=>e.activeTicks>=r||e.brokenTicks>0).sort((e,t)=>t.activeTicks-e.activeTicks||t.totalSignals-e.totalSignals);for(let e of o)a.push({ref:`watchdog:${e.name}`,summary:e.brokenTicks>0?`watchdog collector ${e.name} is itself FAILING (${e.brokenTicks} broken tick(s)/24h)`:`${e.name}: signalling on ${e.activeTicks} of the last 24h's watchdog ticks`,detail:`${e.totalSignals} signal(s) across ${e.activeTicks} active tick(s) in 24h — chronic, not a blip`});for(let e of t)a.push({ref:`watchdog:open:${e}`,summary:`standing OPEN watchdog condition: ${e}`,detail:`open across consecutive watchdog ticks — nobody has resolved the underlying cause`});return a.slice(0,Math.max(1,i))}async function o(e={}){try{let n=e.workspaceId??r(),{sql:i}=t(),o=await i`
      SELECT c->>'name' AS name,
             coalesce(sum((c->>'signalCount')::int), 0)::int AS total,
             count(*) FILTER (WHERE (c->>'signalCount')::int > 0)::int AS active,
             count(*) FILTER (WHERE (c->>'ok')::boolean IS DISTINCT FROM true)::int AS broken
        FROM harness_shared.watchdog_ticks, jsonb_array_elements(collectors) c
       WHERE workspace_id = ${n} AND tick_at > now() - interval '24 hours'
       GROUP BY 1`,s=await i`
      SELECT known_open_keys
        FROM harness_shared.watchdog_ticks
       WHERE workspace_id = ${n}
       ORDER BY tick_at DESC
       LIMIT 1`;return a(o.map(e=>({name:e.name,totalSignals:Number(e.total)||0,activeTicks:Number(e.active)||0,brokenTicks:Number(e.broken)||0})),s[0]?.known_open_keys??[])}catch{return[]}}e((()=>{n(),i()}))();export{o as buildWatchdogHealthLane};