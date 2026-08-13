import{n as b}from"./chunk-ChpBd9eV.js";async function O(t,f={}){const a={...m,...f},o=s=>({reclaimed:[],entriesReclaimed:0,entriesBefore:0,entriesAfter:0,capMax:0,capStillPressured:!1,skipped:s,truncated:!1}),[g]=await t`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements')
      AS installed`;if(!g?.installed)return o("extension-absent");const[l]=await t`
    SELECT has_function_privilege(
             current_user,
             'pg_stat_statements_reset(oid,oid,bigint,boolean)',
             'EXECUTE') AS can_reset`;if(!l?.can_reset)return o("no-privilege");const[_]=await t`
    SELECT (SELECT count(*) FROM pg_stat_statements)::text AS entries,
           (SELECT setting FROM pg_settings WHERE name = 'pg_stat_statements.max') AS cap_max`,i=r(_?.entries),n=r(_?.cap_max),d=await t`
    SELECT s.dbid::text AS dbid, count(*)::text AS entries
      FROM pg_stat_statements s
     WHERE s.dbid <> 0
       AND NOT EXISTS (SELECT 1 FROM pg_database d WHERE d.oid = s.dbid)
     GROUP BY s.dbid
     ORDER BY count(*) DESC`;if(d.length===0)return{...o("no-orphans"),entriesBefore:i,entriesAfter:i,capMax:n,capStillPressured:n>0&&i/n*100>a.pressurePct};const u=d.slice(0,a.maxDbidsPerRun),R=d.length>u.length,c=[];for(const s of u){const e=r(s.dbid),E=r(s.entries);if(!(!Number.isFinite(e)||e===0)){if(a.dryRun){c.push({dbid:e,entries:E});continue}try{const[p]=await t`
        SELECT (pg_stat_statements_reset(0, ${e}::oid, 0, false) IS NOT NULL) AS reset
         WHERE NOT EXISTS (SELECT 1 FROM pg_database d WHERE d.oid = ${e}::oid)`;p?.reset&&c.push({dbid:e,entries:E})}catch(p){c.push({dbid:e,entries:E,error:p.message})}}}const[T]=await t`
    SELECT count(*)::text AS entries FROM pg_stat_statements`,S=a.dryRun?i:r(T?.entries);return{reclaimed:c,entriesReclaimed:c.filter(s=>!s.error).reduce((s,e)=>s+e.entries,0),entriesBefore:i,entriesAfter:S,capMax:n,capStillPressured:n>0&&S/n*100>a.pressurePct,truncated:R}}var m,r,x=b((()=>{m={maxDbidsPerRun:50,pressurePct:80},r=t=>Number(t??0)}));x();export{O as reclaimOrphanPgssStatsOnce};
