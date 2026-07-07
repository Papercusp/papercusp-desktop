import{n as e}from"./chunk-CMxvf4Kt.js";function t(e,t,n={}){if(e==null||!Number.isFinite(e))return{stale:!1,unknown:!0,lastTickMs:null,staleMs:null};let i=t-e;return{stale:i>(n.staleMs??r),unknown:!1,lastTickMs:e,staleMs:i}}async function n(e,n={}){try{let r=(await e`
      SELECT MAX(created_at) AS last_tick_ms
        FROM dbos.workflow_status
       WHERE name = 'routinesTick'`)[0]?.last_tick_ms;return t(r==null?null:Number(r),n.nowMs??Date.now(),n)}catch{return{stale:!1,unknown:!0,lastTickMs:null,staleMs:null}}}var r,i=e((()=>{r=6*6e4}));export{n,i as t};