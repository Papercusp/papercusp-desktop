import{n as R}from"./chunk-ChpBd9eV.js";import{st as h,t as p}from"./src-BmBNODK0.js";import{c as O,d as c,r as I}from"./workspace-registry-Du2UbhlH.js";function o(e){return e??h().sql}function l(e){if(e==null)return null;const t=(e instanceof Date?e:new Date(e)).getTime();return Number.isNaN(t)?null:t}function a(e){return{id:Number(e.id),workspaceId:e.workspace_id,ownerId:e.owner_id,sessionRef:e.session_ref,sourceTurnRef:e.source_turn_ref,verbatimText:e.verbatim_text,recordedBy:e.recorded_by,createdAtMs:l(e.created_at)??0,dispositionedAtMs:l(e.dispositioned_at),dispositionStatus:e.disposition_status==="done"||e.disposition_status==="declined"?e.disposition_status:null,dispositionNote:e.disposition_note,dispositionedBy:e.dispositioned_by}}async function x(e,t){const n=o(t),s=c(e.workspaceId),i=e.verbatimText.slice(0,E);return a((await n`
    INSERT INTO harness_shared.owner_directives
      (workspace_id, owner_id, session_ref, source_turn_ref, verbatim_text, recorded_by)
    VALUES
      (${s}, ${e.ownerId??"owner"}, ${e.sessionRef??null},
       ${e.sourceTurnRef??null}, ${i}, ${e.recordedBy})
    RETURNING *
  `)[0])}async function N(e,t){const n=await o(t)`
    SELECT * FROM harness_shared.owner_directives WHERE id = ${e}
  `;return n[0]?a(n[0]):null}async function m(e,t){const n=o(t),s=c(e.workspaceId),i=Math.max(1,Math.min(e.limit??50,200));return(await n`
    SELECT * FROM harness_shared.owner_directives
     WHERE (workspace_id = ${s} OR workspace_id = 'default')
       ${e.open===!0?n`AND dispositioned_at IS NULL`:e.open===!1?n`AND dispositioned_at IS NOT NULL`:n``}
     ORDER BY created_at ASC, id ASC
     LIMIT ${i}
  `).map(a)}async function D(e,t=12,n){return m({workspaceId:e,open:!0,limit:t},n)}async function T(e,t){const n=await o(t)`
    SELECT count(*) AS n FROM harness_shared.owner_directives
     WHERE (workspace_id = ${c(e)} OR workspace_id = 'default')
       AND dispositioned_at IS NULL
  `;return Number(n[0]?.n??0)}async function B(e,t){const n=await o(t)`
    UPDATE harness_shared.owner_directives
       SET dispositioned_at = now(),
           disposition_status = ${e.status},
           disposition_note = ${e.note},
           dispositioned_by = ${e.dispositionedBy}
     WHERE id = ${e.id}
       AND dispositioned_at IS NULL
     RETURNING *
  `;if(n[0])return{ok:!0,row:a(n[0])};const s=await N(e.id,t);return s?{ok:!1,error:"already_dispositioned",row:s}:{ok:!1,error:"not_found"}}function y(e){const t=Math.round(e/6e4);if(t<60)return`${Math.max(t,1)}m`;const n=Math.floor(t/60);return n<48?`${n}h`:`${Math.round(n/24)}d`}function $(e,t=Date.now()){const n=y(Math.max(0,t-e.createdAtMs)),s=e.recordedBy.length>12?e.recordedBy.slice(0,12):e.recordedBy,i=e.verbatimText.trim(),r=i.length<=300?`"${i}"`:`"${i.slice(0,200)}…" [full text: orders:get #${e.id}]`;return`  • #${e.id} [${n} old, recorded by ${s}] ${r}`}function M(e,t={}){if(!e.length)return null;const n=t.nowMs??Date.now(),s=Math.max(t.totalOpen??e.length,e.length),i=[w];let r=332,_=0;for(const f of e){const d=$(f,n);if(r+d.length+1>6e3)break;i.push(d),r+=d.length+1,_+=1}const u=s-_;return u>0&&i.push(`  +${u} more open — orders:list { open: true }`),i.join(`
`)}async function U(e,t={}){const n=e||I();if(!n)return null;try{const s=await D(n,12,t.sql);if(!s.length)return null;const i=s.length>=12?await T(n,t.sql).catch(()=>s.length):s.length;return M(s,{nowMs:t.nowMs,totalOpen:i})}catch{return null}}var g,v,A,C,E,S,w,V=R((()=>{p(),O(),g=300,v=200,A=6e3,C=12,E=16e3,S="owner",w="📌 OPEN OWNER DIRECTIVES — explicit owner orders recorded verbatim (orders:record), still awaiting disposition. These OUTRANK your loop agenda: re-read them BEFORE acting on the checkpoint below, act on / carry the ones in your lane, and close each finished or refused one via orders:disposition { id, status: done|declined, note }."}));export{E as a,N as c,m as d,x as f,M as h,S as i,V as l,$ as m,w as n,T as o,U as p,C as r,B as s,A as t,D as u};
