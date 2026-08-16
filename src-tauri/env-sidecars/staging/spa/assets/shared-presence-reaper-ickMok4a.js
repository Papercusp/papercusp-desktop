import{n as p}from"./chunk-ChpBd9eV.js";import{st as E,t as R}from"./src-8fWtxfEz.js";import{n as h,r as l,t as c}from"./coord-liveness-config-BMo5LRfP.js";async function m(e={}){const s=e.sql??E().sql;let r=e.ttlMs,a=e.maxRowsPerDevice;if(r==null||a==null){const t=await l();r??=t.sharedPresenceReaperTtlMs??c.sharedPresenceReaperTtlMs,a??=t.sharedPresenceMaxRowsPerDevice??c.sharedPresenceMaxRowsPerDevice}const n=new Date((e.nowMs??Date.now())-r).toISOString(),i=await s`
    DELETE FROM harness_shared.shared_presence WHERE last_seen_at < ${n}::timestamptz
  `,d=await s`
    DELETE FROM harness_shared.shared_session_presence WHERE last_seen_at < ${n}::timestamptz
  `,o=await s`
    DELETE FROM harness_shared.shared_presence sp
    USING (
      SELECT ctid, row_number() OVER (
        PARTITION BY workspace_id, device_pubkey
        ORDER BY last_seen_at DESC, ctid DESC
      ) AS rn
      FROM harness_shared.shared_presence
    ) ranked
    WHERE sp.ctid = ranked.ctid AND ranked.rn > ${a}
  `,_=await s`
    DELETE FROM harness_shared.shared_session_presence ssp
    USING (
      SELECT ctid, row_number() OVER (
        PARTITION BY workspace_id, device_pubkey
        ORDER BY last_seen_at DESC, ctid DESC
      ) AS rn
      FROM harness_shared.shared_session_presence
    ) ranked
    WHERE ssp.ctid = ranked.ctid AND ranked.rn > ${a}
  `;return{presenceTtlReaped:i.count,sessionTtlReaped:d.count,presenceCapReaped:o.count,sessionCapReaped:_.count}}var D=p((()=>{R(),h()}));D();export{m as reapStaleSharedPresence};
