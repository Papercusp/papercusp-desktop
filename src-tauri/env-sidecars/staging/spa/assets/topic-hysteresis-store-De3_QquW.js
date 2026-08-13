import{n as o}from"./chunk-ChpBd9eV.js";import{st as n,t as r}from"./src-BmBNODK0.js";async function p(s){const{sql:i}=n(),t=(await i`
    SELECT tick, subscriptions
    FROM harness_shared.topic_hysteresis
    WHERE session_id = ${s}
  `)[0];return t?{tick:Number(t.tick)||0,subscriptions:Array.isArray(t.subscriptions)?t.subscriptions:[]}:{tick:0,subscriptions:[]}}async function E(s){const{sql:i}=n(),t=JSON.stringify(s.subscriptions??[]);await i`
    INSERT INTO harness_shared.topic_hysteresis
      (session_id, owner_id, tick, subscriptions, updated_at)
    VALUES (
      ${s.sessionId}, ${s.ownerId}, ${s.tick},
      ${t}::text::jsonb, now()
    )
    ON CONFLICT (session_id) DO UPDATE SET
      owner_id      = EXCLUDED.owner_id,
      tick          = EXCLUDED.tick,
      subscriptions = EXCLUDED.subscriptions,
      updated_at    = now()
  `}async function u(s){const{sql:i}=n();return(await i`
    DELETE FROM harness_shared.topic_hysteresis
    WHERE updated_at < ${typeof s=="string"?s:s.toISOString()}::timestamptz
    RETURNING session_id
  `).length}var e=o((()=>{r()}));e();export{p as loadTopicState,u as pruneTopicState,E as saveTopicState};
