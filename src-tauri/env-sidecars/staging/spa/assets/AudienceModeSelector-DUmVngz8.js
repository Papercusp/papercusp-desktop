import{o as e}from"./chunk-CMxvf4Kt.js";import{t}from"./react-C1Wm8aMI.js";import{t as n}from"./jsx-runtime-sLPvdpSW.js";import{n as r}from"./dist-CcY72VL8.js";import{r as i}from"./browser-workspace-AWq1Xprv.js";import{f as a,o,r as s,s as c,u as l}from"./operator-converse-tags-1YrC8WRe.js";import{A as u,D as d,E as f,O as p,T as m,_ as h,b as g,c as _,g as v,i as y,l as b,o as x,s as S,y as C}from"./voice-mode-DDfd1Nhu.js";import{n as w,r as T,t as E}from"./voice-prefs-client-ChHNX-ZQ.js";import{t as D}from"./client-navigation-BoYYDNfI.js";import{t as O}from"./Tooltip-S0_1wvLs.js";import{t as k}from"./useLexicon-jlwU3ZkW.js";import{t as ee}from"./settings-2-BBMEXL_R.js";var A=e(t());s();var j=n(),M=`papercusp:operatorMode`,N=`papercusp:operatorSleep`;function P(){let[e,t]=(0,A.useState)(`active`);return(0,A.useEffect)(()=>{let e=o()??`active`;t(e),l(e);let n=e=>{let n=e.detail;(n?.mode===`active`||n?.mode===`passive`)&&t(n.mode)};return window.addEventListener(M,n),()=>window.removeEventListener(M,n)},[]),[e,(0,A.useCallback)(e=>{if(l(e),e===`active`){a(0);try{window.dispatchEvent(new Event(N))}catch{}}t(e);try{window.dispatchEvent(new CustomEvent(M,{detail:{mode:e}}))}catch{}},[])]}function F(){let[e,t]=(0,A.useState)(0);return(0,A.useEffect)(()=>{let e=()=>t(c());e(),window.addEventListener(N,e);let n=setInterval(e,5e3);return()=>{window.removeEventListener(N,e),clearInterval(n)}},[]),e}var I=`papercusp:operatorSub`;function L(){let[e,t]=(0,A.useState)(`ready`);return(0,A.useEffect)(()=>{let e=e=>{let n=e.detail;typeof n?.sub==`string`&&t(n.sub)};return window.addEventListener(I,e),()=>window.removeEventListener(I,e)},[]),e}function R(){let[e,t]=(0,A.useState)(!1);return(0,A.useEffect)(()=>{if(typeof fetch!=`function`)return;let e=!1;return fetch(`/api/agent-mcp/operator-voice-prefs`).then(e=>e.ok?e.json():null).then(n=>{let r=n?.silenceVoice;!e&&typeof r==`boolean`&&t(r)}).catch(()=>{}),()=>{e=!0}},[]),[e,(0,A.useCallback)(e=>{t(e),typeof fetch==`function`&&fetch(`/api/user/preferences`,{method:`PATCH`,headers:{"content-type":`application/json`},body:JSON.stringify({silenceVoice:e})}).catch(()=>{})},[])]}function z(){let[e,t]=P(),[n,r]=R(),i=F(),o=L(),s=k()(`operator`),c=n,l=!c&&e===`active`,u=i>0?i-Date.now():0,d=l&&u>0,f=l&&!d&&o===`quiet_wait`,p=(0,A.useCallback)(()=>{if(c){r(!1),t(`active`);return}if(d){a(0);try{window.dispatchEvent(new Event(N))}catch{}return}if(!f){if(l){t(`passive`);return}r(!0)}},[c,l,d,f,t,r]),m=d?u<6e4?`${Math.max(1,Math.ceil(u/1e3))}s`:`${Math.ceil(u/6e4)}m`:``,h=c?`off`:d?`sleeping`:f?`quiet`:l?`active`:`passive`,g=c?`Off`:d?`Sleeping ${m}`:f?`Quiet`:l?`Active`:`Passive`,_=c?`${s} is off — voice muted. Click to turn on (active).`:d?`${s} sleeping for ${m}. Click to wake.`:f?`${s} is quiet — type to pick up where you left off.`:l?`${s} interaction mode: active. Click to set passive.`:`${s} interaction mode: passive. Click to turn off.`,v=c?`${s} is off — ${s} voice is muted. Click to turn it back on.`:d?`${s} went quiet for ${m} (via <sleep> tag). Click to wake immediately.`:f?`${s} went silent after the silence ladder ran out. Type to wake it.`:l?`${s} is active — speaks proactively. Click to make passive.`:`${s} is passive — only responds when spoken to. Click to turn it off (mute).`,y=c||d||f?`static`:l?`pulsing`:`static`;return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`style`,{children:B}),(0,j.jsx)(O,{label:v,children:(0,j.jsxs)(`button`,{type:`button`,onClick:p,className:`op-active-toggle op-active-toggle--${h}`,"aria-label":_,children:[(0,j.jsx)(`span`,{className:`op-active-toggle-dot op-active-toggle-dot--${y}`,"aria-hidden":`true`}),(0,j.jsx)(`span`,{className:`op-active-toggle-label`,children:g})]})})]})}var B=`
.op-active-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 80%));
  color: var(--fg-mute, #94a3b8);
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}
.op-active-toggle:hover {
  background: color-mix(in srgb, var(--accent-strong), transparent 90%);
  color: var(--fg, #e7eef7);
}
.op-active-toggle--active {
  background: color-mix(in srgb, var(--accent), transparent 86%);
  border-color: color-mix(in srgb, var(--accent), transparent 50%);
  color: var(--accent-strong, #7dd3fc);
}
.op-active-toggle--passive {
  /* default look */
}
.op-active-toggle--sleeping {
  background: rgba(148, 163, 184, 0.10);
  border-color: rgba(148, 163, 184, 0.40);
  color: var(--fg-mute, #94a3b8);
  font-style: italic;
}
.op-active-toggle--quiet {
  background: rgba(148, 163, 184, 0.06);
  border-color: rgba(148, 163, 184, 0.30);
  color: var(--fg-mute, #94a3b8);
  cursor: default;
}
.op-active-toggle--off {
  background: rgba(148, 163, 184, 0.10);
  border-color: rgba(148, 163, 184, 0.40);
  color: var(--fg-mute, #94a3b8);
}

.op-active-toggle-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: currentColor;
}
.op-active-toggle-dot--pulsing {
  animation: op-active-pulse 1.25s ease-in-out infinite;
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent), transparent 40%);
}
@keyframes op-active-pulse {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent), transparent 45%); transform: scale(1); }
  60%  { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent), transparent 100%);  transform: scale(1.06); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent), transparent 100%);    transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .op-active-toggle-dot--pulsing { animation: none; }
}
`,V=.08,H=.04;function U(e,t,n){let r=(0,A.useRef)(null),i=(0,A.useRef)(null),a=(0,A.useRef)(null),o=(0,A.useRef)(null);return(0,A.useEffect)(()=>{if(r.current&&r.current.style.setProperty(`--mic-level`,`0`),!e||typeof window>`u`||!navigator.mediaDevices?.getUserMedia)return;let s=!1;return(async()=>{try{let e=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:!0,noiseSuppression:!0,channelCount:1}});if(s){e.getTracks().forEach(e=>e.stop());return}n?.(null),o.current=e;let c=window.AudioContext||window.webkitAudioContext;if(!c)return;let l=new c;if(a.current=l,l.state===`suspended`)try{await l.resume()}catch{}if(s){e.getTracks().forEach(e=>e.stop());try{await l.close()}catch{}return}let u=l.createMediaStreamSource(e),d=l.createAnalyser();d.fftSize=512,d.smoothingTimeConstant=.4,u.connect(d);let f=new Uint8Array(d.fftSize),p=0,m=-1,h=!1,g=e=>{if(e-p>=50){p=e,d.getByteTimeDomainData(f);let n=0;for(let e=0;e<f.length;e++){let t=(f[e]-128)/128;n+=t*t}let i=Math.sqrt(n/f.length),a=Math.min(1,Math.max(0,(i-.02)*6));Math.abs(a-m)>=.01&&(m=a,r.current&&r.current.style.setProperty(`--mic-level`,a.toFixed(2))),!h&&a>=V?(h=!0,t?.(!0)):h&&a<=H&&(h=!1,t?.(!1))}i.current=requestAnimationFrame(g)};i.current=requestAnimationFrame(g)}catch(e){s||n?.(e)}})(),()=>{s=!0,i.current&&cancelAnimationFrame(i.current),i.current=null;try{a.current?.close()}catch{}a.current=null,o.current?.getTracks().forEach(e=>e.stop()),o.current=null,r.current&&r.current.style.setProperty(`--mic-level`,`0`),t?.(!1)}},[e,t,n]),{ref:r}}var W={off:`🚫`,connecting:`⏳`,idle:`🎤`,listening:`🔴`,speaking:`🔊`,paused:`⏸`},te={off:`push-to-talk`,"push-to-talk":`always-on`,"always-on":`off`},ne={off:`Off`,"push-to-talk":`PTT`,"always-on":`On`},G={off:`off`,"push-to-talk":`push-to-talk`,"always-on":`always-on`},K=`pc-voice-wake-hint-seen-v1`,q=`pc-voice-ptt-hint-seen-v1`,J=`Backquote`,Y="`",re=`/settings/setup-wizard?step=os-permissions`;function ie(e){return e instanceof Element?!!e.closest(`.cm-editor, .monaco-editor, .xterm, .xterm-screen`):!1}function X({label:e}){return(0,j.jsx)(`span`,{className:`pc-voice-spinner`,role:`status`,"aria-label":e})}function ae({hearing:e}){return(0,j.jsxs)(`span`,{className:`pc-voice-listening${e?` is-hearing`:``}`,role:`status`,"aria-label":e?`Hearing you`:`Listening`,children:[(0,j.jsx)(`i`,{}),(0,j.jsx)(`i`,{}),(0,j.jsx)(`i`,{})]})}function oe(){return(0,j.jsx)(`span`,{className:`pc-voice-speaking`,role:`status`,"aria-label":`Speaking`})}function se(){return(0,j.jsxs)(`span`,{className:`pc-voice-thinking`,role:`status`,"aria-label":`Thinking`,children:[(0,j.jsx)(`i`,{}),(0,j.jsx)(`i`,{}),(0,j.jsx)(`i`,{})]})}function Z(){let[e,t]=(0,A.useState)(()=>_()),[n,a]=(0,A.useState)(()=>x()),[o,s]=(0,A.useState)(()=>S().wakeWord),[c,l]=(0,A.useState)(()=>typeof window>`u`?!1:window.localStorage.getItem(i(K))===`1`),[w,T]=(0,A.useState)(()=>typeof window>`u`?!1:window.localStorage.getItem(i(q))===`1`),[E,k]=(0,A.useState)(!1);(0,A.useEffect)(()=>(b(),d(t)),[]),(0,A.useEffect)(()=>{let e=()=>a(x());e();let t=()=>e();return window.addEventListener(`papercusp:operatorVoiceSessionStateChanged`,t),()=>{window.removeEventListener(`papercusp:operatorVoiceSessionStateChanged`,t)}},[]),(0,A.useEffect)(()=>{let e=e=>{let t=e.detail;if(t?.message){if(t.phase===`no-audio`){r.error(t.message,{action:{label:`Mic permissions`,onClick:()=>D(re)}});return}r.warning(t.message)}};return window.addEventListener(`papercusp:voiceTimeout`,e),()=>window.removeEventListener(`papercusp:voiceTimeout`,e)},[]),(0,A.useEffect)(()=>{let e=()=>s(S().wakeWord);return e(),window.addEventListener(`pc-voice-config-changed`,e),window.addEventListener(`focus`,e),()=>{window.removeEventListener(`pc-voice-config-changed`,e),window.removeEventListener(`focus`,e)}},[]);let M=(0,A.useCallback)(()=>{if(!c&&(l(!0),typeof window<`u`))try{window.localStorage.setItem(i(K),`1`)}catch{}},[c]),N=(0,A.useCallback)(()=>{if(!w&&(T(!0),typeof window<`u`))try{window.localStorage.setItem(i(q),`1`)}catch{}},[w]),P=n.active&&n.mode===`push-to-talk`,F=(0,A.useCallback)(()=>{if(!e.supported){r.error(`Voice mode is not available in this environment.`);return}e.mode===`always-on`&&M(),g(te[e.mode])},[M,e.mode,e.supported]),I=(0,A.useRef)(null),L=(0,A.useCallback)(()=>{e.supported&&(I.current&&clearTimeout(I.current),I.current=setTimeout(()=>{I.current=null,k(!0),P?C(!0):m()},250))},[P,e.supported]),R=(0,A.useCallback)(()=>{if(I.current){clearTimeout(I.current),I.current=null;return}E&&(k(!1),P?C(!1):f())},[P,E]);(0,A.useEffect)(()=>{if(!e.supported)return;let t=e=>{e.code===J&&(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey||ie(e.target)||(e.preventDefault(),!e.repeat&&(N(),!E&&(k(!0),P?C(!0):m()))))},n=e=>{e.code===J&&E&&(e.preventDefault(),k(!1),P?C(!1):f())},r=()=>{E&&(k(!1),P?C(!1):f())};return window.addEventListener(`keydown`,t),window.addEventListener(`keyup`,n),window.addEventListener(`blur`,r),()=>{window.removeEventListener(`keydown`,t),window.removeEventListener(`keyup`,n),window.removeEventListener(`blur`,r)}},[P,N,E,e.supported]);let z=e.mode===`always-on`||e.status===`listening`||E,{ref:B}=U((E||z&&!e.micOwnedByFullAgent)&&e.status!==`connecting`,v,h),V;V=e.supported?e.status===`speaking`?(0,j.jsx)(oe,{}):e.awaitingResponse?(0,j.jsx)(se,{}):e.processingTranscript?(0,j.jsx)(X,{label:`Processing`}):E||e.audioReceiving?(0,j.jsx)(ae,{hearing:e.audioReceiving}):e.status===`connecting`?(0,j.jsx)(X,{label:`Connecting`}):(0,j.jsx)(`span`,{className:`pc-voice-btn-label`,children:ne[e.mode]}):(0,j.jsx)(`span`,{className:`pc-voice-btn-label`,children:`No mic`});let H=e.status===`connecting`?`Voice mode: connecting to agent (waiting for WebRTC negotiation)…`:e.supported?n.active?`Voice mode: ${G[e.mode]} (shared session live; hold button or ${Y} for PTT, use mute/mode/host controls alongside)`:`Voice mode: ${G[e.mode]} (click to cycle, hold button for PTT, hold ${Y} for keyboard PTT)`:`Voice mode unsupported in this browser`,Z=e.status===`connecting`&&e.supported,Q=!Z&&e.mode===`always-on`&&e.supported,$=!Z&&e.mode===`push-to-talk`&&e.supported;return(0,j.jsxs)(`div`,{className:`pc-voice-control${Q||$?` has-wake-hint`:``}${Z?` is-connecting`:``}`,children:[(0,j.jsx)(O,{label:H,children:(0,j.jsxs)(`button`,{type:`button`,"aria-label":`Voice mode`,onClick:F,onMouseDown:L,onMouseUp:R,onMouseLeave:R,onTouchStart:L,onTouchEnd:R,ref:B,className:`pc-voice-btn pc-voice-btn--mode-${e.mode} pc-voice-btn--status-${e.status}${E?` is-held`:``}${e.supported?``:` is-unsupported`}${z?` is-mic-active`:``}${e.wakeDetected?` is-wake-detected`:``}${e.userSpoke?` is-user-spoke`:``}${e.audioReceiving?` is-receiving-audio`:``}${e.processingTranscript?` is-processing-transcript`:``}${e.awaitingResponse?` is-awaiting-response`:``}`,children:[(0,j.jsxs)(`span`,{className:`pc-voice-btn-orb`,"aria-hidden":`true`,children:[(0,j.jsx)(`span`,{className:`pc-voice-btn-level`,"aria-hidden":`true`}),(0,j.jsx)(`span`,{className:`pc-voice-btn-icon`,children:W[e.status]})]}),V]})}),(0,j.jsx)(O,{label:`Open microphone settings`,children:(0,j.jsx)(`a`,{href:`/settings/voice`,className:`pc-voice-settings-link`,"aria-label":`Microphone settings`,onClick:e=>{e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||(e.preventDefault(),D(`/settings/voice`))},children:(0,j.jsx)(ee,{size:14,"aria-hidden":`true`})})}),n.active&&(0,j.jsxs)(`div`,{className:`pc-voice-session-controls`,"aria-label":`Shared voice session controls`,children:[(0,j.jsx)(`button`,{type:`button`,className:`pc-voice-session-btn${n.muted?` is-active`:``}`,"aria-pressed":n.muted,"aria-label":n.muted?`Unmute shared voice session`:`Mute shared voice session`,onClick:()=>{u()},children:n.muted?`Muted`:`Mute`}),(0,j.jsx)(`button`,{type:`button`,className:`pc-voice-session-btn${n.mode===`always-on`?` is-active`:``}`,"aria-pressed":n.mode===`always-on`,"aria-label":`Shared voice mode: ${n.mode===`push-to-talk`?`push-to-talk`:`always-on`}. Toggle mode.`,onClick:()=>{p()},children:n.mode===`push-to-talk`?`PTT`:`Live`}),(0,j.jsx)(`button`,{type:`button`,className:`pc-voice-session-btn`,"aria-label":n.elected?`This surface is already the shared voice host/player`:`Force this surface to become the shared voice host/player`,disabled:n.elected,onClick:()=>{n.elected||y()},children:n.elected?`Host`:`Take host`})]}),(Q||$)&&(0,j.jsx)(`div`,{className:`pc-voice-wake-hint`,"aria-live":`polite`,children:Q?(0,j.jsxs)(j.Fragment,{children:[`Say `,(0,j.jsx)(`strong`,{children:o})]}):(0,j.jsxs)(j.Fragment,{children:[`Hold `,(0,j.jsx)(`strong`,{children:Y}),` to talk`]})})]})}var Q=`pc:audienceMode`;async function $(e){try{localStorage.setItem(i(Q),e)}catch{}let t=await fetch(`/api/agent-mcp/operator-voice-prefs`,{method:`PUT`,headers:{"content-type":`application/json`},body:JSON.stringify({audienceMode:e})});t.ok&&w(await t.json())}function ce(){let[e,t]=(0,A.useState)(`engineer`);(0,A.useEffect)(()=>{t(E().audienceMode??`engineer`);let e=T(e=>{t(e.audienceMode??`engineer`)}),n=e=>{e.key===i(Q)&&(e.newValue===`engineer`||e.newValue===`novice`)&&t(e.newValue)};return window.addEventListener(`storage`,n),()=>{e(),window.removeEventListener(`storage`,n)}},[]);let n=(0,A.useCallback)(e=>{t(e),$(e)},[]);return(0,j.jsxs)(j.Fragment,{children:[(0,j.jsx)(`style`,{children:le}),(0,j.jsxs)(`div`,{className:`audience-mode-selector`,role:`group`,"aria-label":`Audience mode`,children:[(0,j.jsx)(O,{label:`Engineer mode — peer-level, terse, full technical vocabulary`,children:(0,j.jsx)(`button`,{type:`button`,className:`audience-mode-btn${e===`engineer`?` audience-mode-btn--active`:``}`,onClick:()=>n(`engineer`),"aria-pressed":e===`engineer`,children:`Engineer`})}),(0,j.jsx)(O,{label:`Novice mode — plain language, outcome-first, no implementation questions`,children:(0,j.jsx)(`button`,{type:`button`,className:`audience-mode-btn${e===`novice`?` audience-mode-btn--active`:``}`,onClick:()=>n(`novice`),"aria-pressed":e===`novice`,children:`Novice`})})]})]})}var le=`
.audience-mode-selector {
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 80%));
  overflow: hidden;
  flex-shrink: 0;
}
.audience-mode-btn {
  flex: 1;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: uppercase;
  background: transparent;
  border: none;
  color: var(--fg-mute, #94a3b8);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
  white-space: nowrap;
}
.audience-mode-btn + .audience-mode-btn {
  border-left: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 80%));
}
.audience-mode-btn:hover {
  background: color-mix(in srgb, var(--accent-strong), transparent 92%);
  color: var(--fg, #e7eef7);
}
.audience-mode-btn--active {
  background: color-mix(in srgb, var(--accent), transparent 86%);
  color: var(--accent-strong, #7dd3fc);
}
`;export{Z as n,z as r,ce as t};