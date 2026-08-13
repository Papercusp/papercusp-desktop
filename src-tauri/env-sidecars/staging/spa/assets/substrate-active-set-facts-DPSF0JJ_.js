import{n as u}from"./chunk-ChpBd9eV.js";function o(e,r){return`${e}::${r}`}function c(e){return e.harnessKind==="hive"||e.hiveSlug!=null&&e.hiveSlug!==""}async function g(e,r,i=new Set){let t,n;try{[t,n]=await Promise.all([r.pendingOutboxCounts(),r.lastPresenceMs()])}catch(s){return console.warn("[substrate-active-set] activation probe failed — booting EVERY harness eagerly (fail-open):",s instanceof Error?s.message:String(s)),e.map(a=>({key:o(a.workspaceId,a.harnessSlug),pinned:!0,pendingOutboxRows:1,lastPresenceMs:null,federating:c(a)}))}return e.map(s=>{const a=o(s.workspaceId,s.harnessSlug);return{key:a,pinned:s.harnessKind==="hive"||i.has(a),pendingOutboxRows:t.get(a)??0,lastPresenceMs:n.get(a)??null,federating:c(s)}})}function d(e,r=3600*1e3){return{async pendingOutboxCounts(){const i=await e`
        SELECT workspace_id, harness_slug, count(*)::bigint AS n
        FROM harness_shared.substrate_outbox
        WHERE drained_at IS NULL
        GROUP BY workspace_id, harness_slug
      `,t=new Map;for(const n of i)t.set(o(n.workspace_id,n.harness_slug),Number(n.n));return t},async lastPresenceMs(){const i=await e`
        SELECT workspace_id, harness_slug, max(last_seen_at) AS last_seen
        FROM harness_shared.shared_presence
        WHERE last_seen_at > ${new Date(Date.now()-r)}
        GROUP BY workspace_id, harness_slug
      `,t=new Map;for(const n of i){const s=new Date(n.last_seen).getTime();Number.isFinite(s)&&t.set(o(n.workspace_id,n.harness_slug),s)}return t}}}var l=u((()=>{}));l();export{d as createPgActivationFactDeps,g as gatherActivationFacts};
