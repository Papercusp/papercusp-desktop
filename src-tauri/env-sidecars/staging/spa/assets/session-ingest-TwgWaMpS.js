import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{a as n}from"./types-3cwwxpZc.js";import{t as r}from"./src-BOSa0o7e.js";import{a as i,c as a}from"./server-C2rhPpnt.js";import{t as o}from"./__vite-browser-external-CM3Eme-n.js";import{q as s,t as c}from"./src-BbbWoCsk.js";function l(e){let t=e.trim();if(t.length<P)return null;for(let e of I)if(t.startsWith(e))return null;return t.slice(0,N).replace(F,`[redacted]`)}function u(e){if(typeof e==`string`)return e;if(!Array.isArray(e))return``;let t=[];for(let n of e){if(!n||typeof n!=`object`)continue;let e=n;typeof e.text==`string`&&(e.type===`text`||e.type===`input_text`||e.type===`output_text`)&&t.push(e.text)}return t.join(`
`)}function d(e){if(typeof e!=`string`&&typeof e!=`number`)return null;let t=new Date(e);return Number.isNaN(t.getTime())?null:t}function f(e){let t;try{t=JSON.parse(e)}catch{return null}if(t.type!==`user`&&t.type!==`assistant`)return null;let n=t.message;if(!n)return null;let r=n.role===`user`?`user`:n.role===`assistant`?`assistant`:null;if(!r)return null;let i=l(u(n.content));return i?{ts:d(t.timestamp),speaker:r,text:i,cwd:typeof t.cwd==`string`?t.cwd:null,sessionId:typeof t.sessionId==`string`?t.sessionId:null}:null}function p(e){let t;try{t=JSON.parse(e)}catch{return null}if(t.type!==`message`)return null;let n=t.message;if(!n)return null;let r=n.role===`user`?`user`:n.role===`assistant`?`assistant`:null;if(!r)return null;let i=l(u(n.content));return i?{ts:d(t.timestamp),speaker:r,text:i}:null}function m(e){let t;try{t=JSON.parse(e)}catch{return null}if(t.type!==`response_item`)return null;let n=t.payload;if(!n||n.type!==`message`)return null;let r=n.role===`user`?`user`:n.role===`assistant`?`assistant`:null;if(!r)return null;let i=l(u(n.content));return i?{ts:d(t.timestamp),speaker:r,text:i}:null}async function h(e,t){let n=[e];for(let e=0;e<t;e+=1){let e=[];for(let t of n)try{for(let n of await(0,w.readdir)(t,{withFileTypes:!0}))n.isDirectory()&&e.push((0,E.join)(t,n.name))}catch{}if(n=e,!n.length)return[]}let r=[];for(let e of n)try{for(let t of await(0,w.readdir)(e,{withFileTypes:!0}))t.isFile()&&t.name.endsWith(`.jsonl`)&&r.push((0,E.join)(e,t.name))}catch{}return r}async function g(e,t){let n=[];for(let r of e.roots()){let e=await h(r.root,r.dirDepth);for(let r of e)try{let e=await(0,w.stat)(r);if(!e.isFile()||e.mtimeMs<t||e.size===0)continue;n.push({path:r,size:e.size,mtimeMs:e.mtimeMs})}catch{}}return n}async function _(e,t,n){let r=await(0,w.open)(e,`r`);try{let e=await r.stat();if(e.size<=t)return{turns:[],newOffset:t};let i=Math.min(e.size-t,j),a=Buffer.alloc(i);await r.read(a,0,i,t);let o=a.toString(`utf8`),s=o.lastIndexOf(`
`);if(s<0)return{turns:[],newOffset:t};let c=o.slice(0,s+1),l=[];for(let e of c.split(`
`)){if(!e.trim())continue;let t=n(e);t&&l.push(t)}return{turns:l,newOffset:t+Buffer.byteLength(c,`utf8`)}}finally{await r.close()}}async function v(e,t){return t.length?(await e`
    INSERT INTO harness_shared.session_turns ${e(t,`workspace_id`,`source_kind`,`session_id`,`turn_idx`,`ts`,`owner`,`harness_slug`,`cwd`,`speaker`,`text`)}
    ON CONFLICT DO NOTHING
  `).count??t.length:0}async function y(e,t,n){let r=await e`
    SELECT byte_offset, turn_count FROM harness_shared.session_ingest_state
     WHERE source_kind = ${t} AND file_path = ${n}
  `;return r.length?{byte_offset:Number(r[0].byte_offset),turn_count:r[0].turn_count}:{byte_offset:0,turn_count:0}}async function b(e,t,n,r){await e`
    INSERT INTO harness_shared.session_ingest_state
      (source_kind, file_path, byte_offset, turn_count, session_id, mtime_ms, last_error, updated_at)
    VALUES (${t}, ${n}, ${r.byte_offset}, ${r.turn_count},
            ${r.sessionId??null}, ${r.mtimeMs==null?null:Math.round(r.mtimeMs)}, ${r.lastError??null}, now())
    ON CONFLICT (source_kind, file_path) DO UPDATE SET
      byte_offset = EXCLUDED.byte_offset,
      turn_count  = EXCLUDED.turn_count,
      session_id  = COALESCE(EXCLUDED.session_id, harness_shared.session_ingest_state.session_id),
      mtime_ms    = EXCLUDED.mtime_ms,
      last_error  = EXCLUDED.last_error,
      updated_at  = now()
  `}async function x(e,t){let n=await e`
    SELECT mtime_ms FROM harness_shared.session_ingest_state
     WHERE source_kind = 'agent_chat' AND file_path = ${z}
  `,r=n.length?Number(n[0].mtime_ms??0):0,i=await e`
    SELECT workspace_id, harness_slug, id, transcript, updated_at
      FROM harness_shared.agent_chats_consolidated
     WHERE updated_at > ${r} AND transcript IS NOT NULL
     ORDER BY updated_at ASC
     LIMIT ${M}
  `;if(!i.length)return 0;let a=0,o=r;for(let n of i){if(t.turns<=0)break;let r=Array.isArray(n.transcript)?n.transcript:[],i=`chat:${n.workspace_id}:${n.harness_slug}:${n.id}`,s=await y(e,`agent_chat`,i);if(r.length<=s.turn_count){o=Math.max(o,Number(n.updated_at));continue}let c=[];for(let e=s.turn_count;e<r.length;e+=1){let t=r[e],i=t.role===`user`?`user`:t.role===`assistant`?`assistant`:null;if(!i)continue;let a=l(typeof t.content==`string`?t.content:u(t.content));a&&c.push({workspace_id:n.workspace_id,source_kind:`agent_chat`,session_id:n.id,turn_idx:e,ts:d(t.ts)?.toISOString()??null,owner:null,harness_slug:n.harness_slug,cwd:null,speaker:i,text:a})}a+=await v(e,c),await b(e,`agent_chat`,i,{byte_offset:0,turn_count:r.length,sessionId:n.id}),t.turns-=c.length,o=Math.max(o,Number(n.updated_at))}return await b(e,`agent_chat`,z,{byte_offset:0,turn_count:0,mtimeMs:o}),a}async function S(){let{sql:e}=s(),t=0;for(let n=0;n<40;n+=1){let n=await e`
      DELETE FROM harness_shared.session_turns
       WHERE ctid IN (
         SELECT ctid FROM harness_shared.session_turns
          WHERE COALESCE(ts, ingested_at) < now() - make_interval(days => ${O})
          LIMIT 5000
       )
    `;if(t+=n.count??0,(n.count??0)<5e3)break}return await e`
    DELETE FROM harness_shared.session_ingest_state
     WHERE updated_at < now() - make_interval(days => ${O*2})
       AND file_path <> ${z}
  `,{deleted:t}}async function C(){let e=Date.now(),t={filesScanned:0,filesIngested:0,turnsInserted:0,chatsIngested:0,errors:0,durationMs:0};if(V.running)return{...t,skipped:`already_running`};V.running=!0;try{let r=!0;try{r=await i(n.SESSION_SEARCH,`system:session-ingest`)}catch{}if(!r)return{...t,skipped:`flag_off`};let{sql:a}=s(),o=Date.now()-D*24*3600*1e3,c={turns:A};for(let e of R){if(c.turns<=0)break;let n=[];try{n=await g(e,o)}catch(n){t.errors+=1,console.warn(`[session-ingest] ${e.sourceKind} enumerate failed: ${n.message}`);continue}n.sort((e,t)=>t.mtimeMs-e.mtimeMs);let r=await a`
        SELECT file_path, byte_offset, turn_count
          FROM harness_shared.session_ingest_state
         WHERE source_kind = ${e.sourceKind}
      `,i=new Map(r.map(e=>[e.file_path,{byte_offset:Number(e.byte_offset),turn_count:e.turn_count}])),s=0;for(let r of n){if(c.turns<=0||s>=k)break;t.filesScanned+=1;try{let n=i.get(r.path)??{byte_offset:0,turn_count:0};if(r.size<=n.byte_offset)continue;s+=1;let{turns:o,newOffset:l}=await _(r.path,n.byte_offset,e.parseLine);if(l===n.byte_offset)continue;let u=e.meta(r.path),d=o.map((t,r)=>({workspace_id:`default`,source_kind:e.sourceKind,session_id:t.sessionId??u.sessionId,turn_idx:n.turn_count+r,ts:t.ts?t.ts.toISOString():null,owner:u.owner,harness_slug:null,cwd:t.cwd??null,speaker:t.speaker,text:t.text}));t.turnsInserted+=await v(a,d),await b(a,e.sourceKind,r.path,{byte_offset:l,turn_count:n.turn_count+o.length,sessionId:u.sessionId,mtimeMs:r.mtimeMs}),t.filesIngested+=1,c.turns-=o.length}catch(n){t.errors+=1,(t.errorSample??=[]).length<3&&t.errorSample.push(`${r.path.split(`/`).pop()}: ${n.message.slice(0,200)}`);try{await a`
              UPDATE harness_shared.session_ingest_state
                 SET last_error = ${n.message.slice(0,300)}, updated_at = now()
               WHERE source_kind = ${e.sourceKind} AND file_path = ${r.path}
            `}catch{}}}}if(c.turns>0)try{t.chatsIngested=await x(a,c)}catch(e){t.errors+=1,console.warn(`[session-ingest] agent_chat sync failed: ${e.message}`)}return t.durationMs=Date.now()-e,V.last=t,t}finally{V.running=!1}}var w,T,E,D,O,k,A,j,M,N,P,F,I,L,R,z,B,V;e((()=>{w=t(o(),1),T=t(o(),1),E=t(o(),1),c(),a(),r(),D=45,O=45,k=200,A=4e3,j=5*1024*1024,M=50,N=8e3,P=3,F=/\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})\b/g,I=[`<system-reminder`,`<local-command`,`<command-name`,`<user_instructions>`,`<permissions instructions>`,`<environment_context>`,`Caveat: The messages below`],L=(0,T.homedir)(),R=[{sourceKind:`claude`,roots:()=>[{root:(0,E.join)(L,`.claude`,`projects`),dirDepth:1},{root:(0,E.join)(L,`.papercusp`,`session-claude`),dirDepth:3}],parseLine:f,meta:e=>{let t=e.match(/\/session-claude\/([^/]+)\//);return{sessionId:(0,E.basename)(e,`.jsonl`),owner:t?t[1]:null}}},{sourceKind:`omp`,roots:()=>[{root:(0,E.join)(L,`.omp`,`agent`,`sessions`),dirDepth:1}],parseLine:p,meta:e=>{let t=(0,E.basename)(e,`.jsonl`),n=t.indexOf(`_`);return{sessionId:n>=0?t.slice(n+1):t,owner:null}}},{sourceKind:`codex`,roots:()=>[{root:(0,E.join)(L,`.codex`,`sessions`),dirDepth:3}],parseLine:m,meta:e=>{let t=(0,E.basename)(e,`.jsonl`),n=t.match(/([0-9a-f]{8}-[0-9a-f-]{27,})$/i);return{sessionId:n?n[1]:t,owner:null}}}],z=`__hwm__`,B=Symbol.for(`papercusp.sessionIngestState`),V=(()=>{let e=globalThis;return e[B]||(e[B]={running:!1,last:null}),e[B]})()}))();export{S as pruneSessionTurnsOnce,C as runSessionIngestOnce};