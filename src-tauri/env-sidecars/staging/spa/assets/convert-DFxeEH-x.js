import{n as A}from"./chunk-ChpBd9eV.js";import{st as S,t as D}from"./src-BmBNODK0.js";import{r as T,t as y}from"./coordination-event-log-browser-s_EyGDm7.js";import{o as L,r as b}from"./log-BwQLkm9I.js";import{M as f,k as M,w}from"./work-item-blocking-CPkS3jV-.js";import{$,B as h,G as W,O as x,Y as C,bt as O,i as N,x as I}from"./work-items-B3XMqSf_.js";import{S as F,d as Y}from"./source-Ca8i7FlY.js";import{r as H,t as P}from"./liveness-BPjhzF8i.js";function g(e,a){const t=e.replace(/\s+/g," ").trim();return a<=1?t.length?"…":"":t.length<=a?t:`${t.slice(0,a-1)}…`}function B(e,a){const t=(e?.items??[]).find(s=>s.id===a)?.decisionRefs??[];if(t.length===0)return[];const i=new Map((e?.decisions??[]).map(s=>[s.id,s])),r=[],o=new Set;for(const s of t){if(o.has(s)||!i.has(s))continue;o.add(s);const n=i.get(s);r.push({id:n.id,title:n.title,body:n.body})}return r}function U(e){const a=e.maxChars??R,t=e.decisions??[],i=e.planFocus?.state?.trim()??"",r=e.planFocus?.next?.trim()??"";if(!(t.length>0||i!==""||r!==""))return"";const o=[],s=(e.itemText??"").trim(),n=`## Task — ${e.itemId}${e.planTitle?` · ${g(e.planTitle,80)}`:""}`;if(o.push(s?`${n}
${s}`:n),i||r){const u=["## Plan focus"];i&&u.push(g(i,400)),r&&u.push(`Next: ${g(r,200)}`),o.push(u.join(`
`))}if(t.length>0){const u=Math.max(120,Math.floor(a/2/t.length)),_=t.map(c=>`- ${c.id} — ${g(c.title,100)}: ${g(c.body,u)}`);o.push(["## Decisions bearing on this item",..._].join(`
`))}const d=o.join(`

`);return d.length<=a?d:`${d.slice(0,a-1)}…`}var R,q=A((()=>{R=2e3}));function k(e){return e?.length?[...new Set(e)]:[...new Set([y,b()])]}async function K(e,a,t){const{sql:i}=S(),r=await i`
    SELECT src_kind, src_ref
      FROM harness_shared.coord_links
     WHERE workspace_id = ANY(${k(t)})
       AND rel = ${p}
       AND dst_kind = ${w}
       AND dst_ref = ${f(e,a)}
     ORDER BY created_at DESC`;for(const o of r)if(o.src_kind==="issue"){const s=await h(o.src_ref);if(s)return s}else if(o.src_kind==="feature"){const s=o.src_ref.indexOf("#");if(s>0){const n=await h(o.src_ref.slice(s+1),o.src_ref.slice(0,s));if(n)return n}}return null}async function j(e,a,t){const{sql:i}=S(),r=()=>i`payload->'plan_item' IS NOT NULL
    AND payload->'plan_item'->>'plan_slug' = ${e}
    AND payload->'plan_item'->>'item_id' = ${a}`,o=await i`
    SELECT feature_id, harness_slug
      FROM harness_shared.harness_features_consolidated
     WHERE harness_slug = ${t} AND ${r()}
     ORDER BY updated_ts DESC NULLS LAST`;for(const n of o){const d=await h(n.feature_id,n.harness_slug);if(d)return d}const s=await i`
    SELECT feature_id AS issue_id
      FROM harness_shared.work_items
     WHERE item_kind = ANY(${[...N]}::text[])
       AND ${r()}
     ORDER BY updated_ts DESC NULLS LAST`;for(const n of s){const d=await h(n.issue_id);if(d)return d}return null}async function se(e,a,t){const{sql:i}=S(),r=await i`
    SELECT src_kind, src_ref
      FROM harness_shared.coord_links
     WHERE workspace_id = ANY(${k(t)})
       AND rel = 'relates'
       AND dst_kind = ${w}
       AND dst_ref = ${f(e,a)}
     ORDER BY created_at DESC`,o=[];for(const s of r)if(s.src_kind==="issue"){const n=await h(s.src_ref);n&&o.push(n)}else if(s.src_kind==="feature"){const n=s.src_ref.indexOf("#");if(n>0){const d=await h(s.src_ref.slice(n+1),s.src_ref.slice(0,n));d&&o.push(d)}}return o}function ie(e){const a=/\b(?:verdict|investigat\w*|diagnos\w*|discover(?:ed|y)?|found|confirmed|predates?)\b/i.test(e)&&/\b(?:defect|bug|issue)\b/i.test(e)&&/\b(?:filed|created|opened|tracked)\b/i.test(e),t=/\b(?:acceptance|criteri\w*|ask|scope|work)\b[^.\n]{0,120}\b(?:not met|unmet|deferred|split(?:[- ]?off)?|left (?:open|unresolved|unmet))\b/i.test(e);return a&&!t?!1:/\b(split[- ]?off|carved[- ]?off|residual|deferred|not (?:fully |entirely )?met|partial(?:ly)? (?:done|complete|addressed)|left (?:open|unresolved|unmet)|unmet acceptance|acceptance (?:criteri\w*|ask)\b[^.]*(?:not met|unmet))\b/i.test(e)}async function re(e){const{sql:a}=S(),t=await a`
    SELECT DISTINCT dst_ref
      FROM harness_shared.coord_links
     WHERE workspace_id = ANY(${k(e)})
       AND rel = ${p}
       AND dst_kind = ${w}`;return new Set(t.map(i=>i.dst_ref))}async function ae(e,a,t,i){if(t.length===0)return new Set;const{sql:r}=S(),o=k(i),s=t.map(m=>f(e,m)),n=new Set,d=await r`
    SELECT DISTINCT dst_ref
      FROM harness_shared.coord_links
     WHERE workspace_id = ANY(${o})
       AND rel = ANY(${[p,"relates"]})
       AND dst_kind = ${w}
       AND dst_ref = ANY(${s})`;for(const m of d)n.add(m.dst_ref);const u=()=>r`payload->'plan_item' IS NOT NULL
    AND payload->'plan_item'->>'plan_slug' = ${e}
    AND payload->'plan_item'->>'item_id' = ANY(${t}::text[])`,_=await r`
    SELECT payload->'plan_item'->>'item_id' AS item_id
      FROM harness_shared.harness_features_consolidated
     WHERE harness_slug = ${a} AND ${u()}`;for(const m of _)n.add(f(e,m.item_id));const c=await r`
    SELECT payload->'plan_item'->>'item_id' AS item_id
      FROM harness_shared.work_items
     WHERE item_kind = ANY(${[...N]}::text[])
       AND ${u()}`;for(const m of c)n.add(f(e,m.item_id));return n}function G(e,a=140){const t=e.replace(/\s+/g," ").trim();return t.length<=a?t:`${t.slice(0,a-1)}…`}async function oe(e){const a=e.kind??"task";if(!C(a))return{status:"refused",reason:`unknown work_item kind '${a}'`};const t=await F(e.planSlug,{harnessSlug:e.harnessSlug,workspaceId:e.workspaceId});if(!t)return{status:"refused",reason:`plan '${e.planSlug}' not found`};const i=(t.row.items.length>0?t.row.items.map(l=>({id:l.id,status:l.status,text:l.text})):t.parsed.items.map(l=>({id:l.id,status:l.storedStatus,text:l.text??null}))).find(l=>l.id===e.itemId);if(!i)return{status:"refused",reason:`plan item ${e.itemId} not found in '${e.planSlug}'`};if(i.status==="done"||i.status==="dropped")return{status:"refused",reason:`plan item ${e.itemId} is already ${i.status}`};const r=await P({workspaceId:e.workspaceId,harnessSlug:e.harnessSlug,planSlug:e.planSlug,itemId:e.itemId,owner:e.owner,ownerLabel:e.ownerLabel,ownerName:e.ownerName,ownerUser:e.ownerUser,intent:e.intent??`convert-at-pickup → work_item[kind=${a}]`,livenessMode:e.livenessMode,ttlSec:e.ttlSec});if(r.status!=="claimed")return r;const o={plan_slug:e.planSlug,item_id:e.itemId,harness_slug:e.harnessSlug},s={plan:e.planSlug,item:e.itemId,status:i.status,text:i.text};let n=await K(e.planSlug,e.itemId),d=!1;if(n||(n=await j(e.planSlug,e.itemId,e.harnessSlug),d=n!==null),n&&!v.has(n.state)){let l=await I(n.id,e.owner,{harness:n.harness??void 0});if(l||(await O(n.id,{harness:n.harness??void 0}),l=await I(n.id,e.owner,{harness:n.harness??void 0})),d){const E=l??n;await $(E.id,{kind:w,ref:f(e.planSlug,e.itemId)},p,{harness:E.harness??void 0,by:e.owner})}return{status:"resumed",workItem:l??n,claim:r.claim,mode:r.mode,viaAssignment:r.viaAssignment,planItem:s,priorHolderWarning:r.priorHolderWarning}}const u=e.title??(i.text?G(i.text):`${e.planSlug} ${e.itemId}`),_=e.brief??(e.compileBriefIfMissing&&U({itemId:e.itemId,itemText:i.text??"",planTitle:t.parsed.frontmatter?.title??null,planFocus:t.parsed.now?{state:t.parsed.now.state,next:t.parsed.now.next}:null,decisions:B(t.parsed,e.itemId)})||void 0),c=await x({kind:a,title:u,summary:i.text??void 0,harness:e.harnessSlug,payload:{plan_item:o,...e.planRun?{plan_run:e.planRun}:{},..._?{brief:_}:{}},sourcePlanSlug:e.planRun?.templateSlug??e.planSlug,createdBy:e.owner,assignee:e.owner}),m=await I(c.id,e.owner,{harness:c.harness??void 0});return await $(c.id,{kind:w,ref:f(e.planSlug,e.itemId)},p,{harness:c.harness??void 0,by:e.owner}),{status:"converted",workItem:m??c,claim:r.claim,mode:r.mode,viaAssignment:r.viaAssignment,planItem:s,priorHolderWarning:r.priorHolderWarning}}var p,v,de=A((()=>{D(),T(),L(),Y(),M(),W(),H(),q(),p="implements",v=new Set(["passed","resolved","closed","done","deprecated","dropped"])}));export{se as a,re as c,G as d,j as i,ae as l,v as n,K as o,oe as r,de as s,p as t,ie as u};
