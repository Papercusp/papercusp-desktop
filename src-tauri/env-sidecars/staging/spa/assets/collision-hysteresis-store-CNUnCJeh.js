import{n}from"./chunk-ChpBd9eV.js";import{st as e,t as o}from"./src-BmBNODK0.js";async function E(s){const{sql:i}=e(),t=(await i`
    SELECT tick, states
    FROM harness_shared.collision_hysteresis
    WHERE session_id = ${s}
  `)[0];return t?{tick:Number(t.tick)||0,states:Array.isArray(t.states)?t.states:[]}:{tick:0,states:[]}}async function d(s){const{sql:i}=e(),t=JSON.stringify(s.states??[]);await i`
    INSERT INTO harness_shared.collision_hysteresis
      (session_id, owner_id, tick, states, updated_at)
    VALUES (
      ${s.sessionId}, ${s.ownerId}, ${s.tick},
      ${t}::text::jsonb, now()
    )
    ON CONFLICT (session_id) DO UPDATE SET
      owner_id   = EXCLUDED.owner_id,
      tick       = EXCLUDED.tick,
      states     = EXCLUDED.states,
      updated_at = now()
  `}async function l(s){const{sql:i}=e();return(await i`
    DELETE FROM harness_shared.collision_hysteresis
    WHERE updated_at < ${typeof s=="string"?s:s.toISOString()}::timestamptz
    RETURNING session_id
  `).length}var a=n((()=>{o()}));a();export{E as loadCollisionState,l as pruneCollisionState,d as saveCollisionState};
