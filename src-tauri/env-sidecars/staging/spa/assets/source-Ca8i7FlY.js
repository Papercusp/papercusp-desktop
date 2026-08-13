import{n as b,o as L}from"./chunk-ChpBd9eV.js";import{Rn as q,Ut as K,Zn as i,lr as N,t as G,u as S,zn as p,zt as m}from"./zod-CZhQjvAS.js";import{Q as c,t as V}from"./src-BmBNODK0.js";import{t as O}from"./__vite-browser-external-56mrcCg8.js";import{M as $,t as Z}from"./src-DgKPQFfC.js";import{a as J,r as Q}from"./browser-EuA9NEWL.js";import{t as X}from"./workspace-id-constant-AQ2MH5pQ.js";import{c as ee}from"./workspace-registry-Du2UbhlH.js";import{l as te,o as se}from"./harness-registry-Cyujgx97.js";import{i as ae,n as ne}from"./hive-federation-CBwEfakT.js";import{a as re,i as M,o as f}from"./operator-home-harness-MSlRvOkW.js";import{c as ie,l as le,r as oe}from"./harness-core-ZShh-qPN.js";import{r as ce,t as ue}from"./papercusp-workspace-BGtc8cAT.js";import{r as de,t as y}from"./register-papercusp-GUjEwsay.js";import{a as pe,r as _e}from"./fleet-drained-events-DLtAQ7_t.js";var he=b((()=>{Z()}));function me(e){const t=/^##\s+(?:\d+(?:\.\d+)?[a-z]?\.\s+)?Promote\b.*$/m.exec(e);if(!t)return null;const n=e.slice(t.index+t[0].length),a=/^##\s/m.exec(n);return a?n.slice(0,a.index):n}function ge(e){const t=/```(?:ya?ml|json)?\s*\n([\s\S]*?)```/m.exec(e);return(t?t[1]:e).trim()}function we(e){const t=me(e);if(t===null)return{policy:null,warnings:[]};const n=ge(t);if(!n)return{policy:null,warnings:["`## Promote` section is empty"]};let a;try{a=J(n)}catch(r){return{policy:null,warnings:[`\`## Promote\` YAML parse error: ${r instanceof Error?r.message:String(r)}`]}}const s=j.safeParse(a);return s.success?{policy:s.data,warnings:[]}:{policy:null,warnings:s.error.issues.map(r=>`\`## Promote\` invalid: ${r.path.join(".")||"(root)"}: ${r.message}`)}}function Ge(e,t){for(const n of e){if(!n.blocked_by)continue;const a=(t.get(n.blocked_by)??[]).map(s=>s.title);if(a.length!==0)for(const s of t.get(n.id)??[])s.blocked_by=[...new Set([...s.blocked_by??[],...a])]}}function Ve(e,t={}){const n=[],a=[];for(const s of e.features??[])a.push({...s});if(e.generate){const s=t.generateItems??[];s.length===0&&n.push(`wave ${e.id} is generative (for_each: ${e.generate.for_each}) but no generateItems were provided`);const r=e.generate.feature_template;for(const l of s){const _=[r.body?w(r.body,l):null,r.agent_hint?`Hint: ${w(r.agent_hint,l)}`:null].filter(Boolean);a.push({title:w(r.title,l),...r.acceptance&&{acceptance:r.acceptance.map(o=>w(o,l))},..._.length>0&&{body:_.join(`

`)},...r.brief&&{brief:w(r.brief,l)},...r.assigned_role&&{assigned_role:r.assigned_role},generated:!0})}}if(e.spawn_child)for(const s of a)s.spawn_child_slug=e.spawn_child.slug;return{features:a,warnings:n}}var P,x,C,T,H,F,j,w,fe=b((()=>{G(),Q(),P=p({title:i().min(1).max(200),from_items:m(i().regex(/^P-\d{3,}$/,"P-NNN form")).optional(),acceptance:m(i().min(1)).optional(),body:i().optional(),brief:i().optional(),assigned_role:i().optional(),blocked_by:m(i().min(1)).optional(),order:q().int().optional()}),x=N([p({items:m(i().min(1)).min(1)}).strict(),p({glob:i().min(1)}).strict(),p({sql:i().min(1)}).strict(),p({from_input:i().min(1)}).strict(),p({from_feature:i().min(1)}).strict()]),C=p({for_each:N([i().min(1),x]),feature_template:p({title:i().min(1),acceptance:m(i().min(1)).optional(),body:i().optional(),brief:i().optional(),assigned_role:i().optional(),agent_hint:i().optional()})}),T=/^[a-z0-9][a-z0-9-]*[a-z0-9]$/,H=p({slug:i().regex(T,"kebab-case slug (a-z0-9, hyphen-separated)"),template:i().min(1).optional(),repo:i().url().optional(),goal:i().max(280).optional()}).strict(),F=p({id:i().min(1),blocked_by:i().optional(),features:m(P).optional(),generate:C.optional(),spawn_child:H.optional()}).refine(e=>(e.features?.length??0)>0||!!e.generate,{message:"a wave must declare features[] and/or generate"}),j=p({target_harness:i().min(1).optional(),defaults:p({assigned_role:i().optional(),mark_items:K().optional()}).optional(),waves:m(F).min(1)}).superRefine((e,t)=>{const n=new Set;for(const s of e.waves)n.has(s.id)&&t.addIssue({code:S.custom,message:`duplicate wave id: ${s.id}`}),n.add(s.id);for(const s of e.waves)s.blocked_by&&!n.has(s.blocked_by)&&t.addIssue({code:S.custom,message:`wave ${s.id} blocked_by unknown wave: ${s.blocked_by}`});const a=new Set;for(const s of e.waves){const r=s.spawn_child;r&&(a.has(r.slug)&&t.addIssue({code:S.custom,message:`duplicate spawn_child slug: ${r.slug}`}),a.add(r.slug),e.target_harness&&r.slug===e.target_harness&&t.addIssue({code:S.custom,message:`spawn_child slug ${r.slug} must differ from target_harness`}))}}),w=(e,t)=>e.replace(/\{item\}/g,t)}));function v(e){try{return(0,I.realpathSync)(e)}catch{return u.resolve(e)}}function ve(e){const t=y();return t&&v(e)===v(t)?U:Y}function h(e){return{workspaceId:e.workspace_id,harnessSlug:e.harness_slug,planSlug:e.plan_slug,content:e.content,contentHash:e.content_hash,version:Number(e.version),title:e.title,status:e.status,created:e.created,updated:e.updated,owner:e.owner,initiative:e.initiative,template:e.template??null,templateData:e.template_data??null,inputSchema:e.input_schema??null,supersedes:e.supersedes??[],supersededBy:e.superseded_by,opStatus:e.op_status??null,opStartedAt:e.op_started_at,opUpdatedAt:e.op_updated_at,currentWave:e.current_wave,opPriority:e.op_priority,archived:e.archived,isLegacy:e.is_legacy,updatedAt:e.updated_at,items:Array.isArray(e.items)?e.items:[],decisions:Array.isArray(e.decisions)?e.decisions:[],nowState:e.now_state,nowNext:e.now_next,promotePolicy:e.promote_policy??null,schedule:e.schedule??null,scheduleActive:e.schedule_active??!1,scheduledAt:e.scheduled_at,expiresAt:e.expires_at,tzid:e.tzid,templateSlug:e.template_slug,runSeq:e.run_seq}}function W(e){const t=e&&M(e);return!t||t==="*"||t==="all"||t===f()}async function ye(e){return c("",async t=>(await t`
        SELECT DISTINCT workspace_id
          FROM harness_shared.projects
         WHERE slug = ${e}
           AND COALESCE(workspace_id, '') <> ''
      `).map(n=>n.workspace_id),{bypassRlsForAdmin:!0})}async function Se(e,t={}){const n=e?.trim();if(W(n))return ue;const a=await(t.lookup??ye)(n),s=[...new Set(a.filter(r=>r&&r.trim()))];if(s.length>1)throw new Error(`fill_workspace_id_from_projects: harness slug '${n}' resolves to ${s.length} workspaces (${s.join(", ")}). Ambiguous same-name collision across workspaces — pass an explicit workspaceId to disambiguate.`);return s.length===1?s[0]:await(t.registryFallback??le)(n)}async function g(e={}){const t=e.harnessSlug?.trim(),n=t&&t!=="*"&&t!=="all"?M(t):t;if(W(n))return{workspaceId:e.workspaceId??"papercusp-workspace",harnessSlug:f()};const a=e.workspaceId??await Se(n,{...e.lookup?{lookup:e.lookup}:{},...e.registryFallback?{registryFallback:e.registryFallback}:{}});if(a===null)throw new Error(`resolvePlanScope: harness '${n}' is not registered in the harness registry (harness_shared.harness_registry) or harness_shared.projects in any workspace, so its plan workspace cannot be resolved. Register the harness, or pass an explicit workspaceId. (Refusing to silently default to '${X}' — WI-148.)`);const s=await ae(a,n);if(!s)throw new Error(`resolvePlanScope: plans are Hive-scoped, but '${n}' is not a Hive home and does not belong to one in workspace '${a}'. Add it to a Hive or pass the Hive home slug explicitly; refusing to create/read a non-Hive-scoped plan.`);return{workspaceId:a,harnessSlug:s}}function D(e,t){return`plan://${e}/${t}`}function z(e){const t=[];if(e.repoRoot)t.push(e.repoRoot);else{const a=y();a&&t.push(a);const s=process.cwd();t.push(s),s.endsWith(u.sep+"apps"+u.sep+"operator")?t.push(u.dirname(u.dirname(s))):s.endsWith("/apps/operator")&&t.push(u.resolve(s,"..",".."))}for(const a of t){const s=u.join(a,E);if((0,I.existsSync)(s))return{plans:s,archive:u.join(a,k)}}const n=t[0]??process.cwd();return{plans:u.join(n,E),archive:u.join(n,k)}}function Ae(e={}){return z(e).plans}function Ze(e={}){return z(e).archive}function Je(e={}){if(!e.repoRoot){const t=y();if(t)return t}return u.resolve(Ae(e),"..","..","..","..")}async function Qe(e,t={}){const n=await te(t.workspaceId),a=e?.trim();let s,r;if(!a||a==="*"){const o=y();if(o&&(s=n.projects.find(d=>v(d.path)===v(o))),s=s??n.projects.find(d=>d.slug===f()),!s)throw new Error(`resolveHarnessPlansDir: no harness in ctx and no primary harness findable (no path-match for repo root '${o}', no '${f()}' slug). Available: ${n.projects.map(d=>d.slug).join(", ")||"(none)"}`);r=s.slug}else if(r=a,s=await ie(r,t.workspaceId)??void 0,!s){const o=r==="papercusp"?` Did you mean '${f()}'?`:"";throw new Error(`resolveHarnessPlansDir: harness '${r}' not registered in any workspace.${o} Active-workspace harnesses: ${n.projects.map(d=>d.slug).join(", ")||"(none)"}`)}if(r===f()){const o=y();if(o&&v(s.path)!==v(o))throw new Error(`P-014 runtime guard: papercup harness path '${s.path}' does not match detected repo root '${o}'. The registry is out of sync.`)}const l=u.join(s.path,ve(s.path)),_=s.workspaceId??t.workspaceId??"default";return{harnessSlug:r,workspaceId:_,plans:l,archive:u.join(l,"archive")}}async function Xe(e={}){const{workspaceId:t,harnessSlug:n}=await g(e);return(await c(t,async a=>a`
      SELECT plan_slug, archived
        FROM harness_shared.harness_plans
       WHERE workspace_id = ${t} AND harness_slug = ${n}
       ORDER BY plan_slug ASC
    `)).filter(a=>e.includeArchived||!a.archived).map(a=>({slug:a.plan_slug,filePath:D(n,a.plan_slug),archived:a.archived}))}async function B(e,t={}){if(typeof e!="string"||!R.test(e))return null;const{workspaceId:n,harnessSlug:a}=await g(t);try{const s=await c(n,async r=>r`
        SELECT workspace_id, harness_slug, plan_slug, content, content_hash, version,
               title, status, created, updated, owner, initiative, supersedes, superseded_by,
               op_status, op_started_at, op_updated_at, current_wave, op_priority,
               archived, is_legacy, updated_at, items, now_state, now_next, promote_policy,
               schedule, schedule_active, scheduled_at, expires_at, tzid, template_slug, run_seq,
               template, template_data, input_schema
          FROM harness_shared.harness_plans
         WHERE workspace_id = ${n} AND harness_slug = ${a}
           AND plan_slug = ${e}
      `);return s[0]?h(s[0]):null}catch(s){if(s instanceof Error&&s.message?.includes("column")&&s.message?.includes("does not exist")){const r=await c(n,async l=>l`
          SELECT workspace_id, harness_slug, plan_slug, content, content_hash, version,
                 title, status, created, updated, owner, initiative, supersedes, superseded_by,
                 op_status, op_started_at, op_updated_at, current_wave, op_priority,
                 archived, is_legacy, updated_at, items, now_state, now_next
            FROM harness_shared.harness_plans
           WHERE workspace_id = ${n} AND harness_slug = ${a}
             AND plan_slug = ${e}
        `);return r[0]?h({...r[0],schedule:null,schedule_active:!1,scheduled_at:null,expires_at:null,tzid:null,template_slug:null,run_seq:null,template:null,template_data:null,input_schema:null}):null}throw s}}async function et(e,t){return typeof t!="string"||!R.test(t)?!1:(await c(e,async n=>n`
      SELECT 1 AS one FROM harness_shared.harness_plans
       WHERE workspace_id = ${e} AND plan_slug = ${t}
       LIMIT 1
    `)).length>0}async function tt(e,t){const n=await $e(e,t);if(!n)return null;const a=await B(t,{workspaceId:e,harnessSlug:n});if(!a)return null;const s=ke(a).some(r=>!pe(r.storedStatus));return{status:a.status,hasOpenItems:s}}async function $e(e,t){return typeof t!="string"||!R.test(t)?null:(await c(e,async n=>n`
      SELECT harness_slug FROM harness_shared.harness_plans
       WHERE workspace_id = ${e} AND plan_slug = ${t}
       ORDER BY updated_at DESC
       LIMIT 1
    `))[0]?.harness_slug??null}async function st(e,t){const n=t?.trim();if(!n)return new Set;const a=await c(e,async s=>s`
      SELECT plan_slug FROM harness_shared.harness_plans
       WHERE workspace_id = ${e} AND harness_slug = ${n}
    `);return new Set(a.map(s=>s.plan_slug))}async function Re(e={}){const{workspaceId:t,harnessSlug:n}=await g(e);try{return(await c(t,async a=>a`
        SELECT workspace_id, harness_slug, plan_slug, content, content_hash, version,
               title, status, created, updated, owner, initiative, supersedes, superseded_by,
               op_status, op_started_at, op_updated_at, current_wave, op_priority,
               archived, is_legacy, updated_at, items, now_state, now_next,
               schedule, schedule_active, scheduled_at, expires_at, tzid, template_slug, run_seq,
               template, template_data, input_schema
          FROM harness_shared.harness_plans
         WHERE workspace_id = ${t} AND harness_slug = ${n}
         ${e.includeArchived?a``:a`AND archived = false`}
         ORDER BY plan_slug ASC
      `)).map(h)}catch(a){if(a instanceof Error&&a.message?.includes("column")&&a.message?.includes("does not exist"))return(await c(t,async s=>s`
          SELECT workspace_id, harness_slug, plan_slug, content, content_hash, version,
                 title, status, created, updated, owner, initiative, supersedes, superseded_by,
                 op_status, op_started_at, op_updated_at, current_wave, op_priority,
                 archived, is_legacy, updated_at, items, now_state, now_next
            FROM harness_shared.harness_plans
           WHERE workspace_id = ${t} AND harness_slug = ${n}
           ${e.includeArchived?s``:s`AND archived = false`}
           ORDER BY plan_slug ASC
        `)).map(s=>h({...s,schedule:null,schedule_active:!1,scheduled_at:null,expires_at:null,tzid:null,template_slug:null,run_seq:null,template:null,template_data:null,input_schema:null}));throw a}}function A(e){const t=e.status||null,n=e.template||null,a=e.templateSlug||null,s=e.createdSince||null,r=e.updatedSince||null;return{includeArchived:e.includeArchived===!0,statusActive:t!==null,status:t,includeInstances:e.includeInstances===!0||a!==null,templateActive:n!==null,template:n,templateSlugActive:a!==null,templateSlug:a,createdSinceActive:s!==null,createdSince:s,updatedSinceActive:r!==null,updatedSince:r,limit:typeof e.limit=="number"&&e.limit>0?e.limit:null}}async function at(e={}){const{workspaceId:t,harnessSlug:n}=await g(e);try{return(await c(t,async a=>{const s=A(e),r=e.order==="updated"?a`ORDER BY updated_at DESC NULLS LAST`:e.order==="created"?a`ORDER BY created_at DESC NULLS LAST`:a`ORDER BY plan_slug ASC`;return a`
        SELECT workspace_id, harness_slug, plan_slug, content_hash, version,
               title, status, created, updated, owner, initiative, supersedes, superseded_by,
               op_status, op_started_at, op_updated_at, current_wave, op_priority,
               archived, is_legacy, updated_at, ${e.includeItems===!1?a`'[]'::jsonb AS items`:a`items`}, ${e.heavyFields?a`now_state, template_data, input_schema,`:a`NULL::text AS now_state, NULL::jsonb AS template_data, NULL::jsonb AS input_schema,`} now_next,
               schedule, schedule_active, scheduled_at, expires_at, tzid, template_slug, run_seq,
               template
          FROM harness_shared.harness_plans
         WHERE workspace_id = ${t} AND harness_slug = ${n}
           AND (${s.includeArchived} OR archived = false)
           AND (${!s.statusActive} OR status = ${s.status})
           AND (${s.includeInstances} OR template_slug IS NULL)
           AND (${!s.templateActive} OR template = ${s.template})
           AND (${!s.templateSlugActive} OR template_slug = ${s.templateSlug})
           AND (${!s.createdSinceActive} OR created_at >= ${s.createdSince})
           AND (${!s.updatedSinceActive} OR updated_at >= ${s.updatedSince})
         ${r}
         LIMIT ${s.limit}
      `})).map(a=>{const{content:s,...r}=h({...a,content:""});return r})}catch(a){if(a instanceof Error&&a.message?.includes("column")&&a.message?.includes("does not exist"))return(await c(t,async s=>{const r=A(e);return s`
          SELECT workspace_id, harness_slug, plan_slug, content_hash, version,
                 title, status, created, updated, owner, initiative, supersedes, superseded_by,
                 op_status, op_started_at, op_updated_at, current_wave, op_priority,
                 archived, is_legacy, updated_at, items, now_state, now_next
           FROM harness_shared.harness_plans
           WHERE workspace_id = ${t} AND harness_slug = ${n}
             AND (${r.includeArchived} OR archived = false)
             AND (${!r.statusActive} OR status = ${r.status})
             AND (${r.includeInstances} OR template_slug IS NULL)
           ORDER BY plan_slug ASC
           LIMIT ${r.limit}
        `})).map(s=>{const{content:r,...l}=h({...s,content:"",schedule:null,schedule_active:!1,scheduled_at:null,expires_at:null,tzid:null,template_slug:null,run_seq:null,template:null,template_data:null,input_schema:null});return l});throw a}}async function nt(e){const{workspaceId:t}=e;try{return(await c(t,async n=>{const a=A(e),s=e.order==="updated"?n`ORDER BY updated_at DESC NULLS LAST`:e.order==="created"?n`ORDER BY created_at DESC NULLS LAST`:n`ORDER BY harness_slug ASC, plan_slug ASC`;return n`
        SELECT workspace_id, harness_slug, plan_slug, content_hash, version,
               title, status, created, updated, owner, initiative, supersedes, superseded_by,
               op_status, op_started_at, op_updated_at, current_wave, op_priority,
               archived, is_legacy, updated_at, ${e.includeItems===!1?n`'[]'::jsonb AS items`:n`items`}, ${e.heavyFields?n`now_state, template_data, input_schema,`:n`NULL::text AS now_state, NULL::jsonb AS template_data, NULL::jsonb AS input_schema,`} now_next,
               schedule, schedule_active, scheduled_at, expires_at, tzid, template_slug, run_seq,
               template
          FROM harness_shared.harness_plans
         WHERE workspace_id = ${t}
           AND (${a.includeArchived} OR archived = false)
           AND (${!a.statusActive} OR status = ${a.status})
           AND (${a.includeInstances} OR template_slug IS NULL)
           AND (${!a.templateActive} OR template = ${a.template})
           AND (${!a.templateSlugActive} OR template_slug = ${a.templateSlug})
           AND (${!a.createdSinceActive} OR created_at >= ${a.createdSince})
           AND (${!a.updatedSinceActive} OR updated_at >= ${a.updatedSince})
         ${s}
         LIMIT ${a.limit}
      `})).map(n=>{const{content:a,...s}=h({...n,content:""});return s})}catch(n){if(n instanceof Error&&n.message?.includes("column")&&n.message?.includes("does not exist"))return(await c(t,async a=>{const s=A(e);return a`
          SELECT workspace_id, harness_slug, plan_slug, content_hash, version,
                 title, status, created, updated, owner, initiative, supersedes, superseded_by,
                 op_status, op_started_at, op_updated_at, current_wave, op_priority,
                 archived, is_legacy, updated_at, items, now_state, now_next
            FROM harness_shared.harness_plans
           WHERE workspace_id = ${t}
             AND (${s.includeArchived} OR archived = false)
             AND (${!s.statusActive} OR status = ${s.status})
             AND (${s.includeInstances} OR template_slug IS NULL)
           ORDER BY harness_slug ASC, plan_slug ASC
           LIMIT ${s.limit}
        `})).map(a=>{const{content:s,...r}=h({...a,content:"",schedule:null,schedule_active:!1,scheduled_at:null,expires_at:null,tzid:null,template_slug:null,run_seq:null,template:null,template_data:null,input_schema:null});return r});throw n}}async function rt(e){const{workspaceId:t,harnessSlug:n}=await g(e),a=e.schedule?JSON.stringify(e.schedule):null,s=r=>r`
      UPDATE harness_shared.harness_plans
         SET schedule = ${a}::text::jsonb,
             scheduled_at = ${e.scheduledAt??null}::timestamptz,
             expires_at = ${e.expiresAt??null}::timestamptz,
             tzid = ${e.tzid??null},
             updated_at = now()
       WHERE workspace_id = ${t} AND harness_slug = ${n}
         AND plan_slug = ${e.slug}
      RETURNING plan_slug
    `;return(e.sql?await s(e.sql):await c(t,r=>s(r))).length>0}async function it(e,t={}){if(e.length===0)return new Map;const{workspaceId:n,harnessSlug:a}=await g(t),s=await c(n,async r=>r`
      SELECT plan_slug, content
        FROM harness_shared.harness_plans
       WHERE workspace_id = ${n} AND harness_slug = ${a}
         AND plan_slug = ANY(${e}::text[])
    `);return new Map(s.map(r=>[r.plan_slug,r.content]))}function Ee(e){return e.replace(/[\\%_]/g,t=>`\\${t}`)}async function lt(e,t={}){if(e.length===0)return{rows:[],truncated:!1};const{workspaceId:n,harnessSlug:a}=await g(t),s=t.limit&&t.limit>0?t.limit:200,r=e.map(l=>`%${Ee(l)}%`);try{const l=await c(n,async o=>o`
        SELECT workspace_id, harness_slug, plan_slug, content, content_hash, version,
               title, status, created, updated, owner, initiative, supersedes, superseded_by,
               op_status, op_started_at, op_updated_at, current_wave, op_priority,
               archived, is_legacy, updated_at, items, now_state, now_next,
               schedule, schedule_active, scheduled_at, expires_at, tzid, template_slug, run_seq,
               template, template_data, input_schema
          FROM harness_shared.harness_plans
         WHERE workspace_id = ${n} AND harness_slug = ${a}
         ${t.includeArchived?o``:o`AND archived = false`}
           AND (content ILIKE ANY(${r}::text[]) OR plan_slug ILIKE ANY(${r}::text[]))
         ORDER BY plan_slug ASC
         LIMIT ${s+1}
      `),_=l.length>s;return{rows:(_?l.slice(0,s):l).map(h),truncated:_}}catch(l){if(l instanceof Error&&l.message?.includes("column")&&l.message?.includes("does not exist")){const _=await c(n,async d=>d`
          SELECT workspace_id, harness_slug, plan_slug, content, content_hash, version,
                 title, status, created, updated, owner, initiative, supersedes, superseded_by,
                 op_status, op_started_at, op_updated_at, current_wave, op_priority,
                 archived, is_legacy, updated_at, items, now_state, now_next
            FROM harness_shared.harness_plans
           WHERE workspace_id = ${n} AND harness_slug = ${a}
           ${t.includeArchived?d``:d`AND archived = false`}
             AND (content ILIKE ANY(${r}::text[]) OR plan_slug ILIKE ANY(${r}::text[]))
           ORDER BY plan_slug ASC
           LIMIT ${s+1}
        `),o=_.length>s;return{rows:(o?_.slice(0,s):_).map(d=>h({...d,schedule:null,schedule_active:!1,scheduled_at:null,expires_at:null,tzid:null,template_slug:null,run_seq:null,template:null,template_data:null,input_schema:null})),truncated:o}}throw l}}async function ot(e,t={}){const n=await B(e,t);return n?{parsed:$(n.content,{filePath:D(n.harnessSlug,n.planSlug)}),archived:n.archived,row:n}:null}async function ct(e={}){return(await Re(e)).map(t=>({parsed:$(t.content,{filePath:D(t.harnessSlug,t.planSlug)}),archived:t.archived,row:t}))}function ut(e){const t=$(e),n=t.frontmatter;return{title:n.title??null,status:n.status??null,created:n.created??null,updated:n.updated??null,owner:n.owner??null,initiative:n.initiative??null,template:n.template??null,supersedes:n.supersedes??[],supersededBy:n.supersededBy??null,isLegacy:t.isLegacy,items:t.items.map(a=>({id:a.id,status:a.storedStatus,text:a.text,importance:a.importance,blockedBy:a.blockedBy,decisionRefs:a.decisionRefs,phase:a.phase})),decisions:t.decisions.map(a=>({id:a.id,title:a.title,body:a.body,date:a.date,itemRefs:a.itemRefs})),nowState:t.now?.state??null,nowNext:t.now?.next??null,promotePolicy:we(e)}}function ke(e){return e.items.length>0?e.items.map(t=>({id:t.id,text:t.text,storedStatus:t.status,importance:t.importance,blockedBy:t.blockedBy,decisionRefs:t.decisionRefs,phase:t.phase,lineNumber:0,rawLine:""})):$(e.content).items}var I,u,E,k,U,Y,R,dt=b((()=>{I=L(O(),1),u=L(O(),1),he(),fe(),V(),ee(),se(),oe(),de(),re(),ce(),ne(),_e(),E="apps/operator/docs/plans",k="apps/operator/docs/plans/archive",U="apps/operator/docs/plans",Y="docs/plans",R=/^[A-Za-z0-9._-]+$/}));export{fe as A,Qe as C,D,rt as E,he as M,Ge as O,ot as S,g as T,ke as _,Se as a,tt as b,B as c,dt as d,Xe as f,lt as g,Re as h,ut as i,we as j,Ve as k,Ae as l,nt as m,E as n,Ze as o,at as p,R as r,it as s,k as t,Je as u,et as v,$e as w,ct as x,st as y};
