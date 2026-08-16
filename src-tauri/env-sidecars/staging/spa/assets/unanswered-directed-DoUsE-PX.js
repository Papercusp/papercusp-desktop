import{n as _}from"./chunk-ChpBd9eV.js";import{a as E,i as y,o as w,t as b}from"./log-CmoS19XU.js";import{i as A,r as S}from"./machine-authored-Bi_Q3FI8.js";function f(a,s,i=3){const r=new Map;for(const e of a){const o=Number(e.cnt);if(!Number.isFinite(o)||o<=0)continue;const n=Number(e.oldest_ts_ms),c=e.newest_ids??[],g=e.newest_from??[],l=e.newest_summary??[],u=e.newest_ts_ms??[],d=[];for(let t=0;t<c.length&&d.length<i;t++){const h=c[t],m=g[t];if(!h||!m)continue;const p=Number(u[t]);d.push({msgId:h,from:m,...l[t]?{summary:l[t]}:{},ageMs:Number.isFinite(p)?Math.max(0,s-p):0})}r.set(e.recipient,{count:o,oldestAgeMs:Number.isFinite(n)?Math.max(0,s-n):0,newest:d})}return r}async function D(a,s={}){if(a.length===0||!b())return new Map;const i=s.nowMs??Date.now(),r=i-(s.lookbackMs??2592e5),e=s.perRecipientCap??3,o=y(),n=E();return f(await o`
    -- WI-6853 / P-017 + WI-6875 — ONE scan of coord_event_log feeds every correlated lookup
    -- this statement used to re-scan the table for.
    --
    -- THE ORIGINAL PATHOLOGY (all three sites shared it): PostgreSQL has NO STATISTICS for
    -- jsonb expressions, so a filter on \`body->>'from'\` / \`body->>'related_msg_id'\` that
    -- actually discards ~75k rows is estimated at 1 row. Believing each probe trivial, the
    -- planner happily re-ran it per candidate row. Measured on the live workspace:
    --   * the \`unanswered\` loose-reply count — 14 loops x 75,192 rows removed (~1.05M rows
    --     examined, 129ms/loop), 76% of the statement's total runtime;
    --   * \`open_asks\`' exact-threaded-reply NOT EXISTS — 75,372 rows, ~148ms;
    --   * \`directed\`'s WI-4537(c) ACK-PING-PONG EXISTS — 75,422 rows, ~157ms.
    --
    -- INDEXES CANNOT FIX THIS, and that is the counter-intuitive part worth recording: two
    -- purpose-built partial indexes (on (workspace_id, (body->>'from'), ts), and on the
    -- expectsReply predicate) were built, ANALYZEd and EXPLAINed transactionally, and the
    -- planner ignored BOTH — it already believed the scans returned one row. When the estimate
    -- and the actual diverge by ~5 orders of magnitude, the ESTIMATE is the bug, so the fix has
    -- to remove the per-row correlation rather than add another access path.
    --
    -- THE ROSTER PRE-FILTER is what makes one scan enough, and it is exactly
    -- equivalence-preserving rather than a heuristic narrowing. Every one of these lookups
    -- requires the row to be authored by a RECIPIENT we are asking about
    -- (\`= o.recipient\` / \`= d.recipient\` / \`= r\`), and those are all already constrained by
    -- \`r = ANY(recipientIds)\`. A row authored by anyone outside the roster could never have
    -- satisfied any of them, so dropping it cannot change a verdict. Live selectivity:
    -- 11,093 of 75,357 rows (6.8x); only 1,283 of those carry a related_msg_id (59x).
    --
    -- NOT time-bounded, deliberately. The two EXISTS sites are not bounded in the original,
    -- and a message's 'ts' is SENDER-SUPPLIED in the body — so inferring "a reply must postdate
    -- its ask" would import an assumption the current semantics do not make. \`loose_replies\`
    -- below re-applies its own lookback, which the original DOES have.
    --
    -- AS MATERIALIZED is REQUIRED on both: with a single reference PG would inline the CTE and
    -- re-scan per loop, reinstating the exact cost being removed.
    --
    -- Verified equivalent against live data before landing, at every level: loose_replies
    -- (1,058 = 1,058 rows), the open_asks set (20 = 20), and the end-to-end aggregate
    -- (9 = 9 recipients, 16 = 16 total) — EXCEPT empty in BOTH directions each time.
    -- 2,545ms -> 985ms (P-017) -> 224ms (WI-6875), means of 3 paired runs.
    WITH roster_authored AS MATERIALIZED (
      SELECT ra.id,
             ra.workspace_id,
             ra.body->>'from'              AS from_id,
             ra.body->>'msg_id'            AS msg_id,
             ra.body->>'related_msg_id'    AS related_msg_id,
             -- carried SEPARATELY from related_msg_id on purpose: \`body ? 'related_msg_id'\`
             -- and \`body->>'related_msg_id' IS NOT NULL\` disagree when the key is present with
             -- a JSON null value. Zero such rows today, but loose_replies' predicate is the
             -- key-presence test, so it must stay the key-presence test.
             ra.body ? 'related_msg_id'    AS has_related,
             ra.body->'to'                 AS to_arr,
             (ra.body->>'ts')::timestamptz AS ts
        FROM harness_shared.coord_event_log ra
       WHERE ra.workspace_id = ${n}
         AND ra.surface = 'messages'
         AND ra.body->>'from' = ANY(${a}::text[])
    ),
    -- The LOOSE-REPLY set — \`unanswered\` below needs, per open ask, "how many un-threaded
    -- replies did this recipient send back to that sender after the ask". DERIVED from
    -- roster_authored rather than scanning the table again (WI-6875): it is a strict subset of
    -- it, so the second scan was pure duplication — removing it took 344ms -> 224ms and
    -- 213,798 -> 164,639 buffers.
    --
    -- DISTINCT on the message id is a semantic guard, not a tidy-up, and note it is the
    -- OPPOSITE of what the two EXISTS sites below want. The predicate it replaces is
    -- \`body->'to' @> to_jsonb(ARRAY[o.from_id])\` — a per-MESSAGE containment test, so a message
    -- whose 'to' array lists the same id twice counts ONCE. Unnesting with LATERAL would count
    -- it twice and could silently clear an ask that is still open. The EXISTS sites only test
    -- existence, where a duplicate cannot change the answer, so they take no DISTINCT.
    --
    -- The ts bound stays a TIMESTAMPTZ comparison; comparing the derived bigint ts_ms instead
    -- would introduce truncation the original does not have.
    loose_replies AS MATERIALIZED (
      SELECT DISTINCT ra.id,
             ra.workspace_id,
             ra.from_id,
             rt AS to_id,
             (extract(epoch FROM ra.ts) * 1000)::bigint AS ts_ms
        FROM roster_authored ra
        CROSS JOIN LATERAL jsonb_array_elements_text(ra.to_arr) AS rt
       WHERE NOT ra.has_related
         AND jsonb_typeof(ra.to_arr) = 'array'
         AND ra.ts >= to_timestamp(${r}::double precision / 1000)
    ),
    directed AS (
      SELECT
        e.workspace_id,
        e.body->>'msg_id' AS msg_id,
        e.body->>'from' AS from_id,
        e.body->>'summary' AS summary,
        (extract(epoch FROM (e.body->>'ts')::timestamptz) * 1000)::bigint AS ts_ms,
        r AS recipient
        FROM harness_shared.coord_event_log e
        CROSS JOIN LATERAL jsonb_array_elements_text(e.body->'to') AS r
       WHERE e.workspace_id = ${n}
         AND e.surface = 'messages'
         AND (e.body->>'kind' IS NULL OR e.body->>'kind' = 'message')
         AND NOT (e.body ? 'audience')
         AND jsonb_typeof(e.body->'to') = 'array'
         AND r = ANY(${a}::text[])
         AND e.body->>'from' IS DISTINCT FROM r
         AND (e.body->>'ts')::timestamptz >= to_timestamp(${r}::double precision / 1000)
         -- WI-4553: only the SENDER can distinguish a question from an FYI.
         -- Missing/false is the backwards-compatible non-obligation default.
         AND (e.body->>'expectsReply') = 'true'
         -- EI-19315474516256070: \`expects\` (string, D-048's REQUIRED coord:send field) and
         -- \`expectsReply\` (legacy boolean, independently settable by any RAW sendMessage()
         -- caller via \`opts.expectsReply\`) are two DIFFERENT envelope keys that can diverge —
         -- the coord:send TOOL keeps them in lockstep (\`expectsReply = expects !== 'none'\`),
         -- but a raw sendMessage() caller can pass BOTH \`expectsReply:true\` AND
         -- \`extra:{ expects:'none' }\` (or have \`expects\` overwritten to 'none' by the
         -- write-time machine-emitter stamp in messages.ts AFTER expectsReply was already set),
         -- leaving a row that says "no reply wanted" and "reply wanted" at once. Measured live
         -- 2026-08-02: exactly one such row in papercusp-workspace
         -- (work_items/request_release.ts's release-request send, whose \`auto:true\` triggers the
         -- write-time \`expects:'none'\` stamp even though it also passes \`expectsReply:true\`).
         -- When the sender EXPLICITLY declared \`expects:'none'\`, that is the more specific,
         -- more recent signal (D-048 supersedes the legacy field) and wins — a sender who said
         -- "no reply needed" cannot be overridden by a stale/inconsistent boolean.
         AND (e.body->>'expects') IS DISTINCT FROM 'none'
         -- WI-4537 (a): machine LIFECYCLE chatter is not an obligation. sendMessage now
         -- auto-stamps this for every machine sender (messages.ts), so it is reliable going
         -- forward.
         AND (e.body->>'auto') IS DISTINCT FROM 'true'
         -- WI-4537 (b): …and the SAME machine-sender rule again, structurally — because the
         -- write-time stamp cannot reach the rows ALREADY written without it, and those are the
         -- bulk of the noise today (~490 unflagged robot rows vs ~314 flagged). Shared pattern,
         -- so this and the stamp can never disagree.
         AND NOT (e.body->>'from' ~ ${S})
         -- WI-4537 (c): the ACK-PING-PONG. A message that is itself a REPLY to something the
         -- RECIPIENT sent is an ANSWER arriving, not a question landing — yet it was counted as
         -- a fresh obligation on the recipient, who could only clear it by acking the ack (whose
         -- ack the peer would then owe…). 184 of 2791 unanswered rows fleet-wide were exactly
         -- this: peers' "done ✓" / "Ack — confirmed" replies, logged forever as mail the asker
         -- still owes an answer to.
         -- WI-6875: reads the pre-materialized \`roster_authored\` above instead of re-scanning
         -- coord_event_log (75,422 rows, ~157ms) per candidate row. Predicate set unchanged:
         -- same author, same msg_id match, same absence of a time bound.
         AND NOT (
           e.body ? 'related_msg_id'
           AND EXISTS (
             SELECT 1 FROM roster_authored ra
              WHERE ra.workspace_id = e.workspace_id
                AND ra.msg_id = e.body->>'related_msg_id'
                AND ra.from_id = r
           )
         )
    ),
    -- (1) An EXACT threaded reply/ack to THIS specific ask, authored by the
    -- recipient, answers it outright — no pairing, no ambiguity. Evaluated per
    -- (msg_id, recipient), never msg_id alone: one message fans out to N
    -- recipients, and recipient A replying must not clear B's obligation.
    open_asks AS (
      SELECT d.*,
             row_number() OVER (
               PARTITION BY d.recipient, d.from_id ORDER BY d.ts_ms DESC, d.msg_id DESC
             ) AS ask_rank
        FROM directed d
       -- WI-6875: reads the pre-materialized \`roster_authored\` above instead of re-scanning
       -- coord_event_log (75,372 rows, ~148ms) per candidate row. Comparing
       -- \`ra.related_msg_id = d.msg_id\` naturally excludes rows carrying no related_msg_id,
       -- since NULL never equals anything — matching the original's implicit requirement that
       -- the key be present.
       WHERE NOT EXISTS (
         SELECT 1 FROM roster_authored ra
          WHERE ra.workspace_id = d.workspace_id
            AND ra.from_id = d.recipient
            AND ra.related_msg_id = d.msg_id
       )
    ),
    unanswered AS (
      -- (2) WI-6729: the LOOSE branch, now NARROWED and PAIRED. An un-threaded
      -- directed message back to the original sender after the ask still counts
      -- as a reply (EI-13819 / WI-5345 — this fleet's agents overwhelmingly
      -- answer in fresh standalone messages rather than re-threading onto the
      -- exact msg_id that set expectsReply), but two rails stop it silently
      -- eating real obligations:
      --
      --   NARROWED — a reply carrying a related_msg_id that points at some
      --   OTHER message is positive evidence it is about something ELSE, so it
      --   is no longer loose evidence for this ask. (A reply threaded to THIS
      --   ask is already branch (1).) Previously ANY threaded reply to a sender
      --   cleared EVERY open ask from them, regardless of topic.
      --
      --   PAIRED — one reply may clear at most ONE ask. Ranking a sender's open
      --   asks newest-first, the k-th needs k loose replies after it. A single
      --   "on another note…" can no longer retire three distinct questions; the
      --   newest clears and the older ones stay open.
      --
      -- The direction of error is deliberate. This can leave open an ask that
      -- was in substance answered — a cheap, self-correcting extra nudge —
      -- rather than drop one that was not. The counter drives leader-brief,
      -- fleet:assignments and coord:inbox{unanswered_only}, where a false ZERO
      -- is indistinguishable from a true zero and loses the commitment
      -- silently and permanently. It cannot re-introduce EI-13819's stuck-at-1
      -- either: continued correspondence always converges (m loose replies
      -- clear the m newest open asks), so a live exchange never sticks.
      -- Reads from the pre-materialized \`loose_replies\` above rather than re-scanning
      -- coord_event_log per row (WI-6853). The predicate set is unchanged — same author,
      -- same addressee, same "after the ask" bound, same one-reply-clears-one-ask pairing
      -- against ask_rank.
      SELECT o.* FROM open_asks o
       WHERE (
         SELECT count(*) FROM loose_replies lr
          WHERE lr.workspace_id = o.workspace_id
            AND lr.from_id = o.recipient
            AND lr.to_id = o.from_id
            AND lr.ts_ms >= o.ts_ms
       ) < o.ask_rank
    )
    SELECT recipient,
           count(*) AS cnt,
           min(ts_ms) AS oldest_ts_ms,
           (array_agg(msg_id ORDER BY ts_ms DESC))[1:${e}] AS newest_ids,
           (array_agg(from_id ORDER BY ts_ms DESC))[1:${e}] AS newest_from,
           (array_agg(summary ORDER BY ts_ms DESC))[1:${e}] AS newest_summary,
           (array_agg(ts_ms ORDER BY ts_ms DESC))[1:${e}] AS newest_ts_ms
      FROM unanswered
     GROUP BY recipient
  `,i,e)}var R,T,v=_((()=>{w(),A(),R=72*3600*1e3,T=3}));export{f as i,D as n,v as r,R as t};
