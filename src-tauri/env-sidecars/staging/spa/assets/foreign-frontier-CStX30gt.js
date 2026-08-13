import{n as d}from"./chunk-ChpBd9eV.js";import{n as u,t as f}from"./rendezvous-authority-BSe4Uzth.js";import{c as p,i as h,r as _,s as m,t as r}from"./niche-Du2kGJT9.js";function l(i){return typeof i=="string"?JSON.parse(i):i}function y(i,t){return t.fitness-i.fitness||i.nicheKey.localeCompare(t.nicheKey)||(i.sourceHive??"").localeCompare(t.sourceHive??"")||i.candidateId.localeCompare(t.candidateId)}async function E(i,t){return(await i`
    SELECT
      niche_key,
      scope,
      domain,
      risk,
      candidate_id,
      fitness,
      descriptor,
      rationale,
      source,
      NULL::text AS source_hive
    FROM harness_shared.gym_qd_archive
    WHERE workspace_id = ${t.workspaceId}
      AND harness_slug = ${t.harnessSlug}

    UNION ALL

    SELECT
      niche_key,
      scope,
      domain,
      risk,
      candidate_id,
      fitness,
      descriptor,
      rationale,
      'gym'::text AS source,
      source_hive
    FROM harness_shared.gym_qd_foreign_elites
    WHERE workspace_id = ${t.workspaceId}
      AND harness_slug = ${t.harnessSlug}
  `).map(e=>({nicheKey:e.niche_key,coords:{scope:e.scope,domain:e.domain,risk:e.risk},candidateId:e.candidate_id,fitness:Number(e.fitness),descriptor:l(e.descriptor),rationale:e.rationale,source:e.source,sourceHive:e.source_hive})).sort(y)}function g(i=r){const t=[];for(const e of h)for(const n of i)for(const s of _)t.push(p({scope:e,domain:n,risk:s}));return t}function N(i,t=r){const e=new Set(i);return g(t).filter(n=>!e.has(n))}function S(i,t){if(t.length===0)return null;const e=[...new Set(t)].sort();let n=e[0],s=u(i,n);for(let o=1;o<e.length;o++){const a=e[o],c=u(i,a);(c>s||c===s&&a<n)&&(n=a,s=c)}return n}function k(i,t,e){return[...i].filter(n=>S(n,t)===e).sort()}function v(i,t,e,n=r){return k(N(i.map(s=>s.nicheKey),n),t,e)}async function H(i,t,e,n,s=r){return v(await E(i,t),e,n,s)}var I=d((()=>{m(),f()}));export{I as a,S as c,v as i,N as n,E as o,H as r,k as s,g as t};
