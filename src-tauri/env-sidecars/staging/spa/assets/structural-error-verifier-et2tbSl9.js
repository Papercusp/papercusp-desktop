import{n as d}from"./chunk-ChpBd9eV.js";import{st as p,t as R}from"./src-8fWtxfEz.js";import{r as h,t as y}from"./src-CynoHxv9.js";import{T as g,q as v}from"./issues-engineer-_Tsz6dkl.js";import{t as T}from"./tool-error-classifier-BJ9zfLEZ.js";function S(e){const t=_.exec(e);return t?{tool:t[1],klass:t[2],fingerprint:t[3]??null}:null}var _,A=d((()=>{T(),_=new RegExp(`^repeated-tool-error:(.+):(${["structural","transient","caller","rate-limit"].join("|")})(?::(.+))?$`)}));function k(e){return e.recentRecurrences===0&&e.itemAgeMs>=e.windowMs}async function $(e,t={}){const o=t.windowMs??f,a=t.maxPerTick??E,r=(await e.selectOpenStructuralItems()).slice(0,a);let s=0,i=0,l=0;for(const n of r)try{if(k({recentRecurrences:await e.countRecentToolErrors(n.tool,n.workspaceId,o),itemAgeMs:n.ageMs,windowMs:o})){const m=Math.round(o/36e5);await e.resolveItem(n.workspaceId,n.issueId,`auto-resolved (EI-1747 structural-error verifier): \`${n.tool}\` has emitted no error in the deployed operator's telemetry for ≥${m}h, so the structural error is fixed on the deployed sha. Reopens automatically if the watchdog re-files on recurrence.`),s++}else i++}catch{l++}return{checked:r.length,resolved:s,kept:i,errored:l}}function M(e=p,t=Date.now){return{async selectOpenStructuralItems(){const{sql:o}=e(),a=await o`
        SELECT workspace_id,
               issue_id,
               payload->>'watchdogKey' AS watchdog_key,
               (EXTRACT(EPOCH FROM created_at) * 1000)::bigint::text AS created_ms
        FROM harness_shared.engineer_issues
        WHERE state = 'open'
          AND payload->>'watchdogKey' ~ ${w}
        ORDER BY created_at ASC
        LIMIT 200
      `,r=[];for(const s of a){const i=S(s.watchdog_key);!i||i.klass!=="structural"||r.push({workspaceId:s.workspace_id,issueId:s.issue_id,tool:i.tool,watchdogKey:s.watchdog_key,ageMs:t()-Number(s.created_ms)})}return r},async countRecentToolErrors(o,a,r){const{sql:s}=e(),i=await s`
        SELECT COUNT(*)::text AS n
        FROM harness_shared.tool_invocations
        WHERE tool_name = ${o}
          AND workspace_id = ${a}
          AND status IN ('error', 'timeout')
          AND invoked_at > ${new Date(t()-r).toISOString()}
      `;return Number(i[0]?.n??0)},async resolveItem(o,a,r){const{sql:s}=e();if((await s`
        UPDATE harness_shared.engineer_issues
        SET body = body || ${`

`+r},
            payload = CASE
              WHEN payload ? 'ideaLifecycle'
                THEN jsonb_set(payload, '{ideaLifecycle,state}', '"resolved"'::jsonb)
              ELSE payload
            END,
            updated_at = NOW()
        WHERE workspace_id = ${o} AND issue_id = ${a} AND state = 'open'
        RETURNING issue_id
      `)[0]&&!await v(a,"resolved","structural-error-verifier",r))throw new Error(`structural-error-verifier: lifecycle write was not applied for ${o}/${a}`)}}}function P(e={}){if(c)return{stop:u};const t=e.intervalMs??1800*1e3,o=e.deps??M(),a=async()=>{if(!e.isShedding?.())try{const r=await $(o,{windowMs:e.windowMs});r.resolved>0&&e.log?.(`[structural-error-verifier] auto-resolved ${r.resolved}/${r.checked} stale structural EIs (${r.kept} kept, ${r.errored} errored)`)}catch(r){e.log?.(`[structural-error-verifier] tick failed (continuing): ${r instanceof Error?r.message:String(r)}`)}};return c=h("structural-error-verifier",t,()=>a(),{category:"global-sweep"}),e.log?.(`[structural-error-verifier] armed — every ${Math.round(t/6e4)}m (kill-switch: PAPERCUSP_STRUCTURAL_ERROR_VERIFIER=0)`),{stop:u}}function u(){c&&(c.stop(),c=null)}var f,E,w,c,I=d((()=>{R(),y(),g(),A(),f=360*60*1e3,E=50,w="^repeated-tool-error:.+:structural(:.*)?$",c=null}));I();export{P as startStructuralErrorVerifier};
