import{n}from"./chunk-ChpBd9eV.js";import{st as e,t as c}from"./src-8fWtxfEz.js";async function E(t){const{sql:a}=e(),s=(await a`
    SELECT tick, states, topics
    FROM harness_shared.adjacency_state
    WHERE session_id = ${t}
  `)[0];return s?{tick:Number(s.tick)||0,states:Array.isArray(s.states)?s.states:[],topics:s.topics&&typeof s.topics=="object"&&!Array.isArray(s.topics)?s.topics:{}}:{tick:0,states:[],topics:{}}}async function p(t){const{sql:a}=e(),s=JSON.stringify(t.states??[]),i=JSON.stringify(t.topics??{});await a`
    INSERT INTO harness_shared.adjacency_state
      (session_id, owner_id, tick, states, topics, updated_at)
    VALUES (
      ${t.sessionId}, ${t.ownerId}, ${t.tick},
      ${s}::text::jsonb, ${i}::text::jsonb, now()
    )
    ON CONFLICT (session_id) DO UPDATE SET
      owner_id   = EXCLUDED.owner_id,
      tick       = EXCLUDED.tick,
      states     = EXCLUDED.states,
      topics     = EXCLUDED.topics,
      updated_at = now()
  `}async function y(t){const{sql:a}=e();return(await a`
    DELETE FROM harness_shared.adjacency_state
    WHERE updated_at < ${typeof t=="string"?t:t.toISOString()}::timestamptz
    RETURNING session_id
  `).length}var o=n((()=>{c()}));o();export{E as loadAdjacencyState,y as pruneAdjacencyState,p as saveAdjacencyState};
