import{n as R}from"./chunk-ChpBd9eV.js";import{r as S,t as b}from"./recipe-authority-BeCvon_3.js";import{i as $,t as I}from"./src-BZE1GDpz.js";function M(o,t){if(o.length===0&&t.length===0)return 0;const r=new Set(t);let e=0;const n=new Set(o);for(const c of t)n.add(c);for(const c of new Set(o))r.has(c)&&e++;return n.size===0?0:e/n.size}async function A(o,t,r={}){const e=t.limit??5,n=`${t.title}
${t.description}`,c=t.embedding&&t.embedding.length>0?async()=>t.embedding:r.embedder??null,g=Math.min(100,Math.max(e+(t.excludeId?1:0)+5,e*8+20)),{results:a}=await $([h],{sql:o,query:n,workspaceId:"",scopeFilter:null,limit:g,mode:"hybrid",embedder:c,embedTimeoutMs:p,log:r.log}),_=a.map(s=>s.source_id).filter(s=>s!==t.excludeId);if(_.length===0)return[];const f=await o`
    SELECT id, title, description, script, run_count, tools_used, updated_at
      FROM harness_shared.code_recipes
     WHERE id = ANY(${_})
  `,y=new Map(f.map(s=>[s.id,s])),m=Math.max(...a.map(s=>s.score),1e-9),u=[];for(const s of a){if(s.source_id===t.excludeId)continue;const i=y.get(s.source_id);if(!i)continue;const E=((m>0?s.score/m:0)+M(t.toolsUsed,i.tools_used??[]))/2,d=await b({script:i.script,updatedAt:typeof i.updated_at=="string"?i.updated_at:i.updated_at.toISOString(),context:t.recommendationContext});d&&u.push({id:i.id,title:i.title,description:i.description,runCount:typeof i.run_count=="number"?i.run_count:parseInt(i.run_count,10),toolsUsed:i.tools_used??[],similarity:E,authority:d.proof,authorityRefs:d.refs,runArgs:{id:i.id,authority:d.proof}})}return u.sort((s,i)=>i.similarity-s.similarity),u.slice(0,e)}var p,l,h,T=R((()=>{I(),S(),p=4e3,l=o=>o.slice(0,200)+(o.length>200?"…":""),h={name:"code_recipes",async lexical({sql:o,query:t,limit:r}){return(await o`
      SELECT id, title, description, run_count, tools_used,
             ts_rank_cd(title_tsv, plainto_tsquery('english', ${t})) AS rank
        FROM harness_shared.code_recipes
       WHERE status = 'active'
         AND title_tsv @@ plainto_tsquery('english', ${t})
    ORDER BY rank DESC LIMIT ${r}
    `).map(e=>({key:`code_recipes:${e.id}`,score:e.rank,row:{source:"code_recipes",source_id:e.id,excerpt:l(`${e.title} — ${e.description}`),highlight:e.title,score:e.rank,rankers:["lexical"]}}))},async embedding({sql:o,limit:t,qVec:r}){return(await o`
      SELECT id, title, description, run_count, tools_used,
             1 - (embedding <=> ${r}::vector) AS sim
        FROM harness_shared.code_recipes
       WHERE status = 'active'
         AND embedding IS NOT NULL
    ORDER BY embedding <=> ${r}::vector
       LIMIT ${t}
    `).map(e=>({key:`code_recipes:${e.id}`,score:e.sim,row:{source:"code_recipes",source_id:e.id,excerpt:l(`${e.title} — ${e.description}`),highlight:e.title,score:e.sim,rankers:["embeddings"]}}))}}}));export{A as n,T as t};
