const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/__vite-browser-external-CGWw7gYu.js","assets/__vite-browser-external-56mrcCg8.js","assets/chunk-ChpBd9eV.js"])))=>i.map(i=>d[i]);
import{n as N,o as E}from"./chunk-ChpBd9eV.js";import{n as b,t as O}from"./preload-helper-CcgcQsTF.js";async function D(s,_={}){const n={...o,..._},a={reindexed:[],bytesReclaimed:0,orphansDropped:[],truncated:!1},[{max_open_seconds:p}={max_open_seconds:0}]=await s`
    SELECT COALESCE(EXTRACT(EPOCH FROM max(now() - xact_start)), 0)::float8 AS max_open_seconds
      FROM pg_stat_activity
     WHERE xact_start IS NOT NULL
       AND backend_type = 'client backend'
       AND pid <> pg_backend_pid()
  `;if(Number(p)>n.maxOpenTxnSeconds)return a.skipped="long-running-transaction",a;const l=await s`
    SELECT n.nspname AS schema_name, c.relname AS index_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE c.relkind = 'i'
       AND n.nspname = ANY(${n.schemas})
       AND (c.relname LIKE '%\_ccnew' OR c.relname LIKE '%\_ccold'
            OR c.relname ~ '_cc(new|old)[0-9]+$')
       AND NOT i.indisprimary
       AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = c.oid)
  `;for(const e of l)try{await s.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${e.schema_name}"."${e.index_name}"`),a.orphansDropped.push(`${e.schema_name}.${e.index_name}`)}catch{}try{const[{data_directory:e}={data_directory:""}]=await s`SELECT setting AS data_directory FROM pg_settings WHERE name = 'data_directory'`;if(e){const{statfs:c}=await O(async()=>{const{statfs:r}=await import("./__vite-browser-external-CGWw7gYu.js").then(i=>E(i.default,1));return{statfs:r}},__vite__mapDeps([0,1,2])),t=await c(e);if(Number(t.bavail)*Number(t.bsize)<n.minFreeDiskBytes)return a.skipped="low-disk",a}}catch{}const d=await s`
    SELECT n.nspname AS schema_name,
           c.relname  AS index_name,
           t.relname  AS table_name,
           pg_relation_size(c.oid)::text AS index_bytes
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_am am ON am.oid = c.relam
      LEFT JOIN pg_stat_user_tables st ON st.relid = t.oid
     WHERE n.nspname = ANY(${n.schemas})
       AND am.amname = 'btree'
       AND i.indisvalid
       AND pg_relation_size(c.oid) >= ${n.minBytes}
       AND t.reltuples > 0
       AND (pg_relation_size(c.oid) / t.reltuples) > ${n.maxBytesPerRow}
       AND COALESCE(st.n_tup_del, 0) >= ${n.minTableDeletes}
     ORDER BY pg_relation_size(c.oid) DESC
     LIMIT ${n.maxIndexesPerRun}
  `;if(d.length===0)return a.orphansDropped.length===0&&(a.skipped="no-candidates"),a;if(n.dryRun)return a.reindexed=d.map(e=>({schema:e.schema_name,index:e.index_name,table:e.table_name,beforeBytes:Number(e.index_bytes),afterBytes:Number(e.index_bytes),elapsedMs:0})),a;const x=Date.now()+n.timeBudgetMs;for(const e of d){if(Date.now()>x){a.truncated=!0;break}const c=`"${e.schema_name}"."${e.index_name}"`,t=Number(e.index_bytes),r=Date.now();try{await s.unsafe(`REINDEX INDEX CONCURRENTLY ${c}`);const[i]=await s`
        SELECT pg_relation_size(${`${e.schema_name}.${e.index_name}`}::regclass)::text AS bytes
      `,m=Number(i?.bytes??t);a.reindexed.push({schema:e.schema_name,index:e.index_name,table:e.table_name,beforeBytes:t,afterBytes:m,elapsedMs:Date.now()-r}),a.bytesReclaimed+=Math.max(0,t-m)}catch(i){a.reindexed.push({schema:e.schema_name,index:e.index_name,table:e.table_name,beforeBytes:t,afterBytes:t,elapsedMs:Date.now()-r,error:i.message})}}return a}var o,u=N((()=>{b(),o={minBytes:64*1024*1024,maxBytesPerRow:200,minTableDeletes:1e5,maxIndexesPerRun:12,timeBudgetMs:10*6e4,maxOpenTxnSeconds:60,minFreeDiskBytes:20*1024*1024*1024,schemas:["harness_shared"]}}));u();export{D as runIndexBloatReindexOnce};
