const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/__vite-browser-external-CGWw7gYu.js","assets/__vite-browser-external-56mrcCg8.js","assets/chunk-ChpBd9eV.js"])))=>i.map(i=>d[i]);
import{n as c,o as f}from"./chunk-ChpBd9eV.js";import{n as M,t as $}from"./preload-helper-CcgcQsTF.js";import{st as l,t as D}from"./src-BmBNODK0.js";import{t as w}from"./__vite-browser-external-56mrcCg8.js";import{c as k,r as d}from"./workspace-registry-Du2UbhlH.js";import{i as v,n as F}from"./registry-Cnc_D-jn.js";import{t as G}from"./src-ottnhtWZ.js";async function U(a,s=d()){const{sql:e}=l(),r=await e`
    SELECT payload FROM harness_shared.operator_gym_gates
     WHERE workspace_id = ${s} AND harness_slug = ${a} LIMIT 1
  `;return{..._,...r[0]?.payload??{}}}async function b(a,s,e=d()){const r={...await U(a,e),...s},{sql:n}=l();return await n`
    INSERT INTO harness_shared.operator_gym_gates (workspace_id, harness_slug, payload, updated_at)
    VALUES (${e}, ${a}, ${JSON.stringify(r)}::text::jsonb, ${Date.now()})
    ON CONFLICT (workspace_id, harness_slug) DO UPDATE
      SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
  `,r}async function y(a=d()){const{sql:s}=l();return(await s`
    SELECT harness_slug, payload FROM harness_shared.operator_gym_gates
     WHERE workspace_id = ${a} ORDER BY harness_slug
  `).map(e=>({harnessSlug:e.harness_slug,gates:e.payload??{}}))}async function T(a=d()){const{sql:s}=l();await s`DELETE FROM harness_shared.operator_gym_gates WHERE workspace_id = ${a}`}var _,V=c((()=>{D(),k(),F(),_={epsilon:.1,delta:.5,costCeiling:3},v({name:"gym-gates",description:"per-harness gym promotion gates (epsilon / delta / costCeiling)",auditAction:"gym:set-gates",diff:async()=>{const a=await y(),s=[];for(const{harnessSlug:e,gates:r}of a)for(const n of Object.keys(_))r[n]!==void 0&&r[n]!==_[n]&&s.push({key:`${e}.${n}`,effective:r[n],default:_[n],layer:"pg-settings"});return s},capture:()=>y(),reset:()=>T(),restore:async a=>{const s=a??[];await T();for(const{harnessSlug:e,gates:r}of s)await b(e,r)}})}));async function x(a){const{createHash:s}=await $(async()=>{const{createHash:e}=await import("./__vite-browser-external-CGWw7gYu.js").then(r=>f(r.default,1));return{createHash:e}},__vite__mapDeps([0,1,2]));return s("sha256").update(a).digest("hex")}function H(a){return a.includes("per-harness-template")||O.has(a)}async function z({client:a,sqlDir:s,log:e=()=>{},skipFile:r,beforeApply:n,continueOnError:A=!1}){const I=r??H,m=[];await a.unsafe(L);const p=(await(0,u.readdir)(s)).filter(t=>t.endsWith(".sql")).filter(t=>!I(t)).sort(),R=await a.unsafe("SELECT filename FROM harness_shared.schema_migrations"),g=new Set((R??[]).map(t=>t.filename)),h=p.reduce((t,o)=>g.has(o)?t:t+1,0)>=20;h&&await a.unsafe("SET synchronous_commit = off").catch(()=>{});let E=0;for(const t of p){if(g.has(t))continue;const o=await(0,u.readFile)((0,S.join)(s,t),"utf8"),C=o.split(`
`).filter(i=>!/^\s*\\[a-z]/i.test(i)).join(`
`),N=await x(o);e(`apply ${t}`);try{await n?.(t,o),await a.unsafe(`BEGIN;
SET LOCAL statement_timeout = 0;
${C};
INSERT INTO harness_shared.schema_migrations (filename, sha256) VALUES ('${t.replace(/'/g,"''")}', '${N}');
COMMIT;`),E++}catch(i){if(await a.unsafe("ROLLBACK").catch(()=>{}),A){e(`FAILED ${t}: ${i?.message??i}`),m.push({file:t,error:String(i?.message??i)});continue}throw i}}return h&&(await a.unsafe("SET synchronous_commit = on").catch(()=>{}),await a.unsafe("CHECKPOINT").catch(()=>{})),{appliedCount:E,totalKnown:p.length,failed:m}}var u,S,L,O,J=c((()=>{u=f(w(),1),S=f(w(),1),M(),L=`
  CREATE SCHEMA IF NOT EXISTS harness_shared;
  CREATE TABLE IF NOT EXISTS harness_shared.schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sha256 TEXT NOT NULL
  );
`,O=new Set(["040-plugin-configs-backfill.sql","__seed_restored__.marker"])})),Z=c((()=>{G()}));function Q(a){return{diff:a.diff,roleTranscripts:a.runOutputs.map(s=>({role:s.role,runId:s.runId,text:s.outBody})),terminalState:a.terminalState,...a.signals?{signals:a.signals}:{}}}var aa=c((()=>{}));export{H as a,U as c,z as i,b as l,aa as n,J as o,Z as r,V as s,Q as t};
