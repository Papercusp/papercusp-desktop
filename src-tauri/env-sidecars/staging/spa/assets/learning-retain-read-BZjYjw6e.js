import{n as A,o as g}from"./chunk-ChpBd9eV.js";import{t as E}from"./__vite-browser-external-56mrcCg8.js";import{c as S,r as w}from"./work-item-blocking-D8P-UbTl.js";function N(r,a){const s=a.slice(0,2e3),i=/^title:\s*(?:["']?)(.+?)(?:["']?)\s*$/m.exec(s)?.[1]?.trim(),t=/^discovered:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(s)?.[1]??null;return{slug:r,title:i||r,discovered:t}}async function R(r,a=l){const s=(await d.promises.readdir(r)).filter(t=>/\.(md|mdx)$/.test(t)),i=(await Promise.all(s.map(async t=>{try{return{name:t,mtimeMs:(await d.promises.stat(c.default.join(r,t))).mtimeMs}}catch{return null}}))).filter(t=>t!==null).sort((t,n)=>n.mtimeMs-t.mtimeMs).slice(0,a*3);return(await Promise.all(i.map(async({name:t})=>{try{const n=await d.promises.readFile(c.default.join(r,t),"utf8");return N(t.replace(/\.(md|mdx)$/,""),n)}catch{return null}}))).filter(t=>t!==null).sort((t,n)=>(n.discovered??"").localeCompare(t.discovered??"")).slice(0,a)}async function b(r,a,s,i={}){const t=new Date().toISOString();let n=null;try{const e=await r`
      SELECT count(*)::int AS n
        FROM harness_shared.engineer_issues ei
       WHERE ei.workspace_id = ${a}
         AND ei.created_at > now() - interval '7 days'
         AND ${i.harnessScopes?r`ei.scope = ANY(${i.harnessScopes}::text[])`:r`TRUE`}
         AND EXISTS (
           SELECT 1 FROM harness_shared.coord_links cl
            WHERE cl.workspace_id = ${a}
              AND cl.rel = 'tagged'
              AND cl.src_ref = ei.issue_id
              AND cl.dst_kind = 'topic'
              AND cl.dst_ref = 'papercusp-improvement'
         )
    `;n=Number(e[0]?.n??0)}catch(e){console.warn("[learning.retain] improvements-count read failed:",e instanceof Error?e.message:e)}let u=null;try{const e=await r`
      SELECT count(*)::int AS n
        FROM harness_shared.harness_plans hp
       WHERE hp.workspace_id = ${a}
         AND hp.created > now() - interval '7 days'
         AND ${i.memberSlugs?r`hp.harness_slug = ANY(${i.memberSlugs}::text[])`:r`TRUE`}
    `;u=Number(e[0]?.n??0)}catch(e){console.warn("[learning.retain] plans-count read failed:",e instanceof Error?e.message:e)}let p=[];try{p=(await r`
      SELECT DISTINCT ON (r.idea_id)
             r.idea_id, r.title, r.rail, r.routed_ref,
             COALESCE(ei.state, hp.status) AS outcome,
             COALESCE(ei.updated_at, hp.updated_at)::text AS completed_at
        FROM harness_shared.scout_routed_ideas r
        LEFT JOIN harness_shared.engineer_issues ei
          ON ei.workspace_id = r.workspace_id
         AND r.routed_ref LIKE 'wi:%'
         AND ei.issue_id = substring(r.routed_ref from 4)
        LEFT JOIN harness_shared.harness_plans hp
          ON hp.workspace_id = r.workspace_id
         AND r.routed_ref LIKE 'plan:%'
         AND hp.plan_slug = substring(r.routed_ref from 6)
       WHERE r.workspace_id = ${a}
         AND (
           -- EI-18792873324746237: this filtered the pre-unify spellings only,
           -- so after the writer-flip NO work-item-routed idea could ever reach
           -- this list — all 137 shipped ones were silently excluded and only
           -- the plan-routed branch below produced rows. Bind the shared set.
           ei.state = ANY(${[...w]}::text[])
           OR (hp.status IS NOT NULL AND hp.status NOT IN ('draft', 'superseded'))
         )
       ORDER BY r.idea_id, COALESCE(ei.updated_at, hp.updated_at) DESC NULLS LAST
    `).map(e=>{const o=String(e.outcome??"");return{ideaId:String(e.idea_id??""),title:typeof e.title=="string"&&e.title?e.title:null,rail:String(e.rail??""),routedRef:String(e.routed_ref??""),outcome:o,shipped:w.has(o)||o==="shipped",completedAt:typeof e.completed_at=="string"?e.completed_at:null}}).filter(e=>e.ideaId).sort((e,o)=>(o.completedAt??"").localeCompare(e.completedAt??"")).slice(0,l)}catch(e){console.warn("[learning.retain] shipped-from-ideas read failed:",e instanceof Error?e.message:e)}let _=null;try{const e=await s.readLensWeights();_=Object.keys(e).length>0?e:null}catch(e){console.warn("[learning.retain] lens-weight read failed:",e instanceof Error?e.message:e)}let m=[];try{m=(await s.listRubrics()).slice().sort((e,o)=>o.updatedAt.localeCompare(e.updatedAt)).slice(0,l).map(e=>({slug:e.slug,title:e.title,status:e.status,updatedAt:e.updatedAt}))}catch(e){console.warn("[learning.retain] rubric read failed:",e instanceof Error?e.message:e)}let h=[];try{h=await s.readInsightDocs()}catch(e){console.warn("[learning.retain] insight-doc read failed:",e instanceof Error?e.message:e)}let f=[];try{f=(await s.listRecipes()).slice(0,l).map(e=>({id:e.id,title:e.title,runCount:e.runCount,lastRunAt:e.lastRunAt}))}catch(e){console.warn("[learning.retain] recipes read failed:",e instanceof Error?e.message:e)}return{banked:{improvementsFiled7d:n,plansDrafted7d:u},shippedFromIdeas:p,lensWeights:_,rubricChanges:m,insightDocs:h,recipes:f,generatedAt:t}}var d,c,l,y=A((()=>{d=g(E(),1),c=g(E(),1),S(),l=8}));y();export{R as readRecentInsightDocs,b as readRetainExtras};
