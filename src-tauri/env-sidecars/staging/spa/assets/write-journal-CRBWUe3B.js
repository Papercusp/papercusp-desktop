import{n as e}from"./chunk-CMxvf4Kt.js";import{P as t,f as n,t as r}from"./src-R_nFx4J9.js";import{J as i,t as a}from"./src-C4H77EbW.js";import{t as o}from"./backend-BbhOiCgu.js";function s(e){let t=[];if(e)for(let n of c)n.re.test(e)&&t.push(n.cls);return{matched:t.length>0,classes:t}}var c,l=e((()=>{c=[{cls:`anthropic-api-key`,re:/\bsk-ant-[A-Za-z0-9_-]{16,}/},{cls:`openai-api-key`,re:/\bsk-proj-[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9]{32,}\b/},{cls:`stripe-key`,re:/\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}\b/},{cls:`github-token`,re:/\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/},{cls:`aws-access-key-id`,re:/\bAKIA[0-9A-Z]{16}\b/},{cls:`slack-token`,re:/\bxox[bpoas]-[A-Za-z0-9-]{10,}\b/},{cls:`private-key`,re:/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/},{cls:`jwt`,re:/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/},{cls:`url-with-password`,re:/\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i},{cls:`bearer-token`,re:/\bBearer\s+(?=[A-Za-z0-9_\-.=+/]*\d)[A-Za-z0-9_\-.=+/]{20,}/}]}));function u(e){h||(h=!0,console.warn(`[memory-journal] degraded (journaling skipped):`,e?.message??e))}async function d(){let e={scanned:0,recovered:0,deduped:0,retriesExhausted:0,stillPending:0,recoveredWindow:null},{sql:r}=i(),a=n(),o=await r`
    SELECT id, requested_at, scope, kind, content, metadata, verbatim, attempts
      FROM harness_shared.memory_write_journal
     WHERE status = 'pending'
       AND (last_attempt_at IS NULL
            OR last_attempt_at < now() - (attempts * interval '5 minutes'))
     ORDER BY requested_at
     LIMIT ${p}
     FOR UPDATE SKIP LOCKED`;if(o.length===0)return e;if(e.scanned=o.length,!(await a.available().catch(()=>({ok:!1,reason:`probe_failed`}))).ok)return e.stillPending=o.length,e;let c=[];for(let n of o)try{let i=typeof n.metadata?.__journal_update_of==`string`?n.metadata.__journal_update_of:null,o=s(n.content);if(i){await a.update(i,{text:n.content,metadata:{possible_secret:o.matched,possible_secret_classes:o.classes}}),await r`
          UPDATE harness_shared.memory_write_journal
             SET status = 'committed', committed_at = now(), committed_memory_id = ${i},
                 attempts = ${n.attempts+1}, last_attempt_at = now()
           WHERE id = ${n.id} AND status = 'pending'`,e.recovered+=1,c.push(n.requested_at);continue}let l=(await a.search(n.content,{scope:n.scope,limit:3}).catch(()=>[])).find(e=>typeof e.text==`string`&&t(n.content,e.text)>=m);if(l){await r`
          UPDATE harness_shared.memory_write_journal
             SET status = 'committed', committed_at = now(), committed_memory_id = ${l.id},
                 attempts = ${n.attempts+1}, last_attempt_at = now(),
                 last_error = 'deduped_on_drain (content already in store)'
           WHERE id = ${n.id} AND status = 'pending'`,e.deduped+=1;continue}let{ids:u}=await a.remember(n.content,{scope:n.scope,...n.kind?{kind:n.kind}:{},metadata:{...n.metadata??{},...o.matched?{possible_secret:!0,possible_secret_classes:o.classes}:{},recovered_from:`journal`,recovered_journal_id:n.id},verbatim:n.verbatim});await r`
        UPDATE harness_shared.memory_write_journal
           SET status = 'committed', committed_at = now(), committed_memory_id = ${u[0]??null},
               attempts = ${n.attempts+1}, last_attempt_at = now()
         WHERE id = ${n.id} AND status = 'pending'`,e.recovered+=1,c.push(n.requested_at)}catch(t){let i=n.attempts+1,a=i>=f;await r`
        UPDATE harness_shared.memory_write_journal
           SET attempts = ${i}, last_attempt_at = now(),
               last_error = ${String(t?.message??t).slice(0,500)},
               status = ${a?`failed_permanent`:`pending`}
         WHERE id = ${n.id} AND status = 'pending'`.catch(u),a?e.retriesExhausted+=1:e.stillPending+=1}if(c.length>0){let t=[...c].sort();e.recoveredWindow={from:t[0],to:t[t.length-1]}}return e}var f,p,m,h;e((()=>{a(),r(),o(),l(),f=(()=>{let e=Number({}.PAPERCUSP_MEMORY_JOURNAL_MAX_ATTEMPTS);return Number.isFinite(e)&&e>0?e:30})(),p=(()=>{let e=Number({}.PAPERCUSP_MEMORY_JOURNAL_DRAIN_BATCH);return Number.isFinite(e)&&e>0?e:25})(),m=.9,h=!1}))();export{d as drainMemoryWriteJournal};