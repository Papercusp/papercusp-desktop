import{n as d}from"./chunk-ChpBd9eV.js";import{st as _,t as p}from"./src-BmBNODK0.js";import{o as l,r as S}from"./log-BwQLkm9I.js";import{M as R,T as f}from"./issues-engineer-DdQR2cKv.js";async function I(e){const a=e??_().sql,n=R(),u=await a`
      SELECT ei.issue_id, 'sourceRole' AS via
        FROM harness_shared.engineer_issues ei
       WHERE ei.workspace_id = ${n}
         AND ei.payload ->> 'sourceRole' = ${r}
    UNION ALL
      SELECT cl.src_ref AS issue_id, 'topic' AS via
        FROM harness_shared.coord_links cl
       WHERE cl.workspace_id = ${S()}
         AND cl.rel = 'tagged'
         AND cl.src_kind = 'issue'
         AND cl.dst_kind = 'topic'
         AND cl.dst_ref = ${c}
    UNION ALL
      SELECT DISTINCT substring(r.routed_ref from 4) AS issue_id, 'routedIdea' AS via
        FROM harness_shared.scout_routed_ideas r
       WHERE r.workspace_id = ${n}
         AND r.routed_ref LIKE 'wi:%'
  `,i=new Set,o={bySourceRole:0,byTopic:0,byRoutedIdea:0,union:0};for(const s of u){const t=s.issue_id;t&&(i.add(t),s.via==="sourceRole"?o.bySourceRole+=1:s.via==="topic"?o.byTopic+=1:o.byRoutedIdea+=1)}return o.union=i.size,{ids:[...i],counts:o}}function N(e){return e.union===0?0:1-Math.min(e.bySourceRole,e.byTopic,e.byRoutedIdea)/e.union}var r,c,E=d((()=>{p(),f(),l(),r="Scout",c=`improvement-source:${r}`}));E();export{N as provenanceDivergence,I as readLoopOutputIds};
