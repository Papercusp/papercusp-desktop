import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";function r(e){return e==null?0:typeof e==`bigint`?Number(e):e}function i(e){let t;if(Array.isArray(e.claims))t=e.claims;else if(typeof e.claims==`string`&&e.claims.length>0)try{t=JSON.parse(e.claims)}catch{}return{id:e.feature_id,title:e.title??``,status:e.status,attempts:r(e.attempts),...t?{claims:t}:{},...e.notes?{notes:e.notes}:{},...e.summary?{summary:e.summary}:{},...e.kind?{kind:e.kind}:{}}}async function a(e){if(!e.harnessSlug)return console.warn(`[state-pg] readFeaturesPg called with no harnessSlug — returning no features`),[];let t=(await e.pg`
    SELECT hf.feature_id, hf.title, hf.summary, hf.status, hf.attempts, hf.claims,
           hf.notes, hf.metadata, hf.kind, hf.project_id, hf.expected_cost_cents,
           hf.tags, hf.needs_human_review, hf.ts, hf.created_ts, hf.updated_ts
      FROM harness_features hf
      -- G2 Auditor-admission gate (P-008): LEFT JOIN against the consolidated
      -- table to read origin + audit_verdict without touching the per-harness
      -- schema. hfc may have no row yet (pre-sync) — treat that as local/pickable.
      LEFT JOIN harness_shared.harness_features_consolidated hfc
        ON hfc.harness_slug = ${e.harnessSlug??``}
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
              AND harness_slug  = ${e.harnessSlug??``}
              AND op_status     = 'started'
         )
       )
     ORDER BY hf.feature_id
  `).map(i),n=await o(e);return n.size>0?t.filter(e=>!n.has(e.id)):t}async function o(e){if({}.PAPERCUSP_DBOS_ORCHESTRATOR===`0`)return new Set;let t=e.harnessSlug;if(!t)return new Set;try{if(!(await e.pg`
      SELECT to_regclass('dbos.workflow_status') AS t
    `)[0]?.t)return new Set;let n=`pipeline:${t}:%`,r=await e.pg`
      SELECT DISTINCT split_part(workflow_uuid, ':', 3) AS feature_id
        FROM dbos.workflow_status
       WHERE workflow_uuid LIKE ${n}
         AND status IN ('PENDING', 'ENQUEUED')
    `;return new Set(r.map(e=>e.feature_id).filter(e=>e.length>0))}catch{return new Set}}function s(){return{}.PAPERCUSP_DESIGN_GATE===`1`}async function c(e,t,n){if(!s())return;let r=(await e.pg`
    SELECT needs_design, design_status
      FROM harness_shared.harness_features_consolidated
     WHERE harness_slug = ${n} AND feature_id = ${t}
     LIMIT 1
  `)[0];if(r&&r.needs_design&&!(r.design_status===`accepted`||r.design_status===`ignored`))throw new u(t,r.design_status)}async function l(e,t,n,r={}){let i=e.harnessSlug;n===`in_progress`&&i&&await c(e,t,i);let o=Date.now();return r.resetAttempts?await e.pg`
      UPDATE harness_features
         SET status = ${n}, attempts = 0, updated_ts = ${o}
       WHERE workspace_id = ${e.workspaceId} AND feature_id = ${t}
    `:r.bumpAttempts?await e.pg`
      UPDATE harness_features
         SET status = ${n},
             attempts = COALESCE(attempts, 0) + 1,
             updated_ts = ${o}
       WHERE workspace_id = ${e.workspaceId} AND feature_id = ${t}
    `:await e.pg`
      UPDATE harness_features
         SET status = ${n}, updated_ts = ${o}
       WHERE workspace_id = ${e.workspaceId} AND feature_id = ${t}
    `,a(e)}var u,d=e((()=>{u=class extends Error{featureId;designStatus;constructor(e,t){super(`feature ${e} cannot transition to in_progress: needs_design=true, design_status=${t??`null`} (must be 'accepted' or 'ignored'). Set design_status=ignored to skip the design phase.`),this.name=`DesignGateError`,this.featureId=e,this.designStatus=t}}}));function f(e){let t=h.get(e);return t||(t=[],h.set(e,t)),t}function p(e){return[...f(e.stateDir)]}function m(e,t,n,r={}){let i=f(e.stateDir),a=i.findIndex(e=>e.id===t);if(a<0)return[...i];let o={...i[a],status:n};return r.resetAttempts?o.attempts=0:r.bumpAttempts&&(o.attempts=(o.attempts??0)+1),i[a]=o,[...i]}var h,g=e((()=>{h=new Map}));function _(e){return e.pg!==void 0}function v(e){if(e.pg&&e.workspaceId){let t=e.harnessSlug??(e.projectDir?e.projectDir.split(/[/\\]/).filter(Boolean).pop():void 0);return{pg:e.pg,workspaceId:e.workspaceId,harnessSlug:t}}return{kind:`memory`,stateDir:e.stateDir}}async function y(e,t){return _(t)?a(t):p(t)}async function b(e,t,n,r){return _(r.ctx)?l(r.ctx,t,n,r):m(r.ctx,t,n,r)}function x(e){let t={}.HARNESS_SLUG??{}.PAPERCUSP_HARNESS_SLUG;if(t&&t.length>0)return t;let n=w.get(e);if(n)return n;S(e);let r=(0,C.basename)(e);return w.set(e,r),r}async function S(e){if(T.has(e))return;T.add(e);let t={}.PAPERCUSP_OPERATOR_BASE??`http://localhost:3070`;try{let n=await fetch(`${t}/api/harness/projects`,{signal:AbortSignal.timeout(3e3)});if(!n.ok)return;let r=await n.json(),i=e.replace(/\/+$/,``),a=r.projects?.find(e=>(e.path??``).replace(/\/+$/,``)===i)?.slug;a&&a.length>0&&w.set(e,a)}catch{}}var C,w,T,E=e((()=>{C=t(n(),1),d(),g(),w=new Map,T=new Set}));export{v as a,b as i,E as n,o,y as r,d as s,x as t};