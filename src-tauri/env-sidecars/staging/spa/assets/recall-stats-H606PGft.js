import{n as O}from"./chunk-ChpBd9eV.js";import{s as A}from"./types-DoRTXl1W.js";import{t as y}from"./src-DduH0PES.js";import{l as T,o as L}from"./server-BXcXKvn3.js";import{a as b,d as H,u as I}from"./turn-provenance-_sDze2pp.js";import{n as W,t as F}from"./secret-detect-BbUBcDca.js";function w(r){const e=I(r);return{chars:r.length,sha256:H(e?e.payload:r),origin:e?.origin??null}}function C(r){let e=0;for(const s of r)typeof s.metadata?.entityType=="string"&&(e+=1);return e}function N(r){return r.map(e=>e.score).filter(e=>typeof e=="number"&&Number.isFinite(e))}function k(r,e){const s=[];for(const o of r){const t=o.retrieval?.cosineScore;if(typeof t=="number"&&Number.isFinite(t)){s.push(t);continue}e==="cosine"&&typeof o.score=="number"&&Number.isFinite(o.score)&&s.push(o.score)}return s}function U(r){const e={};for(const[s,o]of Object.entries(r)){const t=N(o.entries);e[s]={hits:o.entries.length,top:t.length>0?Math.max(...t):null,limit:o.limit,scopes:o.scopes.slice(0,16).map(String)}}return e}async function D(r,e,s){try{const o=s.trim();if(!o)return;let t;try{t=await L(A.MEMORY_RECALL_QUERY_TEXT,"system:memory-recall-stats")}catch{return}if(!t||F(o).matched)return;await r`
      INSERT INTO harness_shared.memory_recall_query_text (stats_id, query_text)
      VALUES (${e}, ${o.slice(0,h)})
      ON CONFLICT (stats_id) DO NOTHING
    `}catch{}}async function z(r,e){try{const s=e.pools?Object.values(e.pools).flatMap(d=>[...d.entries]):e.entries,o=N(s),t=o.length>0?Math.max(...o):null,a=e.pools?JSON.stringify(U(e.pools)):null,n=e.legs?JSON.stringify(e.legs):null,i=e.admission?JSON.stringify(e.admission):null,c=typeof e.query=="string"?w(e.query):null,l=k(s,e.scoreScale),S=l.length>0?Math.max(...l):null,u=(await r`
      INSERT INTO harness_shared.memory_recall_stats
        (surface, hit_count, top_score, scores, fragment_count, pools, workspace_id, pot_slug, score_scale,
         query_chars, query_sha256, query_origin, session_id, legs, admission, client,
         top_cosine_score, cosine_scores)
      VALUES (
        ${e.surface},
        ${s.length},
        ${t},
        ${JSON.stringify(o)}::text::jsonb,
        ${C(s)},
        ${a}::text::jsonb,
        ${e.workspaceId??null},
        ${e.potSlug??null},
        ${e.scoreScale??null},
        ${c?c.chars:null},
        ${c?c.sha256:null},
        ${c?c.origin:null},
        ${e.sessionId??null},
        ${n}::text::jsonb,
        ${i}::text::jsonb,
        ${e.client??null},
        ${S},
        ${l.length>0?JSON.stringify(l):null}::text::jsonb
      )
      RETURNING id
    `)?.[0]?.id;u!==void 0&&typeof e.query=="string"&&await D(r,u,e.query)}catch(s){_+=1;const o=Date.now();if(o-m>=f){const t=_-1;console.warn(`[memory-recall-stats] capture failed (surface='${e.surface}')`+(t>0?` — +${t} more since last warn`:"")+`; re-warns at most once/${f/6e4}min:`,s.message),m=o,_=0}}}function R(r){const e={};for(const o of r)e[String(o.scale)]=Number(o.scored??0);const s=r.filter(o=>String(o.scale)!=="unknown"&&Number(o.scored??0)>0).sort((o,t)=>Number(t.scored??0)-Number(o.scored??0))[0];return{topScoreP50:s?.p50==null?null:Number(s.p50),topScoreP90:s?.p90==null?null:Number(s.p90),topScoreScale:s?String(s.scale):null,topScoreSamples:s?Number(s.scored??0):0,scaleMix:e}}async function Q(r){const e=(await r`
    WITH scoped AS (
      SELECT hit_count, fragment_count, top_score,
             CASE
               WHEN score_scale IS NOT NULL THEN score_scale
               WHEN top_score IS NULL THEN 'unknown'
               WHEN top_score <= ${.03278688524590164} THEN 'rrf'
               WHEN top_score >= ${.45} THEN 'cosine'
               ELSE 'unknown'
             END AS scale
        FROM harness_shared.memory_recall_stats
       WHERE created_at >= now() - interval '7 days'
    ),
    per_scale AS (
      SELECT scale,
             count(*)::int AS scored,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY top_score) AS p50,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY top_score) AS p90
        FROM scoped WHERE top_score IS NOT NULL GROUP BY scale
    )
    SELECT
      (SELECT count(*) FROM scoped)::int                            AS recalls,
      (SELECT count(*) FROM scoped WHERE hit_count = 0)::int        AS zero_hits,
      (SELECT coalesce(sum(fragment_count), 0) FROM scoped)::int    AS fragment_hits,
      (SELECT coalesce(jsonb_agg(to_jsonb(per_scale)), '[]'::jsonb) FROM per_scale) AS per_scale
  `)[0]??{},s=Number(e.recalls??0),o=Number(e.zero_hits??0);return{recalls7d:s,zeroHit7d:o,zeroHitRate7d:s>0?o/s:0,...R(Array.isArray(e.per_scale)?e.per_scale:[]),fragmentHits7d:Number(e.fragment_hits??0)}}async function J(r,e={}){const s=Number.isFinite(e.hours)&&e.hours>0?e.hours:(Number.isFinite(e.days)&&e.days>0?Math.floor(e.days):7)*24,o=e.surface??null;return(await r`
    WITH exploded AS (
      SELECT
        s.surface,
        p.key                                   AS pool,
        (p.value ->> 'hits')::int               AS hits,
        (p.value ->> 'limit')::int              AS budget,
        (p.value ->> 'top')::double precision   AS top,
        -- Every pool top came from the same backend call as the row's
        -- top_score, so the row-level scale governs them all (P-036).
        CASE
          WHEN s.score_scale IS NOT NULL THEN s.score_scale
          WHEN s.top_score IS NULL THEN 'unknown'
          WHEN s.top_score <= ${E} THEN 'rrf'
          WHEN s.top_score >= ${p} THEN 'cosine'
          ELSE 'unknown'
        END                                     AS scale,
        p.value -> 'scopes'                     AS scopes,
        -- D-035 / gate-3: was this pool asked under NO scope at all? Counted
        -- per ROW here because the scope_keys aggregate below cannot express
        -- it — see RecallPoolHealth.emptyScope. A missing scopes key and an
        -- explicit [] are the same condition (asked for nothing), so coalesce
        -- rather than letting NULL fall out of the count.
        jsonb_array_length(coalesce(p.value -> 'scopes', '[]'::jsonb)) = 0
                                                AS empty_scope
      FROM harness_shared.memory_recall_stats s
      CROSS JOIN LATERAL jsonb_each(s.pools) AS p(key, value)
      WHERE s.pools IS NOT NULL
        AND s.created_at >= now() - make_interval(hours => ${s}::int)
        AND (${o}::text IS NULL OR s.surface = ${o}::text)
    )
    SELECT
      surface,
      pool,
      scale,
      count(*)::int                                          AS recalls,
      count(*) FILTER (WHERE hits = 0)::int                  AS zero_hits,
      count(*) FILTER (WHERE budget > 0 AND hits >= budget)::int AS saturated,
      count(*) FILTER (WHERE empty_scope)::int                AS empty_scope,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY hits)      AS hits_p50,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY top)
        FILTER (WHERE top IS NOT NULL)                       AS top_p50,
      coalesce(
        jsonb_agg(DISTINCT sc.scope) FILTER (WHERE sc.scope IS NOT NULL),
        '[]'::jsonb
      )                                                      AS scope_keys
    FROM exploded
    LEFT JOIN LATERAL jsonb_array_elements_text(scopes) AS sc(scope) ON true
    GROUP BY surface, pool, scale
    ORDER BY count(*) DESC
  `).map(t=>{const a=Number(t.recalls??0),n=Number(t.zero_hits??0),i=Number(t.saturated??0),c=Number(t.empty_scope??0);return{surface:String(t.surface??"unknown"),pool:String(t.pool??"unknown"),scoreScale:t.scale?String(t.scale):"unknown",recalls:a,zeroHit:n,zeroHitRate:a>0?n/a:0,saturated:i,saturationRate:a>0?i/a:0,hitsP50:t.hits_p50==null?null:Number(t.hits_p50),topScoreP50:t.top_p50==null?null:Number(t.top_p50),scopes:Array.isArray(t.scope_keys)?t.scope_keys.map(String):[],emptyScope:c,emptyScopeRate:a>0?c/a:0}})}async function V(r,e={}){return(await r`
    WITH labelled AS (
      SELECT surface,
             score_scale,
             top_score,
             -- rrf is bounded ABOVE by (1+lexWeight)/(k+1); cosine is floored
             -- BELOW on admission. A value on the wrong side of its own
             -- label's bound is arithmetically impossible for that scale.
             CASE
               WHEN score_scale = 'rrf'    AND top_score > ${E}      THEN true
               WHEN score_scale = 'cosine' AND top_score < ${p} THEN true
               ELSE false
             END AS contradicts
        FROM harness_shared.memory_recall_stats
       WHERE created_at >= now() - make_interval(days => ${Number.isFinite(e.days)&&e.days>0?Math.floor(e.days):7}::int)
         AND score_scale IN ('rrf', 'cosine')
         AND top_score IS NOT NULL
    )
    SELECT surface,
           score_scale,
           count(*)::int                                    AS rows_n,
           count(*) FILTER (WHERE contradicts)::int         AS contradicting,
           min(top_score) FILTER (WHERE contradicts)        AS min_offending,
           max(top_score) FILTER (WHERE contradicts)        AS max_offending
      FROM labelled
     GROUP BY surface, score_scale
    HAVING count(*) FILTER (WHERE contradicts) > 0
     ORDER BY count(*) FILTER (WHERE contradicts) DESC
  `).map(s=>{const o=Number(s.rows_n??0),t=Number(s.contradicting??0);return{surface:String(s.surface??"unknown"),declaredScale:String(s.score_scale??"unknown"),rows:o,contradicting:t,contradictionRate:o>0?t/o:0,minOffending:s.min_offending==null?null:Number(s.min_offending),maxOffending:s.max_offending==null?null:Number(s.max_offending)}})}async function X(r,e={}){const s=Number.isFinite(e.days)&&e.days>0?Math.floor(e.days):7,o=e.surface??null;return(await r`
    WITH scoped AS (
      SELECT surface, session_id, query_chars, query_sha256, query_origin, created_at, id
        FROM harness_shared.memory_recall_stats
       WHERE created_at >= now() - make_interval(days => ${s}::int)
         AND query_sha256 IS NOT NULL
         AND (${o}::text IS NULL OR surface = ${o}::text)
    ),
    -- Sequenced ONLY over rows that carry a session. See the doc comment: a
    -- NULL session_id would form one giant cross-agent partition.
    seq AS (
      SELECT surface, query_sha256,
             lag(query_sha256) OVER (PARTITION BY session_id, surface ORDER BY created_at, id) AS prev_sha
        FROM scoped WHERE session_id IS NOT NULL
    ),
    repeats AS (
      SELECT surface,
             count(*) FILTER (WHERE prev_sha IS NOT NULL)::int                       AS eligible,
             count(*) FILTER (WHERE prev_sha IS NOT NULL AND prev_sha = query_sha256)::int AS repeated
        FROM seq GROUP BY surface
    ),
    origins AS (
      SELECT surface, coalesce(query_origin, '(no-envelope)') AS origin, count(*)::int AS n
        FROM scoped GROUP BY surface, coalesce(query_origin, '(no-envelope)')
    )
    SELECT
      s.surface,
      count(*)::int                                                   AS recalls,
      count(*) FILTER (WHERE s.query_origin IS NOT NULL)::int          AS machine_origin,
      count(*) FILTER (WHERE s.query_chars < ${40})::int AS short_queries,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY s.query_chars)       AS chars_p50,
      percentile_cont(0.1) WITHIN GROUP (ORDER BY s.query_chars)       AS chars_p10,
      coalesce((SELECT jsonb_object_agg(o.origin, o.n) FROM origins o WHERE o.surface = s.surface), '{}'::jsonb) AS origin_mix,
      coalesce((SELECT r.eligible FROM repeats r WHERE r.surface = s.surface), 0)  AS repeat_eligible,
      coalesce((SELECT r.repeated FROM repeats r WHERE r.surface = s.surface), 0)  AS repeat_count
    FROM scoped s
    GROUP BY s.surface
    ORDER BY count(*) DESC
  `).map(t=>{const a=Number(t.recalls??0),n=Number(t.machine_origin??0),i=Number(t.short_queries??0),c=Number(t.repeat_eligible??0),l=Number(t.repeat_count??0),S=t.origin_mix??{},u={};for(const[d,g]of Object.entries(S))u[d]=Number(g??0);return{surface:String(t.surface??"unknown"),recalls:a,machineOrigin:n,machineOriginRate:a>0?n/a:0,originMix:u,charsP50:t.chars_p50==null?null:Number(t.chars_p50),charsP10:t.chars_p10==null?null:Number(t.chars_p10),shortQueries:i,shortQueryRate:a>0?i/a:0,repeatEligible:c,repeats:l,repeatRate:c>0?l/c:0}})}async function K(r){return(await r`
    WITH scoped AS (
      SELECT surface, hit_count, fragment_count, top_score,
             CASE
               WHEN score_scale IS NOT NULL THEN score_scale
               WHEN top_score IS NULL THEN 'unknown'
               WHEN top_score <= ${E} THEN 'rrf'
               WHEN top_score >= ${p} THEN 'cosine'
               ELSE 'unknown'
             END AS scale
        FROM harness_shared.memory_recall_stats
       WHERE created_at >= now() - interval '7 days'
    ),
    per_scale AS (
      SELECT surface, scale,
             count(*)::int AS scored,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY top_score) AS p50,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY top_score) AS p90
        FROM scoped WHERE top_score IS NOT NULL GROUP BY surface, scale
    )
    SELECT
      s.surface,
      count(*)::int                                AS recalls,
      count(*) FILTER (WHERE s.hit_count = 0)::int AS zero_hits,
      coalesce(sum(s.fragment_count), 0)::int      AS fragment_hits,
      coalesce(
        (SELECT jsonb_agg(to_jsonb(p)) FROM per_scale p WHERE p.surface = s.surface),
        '[]'::jsonb
      )                                            AS per_scale
    FROM scoped s
    GROUP BY s.surface
    ORDER BY count(*) DESC
  `).map(e=>{const s=Number(e.recalls??0),o=Number(e.zero_hits??0);return{surface:String(e.surface??"unknown"),recalls7d:s,zeroHit7d:o,zeroHitRate7d:s>0?o/s:0,...R(Array.isArray(e.per_scale)?e.per_scale:[]),fragmentHits7d:Number(e.fragment_hits??0)}})}var E,p,M,$,f,m,_,h,v,Z=O((()=>{y(),T(),b(),W(),E=2/61,p=.45,M=["pack","feedback","workspace","dedup","nearDuplicate","budget"],$={pack:"belongs to a knowledge pack disabled for this hive",feedback:"the user deleted this fact, so it is not re-surfaced",workspace:"scoped to another workspace (a cross-workspace correctness boundary)",dedup:"already surfaced in this session-epoch",nearDuplicate:"the same fact under another id, collapsed after ranking",budget:"did not fit the char budget, cut after ranking"},f=5*6e4,m=0,_=0,h=4e3,v=40}));export{E as a,w as c,J as d,K as f,z as g,D as h,h as i,Z as l,V as m,$ as n,k as o,X as p,p as r,C as s,M as t,Q as u};
