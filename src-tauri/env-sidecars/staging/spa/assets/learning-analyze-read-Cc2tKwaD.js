import{n as p}from"./chunk-ChpBd9eV.js";import{i as d}from"./degraded-snapshot-dcpcqMtk.js";import{i as E,n as h}from"./learning-scout-read-S2PCzFMy.js";function l(c){return Array.isArray(c)?c:[]}function y(c){return c.created_at instanceof Date?c.created_at.toISOString():c.created_at?String(c.created_at):null}async function u(c,i,o){const a=new Map;if(o.length===0)return a;try{const t=await c`
      SELECT * FROM harness_shared.scout_ticks
       WHERE workspace_id = ${i}
         AND detail->>'cycleId' IN ${c(o)}
    `;for(const r of t){const n=E(r);n.cycleId&&a.set(n.cycleId,n)}}catch(t){d(t)||console.warn("[learning.analyze] tick join failed:",t instanceof Error?t.message:t)}return a}async function _(c,i,o){const a=new Map;if(o.length===0)return a;try{const t=await c`
      SELECT cycle_id, idea_id, rail, routed_ref, title
        FROM harness_shared.scout_routed_ideas
       WHERE workspace_id = ${i}
         AND cycle_id IN ${c(o)}
    `;for(const r of t){const n=typeof r.cycle_id=="string"?r.cycle_id:"";if(!n)continue;const s=String(r.idea_id??""),e=a.get(n)??[];e.push({ideaId:s.startsWith(`${n}:`)?s.slice(n.length+1):s,rail:String(r.rail??""),routedRef:String(r.routed_ref??""),title:typeof r.title=="string"&&r.title?r.title:null}),a.set(n,e)}}catch(t){d(t)||console.warn("[learning.analyze] routed join failed:",t instanceof Error?t.message:t)}return a}async function R(c,i){const o=new Date().toISOString();let a=[];try{a=await c`
      SELECT cycle_id, created_at, ideas, scored, proposals
        FROM harness_shared.scout_cycle_stage_artifacts
       WHERE workspace_id = ${i}
       ORDER BY created_at DESC
       LIMIT ${f}
    `}catch(e){return d(e)||console.warn("[learning.analyze] artifacts read failed:",e instanceof Error?e.message:e),{cycles:[],generatedAt:o}}const t=a.map(e=>({cycleId:String(e.cycle_id??""),at:y(e),ideasCount:l(e.ideas).length,proposalsCount:l(e.proposals).length,routedCount:0,verdicts:l(e.scored).map(g=>String(g?.verdict??"")),tick:null})),r=t.map(e=>e.cycleId).filter(e=>e.length>0);if(r.length===0)return{cycles:t,generatedAt:o};const[n,s]=await Promise.all([u(c,i,r),_(c,i,r)]);for(const e of t)e.tick=n.get(e.cycleId)??null,e.routedCount=s.get(e.cycleId)?.length??0;return{cycles:t,generatedAt:o}}async function k(c,i,o){let a=[];try{a=await c`
      SELECT cycle_id, created_at, ideas, scored, proposals, ideator_slots
        FROM harness_shared.scout_cycle_stage_artifacts
       WHERE workspace_id = ${i}
         AND cycle_id = ${o}
       LIMIT 1
    `}catch(e){return d(e)||console.warn("[learning.analyzeCycle] artifacts read failed:",e instanceof Error?e.message:e),null}const t=a[0];if(!t)return null;const r={cycleId:String(t.cycle_id??""),at:y(t),ideas:l(t.ideas),scored:l(t.scored),proposals:l(t.proposals),ideatorSlots:l(t.ideator_slots),tick:null,routed:[]};if(!r.cycleId)return r;const[n,s]=await Promise.all([u(c,i,[r.cycleId]),_(c,i,[r.cycleId])]);return r.tick=n.get(r.cycleId)??null,r.routed=s.get(r.cycleId)??[],r}var f,m=p((()=>{h(),f=8}));m();export{k as readAnalyzeCycle,R as readAnalyzeSnapshot};
