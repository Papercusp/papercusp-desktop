import{n as l}from"./chunk-ChpBd9eV.js";import{a as c,i as g,o as h}from"./throughput-DvMizoN8.js";import{i as _,n as m,r as d}from"./degraded-snapshot-dcpcqMtk.js";async function E(o,u,a={}){const p=Math.min(Math.max(a.recentLimit??60,1),500);let n=[];try{n=await o`
      SELECT pot_slug, tick_at, frontier_depth, placements, cups_busy, cups_cap,
             stuck_count, completed, mttc_ms, question_rungs, detail
        FROM harness_shared.pot_throughput_ticks
       WHERE workspace_id = ${u}
         ${a.potSlug?o`AND pot_slug = ${a.potSlug}`:o``}
       ORDER BY tick_at DESC
       LIMIT 2000
    `}catch(t){return _(t)||console.warn("[learning.hiveThroughput] tick read failed:",t instanceof Error?t.message:t),m({hives:[]},t)}const i=new Map;for(const t of n){const e=h(t),r=i.get(e.potSlug);r?r.push(e):i.set(e.potSlug,[e])}const s=[...i.entries()].map(([t,e])=>{const r=e[0]??null;return{potSlug:t,latest:r,recent:e.slice(0,p),operatingWell:r?c(r):!1}});return s.sort((t,e)=>Number(t.operatingWell)-Number(e.operatingWell)||t.potSlug.localeCompare(e.potSlug)),{hives:s}}var f=l((()=>{d(),g()}));f();export{E as readHiveThroughputSnapshot};
