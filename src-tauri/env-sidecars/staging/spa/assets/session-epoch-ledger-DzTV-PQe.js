import{n as m}from"./chunk-ChpBd9eV.js";function c(n){const e=n?.message??"";(/relation .* does not exist/.test(e)||e.includes("memory_session_"))&&(t=!0)}async function f(n,e){if(!e||t)return 0;try{const s=await n`
      SELECT epoch FROM harness_shared.memory_session_epochs
      WHERE session_id = ${e}
    `;return s.length>0&&Number(s[0].epoch)||0}catch(s){return c(s),0}}async function p(n,e){if(!e||t)return null;try{const s=await n`
      INSERT INTO harness_shared.memory_session_epochs (session_id, epoch, bumped_at)
      VALUES (${e}, 1, now())
      ON CONFLICT (session_id)
      DO UPDATE SET epoch = harness_shared.memory_session_epochs.epoch + 1, bumped_at = now()
      RETURNING epoch
    `,o=s.length>0?Number(s[0].epoch):null;return await n`
      DELETE FROM harness_shared.memory_session_surfaced
      WHERE surfaced_at < now() - make_interval(days => ${_})
    `,o}catch(s){return c(s),null}}async function E(n,e,s,o){const a=new Set;if(!e||t||o.length===0)return a;const i=o.filter(r=>typeof r=="string"&&u.test(r));if(i.length===0)return a;try{const r=await n`
      SELECT memory_id::text AS id
      FROM harness_shared.memory_session_surfaced
      WHERE session_id = ${e}
        AND epoch = ${s}
        AND memory_id = ANY(${i}::uuid[])
    `;return new Set(r.map(h=>h.id))}catch(r){return c(r),a}}async function l(n,e,s,o,a){if(!e||t)return!1;const i=o.filter(r=>typeof r=="string"&&u.test(r));if(i.length===0)return!0;try{return await n`
      INSERT INTO harness_shared.memory_session_surfaced (session_id, epoch, memory_id, port)
      SELECT ${e}, ${s}, unnest(${i}::uuid[]), ${a}
      ON CONFLICT (session_id, epoch, memory_id) DO NOTHING
    `,!0}catch(r){return c(r),!1}}function y(){t=!1}var t,u,_,S=m((()=>{t=!1,u=/^[0-9a-f-]{20,}$/i,_=14}));export{S as a,f as i,E as n,l as o,p as r,y as t};
