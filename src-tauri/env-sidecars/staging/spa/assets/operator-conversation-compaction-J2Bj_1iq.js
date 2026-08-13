import{n as y}from"./chunk-ChpBd9eV.js";import{c as M,d as w,i as N,o as R,u as E}from"./operator-conversations-B04Qna3X.js";import{_ as U,a as b,b as A,c as x,i as C,l as v,r as q,t as P,v as $}from"./haiku-Co1e4PuZ.js";function k(e,t,o=g){const s=t.map(n=>`[${n.role}] ${n.text.slice(0,p)}`).join(`

`);return`You maintain the rolling memory of a long conversation between a user and their operator assistant. Merge the EXISTING SUMMARY (older context) with the NEW TURNS (which just aged out of the verbatim window) into ONE updated summary.

${o}

HARD LIMIT: at most ${m} characters. Plain text, short bullets allowed. No preamble, no headings — output the summary only.

EXISTING SUMMARY:
${e?.trim()||"(none — conversation start)"}

NEW TURNS (oldest first):
${s}

UPDATED SUMMARY:`}function O(e){let t=e.trim();return t=t.replace(/^updated summary:\s*/i,"").trim(),t.length>6e3&&(t=t.slice(0,m-1).trimEnd()+"…"),t}function F(e){if(e.length>=8)return!0;let t=0;for(const o of e)t+=C(o.text);return t>=f}async function I(e,t={}){const o=await E(e);if(!o)return{outcome:"not_found"};const s=await M(e);if(s===null)return{outcome:"nothing_to_fold"};const n=s-12;if(n<=(o.summaryThroughSeq??-1))return{outcome:"up_to_date"};const u=(await R(e,o.summaryThroughSeq,n)).filter(T=>T.text.trim().length>0);if(u.length===0)return{outcome:"nothing_to_fold"};if(!t.force&&!F(u))return{outcome:"below_threshold"};const c=await U();if(c.state&&c.exceeded)return{outcome:"budget_exceeded"};const a=u.slice(0,60),l=a[a.length-1].seq,r=await(t.summarize??S)(k(o.summaryText,a,v()??void 0));if(!r)return{outcome:"llm_unavailable"};const d=O(r.text);return d?(r.costUsd>0&&A(r.costUsd),await w({conversationId:e,expectedThroughSeq:o.summaryThroughSeq,summaryText:d,summaryThroughSeq:l,summaryModel:r.model,turnsAdded:a.length})?{outcome:"compacted",summaryThroughSeq:l,turnsFolded:a.length,costUsd:r.costUsd}:{outcome:"cas_lost"}):{outcome:"llm_unavailable"}}async function L(e){if(!(!e||i.has(e))){i.add(e);try{const t=await I(e);t.outcome==="compacted"?console.log(`[conversation-compaction] ${e}: folded ${t.turnsFolded} turns (through seq ${t.summaryThroughSeq}, $${(t.costUsd??0).toFixed(4)})`):t.outcome==="llm_unavailable"&&console.warn(`[conversation-compaction] ${e}: summarizer unavailable`)}catch(t){console.warn("[conversation-compaction] pass failed:",t instanceof Error?t.message:String(t))}finally{i.delete(e)}}}var W,X,f,m,p,Y,h,_,g,S,i,z=y((()=>{b(),N(),P(),$(),x(),W=12,X=8,f=4e3,m=6e3,p=2e3,Y=60,h=2e3,_=45e3,g=`Preserve with highest priority:
- decisions made, and why
- preferences / standing instructions the user stated
- named artifacts: plans, features (F-NNN), work items, files, harnesses, URLs
- open questions, commitments, unfinished work
Compress or drop: greetings, transient status chatter, superseded states.`,S=e=>q(e,{maxTokens:h,timeoutMs:_}),i=new Set}));z();export{L as maybeCompactConversation};
