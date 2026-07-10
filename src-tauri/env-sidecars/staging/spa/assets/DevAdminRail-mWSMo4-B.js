const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/FlagsPanel-8fAW83gE.js","assets/FeaturesAdmin-DAvUpiTg.js","assets/chunk-CMxvf4Kt.js","assets/Tooltip-S0_1wvLs.js","assets/dist-BrzqRNj-.js","assets/dist-B4wxxJiO.js","assets/jsx-runtime-sLPvdpSW.js","assets/react-C1Wm8aMI.js","assets/dist-C490YNA1.js","assets/floating-ui.dom-QqGooS2M.js","assets/floating-ui.react-dom-BIOSk68C.js","assets/react-dom-BuIDZ5lO.js","assets/dist-DcEM2-0c.js","assets/dist-DjuwZ1SG.js","assets/dist-BKCunpUL.js","assets/dist-BZoeKGjL.js","assets/dist-UHt178v3.js","assets/dist-D3otlzQf.js","assets/dist-CqXMC7U4.js","assets/useLexicon-BAWW3P3Y.js","assets/flag-hooks-CIwT1w8a.js","assets/client-DTK4ipLo.js","assets/types-lEAL9ctp.js","assets/src-9yZgxa51.js","assets/src-BIeYfY9a.js","assets/dist-CcY72VL8.js","assets/RunPanel-DvHE4UpB.js","assets/AdminOps-GF-HeHUN.js","assets/admin-ops-CXPSC8FR.js","assets/Checkbox-BkLEBQYk.js","assets/dist-DNw7FQHt.js","assets/createLucideIcon-Bq4a7IPy.js","assets/check-7QUJyo7o.js","assets/admin-ops-Cmxs1d2Y.css","assets/NotificationsPanel-jZT7rHbg.js","assets/panel-kit-C-tljzYd.js","assets/SyncContext-DIxztLg9.js","assets/trash-2-G27QP56o.js","assets/x-BrjI5Ev0.js","assets/ServiceHealthPanel-uAxqCfWh.js","assets/DeployStatePanel-JoH1bPK-.js","assets/DbHealthPanel-BajznuMn.js","assets/FleetPanel-Dlxf5qKt.js","assets/ToolUsagePanel-BLoGtKIF.js","assets/dist-C9QKTU6c.js"])))=>i.map(i=>d[i]);
import{o as e}from"./chunk-CMxvf4Kt.js";import{t}from"./react-C1Wm8aMI.js";import{n,t as r}from"./preload-helper-B_k_wMTD.js";import{t as i}from"./jsx-runtime-sLPvdpSW.js";import{r as a}from"./lazy-with-retry-BZKTvSlQ.js";import{c as o,r as s,s as c}from"./dist-C9QKTU6c.js";import{r as l}from"./browser-workspace-AWq1Xprv.js";import{n as u}from"./navigation-BFvZbmCH.js";import{t as d}from"./useLexicon-BAWW3P3Y.js";import{t as f}from"./createLucideIcon-Bq4a7IPy.js";import{t as p}from"./activity-C2IYXILf.js";import{t as m}from"./bell-Biee7ydQ.js";import{n as h,r as g,t as _}from"./database-DK03FPEO.js";import{t as v}from"./chevron-right-OQ6shWOP.js";import{t as y}from"./flag-_m6wOXuw.js";import{t as b}from"./flask-conical-BHQuDwvK.js";import{t as x}from"./terminal-tB3ZQtkm.js";import{t as S}from"./users-B-_AM97H.js";var C=f(`rocket`,[[`path`,{d:`M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5`,key:`qeys4`}],[`path`,{d:`M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09`,key:`u4xsad`}],[`path`,{d:`M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z`,key:`676m9`}],[`path`,{d:`M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05`,key:`92ym6u`}]]),w=e(t(),1),T=`/*
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
   (pushes content) instead of floating over it. Each var defaults to 0px so
   the left rail and this one compose independently. */
body.has-dev-rail {
  padding-right: var(--dev-rail-w, 48px);
}
body.has-dev-rail .pc-header {
  width: calc(100vw - var(--dev-rail-w, 0px) - var(--left-sidebar-w, 0px));
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
`,E=i();n();var D=a(()=>r(()=>import(`./FlagsPanel-8fAW83gE.js`),__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25]))),O=a(()=>r(()=>import(`./RunPanel-DvHE4UpB.js`),__vite__mapDeps([26,27,2,28,29,5,6,7,18,13,30,14,31,32,11,3,4,8,9,10,12,15,16,17,23,33]))),k=a(()=>r(()=>import(`./NotificationsPanel-jZT7rHbg.js`),__vite__mapDeps([34,2,35,31,7,6,3,4,5,8,9,10,11,12,13,14,15,16,17,18,36,37,38]))),A=a(()=>r(()=>import(`./ServiceHealthPanel-uAxqCfWh.js`),__vite__mapDeps([39,35,31,2,7,6,36]))),j=a(()=>r(()=>import(`./DeployStatePanel-JoH1bPK-.js`),__vite__mapDeps([40,35,31,2,7,6,36]))),M=a(()=>r(()=>import(`./DbHealthPanel-BajznuMn.js`),__vite__mapDeps([41,35,31,2,7,6,36]))),N=a(()=>r(()=>import(`./FleetPanel-Dlxf5qKt.js`),__vite__mapDeps([42,2,35,31,7,6,19,20,21,22,23,24,36]))),P=a(()=>r(()=>import(`./ToolUsagePanel-BLoGtKIF.js`),__vite__mapDeps([43,35,31,2,7,6,36,44]))),F=[{id:`flags`,label:`Feature flags`,icon:y,render:()=>(0,E.jsx)(D,{})},{id:`run`,label:`Run`,icon:x,render:()=>(0,E.jsx)(O,{})},{id:`notifications`,label:`Notifications / errors`,icon:m,render:e=>(0,E.jsx)(k,{active:e})},{id:`health`,label:`Service health`,icon:p,render:e=>(0,E.jsx)(A,{active:e})},{id:`deploy`,label:`Deploy / release gate`,icon:C,render:e=>(0,E.jsx)(j,{active:e})},{id:`db`,label:`DB health`,icon:_,render:e=>(0,E.jsx)(M,{active:e})},{id:`fleet`,label:`Fleet / coord`,icon:S,render:e=>(0,E.jsx)(N,{active:e})},{id:`usage`,label:`Tool usage`,icon:g,render:e=>(0,E.jsx)(P,{active:e})}],I=F.map(e=>e.id),L=48,R=300,z=384,B=`papercusp.devRail.width`,V=[`/pi`,`/project-docs`,`/el-min`];function H(e){return Math.max(R,Math.floor(e*.6))}function U(e,t){return Number.isFinite(e)?Math.max(R,Math.min(H(t),e)):z}function W(){if(typeof window>`u`)return z;try{let e=window.localStorage.getItem(l(B));return e?U(Number(e),window.innerWidth):z}catch{return z}}function G(){let e=d(),[t,n]=o(`devRail`,s.withDefault(!1)),[r,i]=o(`devSec`,c(I).withDefault(`flags`)),a=u()??``,f=V.some(e=>a===e||a.startsWith(`${e}/`)),[p,m]=(0,w.useState)(z),[g,_]=(0,w.useState)(!1);(0,w.useEffect)(()=>{m(W()),_(!0)},[]),(0,w.useEffect)(()=>{if(!g)return;if(f){document.body.classList.remove(`has-dev-rail`),document.body.classList.remove(`dev-rail-collapsed`),document.documentElement.style.removeProperty(`--dev-rail-w`);return}let e=t?p:L;document.documentElement.style.setProperty(`--dev-rail-w`,`${e}px`),document.body.classList.add(`has-dev-rail`),document.body.classList.toggle(`dev-rail-collapsed`,!t);try{window.localStorage.setItem(l(B),String(p))}catch{}},[t,p,g,f]),(0,w.useEffect)(()=>{if(!g)return;let e=()=>m(e=>U(e,window.innerWidth));return window.addEventListener(`resize`,e),()=>window.removeEventListener(`resize`,e)},[g]),(0,w.useEffect)(()=>()=>{try{document.body.classList.remove(`has-dev-rail`),document.body.classList.remove(`dev-rail-collapsed`),document.documentElement.style.removeProperty(`--dev-rail-w`)}catch{}},[]);let y=(0,w.useRef)(!1),x=(0,w.useCallback)(e=>{y.current=!0,e.target.setPointerCapture?.(e.pointerId),document.body.style.userSelect=`none`,document.body.style.cursor=`col-resize`},[]),S=(0,w.useCallback)(e=>{y.current&&m(U(window.innerWidth-e.clientX,window.innerWidth))},[]),C=(0,w.useCallback)(e=>{y.current=!1,e.target.releasePointerCapture?.(e.pointerId),document.body.style.userSelect=``,document.body.style.cursor=``},[]);return f?null:(0,E.jsxs)(E.Fragment,{children:[(0,E.jsx)(`style`,{children:T}),(0,E.jsxs)(`aside`,{className:`pcdar`,"data-testid":`dev-admin-rail`,"data-collapsed":t?`false`:`true`,style:{width:t?g?p:z:L},"aria-label":`Dev admin rail`,children:[(0,E.jsxs)(`button`,{type:`button`,className:`pcdar__expand-rail`,"data-testid":`dev-admin-rail-handle`,onClick:()=>n(!0),"aria-hidden":t,"aria-label":`Open dev admin rail`,children:[(0,E.jsx)(`span`,{className:`pcdar__expand-orb`,"aria-hidden":`true`,children:(0,E.jsx)(b,{size:18})}),(0,E.jsx)(`span`,{className:`pcdar__expand-label`,children:`Dev`}),(0,E.jsx)(h,{className:`pcdar__expand-chevron`,"aria-hidden":`true`})]}),(0,E.jsx)(`div`,{className:`pcdar__expanded-shell`,"aria-hidden":!t,children:t&&(0,E.jsxs)(E.Fragment,{children:[(0,E.jsxs)(`div`,{className:`pcdar__header`,children:[(0,E.jsxs)(`span`,{className:`pcdar__title`,children:[(0,E.jsx)(b,{size:14,"aria-hidden":`true`}),`Dev admin`,(0,E.jsx)(`span`,{className:`pcdar__title-badge`,children:`DEV`})]}),(0,E.jsx)(`span`,{className:`pcdar__spacer`}),(0,E.jsx)(`button`,{type:`button`,className:`pcdar__iconbtn`,onClick:()=>n(!1),"aria-label":`Close dev admin rail`,children:(0,E.jsx)(v,{size:16,"aria-hidden":`true`})})]}),(0,E.jsx)(`div`,{className:`pcdar__acc`,children:F.map(t=>{let n=t.id===r,a=t.icon;return(0,E.jsxs)(`div`,{className:`pcdar__sec${n?` is-active`:``}`,children:[(0,E.jsxs)(`button`,{type:`button`,className:`pcdar__sec-head`,"data-testid":`dev-rail-sec-${t.id}`,"aria-expanded":n,onClick:()=>i(t.id),children:[(0,E.jsx)(`span`,{className:`pcdar__sec-icon`,children:(0,E.jsx)(a,{size:15,"aria-hidden":`true`})}),(0,E.jsx)(`span`,{className:`pcdar__sec-label`,children:t.id===`fleet`?`${e(`fleet`)} / coord`:t.label}),(0,E.jsx)(`span`,{className:`pcdar__sec-chevron`,children:(0,E.jsx)(v,{size:15,"aria-hidden":`true`})})]}),n&&(0,E.jsx)(`div`,{className:`pcdar__sec-body`,children:(0,E.jsx)(w.Suspense,{fallback:(0,E.jsx)(`div`,{className:`pcdar-panel__empty`,children:`Loading…`}),children:t.render(!0)})})]},t.id)})})]})}),(0,E.jsx)(`div`,{className:`pcdar__resize-handle`,role:`separator`,"aria-orientation":`vertical`,"aria-label":`Resize dev admin rail`,onPointerDown:x,onPointerMove:S,onPointerUp:C,onPointerCancel:C})]})]})}export{G as default};