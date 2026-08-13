import{n as _}from"./chunk-ChpBd9eV.js";function c(t){const r=t?.message??"";(/relation .* does not exist/.test(r)||r.includes("corpus_session_surfaced"))&&(i=!0)}async function l(t,r,o,a){const s=new Set;if(!r||i||a.length===0)return s;const n=a.filter(e=>typeof e=="string"&&e.length>0);if(n.length===0)return s;try{const e=await t`
      SELECT ref FROM harness_shared.corpus_session_surfaced
       WHERE session_id = ${r}
         AND epoch = ${o}
         AND ref = ANY(${n}::text[])
    `;return new Set(e.map(u=>u.ref))}catch(e){return c(e),s}}async function p(t,r,o,a,s){if(!r||i)return!1;const n=[...new Set(a.filter(e=>typeof e=="string"&&e.length>0))];if(n.length===0)return!0;try{await t`
      INSERT INTO harness_shared.corpus_session_surfaced (session_id, epoch, ref, port)
      SELECT ${r}, ${o}, r, ${s}
        FROM unnest(${n}::text[]) AS r
      ON CONFLICT (session_id, epoch, ref) DO NOTHING
    `;try{await t`
        DELETE FROM harness_shared.corpus_session_surfaced
         WHERE surfaced_at < now() - (${String(f)} || ' days')::interval
      `}catch{}return!0}catch(e){return c(e),!1}}var i,f,d=_((()=>{i=!1,f=14}));d();export{l as alreadySurfacedRefs,p as stampSurfacedRefs};
