import{n as T}from"./chunk-ChpBd9eV.js";import{Q as o,t as S}from"./src-8fWtxfEz.js";import{c as w,r as l}from"./workspace-registry-Du2UbhlH.js";import{a as y,o as R}from"./operator-home-harness-MSlRvOkW.js";function U(n){return n!=="running"}async function P(n){const e=Date.now(),s=n.harnessSlug?.trim()||R();return o(l(),async r=>{const a=await r`
      INSERT INTO harness_shared.plan_runs (
        workspace_id, harness_slug, plan_slug, plan_content_hash, session_id, note,
        launched_by, launched_at, status, title, updated_at
      ) VALUES (
        ${l()}, ${s}, ${n.planSlug}, ${n.planContentHash}, ${n.sessionId},
        ${n.note}, ${n.launchedBy}, ${e}, ${n.status},
        ${n.title}, ${e}
      )
      RETURNING id
    `;return Number(a[0].id)})}async function F(n,e){await o(l(),async s=>{await s`
      UPDATE harness_shared.plan_runs
      SET status = ${e}, updated_at = ${Date.now()}
      WHERE id = ${n}
    `})}async function H(n=Date.now()){return o(l(),async e=>{const s=await e`
      UPDATE harness_shared.plan_runs
      SET status = 'failed', updated_at = ${n}
      WHERE status = 'running'
        AND updated_at < ${n-f}
      RETURNING id
    `,r=await e`
      UPDATE harness_shared.plan_runs
      SET status = 'archived', updated_at = ${n}
      WHERE status = 'idle'
        AND updated_at < ${n-g}
      RETURNING id
    `;return{failed:s.length,archived:r.length}})}function N(n){return{id:Number(n.id),planSlug:n.plan_slug,planContentHash:n.plan_content_hash,sessionId:n.session_id,note:n.note,launchedBy:n.launched_by,launchedAt:Number(n.launched_at),status:n.status,title:n.title,updatedAt:Number(n.updated_at),runType:n.run_type??"interactive",trigger:n.trigger??null,outcome:n.outcome??null,finishedAt:n.finished_at!=null?Number(n.finished_at):null,runSeq:n.run_seq!=null?Number(n.run_seq):null,instancePlanSlug:n.instance_plan_slug??null,durationMs:n.finished_at!=null?Number(n.finished_at)-Number(n.launched_at):null}}async function q(n){return o(l(),async e=>{const s=(await e`
      SELECT id, plan_slug, plan_content_hash, session_id, note,
             launched_by, launched_at, status, title, updated_at,
             run_type, trigger, outcome, finished_at, run_seq, instance_plan_slug
      FROM harness_shared.plan_runs
      WHERE id = ${n}
    `)[0];return s?N(s):null})}async function W(n,e){return o(l(),async s=>({claimed:(await s`
      UPDATE harness_shared.plan_runs
      SET status = 'running',
          plan_content_hash = ${e},
          updated_at = ${Date.now()}
      WHERE id = ${n}
        AND status <> 'running'
      RETURNING id
    `).length>0}))}function k(n){const e=n.filter(t=>t.outcome==="success").length,s=n.filter(t=>t.outcome==="partial").length,r=n.filter(t=>t.outcome==="failed").length,a=n.filter(t=>t.status==="running").length,u=e+s+r,i=n.map(t=>t.durationMs).filter(t=>t!=null),d=i.length?Math.round(i.reduce((t,E)=>t+E,0)/i.length):null,h=[...i].sort((t,E)=>t-E),_=h.length?h[Math.floor(h.length/2)]:null,m=n.reduce((t,E)=>t+(E.costUsd||0),0),p=n.find(t=>t.outcome!=null)?.outcome??null,c=_!=null?n.filter(t=>t.durationMs!=null&&t.durationMs>2*_).map(t=>t.id):[];return{total:n.length,success:e,partial:s,failed:r,running:a,successRate:u?e/u:0,avgDurationMs:d,medianDurationMs:_,totalCostUsd:m,lastOutcome:p,regression:{lastFailed:n[0]?.outcome==="failed",slowRunIds:c}}}async function v(n,e={}){const s=e.harnessSlug?.trim()||R();return o(l(),async r=>(await r`
      SELECT r.id, r.plan_slug, r.plan_content_hash, r.session_id, r.note,
             r.launched_by, r.launched_at, r.status, r.title, r.updated_at,
             r.run_type, r.trigger, r.outcome, r.finished_at, r.run_seq, r.instance_plan_slug,
             r.result_summary,
             NULLIF((SELECT COUNT(*) FROM harness_shared.plan_run_turns t WHERE t.plan_run_id = r.id), 0) AS turn_count,
             (SELECT COALESCE(SUM(t.cost_usd), 0) FROM harness_shared.plan_run_turns t WHERE t.plan_run_id = r.id) AS cost_usd,
             (SELECT COUNT(*) FROM harness_shared.harness_features_consolidated w
                WHERE w.harness_slug = r.harness_slug AND w.payload -> 'plan_run' ->> 'runId' = r.id::text) AS wi_total,
             (SELECT COUNT(*) FROM harness_shared.harness_features_consolidated w
                WHERE w.harness_slug = r.harness_slug AND w.payload -> 'plan_run' ->> 'runId' = r.id::text
                  AND w.status IN ('passed', 'done', 'resolved', 'closed')) AS wi_passed,
             (SELECT COUNT(*) FROM harness_shared.harness_features_consolidated w
                WHERE w.harness_slug = r.harness_slug AND w.payload -> 'plan_run' ->> 'runId' = r.id::text
                  AND w.status IN ('failed', 'dropped', 'deprecated')) AS wi_failed
      FROM harness_shared.plan_runs r
      WHERE r.workspace_id = ${l()} AND r.harness_slug = ${s} AND r.plan_slug = ${n}
      ORDER BY r.launched_at DESC, r.id DESC
    `).map(a=>{const u=Number(a.wi_total),i=Number(a.wi_passed),d=Number(a.wi_failed);return{...N(a),turnCount:a.turn_count==null?null:Number(a.turn_count),costUsd:Number(a.cost_usd),workItems:{total:u,passed:i,failed:d,open:Math.max(0,u-i-d)},resultSummary:a.result_summary??null}}))}async function G(n){const e=Date.now();return o(l(),async s=>{const r=await s`
      INSERT INTO harness_shared.plan_run_turns (
        workspace_id, plan_run_id, harness_slug, seq, role, content,
        tokens_in, tokens_out, cost_usd, created_at
      )
      SELECT
        ${l()},
        ${n.planRunId},
        -- data-scoping-audit P-005: mirror the parent run's harness_slug so the
        -- turn is directly scope-bearing (RLS/federation symmetry), not only via
        -- a parent join. NULL if the parent run vanished (defensive; FK keeps it
        -- present in practice).
        (SELECT harness_slug FROM harness_shared.plan_runs WHERE id = ${n.planRunId}),
        COALESCE(MAX(seq), 0) + 1,
        ${n.role}, ${n.content},
        ${n.tokensIn??null}, ${n.tokensOut??null},
        ${n.costUsd??null}, ${e}
      FROM harness_shared.plan_run_turns
      WHERE plan_run_id = ${n.planRunId}
      RETURNING seq
    `;return Number(r[0].seq)})}function $(n){return typeof n!="number"||!Number.isFinite(n)?20:Math.min(100,Math.max(1,Math.floor(n)))}function A(n){return n.replace(/[\\%_]/g,e=>"\\"+e)}async function B(n,e={}){const s=$(e.limit),r=typeof e.cursor=="number"&&Number.isFinite(e.cursor)?Math.floor(e.cursor):0,a=e.query?.trim()?e.query.trim():null;return o(l(),async u=>{const i=(await u`
      SELECT id FROM harness_shared.plan_runs
      WHERE session_id = ${n}
      LIMIT 1
    `)[0];if(!i)return{turns:[],nextCursor:null};const d=a?u`AND content ILIKE ${"%"+A(a)+"%"} ESCAPE '\\'`:u``,h=typeof e.beforeTs=="number"&&Number.isFinite(e.beforeTs)?u`AND created_at <= ${Math.floor(e.beforeTs)}`:u``,_=await u`
      SELECT seq, role, content, created_at
      FROM harness_shared.plan_run_turns
      WHERE plan_run_id = ${i.id} AND seq > ${r}
        ${d} ${h}
      ORDER BY seq ASC
      LIMIT ${s+1}
    `,m=_.length>s,p=_.slice(0,s);return{turns:p.map(c=>({seq:Number(c.seq),role:c.role,content:c.content,createdAt:Number(c.created_at)})),nextCursor:m?Number(p[p.length-1].seq):null}})}var f,g,I,M,x=T((()=>{S(),w(),y(),f=30*6e4,g=10080*6e4,I=20,M=100}));export{$ as a,q as c,v as d,N as f,H as g,F as h,U as i,x as l,B as m,f as n,k as o,W as p,G as r,A as s,g as t,P as u};
