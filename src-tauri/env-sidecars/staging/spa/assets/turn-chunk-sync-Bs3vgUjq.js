import{n as T,o as C}from"./chunk-ChpBd9eV.js";import{n as m,t as A}from"./src-6Py4l2MU.js";import{st as N,t as S}from"./src-8fWtxfEz.js";import{t as $}from"./__vite-browser-external-56mrcCg8.js";function g(s,n={}){const e=n.size??1500,_=n.overlap??250,i=n.maxChunks??16;if(s.length===0)return[];const u=Math.max(1,e-_),t=[];for(let a=0;a<s.length&&(t.push(s.slice(a,a+e)),!(t.length>=i||a+e>=s.length));a+=u);return t}async function b(s,n={}){const e=n.batch??l,_=n.minChars??2e3,i={turns:0,chunks:0,errors:0,more:!1},u=await s.unsafe(`SELECT st.workspace_id, st.source_kind, st.session_id, st.turn_idx, st.text, s.sha
       FROM harness_shared.session_turns st
       CROSS JOIN LATERAL (
              SELECT encode(sha256(convert_to(st.text, 'UTF8')), 'hex') AS sha
            ) s
      WHERE length(st.text) > $1
        AND NOT EXISTS (
              SELECT 1 FROM harness_shared.session_turn_chunks c
               WHERE c.workspace_id = st.workspace_id
                 AND c.source_kind  = st.source_kind
                 AND c.session_id   = st.session_id
                 AND c.turn_idx     = st.turn_idx
                 AND c.turn_sha     = s.sha
            )
      ORDER BY st.ingested_at DESC
      LIMIT $2`,[_,e]);i.more=u.length>=e;for(const t of u)try{const a=g(t.text);if(await s.unsafe(`DELETE FROM harness_shared.session_turn_chunks
          WHERE workspace_id = $1 AND source_kind = $2 AND session_id = $3 AND turn_idx = $4`,[t.workspace_id,t.source_kind,t.session_id,t.turn_idx]),a.length>0){const c=[],E=a.map((p,h)=>{c.push(t.workspace_id,t.source_kind,t.session_id,t.turn_idx,h,p,t.sha);const o=h*7;return`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7})`}).join(", ");await s.unsafe(`INSERT INTO harness_shared.session_turn_chunks
             (workspace_id, source_kind, session_id, turn_idx, chunk_idx, content, turn_sha)
           VALUES ${E}
           ON CONFLICT (workspace_id, source_kind, session_id, turn_idx, chunk_idx)
           DO UPDATE SET content = EXCLUDED.content,
                         turn_sha = EXCLUDED.turn_sha,
                         updated_at = now(),
                         embedding = NULL,
                         embedding_mode = NULL`,c),i.chunks+=a.length}i.turns+=1}catch{i.errors+=1}return i}async function d(s){return(await s.unsafe(`SELECT 1 AS c FROM information_schema.tables
      WHERE table_schema = 'harness_shared' AND table_name = 'session_turn_chunks'`)).length>0}async function H(s){if(r.available)return!0;const n=Date.now();if(n-r.availableCheckedAt<k)return!1;r.availableCheckedAt=n;try{r.available=await d(s)}catch{r.available=!1}return r.available}async function F(s={}){if({}.VITEST)return{skipped:"vitest"};if(r.running)return{skipped:"already_running"};if(r.fails>=f)return{skipped:"too_many_failures"};r.running=!0;try{const{sql:n}=N();if(!await d(n))return{skipped:"migration_749_absent"};const e=await b(n,s);return e.turns>0&&console.log(`[turn-chunk-sync] ${e.turns} turns -> ${e.chunks} chunks${e.errors>0?`, ${e.errors} errors`:""}${e.more?" (more pending)":""}`),e}catch(n){return r.fails+=1,console.warn("[turn-chunk-sync] sync failed:",n.message),{skipped:"error"}}finally{r.running=!1}}var L,R,w,D,x,l,r,k,f,v=T((()=>{L=C($(),1),S(),A(),R=1500,w=250,D=2e3,x=16,l=200,r=m("@papercusp/operator-core.turnChunkSyncState",()=>({running:!1,fails:0,available:!1,availableCheckedAt:0})),k=6e4,f=5}));v();export{F as runTurnChunkSyncTick,H as turnChunksAvailable};
