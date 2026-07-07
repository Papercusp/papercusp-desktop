import{n as e}from"./chunk-CMxvf4Kt.js";import{Y as t}from"./src-C4Fj_oRp.js";import{t as n}from"./src-BpFIQUIk.js";function r(e){return{id:e.id,title:e.title,description:e.description,script:e.script,authorRole:e.author_role,toolsUsed:e.tools_used??[],runCount:s(e.run_count),successCount:s(e.success_count),lastRunAt:o(e.last_run_at),status:e.status,promotedTool:e.promoted_tool,mergedInto:e.merged_into,tags:e.tags??[],hasEmbedding:e.has_embedding,createdBy:e.created_by,createdAt:a(e.created_at),updatedAt:a(e.updated_at)}}async function i(e,t={}){let n=t.staleDays??30,i=t.maxRunCount??1;return t.dryRun??!1?{swept:(await e`
      SELECT ${c(e)} FROM harness_shared.code_recipes
       WHERE status = 'active'
         AND run_count <= ${i}
         AND last_run_at IS NOT NULL
         AND last_run_at < now() - make_interval(days => ${n})
       ORDER BY last_run_at ASC NULLS LAST, run_count ASC, id`).map(r),dryRun:!0}:{swept:(await e`
    UPDATE harness_shared.code_recipes
       SET status = 'retired', updated_at = now()
     WHERE status = 'active'
       AND run_count <= ${i}
       AND last_run_at IS NOT NULL
       AND last_run_at < now() - make_interval(days => ${n})
    RETURNING ${c(e)}`).map(r),dryRun:!1}}var a,o,s,c,l=e((()=>{a=e=>typeof e==`string`?e:e.toISOString(),o=e=>e==null?null:a(e),s=e=>typeof e==`number`?e:parseInt(e,10),c=e=>e`
  id, title, description, script, author_role,
  tools_used, run_count, success_count, last_run_at, status, promoted_tool,
  merged_into, tags, (embedding IS NOT NULL) AS has_embedding,
  created_by, created_at, updated_at
`}));function u(e,t=60){let n=new Map;for(let{name:r,list:i}of e)i.forEach((e,i)=>{let a=1/(t+i+1),o=n.get(e.key);o?(o.score+=a,o.rankers.includes(r)||o.rankers.push(r)):n.set(e.key,{row:e.row,score:a,rankers:[r]})});return Array.from(n.values()).sort((e,t)=>t.score-e.score)}var d=e((()=>{}));async function f(e,t){let n=null;if(t.embedder)try{n=await t.embedder(t.query)}catch(e){t.log?.(`search:semantic query embed failed: ${e.message}`)}let r=t.limit*3,i=[];if(t.mode===`hybrid`)for(let n of e)try{let e=await n.bm25({sql:t.sql,query:t.query,workspaceId:t.workspaceId,scopeFilter:t.scopeFilter,limit:r,filters:t.filters});i.push({name:`bm25`,list:e})}catch(e){t.log?.(`bm25 ${n.name} skipped: ${e.message}`)}if(n){let a=`[${n.join(`,`)}]`;for(let n of e)if(n.embedding)try{let e=await n.embedding({sql:t.sql,query:t.query,workspaceId:t.workspaceId,scopeFilter:t.scopeFilter,limit:r,qVec:a,filters:t.filters});i.push({name:`embeddings`,list:e})}catch(e){t.log?.(`embed ${n.name} skipped: ${e.message}`)}}let a=u(i,60);return{results:a.slice(0,t.limit).map(({row:e,score:t,rankers:n})=>({...e,score:t,rankers:n})),totalHits:a.length,embedderAvailable:!!n}}var p=e((()=>{d()})),m=e((()=>{p(),d()}));function h(e,t){if(e.length===0&&t.length===0)return 0;let n=new Set(t),r=0,i=new Set(e);for(let e of t)i.add(e);for(let t of new Set(e))n.has(t)&&r++;return i.size===0?0:r/i.size}async function g(e,t,n={}){let r=t.limit??5,i=`${t.title}\n${t.description}`,a=t.embedding&&t.embedding.length>0?async()=>t.embedding:n.embedder??null,{results:o}=await f([v],{sql:e,query:i,workspaceId:``,scopeFilter:null,limit:r+ +!!t.excludeId+5,mode:`hybrid`,embedder:a,log:n.log}),s=o.map(e=>e.source_id).filter(e=>e!==t.excludeId);if(s.length===0)return[];let c=await e`
    SELECT id, title, description, run_count, tools_used
      FROM harness_shared.code_recipes
     WHERE id = ANY(${s})
  `,l=new Map(c.map(e=>[e.id,e])),u=Math.max(...o.map(e=>e.score),1e-9),d=[];for(let e of o){if(e.source_id===t.excludeId)continue;let n=l.get(e.source_id);if(!n)continue;let r=((u>0?e.score/u:0)+h(t.toolsUsed,n.tools_used??[]))/2;d.push({id:n.id,title:n.title,description:n.description,runCount:typeof n.run_count==`number`?n.run_count:parseInt(n.run_count,10),toolsUsed:n.tools_used??[],similarity:r})}return d.sort((e,t)=>t.similarity-e.similarity),d.slice(0,r)}var _,v,y=e((()=>{m(),_=e=>e.slice(0,200)+(e.length>200?`…`:``),v={name:`code_recipes`,async bm25({sql:e,query:t,limit:n}){return(await e`
      SELECT id, title, description, run_count, tools_used,
             ts_rank_cd(title_tsv, plainto_tsquery('english', ${t})) AS rank
        FROM harness_shared.code_recipes
       WHERE status = 'active'
         AND title_tsv @@ plainto_tsquery('english', ${t})
    ORDER BY rank DESC LIMIT ${n}
    `).map(e=>({key:`code_recipes:${e.id}`,score:e.rank,row:{source:`code_recipes`,source_id:e.id,excerpt:_(`${e.title} — ${e.description}`),highlight:e.title,score:e.rank,rankers:[`bm25`]}}))},async embedding({sql:e,limit:t,qVec:n}){return(await e`
      SELECT id, title, description, run_count, tools_used,
             1 - (embedding <=> ${n}::vector) AS sim
        FROM harness_shared.code_recipes
       WHERE status = 'active'
         AND embedding IS NOT NULL
    ORDER BY embedding <=> ${n}::vector
       LIMIT ${t}
    `).map(e=>({key:`code_recipes:${e.id}`,score:e.sim,row:{source:`code_recipes`,source_id:e.id,excerpt:_(`${e.title} — ${e.description}`),highlight:e.title,score:e.sim,rankers:[`embeddings`]}}))}}}));function b(e){let t=new Set,n=new Set;for(let r of e)r&&(t.add(r),n.add(H(r)));return{names:t,slugs:n}}function x(e){return e<=0?0:V(Math.log1p(e)/Math.log1p(A))}function S(e){return V(e/j)}function C(e){return e<=1?0:V((e-1)/(M-1))}async function w(e,n,r={}){let i=n.minRunCount??L,a=n.limit??R,o=r.log??(()=>{}),s=await e`
      SELECT r.id, r.title, r.description, r.status, r.tools_used,
             r.run_count, r.success_count, r.last_run_at, r.promoted_tool, r.merged_into,
             COUNT(DISTINCT run.agent_owner) AS distinct_agents
        FROM harness_shared.code_recipes r
   LEFT JOIN harness_shared.code_recipe_runs run
          ON run.recipe_id = r.id
       WHERE r.status = 'active'
         AND r.run_count >= ${i}
    GROUP BY r.id`,{names:c,slugs:l}=b(t().map(e=>e.expose.mcp?.name)),u=[];for(let e of s){let t=z(e.run_count),n=z(e.success_count),i=z(e.distinct_agents),a=e.tools_used??[],s=a.length,d=t>0?V(n/t):0,f=!1,p=null;s<=1?(f=!0,p=`trivial: batches ≤1 distinct tool (not worth a tool over the primitive)`):(c.has(e.id)||l.has(e.id))&&(f=!0,p=`name_collision: recipe id "${e.id}" maps to an existing tool (D-007 — promoting would regenerate it)`);let m=x(t),h=S(i),g=d,_=C(s),v=T*m+E*h+D*g+O*_;if(r.toolCooccurrence)try{let e=await r.toolCooccurrence(a);e!=null&&(v=(T*m+E*h+D*g+O*_+k*V(e))/1.2)}catch(e){o(`recipeCandidates: tool-cooccurrence leg skipped (${e?.message??String(e)})`)}let y=f?0:V(v);u.push({id:e.id,title:e.title,description:e.description,status:e.status,runCount:t,distinctAgents:i,successRate:d,lastRunAt:B(e.last_run_at),toolsUsed:a,toolCount:s,promotionScore:y,redundant:f,redundancyReason:p})}let d=new Map(s.map(e=>[e.id,!!e.promoted_tool||!!e.merged_into])),f=u.filter(e=>!e.redundant&&!(d.get(e.id)??!1)&&e.promotionScore>=N&&(e.distinctAgents>=P||e.runCount>=F)).sort((e,t)=>t.promotionScore-e.promotionScore||e.id.localeCompare(t.id)).slice(0,a).map(e=>({id:e.id,title:e.title,description:e.description,runCount:e.runCount,distinctAgents:e.distinctAgents,successRate:e.successRate,toolsUsed:e.toolsUsed,promotionScore:e.promotionScore})),p=new Map;for(let e of u)p.set(e.id,new Set);for(let t of u){let n;try{n=await g(e,{title:t.title,description:t.description,toolsUsed:t.toolsUsed,embedding:null,excludeId:t.id,limit:10},{embedder:r.embedder??null,log:o})}catch(e){o(`recipeCandidates: merge-cluster search skipped for ${t.id} (${e?.message??String(e)})`);continue}for(let e of n)e.similarity<I||p.has(e.id)&&(p.get(t.id).add(e.id),p.get(e.id).add(t.id))}let m=[],h=new Set;for(let e of u.map(e=>e.id)){if(h.has(e))continue;let t=[],n=[e];for(h.add(e);n.length;){let e=n.shift();t.push(e);for(let t of p.get(e)??[])h.has(t)||(h.add(t),n.push(t))}t.length>=2&&(t.sort((e,t)=>e.localeCompare(t)),m.push({recipeIds:t,reason:`near-duplicate cluster (similarity ≥ ${I}) — review for merge into one recipe (D-015)`}))}return m.sort((e,t)=>e.recipeIds[0].localeCompare(t.recipeIds[0])),{promoteCandidates:f,mergeClusters:m,signals:u}}var T,E,D,O,k,A,j,M,N,P,F,I,L,R,z,B,V,H,U=e((()=>{n(),y(),T=.3,E=.3,D=.2,O=.2,k=.2,A=20,j=5,M=3,N=.45,P=2,F=3,I=.8,L=2,R=25,z=e=>typeof e==`number`?e:parseInt(e,10),B=e=>e==null?null:typeof e==`string`?e:e.toISOString(),V=e=>e<0?0:e>1?1:e,H=e=>e.toLowerCase().replace(/[^a-z0-9]+/g,`-`).replace(/^-+|-+$/g,``)}));async function W(e,t={}){let n=await i(e,t.sweep??{}),{promoteCandidates:r,mergeClusters:a}=await w(e,{},t.candidatesDeps??{});return{sweptIds:n.swept.map(e=>e.id),promoteCandidates:r.length,mergeClusters:a.length}}e((()=>{l(),U()}))();export{W as runRecipeHygieneOnce};