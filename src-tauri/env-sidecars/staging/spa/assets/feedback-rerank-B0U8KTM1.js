import{n as f}from"./chunk-ChpBd9eV.js";function i(t){return t.trim().toLowerCase().replace(/\s+/g," ")}async function p(t,e={}){const d=await t`
    SELECT mem_id, prior_text
    FROM harness_shared.memory_feedback
    WHERE action IN ('delete', 'forget_all')
      AND created_at >= now() - make_interval(days => ${e.days??30})
    ORDER BY created_at DESC
    LIMIT ${e.limit??500}
  `,o=new Set,r=new Set;for(const n of d)n.mem_id&&o.add(n.mem_id),n.prior_text&&n.prior_text.trim()&&r.add(i(n.prior_text));return{deletedIds:o,deletedTexts:r}}function s(t,e){if(e.deletedIds.has(t.id))return!0;const d=t.metadata?.link_id;return typeof d=="string"&&e.deletedIds.has(d)}function a(t,e){return e.deletedTexts.size>0&&e.deletedTexts.has(i(t.text))}function E(t,e){return s(t,e)||a(t,e)}function T(t,e){if(e.deletedIds.size===0&&e.deletedTexts.size===0)return t;let d=!1;const o=[];for(const r of t)s(r,e)||(a(r,e)&&typeof r.score=="number"?(o.push({...r,score:r.score*c}),d=!0):o.push(r));return d&&o.sort((r,n)=>(n.score??0)-(r.score??0)),o}var c,_,m,u=f((()=>{c=.5,_=30,m=500}));u();export{T as applyFeedbackRerank,E as isFeedbackSuppressed,p as loadFeedbackSignals};
