import{n as _}from"./chunk-ChpBd9eV.js";import{i as h,r as E}from"./hive-groups-FD3WCUsg.js";import{A as p,t as d}from"./drizzle-orm-BbO4Lkx2.js";import{Q as c,gn as m,st as g,t as R}from"./src-8fWtxfEz.js";async function u(t){const{db:a}=g();return(await a.select({payload:o.payload}).from(o).where(p(o.workspaceId,t)).limit(1))[0]?.payload?.projects??[]}async function M(t,a){return(await u(t)).some(e=>e.slug===a)}async function A(t,a={}){const e=await u(t),n=a.includeHiveHomes?e:e.filter(s=>!h(s));if(n.length===0)return[];const r=await c(t,async s=>s`
      SELECT DISTINCT ON (harness_slug)
        harness_slug, status, iteration, last_active_ts
      FROM harness_shared.harness_status
      ORDER BY harness_slug, COALESCE(last_active_ts, 0) DESC
    `),l=new Map(r.map(s=>[s.harness_slug,s]));return n.map(s=>{const i=l.get(s.slug);return{slug:s.slug,path:s.path,harness_kind:s.harness_kind??null,has_state:i!=null,status:i?.status??null,iteration:i?.iteration??null,last_active_ts:i?.last_active_ts??null}})}async function H(t,a){return c(t,async e=>{const n=(await e`
      SELECT MAX(GREATEST(COALESCE(updated_ts, 0), COALESCE(created_ts, 0))) AS last_ms
      FROM harness_shared.work_items
      WHERE harness_slug = ${a}
    `)[0]?.last_ms;if(n==null)return null;const r=typeof n=="string"?Number(n):n;return Number.isFinite(r)&&r>0?r:null})}async function T(t,a){return c(t,async e=>{const n=await e`
      SELECT phase, status, iteration,
             total_features, passed_count, todo_count, blocked_count,
             last_active_ts, cost_usd
      FROM harness_shared.harness_status
      WHERE harness_slug = ${a}
      ORDER BY COALESCE(last_active_ts, 0) DESC
      LIMIT 1
    `;if(n.length===0)return null;const r=n[0],l=await e`
      SELECT role
      FROM harness_shared.harness_lanes
      WHERE harness_slug = ${a} AND phase = ${r.phase}
    `,s=await e`
      SELECT escalation
      FROM harness_shared.harness_escalations
      WHERE harness_slug = ${a} AND phase = ${r.phase}
      LIMIT 1
    `;return{slug:a,...r,active_roles:l.map(i=>i.role),escalation:s[0]?.escalation??null}})}var o,F=_((()=>{R(),d(),E(),o=m}));export{A as a,F as i,H as n,u as o,T as r,M as t};
