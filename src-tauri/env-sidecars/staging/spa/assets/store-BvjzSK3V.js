import{n as l}from"./chunk-ChpBd9eV.js";import{n as c,t as _}from"./pot-scope-DYK3r_aB.js";function r(s){return{workspaceId:e(s.workspace_id),id:e(s.id),signature:e(s.signature),title:n(s.title),lessonText:e(s.lesson_text),sourceKind:e(s.source_kind),sourceRef:n(s.source_ref),tier:e(s.tier),status:e(s.status),testCount:Number(s.test_count??0),passCount:Number(s.pass_count??0),failCount:Number(s.fail_count??0),lastTestedAt:u(s.last_tested_at),lastBatteryId:n(s.last_battery_id),lastDelta:d(s.last_delta),memoryId:n(s.memory_id),packCandidateId:n(s.pack_candidate_id),signalOrigin:e(s.signal_origin),potSlug:n(s.pot_slug),createdAt:i(s.created_at),updatedAt:i(s.updated_at)}}async function I(s,t){const a=await c({workspaceId:t.workspaceId,potSlug:t.potSlug??null,harnessSlug:t.harnessSlug??null}),o=await s`
    INSERT INTO harness_shared.transfer_lessons
      (workspace_id, signature, title, lesson_text, source_kind, source_ref, pack_candidate_id, pot_slug)
    VALUES (${t.workspaceId}, ${t.signature}, ${t.title??null}, ${t.lessonText},
      ${t.sourceKind??"transcript"}, ${t.sourceRef??null}, ${t.packCandidateId??null}, ${a})
    ON CONFLICT ON CONSTRAINT transfer_lessons_signature_uniq DO NOTHING
    RETURNING *`;return o.length>0?{admitted:!0,lesson:r(o[0])}:{admitted:!1,reason:"duplicate-signature",lesson:await p(s,{workspaceId:t.workspaceId,signature:t.signature})}}async function f(s,t){const a=await s`
    SELECT * FROM harness_shared.transfer_lessons
     WHERE workspace_id = ${t.workspaceId} AND id = ${t.id} LIMIT 1`;return a.length?r(a[0]):null}async function p(s,t){const a=await s`
    SELECT * FROM harness_shared.transfer_lessons
     WHERE workspace_id = ${t.workspaceId} AND signature = ${t.signature} LIMIT 1`;return a.length?r(a[0]):null}async function g(s,t){const a=Math.min(Math.max(t.limit,1),100);return(await s`
    SELECT * FROM harness_shared.transfer_lessons
     WHERE workspace_id = ${t.workspaceId} AND tier IN ('probationary', 'validated')
     ORDER BY (tier = 'probationary') DESC, last_tested_at ASC NULLS FIRST, created_at ASC
     LIMIT ${a}`).map(r)}async function m(s,t){const a=Math.min(Math.max(t.limit??100,1),500);return(await s`
    SELECT * FROM harness_shared.transfer_lessons
     WHERE workspace_id = ${t.workspaceId}
       ${t.tier?s`AND tier = ${t.tier}`:s``}
     ORDER BY created_at DESC
     LIMIT ${a}`).map(r)}async function k(s,t){const a=await s`
    UPDATE harness_shared.transfer_lessons
       SET tier = ${t.transition.tier}, status = ${t.transition.status},
           pass_count = ${t.transition.passCount}, fail_count = ${t.transition.failCount},
           test_count = test_count + 1, last_tested_at = now(),
           last_battery_id = ${t.batteryId}, last_delta = ${t.delta},
           updated_at = now()
     WHERE workspace_id = ${t.workspaceId} AND id = ${t.id}
     RETURNING *`;return a.length?r(a[0]):null}async function T(s,t){await s`
    UPDATE harness_shared.transfer_lessons
       SET status = 'error', test_count = test_count + 1, last_tested_at = now(), updated_at = now()
     WHERE workspace_id = ${t.workspaceId} AND id = ${t.id}`}async function $(s,t){await s`
    UPDATE harness_shared.transfer_lessons
       SET memory_id = ${t.memoryId}, updated_at = now()
     WHERE workspace_id = ${t.workspaceId} AND id = ${t.id}`}async function N(s,t){await s`
    UPDATE harness_shared.transfer_lessons
       SET pack_candidate_id = ${t.packCandidateId}, updated_at = now()
     WHERE workspace_id = ${t.workspaceId} AND id = ${t.id}`}var e,n,d,i,u,S=l((()=>{_(),e=s=>String(s),n=s=>s==null?null:String(s),d=s=>s==null?null:Number(s),i=s=>new Date(s).toISOString(),u=s=>s==null?null:i(s)}));export{g as a,k as c,S as i,$ as l,p as n,m as o,f as r,T as s,I as t,N as u};
