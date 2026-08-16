import{n as f}from"./chunk-ChpBd9eV.js";import{st as c,t as m}from"./src-8fWtxfEz.js";import{t as v,u as _}from"./work-item-dispatch-states-jkwfzC7Z.js";import{n as h,t as b}from"./pg-jsonb-D6Z3WsbA.js";function w(e,n,s){return e?s===null?{baseline:e.observation,next:{fireCount:null,baseline:e.observation,observation:n},rotated:!0,boundary:"read"}:e.fireCount===s?{baseline:e.baseline,next:e,rotated:!1,boundary:e.baseline?"wake":"first"}:{baseline:e.observation,next:{fireCount:s,baseline:e.observation,observation:n},rotated:!0,boundary:"wake"}:{baseline:null,next:{fireCount:s,baseline:null,observation:n},rotated:!0,boundary:"first"}}function u(e,n,s){const o=n??null,t=e??null;return s?t===null?{current:o,previous:null,delta:null,available:!1,reason:"not-observed-previously"}:o===null?{current:null,previous:t,delta:null,available:!1,reason:"not-observed-now"}:{current:o,previous:t,delta:o-t,available:!0}:{current:o,previous:null,delta:null,available:!1,reason:"no-baseline"}}function E(e){const{baseline:n,observation:s,boundary:o,churn:t,closes:l}=e,r=n!==null,i=e.since??n?.at??null,a=u(n?.rosterSize,s.rosterSize,r),p=u(n?.countedMembers,s.countedMembers,r),d=r?l.delta===null?{current:null,previous:null,delta:null,available:!1,reason:"not-observed-now"}:{current:l.delta,previous:null,delta:l.delta,available:!0}:{current:null,previous:null,delta:null,available:!1,reason:"no-baseline"};return{since:i,boundary:o,members:{...a,joined:t?.joined??null,left:t?.left??null,counted:p},closes:{...d,isFloor:l.isFloor},specRevision:u(n?.specRevision,s.specRevision,r),poolFactor:u(n?.poolFactor,s.poolFactor,r)}}function S(e){const n=[],s=o=>o>0?`+${o}`:`${o}`;if(e.members.available&&e.members.delta!==null){let o=`members ${s(e.members.delta)}`;e.members.joined!==null&&e.members.left!==null&&e.members.joined+e.members.left>Math.abs(e.members.delta)&&(o+=` (${e.members.joined} joined / ${e.members.left} left)`),n.push(o)}else n.push("members ? (no baseline)");return n.push(e.closes.available&&e.closes.delta!==null?`closes ${s(e.closes.delta)}${e.closes.isFloor?" (floor)":""}`:"closes ? (no baseline)"),n.push(e.specRevision.available&&e.specRevision.delta!==0?`spec rev ${e.specRevision.previous}→${e.specRevision.current}`:e.specRevision.available?`spec rev ${e.specRevision.current} (unchanged)`:"spec rev ? (no baseline)"),n.push(e.poolFactor.available?`pool factor ${e.poolFactor.previous}→${e.poolFactor.current}`:"pool factor ? (no baseline)"),`${e.since?`since ${e.since}`:"no prior boundary"} (${e.boundary}): ${n.join(", ")}`}var $=f((()=>{}));async function F(e,n){const s=(await(n??c().sql)`
    SELECT fire_count, baseline, observation
      FROM harness_shared.fleet_brief_snapshots
     WHERE workspace_id = ${e.workspaceId}
       AND fleet_slug   = ${e.fleetSlug}
       AND owner_id     = ${e.ownerId}
     LIMIT 1
  `)[0];if(!s)return null;const o=b(s.observation);return o?{fireCount:s.fire_count===null?null:Number(s.fire_count),baseline:b(s.baseline),observation:o}:null}async function N(e,n,s){await(s??c().sql)`
    INSERT INTO harness_shared.fleet_brief_snapshots
                (workspace_id, fleet_slug, owner_id, fire_count, baseline, observation, rotated_at)
         VALUES (${e.workspaceId}, ${e.fleetSlug}, ${e.ownerId}, ${n.fireCount},
                 -- jsonb is bound as an explicit JSON.stringify + cast: sql.json() THROWS on the
                 -- getOrgPg client (EI-607) and a bare object does not bind. A null baseline is
                 -- bound as SQL NULL rather than the jsonb literal 'null', so "no baseline yet"
                 -- and "a baseline that decoded to null" stay the same thing to the reader.
                 ${n.baseline?JSON.stringify(n.baseline):null}::jsonb,
                 ${JSON.stringify(n.observation)}::jsonb, now())
    ON CONFLICT (workspace_id, fleet_slug, owner_id) DO UPDATE
       SET fire_count  = EXCLUDED.fire_count,
           baseline    = EXCLUDED.baseline,
           observation = EXCLUDED.observation,
           rotated_at  = now()
  `}async function R(e,n){const s=(await(n??c().sql)`
    SELECT count(*) FILTER (WHERE event = 'join')  AS joined,
           count(*) FILTER (WHERE event = 'leave') AS left
      FROM harness_shared.fleet_membership_events
     WHERE workspace_id = ${e.workspaceId}
       AND fleet_slug   = ${e.fleetSlug}
       AND at           > ${e.since}::timestamptz
  `)[0];return{joined:Number(s?.joined??0),left:Number(s?.left??0)}}async function y(e,n){const s=n??c().sql,o=Date.parse(e.since);if(!Number.isFinite(o))return{delta:null,isFloor:!1};const t=[...v],l=(await s`
    SELECT count(*) FILTER (WHERE closed_ts IS NOT NULL AND closed_ts > ${o}) AS closes,
           count(*) FILTER (WHERE closed_ts IS NULL)                                AS undated
      FROM harness_shared.work_items
     WHERE workspace_id = ${e.workspaceId}
       AND status = ANY(${t})
       ${e.harnessSlug?s`AND harness_slug = ${e.harnessSlug}`:s``}
  `)[0];return l?{delta:Number(l.closes??0),isFloor:Number(l.undated??0)>0}:{delta:null,isFloor:!1}}async function T(e,n){const s=w(await F(e.key,n),e.observation,e.fireCount);s.rotated&&await N(e.key,s.next,n);const o=e.since??null,t=o?"explicit":s.boundary,l=o??s.baseline?.at??null;let r=null,i={delta:null,isFloor:!1};if(l){try{r=await R({workspaceId:e.key.workspaceId,fleetSlug:e.key.fleetSlug,since:l},n)}catch{r=null}try{i=await y({workspaceId:e.key.workspaceId,harnessSlug:e.harnessSlug,since:l},n)}catch{i={delta:null,isFloor:!1}}}const a=E({baseline:s.baseline,observation:e.observation,boundary:t,churn:r,closes:i,since:o});return{delta:a,summary:S(a)}}var I=f((()=>{m(),_(),h(),$()}));I();export{T as resolveFleetBriefDelta};
