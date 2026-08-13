import{n as G,o as j}from"./chunk-ChpBd9eV.js";import{s as Ot}from"./types-B6UfiA7g.js";import{t as At}from"./src-CL56NiZm.js";import{n as xt,t as Dt}from"./src-6Py4l2MU.js";import{r as vt}from"./machine-surface-catalogue-AtBx-9cm.js";import{st as U,t as nt}from"./src-BmBNODK0.js";import{t as H}from"./__vite-browser-external-56mrcCg8.js";import{l as Rt,o as $t}from"./server-CB1HiStO.js";import{c as Mt,r as ot}from"./workspace-registry-Du2UbhlH.js";import{r as Ut,t as Ft}from"./turn-ref-MFkZYzLS.js";import{c as Pt,i as jt,l as Ht,n as Kt,r as Bt,s as Wt}from"./match-CYTPxrpt.js";import{a as Xt,r as zt}from"./event-loop-lag-monitor-bF1lAueB.js";import{n as Yt,r as rt,t as Jt}from"./sensitive-text-DOcS0s4f.js";async function Gt(s,t){return(await(t??U().sql)`
    SELECT intent_label, bash_pattern, bash_pattern_flags, tool_name,
           tier, advisory_text, equivalence_verdict
      FROM harness_shared.bash_tool_substitutions
     WHERE workspace_id = ${s}
       AND enabled
     ORDER BY intent_label
  `).map(e=>({intentLabel:e.intent_label,bashPattern:e.bash_pattern,bashPatternFlags:e.bash_pattern_flags??"",toolName:e.tool_name,tier:e.tier,advisoryText:e.advisory_text,equivalenceVerdict:e.equivalence_verdict}))}async function Vt(s,t=Date.now()){const e=z.get(s);if(e&&t-e.fetchedAt<3e4)return e.rows;try{const n=await Gt(s);return z.set(s,{rows:n,fetchedAt:t}),n}catch{return e?.rows??[]}}var Qt,z,Zt=G((()=>{nt(),Qt=3e4,z=new Map}));function qt(s){return`${s.day}	${s.toolName}	${s.verb??""}	${s.intentLabel??""}`}function it(s){if(!s)return null;const t=new Date(s);return Number.isNaN(t.getTime())?null:t.toISOString().slice(0,10)}function te(s){if(typeof s!="string"||!s.trim())return[];const t=[];for(const e of Pt(s)){const n=Wt(e);n&&t.push(n)}return t}function ee(s){let t;try{t=JSON.parse(s)}catch{return B}const e=t?.type;if(e!=="assistant"&&e!=="user")return B;const n=t.message;if(!n||!Array.isArray(n.content))return B;const o=typeof t.timestamp=="string"?t.timestamp:null,r=[];let a=0;for(const i of n.content){if(!i||typeof i!="object")continue;const l=i;if(l.type==="tool_use"&&typeof l.name=="string"&&l.name){const f=l.name===at,c=f&&typeof l.input?.command=="string"?l.input.command:null;r.push({toolName:l.name,verbs:f?te(c):[],command:c,ts:o});continue}l.type==="tool_result"&&(a+=se(l.content))}return{ts:o,toolUses:r,resultBytes:a}}function se(s){if(typeof s=="string")return Buffer.byteLength(s,"utf8");if(!Array.isArray(s))return 0;let t=0;for(const e of s){if(typeof e=="string"){t+=Buffer.byteLength(e,"utf8");continue}if(e&&typeof e=="object"){const n=e.text;typeof n=="string"&&(t+=Buffer.byteLength(n,"utf8"))}}return t}function ne(s,t,e,n=[]){const o=it(t.ts)??e;if(o){K(s,{day:o,toolName:t.toolName,verb:null,intentLabel:null},{calls:1,atoms:0,resultBytes:0});for(const r of t.verbs)K(s,{day:o,toolName:t.toolName,verb:r,intentLabel:null},{calls:0,atoms:1,resultBytes:0});if(!(t.command===null||n.length===0))for(const r of jt(Kt(t.command),n))K(s,{day:o,toolName:t.toolName,verb:null,intentLabel:r.intentLabel},{calls:0,atoms:1,resultBytes:0})}}function oe(s,t,e){t<=0||!e||K(s,{day:e,toolName:lt,verb:null,intentLabel:null},{calls:0,atoms:0,resultBytes:t})}function K(s,t,e){const n=qt(t),o=s.get(n);if(o){o.calls+=e.calls,o.atoms+=e.atoms,o.resultBytes+=e.resultBytes;return}s.set(n,{...t,...e})}function re(s){return[...s.values()].sort((t,e)=>t.day<e.day?-1:t.day>e.day?1:t.toolName<e.toolName?-1:t.toolName>e.toolName?1:(t.verb??"")<(e.verb??"")?-1:(t.verb??"")>(e.verb??"")?1:(t.intentLabel??"")<(e.intentLabel??"")?-1:(t.intentLabel??"")>(e.intentLabel??"")?1:0)}var at,B,lt,ie=G((()=>{Ht(),Bt(),at="Bash",B={ts:null,toolUses:[],resultBytes:0},lt="_result_bytes"}));function I(s){const t=s.trim();if(t.length<D)return null;for(const e of It)if(t.startsWith(e))return null;return rt(t.slice(0,wt))}function ae(s){const t=Yt(rt(s));return t.length>2e3?`${t.slice(0,J)}… [truncated ${t.length-J} chars]`:t}function C(s){if(typeof s=="string")return s;if(!Array.isArray(s))return"";const t=[];for(const e of s){if(!e||typeof e!="object")continue;const n=e;typeof n.text=="string"&&(n.type==="text"||n.type==="input_text"||n.type==="output_text")&&t.push(n.text)}return t.join(`
`)}function A(s){if(typeof s!="string"&&typeof s!="number")return null;const t=new Date(s);return Number.isNaN(t.getTime())?null:t}function le(s){let t;try{t=JSON.parse(s)}catch{return null}if(t.type!=="user"&&t.type!=="assistant")return null;const e=t.message;if(!e)return null;const n=e.role==="user"?"user":e.role==="assistant"?"assistant":null;if(!n)return null;const o=I(C(e.content));return o?{ts:A(t.timestamp),speaker:n,text:o,cwd:typeof t.cwd=="string"?t.cwd:null,sessionId:typeof t.sessionId=="string"?t.sessionId:null}:null}function et(s){if(typeof s=="string")return s;if(s==null)return"";if(Array.isArray(s)){const t=s.filter(e=>!!e&&typeof e=="object"&&typeof e.text=="string").map(e=>e.text);if(t.length)return t.join(`
`)}try{return JSON.stringify(s)??""}catch{return""}}function ce(s){let t;try{t=JSON.parse(s)}catch{return[]}if(t.type!=="user"&&t.type!=="assistant")return[];const e=t.message;if(!e)return[];const n=e.role==="user"?"user":e.role==="assistant"?"assistant":null;if(!n)return[];const o=A(t.timestamp),r=typeof t.sessionId=="string"?t.sessionId:null,a=[],i=(f,c,m)=>{const _=ae(c);!_.trim()&&f!=="tool_use"||a.push({ts:o,speaker:n,partKind:f,toolName:m??null,text:_,sessionId:r})},l=e.content;if(typeof l=="string")return i("text",l),a;if(!Array.isArray(l))return a;for(const f of l){if(!f||typeof f!="object")continue;const c=f;switch(c.type){case"text":case"input_text":case"output_text":i("text",typeof c.text=="string"?c.text:"");break;case"thinking":i("thinking",typeof c.thinking=="string"?c.thinking:"");break;case"tool_use":i("tool_use",et(c.input),typeof c.name=="string"?c.name:null);break;case"tool_result":i("tool_result",et(c.content));break;default:break}}return a}function ue(s){let t;try{t=JSON.parse(s)}catch{return null}if(t.type!=="message")return null;const e=t.message;if(!e)return null;const n=e.role==="user"?"user":e.role==="assistant"?"assistant":null;if(!n)return null;const o=I(C(e.content));return o?{ts:A(t.timestamp),speaker:n,text:o}:null}function _e(s){let t;try{t=JSON.parse(s)}catch{return null}if(typeof t.session_id=="string"&&typeof t.text=="string"&&(typeof t.ts=="number"||typeof t.ts=="string")){const r=I(t.text);if(!r)return null;const a=t.ts;return{ts:typeof a=="number"&&a<1e10?new Date(a*1e3):A(a),speaker:"user",text:r,sessionId:t.session_id}}if(t.type!=="response_item")return null;const e=t.payload;if(!e||e.type!=="message")return null;const n=e.role==="user"?"user":e.role==="assistant"?"assistant":null;if(!n)return null;const o=I(C(e.content));return o?{ts:A(t.timestamp),speaker:n,text:o}:null}function fe(s){let t;try{t=JSON.parse(s)}catch{return null}if(t.type!=="user"&&t.type!=="assistant")return null;const e=t.message;if(!e)return null;if(e.role==="user"){const n=e.content;return Array.isArray(n)&&n.some(o=>o&&typeof o=="object"&&o.type==="tool_result")?E:I(C(n))?{...E,isPrompt:!0}:E}if(e.role==="assistant"){const n=e.content;let o=!1,r=0;if(Array.isArray(n))for(const i of n){if(!i||typeof i!="object")continue;const l=i;l.type==="tool_use"&&(r+=1),l.type==="text"&&typeof l.text=="string"&&l.text.trim().length>=D&&(o=!0)}else typeof n=="string"&&n.trim().length>=D&&(o=!0);const a=o||r>0;return{isPrompt:!1,isResponsePayload:a,inferenceId:a?typeof e.id=="string"?e.id:typeof t.requestId=="string"?t.requestId:null:null,toolCallCount:r}}return null}function de(s){let t;try{t=JSON.parse(s)}catch{return null}if(t.type!=="message")return null;const e=t.message;if(!e)return null;if(e.role==="user")return I(C(e.content))?{...E,isPrompt:!0}:E;if(e.role==="toolResult")return E;if(e.role==="assistant"){const n=e.content;let o=!1,r=0;if(Array.isArray(n))for(const i of n){if(!i||typeof i!="object")continue;const l=i;l.type==="toolCall"&&(r+=1),l.type==="text"&&typeof l.text=="string"&&l.text.trim().length>=D&&(o=!0)}else typeof n=="string"&&n.trim().length>=D&&(o=!0);const a=o||r>0;return{isPrompt:!1,isResponsePayload:a,inferenceId:a&&typeof t.id=="string"?t.id:null,toolCallCount:r}}return null}function pe(s){let t;try{t=JSON.parse(s)}catch{return null}if(typeof t.session_id=="string"&&typeof t.text=="string")return I(t.text)?{...E,isPrompt:!0}:E;if(t.type!=="response_item")return null;const e=t.payload;return e?e.type==="function_call"||e.type==="custom_tool_call"?{...E,toolCallCount:1}:e.type!=="message"?null:e.role==="user"?I(C(e.content))?{...E,isPrompt:!0}:E:e.role==="assistant"?{isPrompt:!1,isResponsePayload:!0,inferenceId:typeof e.id=="string"?e.id:null,toolCallCount:0}:null:null}function ct(s){const t=(0,g.basename)(s,".jsonl"),e=t.match(/([0-9a-f]{8}-[0-9a-f-]{27,})$/i),n=s.match(/^(.*\/su-codex-homes\/session-[^/]+)\/sessions\//);let o=null;if(n)try{const r=JSON.parse((0,Z.readFileSync)((0,g.join)(n[1],"papercusp-diagnostics.json"),"utf8"));typeof r.lockOwnerSid=="string"&&r.lockOwnerSid.trim()&&(o=r.lockOwnerSid)}catch{}return{sessionId:e?e[1]:t,owner:o}}function me(s){let t=null,e=null,n=!1;for(const o of s.split(/\r?\n/)){if(/^\s*\[/.test(o)){n=!0;continue}if(n)continue;const r=o.match(/^\s*(model|model_reasoning_effort)\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/);r&&(r[1]==="model"?t=r[2]:e=r[2])}return{model:t,effort:e}}function he(s){const t=s.match(/(?:^|\/)(su-codex-homes\/session-(\d+))(?:\/|$)/);if(!t)return null;const e=Number(t[2]);if(!Number.isSafeInteger(e)||e<=0)return null;const n=`/${t[1]}`,o=s.indexOf(n);return{advSessionId:e,home:o>=0?s.slice(0,o+n.length):""}}function ut(s,t){const e=he(s);if(!e)return null;const n=t?.trim()||ct(s).sessionId;if(!Nt.test(n))return null;let o=null,r=null;try{const a=me((0,Z.readFileSync)((0,g.join)(e.home,"config.toml"),"utf8"));o=a.model,r=a.effort}catch{}return{advSessionId:e.advSessionId,sessionId:n,model:o,effort:r}}async function ye(s,t,e){let n=[s];for(let r=0;r<t;r+=1){const a=[];for(const i of n)try{for(const l of await(0,x.readdir)(i,{withFileTypes:!0}))l.isDirectory()&&(e&&!e(l.name,r+1)||a.push((0,g.join)(i,l.name)))}catch{}if(n=a,!n.length)return[]}const o=[];for(const r of n)try{for(const a of await(0,x.readdir)(r,{withFileTypes:!0}))a.isFile()&&a.name.endsWith(".jsonl")&&o.push((0,g.join)(r,a.name))}catch{}return o}function ge(s){return s.speaker==="user"&&Ct.has(s.source_kind)}async function be(s,t){const e=[];for(const n of s.roots()){const o=await ye(n.root,n.dirDepth,n.descend);for(const r of o)try{const a=await(0,x.stat)(r);if(!a.isFile()||a.mtimeMs<t||a.size===0)continue;e.push({path:r,size:a.size,mtimeMs:a.mtimeMs})}catch{}}return e}async function V(s,t,e,n,o,r,a=[],i){const l=new Map,f=await(0,x.open)(s,"r");try{const c=await f.stat();if(c.size<=t)return{turns:[],parts:[],newOffset:t,promptCount:0,responseCount:0,toolCallCount:0,lastInferenceId:o,usage:l};const m=Math.min(c.size-t,bt),_=Buffer.alloc(m);await f.read(_,0,m,t);const y=_.toString("utf8"),u=y.lastIndexOf(`
`);if(u<0){let w=t+m;for(;w<c.size;){const b=Math.min(1048576,c.size-w),h=Buffer.alloc(b);await f.read(h,0,b,w);const O=h.indexOf(10);if(O>=0)return{turns:[],parts:[],newOffset:w+O+1,promptCount:0,responseCount:0,toolCallCount:0,lastInferenceId:o,usage:l};w+=b}return{turns:[],parts:[],newOffset:t,promptCount:0,responseCount:0,toolCallCount:0,lastInferenceId:o,usage:l}}const d=y.slice(0,u+1),p=[],S=[];let v=0,T=0,F=0,R=o,P=0;for(const k of d.split(`
`)){if(k.trim()){const w=e(k);if(w&&p.push(w),i)try{for(const h of i(k))S.push(h)}catch{}const b=n(k);if(b&&(b.isPrompt&&(v+=1),F+=b.toolCallCount,b.isResponsePayload&&((b.inferenceId===null||b.inferenceId!==R)&&(T+=1),R=b.inferenceId)),r)try{const h=r(k);for(const O of h.toolUses)ne(l,O,null,a);h.resultBytes>0&&oe(l,h.resultBytes,it(h.ts))}catch{}}P=await zt(P,Et)}return{turns:p,parts:S,newOffset:t+Buffer.byteLength(d,"utf8"),promptCount:v,responseCount:T,toolCallCount:F,lastInferenceId:R,usage:l}}finally{await f.close()}}async function Ee(s,t,e,n){const o=re(n);if(!o.length)return;const r=o.map(_=>_.day),a=o.map(_=>_.toolName),i=o.map(_=>_.verb??""),l=o.map(_=>_.intentLabel??""),f=o.map(_=>_.calls),c=o.map(_=>_.atoms),m=o.map(_=>_.resultBytes);await s`
    INSERT INTO harness_shared.tool_usage_rollup
      (workspace_id, source_kind, session_id, day, tool_name, verb, intent_label, calls, atoms, result_bytes)
    SELECT 'default', ${t}, ${e}, d::date, t, v, i, c, a, b
      FROM UNNEST(
        ${s.array(r)}::text[], ${s.array(a)}::text[], ${s.array(i)}::text[],
        ${s.array(l)}::text[],
        ${s.array(f)}::bigint[], ${s.array(c)}::bigint[], ${s.array(m)}::bigint[]
      ) AS u(d, t, v, i, c, a, b)
    ON CONFLICT (workspace_id, source_kind, session_id, day, tool_name, verb, intent_label) DO UPDATE
      SET calls        = harness_shared.tool_usage_rollup.calls + EXCLUDED.calls,
          atoms        = harness_shared.tool_usage_rollup.atoms + EXCLUDED.atoms,
          result_bytes = harness_shared.tool_usage_rollup.result_bytes + EXCLUDED.result_bytes,
          updated_at   = now()
  `}function _t(s){if(s.turn_origin_classifier_version=5,s.speaker!=="user"){s.turn_origin=null,s.turn_origin_verdict="not-user-turn";return}const{verdict:t,origin:e}=Ft(s.text);if(ge(s)&&t==="owner-typed"){s.turn_origin=null,s.turn_origin_verdict=Lt;return}s.turn_origin=e,s.turn_origin_verdict=t}async function Q(s,t){if(!t.length)return 0;for(const e of t)_t(e);return(await s`
    INSERT INTO harness_shared.session_turns ${s(t,"workspace_id","source_kind","session_id","turn_idx","ts","owner","harness_slug","cwd","speaker","text","turn_origin","turn_origin_verdict","turn_origin_classifier_version")}
    ON CONFLICT DO NOTHING
  `).count??t.length}function ft(s,t){return s.map((e,n)=>({workspace_id:"default",source_kind:t.sourceKind,session_id:e.sessionId??t.sessionId,part_idx:t.partCount+n,ts:e.ts?e.ts.toISOString():null,owner:t.owner,speaker:e.speaker,part_kind:e.partKind,tool_name:e.toolName??null,text:e.text}))}async function dt(s,t){return t.length?(await s`
    INSERT INTO harness_shared.session_turn_parts ${s(t,"workspace_id","source_kind","session_id","part_idx","ts","owner","speaker","part_kind","tool_name","text")}
    ON CONFLICT DO NOTHING
  `).count??t.length:0}async function Se(s,t,e){if(!e.size)return;const n=[...e.keys()],o=n.map(r=>e.get(r));await s`
    UPDATE harness_shared.session_turns AS turns
       SET owner = resolved.owner
      FROM UNNEST(${s.array(n)}::text[], ${s.array(o)}::text[])
           AS resolved(session_id, owner)
     WHERE turns.workspace_id = 'default'
       AND turns.source_kind = ${t}
       AND turns.session_id = resolved.session_id
       AND turns.owner IS DISTINCT FROM resolved.owner
  `}async function pt(s,t){if(!t.size)return 0;const e=[...t.values()],n=e.map(i=>String(i.advSessionId)),o=e.map(i=>i.sessionId),r=e.map(i=>i.model??""),a=e.map(i=>i.effort??"");return(await s`
    WITH resolved (id, session_id, model, effort) AS (
      SELECT id, session_id, NULLIF(model, ''), NULLIF(effort, '')
        FROM UNNEST(
          ${s.array(n)}::bigint[],
          ${s.array(o)}::text[],
          ${s.array(r)}::text[],
          ${s.array(a)}::text[]
        ) AS candidate(id, session_id, model, effort)
    )
    UPDATE harness_shared.adv_sessions AS sessions
       SET session_id = COALESCE(sessions.session_id, resolved.session_id),
           launch_spec = CASE
             WHEN sessions.launch_spec IS NULL
              AND resolved.model IS NULL
              AND resolved.effort IS NULL
             THEN NULL
             ELSE COALESCE(sessions.launch_spec, '{}'::jsonb)
               || CASE
                    WHEN resolved.model IS NOT NULL
                     AND sessions.launch_spec->>'model' IS NULL
                    THEN jsonb_build_object('model', resolved.model)
                    ELSE '{}'::jsonb
                  END
               || CASE
                    WHEN resolved.effort IS NOT NULL
                     AND sessions.launch_spec->>'effort' IS NULL
                    THEN jsonb_build_object('effort', resolved.effort)
                    ELSE '{}'::jsonb
                  END
           END
      FROM resolved
     WHERE sessions.workspace_id = ${ot()}
       AND sessions.id = resolved.id
       AND (
         sessions.session_id IS NULL
         OR (resolved.model IS NOT NULL AND sessions.launch_spec->>'model' IS NULL)
         OR (resolved.effort IS NOT NULL AND sessions.launch_spec->>'effort' IS NULL)
       )
    RETURNING sessions.id
  `).length}async function we(s,t=Tt){const e=await s`
    SELECT workspace_id, source_kind, session_id, turn_idx, speaker,
           left(text, ${240}) AS head
      FROM harness_shared.session_turns
     WHERE turn_origin_classifier_version IS NULL
        OR turn_origin_classifier_version < ${5}
     -- STALE-VERSION ROWS FIRST, never-classified rows after. The two
     -- populations are NOT equally harmful, and a plain LIMIT serves them in
     -- physical order, which starves the harmful one: measured on the first
     -- real sweep, 20,000 rows drained entirely from the NULL backlog while all
     -- 2,435 version-below-current rows sat untouched behind it.
     --
     -- A NULL row is HONEST - it asserts nothing, and every reader is told NULL
     -- means "never classified". A stale-version row carries a CONCRETE verdict
     -- with a stored column's authority, and that stale verdict is
     -- disproportionately the owner-typed RESIDUAL, precisely because the
     -- residual is what each newer catalogue is written to stop over-assigning.
     -- So the rows that actively misattribute machine text to the owner drain
     -- first; the ones that merely say nothing wait.
     --
     -- DESC NULLS LAST orders non-NULL versions ahead of NULLs and is served by
     -- session_turns_provenance_version_idx rather than a sort of the backlog.
     ORDER BY turn_origin_classifier_version DESC NULLS LAST
     LIMIT ${t}
  `;if(!e.length)return{scanned:0,updated:0,more:!1};const n=[],o=[],r=[],a=[],i=[],l=[];for(const c of e){const m={source_kind:c.source_kind,speaker:c.speaker,text:c.head??""};_t(m),n.push(c.workspace_id),o.push(c.source_kind),r.push(c.session_id),a.push(c.turn_idx),i.push(m.turn_origin??null),l.push(m.turn_origin_verdict)}const f=await s`
    UPDATE harness_shared.session_turns AS turns
       SET turn_origin = resolved.turn_origin,
           turn_origin_verdict = resolved.turn_origin_verdict,
           turn_origin_classifier_version = ${5}
      FROM UNNEST(
             ${s.array(n)}::text[], ${s.array(o)}::text[],
             ${s.array(r)}::text[], ${s.array(a)}::int[],
             ${s.array(i)}::text[], ${s.array(l)}::text[]
           ) AS resolved(workspace_id, source_kind, session_id, turn_idx,
                         turn_origin, turn_origin_verdict)
     WHERE turns.workspace_id = resolved.workspace_id
       AND turns.source_kind = resolved.source_kind
       AND turns.session_id = resolved.session_id
       AND turns.turn_idx = resolved.turn_idx
  `;return{scanned:e.length,updated:f.count??e.length,more:e.length===t}}async function Ke(){const{sql:s}=U();let t=0,e=0,n=!1;for(let o=0;o<4;o+=1){const r=await we(s);if(t+=r.scanned,e+=r.updated,n=r.more,!r.more)break}return{scanned:t,updated:e,more:n}}async function mt(s,t,e){const n=await s`
    SELECT byte_offset, turn_count, part_count, prompt_count, response_count, tool_call_count, last_inference_id,
           counts_backfill_offset, counts_backfill_last_inference_id, counts_backfilled_at
      FROM harness_shared.session_ingest_state
     WHERE source_kind = ${t} AND file_path = ${e}
  `;if(!n.length)return{...tt};const o=n[0];return{byte_offset:Number(o.byte_offset),turn_count:o.turn_count,part_count:o.part_count??0,prompt_count:o.prompt_count??0,response_count:o.response_count??0,tool_call_count:o.tool_call_count??0,last_inference_id:o.last_inference_id??null,counts_backfill_offset:Number(o.counts_backfill_offset??0),counts_backfill_last_inference_id:o.counts_backfill_last_inference_id??null,counts_backfilled_at:o.counts_backfilled_at??null}}async function L(s,t,e,n){await s`
    INSERT INTO harness_shared.session_ingest_state
      (source_kind, file_path, byte_offset, turn_count, part_count, prompt_count, response_count,
       tool_call_count, last_inference_id, counts_backfill_offset, counts_backfill_last_inference_id, counts_backfilled_at,
       session_id, mtime_ms, last_error, updated_at)
    VALUES (${t}, ${e}, ${n.byte_offset}, ${n.turn_count}, ${n.part_count??0},
            ${n.prompt_count??0}, ${n.response_count??0}, ${n.tool_call_count??0}, ${n.last_inference_id??null},
            ${n.counts_backfill_offset??n.byte_offset}, ${n.counts_backfill_last_inference_id??null}, ${n.counts_backfilled_at??null},
            ${n.sessionId??null}, ${n.mtimeMs!=null?Math.round(n.mtimeMs):null}, ${n.lastError??null}, now())
    ON CONFLICT (source_kind, file_path) DO UPDATE SET
      byte_offset       = EXCLUDED.byte_offset,
      turn_count        = EXCLUDED.turn_count,
      -- P-001: PRESERVE on omission, don't zero. Several callers write this row
      -- without knowing the parts cursor at all (the counts backfill, the
      -- agent_chat sync, the CHAT_HWM row) — with plain EXCLUDED semantics each
      -- of those ticks would silently reset part_count to 0 and the next real
      -- ingest would renumber parts from 0, colliding with existing part_idx
      -- values and losing the whole tail to ON CONFLICT DO NOTHING. Passing an
      -- explicit 0 still resets it, which is what a deliberate re-ingest wants.
      part_count        = COALESCE(${n.part_count??null}, harness_shared.session_ingest_state.part_count),
      prompt_count      = EXCLUDED.prompt_count,
      response_count    = EXCLUDED.response_count,
      tool_call_count   = EXCLUDED.tool_call_count,
      last_inference_id = EXCLUDED.last_inference_id,
      counts_backfill_offset = EXCLUDED.counts_backfill_offset,
      counts_backfill_last_inference_id = COALESCE(EXCLUDED.counts_backfill_last_inference_id, harness_shared.session_ingest_state.counts_backfill_last_inference_id),
      counts_backfilled_at = COALESCE(EXCLUDED.counts_backfilled_at, harness_shared.session_ingest_state.counts_backfilled_at),
      session_id        = COALESCE(EXCLUDED.session_id, harness_shared.session_ingest_state.session_id),
      mtime_ms          = EXCLUDED.mtime_ms,
      last_error        = EXCLUDED.last_error,
      updated_at        = now()
  `}async function ke(s,t,e,n){if(n.files<=0||n.bytes<=0)return!1;const o=t.meta(e.file_path);let r;try{const y=await(0,x.stat)(e.file_path);if(!y.isFile())throw new Error("not a file");r=y.size}catch{return await L(s,t.sourceKind,e.file_path,{byte_offset:e.byte_offset,turn_count:e.turn_count,prompt_count:e.prompt_count,response_count:e.response_count,tool_call_count:e.tool_call_count,last_inference_id:e.last_inference_id,counts_backfill_offset:e.counts_backfill_offset,counts_backfill_last_inference_id:e.counts_backfill_last_inference_id,counts_backfilled_at:new Date().toISOString(),sessionId:e.session_id??o.sessionId,lastError:"counts_backfill_source_missing"}),n.files-=1,!0}let a=Math.min(e.counts_backfill_offset,r),i=e.prompt_count,l=e.response_count,f=e.tool_call_count,c=e.counts_backfill_last_inference_id,m=!1;for(;a<r&&n.bytes>0;){const y=await V(e.file_path,a,t.parseLine,t.classifyLine,c);if(y.newOffset===a)break;const u=y.newOffset-a;a=y.newOffset,i+=y.promptCount,l+=y.responseCount,f+=y.toolCallCount,c=y.lastInferenceId,n.bytes-=u,m=!0}const _=a>=r;return(m||_)&&await L(s,t.sourceKind,e.file_path,{byte_offset:e.byte_offset,turn_count:e.turn_count,prompt_count:i,response_count:l,tool_call_count:f,last_inference_id:c,counts_backfill_offset:a,counts_backfill_last_inference_id:c,counts_backfilled_at:_?new Date().toISOString():null,sessionId:e.session_id??o.sessionId}),(m||_)&&(n.files-=1),m||_}async function Ie(s){const t={files:Y,bytes:St};let e=0;for(const n of X){if(t.files<=0||t.bytes<=0)break;const o=await s`
      SELECT file_path, byte_offset, turn_count, part_count, prompt_count, response_count,
             tool_call_count, last_inference_id, counts_backfill_offset,
             counts_backfill_last_inference_id, counts_backfilled_at, session_id
        FROM harness_shared.session_ingest_state
       WHERE source_kind = ${n.sourceKind}
         AND counts_backfilled_at IS NULL
       ORDER BY updated_at ASC, file_path ASC
       LIMIT ${Y}
    `;for(const r of o){if(t.files<=0||t.bytes<=0)break;await ke(s,n,{file_path:r.file_path,byte_offset:Number(r.byte_offset),turn_count:r.turn_count,part_count:r.part_count??0,prompt_count:r.prompt_count??0,response_count:r.response_count??0,tool_call_count:r.tool_call_count??0,last_inference_id:r.last_inference_id??null,counts_backfill_offset:Number(r.counts_backfill_offset??0),counts_backfill_last_inference_id:r.counts_backfill_last_inference_id??null,counts_backfilled_at:r.counts_backfilled_at??null,session_id:r.session_id??null},t)&&(e+=1)}}if(t.files>0){const n=await s`
      SELECT st.file_path, st.byte_offset, st.turn_count, st.prompt_count,
             st.response_count, st.tool_call_count, st.last_inference_id,
             st.counts_backfill_offset, st.session_id, c.transcript
        FROM harness_shared.session_ingest_state AS st
        JOIN harness_shared.agent_chats_consolidated AS c
          ON st.file_path = ('chat:' || c.workspace_id || ':' || c.harness_slug || ':' || c.id)
       WHERE st.source_kind = 'agent_chat'
         AND st.file_path <> ${M}
         AND st.counts_backfilled_at IS NULL
       ORDER BY st.updated_at ASC, st.file_path ASC
       LIMIT ${q}
    `;for(const o of n){if(t.files<=0)break;const r=Array.isArray(o.transcript)?o.transcript:[];let a=o.prompt_count??0,i=o.response_count??0;for(const l of r)l.role==="user"?a+=1:l.role==="assistant"&&(i+=1);await L(s,"agent_chat",o.file_path,{byte_offset:Number(o.byte_offset),turn_count:o.turn_count,prompt_count:a,response_count:i,tool_call_count:o.tool_call_count??0,last_inference_id:o.last_inference_id??null,counts_backfill_offset:r.length,counts_backfill_last_inference_id:null,counts_backfilled_at:new Date().toISOString(),sessionId:o.session_id}),t.files-=1,e+=1}}return e}async function Be(s,t={}){const e=X.find(a=>a.roots().some(i=>s.startsWith(i.root)));if(!e)return{inserted:0};const{sql:n}=U();let o=0;const r=e.meta(s);if(e.sourceKind==="codex")try{const a=ut(s,t.sessionId);a&&await pt(n,new Map([[a.advSessionId,a]]))}catch(a){process.stderr.write(`[session-ingest] codex adv metadata backfill skipped: ${a.message}
`)}for(let a=0;a<32;a+=1){const i=await mt(n,e.sourceKind,s),{turns:l,parts:f,newOffset:c,promptCount:m,responseCount:_,toolCallCount:y,lastInferenceId:u}=await V(s,i.byte_offset,e.parseLine,e.classifyLine,i.last_inference_id,void 0,[],e.parseParts);if(c===i.byte_offset)break;const d=l.map((p,S)=>({workspace_id:"default",source_kind:e.sourceKind,session_id:p.sessionId??t.sessionId??r.sessionId,turn_idx:i.turn_count+S,ts:p.ts?p.ts.toISOString():null,owner:t.owner??r.owner,harness_slug:null,cwd:p.cwd??null,speaker:p.speaker,text:p.text}));o+=await Q(n,d);try{await dt(n,ft(f,{sourceKind:e.sourceKind,sessionId:t.sessionId??r.sessionId,owner:t.owner??r.owner,partCount:i.part_count}))}catch(p){console.warn(`[session-ingest] parts write skipped (non-fatal): ${p.message}`)}await L(n,e.sourceKind,s,{byte_offset:c,turn_count:i.turn_count+l.length,part_count:i.part_count+f.length,prompt_count:i.prompt_count+m,response_count:i.response_count+_,tool_call_count:i.tool_call_count+y,last_inference_id:u,counts_backfill_offset:c,counts_backfill_last_inference_id:u,counts_backfilled_at:new Date().toISOString(),sessionId:t.sessionId??r.sessionId})}return{inserted:o}}async function Ne(s,t){const e=await s`
    SELECT mtime_ms FROM harness_shared.session_ingest_state
     WHERE source_kind = 'agent_chat' AND file_path = ${M}
  `,n=e.length?Number(e[0].mtime_ms??0):0,o=await s`
    SELECT workspace_id, harness_slug, id, transcript, updated_at
      FROM harness_shared.agent_chats_consolidated
     WHERE updated_at > ${n} AND transcript IS NOT NULL
     ORDER BY updated_at ASC
     LIMIT ${q}
  `;if(!o.length)return 0;let r=0,a=n;for(const i of o){if(t.turns<=0)break;const l=Array.isArray(i.transcript)?i.transcript:[],f=`chat:${i.workspace_id}:${i.harness_slug}:${i.id}`,c=await mt(s,"agent_chat",f);if(l.length<=c.turn_count){a=Math.max(a,Number(i.updated_at));continue}const m=[];let _=0,y=0;for(let u=c.turn_count;u<l.length;u+=1){const d=l[u],p=d.role==="user"?"user":d.role==="assistant"?"assistant":null;if(!p)continue;const S=I(typeof d.content=="string"?d.content:C(d.content));S&&(p==="user"?_+=1:y+=1,m.push({workspace_id:i.workspace_id,source_kind:"agent_chat",session_id:i.id,turn_idx:u,ts:A(d.ts)?.toISOString()??null,owner:null,harness_slug:i.harness_slug,cwd:null,speaker:p,text:S}))}r+=await Q(s,m),await L(s,"agent_chat",f,{byte_offset:0,turn_count:l.length,prompt_count:c.prompt_count+_,response_count:c.response_count+y,tool_call_count:c.tool_call_count,counts_backfill_offset:l.length,counts_backfill_last_inference_id:null,counts_backfilled_at:new Date().toISOString(),sessionId:i.id}),t.turns-=m.length,a=Math.max(a,Number(i.updated_at))}return await L(s,"agent_chat",M,{byte_offset:0,turn_count:0,counts_backfilled_at:new Date().toISOString(),mtimeMs:a}),r}async function We(){const{sql:s}=U();let t=0,e=0;for(let n=0;n<40;n+=1){const o=await s`
      DELETE FROM harness_shared.session_turns
       WHERE ctid IN (
         SELECT ctid FROM harness_shared.session_turns
          WHERE COALESCE(ts, ingested_at) < now() - make_interval(days => ${W})
          LIMIT 5000
       )
    `;if(t+=o.count??0,(o.count??0)<5e3)break}await s`
    DELETE FROM harness_shared.session_ingest_state
     WHERE updated_at < now() - make_interval(days => ${W*2})
       AND file_path <> ${M}
  `,await s`
    DELETE FROM harness_shared.session_turn_journal
     WHERE created_at < now() - make_interval(days => ${W})
  `;for(let n=0;n<40;n+=1){const o=await s`
      DELETE FROM harness_shared.session_turn_parts
       WHERE ctid IN (
         SELECT ctid FROM harness_shared.session_turn_parts
          WHERE COALESCE(ts, ingested_at) < now() - make_interval(days => ${kt})
          LIMIT 5000
       )
    `;if(e+=o.count??0,(o.count??0)<5e3)break}return{deleted:t,partsDeleted:e}}async function Xe(){const s=Date.now(),t={filesScanned:0,filesIngested:0,turnsInserted:0,chatsIngested:0,countBackfillFiles:0,errors:0,durationMs:0};if($.running)return{...t,skipped:"already_running"};$.running=!0;try{let e=!0;try{e=await $t(Ot.SESSION_SEARCH,"system:session-ingest")}catch{}if(!e)return{...t,skipped:"flag_off"};const{sql:n}=U();try{t.countBackfillFiles=await Ie(n)}catch(i){t.errors+=1,console.warn(`[session-ingest] historical count backfill skipped (non-fatal): ${i.message}`)}const o=Date.now()-ht*24*3600*1e3,r={turns:gt};let a=[];try{a=await Vt(ot())}catch(i){t.errors+=1,console.warn(`[session-ingest] substitution registry read failed (buckets skipped): ${i.message}`)}for(const i of X){if(r.turns<=0)break;let l=[];try{l=await be(i,o)}catch(u){t.errors+=1,console.warn(`[session-ingest] ${i.sourceKind} enumerate failed: ${u.message}`);continue}l.sort((u,d)=>d.mtimeMs-u.mtimeMs);const f=await n`
        SELECT file_path, byte_offset, turn_count, part_count, prompt_count, response_count, tool_call_count, last_inference_id,
               counts_backfill_offset, counts_backfill_last_inference_id, counts_backfilled_at
          FROM harness_shared.session_ingest_state
         WHERE source_kind = ${i.sourceKind}
      `,c=new Map(f.map(u=>[u.file_path,{byte_offset:Number(u.byte_offset),turn_count:u.turn_count,part_count:u.part_count??0,prompt_count:u.prompt_count??0,response_count:u.response_count??0,tool_call_count:u.tool_call_count??0,last_inference_id:u.last_inference_id??null,counts_backfill_offset:Number(u.counts_backfill_offset??u.byte_offset),counts_backfill_last_inference_id:u.counts_backfill_last_inference_id??null,counts_backfilled_at:u.counts_backfilled_at??null}]));let m=0;const _=new Map,y=new Map;for(const u of l){if(r.turns<=0||m>=yt)break;t.filesScanned+=1;try{const d=c.get(u.path)??{...tt},p=i.meta(u.path);if(p.owner&&_.set(p.sessionId,p.owner),i.sourceKind==="codex"){const h=ut(u.path);h&&!y.has(h.advSessionId)&&y.set(h.advSessionId,h)}if(u.size<=d.byte_offset)continue;m+=1;const{turns:S,parts:v,newOffset:T,promptCount:F,responseCount:R,toolCallCount:P,lastInferenceId:k,usage:w}=await V(u.path,d.byte_offset,i.parseLine,i.classifyLine,d.last_inference_id,i.usageOf,a,i.parseParts);if(T===d.byte_offset)continue;const b=S.map((h,O)=>({workspace_id:"default",source_kind:i.sourceKind,session_id:h.sessionId??p.sessionId,turn_idx:d.turn_count+O,ts:h.ts?h.ts.toISOString():null,owner:p.owner,harness_slug:null,cwd:h.cwd??null,speaker:h.speaker,text:h.text}));t.turnsInserted+=await Q(n,b);try{t.partsInserted=(t.partsInserted??0)+await dt(n,ft(v,{sourceKind:i.sourceKind,sessionId:p.sessionId,owner:p.owner,partCount:d.part_count}))}catch(h){(t.errorSample??=[]).length<3&&t.errorSample.push(`parts ${p.sessionId}: ${h.message.slice(0,160)}`)}await L(n,i.sourceKind,u.path,{byte_offset:T,turn_count:d.turn_count+S.length,part_count:d.part_count+v.length,prompt_count:d.prompt_count+F,response_count:d.response_count+R,tool_call_count:d.tool_call_count+P,last_inference_id:k,counts_backfill_offset:T,counts_backfill_last_inference_id:k,counts_backfilled_at:new Date().toISOString(),sessionId:p.sessionId,mtimeMs:u.mtimeMs});try{await Ee(n,i.sourceKind,p.sessionId,w)}catch(h){(t.errorSample??=[]).length<3&&t.errorSample.push(`usage-rollup ${p.sessionId}: ${h.message.slice(0,160)}`)}t.filesIngested+=1,r.turns-=S.length}catch(d){t.errors+=1,(t.errorSample??=[]).length<3&&t.errorSample.push(`${u.path.split("/").pop()}: ${d.message.slice(0,200)}`);try{await n`
              UPDATE harness_shared.session_ingest_state
                 SET last_error = ${d.message.slice(0,300)}, updated_at = now()
               WHERE source_kind = ${i.sourceKind} AND file_path = ${u.path}
            `}catch{}}}if(await Se(n,i.sourceKind,_),i.sourceKind==="codex")try{await pt(n,y)}catch(u){t.errors+=1,(t.errorSample??=[]).length<3&&t.errorSample.push(`codex adv metadata: ${u.message.slice(0,200)}`)}}if(r.turns>0)try{t.chatsIngested=await Ne(n,r)}catch(i){t.errors+=1,console.warn(`[session-ingest] agent_chat sync failed: ${i.message}`)}return t.durationMs=Date.now()-s,$.last=t,t}finally{$.running=!1}}var Z,x,st,g,ht,W,yt,gt,bt,q,Et,Y,St,wt,D,J,kt,E,It,Nt,N,X,Lt,Ct,Tt,Le,tt,M,$,ze=G((()=>{Z=j(H(),1),x=j(H(),1),st=j(H(),1),g=j(H(),1),nt(),Rt(),At(),Xt(),Ut(),vt(),ie(),Zt(),Mt(),Dt(),Jt(),ht=45,W=45,yt=200,gt=4e3,bt=5*1024*1024,q=50,Et=1e3,Y=25,St=50*1024*1024,wt=8e3,D=3,J=2e3,kt=14,E={isPrompt:!1,isResponsePayload:!1,inferenceId:null,toolCallCount:0},It=["<system-reminder","<local-command","<command-name","<user_instructions>","<permissions instructions>","<environment_context>","Caveat: The messages below"],Nt=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,N=(0,st.homedir)(),X=[{sourceKind:"claude",usageOf:ee,roots:()=>[{root:(0,g.join)(N,".claude","projects"),dirDepth:1},{root:(0,g.join)(N,".papercusp","session-claude"),dirDepth:3}],parseLine:le,classifyLine:fe,parseParts:ce,meta:s=>{const t=s.match(/\/session-claude\/([^/]+)\//);return{sessionId:(0,g.basename)(s,".jsonl"),owner:t?t[1]:null}}},{sourceKind:"omp",roots:()=>[{root:(0,g.join)(N,".omp","agent","sessions"),dirDepth:1},{root:(0,g.join)(N,".papercusp","su-omp-homes"),dirDepth:4}],parseLine:ue,classifyLine:de,meta:s=>{const t=(0,g.basename)(s,".jsonl"),e=t.indexOf("_");return{sessionId:e>=0?t.slice(e+1):t,owner:null}}},{sourceKind:"codex",roots:()=>[{root:(0,g.join)(N,".codex","sessions"),dirDepth:3},{root:(0,g.join)(N,".papercusp","su-codex-homes"),dirDepth:5,descend:(s,t)=>t===2?s==="sessions":!0}],parseLine:_e,classifyLine:pe,meta:ct}],Lt="unenrolled-origin",Ct=new Set(["claude","omp","codex"]),Tt=5e3,Le=4,tt={byte_offset:0,turn_count:0,part_count:0,prompt_count:0,response_count:0,tool_call_count:0,last_inference_id:null,counts_backfill_offset:0,counts_backfill_last_inference_id:null,counts_backfilled_at:null},M="__hwm__",$=xt("@papercusp/operator-core.sessionIngestState",()=>({running:!1,last:null}))}));export{ie as A,V as C,C as D,_t as E,Zt as M,lt as O,We as S,Ke as T,ce as _,we as a,ue as b,de as c,ut as d,ct as f,le as g,ye as h,Lt as i,Vt as j,at as k,ae as l,ze as m,J as n,fe as o,Be as p,Tt as r,pe as s,X as t,I as u,me as v,Xe as w,ft as x,_e as y};
