const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/mttsh-_NUS5bUB.js","assets/chunk-ChpBd9eV.js"])))=>i.map(i=>d[i]);
import{n}from"./chunk-ChpBd9eV.js";import{n as r,t as o}from"./preload-helper-CcgcQsTF.js";import{a as h,i as p}from"./types-2Vy1q5Ft.js";function u(e){const t={},d=i(e.mttsh_detect_ms),a=i(e.mttsh_triage_ms),_=i(e.mttsh_fix_ms),c=i(e.mttsh_total_ms);return d!==void 0&&(t.detectMs=d),a!==void 0&&(t.triageMs=a),_!==void 0&&(t.fixMs=_),c!==void 0&&(t.totalMs=c),{drillId:e.id,drillClass:e.drill_class,collectorFamily:e.collector_family,plantedAt:s(e.planted_at),detectedAt:s(e.detected_at),triagedAt:s(e.triaged_at),resolvedAt:s(e.resolved_at),expectedWatchdogKey:e.expected_watchdog_key,expectedKind:e.expected_kind,expectedSeverity:e.expected_severity,expectedDecision:e.expected_decision??void 0,detectedWatchdogKey:e.detected_watchdog_key??void 0,detectedKind:e.detected_kind??void 0,triagedDecision:e.triaged_decision??void 0,triagedIdeaType:e.triaged_idea_type??void 0,resolvedWithEvidence:e.resolved_with_evidence,issueId:e.issue_id??void 0,...Object.keys(t).length?{mttsh:t}:{},...e.leak_check_passed==null?{}:{leakCheckPassed:e.leak_check_passed},status:e.status,origin:"drill"}}async function E(e,t){const d=await e`
    INSERT INTO harness_shared.red_queen_drills
      (workspace_id, drill_class, collector_family, status,
       expected_watchdog_key, expected_kind, expected_severity, expected_decision,
       planted_artifacts, payload)
    VALUES (${t.workspaceId}, ${t.drillClass}, ${t.collectorFamily}, 'planted',
            ${t.expectedWatchdogKey}, ${t.expectedKind}, ${t.expectedSeverity},
            ${t.expectedDecision??null},
            ${JSON.stringify(t.artifacts)}::text::jsonb,
            ${t.payload?JSON.stringify(t.payload):null}::text::jsonb)
    RETURNING id, planted_at`;return{drillId:d[0].id,plantedAt:s(d[0].planted_at)}}async function k(e,t,d){await e`
    UPDATE harness_shared.red_queen_drills
       SET status = 'detected', detected_at = ${d.detectedAt},
           detected_watchdog_key = ${d.detectedWatchdogKey},
           detected_kind = ${d.detectedKind??null}, issue_id = ${d.issueId}, updated_at = now()
     WHERE id = ${t}`}async function f(e,t,d){await e`
    UPDATE harness_shared.red_queen_drills
       SET status = 'triaged', triaged_at = ${d.triagedAt},
           triaged_decision = ${d.triagedDecision},
           triaged_idea_type = ${d.triagedIdeaType??null}, updated_at = now()
     WHERE id = ${t}`}async function v(e,t,d){await e`
    UPDATE harness_shared.red_queen_drills
       SET status = 'resolved', resolved_at = ${d.resolvedAt},
           resolved_with_evidence = ${d.resolvedWithEvidence},
           mttsh_detect_ms = ${d.mttsh.detectMs??null},
           mttsh_triage_ms = ${d.mttsh.triageMs??null},
           mttsh_fix_ms = ${d.mttsh.fixMs??null},
           mttsh_total_ms = ${d.mttsh.totalMs??null},
           leak_check_passed = ${d.leakCheck.passed},
           leak_check = ${JSON.stringify(d.leakCheck)}::text::jsonb,
           updated_at = now()
     WHERE id = ${t}`}async function w(e,t,d,a){await e`
    UPDATE harness_shared.red_queen_drills
       SET status = 'failed', error = ${d.slice(0,2e3)},
           leak_check_passed = ${a?a.passed:null},
           leak_check = ${a?JSON.stringify(a):null}::text::jsonb,
           updated_at = now()
     WHERE id = ${t}`}async function x(e,t,d=24){return(await e`
    UPDATE harness_shared.red_queen_drills
       SET status = 'expired', updated_at = now()
     WHERE workspace_id = ${t}
       AND status IN ('planted', 'detected', 'triaged')
       AND planted_at < now() - make_interval(hours => ${d})
     RETURNING id`).length}async function D(e,t=p){const{computeMttshVitals:d}=await o(async()=>{const{computeMttshVitals:a}=await import("./mttsh-_NUS5bUB.js");return{computeMttshVitals:a}},__vite__mapDeps([0,1]));return d(await m(e,{workspaceId:t,limit:500}))}async function m(e,t={}){return(await e`
    SELECT ${e.unsafe(l)}
      FROM harness_shared.red_queen_drills
     WHERE ${t.workspaceId?e`workspace_id = ${t.workspaceId}`:e`TRUE`}
       AND ${t.classId?e`drill_class = ${t.classId}`:e`TRUE`}
       AND ${t.sinceTs?e`planted_at >= ${t.sinceTs}`:e`TRUE`}
     ORDER BY planted_at DESC
     LIMIT ${Math.min(Math.max(1,t.limit??200),2e3)}`).map(u)}var l,s,i,T=n((()=>{h(),r(),l=`id, workspace_id, drill_class, collector_family, status, planted_at, detected_at,
  triaged_at, resolved_at, expected_watchdog_key, expected_kind, expected_severity, expected_decision,
  detected_watchdog_key, detected_kind, triaged_decision, triaged_idea_type, resolved_with_evidence,
  issue_id, mttsh_detect_ms, mttsh_triage_ms, mttsh_fix_ms, mttsh_total_ms, leak_check_passed`,s=e=>e==null?void 0:e instanceof Date?e.toISOString():String(e),i=e=>{if(e==null)return;const t=Number(e);return Number.isFinite(t)?t:void 0}}));export{m as a,v as c,w as i,f as l,T as n,D as o,E as r,k as s,x as t};
