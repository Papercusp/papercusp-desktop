import{n as l}from"./chunk-ChpBd9eV.js";function u(n,e,t={}){if(n==null||!Number.isFinite(n))return{stale:!1,unknown:!0,lastTickMs:null,staleMs:null};const s=e-n;return{stale:s>(t.staleMs??a),unknown:!1,lastTickMs:n,staleMs:s}}async function i(n,e={}){try{const t=(await n`
      SELECT MAX(created_at) AS last_tick_ms
        FROM dbos.workflow_status
       WHERE name = 'routinesTick'`)[0]?.last_tick_ms;return u(t==null?null:Number(t),e.nowMs??Date.now(),e)}catch{return{stale:!1,unknown:!0,lastTickMs:null,staleMs:null}}}var a,o=l((()=>{a=6*6e4}));export{i as n,o as t};
