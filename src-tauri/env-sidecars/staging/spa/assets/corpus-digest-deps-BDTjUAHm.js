import{n as d}from"./chunk-ChpBd9eV.js";import{st as a,t as f}from"./src-BmBNODK0.js";import{c as l,l as u,o as p}from"./read-items-B8dJDKgW.js";import{_,g as m}from"./rubrics-L4XRJfY0.js";import{a as g,n as v,o as b,r as S}from"./change-feed-deps-CBpHvodj.js";import{a as h,i as E}from"./corpus-digest-BI_LKGIw.js";function y(e){const t=typeof e=="number"?e:Number(e??0);return new Date(Number.isFinite(t)?t:0).toISOString()}function c(e){if(!e)return"";const t=e.trim();if(t.startsWith('"')&&t.endsWith('"'))try{return String(JSON.parse(t))}catch{return t.slice(1,-1)}return t}async function O(){const{sql:e}=a();return(await e`
    SELECT feature_id, harness_slug, old_value, new_value, actor, ts
      FROM harness_shared.feature_audit_consolidated
     WHERE field = 'status'
       AND old_value IS NOT NULL
       AND new_value IS NOT NULL
     ORDER BY ts DESC
     LIMIT 2000`).map(t=>({workItemId:t.feature_id,harness:t.harness_slug??void 0,from:c(t.old_value),to:c(t.new_value),actor:t.actor,ts:y(t.ts)})).filter(t=>h(t.from,t.to)>0)}async function A(){const{sql:e}=a();return(await e`
    SELECT harness_slug,
           role,
           COALESCE(SUM(cost_usd), 0)       AS cost,
           COALESCE(SUM(input_tokens), 0)   AS input,
           COALESCE(SUM(output_tokens), 0)  AS output,
           COUNT(*)                          AS runs
      FROM harness_shared.agent_usage_samples
     GROUP BY harness_slug, role
     ORDER BY cost DESC NULLS LAST
     LIMIT 200`).map(t=>({harness:t.harness_slug,role:t.role,costUsd:Number(t.cost??0),inputTokens:Number(t.input??0),outputTokens:Number(t.output??0),runs:Number(t.runs??0)}))}async function I(){const{sql:e}=a(),t=await e`
    SELECT p.plan_slug,
           i->>'id'     AS ref_id,
           i->>'status' AS status,
           i->>'text'   AS text
      FROM harness_shared.harness_plans p,
           jsonb_array_elements(COALESCE(p.items, '[]'::jsonb)) AS i
     WHERE i->>'status' IN ('blocked', 'needs-human')
     LIMIT 1000`,r=await e`
    SELECT p.plan_slug,
           d->>'id'    AS ref_id,
           d->>'title' AS title
      FROM harness_shared.harness_plans p,
           jsonb_array_elements(COALESCE(p.decisions, '[]'::jsonb)) AS d
     WHERE d->>'body' ~* '\\mdeferr'
     LIMIT 1000`,i=[];for(const s of t)!s.ref_id||!s.text||i.push({planSlug:s.plan_slug,refId:s.ref_id,source:"item",status:s.status??"blocked",text:s.text});for(const s of r)!s.ref_id||!s.title||i.push({planSlug:s.plan_slug,refId:s.ref_id,source:"decision",status:"decision",text:s.title});return i}function R(e){const t=e.observation;return t&&typeof t=="object"?t:void 0}function L(e){if(!e||typeof e!="object"||Array.isArray(e))return;const t={};for(const[r,i]of Object.entries(e)){if(!r||!i||typeof i!="object")continue;const{rating:s,evidence:o,suggestion:n}=i;typeof s!="string"||!s.trim()||(t[r]={rating:s,evidence:typeof o=="string"?o:"",...typeof n=="string"&&n.trim()?{suggestion:n}:{}})}return Object.keys(t).length?t:void 0}function C(e){const t=R(e);if(!t)return;const r=typeof t.rubricRef=="string"&&t.rubricRef.trim()?t.rubricRef:void 0,i=L(t.ratings);if(!r||!i)return;const s=typeof t.sourceHive=="string"&&t.sourceHive.trim()?t.sourceHive:void 0,o=typeof t.targetHive=="string"&&t.targetHive.trim()?t.targetHive:void 0,n=Date.parse(e.updatedAt??e.createdAt??"");return{id:e.id,title:e.title,rubricRef:r,ratings:i,...s?{sourceHive:s}:{},...o?{targetHive:o}:{},...Number.isFinite(n)?{lastSeenMs:n}:{}}}function U(e={}){return{async completions(){return g(v())},async reverts(){return O()},async friction(){const[t,r]=await Promise.all([l(),u()]);return[...t,...r]},async spend(){return A()},async deferrals(){return I()},async observations(){const t=await u(e.observationOrigins?{origins:e.observationOrigins}:{}),r=[];for(const i of t){const s=C(i);s&&r.push(s)}return r},async rubrics(){return(await _({status:"active",limit:500})).map(t=>({rubricId:t.rubricId,characteristic:t.characteristic,title:t.title,criteriaTitles:t.criteria.map(r=>r.title)}))}}}var k=d((()=>{f(),b(),S(),p(),m(),E()}));export{k as n,U as t};
