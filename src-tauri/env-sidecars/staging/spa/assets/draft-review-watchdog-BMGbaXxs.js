import{n as S}from"./chunk-ChpBd9eV.js";import{st as w,t as v}from"./src-BmBNODK0.js";import{i as M,t as $}from"./pot-membership-_CBaMRYQ.js";import{a as A,i as k,o as m}from"./started-BElZSRWs.js";import{n as C,o as E}from"./watchdog-Hc_gipv9.js";import{C as b,d as D}from"./placement-watchdog-MA--n6Xb.js";import{n as y,t as N}from"./nudge-recipient-DzSTIYVp.js";function R(){const s=Number({}.PAPERCUSP_SCOUT_DRAFT_REVIEW_STALE_SEC??43200);return Number.isFinite(s)?s:43200}function I(s,t){return t.thresholdMs<=0?[]:s.filter(e=>Number.isFinite(e.updatedAtMs)&&t.now-e.updatedAtMs>=t.thresholdMs).sort((e,a)=>e.updatedAtMs-a.updatedAtMs)}function f(s){const t=Math.floor(Math.max(0,s)/36e5);if(t<1)return"<1h";if(t<24)return`${t}h`;const e=Math.floor(t/24),a=t%24;return a>0?`${e}d ${a}h`:`${e}d`}async function B(s,t,e,a={}){return(await s`
    SELECT plan_slug, title,
           (extract(epoch FROM updated_at) * 1000)::bigint AS updated_at_ms
      FROM harness_shared.harness_plans
     WHERE workspace_id = ${t}
       AND harness_slug = ${e}
       AND status = 'draft'
       AND archived = false
       AND content LIKE ${`%
origin: scout
%`}
     ORDER BY updated_at ASC
     LIMIT ${a.limit??50}`).map(u=>({planSlug:u.plan_slug,title:u.title,updatedAtMs:Number(u.updated_at_ms??0)}))}async function W(s,t,e){const a=await s`
    SELECT count(*)::int AS c
      FROM harness_shared.harness_plans
     WHERE workspace_id = ${t}
       AND status = 'draft'
       AND archived = false
       AND updated_at <= to_timestamp(${e} / 1000.0)
       AND content LIKE ${`%
origin: scout
%`}`;return Math.max(0,Number(a[0]?.c??0))}async function T(s,t,e,a,u=null,d=Date.now()){const p=Math.max(1,Math.round(a/3600)),i=e.slice(0,5),g=i.map(o=>`• ${o.planSlug}${o.title?` — ${o.title}`:""} (unreviewed for ${f(d-o.updatedAtMs)})`).join(`
`),h=e.length>i.length?`
…and ${e.length-i.length} more.`:"",n=i.length>0?d-i[0].updatedAtMs:0;await N({workspaceId:s,mugOwner:t,summary:`Scout-draft review backstop: ${e.length} scout-routed draft(s) unreviewed > ${p}h (oldest: ${f(n)} since last update — the plan-review idle activity never ran — the hive has been saturated, so the Queen was never idle). This is a backstop WAKE, not an idle activity: review each and either promote it (= ready), coord:send feedback to its scout owner to iterate, or deprecate it WITH learnings (never just leave it). Clearing or progressing them stops this wake.

${g}${h}`,payload:{kind:"scout-draft-review",slugs:e.map(o=>o.planSlug),staleHours:p,oldestStaleMs:n},source:"scout-draft-review",body:`${g}${h}`,harnessSlug:u})}async function U(s={}){const t=[],e=R();if(e<=0)return t;try{const a=await A();if(a.length===0){const n=typeof m=="function"?m():[];if(n.length===0)return t;const{sql:o}=w(),r=(s.now??Date.now())-e*1e3;let c=0;for(const l of n)c+=await W(o,l,r);if(c>0){const l=`${c} eligible stale Scout draft(s) found in ${n.length} workspace(s), but no registered Blender scopes were evaluated`;return console.warn(`[scout-draft-review] ALERT: ${l}`),[{workspaceId:"*",installSlug:"*",outcome:"error",evaluatedWorkspaceCount:0,evaluatedScopeCount:0,eligibleBacklogCount:c,staleCount:c,reason:l}]}return t}const{sql:u}=w(),d=new Set(a.map(({workspaceId:n})=>n)).size,p=a.length,i=s.now??Date.now(),g=e*1e3,h=Math.max(1,Math.round(e/3600));for(const{workspaceId:n,installSlug:o}of a)try{const r=I(await B(u,n,await M(o,n)),{now:i,thresholdMs:g});if(r.length===0)continue;const c=i-r[0].updatedAtMs,l=`${r.length} scout-routed draft(s) unreviewed > ${h}h (oldest: ${f(c)}): `+r.slice(0,5).map(_=>_.planSlug).join(", ");if(!await C({workspaceId:n,installSlug:o,source:"scout-draft-review",reason:l,wakeAt:null,windowHours:h})){t.push({workspaceId:n,installSlug:o,outcome:"skipped",evaluatedWorkspaceCount:d,evaluatedScopeCount:p,eligibleBacklogCount:r.length,staleCount:r.length,reason:"debounced"});continue}await T(n,await b(u,n,o),r,e,o,i),t.push({workspaceId:n,installSlug:o,outcome:"nudged",evaluatedWorkspaceCount:d,evaluatedScopeCount:p,eligibleBacklogCount:r.length,staleCount:r.length,reason:l})}catch(r){t.push({workspaceId:n,installSlug:o,outcome:"error",evaluatedWorkspaceCount:d,evaluatedScopeCount:p,eligibleBacklogCount:0,staleCount:0,reason:r instanceof Error?r.message:String(r)})}}catch(a){console.warn(`[scout-draft-review] sweep failed: ${a instanceof Error?a.message:a}`)}return t}var O=S((()=>{v(),k(),D(),y(),E(),$()}));O();export{U as scoutDraftReviewSweep};
