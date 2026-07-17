import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,U as n,t as r}from"./src-CwW4br4q.js";import{n as i,s as a}from"./workspace-registry-Bu1Yy540.js";import{r as o,t as s}from"./core-9mchu3jo.js";import{n as c,o as l}from"./log-D6QBfU78.js";import{a as u,i as d}from"./issue-blocks-merge-Dcre_Xwf.js";import{n as f,r as p}from"./escalations-BWroz_br.js";import{a as m,i as h}from"./sync-sse-CsM2bSSd.js";import{i as g,r as _}from"./handoffs-LoubHzro.js";import{i as ee,r as te,t as ne}from"./operator-conversations-CqBy7nj6.js";function re(e,t){switch(e){case`escalation`:return{disposition:`surface`,urgent:!0,reason:`escalation — always surface, urgent`};case`blocker`:return{disposition:`surface`,urgent:!0,reason:`blocker — always surface, urgent`};case`decision`:return{disposition:`surface`,urgent:!1,reason:`decision-needed — always surface`};case`completion`:return t?{disposition:`surface`,urgent:!1,reason:`completion of user-requested work — surface`}:{disposition:`batch`,urgent:!1,reason:`fleet-internal completion — batch`};case`progress`:return{disposition:`batch`,urgent:!1,reason:`routine progress — batch`};default:return{disposition:`batch`,urgent:!1,reason:`unknown kind — batch (defensive)`}}}function v(e,t){let n=re(e.kind,e.userRequested);return n.disposition!==`suppress`&&t.alreadySurfaced.has(e.id)?{disposition:`suppress`,urgent:!1,reason:`already-surfaced (idempotency)`}:n}function y(e,t){let n=new Map;for(let r of e)n.set(r.id,v(r,t));return n}function b(e,t){let n=[],r=[],i=!1;for(let a of e){let e=t.get(a.id);e&&(e.disposition===`surface`?(n.push({signal:a,verdict:e}),e.urgent&&(i=!0)):e.disposition===`batch`&&r.push({signal:a,verdict:e}))}return n.sort((e,t)=>Number(t.verdict.urgent)-Number(e.verdict.urgent)),{surfaceNow:n,batch:r,hasUrgent:i}}var x,S=e((()=>{x=`curator-v1`}));function C(e){return e===`blocker`?`blocker`:e===`question`?`decision`:`escalation`}async function w(e,t){try{return await e()}catch(e){return console.warn(`[curation] reader "${t}" failed:`,e instanceof Error?e.message:e),[]}}async function T(e){let[t,n,r,i,a]=await Promise.all([w(()=>e.escalations(),`escalations`),w(()=>e.blocked(),`blocked`),w(()=>e.decisions(),`decisions`),w(()=>e.completions(),`completions`),w(()=>e.progress(),`progress`)]),o=[];for(let e of t){let t=C(e.severity);o.push({id:`escalation:${e.msgId}`,kind:t,title:e.summary,harness:e.harness,severity:e.severity===`blocker`||e.severity===`question`||e.severity===`advisory`?e.severity:void 0,ref:`escalation:${e.msgId}`,ts:e.ts})}for(let e of n)o.push({id:`blocked:${e.ref}`,kind:`blocker`,title:e.title,detail:e.reason,harness:e.harness,workItemId:e.workItemId,ref:`wi:${e.ref}`,ts:e.ts??new Date(0).toISOString()});for(let e of r)o.push({id:`decision:${e.id}`,kind:`decision`,title:e.title,detail:e.detail,harness:e.harness,workItemId:e.workItemId,ref:e.ref??`decision:${e.id}`,ts:e.ts});for(let e of i)o.push({id:`completion:${e.workItemId}`,kind:`completion`,title:e.title,harness:e.harness,workItemId:e.workItemId,userRequested:e.userRequested??!1,ref:e.ref??`wi:${e.workItemId}`,ts:e.ts});for(let e of a)o.push({id:`progress:${e.id}`,kind:`progress`,title:e.title,detail:e.detail,harness:e.harness,ref:e.ref,ts:e.ts});return E(o).sort((e,t)=>e.ts<t.ts?1:e.ts>t.ts?-1:0)}function E(e){let t=new Set,n=[];for(let r of e)t.has(r.id)||(t.add(r.id),n.push(r));return n}var D=e((()=>{}));function O(e){let{signal:t}=e,n=`${F[t.kind]??`•`} **${I[t.kind]??t.kind}**${t.harness?` [${t.harness}]`:``}${t.kind===`completion`&&t.userRequested?` (you asked for this)`:``} — ${t.title}`;return t.detail&&(n+=` · ${t.detail}`),t.ref&&(n+=` · drill in: \`${t.ref}\``),n}function k(e){return e.map(O).join(`
`)}function A(e){let t=new Map;for(let n of e)t.set(n.signal.kind,(t.get(n.signal.kind)??0)+1);let n=[],r=t.get(`progress`)??0,i=t.get(`completion`)??0;r&&n.push(`${r} item${r===1?``:`s`} progressed`),i&&n.push(`${i} completed`);for(let[e,r]of t)e===`progress`||e===`completion`||n.push(`${r} ${e}`);return[`📋 Fleet update — ${n.join(` · `)||`${e.length} updates`}`,...e.slice(0,3).map(e=>`· ${e.signal.title}`)].join(`
`)}async function j(e,t={}){let n=await T(e.readers),{surfaceNow:r,batch:i,hasUrgent:a}=b(n,y(n,{alreadySurfaced:await e.loadSurfaced(e.windowMs)})),o=typeof t.canEmitDigest==`function`?t.canEmitDigest(i.length):t.canEmitDigest??!0,s=[],c=[];if(r.length>0){let t=k(r);await e.surface(t),s.push(t);for(let e of r)c.push({id:e.signal.id,kind:e.signal.kind})}let l=!1,u=0,d=0;if(i.length>0)if(o){let t=A(i);await e.surface(t),s.push(t),l=!0,u=i.length;for(let e of i)c.push({id:e.signal.id,kind:e.signal.kind})}else d=i.length;return c.length>0&&await e.recordSurfaced(c,x),{surfacedCount:r.length,batchedCount:u,deferredBatchCount:d,digestEmitted:l,hasUrgent:a,messages:s}}function M(e,t){if(t)return 120;let n=Math.round((e||120)*1.5);return Math.min(900,Math.max(120,n))}function N(e,t,n){return e==null?!0:n-e>=Math.max(1,t)*1e3}function P(e,t,n){return t<=0?!1:t>=8||e==null?!0:n-e>=300*1e3}var F,I,L=e((()=>{S(),D(),F={escalation:`⚠`,blocker:`🚧`,decision:`❓`,completion:`✓`,progress:`·`},I={escalation:`Escalation`,blocker:`Blocked`,decision:`Decision needed`,completion:`Done`,progress:`Progress`}}));async function ie(e={}){let t=Math.max(1,Math.min(Math.floor(e.limit??500)||500,1e3)),n=e.planSlugs&&e.planSlugs.length===1?e.planSlugs[0]:void 0;return o(await c.readLinesBounded(`plan-events`,{limit:t,kinds:[`plan_event`],...e.since_ts?{sinceTs:e.since_ts}:{},...n?{planSlug:n}:{}}),e)}var R=e((()=>{s(),l()}));async function z(e=V){let t=i(),r=Math.max(1,Math.floor(e)),a=await n(t,async e=>e`
      SELECT signal_id
        FROM harness_shared.operator_curation_log
       WHERE workspace_id = ${t}
         AND surfaced_at > now() - (${r}::bigint * interval '1 millisecond')
    `);return new Set(a.map(e=>e.signal_id))}async function B(e,t){if(e.length===0)return;let r=i();await n(r,async n=>{for(let i of e)await n`
        INSERT INTO harness_shared.operator_curation_log
          (workspace_id, signal_id, kind, policy_version, surfaced_at)
        VALUES (${r}, ${i.id}, ${i.kind}, ${t}, now())
        ON CONFLICT (workspace_id, signal_id) DO UPDATE
          SET surfaced_at = EXCLUDED.surfaced_at,
              kind = EXCLUDED.kind,
              policy_version = EXCLUDED.policy_version
      `})}var V,H=e((()=>{r(),a(),V=1440*60*1e3}));async function U(e){let t=await te(),n=await ne({conversationId:t.id,role:`assistant`,text:e,source:`system`});return m(`operatorTurns.byConversation`,{conversationId:t.id}).catch(()=>{}),{conversationId:t.id,turnId:n.id}}var W=e((()=>{ee(),h()}));function G(e){if(typeof e.summary==`string`&&e.summary.trim())return e.summary;let t=typeof e.plan_slug==`string`&&e.plan_slug?e.plan_slug:void 0,n=typeof e.detail==`string`&&e.detail?e.detail:void 0,r=typeof e.before==`string`&&e.before?e.before:void 0,i=typeof e.after==`string`&&e.after?e.after:void 0;if(!t&&!n&&!i)return`plan update`;let a=`${t??`plan`}${n?` ${n}`:``}`;return i?`${a}: ${r&&r!==i?`${r} → ${i}`:i}`:`${a} updated`}var K=e((()=>{}));async function q(){return(await p({status:`open`})).map(e=>({msgId:e.msg_id,severity:e.severity,summary:e.summary??`(escalation)`,from:e.from,planSlug:e.plan_slug,ts:e.ts}))}async function J(){let e=await d(),t=[];for(let[n,r]of e)t.push({ref:n,title:n,reason:`blocked by ${r.length} open issue${r.length===1?``:`s`}: ${r.join(`, `)}`});return t}async function Y(){let e=[],n=await g({status:`open`});for(let t of n){let n=t.record;!Array.isArray(n.to)||!n.to.includes(`human`)||e.push({id:`handoff:${n.msg_id}`,title:n.summary??`handoff`,ref:`coord:handoff:${n.msg_id}`,ts:n.ts})}let r=i(),{sql:a}=t(),o=await a`
    SELECT harness_slug, feature_id, title, needs_design, updated_ts::text
      FROM harness_shared.harness_features_consolidated
     WHERE workspace_id = ${r}
       AND (needs_human_review = true OR (needs_design = true AND design_status = 'pending'))
       AND COALESCE(status, '') <> 'deprecated'
     ORDER BY updated_ts DESC NULLS LAST
     LIMIT 50
  `;for(let t of o)e.push({id:`review:${t.harness_slug}#${t.feature_id}`,harness:t.harness_slug,title:t.title??t.feature_id,detail:t.needs_design?`design review`:`review`,workItemId:t.feature_id,ref:`wi:${t.harness_slug}#${t.feature_id}`,ts:t.updated_ts?new Date(Number(t.updated_ts)).toISOString():new Date().toISOString()});return e}async function ae(){let e=i(),n=Date.now()-X,{sql:r}=t();return(await r`
    SELECT harness_slug, feature_id, title, created_by_github_user_id::text, updated_ts::text
      FROM harness_shared.work_items
     WHERE workspace_id = ${e}
       AND status = ANY(${[...Z]}::text[])
       AND terminal_owner IS NOT NULL AND terminal_owner <> ''
       AND terminal_completion_ref IS NOT NULL AND terminal_completion_ref <> ''
       AND updated_ts IS NOT NULL
       AND updated_ts > ${n}
     ORDER BY updated_ts DESC
     LIMIT 50
  `).map(e=>({workItemId:`${e.harness_slug}#${e.feature_id}`,harness:e.harness_slug,title:e.title??e.feature_id,userRequested:e.created_by_github_user_id!=null,ref:`wi:${e.harness_slug}#${e.feature_id}`,ts:e.updated_ts?new Date(Number(e.updated_ts)).toISOString():new Date().toISOString()}))}async function oe(){let e=Date.now()-X,t=await ie({events:[`item_status_changed`],filesBack:1}),n=[];for(let r of t){let t=typeof r.ts==`string`?r.ts:new Date().toISOString(),i=Date.parse(t);if(Number.isFinite(i)&&i<e)continue;let a=typeof r.plan_slug==`string`?r.plan_slug:void 0,o=G(r);n.push({id:`plan-event:${r.msg_id}`,title:o,ref:a?`plan:${a}`:void 0,ts:t})}return n.slice(0,25)}function se(){return{escalations:q,blocked:J,decisions:Y,completions:ae,progress:oe}}function ce(){return{readers:se(),loadSurfaced:e=>z(e),recordSurfaced:(e,t)=>B(e,t),surface:e=>U(e)}}var X,Z,le=e((()=>{r(),a(),f(),_(),R(),u(),H(),W(),K(),X=1440*60*1e3,Z=[`done`,`passed`,`resolved`,`closed`]}));async function ue(){let e=i(),t=await n(e,async t=>t`
      SELECT last_run_at::text, last_digest_at::text, current_interval_seconds,
             consecutive_quiet, last_surfaced_count
        FROM harness_shared.operator_curation_state
       WHERE workspace_id = ${e}
       LIMIT 1
    `);if(!t.length)return{...$};let r=t[0];return{lastRunAtMs:r.last_run_at?new Date(r.last_run_at).getTime():null,lastDigestAtMs:r.last_digest_at?new Date(r.last_digest_at).getTime():null,currentIntervalSeconds:Number(r.current_interval_seconds)||120,consecutiveQuiet:Number(r.consecutive_quiet)||0,lastSurfacedCount:Number(r.last_surfaced_count)||0}}async function Q(e){let t=i(),r=e.lastRunAtMs==null?null:new Date(e.lastRunAtMs).toISOString(),a=e.lastDigestAtMs==null?null:new Date(e.lastDigestAtMs).toISOString(),o=e.currentIntervalSeconds??null,s=e.consecutiveQuiet??null,c=e.lastSurfacedCount??null;await n(t,async e=>{await e`
      INSERT INTO harness_shared.operator_curation_state
        (workspace_id, last_run_at, last_digest_at, current_interval_seconds,
         consecutive_quiet, last_surfaced_count, updated_at)
      VALUES (
        ${t},
        ${r},
        ${a},
        ${o??120},
        ${s??0},
        ${c??0},
        now()
      )
      ON CONFLICT (workspace_id) DO UPDATE SET
        last_run_at = COALESCE(${r}, harness_shared.operator_curation_state.last_run_at),
        last_digest_at = COALESCE(${a}, harness_shared.operator_curation_state.last_digest_at),
        current_interval_seconds = COALESCE(${o}, harness_shared.operator_curation_state.current_interval_seconds),
        consecutive_quiet = COALESCE(${s}, harness_shared.operator_curation_state.consecutive_quiet),
        last_surfaced_count = COALESCE(${c}, harness_shared.operator_curation_state.last_surfaced_count),
        updated_at = now()
    `})}var $,de=e((()=>{r(),a(),L(),$={lastRunAtMs:null,lastDigestAtMs:null,currentIntervalSeconds:120,consecutiveQuiet:0,lastSurfacedCount:0}}));export{le as a,M as c,ce as i,j as l,ue as n,P as o,Q as r,L as s,de as t,N as u};