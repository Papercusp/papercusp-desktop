import{n as o}from"./chunk-ChpBd9eV.js";import{st as i,t as n}from"./src-BmBNODK0.js";import{c,r as _}from"./workspace-registry-Du2UbhlH.js";async function N(e){const{sql:r}=i(),s=e?.workspaceId??_(),a=e?.limit??25;return(await r`
    SELECT t.id, t.conversation_id, t.report, t.text, t.created_at
      FROM harness_shared.operator_turns t
      JOIN harness_shared.operator_conversations c ON c.id = t.conversation_id
     WHERE c.workspace_id = ${s}
       AND t.role = 'assistant'
       AND t.report IS NOT NULL
       -- deterministic-status-cards-2026-07-17 P-002: a source='system' report
       -- turn is a CURATOR status card that renders in the CHAT (its signals —
       -- escalations/blockers — are already in the inbox via their own sources);
       -- only the operator's OWN <report> turns (text_typed/voice_tts) belong here.
       AND t.source <> 'system'
       AND t.created_at > ${(e?.nowMs??Date.now())-(e?.sinceMs??1728e5)}
     ORDER BY t.created_at DESC
     LIMIT ${a}
  `).map(t=>({turnId:String(t.id),conversationId:String(t.conversation_id),report:t.report,text:t.text,createdAt:Number(t.created_at)}))}var d,p,m=o((()=>{n(),c(),d=2880*60*1e3,p=25}));m();export{p as REPORT_LIMIT,d as REPORT_WINDOW_MS,N as readRecentOperatorReports};
