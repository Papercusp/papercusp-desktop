import{n as h,o as m}from"./chunk-ChpBd9eV.js";import{st as u,t as I}from"./src-BmBNODK0.js";import{t as b}from"./__vite-browser-external-56mrcCg8.js";import{a as c,r as w}from"./grant-store-Cd0xUMvw.js";function o(e){return f.has(e)}function _(e){return{workspaceId:e.workspace_id,potSlug:e.harness_slug,receiptId:e.receipt_id,kind:e.kind,offerId:e.offer_id,action:e.action,refusalCode:e.refusal_code,missingCapability:e.missing_capability,budgetAxis:e.budget_axis,detail:e.detail,requesterKind:e.requester_kind,requesterRef:e.requester_ref,requesterGithubUserId:e.requester_github_user_id==null?null:Number(e.requester_github_user_id),responderGithubUserId:Number(e.responder_github_user_id),responderDevicePubkey:e.responder_device_pubkey,receiptTs:Number(e.receipt_ts),origin:e.origin}}async function D(e,s){const t=c(e.workspaceId);if(!t)return{ok:!1,refusal:{code:"workspace_unresolved",detail:"P2P receipt emit refused: unresolvable workspace partition (WI-1564) — a receipt captured under 'default' never federates, i.e. the requester never receives it."}};const r=e.potSlug?.trim();if(!r)return{ok:!1,refusal:{code:"hive_required",detail:"receipts are hive-scoped; pass the hive HOME slug."}};if(!Number.isInteger(e.responderGithubUserId)||e.responderGithubUserId<=0)return{ok:!1,refusal:{code:"invalid_responder",detail:"responderGithubUserId must be a positive numeric GitHub user-id (X9)."}};if(e.kind==="refusal"&&!e.refusal)return{ok:!1,refusal:{code:"refusal_required",detail:"kind='refusal' requires the structured refusal {code, missing?, detail}."}};if(!o(e.kind)&&e.refusal)return{ok:!1,refusal:{code:"refusal_on_success_receipt",detail:`kind='${e.kind}' is a success fact and must not carry a structured refusal — put the outcome in \`detail\`.`}};if(!o(e.kind)&&!e.detail?.trim())return{ok:!1,refusal:{code:"detail_required",detail:`kind='${e.kind}' carries no refusal code, so \`detail\` is its ONLY payload — emitting it empty federates a content-free success.`}};const i=s??u().sql,d=(0,a.randomUUID)(),l=e.receiptTs??Date.now(),$=e.detail??e.refusal?.detail??"",n=e.offerId??null,k=_((await i`
    INSERT INTO harness_shared.p2p_receipts
      (workspace_id, harness_slug, receipt_id, kind, offer_id, action,
       refusal_code, missing_capability, budget_axis, detail,
       requester_kind, requester_ref, requester_github_user_id,
       responder_github_user_id, responder_device_pubkey, receipt_ts)
    VALUES
      (${t}, ${r}, ${d}, ${e.kind}, ${n}, ${e.action},
       ${e.refusal?.code??null}, ${e.refusal?.missing??null},
       ${e.budgetAxis??null}, ${$},
       ${e.requester?.kind??null}, ${e.requester?.ref??null},
       ${e.requester?.githubUserId??null},
       ${e.responderGithubUserId}, ${e.responderDevicePubkey??null}, ${l})
    RETURNING *`)[0]);try{await i`
      INSERT INTO harness_shared.audit_log (id, ts, actor, action, subject, details, workspace_id)
      VALUES (${(0,a.randomUUID)()}, ${l}, ${e.actor??"p2p"}, ${"p2p:receipt:"+e.kind},
              ${e.action+(n?` offer=${n}`:"")},
              ${JSON.stringify({receipt_id:d,offer_id:n,hive:r,refusal_code:e.refusal?.code??null,missing:e.refusal?.missing??null,requester:e.requester??null})}::text::jsonb, ${t})`}catch{}if(o(e.kind))try{await E({workspaceId:t,potSlug:r,reason:`${e.kind}:${e.refusal?.code??e.action}`},i)}catch{}const p=`[p2p:receipt] ${e.kind} action=${e.action}${n?` offer=${n}`:""} code=${e.refusal?.code??"-"} missing=${e.refusal?.missing??"-"} requester=${e.requester?.kind??"-"}:${e.requester?.ref??"-"} receipt=${d}`;return o(e.kind)?console.warn(p):console.log(p),{ok:!0,receipt:k}}async function E(e,s){const t=s??u().sql;try{await t`
      INSERT INTO harness_shared.p2p_refused_op_counters (workspace_id, harness_slug, reason, count, updated_at)
      VALUES (${e.workspaceId}, ${e.potSlug}, ${e.reason}, 1, now())
      ON CONFLICT (workspace_id, harness_slug, reason)
      DO UPDATE SET count = harness_shared.p2p_refused_op_counters.count + 1, updated_at = now()`}catch(r){console.error(`[p2p:refused-op-counter] FAILED to bump counter (trust-layer evidence gap) workspace=${e.workspaceId} pot=${e.potSlug} reason=${e.reason}:`,r)}}async function T(e,s){const t=c(e.workspaceId);if(!t)return[];const r=s??u().sql,i=Math.min(Math.max(e.limit??100,1),500);return(e.offerId?await r`
        SELECT * FROM harness_shared.p2p_receipts
         WHERE workspace_id = ${t} AND harness_slug = ${e.potSlug} AND offer_id = ${e.offerId}
         ORDER BY receipt_ts ASC LIMIT ${i}`:await r`
        SELECT * FROM harness_shared.p2p_receipts
         WHERE workspace_id = ${t} AND harness_slug = ${e.potSlug}
         ORDER BY receipt_ts DESC LIMIT ${i}`).map(_)}async function O(e,s){const t=c(e.workspaceId);return t?(await(s??u().sql)`
    SELECT reason, count FROM harness_shared.p2p_refused_op_counters
     WHERE workspace_id = ${t} AND harness_slug = ${e.potSlug}
     ORDER BY count DESC`).map(r=>({reason:r.reason,count:Number(r.count)})):[]}var a,q,f,U=h((()=>{a=m(b(),1),I(),w(),q=["refusal","excused-breach","honored"],f=new Set(["refusal","excused-breach"])}));export{T as a,U as i,E as n,O as o,D as r,q as t};
