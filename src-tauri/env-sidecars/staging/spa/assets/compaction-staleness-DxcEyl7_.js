const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/__vite-browser-external-CGWw7gYu.js","assets/__vite-browser-external-56mrcCg8.js","assets/chunk-ChpBd9eV.js"])))=>i.map(i=>d[i]);
import{n as _,o as p}from"./chunk-ChpBd9eV.js";import{n as f,t as w}from"./preload-helper-CcgcQsTF.js";import{st as c,t as h}from"./src-BmBNODK0.js";function g(i){const s=i.split(`
`);for(let e=s.length-1;e>=0;e--){const t=s[e];if(!(!t||!t.includes('"subtype":"compact_boundary"')))try{const a=JSON.parse(t),n=a.timestamp?Date.parse(a.timestamp):NaN;if(Number.isFinite(n))return n}catch{}}return null}async function N(i){const{open:s}=await w(async()=>{const{open:t}=await import("./__vite-browser-external-CGWw7gYu.js").then(a=>p(a.default,1));return{open:t}},__vite__mapDeps([0,1,2])),e=await s(i,"r");try{const{size:t}=await e.stat(),a=Math.max(0,t-m),n=Buffer.alloc(t-a);return await e.read(n,0,n.length,a),g(n.toString("utf8"))}finally{await e.close()}}function u(i,s){const e=Math.round(Math.max(0,s-i)/6e4);if(e<60)return`${Math.max(e,1)}m ago`;const t=Math.floor(e/60);return t<48?`${t}h ago`:`${Math.round(t/24)}d ago`}async function q(i,s,e){const t=e.now??Date.now(),a=e.summaryAtMs,n=[];let d=[];try{d=await(e.listOwnClaimsFn??y(e.sql))(i,s);for(const r of d)r.expiresTsMs<t&&n.push(`your claim on ${r.planSlug}#${r.itemId} LAPSED ${u(r.expiresTsMs,t)} — re-claim (plans:set-status wip, or orient planItems) before resuming; a peer may hold it now`)}catch{}try{const r=e.listHeldChangedSinceFn??M(e.sql);for(const l of await E(r,i,s,a))n.push(`your work-item ${l.id} CHANGED after the summary was written (${u(l.updatedAtMs,t)}; state now: ${l.state}) — re-read it via work_items:get before acting on the summary's version`)}catch{}try{const r=[...new Set(d.map(l=>l.planSlug))];if(r.length){const l=e.listPeerClaimsSinceFn??S(e.sql);for(const o of await l(i,s,a,r))n.push(`${o.planSlug}#${o.itemId} was claimed by ${o.owner} AFTER your summary (${u(o.acquiredTsMs,t)}) — the summary predates this claim`)}}catch{}try{const r=e.listFleetPeersSinceFn??$(e.sql);for(const l of await r(i,a))n.push(`fleet peer ${l.label||l.ownerId} APPEARED after your summary (${u(l.startedAtMs,t)}) — any member/liveness counts in the summary are stale`)}catch{}return n.slice(0,8)}async function E(i,s,e,t){return(await i(s,e,t)).filter(a=>a.updatedAtMs>t)}function y(i){return async(s,e)=>(await(i??c().sql)`
      SELECT plan_slug, item_id, expires_ts
        FROM harness_shared.plan_item_claims
       WHERE owner = ${s} AND workspace_id = ${e}
       LIMIT ${8}
    `).map(t=>({planSlug:t.plan_slug,itemId:t.item_id,expiresTsMs:new Date(t.expires_ts).getTime()}))}function S(i){return async(s,e,t,a)=>(await(i??c().sql)`
      SELECT plan_slug, item_id, owner, acquired_ts
        FROM harness_shared.plan_item_claims
       WHERE workspace_id = ${e}
         AND plan_slug = ANY(${a})
         AND owner <> ${s}
         AND acquired_ts > ${new Date(t)}
       ORDER BY acquired_ts DESC
       LIMIT ${8}
    `).map(n=>({planSlug:n.plan_slug,itemId:n.item_id,owner:n.owner,acquiredTsMs:new Date(n.acquired_ts).getTime()}))}function $(i){return async(s,e)=>{const t=i??c().sql,a=(await t`
      SELECT fleet_slug FROM harness_shared.coord_presence
       WHERE owner_id = ${s}
       ORDER BY heartbeat_at DESC
       LIMIT 1
    `)[0]?.fleet_slug;return a?(await t`
      SELECT owner_id, owner_label, started_at
        FROM harness_shared.coord_presence
       WHERE fleet_slug = ${a}
         AND owner_id <> ${s}
         AND started_at > ${new Date(e)}
       ORDER BY started_at DESC
       LIMIT ${8}
    `).map(n=>({ownerId:n.owner_id,label:n.owner_label,startedAtMs:new Date(n.started_at).getTime()})):[]}}function M(i){return async(s,e,t)=>(await(i??c().sql)`
      SELECT issue_id, state, updated_at
        FROM harness_shared.engineer_issues
       WHERE assignee = ${s}
         AND (workspace_id = ${e} OR workspace_id = 'default')
         AND updated_at > ${new Date(t)}
       ORDER BY updated_at DESC
       LIMIT ${8}
    `).map(a=>({id:a.issue_id,state:a.state,updatedAtMs:new Date(a.updated_at).getTime()}))}var D,m,T=_((()=>{h(),f(),D=8,m=512*1024}));T();export{q as buildStalenessWarnings,N as readLastCompactBoundaryTs};
