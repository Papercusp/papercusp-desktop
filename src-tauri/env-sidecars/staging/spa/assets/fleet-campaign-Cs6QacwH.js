import{n as x}from"./chunk-ChpBd9eV.js";import{st as B,t as j}from"./src-8fWtxfEz.js";import{a as z,i as U}from"./fleet-membership-store-Dby1xlv4.js";import{f as W,m as P,n as H,r as G}from"./work-item-completion-authority-Cm7DRLjS.js";import{i as q,n as J}from"./issue-occurrence-ledger-DMFPrSPL.js";function m(t,d,e){return{available:!1,writer:t,units:d,cap:M(),data:null,reason:e}}function b(t,d,e){return{available:!0,writer:t,units:d,cap:M(),data:e}}function y(t,d){const e=t.slice(0,12);return{total:d,shown:e.length,truncated:d>e.length,rows:[...e]}}function K(t,d){const e=t?Date.parse(t):NaN;return Number.isFinite(e)?{at:new Date(e).toISOString(),source:"explicit-since"}:{at:new Date(Number.isFinite(d)?d:0).toISOString(),source:"fleet-created-at"}}function Q(t,d){const e={system:0,agent:0,unattributed:0},l={member:0,nonMember:0,unattributed:0},f={};let k=0,g=0;for(const w of t){const u=a(w.count);k+=u;const N=W(w.terminal_owner);e[N]+=u,w.terminal_owner?.trim()?d.has(w.terminal_owner)?l.member+=u:l.nonMember+=u:l.unattributed+=u;const A=w.authority??"legacy-null";f[A]=(f[A]??0)+u,H(w.authority,!0)&&(g+=u)}return{total:k,counted:g,notCounted:k-g,byOwnerClass:e,byFleetMembership:l,byAuthority:f}}async function ne(t,d){const e=d??B().sql,l=K(t.since,t.fleetCreatedAtMs),f=Date.parse(l.at),k="harness_shared.fleet_membership_events",g="harness_shared.tool_invocations",w="harness_shared.work_items.worked_by_history + taken_by",u="harness_shared.work_items.closed_ts + terminal_owner + authority",N="harness_shared.work_items + harness_shared.work_item_occurrences",A="harness_shared.event_key_fires",O="harness_shared.task_ledger",C="harness_shared.coord_event_log.superseded_*";let E=null,_=null;try{E=await U(t.fleetSlug,{workspaceId:t.workspaceId},e),E.size===0&&(_=Y)}catch{_="ever-member-oracle-failed"}const h=[...E??[]];let L;try{const c=await e`
      SELECT count(*)::bigint AS total,
             count(*) FILTER (WHERE event = 'join')::bigint AS joins,
             count(*) FILTER (WHERE event = 'leave')::bigint AS leaves,
             count(*) FILTER (WHERE event = 'lead')::bigint AS leads,
             count(*) FILTER (WHERE event = 'demote')::bigint AS demotes,
             count(*) FILTER (WHERE event = 'backfill')::bigint AS backfills
        FROM harness_shared.fleet_membership_events
       WHERE (workspace_id = ${t.workspaceId} OR workspace_id = 'default')
         AND fleet_slug = ${t.fleetSlug}
         AND at >= ${l.at}::timestamptz
    `,i=await e`
      SELECT id, owner_id, owner_label, fleet_role, event, at
        FROM harness_shared.fleet_membership_events
       WHERE (workspace_id = ${t.workspaceId} OR workspace_id = 'default')
         AND fleet_slug = ${t.fleetSlug}
         AND at >= ${l.at}::timestamptz
       ORDER BY at DESC, id DESC
       LIMIT ${12}
    `,s=c[0]??{},r=a(s.total);L=b(k,{total:"append-only membership transition rows in boundary",recent:"most-recent transition evidence rows"},{total:r,byEvent:{join:a(s.joins),leave:a(s.leaves),lead:a(s.leads),demote:a(s.demotes),backfill:a(s.backfills)},recent:y(i.map(n=>({id:a(n.id),ownerId:n.owner_id,ownerLabel:n.owner_label,fleetRole:n.fleet_role,event:n.event,at:String(n.at)})),r)})}catch{L=m(k,{total:"membership transition rows"},"membership-read-failed")}let R;if(_)R=m(g,{calls:"tool invocation rows",owners:"distinct ever-members"},_);else try{const c=await e`
        SELECT count(*)::bigint AS calls, count(DISTINCT coord_owner_id)::bigint AS owners,
               max(invoked_at) AS latest_at
          FROM harness_shared.tool_invocations
         WHERE workspace_id = ${t.workspaceId}
           AND coord_owner_id = ANY(${e.array(h)}::text[])
           AND invoked_at >= ${l.at}::timestamptz
           ${t.harnessSlug?e`AND harness_slug = ${t.harnessSlug}`:e``}
      `,i=await e`
        SELECT coord_owner_id, count(*)::bigint AS calls, max(invoked_at) AS latest_at,
               count(*) FILTER (WHERE status = 'ok')::bigint AS ok_calls
          FROM harness_shared.tool_invocations
         WHERE workspace_id = ${t.workspaceId}
           AND coord_owner_id = ANY(${e.array(h)}::text[])
           AND invoked_at >= ${l.at}::timestamptz
           ${t.harnessSlug?e`AND harness_slug = ${t.harnessSlug}`:e``}
         GROUP BY coord_owner_id
         ORDER BY max(invoked_at) DESC
         LIMIT ${12}
      `,s=c[0]??{},r=a(s.owners);R=b(g,{calls:"tool invocation rows in boundary",owners:"distinct fleet ever-member owner ids",latestAt:"latest tool invocation timestamp"},{calls:a(s.calls),distinctOwners:r,latestAt:s.latest_at?String(s.latest_at):null,recentOwners:y(i.map(n=>({ownerId:n.coord_owner_id,calls:a(n.calls),okCalls:a(n.ok_calls),latestAt:n.latest_at?String(n.latest_at):null})),r)})}catch{R=m(g,{calls:"tool invocation rows"},"speaking-read-failed")}let v;if(_)v=m(w,{stock:"current held work-item rows",flow:"holder transition entries"},_);else try{const c=await e`
        SELECT count(*)::bigint AS held, count(DISTINCT taken_by)::bigint AS holders
          FROM harness_shared.work_items
         WHERE workspace_id = ${t.workspaceId}
           AND taken_by = ANY(${e.array(h)}::text[])
           AND NOT harness_shared.work_item_status_is_terminal(status)
           ${t.harnessSlug?e`AND harness_slug = ${t.harnessSlug}`:e``}
      `,i=await e`
        SELECT count(*)::bigint AS transitions, count(DISTINCT h.value->>'owner')::bigint AS workers
          FROM harness_shared.work_items wi
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(wi.worked_by_history) = 'array' THEN wi.worked_by_history ELSE '[]'::jsonb END
          ) h(value)
         WHERE wi.workspace_id = ${t.workspaceId}
           AND h.value->>'owner' = ANY(${e.array(h)}::text[])
           AND (h.value->>'at')::timestamptz >= ${l.at}::timestamptz
           ${t.harnessSlug?e`AND wi.harness_slug = ${t.harnessSlug}`:e``}
      `,s=await e`
        SELECT wi.feature_id, h.value->>'owner' AS owner_id, h.value->>'at' AS at
          FROM harness_shared.work_items wi
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(wi.worked_by_history) = 'array' THEN wi.worked_by_history ELSE '[]'::jsonb END
          ) h(value)
         WHERE wi.workspace_id = ${t.workspaceId}
           AND h.value->>'owner' = ANY(${e.array(h)}::text[])
           AND (h.value->>'at')::timestamptz >= ${l.at}::timestamptz
           ${t.harnessSlug?e`AND wi.harness_slug = ${t.harnessSlug}`:e``}
         ORDER BY (h.value->>'at')::timestamptz DESC
         LIMIT ${12}
      `,r=c[0]??{},n=i[0]??{},S=a(n.transitions);v=b(w,{stock:"current non-terminal work-item rows held by fleet ever-members",flow:"append-only worked_by_history holder-transition entries in boundary"},{stock:{held:a(r.held),distinctHolders:a(r.holders)},flow:{transitions:S,distinctWorkers:a(n.workers),recent:y(s.map(o=>({workItemId:o.feature_id,ownerId:o.owner_id,at:o.at})),S)}})}catch{v=m(w,{stock:"held rows",flow:"holder-transition entries"},"claim-read-failed")}let D;if(_||!E)D=m(u,{closes:"terminal rows with closed_ts in boundary"},_??"ever-member-oracle-failed");else try{const c=Q(await e`
        SELECT terminal_owner, authority, count(*)::bigint AS count
          FROM harness_shared.work_items
         WHERE workspace_id = ${t.workspaceId}
           AND closed_ts >= ${f}
           ${t.harnessSlug?e`AND harness_slug = ${t.harnessSlug}`:e``}
         GROUP BY terminal_owner, authority
      `,E),i=await e`
        SELECT feature_id, status, terminal_owner, authority, closed_ts
          FROM harness_shared.work_items
         WHERE workspace_id = ${t.workspaceId}
           AND closed_ts >= ${f}
           ${t.harnessSlug?e`AND harness_slug = ${t.harnessSlug}`:e``}
         ORDER BY closed_ts DESC
         LIMIT ${12}
      `;D=b(u,{closes:"work-item rows whose epoch-ms closed_ts entered terminal state in boundary",counted:"rows accepted by countsTowardBurnDown(authority, terminal=true)"},{...c,recent:y(i.map(s=>{const r=typeof s.terminal_owner=="string"?s.terminal_owner:null,n=s.authority??null;return{workItemId:s.feature_id,status:s.status,terminalOwner:r,ownerClass:W(r),fleetMember:r?E.has(r):null,authority:n,countsTowardBurnDown:H(n,!0),closedAt:new Date(a(s.closed_ts)).toISOString()}}),c.total)})}catch{D=m(u,{closes:"terminal rows"},"terminal-read-failed")}let T;try{const c=await e`
      SELECT count(*)::bigint AS stock
        FROM harness_shared.work_items
       WHERE workspace_id = ${t.workspaceId}
         AND COALESCE(item_kind, kind) IN ('bug', 'change', 'task')
         AND NOT harness_shared.work_item_status_is_terminal(status)
         ${t.harnessSlug?e`AND harness_slug = ${t.harnessSlug}`:e``}
    `,i=await q({workspaceId:t.workspaceId,harnessSlug:t.harnessSlug??null,since:l.at},e);T=b(N,{stock:"current non-terminal canonical issue-family work-item rows",canonicalClusters:i.units.canonicalClusters,rawOccurrences:i.units.rawOccurrences,duplicateOccurrences:i.units.duplicateOccurrences},{stock:a(c[0]?.stock),flow:i})}catch{T=m(N,{stock:"canonical issue rows",flow:"occurrence rows"},"issue-read-failed")}let F;try{const c=["member-dead","context-critical","claim-released","item-completed","drained"].map(s=>`fleet:${s}:${t.fleetSlug}`),i=await e`
      SELECT event_key, first_fired_at, last_fired_at, fire_count
        FROM harness_shared.event_key_fires
       WHERE workspace_id = ${t.workspaceId}
         AND event_key = ANY(${e.array(c)}::text[])
         AND last_fired_at >= ${l.at}::timestamptz
       ORDER BY last_fired_at DESC
    `;F=b(A,{activeKeys:"distinct fleet transition keys whose latest fire is in boundary",lifetimeFires:"lifetime per-key latch fire_count, not fires within boundary"},{activeKeys:i.length,lifetimeFires:i.reduce((s,r)=>s+a(r.fire_count),0),recent:y(i.map(s=>({key:s.event_key,lifetimeFires:a(s.fire_count),firstFiredAt:String(s.first_fired_at),lastFiredAt:String(s.last_fired_at)})),i.length)})}catch{F=m(A,{fires:"lifetime per-key latch counts"},"gate-event-read-failed")}let $;if(_)$=m(O,{jobs:"task ledger rows launched by fleet ever-members"},_);else try{const c=await e`
        SELECT state, class, COALESCE(NULLIF(detail->>'carry', ''), 'unknown') AS carry,
               count(*)::bigint AS count
          FROM harness_shared.task_ledger
         WHERE workspace_id = ${t.workspaceId}
           AND launched_by = ANY(${e.array(h)}::text[])
           AND started_at >= ${l.at}::timestamptz
           ${t.harnessSlug?e`AND harness_slug = ${t.harnessSlug}`:e``}
         GROUP BY state, class, COALESCE(NULLIF(detail->>'carry', ''), 'unknown')
      `,i=await e`
        SELECT task_id, launched_by, state, class, started_at, ended_at,
               COALESCE(NULLIF(detail->>'carry', ''), 'unknown') AS carry
          FROM harness_shared.task_ledger
         WHERE workspace_id = ${t.workspaceId}
           AND launched_by = ANY(${e.array(h)}::text[])
           AND started_at >= ${l.at}::timestamptz
           ${t.harnessSlug?e`AND harness_slug = ${t.harnessSlug}`:e``}
         ORDER BY started_at DESC
         LIMIT ${12}
      `,s=c.reduce((o,p)=>o+a(p.count),0),r={},n={},S={};for(const o of c){const p=a(o.count);r[String(o.state)]=(r[String(o.state)]??0)+p,n[String(o.class)]=(n[String(o.class)]??0)+p,S[String(o.carry)]=(S[String(o.carry)]??0)+p}$=b(O,{jobs:"managed task-ledger rows started in boundary by fleet ever-members",carry:"detail.carry when the task writer records it; 'unknown' otherwise"},{total:s,byState:r,byClass:n,byCarry:S,recent:y(i.map(o=>({taskId:o.task_id,launchedBy:o.launched_by,state:o.state,class:o.class,carry:o.carry,startedAt:String(o.started_at),endedAt:o.ended_at?String(o.ended_at):null})),s)})}catch{$=m(O,{jobs:"managed task rows"},"job-read-failed")}let I;if(_)I=m(C,{corrections:"superseded original messages from fleet ever-members"},_);else try{const c=await e`
        SELECT count(*)::bigint AS total
          FROM harness_shared.coord_event_log
         WHERE workspace_id = ${t.workspaceId}
           AND body->>'from' = ANY(${e.array(h)}::text[])
           AND superseded_by_msg_id IS NOT NULL
           AND superseded_at >= ${l.at}::timestamptz
      `,i=await e`
        SELECT msg_id, body->>'from' AS from_owner, superseded_by_msg_id, superseded_at
          FROM harness_shared.coord_event_log
         WHERE workspace_id = ${t.workspaceId}
           AND body->>'from' = ANY(${e.array(h)}::text[])
           AND superseded_by_msg_id IS NOT NULL
           AND superseded_at >= ${l.at}::timestamptz
         ORDER BY superseded_at DESC
         LIMIT ${12}
      `,s=a(c[0]?.total);I=b(C,{corrections:"original coord messages superseded in boundary"},{total:s,recent:y(i.map(r=>({messageId:r.msg_id,from:r.from_owner,supersededBy:r.superseded_by_msg_id,supersededAt:String(r.superseded_at)})),s)})}catch{I=m(C,{corrections:"superseded coord messages"},"correction-read-failed")}return{boundary:l,everMembers:{available:E!==null,count:E?.size??null,writer:k,..._?{reason:_}:{}},axes:{membership:L,speaking:R,claims:v,terminals:D,issues:T,gateEvents:F,jobs:$,corrections:I}}}var V,M,a,Y,X=x((()=>{j(),z(),J(),P(),G(),V=12,M=()=>({aggregates:"none",recentRows:12}),a=t=>{const d=Number(t??0);return Number.isFinite(d)?d:0},Y="no-ever-members"}));X();export{ne as readFleetCampaign};
