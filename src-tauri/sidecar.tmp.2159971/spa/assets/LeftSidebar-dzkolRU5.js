const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/SwarmTab-ziIcmUSg.js","assets/chunk-CMxvf4Kt.js","assets/useLexicon-Dp7lEXPY.js","assets/client-Bt8lfgly.js","assets/types-HiMWUb5q.js","assets/resilient-event-source-DB8lSvOI.js","assets/react-C1Wm8aMI.js","assets/SyncContext-DIxztLg9.js","assets/dist-1aQumieq.js","assets/jsx-runtime-sLPvdpSW.js","assets/VoiceTab-DATcLTQp.js","assets/use-create-data-CLsao0r4.js","assets/operator-voice-audio-FZa4WNZQ.js","assets/hotkeys-JSrCpBjh.js","assets/browser-workspace-AWq1Xprv.js","assets/profile-pref-BX83HuOO.js","assets/use-create-data-HsnoWA2r.css","assets/settings-2-BBMEXL_R.js","assets/createLucideIcon-Bq4a7IPy.js","assets/client-navigation-D39d93QA.js","assets/HivesTab-CFJmMZ1l.js"])))=>i.map(i=>d[i]);
import{o as e}from"./chunk-CMxvf4Kt.js";import{t}from"./react-C1Wm8aMI.js";import{n,t as r}from"./preload-helper-B_k_wMTD.js";import{t as i}from"./jsx-runtime-sLPvdpSW.js";import{r as a,t as o}from"./users-CIw34qxv.js";import{c as s,n as c,o as l}from"./dist-1aQumieq.js";import{r as u}from"./browser-workspace-AWq1Xprv.js";import{t as d}from"./useLexicon-Dp7lEXPY.js";import{t as f}from"./createLucideIcon-Bq4a7IPy.js";import{t as p}from"./chevron-left-DP1TdhHw.js";import{t as m}from"./chevron-right-OQ6shWOP.js";import{t as h}from"./network-DRmzCv9-.js";var g=f(`audio-lines`,[[`path`,{d:`M2 10v3`,key:`1fnikh`}],[`path`,{d:`M6 6v11`,key:`11sgs0`}],[`path`,{d:`M10 3v18`,key:`yhl04a`}],[`path`,{d:`M14 8v7`,key:`3a1oy3`}],[`path`,{d:`M18 5v13`,key:`123xd1`}],[`path`,{d:`M22 10v3`,key:`154ddg`}]]),_=e(t(),1),v=`
.pclsb {
  --pclsb-current-accent: var(--accent, #38bdf8);
  position: fixed;
  top: 0;
  left: var(--op-chat-w, 0px); /* dock AFTER the op-chat sidebar */
  bottom: 0;
  z-index: 1290; /* just under the op-chat sidebar / dev rail layer */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    linear-gradient(90deg, color-mix(in oklab, var(--accent), transparent 94%), transparent 38%),
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--bg-1, #0b1220), transparent 1%),
      color-mix(in srgb, var(--bg-deep, #050d18), transparent 0%)
    );
  border-right: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
  box-shadow: 14px 0 38px rgba(0, 0, 0, 0.28);
}
.pclsb[data-tab="swarm"] {
  --pclsb-current-accent: var(--good, #4ade80);
}
.pclsb[data-tab="voice"] {
  --pclsb-current-accent: var(--accent, #38bdf8);
}
.pclsb[data-tab="hives"] {
  --pclsb-current-accent: var(--warn, #fbbf24);
}

/* Body reservation — the app shifts right by op-chat + this rail. This rule
   composes with (and must win over) the op-chat-only reservation; both default
   missing vars to 0px so the sides stay independent. */
body.has-left-sidebar {
  padding-left: calc(var(--op-chat-w, 0px) + var(--left-sidebar-w, 48px));
}
body.has-left-sidebar .pc-header {
  width: calc(100vw - var(--op-chat-w, 0px) - var(--left-sidebar-w, 0px) - var(--dev-rail-w, 0px));
}

/* Expanded shell — tab strip + active panel. Hidden when collapsed (panels
   are unmounted in the TSX) so an inactive tab's queries never run. */
.pclsb__expanded-shell {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.pclsb[data-collapsed="true"] .pclsb__expanded-shell {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

/* Collapsed: a thin full-height rail with the three tab icons — clicking one
   expands straight into that tab. */
.pclsb__expand-rail {
  position: relative;
  z-index: 3;
  display: none;
  width: 100%;
  height: 100%;
  padding: 12px 6px 10px;
  align-items: center;
  flex-direction: column;
  gap: 10px;
}
.pclsb[data-collapsed="true"] .pclsb__expand-rail {
  display: flex;
}
.pclsb__rail-btn {
  --pclsb-tab-accent: var(--accent, #38bdf8);
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--pclsb-tab-accent), transparent 68%);
  background: color-mix(in oklab, var(--pclsb-tab-accent), transparent 92%);
  color: color-mix(in oklab, var(--pclsb-tab-accent), var(--fg, #e7f7ff) 38%);
  cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.pclsb__rail-btn:hover {
  border-color: color-mix(in oklab, var(--pclsb-tab-accent), transparent 34%);
  background: color-mix(in oklab, var(--pclsb-tab-accent), transparent 82%);
  color: var(--fg, #e7f7ff);
}
.pclsb__rail-btn:focus-visible {
  outline: 1px solid color-mix(in oklab, var(--pclsb-tab-accent), transparent 18%);
  outline-offset: -2px;
}
.pclsb__rail-btn--swarm,
.pclsb__tab--swarm {
  --pclsb-tab-accent: var(--good, #4ade80);
}
.pclsb__rail-btn--voice,
.pclsb__tab--voice,
.pclsb__rail-btn--expand {
  --pclsb-tab-accent: var(--accent, #38bdf8);
}
.pclsb__rail-btn--hives,
.pclsb__tab--hives {
  --pclsb-tab-accent: var(--warn, #fbbf24);
}

/* Header */
.pclsb__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
  background: color-mix(in srgb, var(--bg-deep, #050d18), transparent 4%);
}
.pclsb__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-dim, #b9d4e8);
}
.pclsb__title svg {
  color: var(--pclsb-current-accent);
}
.pclsb__spacer {
  flex: 1;
}
.pclsb__iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
  background: var(--bg-2, rgba(255, 255, 255, 0.045));
  color: var(--fg-dim, #b9d4e8);
  cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.pclsb__iconbtn:hover {
  background: var(--bg-3, rgba(255, 255, 255, 0.075));
  border-color: var(--border-strong, color-mix(in srgb, var(--accent-strong), transparent 68%));
  color: var(--fg, #e7f7ff);
}

/* Tab strip — the Swarm / Voice / Hives switcher (mirrors the pui main pane). */
.pclsb__tabs {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
}
.pclsb__tab {
  --pclsb-tab-accent: var(--accent, #38bdf8);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  min-height: 34px;
  padding: 6px 8px;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--pclsb-tab-accent), transparent 72%);
  background: color-mix(in oklab, var(--pclsb-tab-accent), transparent 94%);
  color: var(--fg-dim, #b9d4e8);
  font-size: 12px;
  font-weight: 720;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.pclsb__tab:hover {
  border-color: color-mix(in oklab, var(--pclsb-tab-accent), transparent 40%);
  background: color-mix(in oklab, var(--pclsb-tab-accent), transparent 86%);
  color: var(--fg, #e7f7ff);
}
.pclsb__tab.is-active {
  border-color: color-mix(in oklab, var(--pclsb-tab-accent), transparent 24%);
  background: color-mix(in oklab, var(--pclsb-tab-accent), transparent 76%);
  color: var(--fg, #e7f7ff);
}
.pclsb__tab-icon {
  display: inline-flex;
  color: currentColor;
  opacity: 0.92;
}

/* Active panel body */
.pclsb__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 0 10px;
}

/* Drag-to-resize handle on the RIGHT edge (the rail is docked on the left). */
.pclsb__resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
  z-index: 4;
  touch-action: none;
}
.pclsb__resize-handle:hover {
  background: linear-gradient(
    270deg,
    color-mix(in srgb, var(--accent-strong, #38bdf8), transparent 78%),
    transparent
  );
}
.pclsb[data-collapsed="true"] .pclsb__resize-handle {
  display: none;
}

/* Panel primitives — shared by the three tabs (mirrors pcdar-panel). */
.pclsb-panel {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px 10px 12px;
}
.pclsb-panel__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.pclsb-panel__bar-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fg-mute, #7f9bb4);
}
.pclsb-panel__bar-spacer {
  flex: 1;
}
.pclsb-panel__empty {
  padding: 14px 10px;
  border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-1, #0b1220), transparent 36%);
  color: var(--fg-mute, #7f9bb4);
  font-size: 12px;
  text-align: center;
  line-height: 1.6;
}
.pclsb-panel__error {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--bad, #f87171), transparent 64%);
  background: color-mix(in oklab, var(--bad, #f87171), transparent 91%);
  color: color-mix(in oklab, var(--bad, #f87171), var(--fg, #e7f7ff) 32%);
  font-size: 12px;
  line-height: 1.5;
}
.pclsb-chipbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 26px;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
  background: var(--bg-2, rgba(255, 255, 255, 0.045));
  color: var(--fg-dim, #b9d4e8);
  font-size: 11px;
  font-weight: 680;
  cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.pclsb-chipbtn:hover {
  border-color: var(--border-strong, color-mix(in srgb, var(--accent-strong), transparent 68%));
  background: var(--bg-3, rgba(255, 255, 255, 0.075));
  color: var(--fg, #e7f7ff);
}
.pclsb-chipbtn.is-on {
  background: color-mix(in oklab, var(--pclsb-current-accent), transparent 84%);
  border-color: color-mix(in oklab, var(--pclsb-current-accent), transparent 48%);
  color: var(--fg, #e7f7ff);
}

/* Rows (agents / hives / tasks / mail) */
.pclsb-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 11px;
  border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
  background: color-mix(in srgb, var(--bg-1, #0b1220), transparent 28%);
  cursor: default;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.pclsb-row + .pclsb-row {
  margin-top: 5px;
}
.pclsb-row.is-clickable {
  cursor: pointer;
}
.pclsb-row.is-clickable:hover {
  border-color: color-mix(in oklab, var(--pclsb-current-accent), transparent 58%);
  background: color-mix(in oklab, var(--pclsb-current-accent), transparent 92%);
}
.pclsb-row.is-selected {
  border-color: color-mix(in oklab, var(--pclsb-current-accent), transparent 36%);
  background: color-mix(in oklab, var(--pclsb-current-accent), transparent 86%);
  box-shadow: inset 3px 0 0 var(--pclsb-current-accent);
}
.pclsb-row__main {
  flex: 1;
  min-width: 0;
}
.pclsb-row__title {
  font-size: 13px;
  font-weight: 680;
  color: var(--fg, #e7f7ff);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pclsb-row__sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--fg-mute, #7f9bb4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pclsb-dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--fg-mute, #7f9bb4);
}
.pclsb-dot.is-up {
  background: var(--good, #4ade80);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--good, #4ade80), transparent 82%);
}
.pclsb-dot.is-down {
  background: var(--bad, #f87171);
}
.pclsb-pill {
  flex: 0 0 auto;
  padding: 2px 7px;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: var(--bg-3, rgba(255, 255, 255, 0.075));
  color: var(--fg-dim, #b9d4e8);
}

/* Section headers inside a tab (task list / plan progress / comms). */
.pclsb-sec {
  margin-top: 9px;
  padding: 8px;
  border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-1, #0b1220), transparent 44%);
}
.pclsb-sec__head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fg-mute, #7f9bb4);
  padding: 0 1px 7px;
}
.pclsb-task {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 4px 5px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--fg-dim, #b9d4e8);
}
.pclsb-task:hover {
  background: var(--bg-2, rgba(255, 255, 255, 0.045));
}
.pclsb-task__rank {
  flex: 0 0 34px;
  color: var(--fg-mute, #7f9bb4);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}
.pclsb-task__title {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pclsb-task__st {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--fg-mute, #7f9bb4);
}

/* Plan progress bars */
.pclsb-plan {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 5px;
  border-radius: 8px;
  font-size: 12px;
}
.pclsb-plan:hover {
  background: var(--bg-2, rgba(255, 255, 255, 0.045));
}
.pclsb-plan__slug {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--fg-dim, #b9d4e8);
}
.pclsb-plan__bar {
  flex: 0 0 90px;
  height: 6px;
  border-radius: 999px;
  background: var(--bg-3, rgba(255, 255, 255, 0.075));
  overflow: hidden;
}
.pclsb-plan__fill {
  height: 100%;
  border-radius: 999px;
  background: var(--pclsb-current-accent);
}
.pclsb-plan__nums {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--fg-mute, #7f9bb4);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* Mail / conversation lines (comms view) */
.pclsb-mail {
  padding: 6px 7px;
  border-radius: 9px;
  font-size: 12px;
  color: var(--fg-dim, #b9d4e8);
  background: var(--bg-2, rgba(255, 255, 255, 0.045));
}
.pclsb-mail__meta {
  font-size: 10px;
  color: var(--fg-mute, #7f9bb4);
}

/* The Voice tab's video region wants the full panel height. */
.pclsb-voice {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.pclsb-voice__bar {
  padding: 8px 10px 2px;
}
.pclsb-voice__channels {
  margin: 6px 10px 8px;
  border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-1, #0b1220), transparent 34%);
  overflow: hidden;
}
.pclsb-voice__grid {
  flex: 1;
  min-height: 220px;
  margin: 0 10px 10px;
  border: 1px solid var(--border, color-mix(in srgb, var(--accent-strong), transparent 85%));
  border-radius: 12px;
  background: var(--bg-deep, #050d18);
  overflow: hidden;
}
.pclsb-voice__empty {
  margin: 10px;
  padding: 18px 14px;
}
`,y=i();n();var b=(0,_.lazy)(()=>r(()=>import(`./SwarmTab-ziIcmUSg.js`),__vite__mapDeps([0,1,2,3,4,5,6,7,8,9]))),x=(0,_.lazy)(()=>r(()=>import(`./VoiceTab-DATcLTQp.js`),__vite__mapDeps([10,11,1,12,13,6,14,15,7,8,9,16,3,4,5,17,18,19]))),S=(0,_.lazy)(()=>r(()=>import(`./HivesTab-CFJmMZ1l.js`),__vite__mapDeps([20,1,7,6,9]))),C=[{id:`swarm`,label:`Swarm`,icon:o,render:e=>(0,y.jsx)(b,{active:e})},{id:`voice`,label:`Peers`,icon:g,render:e=>(0,y.jsx)(x,{active:e})},{id:`hives`,label:`Hives`,icon:h,render:e=>(0,y.jsx)(S,{active:e})}],w=C.map(e=>e.id),T=48,E=300,D=384,O=`papercusp.leftSidebar.width`,k=[`/pi`,`/project-docs`,`/el-min`];function A(e){return Math.max(E,Math.floor(e*.5))}function j(e,t){return Number.isFinite(e)?Math.max(E,Math.min(A(t),e)):D}function M(){if(typeof window>`u`)return D;try{let e=window.localStorage.getItem(u(O));return e?j(Number(e),window.innerWidth):D}catch{return D}}function N(){let e=d(),[{lsb:t,lst:n},r]=s({lsb:c.withDefault(!0),lst:l(w).withDefault(`swarm`)}),i=e=>void r({lsb:e}),o=e=>void r({lst:e}),f=a()??``,h=k.some(e=>f===e||f.startsWith(`${e}/`)),[g,b]=(0,_.useState)(D),[x,S]=(0,_.useState)(!1);(0,_.useEffect)(()=>{b(M()),S(!0)},[]),(0,_.useEffect)(()=>{if(!x)return;if(h){document.body.classList.remove(`has-left-sidebar`),document.documentElement.style.removeProperty(`--left-sidebar-w`);return}let e=t?g:T;document.documentElement.style.setProperty(`--left-sidebar-w`,`${e}px`),document.body.classList.add(`has-left-sidebar`);try{window.localStorage.setItem(u(O),String(g))}catch{}},[t,g,x,h]),(0,_.useEffect)(()=>{if(!x)return;let e=()=>b(e=>j(e,window.innerWidth));return window.addEventListener(`resize`,e),()=>window.removeEventListener(`resize`,e)},[x]),(0,_.useEffect)(()=>()=>{try{document.body.classList.remove(`has-left-sidebar`),document.documentElement.style.removeProperty(`--left-sidebar-w`)}catch{}},[]);let E=(0,_.useRef)(!1),A=()=>{let e=getComputedStyle(document.documentElement).getPropertyValue(`--op-chat-w`),t=Number.parseFloat(e);return Number.isFinite(t)?t:0},N=(0,_.useCallback)(e=>{E.current=!0,e.target.setPointerCapture?.(e.pointerId),document.body.style.userSelect=`none`,document.body.style.cursor=`col-resize`},[]),P=(0,_.useCallback)(e=>{E.current&&b(j(e.clientX-A(),window.innerWidth))},[]),F=(0,_.useCallback)(e=>{E.current=!1,e.target.releasePointerCapture?.(e.pointerId),document.body.style.userSelect=``,document.body.style.cursor=``},[]);if(h)return null;let I=t?x?g:D:T,L=C.find(e=>e.id===n)??C[0];return(0,y.jsxs)(y.Fragment,{children:[(0,y.jsx)(`style`,{children:v}),(0,y.jsxs)(`aside`,{className:`pclsb`,"data-testid":`left-sidebar`,"data-collapsed":t?`false`:`true`,"data-tab":L.id,style:{width:I},"aria-label":`Swarm sidebar`,children:[(0,y.jsxs)(`div`,{className:`pclsb__expand-rail`,"aria-hidden":t,children:[C.map(e=>{let t=e.icon;return(0,y.jsx)(`button`,{type:`button`,className:`pclsb__rail-btn pclsb__rail-btn--${e.id}`,"data-testid":`left-sidebar-rail-${e.id}`,"aria-label":`Open ${e.label}`,onClick:()=>void r({lsb:!0,lst:e.id}),children:(0,y.jsx)(t,{size:17,"aria-hidden":`true`})},e.id)}),(0,y.jsx)(`button`,{type:`button`,className:`pclsb__rail-btn pclsb__rail-btn--expand`,onClick:()=>i(!0),"aria-label":`Open sidebar`,children:(0,y.jsx)(m,{size:16,"aria-hidden":`true`})})]}),(0,y.jsx)(`div`,{className:`pclsb__expanded-shell`,"aria-hidden":!t,children:t&&(0,y.jsxs)(y.Fragment,{children:[(0,y.jsxs)(`div`,{className:`pclsb__header`,children:[(0,y.jsxs)(`span`,{className:`pclsb__title`,children:[(0,y.jsx)(L.icon,{size:14,"aria-hidden":`true`}),L.id===`swarm`?e(`fleet`):L.label]}),(0,y.jsx)(`span`,{className:`pclsb__spacer`}),(0,y.jsx)(`button`,{type:`button`,className:`pclsb__iconbtn`,onClick:()=>i(!1),"aria-label":`Collapse sidebar`,children:(0,y.jsx)(p,{size:16,"aria-hidden":`true`})})]}),(0,y.jsx)(`div`,{className:`pclsb__tabs`,role:`tablist`,children:C.map(t=>{let r=t.icon,i=t.id===n;return(0,y.jsxs)(`button`,{type:`button`,role:`tab`,"aria-selected":i,className:`pclsb__tab pclsb__tab--${t.id}${i?` is-active`:``}`,"data-testid":`left-sidebar-tab-${t.id}`,onClick:()=>o(t.id),children:[(0,y.jsx)(`span`,{className:`pclsb__tab-icon`,children:(0,y.jsx)(r,{size:14,"aria-hidden":`true`})}),t.id===`swarm`?e(`fleet`):t.label]},t.id)})}),(0,y.jsx)(`div`,{className:`pclsb__body`,children:(0,y.jsx)(_.Suspense,{fallback:(0,y.jsx)(`div`,{className:`pclsb-panel__empty`,children:`Loading…`}),children:L.render(!0)})})]})}),(0,y.jsx)(`div`,{className:`pclsb__resize-handle`,role:`separator`,"aria-orientation":`vertical`,"aria-label":`Resize sidebar`,onPointerDown:N,onPointerMove:P,onPointerUp:F,onPointerCancel:F})]})]})}export{N as default};