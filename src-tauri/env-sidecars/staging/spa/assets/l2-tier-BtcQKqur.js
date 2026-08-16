import{n as _}from"./chunk-ChpBd9eV.js";import{s as T}from"./types-DoRTXl1W.js";import{t as b}from"./src-DduH0PES.js";import{n as m,t as L}from"./src-6Py4l2MU.js";import{st as l,t as S}from"./src-8fWtxfEz.js";import{f as A,l as R,o as $}from"./server-BXcXKvn3.js";import{r as W,t as x}from"./flag-distinct-id-CCLxG4xU.js";import{r as B,t as F}from"./instance-Cc7YnJLJ.js";function D(e){const t=e.indexOf(":");return t>=0?e.slice(0,t):e}function C(e){return p.has(D(e))}function U(){return d.debouncer||(d.debouncer=new v),d.debouncer}function ee(e,t,s){if(s.length===0)return;const n=[],i=new Set;for(const r of s)C(r)?i.add(D(r)):n.push(r);if(n.length>0&&e.invalidateByTags(t,n),i.size>0){const r=U();for(const a of i)r.bump(e,t,a)}}var p,I,f,w,v,d,te=_((()=>{L(),p=new Set(["coord_event_log","audit_log","agent_runs_consolidated","user_actions","harness_hook_logs","toast_log","feature_audit_consolidated"]),I=4e3,f={setTimer:(e,t)=>setTimeout(e,t),clearTimer:e=>clearTimeout(e)},w="\0",v=class{windowMs;sched;windows=new Map;constructor(e={}){this.windowMs=e.windowMs??4e3,this.sched=e.scheduler??f}bump(e,t,s){const n=t+w+s,i=this.windows.get(n);if(!i){e.invalidateByTags(t,[s]);const r={trailing:!1,timer:null};r.timer=this.sched.setTimer(()=>this.onWindowEnd(e,t,s,n),this.windowMs),this.windows.set(n,r);return}i.trailing=!0}onWindowEnd(e,t,s,n){const i=this.windows.get(n);i&&(i.trailing?(e.invalidateByTags(t,[s]),i.trailing=!1,i.timer=this.sched.setTimer(()=>this.onWindowEnd(e,t,s,n),this.windowMs)):this.windows.delete(n))}resetForTests(){for(const e of this.windows.values())this.sched.clearTimer(e.timer);this.windows.clear()}},d=m("@papercusp/operator-core.tagBumpDebouncer",()=>({debouncer:null}))}));function q(e){if(e==null)return null;if(e instanceof Date)return e.getTime();const t=new Date(e).getTime();return Number.isNaN(t)?null:t}function u(e){if(!e)throw new Error("PgL2Store: workspaceId is required (workspace-scoped keys — D-010)")}var M,H=_((()=>{S(),M=class{nowMs;constructor(e={}){this.nowMs=e.clock??(()=>Date.now())}async get(e,t){u(e);const{sql:s}=l(),n=(await s`
      SELECT value, tags, generation, expires_at
      FROM harness_shared.cache_l2
      WHERE workspace_id = ${e}
        AND cache_key = ${t}
        AND (expires_at IS NULL OR expires_at > ${new Date(this.nowMs())})
      LIMIT 1`)[0];if(n)return{value:n.value,tags:n.tags??[],generation:Number(n.generation),expiresAt:q(n.expires_at)}}async set(e,t,s,n={}){if(u(e),!t)throw new Error("PgL2Store: cache key is required");const{sql:i}=l(),r=n.tags?[...n.tags]:[],a=n.generation??0,o=n.hardTtlMs===void 0||n.hardTtlMs===1/0?null:new Date(this.nowMs()+n.hardTtlMs);await i`
      INSERT INTO harness_shared.cache_l2
        (workspace_id, cache_key, value, tags, generation, expires_at, created_at)
      VALUES (
        ${e}, ${t}, ${JSON.stringify(s??null)}::text::jsonb,
        ${r}, ${a}, ${o}, now()
      )
      ON CONFLICT (workspace_id, cache_key) DO UPDATE SET
        value      = EXCLUDED.value,
        tags       = EXCLUDED.tags,
        generation = EXCLUDED.generation,
        expires_at = EXCLUDED.expires_at,
        created_at = now()`}async forget(e,t){u(e);const{sql:s}=l();await s`
      DELETE FROM harness_shared.cache_l2
      WHERE workspace_id = ${e} AND cache_key = ${t}`}async invalidateByTags(e,t){if(u(e),t.length===0)return 0;const{sql:s}=l();return(await s`
      DELETE FROM harness_shared.cache_l2
      WHERE workspace_id = ${e} AND tags && ${[...t]}
      RETURNING 1 AS id`).length}invalidateByTag(e,t){return this.invalidateByTags(e,[t])}async sweepExpired(){const{sql:e}=l();return(await e`
      DELETE FROM harness_shared.cache_l2
      WHERE expires_at IS NOT NULL AND expires_at <= ${new Date(this.nowMs())}
      RETURNING 1 AS id`).length}async clearWorkspace(e){u(e);const{sql:t}=l();return(await t`
      DELETE FROM harness_shared.cache_l2
      WHERE workspace_id = ${e}
      RETURNING 1 AS id`).length}}}));async function E(){try{c.l2On=await $(T.CACHE_L2,W())}catch{}}function P(){c.flagWiringInit||(c.flagWiringInit=!0,E(),A(e=>{(e===null||e===T.CACHE_L2)&&E()}))}function N(){return P(),c.l2On&&F()}function y(){return c.store||(c.store=new M),c.store}function g(e,t){const s=Date.now(),n=h.get(e);if(n!==void 0&&s-n<O)return;h.set(e,s);const i=t instanceof Error?t.message:String(t);console.error(`[cache-l2] ${e} FAILED — the durable tier is degrading to a real build. Persistent failures here mean L2 is inert (cold builds are NOT being shared): ${i}`)}function k(e){const t=e.softTtlMs??e.hardTtlMs;if(!(t===void 0||!Number.isFinite(t)||t<=0))return t}function ne(e,t,s,n){if(!N())return s;const i=k(n);return i===void 0?s:async()=>{const r=y();try{const o=await r.get(e,t);if(o)return n.onL2Outcome?.("hit"),o.value;n.onL2Outcome?.("miss")}catch(o){n.onL2Outcome?.("error"),g("get",o)}const a=await s();return a!=null&&r.set(e,t,a,{tags:n.tags,hardTtlMs:i}).catch(o=>g("set",o)),a}}function se(e,t){!N()||t.length===0||y().invalidateByTags(e,t).catch(s=>g("invalidateByTags",s))}var c,O,h,ie=_((()=>{b(),R(),L(),x(),B(),H(),c=m("@papercusp/operator-core.cacheL2Tier",()=>({store:null,l2On:!0,flagWiringInit:!1})),O=6e4,h=new Map}));export{ne as a,p as c,ee as d,U as f,D as h,N as i,I as l,C as m,ie as n,M as o,te as p,se as r,H as s,y as t,v as u};
