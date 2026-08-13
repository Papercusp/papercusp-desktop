import{n as f}from"./chunk-ChpBd9eV.js";import{st as d,t as w}from"./src-BmBNODK0.js";async function T(e){const{workspaceId:s,ownerId:i,matches:a}=e;if(a.length===0)return 0;try{const r=e.client??d().sql;let _=0;for(const n of a){const o=await r`
        INSERT INTO harness_shared.bash_tool_substitution_fires
          (workspace_id, row_id, intent_label, tool_name, session_id, command, tier)
        SELECT ${s}, s.id, s.intent_label, s.tool_name,
               ${i}, ${n.atom}, ${n.tier}
          FROM harness_shared.bash_tool_substitutions s
         WHERE s.workspace_id = ${s}
           AND s.intent_label = ${n.intentLabel}
        RETURNING row_id
      `;o.length!==0&&(_+=o.length,await r`
        UPDATE harness_shared.bash_tool_substitutions
           SET match_count = match_count + 1,
               last_fired_at = now()
         WHERE workspace_id = ${s}
           AND intent_label = ${n.intentLabel}
      `)}return _}catch{return 0}}function A(e){T(e).catch(()=>{})}function b(e){return typeof e=="object"&&e!==null&&e.code===u}async function R(e){const s=e.client??d().sql,i=e.now??new Date,a=new Date(i.getTime()-h),r=new Date(i.getTime()-m),_=e.limit??500;let n;try{n=await s`
      SELECT id, session_id, tool_name, fired_at
        FROM harness_shared.bash_tool_substitution_fires
       WHERE workspace_id = ${e.workspaceId}
         AND resolved_at IS NULL
         AND fired_at < ${a}
       ORDER BY fired_at
       LIMIT ${_}
    `}catch(t){if(b(t))return{examined:0,measured:0,noFollowUp:0};throw t}let o=0,c=0;for(const t of n){const l=t.session_id?await s`
          SELECT tool_name
            FROM harness_shared.tool_invocations
           WHERE coord_owner_id = ${t.session_id}
             AND invoked_at > ${t.fired_at}
             AND tool_name <> ${E}
           ORDER BY invoked_at
           LIMIT 1
        `:[];if(l.length>0){await s`
        UPDATE harness_shared.bash_tool_substitution_fires
           SET complied = ${l[0].tool_name===t.tool_name}, resolved_at = now()
         WHERE id = ${t.id}
      `,o+=1;continue}t.fired_at<r&&(await s`
        UPDATE harness_shared.bash_tool_substitution_fires
           SET resolved_at = now()
         WHERE id = ${t.id}
      `,c+=1)}return{examined:n.length,measured:o,noFollowUp:c}}var E,h,m,u,I=f((()=>{w(),E="locks:check_command",h=6e4,m=60*6e4,u="42P01"}));export{A as a,I as i,h as n,T as o,E as r,R as s,m as t};
