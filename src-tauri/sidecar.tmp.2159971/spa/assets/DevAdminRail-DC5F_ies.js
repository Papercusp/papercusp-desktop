const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/FlagsPanel-Bsnq_H1I.js","assets/FeaturesAdmin-BqBUtXz5.js","assets/chunk-CMxvf4Kt.js","assets/Tooltip-Cs0UWpqD.js","assets/dist-B_xEPI-d.js","assets/dist-B6QtTKmw.js","assets/dist-BT2AY6ik.js","assets/floating-ui.dom-QqGooS2M.js","assets/floating-ui.react-dom-BIOSk68C.js","assets/react-dom-BuIDZ5lO.js","assets/react-C1Wm8aMI.js","assets/dist-Cy9e2uEc.js","assets/jsx-runtime-sLPvdpSW.js","assets/dist-tj7No9UA.js","assets/dist-DjuwZ1SG.js","assets/dist-BKCunpUL.js","assets/dist-CnXNq11S.js","assets/dist-xQzroSej.js","assets/types-HiMWUb5q.js","assets/resilient-event-source-DB8lSvOI.js","assets/dist-CcY72VL8.js","assets/RunPanel-DsBbQGUY.js","assets/AdminOps-Cu0i6qI2.js","assets/Checkbox-g0eq7fh-.js","assets/dist-DNw7FQHt.js","assets/createLucideIcon-Bq4a7IPy.js","assets/check-7QUJyo7o.js","assets/AdminOps-BcpDuBCC.css","assets/NotificationsPanel-CaEJt-JC.js","assets/panel-kit-C-tljzYd.js","assets/SyncContext-DIxztLg9.js","assets/trash-2-G27QP56o.js","assets/x-BrjI5Ev0.js","assets/ServiceHealthPanel-uAxqCfWh.js","assets/DeployStatePanel-JoH1bPK-.js","assets/DbHealthPanel-BajznuMn.js","assets/FleetPanel-1eGYFxoM.js","assets/useLexicon-Dp7lEXPY.js","assets/client-Bt8lfgly.js"])))=>i.map(i=>d[i]);
import{o as e}from"./chunk-CMxvf4Kt.js";import{t}from"./react-C1Wm8aMI.js";import{n,t as r}from"./preload-helper-B_k_wMTD.js";import{t as i}from"./jsx-runtime-sLPvdpSW.js";import{r as a,t as o}from"./users-CIw34qxv.js";import{n as s,o as c,s as l}from"./dist-1aQumieq.js";import{r as u}from"./browser-workspace-AWq1Xprv.js";import{t as d}from"./useLexicon-Dp7lEXPY.js";import{t as f}from"./createLucideIcon-Bq4a7IPy.js";import{n as p,t as m}from"./flask-conical-EDe--xyl.js";import{i as h,n as g,r as _,t as v}from"./terminal-fgNHooU2.js";import{t as y}from"./chevron-left-DP1TdhHw.js";import{t as b}from"./chevron-right-OQ6shWOP.js";var x=f(`rocket`,[[`path`,{d:`M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5`,key:`qeys4`}],[`path`,{d:`M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09`,key:`u4xsad`}],[`path`,{d:`M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z`,key:`676m9`}],[`path`,{d:`M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05`,key:`92ym6u`}]]),S=e(t(),1),C=`/*
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
  color: var(--accent-strong, #7dd3fc);
}
.pcdar__expand-label {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  text-transform: uppercase;
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0.2em;
  color: rgba(207, 238, 255, 0.86);
}
.pcdar__expand-chevron {
  width: 16px;
  height: 16px;
  color: rgba(148, 224, 255, 0.86);
}
.pcdar__expand-rail:hover {
  background: color-mix(in srgb, var(--bg-1, #0a1422), transparent 2%);
}
.pcdar__expand-rail:hover .pcdar__expand-orb {
  border-color: rgba(103, 232, 249, 0.5);
  color: #eff8ff;
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
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(203, 238, 255, 0.82);
}
.pcdar__title-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(56, 189, 248, 0.16);
  color: #7dd3fc;
  font-size: 9px;
  letter-spacing: 0.12em;
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
  color: rgba(214, 236, 248, 0.78);
  cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.pcdar__iconbtn:hover {
  background: rgba(12, 24, 38, 0.96);
  border-color: rgba(103, 232, 249, 0.4);
  color: #eff8ff;
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
  color: rgba(214, 236, 248, 0.74);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.02em;
  text-align: left;
  cursor: pointer;
  transition: background 120ms, color 120ms;
}
.pcdar__sec-head:hover {
  background: color-mix(in srgb, var(--bg-1, #0a1422), transparent 2%);
  color: #eff8ff;
}
.pcdar__sec.is-active > .pcdar__sec-head {
  color: #f7fdff;
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
  color: rgba(214, 236, 248, 0.82);
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
  letter-spacing: 0.1em;
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
  color: rgba(214, 236, 248, 0.8);
  font-size: 11px;
  cursor: pointer;
  transition: background 120ms, border-color 120ms, color 120ms;
}
.pcdar-panel__refresh:hover:not(:disabled) {
  border-color: rgba(103, 232, 249, 0.4);
  color: #eff8ff;
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
  color: #eff8ff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pcdar-row__sub {
  margin-top: 2px;
  font-size: 11px;
  color: rgba(205, 226, 240, 0.7);
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
  letter-spacing: 0.04em;
  background: rgba(148, 163, 184, 0.18);
  color: rgba(214, 236, 248, 0.82);
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
  color: #eff8ff;
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
`,w=i();n();var T=(0,S.lazy)(()=>r(()=>import(`./FlagsPanel-Bsnq_H1I.js`),__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]))),E=(0,S.lazy)(()=>r(()=>import(`./RunPanel-DsBbQGUY.js`),__vite__mapDeps([21,22,2,23,5,11,12,10,17,14,24,15,25,26,9,3,4,6,7,8,13,16,19,27]))),D=(0,S.lazy)(()=>r(()=>import(`./NotificationsPanel-CaEJt-JC.js`),__vite__mapDeps([28,2,29,25,10,12,30,31,32]))),O=(0,S.lazy)(()=>r(()=>import(`./ServiceHealthPanel-uAxqCfWh.js`),__vite__mapDeps([33,29,25,2,10,12,30]))),k=(0,S.lazy)(()=>r(()=>import(`./DeployStatePanel-JoH1bPK-.js`),__vite__mapDeps([34,29,25,2,10,12,30]))),A=(0,S.lazy)(()=>r(()=>import(`./DbHealthPanel-BajznuMn.js`),__vite__mapDeps([35,29,25,2,10,12,30]))),j=(0,S.lazy)(()=>r(()=>import(`./FleetPanel-1eGYFxoM.js`),__vite__mapDeps([36,2,29,25,10,12,37,38,18,19,30]))),M=[{id:`flags`,label:`Feature flags`,icon:g,render:()=>(0,w.jsx)(T,{})},{id:`run`,label:`Run`,icon:v,render:()=>(0,w.jsx)(E,{})},{id:`notifications`,label:`Notifications / errors`,icon:h,render:e=>(0,w.jsx)(D,{active:e})},{id:`health`,label:`Service health`,icon:p,render:e=>(0,w.jsx)(O,{active:e})},{id:`deploy`,label:`Deploy / release gate`,icon:x,render:e=>(0,w.jsx)(k,{active:e})},{id:`db`,label:`DB health`,icon:_,render:e=>(0,w.jsx)(A,{active:e})},{id:`fleet`,label:`Fleet / coord`,icon:o,render:e=>(0,w.jsx)(j,{active:e})}],N=M.map(e=>e.id),P=48,F=300,I=384,L=`papercusp.devRail.width`,R=[`/pi`,`/project-docs`,`/el-min`];function z(e){return Math.max(F,Math.floor(e*.6))}function B(e,t){return Number.isFinite(e)?Math.max(F,Math.min(z(t),e)):I}function V(){if(typeof window>`u`)return I;try{let e=window.localStorage.getItem(u(L));return e?B(Number(e),window.innerWidth):I}catch{return I}}function H(){let e=d(),[t,n]=l(`devRail`,s.withDefault(!1)),[r,i]=l(`devSec`,c(N).withDefault(`flags`)),o=a()??``,f=R.some(e=>o===e||o.startsWith(`${e}/`)),[p,h]=(0,S.useState)(I),[g,_]=(0,S.useState)(!1);(0,S.useEffect)(()=>{h(V()),_(!0)},[]),(0,S.useEffect)(()=>{if(!g)return;if(f){document.body.classList.remove(`has-dev-rail`),document.body.classList.remove(`dev-rail-collapsed`),document.documentElement.style.removeProperty(`--dev-rail-w`);return}let e=t?p:P;document.documentElement.style.setProperty(`--dev-rail-w`,`${e}px`),document.body.classList.add(`has-dev-rail`),document.body.classList.toggle(`dev-rail-collapsed`,!t);try{window.localStorage.setItem(u(L),String(p))}catch{}},[t,p,g,f]),(0,S.useEffect)(()=>{if(!g)return;let e=()=>h(e=>B(e,window.innerWidth));return window.addEventListener(`resize`,e),()=>window.removeEventListener(`resize`,e)},[g]),(0,S.useEffect)(()=>()=>{try{document.body.classList.remove(`has-dev-rail`),document.body.classList.remove(`dev-rail-collapsed`),document.documentElement.style.removeProperty(`--dev-rail-w`)}catch{}},[]);let v=(0,S.useRef)(!1),x=(0,S.useCallback)(e=>{v.current=!0,e.target.setPointerCapture?.(e.pointerId),document.body.style.userSelect=`none`,document.body.style.cursor=`col-resize`},[]),T=(0,S.useCallback)(e=>{v.current&&h(B(window.innerWidth-e.clientX,window.innerWidth))},[]),E=(0,S.useCallback)(e=>{v.current=!1,e.target.releasePointerCapture?.(e.pointerId),document.body.style.userSelect=``,document.body.style.cursor=``},[]);return f?null:(0,w.jsxs)(w.Fragment,{children:[(0,w.jsx)(`style`,{children:C}),(0,w.jsxs)(`aside`,{className:`pcdar`,"data-testid":`dev-admin-rail`,"data-collapsed":t?`false`:`true`,style:{width:t?g?p:I:P},"aria-label":`Dev admin rail`,children:[(0,w.jsxs)(`button`,{type:`button`,className:`pcdar__expand-rail`,"data-testid":`dev-admin-rail-handle`,onClick:()=>n(!0),"aria-hidden":t,"aria-label":`Open dev admin rail`,children:[(0,w.jsx)(`span`,{className:`pcdar__expand-orb`,"aria-hidden":`true`,children:(0,w.jsx)(m,{size:18})}),(0,w.jsx)(`span`,{className:`pcdar__expand-label`,children:`Dev`}),(0,w.jsx)(y,{className:`pcdar__expand-chevron`,"aria-hidden":`true`})]}),(0,w.jsx)(`div`,{className:`pcdar__expanded-shell`,"aria-hidden":!t,children:t&&(0,w.jsxs)(w.Fragment,{children:[(0,w.jsxs)(`div`,{className:`pcdar__header`,children:[(0,w.jsxs)(`span`,{className:`pcdar__title`,children:[(0,w.jsx)(m,{size:14,"aria-hidden":`true`}),`Dev admin`,(0,w.jsx)(`span`,{className:`pcdar__title-badge`,children:`DEV`})]}),(0,w.jsx)(`span`,{className:`pcdar__spacer`}),(0,w.jsx)(`button`,{type:`button`,className:`pcdar__iconbtn`,onClick:()=>n(!1),"aria-label":`Close dev admin rail`,children:(0,w.jsx)(b,{size:16,"aria-hidden":`true`})})]}),(0,w.jsx)(`div`,{className:`pcdar__acc`,children:M.map(t=>{let n=t.id===r,a=t.icon;return(0,w.jsxs)(`div`,{className:`pcdar__sec${n?` is-active`:``}`,children:[(0,w.jsxs)(`button`,{type:`button`,className:`pcdar__sec-head`,"data-testid":`dev-rail-sec-${t.id}`,"aria-expanded":n,onClick:()=>i(t.id),children:[(0,w.jsx)(`span`,{className:`pcdar__sec-icon`,children:(0,w.jsx)(a,{size:15,"aria-hidden":`true`})}),(0,w.jsx)(`span`,{className:`pcdar__sec-label`,children:t.id===`fleet`?`${e(`fleet`)} / coord`:t.label}),(0,w.jsx)(`span`,{className:`pcdar__sec-chevron`,children:(0,w.jsx)(b,{size:15,"aria-hidden":`true`})})]}),n&&(0,w.jsx)(`div`,{className:`pcdar__sec-body`,children:(0,w.jsx)(S.Suspense,{fallback:(0,w.jsx)(`div`,{className:`pcdar-panel__empty`,children:`Loading…`}),children:t.render(!0)})})]},t.id)})})]})}),(0,w.jsx)(`div`,{className:`pcdar__resize-handle`,role:`separator`,"aria-orientation":`vertical`,"aria-label":`Resize dev admin rail`,onPointerDown:x,onPointerMove:T,onPointerUp:E,onPointerCancel:E})]})]})}export{H as default};