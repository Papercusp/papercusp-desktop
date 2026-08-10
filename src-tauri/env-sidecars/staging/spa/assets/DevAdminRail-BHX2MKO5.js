const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/FlagsPanel-D27y7KyF.js","assets/FeaturesAdmin-DeELqHtd.js","assets/chunk-ChpBd9eV.js","assets/Tooltip-BRMSMTLQ.js","assets/popper-z-BxIuSxXo.js","assets/react-DqHYuLt-.js","assets/dist-BNchT11-.js","assets/dist-vxruVqnx.js","assets/dist-D96qucXd.js","assets/floating-ui.dom-nqjZdp_l.js","assets/floating-ui.react-dom-ClEe7-4K.js","assets/react-dom-D9qSqTQ3.js","assets/dist-Cx_8XwRT.js","assets/jsx-runtime-BmDUFisN.js","assets/dist-iLte2Yrc.js","assets/dist-Dg4SROk3.js","assets/dist-z_D7CxU9.js","assets/dist-WRy0m0yw.js","assets/dist-D4lcwHCy.js","assets/dist-BcHEo-1L.js","assets/dist-CToubPgS.js","assets/useLexicon-CQ_5wgyT.js","assets/flag-hooks-DIcJ9MK9.js","assets/client-DojwvLiy.js","assets/resilient-event-source-B14Vi28D.js","assets/connectivity-D6GHtMrC.js","assets/src-Dyq8UC1e.js","assets/dist-CREypBH1.js","assets/RunPanel-DhAbOunI.js","assets/AdminOps-Dglku7xC.js","assets/admin-ops-BK1gk78W.js","assets/Checkbox-B2Xs7vTj.js","assets/dist-BVdR_2Sq.js","assets/createLucideIcon-H39hj3ia.js","assets/check-Cdd_-6Wk.js","assets/admin-ops-Bpla0nXZ.css","assets/NotificationsPanel-CEBYf1B8.js","assets/panel-kit-BORSyJfR.js","assets/SyncContext-CvBNP3sq.js","assets/trash-2--jLPfGpH.js","assets/x-DBWzBmCv.js","assets/ServiceHealthPanel-B2w534Rs.js","assets/DeployStatePanel-D2g1J75W.js","assets/DbHealthPanel-emhHl7rC.js","assets/FleetPanel-B-QNWmUv.js","assets/ToolUsagePanel-C0IRXviE.js","assets/dist-_S1YDkZy.js"])))=>i.map(i=>d[i]);
import{o as L}from"./chunk-ChpBd9eV.js";import{t as R}from"./react-DqHYuLt-.js";import{n as T,t as n}from"./preload-helper-CcgcQsTF.js";import{t as C}from"./jsx-runtime-BmDUFisN.js";import{i as o}from"./lazy-with-retry-Bz9r29jN.js";import{c as b,r as I,s as A}from"./dist-_S1YDkZy.js";import{r as w}from"./browser-workspace-C1KcM1u4.js";import{n as O}from"./navigation-BWlRNEIQ.js";import{t as F}from"./chromeless-routes-BPPttLC7.js";import{t as W}from"./activity-Du5DJJIS.js";import{t as H}from"./bell-D6lEYAGt.js";import{n as M,r as V,t as U}from"./rocket-D490Vuhr.js";import{t as q}from"./chevron-left-DsDOhVcL.js";import{t as u}from"./chevron-right-9tmkchzc.js";import{t as B}from"./flag-Bj4Z3ry1.js";import{t as _}from"./flask-conical-CjB7y8cu.js";import{t as K}from"./terminal-CbHNKNay.js";import{t as $}from"./users-CrMqOZRG.js";import{t as X}from"./useLexicon-CQ_5wgyT.js";var t=L(R(),1),G=`/*
 * Dev admin rail — chrome styles (plan dev-admin-sidebar-2026-06-05).
 *
 * A collapsible, dev-only right rail. DOCKED like the left op-chat sidebar: it
 * reserves layout space (body.has-dev-rail padding-right + the --dev-rail-w var)
 * so the app shifts left instead of the rail floating over content, and it stays
 * present as a thin expand-rail when collapsed (never a disappearing tab). The
 * width is drag-resizable from the left edge. Tokens mirror the proven
 * FeaturesAdmin palette (var(--bg-*), var(--accent-*)) so it reads as part of the
 * app's dark glassy theme. Everything is prefixed pcdar.
 */

.pcdar {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 1300; /* same layer as the op-chat sidebar; below sonner toasts */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bg-1, #0a1422), transparent 2%),
    color-mix(in srgb, var(--bg-deep, #060d18), transparent 0%)
  );
  border-left: 1px solid color-mix(in srgb, var(--accent-strong, #38bdf8), transparent 78%);
  box-shadow: -18px 0 48px rgba(0, 0, 0, 0.42);
  /* width is set inline (collapsed rail vs expanded panel, drag-resizable) */
}

/* Expanded shell — header + accordion. Hidden when collapsed (and its panels
   are unmounted in the TSX) so an inactive panel's SSE/queries never run. */
.pcdar__expanded-shell {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.pcdar[data-collapsed="true"] .pcdar__expanded-shell {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

/* Collapsed: a thin full-height rail with a vertical "Dev" affordance that
   re-expands it — mirrors the op-chat sidebar's collapsed expand-rail, so the
   rail is always docked and never disappears. */
.pcdar__expand-rail {
  position: relative;
  z-index: 3;
  display: none;
  width: 100%;
  height: 100%;
  padding: 12px 6px 10px;
  border: 0;
  background: transparent;
  color: inherit;
  align-items: center;
  justify-content: flex-start;
  flex-direction: column;
  gap: 12px;
  cursor: pointer;
}
.pcdar[data-collapsed="true"] .pcdar__expand-rail {
  display: flex;
}
.pcdar__expand-orb {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--accent-strong, #38bdf8), transparent 76%);
  background:
    radial-gradient(circle at 35% 25%, rgba(255, 255, 255, 0.16), transparent 24%),
    color-mix(in srgb, var(--accent, #57d7ff), transparent 88%);
  color: var(--accent-strong, var(--accent-soft));
}
.pcdar__expand-label {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 760;
  color: color-mix(in srgb, var(--fg), transparent 14%);
}
.pcdar__expand-chevron {
  width: 16px;
  height: 16px;
  color: var(--accent-soft);
}
.pcdar__expand-rail:hover {
  background: color-mix(in srgb, var(--bg-1, #0a1422), transparent 2%);
}
.pcdar__expand-rail:hover .pcdar__expand-orb {
  border-color: color-mix(in srgb, var(--accent), transparent 50%);
  color: var(--fg);
}
.pcdar__expand-rail:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-strong, #38bdf8), transparent 18%);
  outline-offset: -3px;
}

/* Drag-to-resize handle on the LEFT edge (the rail is docked on the right). */
.pcdar__resize-handle {
  position: absolute;
  top: 0;
  left: -3px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
  z-index: 4;
  touch-action: none;
}
.pcdar__resize-handle:hover {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent-strong, #38bdf8), transparent 78%),
    transparent
  );
}
.pcdar[data-collapsed="true"] .pcdar__resize-handle {
  display: none;
}

/* Body reservation — the app shifts left by the rail's width so it docks
   (pushes content) instead of floating over it, mirroring the op-chat
   sidebar's left padding. This header-width rule is injected after the
   op-chat one, so on equal specificity it wins when both sidebars are
   present; each var defaults to 0px so the two sides compose independently. */
body.has-dev-rail {
  padding-right: var(--dev-rail-w, 48px);
}
body.has-dev-rail .pc-header {
  width: calc(100vw - var(--op-chat-w, 0px) - var(--dev-rail-w, 0px) - var(--left-sidebar-w, 0px));
}

/* Header */
.pcdar__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--accent-strong, #38bdf8), transparent 84%);
  background: color-mix(in srgb, var(--bg-deep, #060d18), transparent 6%);
}
.pcdar__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 760;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--fg), transparent 18%);
}
.pcdar__title-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent), transparent 84%);
  color: var(--accent-soft);
  font-size: 9px;
}
.pcdar__spacer {
  flex: 1;
}
.pcdar__iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--accent-strong, #38bdf8), transparent 84%);
  background: rgba(255, 255, 255, 0.03);
  color: color-mix(in srgb, var(--fg), transparent 22%);
  cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.pcdar__iconbtn:hover {
  background: rgba(12, 24, 38, 0.96);
  border-color: color-mix(in srgb, var(--accent), transparent 60%);
  color: var(--fg);
}

/* Accordion */
.pcdar__acc {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pcdar__sec {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--accent-strong, #38bdf8), transparent 88%);
}
.pcdar__sec.is-active {
  flex: 1;
  min-height: 0;
}
.pcdar__sec-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  background: transparent;
  color: color-mix(in srgb, var(--fg), transparent 26%);
  font-size: 12px;
  font-weight: 650;
  text-align: left;
  cursor: pointer;
  transition: background 120ms, color 120ms;
}
.pcdar__sec-head:hover {
  background: color-mix(in srgb, var(--bg-1, #0a1422), transparent 2%);
  color: var(--fg);
}
.pcdar__sec.is-active > .pcdar__sec-head {
  color: var(--fg);
  background: color-mix(in srgb, var(--bg-raised, #0e1c30), transparent 2%);
}
.pcdar__sec-icon {
  display: inline-flex;
  color: var(--accent, #57d7ff);
  opacity: 0.85;
}
.pcdar__sec-label {
  flex: 1;
}
.pcdar__sec-count {
  padding: 0 7px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
  color: color-mix(in srgb, var(--fg), transparent 18%);
  font-size: 10px;
  font-weight: 700;
}
.pcdar__sec-count.is-bad {
  background: rgba(248, 113, 113, 0.2);
  color: #fca5a5;
}
.pcdar__sec-count.is-good {
  background: rgba(34, 197, 94, 0.18);
  color: #86efac;
}
.pcdar__sec-chevron {
  display: inline-flex;
  color: rgba(148, 163, 184, 0.7);
  transition: transform 140ms;
}
.pcdar__sec.is-active .pcdar__sec-chevron {
  transform: rotate(90deg);
}
.pcdar__sec-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 0 8px;
}

/* Shared panel primitives (glance panels P-004..P-008) */
.pcdar-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px 14px;
}
.pcdar-panel__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.pcdar-panel__bar-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  color: rgba(148, 163, 184, 0.78);
}
.pcdar-panel__bar-spacer {
  flex: 1;
}
.pcdar-panel__refresh {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--accent-strong, #38bdf8), transparent 82%);
  background: rgba(255, 255, 255, 0.03);
  color: color-mix(in srgb, var(--fg), transparent 20%);
  font-size: 11px;
  cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.pcdar-panel__refresh:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent), transparent 60%);
  color: var(--fg);
}
.pcdar-panel__refresh:disabled {
  opacity: 0.55;
  cursor: progress;
}
.pcdar-panel__refresh.is-spinning svg {
  animation: pcdar-spin 0.8s linear infinite;
}
@keyframes pcdar-spin {
  to {
    transform: rotate(360deg);
  }
}
.pcdar-panel__empty {
  padding: 14px 4px;
  color: rgba(148, 163, 184, 0.74);
  font-size: 12px;
  text-align: center;
}
.pcdar-panel__error {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(248, 113, 113, 0.32);
  background: rgba(248, 113, 113, 0.08);
  color: #fda4af;
  font-size: 12px;
  line-height: 1.5;
}

/* Rows / cards inside glance panels */
.pcdar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--accent-strong, #38bdf8), transparent 88%);
  background: color-mix(in srgb, var(--bg-deep, #060d18), transparent 12%);
}
.pcdar-row + .pcdar-row {
  margin-top: 6px;
}
.pcdar-row__main {
  flex: 1;
  min-width: 0;
}
.pcdar-row__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pcdar-row__sub {
  margin-top: 2px;
  font-size: 11px;
  color: color-mix(in srgb, var(--fg), transparent 30%);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pcdar-dot {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.6);
}
.pcdar-dot.is-up {
  background: #4ade80;
  box-shadow: 0 0 7px rgba(74, 222, 128, 0.7);
}
.pcdar-dot.is-down {
  background: #f87171;
  box-shadow: 0 0 7px rgba(248, 113, 113, 0.7);
}
.pcdar-dot.is-absent {
  background: rgba(148, 163, 184, 0.5);
}
.pcdar-pill {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  background: rgba(148, 163, 184, 0.18);
  color: color-mix(in srgb, var(--fg), transparent 18%);
}
.pcdar-pill.is-good {
  background: rgba(34, 197, 94, 0.18);
  color: #86efac;
}
.pcdar-pill.is-bad {
  background: rgba(248, 113, 113, 0.2);
  color: #fca5a5;
}
.pcdar-pill.is-warn {
  background: rgba(251, 191, 36, 0.18);
  color: #fcd34d;
}

/* Key/value grid used by deploy + db panels */
.pcdar-kv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: 12px;
  padding: 2px 2px 4px;
}
.pcdar-kv__k {
  color: rgba(148, 163, 184, 0.78);
}
.pcdar-kv__v {
  color: var(--fg);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The reused full-page panels (Flags/Run) get a scroll container so their own
   max-width:auto layout fits the narrow rail. */
.pcdar-embed {
  /* Override the embedded surfaces' page paddings so they fit the 384px rail. */
}
.pcdar-embed .fa-shell,
.pcdar-embed .pc-ops-shell {
  max-width: 100%;
  padding: 8px 12px 16px;
  margin: 0;
}
.pcdar-embed .fa-presets {
  grid-template-columns: 1fr;
}
.pcdar-embed .pc-ops-grid {
  grid-template-columns: 1fr;
}
`,e=C();T();var Q=o(()=>n(()=>import("./FlagsPanel-D27y7KyF.js"),__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27]))),Y=o(()=>n(()=>import("./RunPanel-DhAbOunI.js"),__vite__mapDeps([28,29,2,30,31,7,12,13,5,20,15,32,16,33,34,11,3,4,6,8,9,10,14,17,18,19,24,35]))),J=o(()=>n(()=>import("./NotificationsPanel-CEBYf1B8.js"),__vite__mapDeps([36,2,37,33,5,13,3,4,6,7,8,9,10,11,12,14,15,16,17,18,19,20,38,39,40]))),Z=o(()=>n(()=>import("./ServiceHealthPanel-B2w534Rs.js"),__vite__mapDeps([41,37,33,2,5,13,38]))),ee=o(()=>n(()=>import("./DeployStatePanel-D2g1J75W.js"),__vite__mapDeps([42,37,33,2,5,13,38]))),re=o(()=>n(()=>import("./DbHealthPanel-emhHl7rC.js"),__vite__mapDeps([43,37,33,2,5,13,38]))),ae=o(()=>n(()=>import("./FleetPanel-B-QNWmUv.js"),__vite__mapDeps([44,2,37,33,5,13,21,22,23,24,25,26,38]))),te=o(()=>n(()=>import("./ToolUsagePanel-C0IRXviE.js"),__vite__mapDeps([45,37,33,2,5,13,38,46]))),y=[{id:"flags",label:"Feature flags",icon:B,render:()=>(0,e.jsx)(Q,{})},{id:"run",label:"Run",icon:K,render:()=>(0,e.jsx)(Y,{})},{id:"notifications",label:"Notifications / errors",icon:H,render:r=>(0,e.jsx)(J,{active:r})},{id:"health",label:"Service health",icon:W,render:r=>(0,e.jsx)(Z,{active:r})},{id:"deploy",label:"Deploy / release gate",icon:U,render:r=>(0,e.jsx)(ee,{active:r})},{id:"db",label:"DB health",icon:M,render:r=>(0,e.jsx)(re,{active:r})},{id:"fleet",label:"Fleet / coord",icon:$,render:r=>(0,e.jsx)(ae,{active:r})},{id:"usage",label:"Tool usage",icon:V,render:r=>(0,e.jsx)(te,{active:r})}],ie=y.map(r=>r.id),v=48,k=300,s=384,j="papercusp.devRail.width";function ne(r){return Math.max(k,Math.floor(r*.6))}function m(r,i){return Number.isFinite(r)?Math.max(k,Math.min(ne(i),r)):s}function oe(){if(typeof window>"u")return s;try{const r=window.localStorage.getItem(w(j));return r?m(Number(r),window.innerWidth):s}catch{return s}}function ze(){const r=X(),[i,h]=b("devRail",I.withDefault(!1)),[E,z]=b("devSec",A(ie).withDefault("flags")),p=F(O()??""),[c,g]=(0,t.useState)(s),[d,D]=(0,t.useState)(!1);(0,t.useEffect)(()=>{g(oe()),D(!0)},[]),(0,t.useEffect)(()=>{if(!d)return;if(p){document.body.classList.remove("has-dev-rail"),document.body.classList.remove("dev-rail-collapsed"),document.documentElement.style.removeProperty("--dev-rail-w");return}const a=i?c:v;document.documentElement.style.setProperty("--dev-rail-w",`${a}px`),document.body.classList.add("has-dev-rail"),document.body.classList.toggle("dev-rail-collapsed",!i);try{window.localStorage.setItem(w(j),String(c))}catch{}},[i,c,d,p]),(0,t.useEffect)(()=>{if(!d)return;const a=()=>g(l=>m(l,window.innerWidth));return window.addEventListener("resize",a),()=>window.removeEventListener("resize",a)},[d]),(0,t.useEffect)(()=>()=>{try{document.body.classList.remove("has-dev-rail"),document.body.classList.remove("dev-rail-collapsed"),document.documentElement.style.removeProperty("--dev-rail-w")}catch{}},[]);const x=(0,t.useRef)(!1),P=(0,t.useCallback)(a=>{x.current=!0,a.target.setPointerCapture?.(a.pointerId),document.body.style.userSelect="none",document.body.style.cursor="col-resize"},[]),S=(0,t.useCallback)(a=>{x.current&&g(m(window.innerWidth-a.clientX,window.innerWidth))},[]),f=(0,t.useCallback)(a=>{x.current=!1,a.target.releasePointerCapture?.(a.pointerId),document.body.style.userSelect="",document.body.style.cursor=""},[]);return p?null:(0,e.jsxs)(e.Fragment,{children:[(0,e.jsx)("style",{children:G}),(0,e.jsxs)("aside",{className:"pcdar","data-testid":"dev-admin-rail","data-collapsed":i?"false":"true",style:{width:i?d?c:s:v},"aria-label":"Dev admin rail",children:[(0,e.jsxs)("button",{type:"button",className:"pcdar__expand-rail","data-testid":"dev-admin-rail-handle",onClick:()=>h(!0),"aria-hidden":i,"aria-label":"Open dev admin rail",children:[(0,e.jsx)("span",{className:"pcdar__expand-orb","aria-hidden":"true",children:(0,e.jsx)(_,{size:18})}),(0,e.jsx)("span",{className:"pcdar__expand-label",children:"Dev"}),(0,e.jsx)(q,{className:"pcdar__expand-chevron","aria-hidden":"true"})]}),(0,e.jsx)("div",{className:"pcdar__expanded-shell","aria-hidden":!i,children:i&&(0,e.jsxs)(e.Fragment,{children:[(0,e.jsxs)("div",{className:"pcdar__header",children:[(0,e.jsxs)("span",{className:"pcdar__title",children:[(0,e.jsx)(_,{size:14,"aria-hidden":"true"}),"Dev admin",(0,e.jsx)("span",{className:"pcdar__title-badge",children:"DEV"})]}),(0,e.jsx)("span",{className:"pcdar__spacer"}),(0,e.jsx)("button",{type:"button",className:"pcdar__iconbtn",onClick:()=>h(!1),"aria-label":"Close dev admin rail",children:(0,e.jsx)(u,{size:16,"aria-hidden":"true"})})]}),(0,e.jsx)("div",{className:"pcdar__acc",children:y.map(a=>{const l=a.id===E,N=a.icon;return(0,e.jsxs)("div",{className:`pcdar__sec${l?" is-active":""}`,children:[(0,e.jsxs)("button",{type:"button",className:"pcdar__sec-head","data-testid":`dev-rail-sec-${a.id}`,"aria-expanded":l,onClick:()=>z(a.id),children:[(0,e.jsx)("span",{className:"pcdar__sec-icon",children:(0,e.jsx)(N,{size:15,"aria-hidden":"true"})}),(0,e.jsx)("span",{className:"pcdar__sec-label",children:a.id==="fleet"?`${r("fleet")} / coord`:a.label}),(0,e.jsx)("span",{className:"pcdar__sec-chevron",children:(0,e.jsx)(u,{size:15,"aria-hidden":"true"})})]}),l&&(0,e.jsx)("div",{className:"pcdar__sec-body",children:(0,e.jsx)(t.Suspense,{fallback:(0,e.jsx)("div",{className:"pcdar-panel__empty",children:"Loading…"}),children:a.render(!0)})})]},a.id)})})]})}),(0,e.jsx)("div",{className:"pcdar__resize-handle",role:"separator","aria-orientation":"vertical","aria-label":"Resize dev admin rail",onPointerDown:P,onPointerMove:S,onPointerUp:f,onPointerCancel:f})]})]})}export{ze as default};
