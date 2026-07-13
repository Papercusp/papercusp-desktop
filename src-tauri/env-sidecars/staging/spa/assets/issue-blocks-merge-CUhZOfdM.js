import{n as e}from"./chunk-CMxvf4Kt.js";import{J as t,t as n}from"./src-CRqYcphb.js";import{r,t as i}from"./coordination-event-log-browser-Dq_4i-_C.js";function a(e,t){return`${e}#${t}`}function o(e,t){return`${e}#${t}`}function s(e){let t=e.indexOf(`#`);return t>0&&t<e.length-1&&e.indexOf(`#`,t+1)===-1}async function c(){let{sql:e}=t(),n=await e`
    SELECT l.dst_ref, l.src_ref AS issue_id
      FROM harness_shared.coord_links l
      JOIN harness_shared.engineer_issues i
        ON i.issue_id = l.src_ref
     WHERE l.workspace_id = ${i}
       AND l.rel = 'blocks'
       AND l.src_kind = 'issue'
       AND l.dst_kind = ${l}
       AND i.state = 'open'
     ORDER BY l.src_ref`,r=new Map;for(let e of n){let t=r.get(e.dst_ref)??[];t.push(e.issue_id),r.set(e.dst_ref,t)}return r}var l,u,d=e((()=>{n(),r(),l=`plan_item`,u=`feature`}));export{d as a,c as i,l as n,s as o,o as r,a as s,u as t};