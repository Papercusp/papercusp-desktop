import{n as d}from"./chunk-ChpBd9eV.js";function a(t,n){return n<=0?{text:"",truncated:t.length>0}:t.length<=n?{text:t,truncated:!1}:n<=14?{text:t.slice(0,n),truncated:!0}:{text:t.slice(0,n-14)+c,truncated:!0}}function p(t,n){const o=n.maxDiffChars??Math.floor(n.maxChars/2),u=n.maxTranscriptCharsPerRole??Math.max(200,Math.floor(n.maxChars/Math.max(1,t.roleTranscripts.length)/2));let r=!1;const s=a(t.diff,o);r||=s.truncated;const f=t.roleTranscripts.map(e=>{const l=a(e.text,u);return r||=l.truncated,`### ${e.role} (${e.runId})
${l.text}`}),i=a([`## Terminal state
${t.terminalState}`,...t.signals?[`## Deterministic signals
${JSON.stringify(t.signals)}`]:[],`## Diff
${s.text}`,`## Role transcripts
${f.join(`

`)}`].join(`

`),n.maxChars);return r||=i.truncated,{text:i.text,truncated:r}}var c,m=d((()=>{c=`
[…truncated…]`}));export{m as n,p as t};
