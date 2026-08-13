import{n as R,o as T}from"./chunk-ChpBd9eV.js";import{F as L,T as N,t as y}from"./drizzle-orm-BbO4Lkx2.js";import{An as D,st as u,t as O}from"./src-BmBNODK0.js";import{t as C}from"./__vite-browser-external-56mrcCg8.js";import{a as M,i as $}from"./sync-sse-BKE__mMM.js";function d(){return l.__completionRefBackoff??=new Map,l.__completionRefBackoff}function m(e,t){return`${e}\0${t}`}function S(e){return Math.min(w*Math.pow(2,e-1),v)}function W(e,t){const r=d().get(m(e,t));return r?Date.now()<r.nextCheckAt:!1}function F(e,t){const r=m(e,t),i=d().get(r),n=(i?.consecutiveErrors??0)+1,o={consecutiveErrors:n,nextCheckAt:Date.now()+S(n),toastedAt:i?.toastedAt??null};return d().set(r,o),o}function b(e,t){d().delete(m(e,t))}async function U(e,t,r,i){try{const n=D,{db:o}=u(),c=2e3;await o.insert(n).values({level:"warning",message:`Completion ref verification failing — ${t}`,description:`git ls-remote has failed ${i} consecutive times for ${e}/${t}. Last error: ${r}. Check git credentials and the remote URL on the feature's completion_ref.`,harnessSlug:e,createdAt:Date.now(),actionLabel:null,actionHref:null}),(async()=>{const a=await o.select({id:n.id}).from(n).orderBy(N(n.createdAt)).offset(c);a.length>0&&await o.delete(n).where(L(n.id,a.map(s=>s.id)))})().catch(()=>{}),M("toastLog.recent",void 0).catch(()=>{})}catch{}}function H(e,t){for(const r of e.split(`
`)){const i=r.trim();if(i&&i.startsWith(t))return{kind:"found",sha:t}}return{kind:"not_found"}}function I(e){return e.kind==="found"?"verified":e.kind==="not_found"?"divergent":"error"}async function P(e,t=u){const{sql:r}=t();return r`
    SELECT feature_id, completion_ref
      FROM harness_shared.harness_features_consolidated
     WHERE harness_slug = ${e}
       AND completion_ref IS NOT NULL
       AND (
         status = 'pending_done'
         OR (status = 'shipped' AND COALESCE(updated_ts, 0) > ${Date.now()-p})
       )
  `}async function B(e,t,r,i=u){const{sql:n}=i();if(r==="verified"){await n`
      UPDATE harness_shared.harness_features_consolidated
         SET verified_done_at_remote_ts = NOW(),
             verifier_last_error = NULL,
             verifier_last_checked_at = NOW()
       WHERE harness_slug = ${e}
         AND feature_id = ${t}
    `;return}if(r==="divergent"){await n`
      UPDATE harness_shared.harness_features_consolidated
         SET verifier_last_error = 'sha_not_found',
             verifier_last_checked_at = NOW()
       WHERE harness_slug = ${e}
         AND feature_id = ${t}
    `;return}await n`
    UPDATE harness_shared.harness_features_consolidated
       SET verifier_last_checked_at = NOW()
     WHERE harness_slug = ${e}
       AND feature_id = ${t}
  `}async function V(e,t){const r=await P(e);let i=0,n=0,o=0;for(const c of r){const{feature_id:a}=c;if(W(e,a)){o+=1;continue}const s=await t(c.completion_ref.remote,c.completion_ref.commit_sha),f=I(s);if(await B(e,a,f),f==="verified"||f==="divergent")b(e,a),f==="verified"?i+=1:n+=1;else{const k=s.kind==="error"?s.reason:"unknown",_=F(e,a);o+=1,_.consecutiveErrors>=A&&_.toastedAt===null&&(_.toastedAt=Date.now(),U(e,a,k,_.consecutiveErrors))}}return{harnessSlug:e,checked:r.length,verified:i,divergent:n,errors:o}}async function x(){const{sql:e}=u();return(await e`
    SELECT DISTINCT harness_slug
      FROM harness_shared.harness_features_consolidated
     WHERE completion_ref IS NOT NULL
       AND (
         status = 'pending_done'
         OR (status = 'shipped' AND COALESCE(updated_ts, 0) > ${Date.now()-p})
       )
  `).map(t=>t.harness_slug)}async function ee(e=g){const t=await x();for(const r of t)await V(r,e)}var E,h,w,p,v,A,l,g,q=R((()=>{E=T(C(),1),O(),y(),$(),h=1e4,w=6e4,p=1440*60*1e3,v=300*1e3,A=5,l=globalThis,g=(e,t,r={})=>new Promise(i=>{const n=r.timeoutMs??h,o=(0,E.spawn)("git",["ls-remote",e,t],{stdio:["ignore","pipe","pipe"],timeout:n});let c="",a="";o.stdout.on("data",s=>{c+=s.toString()}),o.stderr.on("data",s=>{a+=s.toString()}),o.on("error",s=>{i({kind:"error",reason:s.message})}),o.on("close",(s,f)=>{if(f!==null){i({kind:"error",reason:"signal "+f});return}if(s!==0){i({kind:"error",reason:a.trim()||"exit "+String(s)});return}i(H(c,t))})})}));q();export{ee as runCompletionRefVerifierOnce};
