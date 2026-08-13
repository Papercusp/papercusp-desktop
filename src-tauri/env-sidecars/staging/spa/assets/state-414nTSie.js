import{n as _,o as m}from"./chunk-ChpBd9eV.js";import{t as w}from"./__vite-browser-external-56mrcCg8.js";function E(e){return e==null?0:typeof e=="bigint"?Number(e):e}function S(e){let t;if(Array.isArray(e.claims))t=e.claims;else if(typeof e.claims=="string"&&e.claims.length>0)try{t=JSON.parse(e.claims)}catch{}return{id:e.feature_id,title:e.title??"",status:e.status,attempts:E(e.attempts),...t?{claims:t}:{},...e.notes?{notes:e.notes}:{},...e.summary?{summary:e.summary}:{},...e.kind?{kind:e.kind}:{}}}async function u(e){if(!e.harnessSlug)return console.warn("[state-pg] readFeaturesPg called with no harnessSlug — returning no features"),[];const t=(await e.pg`
    SELECT hf.feature_id, hf.title, hf.summary, hf.status, hf.attempts, hf.claims,
           hf.notes, hf.metadata, hf.kind, hf.project_id, hf.expected_cost_cents,
           hf.tags, hf.needs_human_review, hf.ts, hf.created_ts, hf.updated_ts
      FROM harness_features hf
      -- G2 Auditor-admission gate (P-008): LEFT JOIN against the consolidated
      -- table to read origin + audit_verdict without touching the per-harness
      -- schema. hfc may have no row yet (pre-sync) — treat that as local/pickable.
      LEFT JOIN harness_shared.harness_features_consolidated hfc
        ON hfc.harness_slug = ${e.harnessSlug??""}
       AND hfc.feature_id   = hf.feature_id
     WHERE hf.workspace_id = ${e.workspaceId}
       AND (
         -- G2 pick-gate: local features always pass; remote features only pass
         -- when the auditor has admitted them. NULL origin (pre-G1 row, no hfc
         -- row yet) is treated as local for backward compat.
         hfc.feature_id IS NULL
         OR hfc.origin = 'local'
         OR hfc.audit_verdict = 'admit'
       )
       AND (
         -- Features not linked to any plan are always eligible (legacy/manual).
         -- ledger P-004: the plan slug now lives in the first-class
         -- source_plan_slug COLUMN (written by plan-to-work-item promotion +
         -- convert-at-pickup), with metadata->>'source_plan' kept only for
         -- pre-promotion features. We read it from hfc, the consolidated table
         -- already LEFT JOINed above (qualified, ALWAYS has the column), NULL when
         -- there is no consolidated row yet (pre-sync local feature, metadata
         -- fallback). This avoids referencing a per-harness column that a stale,
         -- SELECT*-frozen harness_features view may not expose.
         COALESCE(hfc.source_plan_slug, hf.metadata->>'source_plan') IS NULL
         OR
         -- Features from plans must belong to a started plan.
         COALESCE(hfc.source_plan_slug, hf.metadata->>'source_plan') IN (
           SELECT plan_slug
             FROM harness_shared.harness_plans
            WHERE workspace_id = ${e.workspaceId}
              AND harness_slug  = ${e.harnessSlug??""}
              AND op_status     = 'started'
         )
       )
     ORDER BY hf.feature_id
  `).map(S),a=await A(e);return a.size>0?t.filter(s=>!a.has(s.id)):t}async function A(e){if({}.PAPERCUSP_DBOS_ORCHESTRATOR==="0")return new Set;const t=e.harnessSlug;if(!t)return new Set;try{if(!(await e.pg`
      SELECT to_regclass('dbos.workflow_status') AS t
    `)[0]?.t)return new Set;const a=`pipeline:${t}:%`,s=await e.pg`
      SELECT DISTINCT split_part(workflow_uuid, ':', 3) AS feature_id
        FROM dbos.workflow_status
       WHERE workflow_uuid LIKE ${a}
         AND status IN ('PENDING', 'ENQUEUED')
    `;return new Set(s.map(r=>r.feature_id).filter(r=>r.length>0))}catch{return new Set}}function k(){return{}.PAPERCUSP_DESIGN_GATE==="1"}async function N(e,t,a){if(!k())return;const s=(await e.pg`
    SELECT needs_design, design_status
      FROM harness_shared.harness_features_consolidated
     WHERE harness_slug = ${a} AND feature_id = ${t}
     LIMIT 1
  `)[0];if(s&&s.needs_design&&!(s.design_status==="accepted"||s.design_status==="ignored"))throw new f(t,s.design_status)}async function $(e){if(!e.harnessSlug)return!0;const t="harness_"+e.harnessSlug.toLowerCase().replace(/-/g,"_");return(await e.pg`
    SELECT to_regclass(${t+".harness_features"}) AS t
  `)[0]?.t!=null}async function y(e,t,a,s={}){const r=e.harnessSlug;a==="in_progress"&&r&&await N(e,t,r);const n=Date.now();return r!=null&&!await $(e)?(s.resetAttempts?await e.pg`
        UPDATE harness_shared.work_items
           SET status = ${a}, attempts = 0, updated_ts = ${n}
         WHERE workspace_id = ${e.workspaceId} AND harness_slug = ${r}
           AND feature_id = ${t} AND item_kind NOT IN ('bug', 'change', 'task')
      `:s.bumpAttempts?await e.pg`
        UPDATE harness_shared.work_items
           SET status = ${a},
               attempts = COALESCE(attempts, 0) + 1,
               updated_ts = ${n}
         WHERE workspace_id = ${e.workspaceId} AND harness_slug = ${r}
           AND feature_id = ${t} AND item_kind NOT IN ('bug', 'change', 'task')
      `:await e.pg`
        UPDATE harness_shared.work_items
           SET status = ${a}, updated_ts = ${n}
         WHERE workspace_id = ${e.workspaceId} AND harness_slug = ${r}
           AND feature_id = ${t} AND item_kind NOT IN ('bug', 'change', 'task')
      `,u(e)):(s.resetAttempts?await e.pg`
      UPDATE harness_features
         SET status = ${a}, attempts = 0, updated_ts = ${n}
       WHERE workspace_id = ${e.workspaceId} AND feature_id = ${t}
    `:s.bumpAttempts?await e.pg`
      UPDATE harness_features
         SET status = ${a},
             attempts = COALESCE(attempts, 0) + 1,
             updated_ts = ${n}
       WHERE workspace_id = ${e.workspaceId} AND feature_id = ${t}
    `:await e.pg`
      UPDATE harness_features
         SET status = ${a}, updated_ts = ${n}
       WHERE workspace_id = ${e.workspaceId} AND feature_id = ${t}
    `,u(e))}var f,D=_((()=>{f=class extends Error{featureId;designStatus;constructor(e,t){super(`feature ${e} cannot transition to in_progress: needs_design=true, design_status=${t??"null"} (must be 'accepted' or 'ignored'). Set design_status=ignored to skip the design phase.`),this.name="DesignGateError",this.featureId=e,this.designStatus=t}}}));function h(e){let t=d.get(e);return t||(t=[],d.set(e,t)),t}function T(e){return[...h(e.stateDir)]}function R(e,t,a,s={}){const r=h(e.stateDir),n=r.findIndex(g=>g.id===t);if(n<0)return[...r];const i={...r[n],status:a};return s.resetAttempts?i.attempts=0:s.bumpAttempts&&(i.attempts=(i.attempts??0)+1),r[n]=i,[...r]}var d,L=_((()=>{d=new Map}));function c(e){return e.pg!==void 0}function C(e){if(e.pg&&e.workspaceId){const t=e.harnessSlug??(e.projectDir?e.projectDir.split(/[/\\]/).filter(Boolean).pop():void 0);return{pg:e.pg,workspaceId:e.workspaceId,harnessSlug:t}}return{kind:"memory",stateDir:e.stateDir}}async function I(e,t){return c(t)?u(t):T(t)}async function F(e,t,a,s){return c(s.ctx)?y(s.ctx,t,a,s):R(s.ctx,t,a,s)}function U(e){const t={}.HARNESS_SLUG??{}.PAPERCUSP_HARNESS_SLUG;if(t&&t.length>0)return t;const a=o.get(e);if(a)return a;P(e);const s=(0,p.basename)(e);return o.set(e,s),s}async function P(e){if(l.has(e))return;l.add(e);const t={}.PAPERCUSP_OPERATOR_BASE??"http://localhost:3070";try{const a=await fetch(`${t}/api/harness/projects`,{signal:AbortSignal.timeout(3e3)});if(!a.ok)return;const s=await a.json(),r=e.replace(/\/+$/,""),n=s.projects?.find(i=>(i.path??"").replace(/\/+$/,"")===r)?.slug;n&&n.length>0&&o.set(e,n)}catch{}}var p,o,l,v=_((()=>{p=m(w(),1),D(),L(),o=new Map,l=new Set}));export{C as a,F as i,v as n,A as o,I as r,D as s,U as t};
