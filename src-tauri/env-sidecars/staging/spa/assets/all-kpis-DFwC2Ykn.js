import{n as u,o as v}from"./chunk-ChpBd9eV.js";import{yt as x}from"./src-BnAm_Gmw.js";import{st as M,t as C}from"./src-8fWtxfEz.js";import{t as k}from"./__vite-browser-external-56mrcCg8.js";import{t as N}from"./src-By4QS-w9.js";import{l as j,o as F}from"./harness-registry-Diy1vc1F.js";import{n as A,t as Y}from"./route-workspace-BKel5Fqy.js";function D(n){return y.test(n)}function w(n){return[...n].filter(D)}var y,I=u((()=>{y=/^[A-Za-z_][A-Za-z0-9_]*$/}));function U(n){let o=0,r=0;for(const s of n)s.status==="pending"?o+=s.n:r+=s.n;return{open:o,acknowledged:r}}function B(n){let o=0;const r={};for(const s of n)o+=s.n,r[s.op]=(r[s.op]??0)+s.n;return{total:o,byOp:r}}function H(n){return n.filter(o=>o.last_status==="ok"||o.last_status==="firing").length}var $=u((()=>{}));async function P(){const[n,o]=await A(async t=>{const l=await j(),_=await t`
        SELECT status, count(*)::int AS n FROM harness_shared.projects GROUP BY status
      `;return[l.projects,_]}),r=n.filter(t=>typeof t.slug=="string"&&t.slug.length>0).map(t=>({nspname:"harness_"+t.slug.replace(/-/g,"_")})),{sql:s}=M(),p={};let m=0;for(const t of o)p[t.status]=t.n,m+=t.n;let h=0,f=0;const c={};let g=0,d=0;if(r.length>0){const t=await s`
        SELECT table_schema, table_name
          FROM information_schema.tables
         WHERE table_schema = ANY(${r.map(a=>a.nspname)})
           AND table_name IN ('messages', 'executed_actions')
      `,l=new Set(t.filter(a=>a.table_name==="messages").map(a=>a.table_schema)),_=new Set(t.filter(a=>a.table_name==="executed_actions").map(a=>a.table_schema)),i=w(l),R=w(_);if(i.length>0){const a=i.map(e=>`SELECT count(*)::int AS n FROM ${e}.messages WHERE created_at > now() - interval '24 hours'`).join(" UNION ALL ");try{h=(await s.unsafe(`SELECT sum(n)::int AS total FROM (${a}) t`))[0]?.total??0}catch(e){console.error("[all-kpis] messages_24h aggregate failed:",e)}}if(R.length>0){const a=R.map(e=>`SELECT op, count(*)::int AS n FROM ${e}.executed_actions WHERE executed_at > now() - interval '24 hours' GROUP BY op`).join(" UNION ALL ");try{const e=B(await s.unsafe(`SELECT op, sum(n)::int AS n FROM (${a}) t GROUP BY op`));f+=e.total;for(const[O,L]of Object.entries(e.byOp))c[O]=(c[O]??0)+L}catch(e){console.error("[all-kpis] executed_actions_24h aggregate failed:",e)}}if(i.length>0){const a=i.map(e=>`SELECT status, count(*)::int AS n FROM ${e}.messages WHERE kind = 'Directive' GROUP BY status`).join(" UNION ALL ");try{const e=U(await s.unsafe(`SELECT status, sum(n)::int AS n FROM (${a}) t GROUP BY status`));g+=e.open,d+=e.acknowledged}catch(e){console.error("[all-kpis] directive status tally failed:",e)}}}const b=(await A(async t=>await t`
        SELECT parent_slug AS slug, count(*)::int AS children
          FROM harness_shared.projects
         WHERE parent_slug IS NOT NULL
         GROUP BY parent_slug
         ORDER BY children DESC
      `)).map(t=>({slug:t.slug,children_count:t.children}));let E=0,S=[];try{if((await s`
        SELECT EXISTS(SELECT 1 FROM information_schema.tables
                      WHERE table_schema = 'harness_shared' AND table_name = 'autoloop_state') AS exists
      `)[0]?.exists){const t=await s`
          SELECT harness_slug, role,
                 to_char(last_fired_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS last_fired_at,
                 last_status, consecutive_errors
          FROM harness_shared.autoloop_state
          ORDER BY last_fired_at DESC
          LIMIT 20
        `;S=t,E=H(t)}}catch(t){console.error("[all-kpis] autoloop_state query failed:",t)}return{totals:{harnesses:r.length,projects:m,projects_by_status:p,messages_24h:h,executed_actions_24h:f},parents:b,directives:{open:g,acknowledged:d},audit:{actions_24h_by_op:c},autoloop:{active:E,recent_fires:S},system:{uptime_seconds:Math.floor(T.default.uptime())}}}var T,W,G=u((()=>{C(),T=v(k(),1),Y(),F(),N(),I(),$(),W=x({method:"GET",path:"/harness/all/kpis",auth:"public",async handler(){const n=await P();return new Response(JSON.stringify(n),{headers:{"content-type":"application/json","Cache-Control":"private, max-age=10"}})}})}));G();export{P as loadAllKpis};
