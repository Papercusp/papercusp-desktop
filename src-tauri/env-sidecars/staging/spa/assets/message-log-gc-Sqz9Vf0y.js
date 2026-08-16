import{n as g,o as c}from"./chunk-ChpBd9eV.js";import{n as A,t as w}from"./src-6Py4l2MU.js";import{st as O,t as N}from"./src-8fWtxfEz.js";import{t as l}from"./__vite-browser-external-56mrcCg8.js";import{i as R,n as T,o as b}from"./operator-state-pg-Cytj1dEs.js";function M(){return S().config}function U(){return S().testingFeatures}function x(){return S()}function K(e){p=e}function W(){if(d.installed)return;d.installed=!0;const e=u.join(f.homedir(),".papercusp","posthog.json"),t=u.dirname(e);try{h.mkdirSync(t,{recursive:!0}),h.watch(t,(a,i)=>{if(i==="posthog.json")for(const r of d.invalidators)try{r()}catch{}})}catch{}}function S(){if(o)return o;const e={}.PAPERCUSP_POSTHOG_HOST,t={}.PAPERCUSP_POSTHOG_KEY,a={}.PAPERCUSP_POSTHOG_PERSONAL_KEY??t,i={}.PAPERCUSP_POSTHOG_TESTING_FEATURES==="true";if(e&&t)return o={config:{host:e,projectKey:t,personalApiKey:a??t},source:"env",testingFeatures:i},o;const r=u.join(f.homedir(),".papercusp","posthog.json");try{const n=h.readFileSync(r,"utf8"),s=JSON.parse(n),_=s.testingFeatures===!0;if(s.host&&s.projectKey&&s.personalApiKey)return o={config:{host:s.host,projectKey:s.projectKey,personalApiKey:s.personalApiKey},source:_?"discovery-file":"discovery-file-opt-out",testingFeatures:_},o}catch{}return o={config:null,source:"unconfigured",testingFeatures:!1},o}var h,f,u,o,d,p,$=g((()=>{h=c(l(),1),f=c(l(),1),u=c(l(),1),w(),o=null,d=A("@papercusp/operator-core.posthogConfigWatcher",()=>({installed:!1,invalidators:[]})),p=null,d.invalidators.push(()=>{o=null,p&&p()})}));async function Y(){const e=await R(E)??{};if(e.install_id)return e.install_id;const t=(0,v.randomUUID)();return e.install_id=t,e.updated_at=new Date().toISOString(),"step_status"in e||(e.step_status={}),await b(E,e),t}var v,E,j=g((()=>{v=c(l(),1),T(),E="setup_wizard_state"}));function B(e){const{to:t,senderFleet:a,allHive:i}=e,r=t.includes("*");if(i)return r?{to:t,allHive:!0}:{to:t};if(!a||!r)return{to:t};const n=`@fleet:${a}`,s=[];for(const _ of t){const m=_==="*"?n:_;s.includes(m)||s.push(m)}return{to:s,scoped:{from:"*",to:n,reason:`you are a member of fleet '${a}', so a bare '*' broadcast was scoped to your fleet (${n}, which includes your leader) rather than every agent in the hive. Pass allHive:true only if this genuinely must reach everyone (a system-wide issue / urgent notice).`}}}var I,z=g((()=>{I="allHiveBroadcast"}));async function J(e=30,t=7,a=y){const{sql:i}=O(),r=await i`
    WITH RECURSIVE base AS (
      SELECT workspace_id,
             msg_id,
             body->>'related_msg_id' AS related_msg_id,
             harness_slug,
             ts,
             -- CONDITION-CARRYING: a single-primary alarm / resolution. NOT chatter —
             -- it is health state, read back by openSinglePrimaryConditions and the
             -- coord conditions fast path, both of which bound their scan at exactly
             -- MESSAGE_GC_RETENTION_DAYS on the stated grounds that "nothing older
             -- survives GC anyway". Expiring these on the shorter FEDERATED horizon
             -- would silently shrink that window to 7d for the harness-scoped ones,
             -- and an alarm aged out with no resolution reads as RESOLVED rather than
             -- as missing. Measured 2026-08-03: 52 such rows are harness-scoped, so
             -- exempting them costs nothing and removes the whole failure class.
             (body ? 'condition_key' OR body ? 'resolves_condition') AS is_condition
        FROM harness_shared.coord_event_log
       WHERE surface = 'messages'
    ),
    thread AS (
      -- Only rooted threads are eligible. A reply whose root is already missing is
      -- kept; deleting an orphaned fragment cannot improve thread integrity.
      SELECT workspace_id, msg_id AS root_id, msg_id, harness_slug, ts, is_condition
        FROM base
       WHERE related_msg_id IS NULL
      UNION
      SELECT t.workspace_id, t.root_id, b.msg_id, b.harness_slug, b.ts, b.is_condition
        FROM thread t
        JOIN base b
          ON b.workspace_id = t.workspace_id
         AND b.related_msg_id = t.msg_id
    ),
    eligible_threads AS (
      SELECT workspace_id, root_id
        FROM (
          SELECT t.workspace_id,
                 t.root_id,
                 max(t.ts) AS newest_ts,
                 bool_and(t.harness_slug IS NULL) AS operator_scope_only,
                 bool_and(t.harness_slug IS NOT NULL) AS federated_only,
                 bool_or(t.is_condition) AS carries_condition,
                 bool_or(p.post_msg_id IS NOT NULL) AS referenced_by_thread_posts
            FROM thread t
            LEFT JOIN harness_shared.coord_thread_posts p
              ON p.workspace_id = t.workspace_id
             AND p.post_msg_id = t.msg_id
           GROUP BY t.workspace_id, t.root_id
        ) g
       WHERE NOT g.referenced_by_thread_posts
         -- Per-scope horizon. A MIXED-scope thread satisfies neither branch and is
         -- kept (see SINGLE-SCOPE THREADS ONLY above). A condition-carrying thread
         -- stays on the LONGER operator horizon whatever its scope, so the health
         -- readers' 30d window is unchanged by federated retention.
         AND (
           (g.operator_scope_only
             AND g.newest_ts < now() - make_interval(days => ${e}))
           OR
           (g.federated_only
             -- ::int on BOTH branches: a bare parameter inside CASE loses the type
             -- inference make_interval(days => ...) gets from a lone parameter, and
             -- resolves to text ("function make_interval(days => text) does not exist").
             AND g.newest_ts < now() - make_interval(days => CASE
                   WHEN g.carries_condition THEN ${e}::int
                   ELSE ${t}::int
                 END))
         )
       ORDER BY g.newest_ts ASC
       LIMIT ${a}
    ),
    victims AS (
      SELECT t.workspace_id, t.msg_id
        FROM thread t
        JOIN eligible_threads e
          ON e.workspace_id = t.workspace_id
         AND e.root_id = t.root_id
    ),
    d AS (
      DELETE FROM harness_shared.coord_event_log e
       USING victims v
       WHERE e.workspace_id = v.workspace_id
         AND e.surface = 'messages'
         AND e.msg_id = v.msg_id
      RETURNING e.harness_slug
    )
    SELECT count(*) FILTER (WHERE harness_slug IS NULL)::int     AS operator_n,
           count(*) FILTER (WHERE harness_slug IS NOT NULL)::int AS federated_n
      FROM d
  `,n=r[0]?.operator_n??0,s=r[0]?.federated_n??0;return{operator:n,federated:s,total:n+s}}var L,y,C,V=g((()=>{N(),L=30,y=5e3,C=7}));export{B as a,M as c,U as d,K as f,z as i,x as l,V as n,Y as o,W as p,I as r,j as s,J as t,$ as u};
