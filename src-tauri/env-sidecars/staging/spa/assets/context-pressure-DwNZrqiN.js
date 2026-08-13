import{n as c}from"./chunk-ChpBd9eV.js";import{st as a,t as u}from"./src-BmBNODK0.js";import{n as _,r as l,t as f}from"./inbox-context-usage-BwVH-RXO.js";function m(r,o,n,i=Date.now()){const t=_(r,o);if(t==null)return null;if(n!=null){const s=n instanceof Date?n.getTime():new Date(n).getTime();if(!Number.isFinite(s)||i-s>9e5)return null}const e=f(t);return e==null||e==="quiet"?"ok":e==="loud"?"high":"critical"}async function T(r){const o=new Map;if(r.length===0)return o;const{sql:n}=a(),i=await n`
    SELECT owner_id, context_tokens, compaction_limit, context_estimated_at
      FROM harness_shared.coord_presence
     WHERE owner_id = ANY(${r}::text[])
  `;for(const t of i){const e=m(t.context_tokens,t.compaction_limit,t.context_estimated_at);e!=null&&o.set(t.owner_id,e)}return o}var x,w=c((()=>{u(),l(),x=15*6e4}));export{T as n,w as r,m as t};
