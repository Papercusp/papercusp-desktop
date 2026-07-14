import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-BvZp-r10.js";import{n as r,s as i}from"./workspace-registry-Bu1Yy540.js";import{a,n as o,s}from"./assignments-C_xjSTiH.js";import{a as c,n as l,s as u}from"./issue-blocks-merge-BOhEHRx5.js";function d(e){return e===`progressing`||e===`alive`}function f(e,t){if(e.length===0)return t?`full`:`none`;let n=e.filter(e=>!e.terminal);return n.length===0?`complete`:t||n.some(e=>d(e.activity))?n.every(e=>d(e.activity))?`full`:`partial`:`unclaimed`}function p(e){let t=[];for(let n of e){if(!n.directlyClaimed||!n.directHolder)continue;let e=n.links.filter(e=>e.holder!=null&&e.holder!==n.directHolder).map(e=>({workItemId:e.workItemId,holder:e.holder}));if(e.length===0)continue;let r=[...new Set([n.directHolder,...e.map(e=>e.holder)])];t.push({ref:n.ref,directHolder:n.directHolder,workItemHolders:e,principals:r})}return t}function m(e){return{level:e.level,...e.workers.length?{workers:e.workers}:{},...e.links.length?{links:e.links.map(e=>({id:e.workItemId,rel:e.rel,activity:e.activity,terminal:e.terminal}))}:{}}}async function h(){let{sql:e}=t(),n=await e`
    SELECT l.dst_ref, l.rel, l.src_kind, l.src_ref,
           i.state      AS issue_state,
           f.status     AS feature_status,
           f.feature_id AS feature_id,
           GREATEST(i.updated_at,
                    to_timestamp((f.updated_ts::numeric / 1000.0)::double precision))
                        AS src_updated_at
      FROM harness_shared.coord_links l
      LEFT JOIN harness_shared.engineer_issues i
        ON l.src_kind = 'issue' AND i.issue_id = l.src_ref
      LEFT JOIN harness_shared.harness_features_consolidated f
        ON l.src_kind = 'feature'
       AND (f.harness_slug || '#' || f.feature_id) = l.src_ref
       AND f.workspace_id = ${r()}
     WHERE l.rel IN ('fixes', 'relates', 'duplicates')
       AND l.dst_kind = ${l}
     ORDER BY l.dst_ref, l.src_ref`,i=await s({workspaceId:null,activeOnly:!0}),a=new Map,c=new Map;for(let e of i)e.source===`work_item_claim`&&e.workItemId?a.set(e.workItemId,{activity:o(e),holder:e.agentId}):e.source===`plan_item_claim`&&e.planSlug&&e.itemId&&c.set(u(e.planSlug,e.itemId),{activity:o(e),holder:e.agentId});let p=new Map,m=new Map;for(let e of n){let t=e.src_kind===`issue`?e.src_ref:e.feature_id??e.src_ref,n=e.issue_state!=null&&_.has(e.issue_state)||e.feature_status!=null&&v.has(e.feature_status),r=a.get(t),i=r?.activity??`free`,o=d(i)?r?.holder??null:null,s=p.get(e.dst_ref)??[];if(s.push({workItemId:t,rel:e.rel,terminal:n,activity:i,holder:o}),p.set(e.dst_ref,s),e.src_updated_at!=null){let t=new Date(e.src_updated_at).getTime();Number.isFinite(t)&&t>(m.get(e.dst_ref)??0)&&m.set(e.dst_ref,t)}}let h=new Map,g=new Set([...p.keys(),...c.keys()]);for(let e of g){let t=p.get(e)??[],n=c.get(e)??null,r=!!(n&&d(n.activity)),i=f(t,r),a=new Set;for(let e of t)e.holder&&a.add(e.holder);r&&n?.holder&&a.add(n.holder);let o=m.get(e);h.set(e,{ref:e,links:t,directlyClaimed:r,directHolder:n?.holder??null,directActivity:n?.activity??null,level:i,workers:[...a],lastActivityAt:o==null?null:new Date(o)})}return h}var g,_,v,y=e((()=>{n(),i(),a(),c(),g=[`fixes`,`relates`,`duplicates`],_=new Set([`resolved`,`closed`]),v=new Set([`passed`,`deprecated`])}));export{h as a,p as i,f as n,y as o,m as r,g as t};