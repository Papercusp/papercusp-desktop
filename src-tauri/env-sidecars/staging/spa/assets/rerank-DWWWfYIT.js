const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/turn-chunk-sync-Bs3vgUjq.js","assets/chunk-ChpBd9eV.js","assets/src-6Py4l2MU.js","assets/src-8fWtxfEz.js","assets/node-module-browser-DndEyzys.js","assets/postgres-browser-CFiHlG7w.js","assets/resource-profile-DqktAQ65.js","assets/__vite-browser-external-56mrcCg8.js","assets/drizzle-orm-BbO4Lkx2.js","assets/zod-CZhQjvAS.js","assets/core-DFQ1sEXS.js","assets/credentials-CA4Q9pxv.js","assets/credentials-DWp2_jOJ.js","assets/preload-helper-CcgcQsTF.js","assets/operator-state-pg-Cytj1dEs.js","assets/db-encryption-ByK3NqqK.js","assets/workspace-registry-Du2UbhlH.js","assets/workspace-als-CSW21ZcE.js","assets/workspace-id-constant-AQ2MH5pQ.js","assets/embed-sidecar-wiring-CAAUNADU.js","assets/embed-sidecar-wiring-CTaHe41d.js","assets/src-BeqmmfWq.js","assets/node-worker-threads-browser-DMPk1ZwH.js","assets/mem0-connection-Ckg3kzsr.js","assets/esm-CfaudpwD.js","assets/stream-CvREWUFS.js","assets/path-YGsBWY7o.js","assets/string_decoder-D2nt_fod.js","assets/buffer-lTPzJVVl.js","assets/base64-js-CETVHNCg.js","assets/src-BtmhE4e_.js","assets/embed-sidecar-spawn-DxEksuiY.js","assets/host-benign-errors-zOsoCEiW.js","assets/sidecar-spawn-shared-Mlc-LK-v.js","assets/src-BI6VjFFd.js","assets/src-DduH0PES.js","assets/types-DoRTXl1W.js","assets/server-Bn73gCi2.js","assets/server-BXcXKvn3.js","assets/src-Bi3zYzli.js"])))=>i.map(i=>d[i]);
import{n as E}from"./chunk-ChpBd9eV.js";import{n as x,t as h}from"./preload-helper-CcgcQsTF.js";import{t as b}from"./configure-search-defaults-D3lTztEG.js";function D(s){const e=$.get(s);if(e)return e;const n=(async()=>{try{return await s.begin(async i=>{await i`SET LOCAL hnsw.iterative_scan = relaxed_order`}),!0}catch{return!1}})();return $.set(s,n),n}async function _(s,e){return await D(s)?s.begin(async n=>(await n`SET TRANSACTION READ ONLY`,await n`SET LOCAL hnsw.iterative_scan = relaxed_order`,e(n))):e(s)}var $,f=E((()=>{$=new WeakMap}));function S(s,e,n){const i=s.sql,a=s.lexicalAnchorDfBudget??I,r=i`replace(plainto_tsquery('english', ${s.query})::text, ' & ', ' | ')`;return s.lexicalMode!=="coverage-graded"?{with:i`WITH q AS (SELECT plainto_tsquery('english', ${s.query}) AS andq)`,join:i`, q`,coverage:i`1`,rank:i`ts_rank_cd(${e}, q.andq)`,match:i`${e} @@ q.andq`,headlineQuery:i`q.andq`}:{with:i`
      WITH q AS (
        SELECT ${r}::tsquery       AS orq,
               string_to_array(${r}, ' | ') AS lexemes
      ), df AS (
        SELECT l, (SELECT count(*) FROM (
                     SELECT 1 FROM ${n} d
                      WHERE d.${e} @@ l::tsquery
                      LIMIT ${m}
                   ) capped) AS n
          FROM q, unnest(q.lexemes) AS l
      ), ranked AS (
        SELECT l, n,
               row_number() OVER (ORDER BY n ASC, l ASC) AS rn,
               COALESCE(sum(n) OVER (ORDER BY n ASC, l ASC
                                     ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS prior
          FROM df
      ), anchor AS (
        -- The rarest lexeme ALWAYS anchors (rn = 1), so this can never admit
        -- fewer rows than the pre-WI-9273 argmin; every additional lexeme is
        -- taken in ascending-df order while the cumulative df stays inside the
        -- budget. A SATURATED lexeme (n = DF_PROBE_CAP) is excluded unless it is
        -- the argmin: its true df is unknown and may be 10× the cap, so
        -- anchoring on it would make the budget a fiction.
        SELECT string_agg(l, ' | ' ORDER BY n ASC, l ASC)::tsquery AS a
          FROM ranked
         WHERE rn = 1
            OR (n < ${m} AND prior + n <= ${a})
      )`,join:i`, q, anchor`,coverage:i`(SELECT count(*) FROM unnest(q.lexemes) AS cl WHERE ${e} @@ cl::tsquery)`,rank:i`ts_rank_cd(${e}, q.orq)`,match:i`${e} @@ anchor.a`,headlineQuery:i`q.orq`}}var c,l,m,I,A,R,p,L,O,g,N,y,C,K=E((()=>{b(),f(),x(),c='StartSel=<mark>, StopSel=</mark>, MaxFragments=2, FragmentDelimiter=" … ", MaxWords=18, MinWords=5, ShortWord=2',l=s=>s.slice(0,200)+(s.length>200?"…":""),m=2e3,I=0,A={name:"escalations",async lexical({sql:s,query:e,workspaceId:n,scopeFilter:i,limit:a}){return(await s`
      SELECT harness_slug, phase, escalation, supervisor_notes,
             ts_rank_cd(body_tsv, plainto_tsquery('english', ${e})) AS rank,
             ts_headline('english',
               COALESCE(escalation, '') || E'\n' || COALESCE(supervisor_notes, ''),
               plainto_tsquery('english', ${e}),
               ${c}
             ) AS highlight
        FROM harness_shared.harness_escalations
       WHERE workspace_id = ${n}
         AND (${i}::text IS NULL OR harness_slug = ${i})
         AND body_tsv @@ plainto_tsquery('english', ${e})
    ORDER BY rank DESC LIMIT ${a}
    `).map(r=>{const t=`${r.escalation??""}
${r.supervisor_notes??""}`.trim();return{key:`escalations:${r.harness_slug}:${r.phase}`,score:r.rank,row:{source:"escalations",source_id:`${r.harness_slug}:${r.phase}`,scope:r.harness_slug,excerpt:l(t),highlight:r.highlight,score:r.rank,rankers:["lexical"]}}})},async embedding({sql:s,query:e,workspaceId:n,scopeFilter:i,limit:a,qVec:r}){return(await _(s,t=>t`
      SELECT harness_slug, phase, escalation, supervisor_notes,
             1 - (body_embedding <=> ${r}::vector) AS sim,
             ts_headline('english',
               COALESCE(escalation, '') || E'\n' || COALESCE(supervisor_notes, ''),
               plainto_tsquery('english', ${e}),
               ${c}) AS highlight
        FROM harness_shared.harness_escalations
       WHERE workspace_id = ${n}
         AND (${i}::text IS NULL OR harness_slug = ${i})
         AND body_embedding IS NOT NULL
    ORDER BY body_embedding <=> ${r}::vector
       LIMIT ${a}
    `)).map(t=>{const o=`${t.escalation??""}
${t.supervisor_notes??""}`.trim();return{key:`escalations:${t.harness_slug}:${t.phase}`,score:t.sim,row:{source:"escalations",source_id:`${t.harness_slug}:${t.phase}`,scope:t.harness_slug,excerpt:l(o),highlight:t.highlight,score:t.sim,rankers:["embeddings"]}}})}},R={name:"brainstorm",async lexical({sql:s,query:e,workspaceId:n,scopeFilter:i,limit:a}){return(await s`
      SELECT harness_slug, phase, content,
             ts_rank_cd(content_tsv, plainto_tsquery('english', ${e})) AS rank,
             ts_headline('english', content,
               plainto_tsquery('english', ${e}),
               ${c}) AS highlight
        FROM harness_shared.harness_brainstorm
       WHERE workspace_id = ${n}
         AND (${i}::text IS NULL OR harness_slug = ${i})
         AND content_tsv @@ plainto_tsquery('english', ${e})
    ORDER BY rank DESC LIMIT ${a}
    `).map(r=>({key:`brainstorm:${r.harness_slug}:${r.phase}`,score:r.rank,row:{source:"brainstorm",source_id:`${r.harness_slug}:${r.phase}`,scope:r.harness_slug,excerpt:l(r.content),highlight:r.highlight,score:r.rank,rankers:["lexical"]}}))},async embedding({sql:s,query:e,workspaceId:n,scopeFilter:i,limit:a,qVec:r}){return(await _(s,t=>t`
      SELECT harness_slug, phase, content,
             1 - (content_embedding <=> ${r}::vector) AS sim,
             ts_headline('english', content,
               plainto_tsquery('english', ${e}),
               ${c}) AS highlight
        FROM harness_shared.harness_brainstorm
       WHERE workspace_id = ${n}
         AND (${i}::text IS NULL OR harness_slug = ${i})
         AND content_embedding IS NOT NULL
    ORDER BY content_embedding <=> ${r}::vector
       LIMIT ${a}
    `)).map(t=>({key:`brainstorm:${t.harness_slug}:${t.phase}`,score:t.sim,row:{source:"brainstorm",source_id:`${t.harness_slug}:${t.phase}`,scope:t.harness_slug,excerpt:l(t.content),highlight:t.highlight,score:t.sim,rankers:["embeddings"]}}))}},p={name:"turns",async lexical({sql:s,query:e,workspaceId:n,limit:i}){return(await s`
      SELECT t.id, t.role, t.text,
             ts_rank_cd(t.text_tsv, plainto_tsquery('english', ${e})) AS rank,
             ts_headline('english', t.text,
               plainto_tsquery('english', ${e}),
               ${c}) AS highlight
        FROM harness_shared.operator_turns t
        JOIN harness_shared.operator_conversations c ON c.id = t.conversation_id
       WHERE c.workspace_id = ${n}
         AND t.text_tsv @@ plainto_tsquery('english', ${e})
    ORDER BY rank DESC LIMIT ${i}
    `).map(a=>({key:`turns:${a.id}`,score:a.rank,row:{source:"turns",source_id:a.id,excerpt:`[${a.role}] ${l(a.text)}`,highlight:`[${a.role}] ${a.highlight}`,score:a.rank,rankers:["lexical"]}}))},async embedding({sql:s,query:e,workspaceId:n,limit:i,qVec:a}){return(await _(s,r=>r`
      SELECT t.id, t.role, t.text,
             1 - (t.text_embedding <=> ${a}::vector) AS sim,
             ts_headline('english', t.text,
               plainto_tsquery('english', ${e}),
               ${c}) AS highlight
        FROM harness_shared.operator_turns t
        JOIN harness_shared.operator_conversations c ON c.id = t.conversation_id
       WHERE c.workspace_id = ${n}
         AND t.text_embedding IS NOT NULL
    ORDER BY t.text_embedding <=> ${a}::vector
       LIMIT ${i}
    `)).map(r=>({key:`turns:${r.id}`,score:r.sim,row:{source:"turns",source_id:r.id,excerpt:`[${r.role}] ${l(r.text)}`,highlight:`[${r.role}] ${r.highlight}`,score:r.sim,rankers:["embeddings"]}}))}},L={name:"decisions",async lexical({sql:s,query:e,workspaceId:n,scopeFilter:i,limit:a}){return(await s`
      SELECT harness_slug, line_hash, verb, args, iso,
             ts_rank_cd(body_tsv, plainto_tsquery('english', ${e})) AS rank,
             ts_headline('english',
               coalesce(verb, '') || ' ' || coalesce(args, ''),
               plainto_tsquery('english', ${e}),
               ${c}) AS highlight
        FROM harness_shared.harness_decisions
       WHERE workspace_id = ${n}
         AND (${i}::text IS NULL OR harness_slug = ${i})
         AND body_tsv @@ plainto_tsquery('english', ${e})
    ORDER BY rank DESC LIMIT ${a}
    `).map(r=>{const t=`${r.verb} ${r.args}`.trim();return{key:`decisions:${r.harness_slug}:${r.line_hash}`,score:r.rank,row:{source:"decisions",source_id:`${r.harness_slug}:${r.line_hash}`,scope:r.harness_slug,excerpt:`[${r.iso}] ${l(t)}`,highlight:r.highlight,score:r.rank,rankers:["lexical"]}}})},async embedding({sql:s,query:e,workspaceId:n,scopeFilter:i,limit:a,qVec:r}){return(await _(s,t=>t`
      SELECT harness_slug, line_hash, verb, args, iso,
             1 - (body_embedding <=> ${r}::vector) AS sim,
             ts_headline('english',
               coalesce(verb, '') || ' ' || coalesce(args, ''),
               plainto_tsquery('english', ${e}),
               ${c}) AS highlight
        FROM harness_shared.harness_decisions
       WHERE workspace_id = ${n}
         AND (${i}::text IS NULL OR harness_slug = ${i})
         AND body_embedding IS NOT NULL
    ORDER BY body_embedding <=> ${r}::vector
       LIMIT ${a}
    `)).map(t=>{const o=`${t.verb} ${t.args}`.trim();return{key:`decisions:${t.harness_slug}:${t.line_hash}`,score:t.sim,row:{source:"decisions",source_id:`${t.harness_slug}:${t.line_hash}`,scope:t.harness_slug,excerpt:`[${t.iso}] ${l(o)}`,highlight:t.highlight,score:t.sim,rankers:["embeddings"]}}})}},O={name:"work_item",async lexical(s){const{sql:e,workspaceId:n,scopeFilter:i,limit:a}=s,r=S(s,e`_search`,e`harness_shared.engineer_issues`);return(await e`
      ${r.with}
      SELECT issue_id, scope, title, body, kind, state, severity,
             coalesce(updated_at, created_at) AS updated_at,
             ${r.coverage} AS coverage,
             ${r.rank} AS rank,
             ts_headline('english', coalesce(title, '') || E'\n' || coalesce(body, ''),
               ${r.headlineQuery},
               ${c}) AS highlight
        FROM harness_shared.engineer_issues ${r.join}
       WHERE workspace_id = ${n}
         -- the scope column stores 'operator' | 'harness:<slug>' — a bare harness_slug
         -- filter (as the other sources take it) maps to the 'harness:<slug>' form.
         AND (${i}::text IS NULL OR scope = 'harness:' || ${i}::text)
         AND ${r.match}
    ORDER BY coverage DESC, rank DESC LIMIT ${a}
    `).map(t=>{const o=`${t.title}
${t.body}`.trim();return{key:`work_item:${t.issue_id}`,score:t.rank,row:{source:"work_item",source_id:t.issue_id,scope:t.scope,excerpt:`[${t.kind}/${t.state}/${t.severity}] ${l(o)}`,highlight:t.highlight,score:t.rank,ts:t.updated_at,rankers:["lexical"]}}})},async embedding({sql:s,query:e,workspaceId:n,scopeFilter:i,limit:a,qVec:r}){return(await _(s,t=>t`
      SELECT issue_id, scope, title, body, kind, state, severity,
             coalesce(updated_at, created_at) AS updated_at,
             1 - (embedding <=> ${r}::vector) AS sim,
             ts_headline('english', coalesce(title, '') || E'\n' || coalesce(body, ''),
               plainto_tsquery('english', ${e}),
               ${c}) AS highlight
        FROM harness_shared.engineer_issues
       WHERE workspace_id = ${n}
         -- same scope semantics as the lexical leg: the column stores
         -- 'operator' | 'harness:<slug>', so a bare slug maps to the latter.
         AND (${i}::text IS NULL OR scope = 'harness:' || ${i}::text)
         AND embedding IS NOT NULL
    ORDER BY embedding <=> ${r}::vector
       LIMIT ${a}
    `)).map(t=>{const o=`${t.title}
${t.body}`.trim();return{key:`work_item:${t.issue_id}`,score:t.sim,row:{source:"work_item",source_id:t.issue_id,scope:t.scope,excerpt:`[${t.kind}/${t.state}/${t.severity}] ${l(o)}`,highlight:t.highlight,score:t.sim,ts:t.updated_at,rankers:["embeddings"]}}})}},g=s=>{const e=s.filters??{};return{owners:e.owners&&e.owners.length?e.owners:null,speaker:e.speaker??null,sessionId:e.sessionId??null,sourceKind:e.sourceKind??null,since:e.since??null,until:e.until??null}},N={name:"session_turn",async lexical(s){const e=g(s),n=S(s,s.sql`text_tsv`,s.sql`harness_shared.session_turns`);return(await s.sql`
      ${n.with}
      SELECT source_kind, session_id, turn_idx, speaker, owner, harness_slug, ts, text,
             ${n.coverage} AS coverage,
             ${n.rank} AS rank,
             ${s.wantHighlight===!1?s.sql`''`:s.sql`ts_headline('english', left(text, 4000),
                   ${n.headlineQuery},
                   ${c})`} AS highlight
        FROM harness_shared.session_turns ${n.join}
       WHERE (workspace_id = ${s.workspaceId} OR workspace_id = 'default')
         AND (${s.scopeFilter}::text IS NULL OR harness_slug = ${s.scopeFilter})
         AND (${e.owners}::text[] IS NULL OR owner = ANY(${e.owners}::text[]))
         AND (${e.speaker}::text IS NULL OR speaker = ${e.speaker})
         AND (${e.sessionId}::text IS NULL OR session_id = ${e.sessionId})
         AND (${e.sourceKind}::text IS NULL OR source_kind = ${e.sourceKind})
         AND (${e.since}::timestamptz IS NULL OR COALESCE(ts, ingested_at) >= ${e.since}::timestamptz)
         AND (${e.until}::timestamptz IS NULL OR COALESCE(ts, ingested_at) < ${e.until}::timestamptz)
         AND ${n.match}
    ORDER BY coverage DESC, rank DESC LIMIT ${s.limit}
    `).map(i=>({key:`session_turn:${i.source_kind}:${i.session_id}:${i.turn_idx}`,score:i.rank,row:{source:"session_turn",source_id:`${i.source_kind}:${i.session_id}:${i.turn_idx}`,...i.harness_slug?{scope:i.harness_slug}:{},excerpt:`[${i.speaker}${i.owner?` ${i.owner}`:""}${i.ts?` ${i.ts}`:""}] ${l(i.text)}`,highlight:i.highlight,score:i.rank,ts:i.ts,rankers:["lexical"]}}))},async embedding(s){const e=g(s),{turnChunksAvailable:n}=await h(async()=>{const{turnChunksAvailable:a}=await import("./turn-chunk-sync-Bs3vgUjq.js");return{turnChunksAvailable:a}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10])),i=await n(s.sql);return(await _(s.sql,a=>a`
      WITH scored AS (
        -- ⚠ EACH BRANCH IS PARENTHESIZED ON PURPOSE. Without the parens the
        -- trailing ORDER BY / LIMIT binds to the WHOLE union rather than to its
        -- branch, which silently turns two independent top-K probes into one —
        -- and the chunk leg would then be able to starve the parent leg out of
        -- the result entirely. Verified against live PG 2026-08-03.
        (SELECT workspace_id, source_kind, session_id, turn_idx,
               1 - (text_embedding <=> ${s.qVec}::vector) AS sim
          FROM harness_shared.session_turns
         WHERE (workspace_id = ${s.workspaceId} OR workspace_id = 'default')
           AND (${s.scopeFilter}::text IS NULL OR harness_slug = ${s.scopeFilter})
           AND (${e.owners}::text[] IS NULL OR owner = ANY(${e.owners}::text[]))
           AND (${e.speaker}::text IS NULL OR speaker = ${e.speaker})
           AND (${e.sessionId}::text IS NULL OR session_id = ${e.sessionId})
           AND (${e.sourceKind}::text IS NULL OR source_kind = ${e.sourceKind})
           AND (${e.since}::timestamptz IS NULL OR COALESCE(ts, ingested_at) >= ${e.since}::timestamptz)
           AND (${e.until}::timestamptz IS NULL OR COALESCE(ts, ingested_at) < ${e.until}::timestamptz)
           AND text_embedding IS NOT NULL
      ORDER BY text_embedding <=> ${s.qVec}::vector
         LIMIT ${s.limit})
        ${i?s.sql`
        UNION ALL
        (SELECT c.workspace_id, c.source_kind, c.session_id, c.turn_idx,
               1 - (c.embedding <=> ${s.qVec}::vector) AS sim
          FROM harness_shared.session_turn_chunks c
          JOIN harness_shared.session_turns st
            ON st.workspace_id = c.workspace_id
           AND st.source_kind  = c.source_kind
           AND st.session_id   = c.session_id
           AND st.turn_idx     = c.turn_idx
         WHERE (st.workspace_id = ${s.workspaceId} OR st.workspace_id = 'default')
           AND (${s.scopeFilter}::text IS NULL OR st.harness_slug = ${s.scopeFilter})
           AND (${e.owners}::text[] IS NULL OR st.owner = ANY(${e.owners}::text[]))
           AND (${e.speaker}::text IS NULL OR st.speaker = ${e.speaker})
           AND (${e.sessionId}::text IS NULL OR st.session_id = ${e.sessionId})
           AND (${e.sourceKind}::text IS NULL OR st.source_kind = ${e.sourceKind})
           AND (${e.since}::timestamptz IS NULL OR COALESCE(st.ts, st.ingested_at) >= ${e.since}::timestamptz)
           AND (${e.until}::timestamptz IS NULL OR COALESCE(st.ts, st.ingested_at) < ${e.until}::timestamptz)
           AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${s.qVec}::vector
         LIMIT ${s.limit})`:s.sql``}
      ),
      best AS (
        SELECT DISTINCT ON (workspace_id, source_kind, session_id, turn_idx)
               workspace_id, source_kind, session_id, turn_idx, sim
          FROM scored
      ORDER BY workspace_id, source_kind, session_id, turn_idx, sim DESC
      )
      SELECT st.source_kind, st.session_id, st.turn_idx, st.speaker, st.owner,
             st.harness_slug, st.ts, st.text, b.sim,
             ${s.wantHighlight===!1?s.sql`''`:s.sql`ts_headline('english', left(st.text, 4000),
                   plainto_tsquery('english', ${s.query}),
                   ${c})`} AS highlight
        FROM best b
        JOIN harness_shared.session_turns st
          ON st.workspace_id = b.workspace_id
         AND st.source_kind  = b.source_kind
         AND st.session_id   = b.session_id
         AND st.turn_idx     = b.turn_idx
    ORDER BY b.sim DESC
       LIMIT ${s.limit}
    `)).map(a=>({key:`session_turn:${a.source_kind}:${a.session_id}:${a.turn_idx}`,score:a.sim,row:{source:"session_turn",source_id:`${a.source_kind}:${a.session_id}:${a.turn_idx}`,...a.harness_slug?{scope:a.harness_slug}:{},excerpt:`[${a.speaker}${a.owner?` ${a.owner}`:""}${a.ts?` ${a.ts}`:""}] ${l(a.text)}`,highlight:a.highlight,score:a.sim,ts:a.ts,rankers:["embeddings"]}}))},async hydrateHighlights(s,e){const n=[],i=[],a=[];for(const t of e){const o=t.indexOf(":"),d=t.lastIndexOf(":");if(o<0||d<=o)continue;const k=Number(t.slice(d+1));Number.isInteger(k)&&(n.push(t.slice(0,o)),i.push(t.slice(o+1,d)),a.push(k))}if(n.length===0)return new Map;const r=await s.sql`
      SELECT st.source_kind, st.session_id, st.turn_idx,
             ts_headline('english', left(st.text, 4000),
               plainto_tsquery('english', ${s.query}),
               ${c}) AS highlight
        FROM harness_shared.session_turns st
        JOIN unnest(${n}::text[], ${i}::text[], ${a}::int[]) AS t(k, s, i)
          ON st.source_kind = t.k AND st.session_id = t.s AND st.turn_idx = t.i
    `;return new Map(r.map(t=>[`${t.source_kind}:${t.session_id}:${t.turn_idx}`,t.highlight]))}},y={name:"coord_message",async lexical(s){const e=g(s);return(await s.sql`
      SELECT msg_id, ts, harness_slug,
             body->>'from' AS from_owner,
             body->>'kind' AS kind,
             left(coalesce(body->>'summary','') || ' ' || coalesce(body->>'body',''), 4000) AS msgtext,
             ts_rank_cd(
               to_tsvector('english', left(coalesce(body->>'summary','') || ' ' || coalesce(body->>'body',''), 20000)),
               plainto_tsquery('english', ${s.query})) AS rank,
             ts_headline('english',
               left(coalesce(body->>'summary','') || ' ' || coalesce(body->>'body',''), 4000),
               plainto_tsquery('english', ${s.query}),
               ${c}) AS highlight
        FROM harness_shared.coord_event_log
       WHERE surface = 'messages'
         AND (workspace_id = ${s.workspaceId} OR workspace_id = 'default')
         AND (${s.scopeFilter}::text IS NULL OR harness_slug = ${s.scopeFilter})
         AND (${e.owners}::text[] IS NULL OR body->>'from' = ANY(${e.owners}::text[]))
         AND (${e.since}::timestamptz IS NULL OR ts >= ${e.since}::timestamptz)
         AND (${e.until}::timestamptz IS NULL OR ts < ${e.until}::timestamptz)
         AND to_tsvector('english', left(coalesce(body->>'summary','') || ' ' || coalesce(body->>'body',''), 20000))
             @@ plainto_tsquery('english', ${s.query})
    ORDER BY rank DESC LIMIT ${s.limit}
    `).map(n=>({key:`coord_message:${n.msg_id}`,score:n.rank,row:{source:"coord_message",source_id:n.msg_id,...n.harness_slug?{scope:n.harness_slug}:{},excerpt:`[${n.kind??"message"}${n.from_owner?` from ${n.from_owner}`:""} ${n.ts}] ${l(n.msgtext)}`,highlight:n.highlight,score:n.rank,rankers:["lexical"]}}))}},C=[A,R,p,L,O,N,y]}));function V(s){return Math.max(s,Math.min(s*4,24))}function T(s){const e=(s.highlight??"").replace(/<\/?mark>/g,"").trim(),n=(s.excerpt??"").trim();return e?!n||e.includes(n)||n.includes(e)?e:`${e} … ${n}`:n}async function v(){try{const{readCredentials:s}=await h(async()=>{const{readCredentials:n}=await import("./credentials-CA4Q9pxv.js");return{readCredentials:n}},__vite__mapDeps([11,12,1,13,14,2,3,4,5,6,7,8,9,10,15,16,17,18])),e=await s();if(e.zeroentropy_api_key)return e.zeroentropy_api_key}catch{}return{}.ZEROENTROPY_API_KEY||void 0}function q(){return u||(u=h(()=>import("./embed-sidecar-wiring-CAAUNADU.js").then(s=>s.buildSidecarAwareReranker()),__vite__mapDeps([19,20,1,21,13,22,23,2,24,25,26,27,28,29,7,30,31,32,33])).catch(s=>{throw u=null,s})),u}async function M(){try{const[{FLAGS:s},{getFlag:e}]=await Promise.all([h(()=>import("./src-BI6VjFFd.js"),__vite__mapDeps([34,35,1,36])),h(()=>import("./server-Bn73gCi2.js"),__vite__mapDeps([37,38,1,36,2]))]);return await e(s.LOCAL_RERANK,"system:search-rerank")}catch{return!0}}async function U(){const s=await v();return s?{engine:"zeroentropy",apiKey:s}:await M()?{engine:"local",scorer:await q()}:null}async function F(s,e,n){if(e.length<=1)return n.onOutcome?.({attempted:!1,reason:"nothing-to-reorder"}),e.slice(0,n.limit);try{const i=await U();if(!i)return n.onOutcome?.({attempted:!1,reason:"no-engine"}),e.slice(0,n.limit);const{rankWithReranker:a}=await h(async()=>{const{rankWithReranker:d}=await import("./src-Bi3zYzli.js");return{rankWithReranker:d}},__vite__mapDeps([39,1,30,22,7])),r={info:null},t=await a(s,e.map(d=>({id:n.id(d),text:n.text(d),row:d})),{limit:n.limit,rerankTimeoutMs:n.rerankTimeoutMs,...i.engine==="zeroentropy"?{rerankApiKey:i.apiKey}:{engine:"local",scorer:i.scorer},...n.qualityScore?{qualityScore:n.qualityScore}:{},onRerankStage:d=>{r.info=d},...n.onScores?{onRerankScores:n.onScores}:{}}),o=r.info===null?null:r.info.scored;return o===0?(n.onOutcome?.({attempted:!1,reason:`degraded:${r.info?.degradeReason??"no-rows-scored"}`,engine:i.engine,scored:0}),t):(n.onOutcome?.({attempted:!0,reason:i.engine,engine:i.engine,...o===null?{}:{scored:o}}),t)}catch(i){return n.onOutcome?.({attempted:!1,reason:`threw:${i instanceof Error?i.name:"unknown"}`}),e.slice(0,n.limit)}}async function w(s,e,n,i){const a=new Map,r=await F(s,e,{limit:n,id:t=>`${t.source}:${t.source_id}`,text:T,qualityScore:t=>t.score,rerankTimeoutMs:i?.rerankTimeoutMs??4e3,...i?.onOutcome?{onOutcome:i.onOutcome}:{},onScores:t=>{for(const o of t)a.set(o.row,o.score)}});return a.size===0?r:r.map(t=>{const o=a.get(t);return typeof o=="number"?{...t,rerankScore:o}:t})}async function G(s,e,n){return e.length<=24?w(s,e,n):[...await w(s,e.slice(0,24),24),...e.slice(24)].slice(0,n)}var H,W,B,u,J=E((()=>{x(),H=4,W=24,B=4e3,u=null}));export{C as a,F as i,V as n,K as o,G as r,J as t};
