import{n as e}from"./chunk-CMxvf4Kt.js";import{a as t,i as n,o as r,t as i}from"./log-CPSYdiQw.js";import{n as a,t as o}from"./machine-authored-CZmWpnxp.js";function s(e,t){let n=new Map;for(let r of e){let e=Number(r.cnt);if(!Number.isFinite(e)||e<=0)continue;let i=Number(r.oldest_ts_ms),a=r.newest_ids??[],o=r.newest_from??[],s=r.newest_summary??[],c=r.newest_ts_ms??[],l=[];for(let e=0;e<a.length&&l.length<3;e++){let n=a[e],r=o[e];if(!n||!r)continue;let i=Number(c[e]);l.push({msgId:n,from:r,...s[e]?{summary:s[e]}:{},ageMs:Number.isFinite(i)?Math.max(0,t-i):0})}n.set(r.recipient,{count:e,oldestAgeMs:Number.isFinite(i)?Math.max(0,t-i):0,newest:l})}return n}async function c(e,r={}){if(e.length===0||!i())return new Map;let a=r.nowMs??Date.now(),c=a-(r.lookbackMs??2592e5);return s(await n()`
    WITH directed AS (
      SELECT
        e.workspace_id,
        e.body->>'msg_id' AS msg_id,
        e.body->>'from' AS from_id,
        e.body->>'summary' AS summary,
        (extract(epoch FROM (e.body->>'ts')::timestamptz) * 1000)::bigint AS ts_ms,
        r AS recipient
        FROM harness_shared.coord_event_log e
        CROSS JOIN LATERAL jsonb_array_elements_text(e.body->'to') AS r
       WHERE e.workspace_id = ${t()}
         AND e.surface = 'messages'
         AND (e.body->>'kind' IS NULL OR e.body->>'kind' = 'message')
         AND NOT (e.body ? 'audience')
         AND jsonb_typeof(e.body->'to') = 'array'
         AND r = ANY(${e}::text[])
         AND e.body->>'from' IS DISTINCT FROM r
         AND (e.body->>'ts')::timestamptz >= to_timestamp(${c}::double precision / 1000)
         -- WI-4553: only the SENDER can distinguish a question from an FYI.
         -- Missing/false is the backwards-compatible non-obligation default.
         AND (e.body->>'expectsReply') = 'true'
         -- WI-4537 (a): machine LIFECYCLE chatter is not an obligation. sendMessage now
         -- auto-stamps this for every machine sender (messages.ts), so it is reliable going
         -- forward.
         AND (e.body->>'auto') IS DISTINCT FROM 'true'
         -- WI-4537 (b): …and the SAME machine-sender rule again, structurally — because the
         -- write-time stamp cannot reach the rows ALREADY written without it, and those are the
         -- bulk of the noise today (~490 unflagged robot rows vs ~314 flagged). Shared pattern,
         -- so this and the stamp can never disagree.
         AND NOT (e.body->>'from' ~ ${o})
         -- WI-4537 (c): the ACK-PING-PONG. A message that is itself a REPLY to something the
         -- RECIPIENT sent is an ANSWER arriving, not a question landing — yet it was counted as
         -- a fresh obligation on the recipient, who could only clear it by acking the ack (whose
         -- ack the peer would then owe…). 184 of 2791 unanswered rows fleet-wide were exactly
         -- this: peers' "done ✓" / "Ack — confirmed" replies, logged forever as mail the asker
         -- still owes an answer to.
         AND NOT (
           e.body ? 'related_msg_id'
           AND EXISTS (
             SELECT 1 FROM harness_shared.coord_event_log e3
              WHERE e3.workspace_id = e.workspace_id
                AND e3.surface = 'messages'
                AND e3.body->>'msg_id' = e.body->>'related_msg_id'
                AND e3.body->>'from' = r
           )
         )
    ),
    unanswered AS (
      SELECT d.* FROM directed d
       WHERE NOT EXISTS (
         SELECT 1 FROM harness_shared.coord_event_log e2
          WHERE e2.workspace_id = d.workspace_id
            AND e2.surface = 'messages'
            AND e2.body->>'related_msg_id' = d.msg_id
            AND e2.body->>'from' = d.recipient
       )
    )
    SELECT recipient,
           count(*) AS cnt,
           min(ts_ms) AS oldest_ts_ms,
           (array_agg(msg_id ORDER BY ts_ms DESC))[1:${3}] AS newest_ids,
           (array_agg(from_id ORDER BY ts_ms DESC))[1:${3}] AS newest_from,
           (array_agg(summary ORDER BY ts_ms DESC))[1:${3}] AS newest_summary,
           (array_agg(ts_ms ORDER BY ts_ms DESC))[1:${3}] AS newest_ts_ms
      FROM unanswered
     GROUP BY recipient
  `,a)}var l,u=e((()=>{r(),a(),l=72*3600*1e3}));export{s as i,c as n,u as r,l as t};