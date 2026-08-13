import{n as i}from"./chunk-ChpBd9eV.js";import{a as o,i as s,o as a,t as c}from"./log-BwQLkm9I.js";async function _(n){const e=(n??"").trim();if(!e||!c())return null;try{const t=(await s()`
      SELECT id::text AS id
        FROM harness_shared.coord_event_log
       WHERE workspace_id = ${o()}
         AND surface = 'messages'
         AND writer_key = ${e}
         AND body->>'lifecycle' = 'intent'
       ORDER BY id DESC
       LIMIT 1`)[0]?.id;if(t==null)return null;const r=Number(t);return Number.isFinite(r)&&r>0?r:null}catch{return null}}var l=i((()=>{a()}));l();export{_ as resolveOwnerIntentEventId};
