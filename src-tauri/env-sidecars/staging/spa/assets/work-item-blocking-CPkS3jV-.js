import{n as p}from"./chunk-ChpBd9eV.js";import{st as _,t as y}from"./src-BmBNODK0.js";import{r as $,t as d}from"./coordination-event-log-browser-s_EyGDm7.js";import{r as C,t as F}from"./capabilities-B1jFbwl5.js";function ae(e,s){return`${e}#${s}`}function u(e,s){return`${e}#${s}`}function h(e){const s=e.indexOf("#");return s>0&&s<e.length-1&&e.indexOf("#",s+1)===-1}async function W(e){const{sql:s}=_(),r=await s`
    SELECT l.dst_ref, l.src_ref AS issue_id
      FROM harness_shared.coord_links l
      JOIN harness_shared.engineer_issues i
        ON i.issue_id = l.src_ref
     WHERE l.workspace_id = ${d}
       AND l.rel = 'blocks'
       AND l.src_kind = 'issue'
       AND l.dst_kind = ${g}
       AND l.dst_ref LIKE ${e+"#%"}
       AND i.state = 'open'
     ORDER BY l.src_ref`,t=new Map,n=`${e}#`;for(const o of r){if(!o.dst_ref.startsWith(n))continue;const c=o.dst_ref.slice(n.length),a=t.get(c)??[];a.push(o.issue_id),t.set(c,a)}return{blockedItems:t}}async function le(){const{sql:e}=_(),s=await e`
    SELECT l.dst_ref, l.src_ref AS issue_id
      FROM harness_shared.coord_links l
      JOIN harness_shared.engineer_issues i
        ON i.issue_id = l.src_ref
     WHERE l.workspace_id = ${d}
       AND l.rel = 'blocks'
       AND l.src_kind = 'issue'
       AND l.dst_kind = ${g}
       AND i.state = 'open'
     ORDER BY l.src_ref`,r=new Map;for(const t of s){const n=r.get(t.dst_ref)??[];n.push(t.issue_id),r.set(t.dst_ref,n)}return r}function q(e,s){const r={};return{items:e.map(t=>{const n=s(t.id);return n&&n.length>0&&t.effectiveStatus!=="done"&&t.effectiveStatus!=="dropped"?(r[t.id]=n,{...t,effectiveStatus:"blocked"}):t}),blockingIssues:r}}async function de(e,s){try{const{blockedItems:r}=await W(e);return q(s,t=>r.get(t))}catch{return{items:s,blockingIssues:{}}}}async function _e(){const{sql:e}=_(),s=await e`
    SELECT l.dst_ref, l.src_ref AS issue_id
      FROM harness_shared.coord_links l
      JOIN harness_shared.engineer_issues i
        ON i.issue_id = l.src_ref
     WHERE l.workspace_id = ${d}
       AND l.rel = 'blocks'
       AND l.src_kind = 'issue'
       AND l.dst_kind = ${l}
       AND i.state = 'open'
     ORDER BY l.src_ref`,r=new Map;for(const t of s){const n=r.get(t.dst_ref)??[];n.push(t.issue_id),r.set(t.dst_ref,n)}return r}var g,l,T=p((()=>{y(),$(),g="plan_item",l="feature"}));function H(e){const s=new Set;for(const[c,a]of e){s.add(c);for(const i of a)s.add(i)}const r=new Map,t=new Map;for(const c of s)r.set(c,[]),t.set(c,0);for(const[c,a]of e)for(const i of a)r.get(i).push(c),t.set(c,(t.get(c)??0)+1);const n=[];for(const[c,a]of t)a===0&&n.push(c);let o=0;for(;n.length>0;){const c=n.shift();o++;for(const a of r.get(c)){const i=(t.get(a)??0)-1;t.set(a,i),i===0&&n.push(a)}}return o===s.size?{hasCycle:!1,cycleNodes:[]}:{hasCycle:!0,cycleNodes:[...t].filter(([,c])=>c>0).map(([c])=>c).sort()}}var U=p((()=>{}));function S(e,s){const r=h(e.ref);if(e.kind==="feature"&&!r)throw new Error(`work_item_deps ${s} endpoint kind='${l}' requires a harness-qualified ref '<harness>#<feature_id>', got '${e.ref}'. A bare ref here is invisible to BOTH blocking floors, so the edge would be silently inert (D-009 / D-007).`);if(e.kind===k&&r)throw new Error(`work_item_deps ${s} endpoint kind='${k}' requires a BARE ref (e.g. 'EI-123'), got the harness-qualified '${e.ref}'. The issue floor keys on the bare feature_id, so a qualified ref here is silently inert (D-009 / D-007).`)}async function b(e){if(e.kind!==k&&e.kind!=="feature")return e;const s=e.kind==="feature"&&h(e.ref)?e.ref.slice(e.ref.indexOf("#")+1):e.ref,{sql:r}=_();if((await r`
    SELECT 1 AS one FROM harness_shared.engineer_issues WHERE issue_id = ${s} LIMIT 1`).length>0)return{kind:k,ref:s};const t=await r`
    SELECT harness_slug FROM harness_shared.harness_features_consolidated WHERE feature_id = ${s} LIMIT 1`;return t.length>0?{kind:l,ref:u(t[0].harness_slug,s)}:e}function R(e,s){return e.kind===s.kind&&e.ref===s.ref?null:(S(s,"blocked"),S(e,"blocker"),{blocked_kind:s.kind,blocked_ref:s.ref,blocker_kind:e.kind,blocker_ref:e.ref,dep_type:"blocks"})}async function fe(e,s,r={}){const[t,n]=await Promise.all([b(e),b(s)]),o=R(t,n);if(!o)return;const{sql:c}=_();await c`
    INSERT INTO harness_shared.work_item_deps
      (workspace_id, blocked_kind, blocked_ref, blocker_kind, blocker_ref, dep_type, created_by)
    VALUES
      (${d}, ${o.blocked_kind}, ${o.blocked_ref}, ${o.blocker_kind}, ${o.blocker_ref}, ${o.dep_type}, ${r.createdBy??null})
    ON CONFLICT (workspace_id, blocked_kind, blocked_ref, blocker_kind, blocker_ref, dep_type)
    DO NOTHING`}async function ke(e,s){const[r,t]=await Promise.all([b(e),b(s)]),{sql:n}=_();await n`
    DELETE FROM harness_shared.work_item_deps
     WHERE workspace_id = ${d}
       AND blocked_kind = ${t.kind}
       AND blocked_ref = ${t.ref}
       AND blocker_kind = ${r.kind}
       AND blocker_ref = ${r.ref}
       AND dep_type = 'blocks'`}async function B(e){const{sql:s}=_(),r=`${e}#`,t=await s`
    SELECT blocked_ref, blocker_ref
      FROM harness_shared.work_item_deps
     WHERE workspace_id = ${d}
       AND dep_type = 'blocks'
       AND blocked_kind = ${l}
       AND blocker_kind = ${l}
       AND blocked_ref LIKE ${r+"%"}`,n=new Map;for(const o of t){if(!o.blocked_ref.startsWith(r)||!o.blocker_ref.startsWith(r))continue;const c=o.blocked_ref.slice(r.length),a=o.blocker_ref.slice(r.length),i=n.get(c)??[];i.includes(a)||i.push(a),n.set(c,i)}return n}function N(e,s,r){const t=new Map;for(const[n,o]of e)n!==s&&t.set(n,[...o]);return t.set(s,Array.from(new Set(r.filter(n=>n!==s)))),H(t).hasCycle}async function m(e,s,r){return(await e`
    SELECT 1 AS one FROM harness_shared.engineer_issues
     WHERE issue_id = ${r} LIMIT 1`).length>0?{kind:k,ref:r}:{kind:l,ref:u(s,r)}}async function x(e,s,r,t={}){if((t.enforceAcyclicity??!0)&&N(await B(e),s,r))throw new Error(`work_item_deps: setting blocked_by for ${e}#${s} would create a dependency cycle`);const{sql:n}=_(),o=u(e,s);await n.begin(async c=>{await c`SELECT pg_advisory_xact_lock(hashtext(${`wid:${d}:${o}`}))`;const a=await m(c,e,s);await c`
      DELETE FROM harness_shared.work_item_deps
       WHERE workspace_id = ${d} AND dep_type = 'blocks'
         AND (
           (blocked_kind = ${l} AND blocked_ref = ${o})
           OR (blocked_kind = ${k} AND blocked_ref = ${s})
         )`;for(const i of r){const w=await m(c,e,i);if(w.kind===a.kind&&w.ref===a.ref)continue;const f=R(w,a);f&&await c`
        INSERT INTO harness_shared.work_item_deps
          (workspace_id, blocked_kind, blocked_ref, blocker_kind, blocker_ref, dep_type)
        VALUES (${d}, ${f.blocked_kind}, ${f.blocked_ref}, ${f.blocker_kind}, ${f.blocker_ref}, 'blocks')
        ON CONFLICT DO NOTHING`}})}var k,L=p((()=>{y(),$(),T(),U(),k="issue"}));async function A(e){const{sql:s}=_(),r=`${e}#`,t=await s`
    SELECT l.dst_ref, l.src_ref
      FROM harness_shared.coord_links l
     WHERE l.workspace_id = ${d}
       AND l.rel = 'blocks'
       AND l.src_kind = ${l}
       AND l.dst_kind = ${l}
       AND l.dst_ref LIKE ${r+"%"}`,n=new Map;for(const o of t){if(!o.dst_ref.startsWith(r)||!o.src_ref.startsWith(r))continue;const c=o.dst_ref.slice(r.length),a=o.src_ref.slice(r.length),i=n.get(c)??[];i.includes(a)||i.push(a),n.set(c,i)}return n}async function ue(e,s,r,t={}){const{sql:n}=_(),o=u(e,s);if((t.enforceAcyclicity??!0)&&N(await A(e),s,r))throw new Error(`blocks: setting blocked_by for ${e}#${s} to [${r.join(", ")}] would create a dependency cycle — rejected (a feature-dependency cycle permanently deadlocks the scheduler frontier)`);const c=P(e,s,r);await n.begin(async a=>{await a`
      DELETE FROM harness_shared.coord_links
       WHERE workspace_id = ${d} AND rel = 'blocks'
         AND dst_kind = ${l} AND dst_ref = ${o}
         AND src_kind = ${l}`;for(const i of c)await a`
        INSERT INTO harness_shared.coord_links
          (workspace_id, src_kind, src_ref, dst_kind, dst_ref, rel, created_by)
        VALUES (${i.workspace_id}, ${i.src_kind}, ${i.src_ref}, ${i.dst_kind}, ${i.dst_ref}, ${i.rel}, 'ei1-sync')
        ON CONFLICT (workspace_id, src_kind, src_ref, dst_kind, dst_ref, rel) DO NOTHING`});try{await x(e,s,r,{enforceAcyclicity:!1})}catch(a){console.warn(`[feature-blockers-edges] work_item_deps mirror failed for ${e}#${s}:`,a)}}function P(e,s,r){const t=[];for(const n of r){const o=n.trim();!o||o===s||t.push({workspace_id:d,src_kind:l,src_ref:u(e,o),dst_kind:l,dst_ref:u(e,s),rel:"blocks"})}return t}async function K(e,s,r){if(s===r)return!1;const t=await A(e);return N(t,s,Array.from(new Set([...t.get(s)??[],r])))}async function pe(e,s){if(!h(e)||!h(s))return null;const r=e.indexOf("#"),t=s.indexOf("#"),n=e.slice(0,r),o=s.slice(0,t);if(n!==o)return null;const c=e.slice(r+1);return await K(o,s.slice(t+1),c)?`'blocks' edge ${e} → ${s} would create a feature-dependency cycle — rejected (a cycle permanently deadlocks the scheduler frontier)`:null}var j=p((()=>{y(),$(),T(),L()}));function G(e,s,r){return!s.has(e)||r.has(e)}function J(e,s,r,t=D){const n=new Set(e.map(i=>i.id)),o=new Set(e.filter(i=>t.has(i.status)).map(i=>i.id)),c=[],a=[];for(const i of e){if(!r.has(i.status)||s.has(i.id))continue;const w=(i.externalBlockers?.length??0)>0,f=i.blockedBy.every(v=>G(v,n,o));w||!f?a.push(i):c.push(i)}return{ready:c,blocked:a}}var D,V=p((()=>{D=new Set(["passed","deprecated","done","dropped"])}));function Y(e,s){return e.map(r=>({id:r.id,status:r.status,blockedBy:s.get(r.id)??[],...r.externalBlockers&&r.externalBlockers.length>0?{externalBlockers:r.externalBlockers}:{}}))}function z(e,s,r,t=new Set){return J(Y(e,s),t,r,M)}function we(e,s,r,t,n=new Set){return z(s,r,t,n).ready.some(o=>o.id===e)}var O,Q,X,M,Z,I,ee,E,se,Ee=p((()=>{F(),$(),y(),j(),L(),V(),O=new Set(["resolved","closed","done","dropped"]),Q=new Set(["done","resolved"]),X=new Set(["dropped","closed"]),M=new Set([...D,...O]),Z={blockersFor:e=>A(e)},I={blockersFor:e=>B(e)},ee=I,E=new C({getSql:()=>_().sql,ensureSchema:async()=>{},workspaceId:d}),se={listOut:(e,s)=>E.listOut(e,s),listIn:(e,s)=>E.listIn(e,s),listInMany:(e,s)=>E.listInMany(e,s)}}));export{h as A,l as C,le as D,u as E,ae as M,_e as O,ke as S,q as T,pe as _,se as a,L as b,Ee as c,Y as d,I as f,A as g,J as h,O as i,de as j,T as k,we as l,V as m,X as n,Z as o,D as p,Q as r,ee as s,M as t,z as u,j as v,g as w,fe as x,ue as y};
