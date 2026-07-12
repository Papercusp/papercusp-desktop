import{n as e}from"./chunk-CMxvf4Kt.js";import{E as t}from"./embed-sidecar-spawn-DBQRyW_e.js";import{J as n,t as r}from"./src-CgbVJkBN.js";import{t as i}from"./backend-CTkQ8L_K.js";function a(e){u||(u=!0,console.warn(`[memory-journal] degraded (journaling skipped):`,e?.message??e))}async function o(){let e={scanned:0,recovered:0,deduped:0,retriesExhausted:0,stillPending:0,recoveredWindow:null},{sql:r}=n(),i=t(),o=await r`
    SELECT id, requested_at, scope, kind, content, metadata, verbatim, attempts
      FROM harness_shared.memory_write_journal
     WHERE status = 'pending'
       AND (last_attempt_at IS NULL
            OR last_attempt_at < now() - (attempts * interval '5 minutes'))
     ORDER BY requested_at
     LIMIT ${c}
     FOR UPDATE SKIP LOCKED`;if(o.length===0)return e;if(e.scanned=o.length,!(await i.available().catch(()=>({ok:!1,reason:`probe_failed`}))).ok)return e.stillPending=o.length,e;let u=[];for(let t of o)try{let n=typeof t.metadata?.__journal_update_of==`string`?t.metadata.__journal_update_of:null;if(n){await i.update(n,{text:t.content}),await r`
          UPDATE harness_shared.memory_write_journal
             SET status = 'committed', committed_at = now(), committed_memory_id = ${n},
                 attempts = ${t.attempts+1}, last_attempt_at = now()
           WHERE id = ${t.id} AND status = 'pending'`,e.recovered+=1,u.push(t.requested_at);continue}let a=(await i.search(t.content,{scope:t.scope,limit:3}).catch(()=>[])).find(e=>typeof e.score==`number`&&e.score>=l);if(a){await r`
          UPDATE harness_shared.memory_write_journal
             SET status = 'committed', committed_at = now(), committed_memory_id = ${a.id},
                 attempts = ${t.attempts+1}, last_attempt_at = now(),
                 last_error = 'deduped_on_drain (content already in store)'
           WHERE id = ${t.id} AND status = 'pending'`,e.deduped+=1;continue}let{ids:o}=await i.remember(t.content,{scope:t.scope,...t.kind?{kind:t.kind}:{},metadata:{...t.metadata??{},recovered_from:`journal`,recovered_journal_id:t.id},verbatim:t.verbatim});await r`
        UPDATE harness_shared.memory_write_journal
           SET status = 'committed', committed_at = now(), committed_memory_id = ${o[0]??null},
               attempts = ${t.attempts+1}, last_attempt_at = now()
         WHERE id = ${t.id} AND status = 'pending'`,e.recovered+=1,u.push(t.requested_at)}catch(n){let i=t.attempts+1,o=i>=s;await r`
        UPDATE harness_shared.memory_write_journal
           SET attempts = ${i}, last_attempt_at = now(),
               last_error = ${String(n?.message??n).slice(0,500)},
               status = ${o?`failed_permanent`:`pending`}
         WHERE id = ${t.id} AND status = 'pending'`.catch(a),o?e.retriesExhausted+=1:e.stillPending+=1}if(u.length>0){let t=[...u].sort();e.recoveredWindow={from:t[0],to:t[t.length-1]}}return e}var s,c,l,u;e((()=>{r(),i(),s=(()=>{let e=Number({}.PAPERCUSP_MEMORY_JOURNAL_MAX_ATTEMPTS);return Number.isFinite(e)&&e>0?e:30})(),c=(()=>{let e=Number({}.PAPERCUSP_MEMORY_JOURNAL_DRAIN_BATCH);return Number.isFinite(e)&&e>0?e:25})(),l=.9,u=!1}))();export{o as drainMemoryWriteJournal};