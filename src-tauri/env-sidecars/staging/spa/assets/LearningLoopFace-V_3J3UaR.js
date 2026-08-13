import{o as G}from"./chunk-ChpBd9eV.js";import{t as O}from"./react-DqHYuLt-.js";import{t as Q}from"./jsx-runtime-BmDUFisN.js";import{r as p}from"./SyncContext-CvBNP3sq.js";import{a as N,c as j}from"./dist-_S1YDkZy.js";import{s as V}from"./types-B6UfiA7g.js";import{t as D}from"./src-CL56NiZm.js";import{a as M}from"./client-DJFg1OvB.js";import{t as $}from"./Tooltip-BRMSMTLQ.js";var B=G(O(),1);D();var e=Q(),K=[{id:"observe",label:"Observe",lview:"signals"},{id:"analyze",label:"Analyze",lview:"pipeline"},{id:"improve",label:"Improve",lview:"improvements"},{id:"retain",label:"Retain",lview:"learnings"},{id:"verify",label:"Verify",lview:"benchmark"}];function le(){const[,S]=j("tab",N),[,z]=j("lview",N),d=M(V.TESTING),f=p({queryName:"learning.releaseReadiness",staleTime:3e4}),L=p({queryName:"learning.gym",staleTime:3e4}),T=p({queryName:"learning.improvements",staleTime:3e4}),F=p({queryName:"learning.retain",staleTime:6e4}),l=f.data?.[0]?.report??null,m=L.data?.[0],v=T.data?.[0],t=F.data?.[0]?.banked,i=r=>{S("learning"),z(r)},n=(0,B.useMemo)(()=>{const r=l?.criteria??[],a=r.find(s=>s.key==="grader-feedback-revised"),u=a?/\/\s*(\d+)\s+graded/.exec(a.observed??"")?.[1]??null:null,_=a?/^(\d+)\s+routed idea/.exec(a.observed??"")?.[1]??null:null,I=l?.window?.routedIdeas??null,R=t&&(t.improvementsFiled7d!=null||t.plansDrafted7d!=null)?(t.improvementsFiled7d??0)+(t.plansDrafted7d??0):null,h=r.map(s=>s.status),k=l?.passed??0,o=u?Number(u):null,g=_?Number(_):null;let b=null,x=null;o!=null&&g!=null&&o>=20&&g/o<.05?(b="improve",x=`grade → typed-revision conversion (${g} of ${o})`):(l?.unknown??0)>0&&(b="verify",x="a readiness bar still lacks evidence");const y=(m?.proposals??[]).filter(s=>s.status==="pending").length,w=v?.humanQueue?.length??0,E=(m?.autoloops??[]).filter(s=>s.enabled||s.status==="running").length,c=[];return(l?.unknown??0)>0&&c.push({text:`Release readiness incomplete — ${k}/${h.length} bars, soak at ${l?.window?.ticks??0} ticks`,lview:"benchmark",tone:"warn"}),d&&y>0&&c.push({text:`${y} gym proposal(s) pending decision`,lview:"gym",tone:"warn"}),w>0&&c.push({text:`${w} backlog item(s) await human review`,lview:"improvements",tone:"dim"}),{routed:I,graded:u,revised:_,kept:R,bars:h,passed:k,verdict:l?.verdict??null,ticks:l?.window?.ticks??null,bottleneck:b,bottleneckNote:x,runningLoops:E,attention:c.slice(0,3)}},[l,m,v,t,d]),q=!l&&!f.error&&f.data===void 0,A=r=>{switch(r){case"observe":return n.routed!=null?String(n.routed):"—";case"analyze":return n.graded??"—";case"improve":return n.revised??"—";case"retain":return n.kept!=null?String(n.kept):"—";case"verify":return n.bars.length>0?`${n.passed}/${n.bars.length}`:"—";default:return"—"}},C=r=>({observe:"signals",analyze:"graded",improve:"revisions",retain:"kept · 7d",verify:"bars"})[r]??"";return(0,e.jsxs)("div",{className:"pc-lf","data-testid":"learning-loop-face",children:[(0,e.jsx)("style",{children:P}),q?(0,e.jsx)("p",{className:"pc-lf__empty",children:"Loading the learning loop…"}):(0,e.jsxs)(e.Fragment,{children:[(0,e.jsxs)("section",{className:"pc-lf__card","aria-label":"Learning loop stages",children:[(0,e.jsxs)("h3",{className:"pc-lf__h",children:["The loop ",(0,e.jsx)("span",{className:"pc-lf__hn",children:"counts · live window"})]}),(0,e.jsx)("div",{className:"pc-lf__loop",children:K.map(r=>(0,e.jsx)($,{label:`Open Learning → ${r.label}`,children:(0,e.jsxs)("button",{type:"button",className:`pc-lf__node${n.bottleneck===r.id?" is-hot":""}`,onClick:()=>i(r.lview),children:[(0,e.jsx)("span",{className:"pc-lf__nk",children:r.label}),(0,e.jsx)("span",{className:"pc-lf__nv",children:A(r.id)}),(0,e.jsx)("span",{className:"pc-lf__ns",children:C(r.id)})]})},r.id))}),n.bottleneckNote?(0,e.jsxs)("p",{className:"pc-lf__note",children:["Bottleneck: ",n.bottleneckNote," —"," ",(0,e.jsxs)("button",{type:"button",className:"pc-lf__link",onClick:()=>i(n.bottleneck==="improve"?"ideas":"benchmark"),children:["open ",n.bottleneck==="improve"?"Ideas":"Verify"]})]}):null]}),(0,e.jsxs)("section",{className:"pc-lf__card pc-lf__card--verify","aria-label":"Release readiness",children:[(0,e.jsxs)("h3",{className:"pc-lf__h",children:["Release readiness"," ",(0,e.jsx)("span",{className:"pc-lf__hn",children:n.verdict??"unreadable"})]}),(0,e.jsx)($,{label:"Open Learning → Verify",children:(0,e.jsx)("button",{type:"button",className:"pc-lf__meterbtn",onClick:()=>i("benchmark"),children:(0,e.jsx)("span",{className:"pc-lf__meter",role:"img","aria-label":`${n.passed} of ${n.bars.length} readiness bars pass`,children:n.bars.map((r,a)=>(0,e.jsx)("span",{className:`pc-lf__seg pc-lf__seg--${r}`},a))})})}),n.ticks!=null?(0,e.jsxs)("p",{className:"pc-lf__note",children:["live window ",(0,e.jsxs)("strong",{children:[n.ticks," tick(s)"]}),d&&n.runningLoops>0?(0,e.jsxs)(e.Fragment,{children:[" · ",n.runningLoops," gym loop(s) armed"]}):null]}):null]}),n.attention.length>0?(0,e.jsxs)("section",{className:"pc-lf__card","aria-label":"Needs attention",children:[(0,e.jsxs)("h3",{className:"pc-lf__h",children:["Needs attention ",(0,e.jsx)("span",{className:"pc-lf__hn",children:n.attention.length})]}),n.attention.map(r=>(0,e.jsx)("button",{type:"button",className:`pc-lf__row pc-lf__row--${r.tone}`,onClick:()=>i(r.lview),children:r.text},r.text))]}):null]})]})}var P=`
.pc-lf { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; }
.pc-lf__empty { color: var(--fg-mute); font-size: 12px; padding: 12px 4px; }
.pc-lf__card {
  border: 1px solid var(--border); border-radius: 10px;
  background: color-mix(in srgb, var(--bg-raised), transparent 40%);
  padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;
}
.pc-lf__card--verify { border-left: 3px solid color-mix(in srgb, #f59e0b, transparent 55%); }
.pc-lf__h {
  display: flex; align-items: baseline; gap: 7px; margin: 0;
  color: var(--fg-dim); font-size: 10px; font-weight: 750; text-transform: uppercase;
}
.pc-lf__hn { margin-left: auto; color: var(--fg-mute); text-transform: none; font-weight: 500; }
.pc-lf__loop { display: flex; align-items: stretch; }
.pc-lf__node {
  flex: 1; min-width: 0; text-align: center; padding: 7px 2px 6px; cursor: pointer;
  border: 1px solid var(--border); background: color-mix(in srgb, var(--bg-raised), transparent 20%);
  color: inherit; display: flex; flex-direction: column; gap: 1px;
}
.pc-lf__node:first-child { border-radius: 9px 0 0 9px; }
.pc-lf__node:last-child { border-radius: 0 9px 9px 0; }
.pc-lf__node + .pc-lf__node { border-left: none; }
.pc-lf__node:hover, .pc-lf__node:focus-visible { background: color-mix(in srgb, var(--bg-raised), transparent 0%); outline: none; }
.pc-lf__node.is-hot { box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.5); }
.pc-lf__node.is-hot .pc-lf__nk { color: #34d399; }
/* letter-spacing stays 0 — nonzero tracking is blocked by the design-primitive
   lint (/internal/docs/design: stable type sizes, letter-spacing: 0). */
.pc-lf__nk { font-size: 9px; text-transform: uppercase; letter-spacing: 0; color: var(--fg-mute); }
.pc-lf__nv { font: 700 15px ui-monospace, monospace; font-variant-numeric: tabular-nums; color: var(--fg); }
.pc-lf__ns { font-size: 9px; color: var(--fg-mute); }
.pc-lf__note { margin: 0; font-size: 10.5px; color: var(--fg-mute); }
.pc-lf__note strong { color: var(--fg-dim); font-weight: 600; }
.pc-lf__link { background: none; border: none; padding: 0; cursor: pointer; color: #34d399; font-size: 10.5px; }
.pc-lf__link:hover, .pc-lf__link:focus-visible { text-decoration: underline; outline: none; }
.pc-lf__meterbtn { background: none; border: none; padding: 0; cursor: pointer; width: 100%; }
.pc-lf__meter { display: flex; gap: 3px; }
.pc-lf__seg { flex: 1; height: 7px; border-radius: 2px; background: rgba(52, 211, 153, 0.75); }
.pc-lf__seg--unknown { background: rgba(245, 158, 11, 0.55); }
.pc-lf__seg--fail { background: rgba(239, 68, 68, 0.7); }
.pc-lf__row {
  display: block; width: 100%; text-align: left; cursor: pointer;
  background: none; border: none; padding: 3px 0; font-size: 11.5px; color: var(--fg-dim);
}
.pc-lf__row:hover, .pc-lf__row:focus-visible { text-decoration: underline; outline: none; }
.pc-lf__row--warn { color: #f59e0b; }
`;export{le as default};
