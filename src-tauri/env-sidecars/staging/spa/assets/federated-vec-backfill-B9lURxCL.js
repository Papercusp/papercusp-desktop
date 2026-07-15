import{n as e}from"./chunk-CMxvf4Kt.js";import{A as t,j as n,t as r}from"./src-R_nFx4J9.js";import{J as i,t as a}from"./src-C4H77EbW.js";async function o(e,t,n,r){return await e.unsafe(`SELECT c.id::text AS id, c.payload->>'data' AS data
       FROM ${t}.memory_canonical c
      WHERE c.source_hive IS NOT NULL
        AND NOT (c.payload ? 'entityType')
        AND c.state != 'archived'
        AND coalesce(c.payload->>'data', '') != ''
        AND NOT EXISTS (
              SELECT 1 FROM ${t}.${n} v WHERE v.memory_id = c.id)
      ORDER BY c.created_at DESC
      LIMIT $1`,[r])}async function s(e={}){let r=e.resolveVecTable??t,a=e.selectRows??o,s=e.embed??n,l=e.limit??c,u=await r();if(!u)return{scanned:0,embedded:0,failed:0,skipped:`embedder-disabled`};let d=await a(e.sql??i().sql,u.schema,u.table,l),f=0,p=0;for(let e of d){let t=!1;try{t=await s(e.id,e.data)}catch{t=!1}t?f++:p++}return{scanned:d.length,embedded:f,failed:p}}var c;e((()=>{a(),r(),c=(()=>{let e=Number({}.PAPERCUSP_MEMORY_FED_VEC_BATCH);return Number.isFinite(e)&&e>0?e:25})()}))();export{s as backfillFederatedMemoryVectors};