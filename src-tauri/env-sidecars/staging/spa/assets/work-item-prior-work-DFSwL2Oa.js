import{n as _}from"./chunk-ChpBd9eV.js";import{st as l,t as p}from"./src-8fWtxfEz.js";import{c as y,d as u}from"./workspace-registry-Du2UbhlH.js";function m(e){if(!Array.isArray(e))return[];const t=[];for(const r of e){if(typeof r=="string"){const s=r.trim();s&&t.push(s);continue}if(r&&typeof r=="object"){const s=r,n=String(s.owner??s.ownerId??s.agent??s.by??"").trim();n&&t.push(n)}}return[...new Set(t)]}function c(e){const t=typeof e=="number"?e:Number(e??0);return Number.isFinite(t)&&t>0?Math.floor(t):0}function h(e){if(e==null)return null;const t=e instanceof Date?e.getTime():Date.parse(String(e));return Number.isFinite(t)?t:null}function w(e){const t=typeof e=="number"?e:Number(e??NaN);return Number.isFinite(t)&&t>0?t:null}function k(e,t=Date.now()){if(!e||!Number.isFinite(t))return null;const r=String(e.created_by??"").trim(),s=w(e.created_ts),n=h(e.author_session_ended_at);if(!r||s==null||n==null)return null;const a=t-s;if(a<12096e5||n>t)return null;const o=e.worked_by_history==null||Array.isArray(e.worked_by_history)&&e.worked_by_history.length===0;return c(e.attempts)>0||e.last_released_at!=null||e.last_progress_at!=null||!o||e.author_has_open_session!==!1?null:{createdBy:r,itemCreatedAtMs:s,itemAgeMs:a,authorSessionEndedAtMs:n,authorSessionEndedBy:String(e.author_session_ended_by??"").trim()||null}}async function A(e){const t=u(e.workspaceId);if(!t||!e.workItemId)return null;try{const{sql:r}=l(),s=e.harness==null||e.harness===""||e.harness==="*"?null:e.harness;return k((await r`
      SELECT w.created_ts,
             NULLIF(w.payload #>> '{_ei,created_by}', '') AS created_by,
             w.attempts,
             w.last_released_at,
             w.last_progress_at,
             w.worked_by_history,
             ended.ended_at AS author_session_ended_at,
             ended.ended_by AS author_session_ended_by,
             EXISTS (
               SELECT 1
                 FROM harness_shared.adv_sessions active
                WHERE active.workspace_id = ${t}
                  AND active.coord_owner_id = NULLIF(w.payload #>> '{_ei,created_by}', '')
                  AND active.ended_at IS NULL
             ) AS author_has_open_session
        FROM harness_shared.work_items w
        LEFT JOIN LATERAL (
          SELECT s.ended_at, s.ended_by
            FROM harness_shared.adv_sessions s
           WHERE s.workspace_id = ${t}
             AND s.coord_owner_id = NULLIF(w.payload #>> '{_ei,created_by}', '')
             AND s.ended_at IS NOT NULL
           ORDER BY s.ended_at DESC
           LIMIT 1
        ) ended ON TRUE
       WHERE w.workspace_id = ${t}
         AND w.feature_id = ${e.workItemId}
         AND (${s}::text IS NULL OR w.harness_slug = ${s})
       LIMIT 1`)[0]??null,e.nowMs??Date.now())}catch{return null}}function E(e){if(!e)return null;const t=Math.max(0,Math.floor(e.itemAgeMs/(1440*60*1e3))),r=e.authorSessionEndedBy?` (recorded by ${e.authorSessionEndedBy})`:"";return`⚠ AUTHORSHIP REVALIDATION: this item is ${t} days old; the row records no prior claim, release, or progress; and its authoring session ${e.createdBy} is recorded ended at ${new Date(e.authorSessionEndedAtMs).toISOString()}${r}. This signal does NOT say whether the requested work is missing or already done. Re-read the item and verify its premises against current source/tests before building. [EI-18765234433145274]`}async function N(e){const t=u(e.workspaceId);if(!t||!e.workItemId)return null;try{const{sql:r}=l(),s=e.harness==null||e.harness===""||e.harness==="*"?null:e.harness,n=(await r`
      SELECT taken_by, attempts, last_released_by, last_released_at, worked_by_history
        FROM harness_shared.work_items
       WHERE workspace_id = ${t}
         AND feature_id = ${e.workItemId}
         AND (${s}::text IS NULL OR harness_slug = ${s})
       LIMIT 1`)[0];if(!n)return null;const a=c(n.attempts),o=h(n.last_released_at),i=String(n.last_released_by??"").trim()||null,d=m(n.worked_by_history);return a===0&&o==null&&i==null&&d.length===0?null:{lastReleasedBy:i,releasedAtMs:o,attempts:a,priorWorkers:d,hasCheckpoint:e.hasCheckpoint==="unknown"?"unknown":e.hasCheckpoint===!0}}catch{return null}}function S(e){if(!e)return null;const t=[];if(e.lastReleasedBy){const n=e.releasedAtMs!=null?` at ${new Date(e.releasedAtMs).toISOString()}`:"";t.push(`last released by ${e.lastReleasedBy}${n}`)}else e.releasedAtMs!=null&&t.push(`last released at ${new Date(e.releasedAtMs).toISOString()}`);e.attempts>0&&t.push(`${e.attempts} prior claim attempt${e.attempts===1?"":"s"}`);const r=e.priorWorkers.filter(n=>n!==e.lastReleasedBy);r.length>0&&t.push(`previously worked by ${r.join(", ")}`);const s=t.length>0?` (${t.join("; ")})`:"";return e.hasCheckpoint===!0?`PRIOR WORK on this item${s}. A checkpoint exists — read it (above) before starting; this item is NOT fresh work. [P-001]`:e.hasCheckpoint==="unknown"?`⚠ PRIOR WORK on this item${s}. The checkpoint store could NOT BE READ, so whether a checkpoint exists is UNKNOWN — this is not the same as there being none, and must not be treated as such. Do NOT start rebuilding: re-read this item once the datastore is reachable (work_items:get), and only then judge whether prior work needs redoing. [P-001/WI-6737]`:`⚠ PRIOR WORK on this item${s}, and NO checkpoint was ever written — so this row is indistinguishable from never-started even though it has been worked. READ THE SOURCE before building anything: the prior holder may have already finished it and lost the checkpoint to a compaction, a crash, or a hard kill. Rebuilding finished work is the failure this warning exists to prevent (observed live 2026-07-26 on WI-6096, a fully-built CI-wired feature that read as untouched). [P-001]`}var g,O=_((()=>{p(),y(),g=336*60*60*1e3}));export{N as a,S as c,A as i,k as n,O as o,E as r,m as s,g as t};
