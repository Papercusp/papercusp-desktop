import{n as e}from"./chunk-CMxvf4Kt.js";function t(e){return e.trim().toLowerCase().replace(/\s+/g,` `)}async function n(e,n={}){let r=await e`
    SELECT mem_id, prior_text
    FROM harness_shared.memory_feedback
    WHERE action IN ('delete', 'forget_all')
      AND created_at >= now() - make_interval(days => ${n.days??30})
    ORDER BY created_at DESC
    LIMIT ${n.limit??500}
  `,i=new Set,a=new Set;for(let e of r)e.mem_id&&i.add(e.mem_id),e.prior_text&&e.prior_text.trim()&&a.add(t(e.prior_text));return{deletedIds:i,deletedTexts:a}}function r(e,t){if(t.deletedIds.has(e.id))return!0;let n=e.metadata?.link_id;return typeof n==`string`&&t.deletedIds.has(n)}function i(e,n){return n.deletedTexts.size>0&&n.deletedTexts.has(t(e.text))}function a(e,t){return r(e,t)||i(e,t)}e((()=>{}))();export{a as isFeedbackSuppressed,n as loadFeedbackSignals};