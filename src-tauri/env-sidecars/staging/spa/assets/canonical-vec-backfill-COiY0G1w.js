import{n as E}from"./chunk-ChpBd9eV.js";import{st as b,t as y}from"./src-8fWtxfEz.js";import{_t as f,gt as T,t as v}from"./src-BeqmmfWq.js";async function S(e,t,i,c){return await e.unsafe(`SELECT c.id::text AS id, c.payload->>'data' AS data
       FROM ${t}.memory_canonical c
      WHERE NOT (c.payload ? 'entityType')
        AND c.state != 'archived'
        AND coalesce(c.payload->>'data', '') != ''
        AND NOT EXISTS (
              SELECT 1 FROM ${t}.${i} v WHERE v.memory_id = c.id)
      ORDER BY c.created_at DESC
      LIMIT $1`,[c])}async function p(e,t,i){const c=(await e.unsafe(`SELECT NOT EXISTS (SELECT 1 FROM ${t}.${i}) AS vector_space_empty,
            EXISTS (
              SELECT 1 FROM ${t}.memory_canonical c
               WHERE NOT (c.payload ? 'entityType')
                 AND c.state != 'archived'
                 AND coalesce(c.payload->>'data', '') != ''
            ) AS canonical_has_rows`))[0];return{vectorSpaceEmpty:!!c?.vector_space_empty,canonicalHasRows:!!c?.canonical_has_rows}}async function O(e={}){const t=e.resolveVecTable??T,i=e.selectRows??S,c=e.embed??f,_=e.limit??m,a=await t();if(!a)return{scanned:0,embedded:0,failed:0,skipped:"embedder-disabled"};const r=e.sql??b().sql,n=await i(r,a.schema,a.table,_);if(n.length===0){let o;try{o=await(e.probeZeroYield??p)(r,a.schema,a.table)}catch{o=void 0}return{scanned:0,embedded:0,failed:0,mode:a.mode,table:a.table,zeroYield:o}}let l=0,d=0;for(const o of n){let s=!1;try{s=await c(o.id,o.data)}catch{s=!1}s?l++:d++}return{scanned:n.length,embedded:l,failed:d,mode:a.mode,table:a.table}}var m,w=E((()=>{y(),v(),m=(()=>{const e=Number({}.PAPERCUSP_MEMORY_VEC_BACKFILL_BATCH);return Number.isFinite(e)&&e>0?e:100})()}));w();export{O as backfillCanonicalMemoryVectors};
