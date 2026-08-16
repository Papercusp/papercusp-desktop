import{n}from"./chunk-ChpBd9eV.js";import{st as i,t as o}from"./src-8fWtxfEz.js";import{c as d,r as h}from"./workspace-registry-Du2UbhlH.js";import{t as u,u as c}from"./work-item-dispatch-states-jkwfzC7Z.js";async function I(e){const{sql:s}=i(),a=e?.workspaceId??h(),t=e?.harness??null,r=e?.limit??300;return await s`
    SELECT feature_id, title, summary, harness_slug, item_kind, taken_by, updated_ts, status
      FROM harness_shared.work_items
     WHERE (workspace_id = ${a} OR workspace_id = 'default')
       AND (${t}::text IS NULL OR harness_slug = ${t})
       -- WI-5981: a FINISHED item must never demand the owner's attention. Without
       -- this, every row that ever carried payload.needsHuman stayed in the inbox
       -- forever: measured live on papercusp 2026-07-26, 161 of 249 matching rows
       -- (65%) were already terminal (done 143 · dropped 11 · closed 7), so ~2 of
       -- every 3 cards in the owner's decision feed were completed work. The tier
       -- mapper scores these 'decision', and the Inbox scope predicate keeps every
       -- Decision REGARDLESS OF AGE, so nothing downstream could ever age them out.
       -- DERIVE the set from ANY_FAMILY_TERMINAL_STATES (both families are read
       -- here) — never re-list the words: EI-18653071581558556 is the same bug
       -- class, where a hand-copied union drifted and scored ~88% of finished
       -- units as phantom failures. The 'needs-human' status is not terminal, so
       -- the feature-family leg below is unaffected.
       AND NOT (status = ANY(${[...u]}::text[]))
       AND (
         status = 'needs-human'
         OR (
           item_kind IN ('bug', 'change', 'task')
           AND COALESCE(payload, '{}'::jsonb) ->> 'needsHuman' = 'true'
         )
       )
     -- Deterministic newest-first under the cap. The bare LIMIT had no ORDER BY,
     -- so once the row count crossed NEEDS_HUMAN_LIMIT the retained subset was
     -- whatever Postgres happened to return — real owner decisions would vanish
     -- silently and unreproducibly. (At 249 rows we were already at 83% of the
     -- cap, and the 161 terminal rows above were what would have pushed it over.)
     ORDER BY updated_ts DESC NULLS LAST
     LIMIT ${r}
  `}var m,_=n((()=>{o(),d(),c(),m=300}));_();export{I as readNeedsHumanWorkItems};
