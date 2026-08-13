import{n as o}from"./chunk-ChpBd9eV.js";function r(s,t,d=30){return{shifts:[...s].sort((e,n)=>i(n.window_date).localeCompare(i(e.window_date))||n.score-e.score).slice(0,d).map(e=>({id:Number(e.id),windowDate:i(e.window_date),feature:e.feature,kind:e.kind,score:Number(e.score),severity:e.severity,direction:e.direction,baselineSummary:e.baseline_summary===null?null:Number(e.baseline_summary),windowSummary:e.window_summary===null?null:Number(e.window_summary),windowSessions:e.window_sessions,baselineSessions:e.baseline_sessions,attributed:e.attributed,ledgerCandidates:Array.isArray(e.ledger_candidates)?e.ledger_candidates:[],notifiedAt:e.notified_at==null?null:a(e.notified_at)})),totalShifts:s.length,unattributedShifts:s.filter(e=>!e.attributed).length,sessionsEmbedded:t.sessionsEmbedded,sessions7d:t.sessions7d,scannedAt:t.scannedAt}}async function c(s,t,d=30){const e=await s`
    SELECT id, window_date, feature, kind, score, severity, direction,
           baseline_summary, window_summary, window_sessions, baseline_sessions,
           attributed, ledger_candidates, notified_at
      FROM harness_shared.fleet_ekg_shifts
     WHERE workspace_id = ${t}`,n=(await s`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE ended_at > now() - interval '7 days')::int AS recent,
           max(computed_at) AS scanned_at
      FROM harness_shared.fleet_ekg_sessions
     WHERE workspace_id = ${t}`)[0];return r(e,{sessionsEmbedded:n?.total??0,sessions7d:n?.recent??0,scannedAt:n?.scanned_at==null?null:a(n.scanned_at)},d)}var a,i,l,u=o((()=>{a=s=>s instanceof Date?s.toISOString():String(s),i=s=>a(s).slice(0,10),l={shifts:[],totalShifts:0,unattributedShifts:0,sessionsEmbedded:0,sessions7d:0,scannedAt:null}}));u();export{l as EMPTY_EKG_SNAPSHOT,c as readEkgSnapshot};
