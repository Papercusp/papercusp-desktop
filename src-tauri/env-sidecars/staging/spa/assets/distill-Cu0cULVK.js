import{n as e}from"./chunk-CMxvf4Kt.js";function t(e,t){return t<=0?{text:``,truncated:e.length>0}:e.length<=t?{text:e,truncated:!1}:t<=14?{text:e.slice(0,t),truncated:!0}:{text:e.slice(0,t-14)+r,truncated:!0}}function n(e,n){let r=n.maxDiffChars??Math.floor(n.maxChars/2),i=n.maxTranscriptCharsPerRole??Math.max(200,Math.floor(n.maxChars/Math.max(1,e.roleTranscripts.length)/2)),a=!1,o=t(e.diff,r);a||=o.truncated;let s=e.roleTranscripts.map(e=>{let n=t(e.text,i);return a||=n.truncated,`### ${e.role} (${e.runId})\n${n.text}`}),c=t([`## Terminal state\n${e.terminalState}`,...e.signals?[`## Deterministic signals\n${JSON.stringify(e.signals)}`]:[],`## Diff\n${o.text}`,`## Role transcripts\n${s.join(`

`)}`].join(`

`),n.maxChars);return a||=c.truncated,{text:c.text,truncated:a}}var r,i=e((()=>{r=`
[…truncated…]`}));export{i as n,n as t};