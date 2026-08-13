import{n as h}from"./chunk-ChpBd9eV.js";import{st as c,t as f}from"./src-BmBNODK0.js";import{B as y,Ct as A,t as T}from"./src-TCAGNWCW.js";import{n as R,t as g}from"./secret-detect-BbUBcDca.js";import{t as $}from"./backend-C_tc1lRe.js";function _(t){m||(m=!0,console.warn("[memory-journal] degraded (journaling skipped):",t?.message??t))}async function k(t){try{const{sql:a}=c();return(await a`
      INSERT INTO harness_shared.memory_write_journal (scope, kind, content, metadata, verbatim, source)
      VALUES (${t.scope}, ${t.kind??null}, ${t.content},
              ${t.metadata?JSON.stringify(t.metadata):null}::text::jsonb,
              ${t.verbatim??!0}, ${t.source??"live-write"})
      RETURNING id`)[0]?.id??null}catch(a){return _(a),null}}async function U(t,a){try{const{sql:s}=c();await s`
      UPDATE harness_shared.memory_write_journal
         SET status = 'committed', committed_at = now(),
             committed_memory_id = ${a??null}
       WHERE id = ${t} AND status = 'pending'`}catch(s){_(s)}}async function M(){const t={scanned:0,recovered:0,deduped:0,retriesExhausted:0,stillPending:0,recoveredWindow:null},{sql:a}=c(),s=y(),o=await a`
    SELECT id, requested_at, scope, kind, content, metadata, verbatim, attempts
      FROM harness_shared.memory_write_journal
     WHERE status = 'pending'
       AND (last_attempt_at IS NULL
            OR last_attempt_at < now() - (attempts * interval '5 minutes'))
     ORDER BY requested_at
     LIMIT ${p}
     FOR UPDATE SKIP LOCKED`;if(o.length===0)return t;if(t.scanned=o.length,!(await s.available().catch(()=>({ok:!1,reason:"probe_failed"}))).ok)return t.stillPending=o.length,t;const d=[];for(const e of o)try{const r=typeof e.metadata?.__journal_update_of=="string"?e.metadata.__journal_update_of:null,n=g(e.content);if(r){await s.update(r,{text:e.content,metadata:{possible_secret:n.matched,possible_secret_classes:n.classes}}),await a`
          UPDATE harness_shared.memory_write_journal
             SET status = 'committed', committed_at = now(), committed_memory_id = ${r},
                 attempts = ${e.attempts+1}, last_attempt_at = now()
           WHERE id = ${e.id} AND status = 'pending'`,t.recovered+=1,d.push(e.requested_at);continue}const i=(await s.search(e.content,{scope:e.scope,limit:3}).catch(()=>[])).find(l=>typeof l.text=="string"&&A(e.content,l.text)>=E);if(i){await a`
          UPDATE harness_shared.memory_write_journal
             SET status = 'committed', committed_at = now(), committed_memory_id = ${i.id},
                 attempts = ${e.attempts+1}, last_attempt_at = now(),
                 last_error = 'deduped_on_drain (content already in store)'
           WHERE id = ${e.id} AND status = 'pending'`,t.deduped+=1;continue}const{ids:w}=await s.remember(e.content,{scope:e.scope,...e.kind?{kind:e.kind}:{},metadata:{...e.metadata??{},...n.matched?{possible_secret:!0,possible_secret_classes:n.classes}:{},recovered_from:"journal",recovered_journal_id:e.id},verbatim:e.verbatim});await a`
        UPDATE harness_shared.memory_write_journal
           SET status = 'committed', committed_at = now(), committed_memory_id = ${w[0]??null},
               attempts = ${e.attempts+1}, last_attempt_at = now()
         WHERE id = ${e.id} AND status = 'pending'`,t.recovered+=1,d.push(e.requested_at)}catch(r){const n=e.attempts+1,i=n>=u;await a`
        UPDATE harness_shared.memory_write_journal
           SET attempts = ${n}, last_attempt_at = now(),
               last_error = ${String(r?.message??r).slice(0,500)},
               status = ${i?"failed_permanent":"pending"}
         WHERE id = ${e.id} AND status = 'pending'`.catch(_),i?t.retriesExhausted+=1:t.stillPending+=1}if(d.length>0){const e=[...d].sort();t.recoveredWindow={from:e[0],to:e[e.length-1]}}return t}var u,p,E,m,H=h((()=>{f(),T(),$(),R(),u=(()=>{const t=Number({}.PAPERCUSP_MEMORY_JOURNAL_MAX_ATTEMPTS);return Number.isFinite(t)&&t>0?t:30})(),p=(()=>{const t=Number({}.PAPERCUSP_MEMORY_JOURNAL_DRAIN_BATCH);return Number.isFinite(t)&&t>0?t:25})(),E=.9,m=!1}));export{U as i,H as n,k as r,M as t};
