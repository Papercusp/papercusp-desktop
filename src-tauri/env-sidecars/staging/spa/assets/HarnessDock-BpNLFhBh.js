const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/PiTerminalsDock-BuImwvoF.js","assets/chunk-ChpBd9eV.js","assets/preload-helper-CcgcQsTF.js","assets/ChatPanel-KgAyj8Jc.js","assets/perf-marks-BxqWLvch.js","assets/useConfirmDialog-XesAx_Ds.js","assets/Modal-5HhhXtJg.js","assets/dist-C8zgoD2m.js","assets/dist-D0EAMqWt.js","assets/jsx-runtime-BmDUFisN.js","assets/react-DqHYuLt-.js","assets/dist-BF5awA5Z.js","assets/dist-iLte2Yrc.js","assets/dist-Dg4SROk3.js","assets/dist-D4lcwHCy.js","assets/react-dom-D9qSqTQ3.js","assets/dist-BPeEFAIy.js","assets/dist-BcHEo-1L.js","assets/dist-DI4JVPjg.js","assets/es2015-vhxykHUr.js","assets/Modal--38NdKeF.css","assets/Tooltip-CN_wdpx4.js","assets/dist-hppy9kFH.js","assets/dist-BQoeQQ8C.js","assets/floating-ui.dom-nqjZdp_l.js","assets/floating-ui.react-dom-ClEe7-4K.js","assets/dist-z_D7CxU9.js","assets/use-workspace-id-CWJdEj3C.js","assets/browser-workspace-C1KcM1u4.js","assets/SyncContext-Dsm36pME.js","assets/createLucideIcon-H39hj3ia.js","assets/loader-circle-CB2kOOog.js","assets/rotate-ccw-Il5gpmi1.js","assets/send-BWX_a7iL.js","assets/triangle-alert-CeknQp5m.js","assets/ChatPanel-A_DH9o3m.css","assets/resilient-event-source-DeC4tfE9.js","assets/usePollingQuery-BgwIFyGp.js","assets/connectivity-CGb1zU4U.js","assets/plus-VjW7aoK9.js","assets/dist-_S1YDkZy.js","assets/pty-tauri-V0gALYbd.js","assets/tauri-bindings-BUOSU56x.js","assets/core-BLiFydqE.js","assets/PiTerminalsDock-CIqMF3MR.css","assets/xterm-DDGTF8rc.css"])))=>i.map(i=>d[i]);
import{o as Tt}from"./chunk-ChpBd9eV.js";import{t as fi}from"./react-DqHYuLt-.js";import{n as bi,t as wi}from"./preload-helper-CcgcQsTF.js";import{t as _i}from"./jsx-runtime-BmDUFisN.js";import{t as xi}from"./react-dom-D9qSqTQ3.js";import{r as yi}from"./usePollingQuery-BgwIFyGp.js";import{a as Di,c as Ci}from"./dist-_S1YDkZy.js";import{t as zi}from"./use-workspace-id-CWJdEj3C.js";import{t as ki}from"./useConfirmDialog-XesAx_Ds.js";import{n as Si,r as Ai,t as lt}from"./perf-marks-BxqWLvch.js";import"./Tooltip-CN_wdpx4.js";import{t as Pi}from"./dynamic-Bz9AZwDw.js";var m=Tt(fi(),1);function Ei(e,t){t===void 0&&(t={});var i=t.insertAt;if(!(!e||typeof document>"u")){var n=document.head||document.getElementsByTagName("head")[0],o=document.createElement("style");o.type="text/css",i==="top"&&n.firstChild?n.insertBefore(o,n.firstChild):n.appendChild(o),o.styleSheet?o.styleSheet.cssText=e:o.appendChild(document.createTextNode(e))}}Ei(`.dv-scrollable {
  position: relative;
  overflow: hidden;
}
.dv-scrollable .dv-scrollbar {
  position: absolute;
  border-radius: 2px;
  background-color: transparent;
  /* GPU optimizations */
  will-change: background-color, transform;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  transition-property: background-color;
  transition-timing-function: ease-in-out;
  transition-duration: 1s;
  transition-delay: 0s;
}
.dv-scrollable .dv-scrollbar-horizontal {
  bottom: 0px;
  left: 0px;
  height: 4px;
}
.dv-scrollable .dv-scrollbar-vertical {
  right: 0px;
  top: 0px;
  width: 4px;
}
.dv-scrollable:hover .dv-scrollbar, .dv-scrollable.dv-scrollable-resizing .dv-scrollbar, .dv-scrollable.dv-scrollable-scrolling .dv-scrollbar {
  background-color: var(--dv-scrollbar-background-color, rgba(255, 255, 255, 0.25));
}
.dv-svg {
  display: inline-block;
  fill: currentcolor;
  line-height: 1;
  stroke: currentcolor;
  stroke-width: 0;
}
.dockview-theme-dark {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-group-view-background-color: #1e1e1e;
  --dv-tabs-and-actions-container-background-color: #252526;
  --dv-activegroup-visiblepanel-tab-background-color: #1e1e1e;
  --dv-activegroup-hiddenpanel-tab-background-color: #2d2d2d;
  --dv-inactivegroup-visiblepanel-tab-background-color: #1e1e1e;
  --dv-inactivegroup-hiddenpanel-tab-background-color: #2d2d2d;
  --dv-tab-divider-color: #1e1e1e;
  --dv-activegroup-visiblepanel-tab-color: white;
  --dv-activegroup-hiddenpanel-tab-color: #969696;
  --dv-inactivegroup-visiblepanel-tab-color: #8f8f8f;
  --dv-inactivegroup-hiddenpanel-tab-color: #626262;
  --dv-separator-border: rgb(68, 68, 68);
  --dv-paneview-header-border-color: rgba(204, 204, 204, 0.2);
}
.dockview-theme-dark .dv-drop-target-container .dv-drop-target-anchor.dv-drop-target-anchor-container-changed {
  opacity: 0;
  transition: none;
}

.dockview-theme-light {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-group-view-background-color: white;
  --dv-tabs-and-actions-container-background-color: #f3f3f3;
  --dv-activegroup-visiblepanel-tab-background-color: white;
  --dv-activegroup-hiddenpanel-tab-background-color: #ececec;
  --dv-inactivegroup-visiblepanel-tab-background-color: white;
  --dv-inactivegroup-hiddenpanel-tab-background-color: #ececec;
  --dv-tab-divider-color: white;
  --dv-activegroup-visiblepanel-tab-color: rgb(51, 51, 51);
  --dv-activegroup-hiddenpanel-tab-color: rgba(51, 51, 51, 0.7);
  --dv-inactivegroup-visiblepanel-tab-color: rgba(51, 51, 51, 0.7);
  --dv-inactivegroup-hiddenpanel-tab-color: rgba(51, 51, 51, 0.35);
  --dv-separator-border: rgba(128, 128, 128, 0.35);
  --dv-paneview-header-border-color: rgb(51, 51, 51);
  --dv-scrollbar-background-color: rgba(0, 0, 0, 0.25);
}
.dockview-theme-light .dv-drop-target-container .dv-drop-target-anchor.dv-drop-target-anchor-container-changed {
  opacity: 0;
  transition: none;
}

.dockview-theme-vs {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-group-view-background-color: #1e1e1e;
  --dv-tabs-and-actions-container-background-color: #252526;
  --dv-activegroup-visiblepanel-tab-background-color: #1e1e1e;
  --dv-activegroup-hiddenpanel-tab-background-color: #2d2d2d;
  --dv-inactivegroup-visiblepanel-tab-background-color: #1e1e1e;
  --dv-inactivegroup-hiddenpanel-tab-background-color: #2d2d2d;
  --dv-tab-divider-color: #1e1e1e;
  --dv-activegroup-visiblepanel-tab-color: white;
  --dv-activegroup-hiddenpanel-tab-color: #969696;
  --dv-inactivegroup-visiblepanel-tab-color: #8f8f8f;
  --dv-inactivegroup-hiddenpanel-tab-color: #626262;
  --dv-separator-border: rgb(68, 68, 68);
  --dv-paneview-header-border-color: rgba(204, 204, 204, 0.2);
  --dv-tabs-and-actions-container-background-color: #2d2d30;
  --dv-tabs-and-actions-container-height: 20px;
  --dv-tabs-and-actions-container-font-size: 11px;
  --dv-activegroup-visiblepanel-tab-background-color: #007acc;
  --dv-inactivegroup-visiblepanel-tab-background-color: #3f3f46;
  --dv-activegroup-visiblepanel-tab-color: white;
  --dv-activegroup-hiddenpanel-tab-color: white;
  --dv-inactivegroup-visiblepanel-tab-color: white;
  --dv-inactivegroup-hiddenpanel-tab-color: white;
}
.dockview-theme-vs .dv-drop-target-container .dv-drop-target-anchor.dv-drop-target-anchor-container-changed {
  opacity: 0;
  transition: none;
}
.dockview-theme-vs .dv-groupview.dv-active-group > .dv-tabs-and-actions-container {
  box-sizing: content-box;
  border-bottom: 2px solid var(--dv-activegroup-visiblepanel-tab-background-color);
}
.dockview-theme-vs .dv-groupview.dv-active-group > .dv-tabs-and-actions-container .dv-tab.dv-active-tab {
  border-top: 2px solid var(--dv-activegroup-visiblepanel-tab-background-color);
}
.dockview-theme-vs .dv-groupview.dv-active-group > .dv-tabs-and-actions-container .dv-tab.dv-inactive-tab {
  border-top: 2px solid var(--dv-activegroup-hiddenpanel-tab-background-color);
}
.dockview-theme-vs .dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container {
  box-sizing: content-box;
  border-bottom: 2px solid var(--dv-inactivegroup-visiblepanel-tab-background-color);
}
.dockview-theme-vs .dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container .dv-tab.dv-active-tab {
  border-top: 2px solid var(--dv-inactivegroup-visiblepanel-tab-background-color);
}
.dockview-theme-vs .dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container .dv-tab.dv-inactive-tab {
  border-top: 2px solid var(--dv-inactivegroup-hiddenpanel-tab-background-color);
}

.dockview-theme-abyss {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-color-abyss-dark: #000c18;
  --dv-color-abyss: #10192c;
  --dv-color-abyss-light: #1c1c2a;
  --dv-color-abyss-lighter: #2b2b4a;
  --dv-color-abyss-accent: rgb(91, 30, 207);
  --dv-color-abyss-primary-text: white;
  --dv-color-abyss-secondary-text: rgb(148, 151, 169);
  --dv-group-view-background-color: var(--dv-color-abyss-dark);
  --dv-tabs-and-actions-container-background-color: var(
      --dv-color-abyss-light
  );
  --dv-activegroup-visiblepanel-tab-background-color: var(
      --dv-color-abyss-dark
  );
  --dv-activegroup-hiddenpanel-tab-background-color: var(--dv-color-abyss);
  --dv-inactivegroup-visiblepanel-tab-background-color: var(
      --dv-color-abyss-dark
  );
  --dv-inactivegroup-hiddenpanel-tab-background-color: var(--dv-color-abyss);
  --dv-tab-divider-color: var(--dv-color-abyss-lighter);
  --dv-activegroup-visiblepanel-tab-color: white;
  --dv-activegroup-hiddenpanel-tab-color: rgba(255, 255, 255, 0.5);
  --dv-inactivegroup-visiblepanel-tab-color: rgba(255, 255, 255, 0.5);
  --dv-inactivegroup-hiddenpanel-tab-color: rgba(255, 255, 255, 0.25);
  --dv-separator-border: var(--dv-color-abyss-lighter);
  --dv-paneview-header-border-color: var(--dv-color-abyss-lighter);
  --dv-paneview-active-outline-color: #596f99;
}
.dockview-theme-abyss .dv-drop-target-container .dv-drop-target-anchor.dv-drop-target-anchor-container-changed {
  opacity: 0;
  transition: none;
}

.dockview-theme-dracula {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-group-view-background-color: #282a36;
  --dv-tabs-and-actions-container-background-color: #191a21;
  --dv-activegroup-visiblepanel-tab-background-color: #282a36;
  --dv-activegroup-hiddenpanel-tab-background-color: #21222c;
  --dv-inactivegroup-visiblepanel-tab-background-color: #282a36;
  --dv-inactivegroup-hiddenpanel-tab-background-color: #21222c;
  --dv-tab-divider-color: #191a21;
  --dv-activegroup-visiblepanel-tab-color: rgb(248, 248, 242);
  --dv-activegroup-hiddenpanel-tab-color: rgb(98, 114, 164);
  --dv-inactivegroup-visiblepanel-tab-color: rgba(248, 248, 242, 0.5);
  --dv-inactivegroup-hiddenpanel-tab-color: rgba(98, 114, 164, 0.5);
  --dv-separator-border: #bd93f9;
  --dv-paneview-header-border-color: #bd93f9;
  --dv-paneview-active-outline-color: #6272a4;
}
.dockview-theme-dracula .dv-drop-target-container .dv-drop-target-anchor.dv-drop-target-anchor-container-changed {
  opacity: 0;
  transition: none;
}
.dockview-theme-dracula .dv-groupview.dv-active-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-active-tab {
  position: relative;
}
.dockview-theme-dracula .dv-groupview.dv-active-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-active-tab::after {
  position: absolute;
  left: 0px;
  top: 0px;
  content: "";
  width: 100%;
  height: 1px;
  background-color: #94527e;
  z-index: 999;
}
.dockview-theme-dracula .dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-active-tab {
  position: relative;
}
.dockview-theme-dracula .dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-active-tab::after {
  position: absolute;
  left: 0px;
  bottom: 0px;
  content: "";
  width: 100%;
  height: 1px;
  background-color: #5e3d5a;
  z-index: 999;
}

.dockview-theme-replit {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  box-sizing: border-box;
  padding: 10px;
  background-color: #ebeced;
  --dv-group-view-background-color: #ebeced;
  --dv-tabs-and-actions-container-background-color: #fcfcfc;
  --dv-activegroup-visiblepanel-tab-background-color: #f0f1f2;
  --dv-activegroup-hiddenpanel-tab-background-color: #fcfcfc;
  --dv-inactivegroup-visiblepanel-tab-background-color: #f0f1f2;
  --dv-inactivegroup-hiddenpanel-tab-background-color: #fcfcfc;
  --dv-tab-divider-color: transparent;
  --dv-activegroup-visiblepanel-tab-color: rgb(51, 51, 51);
  --dv-activegroup-hiddenpanel-tab-color: rgb(51, 51, 51);
  --dv-inactivegroup-visiblepanel-tab-color: rgb(51, 51, 51);
  --dv-inactivegroup-hiddenpanel-tab-color: rgb(51, 51, 51);
  --dv-separator-border: transparent;
  --dv-paneview-header-border-color: rgb(51, 51, 51);
  --dv-sash-color: #cfd1d3;
  --dv-active-sash-color: #babbbb;
}
.dockview-theme-replit .dv-drop-target-container .dv-drop-target-anchor.dv-drop-target-anchor-container-changed {
  opacity: 0;
  transition: none;
}
.dockview-theme-replit .dv-resize-container:has(> .dv-groupview) {
  border-radius: 8px;
}
.dockview-theme-replit .dv-resize-container {
  border-radius: 10px !important;
  border: none;
}
.dockview-theme-replit .dv-groupview {
  overflow: hidden;
  border-radius: 10px;
}
.dockview-theme-replit .dv-groupview .dv-tabs-and-actions-container {
  border-bottom: 1px solid rgba(128, 128, 128, 0.35);
}
.dockview-theme-replit .dv-groupview .dv-tabs-and-actions-container .dv-tab {
  margin: 4px;
  border-radius: 8px;
}
.dockview-theme-replit .dv-groupview .dv-tabs-and-actions-container .dv-tab .dv-svg {
  height: 8px;
  width: 8px;
}
.dockview-theme-replit .dv-groupview .dv-tabs-and-actions-container .dv-tab:hover {
  background-color: #e4e5e6 !important;
}
.dockview-theme-replit .dv-groupview .dv-content-container {
  background-color: #fcfcfc;
}
.dockview-theme-replit .dv-groupview.dv-active-group {
  border: 1px solid rgba(128, 128, 128, 0.35);
}
.dockview-theme-replit .dv-groupview.dv-inactive-group {
  border: 1px solid transparent;
}
.dockview-theme-replit .dv-vertical > .dv-sash-container > .dv-sash {
  background-color: transparent;
}
.dockview-theme-replit .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled)::after {
  content: "";
  height: 4px;
  width: 40px;
  border-radius: 2px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: var(--dv-sash-color);
  position: absolute;
}
.dockview-theme-replit .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled):hover, .dockview-theme-replit .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled):active {
  background-color: transparent;
}
.dockview-theme-replit .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled):hover::after, .dockview-theme-replit .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled):active::after {
  background-color: var(--dv-active-sash-color);
}
.dockview-theme-replit .dv-horizontal > .dv-sash-container > .dv-sash {
  background-color: transparent;
}
.dockview-theme-replit .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled)::after {
  content: "";
  height: 40px;
  width: 4px;
  border-radius: 2px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: var(--dv-sash-color);
  position: absolute;
}
.dockview-theme-replit .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled):hover, .dockview-theme-replit .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled):active {
  background-color: transparent;
}
.dockview-theme-replit .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled):hover::after, .dockview-theme-replit .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled):active::after {
  background-color: var(--dv-active-sash-color);
}

.dockview-theme-abyss-spaced {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-tab-font-size: 12px;
  --dv-border-radius: 20px;
  --dv-tab-margin: 0.5rem 0.25rem;
  --dv-tabs-and-actions-container-height: 44px;
  --dv-border-radius: 20px;
  box-sizing: border-box;
  --dv-color-abyss-dark: rgb(11, 6, 17);
  --dv-color-abyss: #16121f;
  --dv-color-abyss-light: #201d2b;
  --dv-color-abyss-lighter: #2a2837;
  --dv-color-abyss-accent: rgb(91, 30, 207);
  --dv-color-abyss-primary-text: white;
  --dv-color-abyss-secondary-text: rgb(148, 151, 169);
  --dv-drag-over-border: 2px solid var(--dv-color-abyss-accent);
  --dv-drag-over-background-color: "";
  --dv-group-view-background-color: var(--dv-color-abyss-dark);
  --dv-tabs-and-actions-container-background-color: var(--dv-color-abyss);
  --dv-activegroup-visiblepanel-tab-background-color: var(
      --dv-color-abyss-lighter
  );
  --dv-activegroup-hiddenpanel-tab-background-color: var(
      --dv-color-abyss-light
  );
  --dv-inactivegroup-visiblepanel-tab-background-color: var(
      --dv-color-abyss-lighter
  );
  --dv-inactivegroup-hiddenpanel-tab-background-color: var(
      --dv-color-abyss-light
  );
  --dv-tab-divider-color: transparent;
  --dv-activegroup-visiblepanel-tab-color: var(--dv-color-abyss-primary-text);
  --dv-activegroup-hiddenpanel-tab-color: var(
      --dv-color-abyss-secondary-text
  );
  --dv-inactivegroup-visiblepanel-tab-color: var(
      --dv-color-abyss-primary-text
  );
  --dv-inactivegroup-hiddenpanel-tab-color: var(
      --dv-color-abyss-secondary-text
  );
  --dv-separator-border: transparent;
  --dv-paneview-header-border-color: rgb(51, 51, 51);
  --dv-active-sash-color: var(--dv-color-abyss-accent);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(0, 0, 0, 0.5);
  padding: 10px;
  background-color: var(--dv-color-abyss-dark);
}
.dockview-theme-abyss-spaced .dv-resize-container:has(> .dv-groupview) {
  border-radius: 8px;
}
.dockview-theme-abyss-spaced .dv-sash {
  border-radius: 4px;
}
.dockview-theme-abyss-spaced .dv-drop-target-anchor {
  border-radius: calc(var(--dv-border-radius) / 4);
}
.dockview-theme-abyss-spaced .dv-drop-target-anchor.dv-drop-target-content {
  border-radius: var(--dv-border-radius);
}
.dockview-theme-abyss-spaced .dv-resize-container {
  border-radius: var(--dv-border-radius) !important;
  border: none;
}
.dockview-theme-abyss-spaced .dv-tabs-overflow-container,
.dockview-theme-abyss-spaced .dv-tabs-overflow-dropdown-default {
  border-radius: 8px;
  height: unset !important;
}
.dockview-theme-abyss-spaced .dv-tab {
  border-radius: 8px;
}
.dockview-theme-abyss-spaced .dv-tab .dv-svg {
  height: 8px;
  width: 8px;
}
.dockview-theme-abyss-spaced .dv-groupview {
  border-radius: var(--dv-border-radius);
}
.dockview-theme-abyss-spaced .dv-groupview .dv-tabs-and-actions-container {
  padding: 0px calc(var(--dv-border-radius) / 2);
}
.dockview-theme-abyss-spaced .dv-groupview .dv-content-container {
  background-color: var(--dv-tabs-and-actions-container-background-color);
}
.dockview-theme-abyss-spaced .dv-resize-container .dv-groupview {
  border: 2px solid var(--dv-color-abyss-dark);
}

.dockview-theme-light-spaced {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-tab-font-size: 12px;
  --dv-border-radius: 20px;
  --dv-tab-margin: 0.5rem 0.25rem;
  --dv-tabs-and-actions-container-height: 44px;
  --dv-border-radius: 20px;
  box-sizing: border-box;
  --dv-drag-over-border: 2px solid rgb(91, 30, 207);
  --dv-drag-over-background-color: "";
  --dv-group-view-background-color: #f6f5f9;
  --dv-tabs-and-actions-container-background-color: white;
  --dv-activegroup-visiblepanel-tab-background-color: #ededf0;
  --dv-activegroup-hiddenpanel-tab-background-color: #f9f9fa;
  --dv-inactivegroup-visiblepanel-tab-background-color: #ededf0;
  --dv-inactivegroup-hiddenpanel-tab-background-color: #f9f9fa;
  --dv-tab-divider-color: transparent;
  --dv-activegroup-visiblepanel-tab-color: rgb(104, 107, 130);
  --dv-activegroup-hiddenpanel-tab-color: rgb(148, 151, 169);
  --dv-inactivegroup-visiblepanel-tab-color: rgb(104, 107, 130);
  --dv-inactivegroup-hiddenpanel-tab-color: rgb(148, 151, 169);
  --dv-separator-border: transparent;
  --dv-paneview-header-border-color: rgb(51, 51, 51);
  --dv-active-sash-color: rgb(91, 30, 207);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(0, 0, 0, 0.1);
  padding: 10px;
  background-color: #f6f5f9;
  --dv-scrollbar-background-color: rgba(0, 0, 0, 0.25);
}
.dockview-theme-light-spaced .dv-resize-container:has(> .dv-groupview) {
  border-radius: 8px;
}
.dockview-theme-light-spaced .dv-sash {
  border-radius: 4px;
}
.dockview-theme-light-spaced .dv-drop-target-anchor {
  border-radius: calc(var(--dv-border-radius) / 4);
}
.dockview-theme-light-spaced .dv-drop-target-anchor.dv-drop-target-content {
  border-radius: var(--dv-border-radius);
}
.dockview-theme-light-spaced .dv-resize-container {
  border-radius: var(--dv-border-radius) !important;
  border: none;
}
.dockview-theme-light-spaced .dv-tabs-overflow-container,
.dockview-theme-light-spaced .dv-tabs-overflow-dropdown-default {
  border-radius: 8px;
  height: unset !important;
}
.dockview-theme-light-spaced .dv-tab {
  border-radius: 8px;
}
.dockview-theme-light-spaced .dv-tab .dv-svg {
  height: 8px;
  width: 8px;
}
.dockview-theme-light-spaced .dv-groupview {
  border-radius: var(--dv-border-radius);
}
.dockview-theme-light-spaced .dv-groupview .dv-tabs-and-actions-container {
  padding: 0px calc(var(--dv-border-radius) / 2);
}
.dockview-theme-light-spaced .dv-groupview .dv-content-container {
  background-color: var(--dv-tabs-and-actions-container-background-color);
}
.dockview-theme-light-spaced .dv-resize-container .dv-groupview {
  border: 2px solid rgba(255, 255, 255, 0.1);
}
.dv-drop-target-container {
  position: absolute;
  z-index: 9999;
  top: 0px;
  left: 0px;
  height: 100%;
  width: 100%;
  pointer-events: none;
  overflow: hidden;
  --dv-transition-duration: 300ms;
}
.dv-drop-target-container .dv-drop-target-anchor {
  position: relative;
  border: var(--dv-drag-over-border);
  background-color: var(--dv-drag-over-background-color);
  opacity: 1;
  /* GPU optimizations */
  will-change: transform, opacity;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  contain: layout paint;
  transition: opacity var(--dv-transition-duration) ease-in, top var(--dv-transition-duration) ease-out, left var(--dv-transition-duration) ease-out, width var(--dv-transition-duration) ease-out, height var(--dv-transition-duration) ease-out;
}
.dv-drop-target {
  position: relative;
  --dv-transition-duration: 70ms;
}
.dv-drop-target > .dv-drop-target-dropzone {
  position: absolute;
  left: 0px;
  top: 0px;
  height: 100%;
  width: 100%;
  z-index: 1000;
  pointer-events: none;
}
.dv-drop-target > .dv-drop-target-dropzone > .dv-drop-target-selection {
  position: relative;
  box-sizing: border-box;
  height: 100%;
  width: 100%;
  border: var(--dv-drag-over-border);
  background-color: var(--dv-drag-over-background-color);
  transition: top var(--dv-transition-duration) ease-out, left var(--dv-transition-duration) ease-out, width var(--dv-transition-duration) ease-out, height var(--dv-transition-duration) ease-out, opacity var(--dv-transition-duration) ease-out;
  will-change: transform;
  pointer-events: none;
}
.dv-drop-target > .dv-drop-target-dropzone > .dv-drop-target-selection.dv-drop-target-top.dv-drop-target-small-vertical {
  border-top: 1px solid var(--dv-drag-over-border-color);
}
.dv-drop-target > .dv-drop-target-dropzone > .dv-drop-target-selection.dv-drop-target-bottom.dv-drop-target-small-vertical {
  border-bottom: 1px solid var(--dv-drag-over-border-color);
}
.dv-drop-target > .dv-drop-target-dropzone > .dv-drop-target-selection.dv-drop-target-left.dv-drop-target-small-horizontal {
  border-left: 1px solid var(--dv-drag-over-border-color);
}
.dv-drop-target > .dv-drop-target-dropzone > .dv-drop-target-selection.dv-drop-target-right.dv-drop-target-small-horizontal {
  border-right: 1px solid var(--dv-drag-over-border-color);
}
.dv-dockview {
  position: relative;
  background-color: var(--dv-group-view-background-color);
  contain: layout;
}
.dv-dockview .dv-watermark-container {
  position: absolute;
  top: 0px;
  left: 0px;
  height: 100%;
  width: 100%;
  z-index: 1;
}
.dv-dockview .dv-overlay-render-container {
  position: relative;
}

.dv-groupview.dv-active-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-active-tab {
  background-color: var(--dv-activegroup-visiblepanel-tab-background-color);
  color: var(--dv-activegroup-visiblepanel-tab-color);
}
.dv-groupview.dv-active-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-inactive-tab {
  background-color: var(--dv-activegroup-hiddenpanel-tab-background-color);
  color: var(--dv-activegroup-hiddenpanel-tab-color);
}
.dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-active-tab {
  background-color: var(--dv-inactivegroup-visiblepanel-tab-background-color);
  color: var(--dv-inactivegroup-visiblepanel-tab-color);
}
.dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-inactive-tab {
  background-color: var(--dv-inactivegroup-hiddenpanel-tab-background-color);
  color: var(--dv-inactivegroup-hiddenpanel-tab-color);
}

/**
 * when a tab is dragged we lose the above stylings because they are conditional on parent elements
 * therefore we also set some stylings for the dragging event
 **/
.dv-tab.dv-tab-dragging {
  background-color: var(--dv-activegroup-visiblepanel-tab-background-color);
  color: var(--dv-activegroup-visiblepanel-tab-color);
}
.dv-groupview {
  display: flex;
  height: 100%;
  background-color: var(--dv-group-view-background-color);
  overflow: hidden;
  flex-direction: column;
}
.dv-groupview:focus {
  outline: none;
}
.dv-groupview > .dv-content-container {
  flex-grow: 1;
  min-height: 0;
  outline: none;
}
.dv-groupview.dv-groupview-header-bottom {
  flex-direction: column-reverse;
}
.dv-groupview.dv-groupview-header-left {
  flex-direction: row;
}
.dv-groupview.dv-groupview-header-right {
  flex-direction: row-reverse;
}
.dv-root-wrapper {
  height: 100%;
  width: 100%;
}
.dv-grid-view,
.dv-branch-node {
  height: 100%;
  width: 100%;
}
.dv-debug .dv-resize-container .dv-resize-handle-top {
  background-color: red;
}
.dv-debug .dv-resize-container .dv-resize-handle-bottom {
  background-color: green;
}
.dv-debug .dv-resize-container .dv-resize-handle-left {
  background-color: yellow;
}
.dv-debug .dv-resize-container .dv-resize-handle-right {
  background-color: blue;
}
.dv-debug .dv-resize-container .dv-resize-handle-topleft,
.dv-debug .dv-resize-container .dv-resize-handle-topright,
.dv-debug .dv-resize-container .dv-resize-handle-bottomleft,
.dv-debug .dv-resize-container .dv-resize-handle-bottomright {
  background-color: cyan;
}

.dv-resize-container {
  --dv-overlay-z-index: var(--dv-overlay-z-index, 999);
  position: absolute;
  z-index: calc(var(--dv-overlay-z-index) - 2);
  border: 1px solid var(--dv-tab-divider-color);
  box-shadow: var(--dv-floating-box-shadow);
  /* GPU optimizations for floating group movement */
  will-change: transform, opacity;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
}
.dv-resize-container.dv-hidden {
  display: none;
}
.dv-resize-container.dv-resize-container-dragging {
  opacity: 0.5;
  /* Enhanced GPU acceleration during drag */
  will-change: transform, opacity;
}
.dv-resize-container .dv-resize-handle-top {
  height: 4px;
  width: calc(100% - 8px);
  left: 4px;
  top: -2px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: ns-resize;
}
.dv-resize-container .dv-resize-handle-bottom {
  height: 4px;
  width: calc(100% - 8px);
  left: 4px;
  bottom: -2px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: ns-resize;
}
.dv-resize-container .dv-resize-handle-left {
  height: calc(100% - 8px);
  width: 4px;
  left: -2px;
  top: 4px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: ew-resize;
}
.dv-resize-container .dv-resize-handle-right {
  height: calc(100% - 8px);
  width: 4px;
  right: -2px;
  top: 4px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: ew-resize;
}
.dv-resize-container .dv-resize-handle-topleft {
  height: 4px;
  width: 4px;
  top: -2px;
  left: -2px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: nw-resize;
}
.dv-resize-container .dv-resize-handle-topright {
  height: 4px;
  width: 4px;
  right: -2px;
  top: -2px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: ne-resize;
}
.dv-resize-container .dv-resize-handle-bottomleft {
  height: 4px;
  width: 4px;
  left: -2px;
  bottom: -2px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: sw-resize;
}
.dv-resize-container .dv-resize-handle-bottomright {
  height: 4px;
  width: 4px;
  right: -2px;
  bottom: -2px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: se-resize;
}
.dv-render-overlay {
  --dv-overlay-z-index: var(--dv-overlay-z-index, 999);
  position: absolute;
  z-index: 1;
  width: 100%;
  height: 100%;
  contain: layout paint;
  isolation: isolate;
  /* GPU optimizations */
  will-change: transform;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
}
.dv-render-overlay.dv-render-overlay-float {
  z-index: calc(var(--dv-overlay-z-index) - 1);
}

.dv-debug .dv-render-overlay {
  outline: 1px solid red;
  outline-offset: -1;
}
.dv-pane-container {
  height: 100%;
  width: 100%;
}
.dv-pane-container.dv-animated .dv-view {
  /* GPU optimizations for smooth pane animations */
  will-change: transform;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  transition: transform 0.15s ease-out;
}
.dv-pane-container .dv-view {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 0px !important;
}
.dv-pane-container .dv-view:not(:first-child)::before {
  background-color: transparent !important;
}
.dv-pane-container .dv-view:not(:first-child) .dv-pane > .dv-pane-header {
  border-top: 1px solid var(--dv-paneview-header-border-color);
}
.dv-pane-container .dv-view .dv-default-header {
  background-color: var(--dv-group-view-background-color);
  color: var(--dv-activegroup-visiblepanel-tab-color);
  display: flex;
  padding: 0px 8px;
  cursor: pointer;
}
.dv-pane-container .dv-view .dv-default-header .dv-pane-header-icon {
  display: flex;
  justify-content: center;
  align-items: center;
}
.dv-pane-container .dv-view .dv-default-header > span {
  padding-left: 8px;
  flex-grow: 1;
}
.dv-pane-container:first-of-type > .dv-pane > .dv-pane-header {
  border-top: none !important;
}
.dv-pane-container .dv-pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}
.dv-pane-container .dv-pane .dv-pane-header {
  box-sizing: border-box;
  user-select: none;
  position: relative;
  outline: none;
}
.dv-pane-container .dv-pane .dv-pane-header.dv-pane-draggable {
  cursor: pointer;
}
.dv-pane-container .dv-pane .dv-pane-header:focus:before, .dv-pane-container .dv-pane .dv-pane-header:focus-within:before {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 5;
  content: "";
  pointer-events: none;
  outline: 1px solid;
  outline-width: -1px;
  outline-style: solid;
  outline-offset: -1px;
  outline-color: var(--dv-paneview-active-outline-color);
}
.dv-pane-container .dv-pane .dv-pane-body {
  overflow-y: auto;
  overflow-x: hidden;
  flex-grow: 1;
  position: relative;
  outline: none;
}
.dv-pane-container .dv-pane .dv-pane-body:focus:before, .dv-pane-container .dv-pane .dv-pane-body:focus-within:before {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 5;
  content: "";
  pointer-events: none;
  outline: 1px solid;
  outline-width: -1px;
  outline-style: solid;
  outline-offset: -1px;
  outline-color: var(--dv-paneview-active-outline-color);
}
.dv-debug .dv-split-view-container .dv-sash-container .dv-sash.dv-enabled {
  background-color: black;
}
.dv-debug .dv-split-view-container .dv-sash-container .dv-sash.dv-disabled {
  background-color: orange;
}
.dv-debug .dv-split-view-container .dv-sash-container .dv-sash.dv-maximum {
  background-color: green;
}
.dv-debug .dv-split-view-container .dv-sash-container .dv-sash.dv-minimum {
  background-color: red;
}

.dv-split-view-container {
  position: relative;
  overflow: hidden;
  height: 100%;
  width: 100%;
}
.dv-split-view-container.dv-splitview-disabled > .dv-sash-container > .dv-sash {
  pointer-events: none;
}
.dv-split-view-container.dv-animation .dv-view,
.dv-split-view-container.dv-animation .dv-sash {
  /* GPU optimizations for smooth animations */
  will-change: transform;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  transition: transform 0.15s ease-out;
}
.dv-split-view-container.dv-horizontal {
  height: 100%;
}
.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash {
  height: 100%;
  width: 4px;
}
.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash.dv-enabled {
  cursor: ew-resize;
}
.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash.dv-disabled {
  cursor: default;
}
.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash.dv-maximum {
  cursor: w-resize;
}
.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash.dv-minimum {
  cursor: e-resize;
}
.dv-split-view-container.dv-horizontal > .dv-view-container > .dv-view:not(:first-child)::before {
  height: 100%;
  width: 1px;
}
.dv-split-view-container.dv-vertical {
  width: 100%;
}
.dv-split-view-container.dv-vertical > .dv-sash-container > .dv-sash {
  width: 100%;
  height: 4px;
}
.dv-split-view-container.dv-vertical > .dv-sash-container > .dv-sash.dv-enabled {
  cursor: ns-resize;
}
.dv-split-view-container.dv-vertical > .dv-sash-container > .dv-sash.dv-disabled {
  cursor: default;
}
.dv-split-view-container.dv-vertical > .dv-sash-container > .dv-sash.dv-maximum {
  cursor: n-resize;
}
.dv-split-view-container.dv-vertical > .dv-sash-container > .dv-sash.dv-minimum {
  cursor: s-resize;
}
.dv-split-view-container.dv-vertical > .dv-view-container > .dv-view {
  width: 100%;
}
.dv-split-view-container.dv-vertical > .dv-view-container > .dv-view:not(:first-child)::before {
  height: 1px;
  width: 100%;
}
.dv-split-view-container .dv-sash-container {
  height: 100%;
  width: 100%;
  position: absolute;
}
.dv-split-view-container .dv-sash-container .dv-sash {
  position: absolute;
  z-index: 99;
  outline: none;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  touch-action: none;
  background-color: var(--dv-sash-color, transparent);
}
.dv-split-view-container .dv-sash-container .dv-sash:not(.disabled):active, .dv-split-view-container .dv-sash-container .dv-sash:not(.disabled):hover {
  background-color: var(--dv-active-sash-color, transparent);
  transition-property: background-color;
  transition-timing-function: ease-in-out;
  transition-duration: var(--dv-active-sash-transition-duration, 0.1s);
  transition-delay: var(--dv-active-sash-transition-delay, 0.5s);
}
.dv-split-view-container .dv-view-container {
  position: relative;
  height: 100%;
  width: 100%;
}
.dv-split-view-container .dv-view-container .dv-view {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  position: absolute;
}
.dv-split-view-container.dv-separator-border .dv-view:not(:first-child)::before {
  content: " ";
  position: absolute;
  top: 0;
  left: 0;
  z-index: 5;
  pointer-events: none;
  background-color: var(--dv-separator-border);
}
.dv-dragged {
  transform: translate3d(0px, 0px, 0px); /* forces tab to be drawn on a separate layer (see https://github.com/microsoft/vscode/issues/18733) */
}

.dv-tab {
  flex-shrink: 0;
}
.dv-tab:focus-within, .dv-tab:focus {
  position: relative;
}
.dv-tab:focus-within::after, .dv-tab:focus::after {
  position: absolute;
  content: "";
  height: 100%;
  width: 100%;
  top: 0px;
  left: 0px;
  pointer-events: none;
  outline: 1px solid var(--dv-tab-divider-color) !important;
  outline-offset: -1px;
  z-index: 5;
}
.dv-tab.dv-tab-dragging .dv-default-tab-action {
  background-color: var(--dv-activegroup-visiblepanel-tab-color);
}
.dv-tab.dv-active-tab .dv-default-tab .dv-default-tab-action {
  visibility: visible;
}
.dv-tab.dv-inactive-tab .dv-default-tab .dv-default-tab-action {
  visibility: hidden;
}
.dv-tab.dv-inactive-tab .dv-default-tab:hover .dv-default-tab-action {
  visibility: visible;
}
.dv-tab .dv-default-tab {
  position: relative;
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dv-tab .dv-default-tab .dv-default-tab-content {
  flex-grow: 1;
  margin-right: 4px;
}
.dv-tab .dv-default-tab .dv-default-tab-action {
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.dv-tab .dv-default-tab .dv-default-tab-action:hover {
  border-radius: 2px;
  background-color: var(--dv-icon-hover-background-color);
}
.dv-tabs-overflow-dropdown-default {
  height: 100%;
  color: var(--dv-activegroup-hiddenpanel-tab-color);
  margin: var(--dv-tab-margin);
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}
.dv-tabs-overflow-dropdown-default > span {
  padding-left: 0.25rem;
}
.dv-tabs-overflow-dropdown-default > svg {
  transform: rotate(90deg);
}
.dv-tabs-overflow-dropdown-default:hover {
  border-radius: 2px;
  background-color: var(--dv-icon-hover-background-color);
}
.dv-tabs-container {
  display: flex;
  height: 100%;
  overflow: auto;
  scrollbar-width: thin;
  /* GPU optimizations for smooth scrolling */
  will-change: scroll-position;
  transform: translate3d(0, 0, 0);
  /* Track */
  /* Handle */
}
.dv-tabs-container.dv-tabs-container-vertical {
  width: 100%;
  height: fit-content;
  max-height: 100%;
  writing-mode: vertical-rl;
}
.dv-tabs-container.dv-horizontal .dv-tab:not(:first-child)::before, .dv-tabs-container.dv-vertical .dv-tab:not(:first-child)::before {
  content: " ";
  position: absolute;
  top: 0;
  left: 0;
  z-index: 5;
  pointer-events: none;
  background-color: var(--dv-tab-divider-color);
}
.dv-tabs-container.dv-horizontal .dv-tab:not(:first-child)::before {
  width: 1px;
  height: 100%;
}
.dv-tabs-container.dv-vertical .dv-tab:not(:first-child)::before {
  width: 100%;
  height: 1px;
}
.dv-tabs-container::-webkit-scrollbar {
  height: 3px;
}
.dv-tabs-container::-webkit-scrollbar-track {
  background: transparent;
}
.dv-tabs-container::-webkit-scrollbar-thumb {
  background: var(--dv-tabs-container-scrollbar-color);
}

.dv-scrollable > .dv-tabs-container {
  overflow: hidden;
}

.dv-tab {
  -webkit-user-drag: element;
  outline: none;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  position: relative;
  box-sizing: border-box;
  font-size: var(--dv-tab-font-size);
  margin: var(--dv-tab-margin);
}
.dv-tab.dv-tab--shifting {
  will-change: margin-left;
  transition: transform var(--dv-transition-duration, 200ms) ease-out, margin-left var(--dv-transition-duration, 200ms) ease-out;
}
.dv-tab.dv-tab--dragging {
  width: 0 !important;
  min-width: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transition: width var(--dv-transition-duration, 200ms) ease-out, padding var(--dv-transition-duration, 200ms) ease-out, margin var(--dv-transition-duration, 200ms) ease-out, opacity var(--dv-transition-duration, 200ms) ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .dv-tab {
    transition: none !important;
  }
}
.dv-tabs-container-vertical .dv-tab {
  padding: 0.5rem 0.25rem;
}

.dv-tabs-overflow-container {
  flex-direction: column;
  height: unset;
  font-size: var(--dv-tabs-and-actions-container-font-size);
  max-height: min(50vh, 400px);
  overflow-y: auto;
  border: 1px solid var(--dv-tab-divider-color);
  background-color: var(--dv-group-view-background-color);
  /* Scrollbar styling for webkit browsers */
  /* Firefox scrollbar */
  scrollbar-width: thin;
}
.dv-tabs-overflow-container::-webkit-scrollbar {
  width: 6px;
}
.dv-tabs-overflow-container::-webkit-scrollbar-track {
  background: transparent;
}
.dv-tabs-overflow-container::-webkit-scrollbar-thumb {
  background: var(--dv-tabs-container-scrollbar-color);
  border-radius: 3px;
}
.dv-tabs-overflow-container .dv-tab:not(:last-child) {
  border-bottom: 1px solid var(--dv-tab-divider-color);
}
.dv-tabs-overflow-container .dv-active-tab {
  background-color: var(--dv-activegroup-visiblepanel-tab-background-color);
  color: var(--dv-activegroup-visiblepanel-tab-color);
}
.dv-tabs-overflow-container .dv-inactive-tab {
  background-color: var(--dv-activegroup-hiddenpanel-tab-background-color);
  color: var(--dv-activegroup-hiddenpanel-tab-color);
}
.dv-tabs-and-actions-container {
  display: flex;
  background-color: var(--dv-tabs-and-actions-container-background-color);
  flex-shrink: 0;
  box-sizing: border-box;
  height: var(--dv-tabs-and-actions-container-height);
  font-size: var(--dv-tabs-and-actions-container-font-size);
}
.dv-tabs-and-actions-container.dv-single-tab.dv-full-width-single-tab .dv-scrollable {
  flex-grow: 1;
}
.dv-tabs-and-actions-container.dv-single-tab.dv-full-width-single-tab .dv-tabs-container {
  flex-grow: 1;
}
.dv-tabs-and-actions-container.dv-single-tab.dv-full-width-single-tab .dv-tabs-container .dv-tab {
  flex-grow: 1;
  padding: 0px;
}
.dv-tabs-and-actions-container.dv-single-tab.dv-full-width-single-tab .dv-void-container {
  flex-grow: 0;
}
.dv-tabs-and-actions-container .dv-void-container {
  display: flex;
  flex-grow: 1;
}
.dv-tabs-and-actions-container .dv-void-container.dv-draggable {
  cursor: grab;
}
.dv-tabs-and-actions-container .dv-right-actions-container {
  display: flex;
}
.dv-tabs-and-actions-container .dv-right-actions-container.dv-right-actions-container-vertical {
  flex-direction: column;
}
.dv-tabs-and-actions-container.dv-groupview-header-vertical {
  flex-direction: column;
  height: auto;
  width: var(--dv-tabs-and-actions-container-height);
}
.dv-watermark {
  display: flex;
  height: 100%;
}`);var Rt=class{},ae=class extends Rt{constructor(e,t,i){super(),this.viewId=e,this.groupId=t,this.panelId=i}},ye=class extends Rt{constructor(e,t){super(),this.viewId=e,this.paneId=t}},de=class Lt{constructor(){}static getInstance(){return Lt.INSTANCE}hasData(t){return t&&t===this.proto}clearData(t){this.hasData(t)&&(this.proto=void 0,this.data=void 0)}getData(t){if(this.hasData(t))return this.data}setData(t,i){i&&(this.data=t,this.proto=i)}};de.INSTANCE=new de;function J(){const e=de.getInstance();if(e.hasData(ae.prototype))return e.getData(ae.prototype)[0]}function _e(){const e=de.getInstance();if(e.hasData(ye.prototype))return e.getData(ye.prototype)[0]}var ce;(function(e){e.any=(...t)=>i=>{const n=t.map(o=>o(i));return{dispose:()=>{n.forEach(o=>{o.dispose()})}}}})(ce||(ce={}));var et=class{constructor(){this._defaultPrevented=!1}get defaultPrevented(){return this._defaultPrevented}preventDefault(){this._defaultPrevented=!0}},Vt=class{constructor(){this._isAccepted=!1}get isAccepted(){return this._isAccepted}accept(){this._isAccepted=!0}},Ii=class{constructor(){this.events=new Map}get size(){return this.events.size}add(e,t){this.events.set(e,t)}delete(e){this.events.delete(e)}clear(){this.events.clear()}},ht=class Nt{static create(){var t;return new Nt((t=new Error().stack)!==null&&t!==void 0?t:"")}constructor(t){this.value=t}print(){console.warn("dockview: stacktrace",this.value)}},Oi=class{constructor(e,t){this.callback=e,this.stacktrace=t}},c=class ee{static setLeakageMonitorEnabled(t){t!==ee.ENABLE_TRACKING&&ee.MEMORY_LEAK_WATCHER.clear(),ee.ENABLE_TRACKING=t}get value(){return this._last}constructor(t){this.options=t,this._listeners=[],this._disposed=!1}get event(){return this._event||(this._event=t=>{var i;!((i=this.options)===null||i===void 0)&&i.replay&&this._last!==void 0&&t(this._last);const n=new Oi(t,ee.ENABLE_TRACKING?ht.create():void 0);return this._listeners.push(n),{dispose:()=>{const o=this._listeners.indexOf(n);o>-1?this._listeners.splice(o,1):ee.ENABLE_TRACKING}}},ee.ENABLE_TRACKING&&ee.MEMORY_LEAK_WATCHER.add(this._event,ht.create())),this._event}fire(t){var i;!((i=this.options)===null||i===void 0)&&i.replay&&(this._last=t);for(const n of this._listeners)n.callback(t)}dispose(){this._disposed||(this._disposed=!0,this._listeners.length>0&&(ee.ENABLE_TRACKING&&queueMicrotask(()=>{var t;for(const i of this._listeners)console.warn("dockview: stacktrace",(t=i.stacktrace)===null||t===void 0?void 0:t.print())}),this._listeners=[]),ee.ENABLE_TRACKING&&this._event&&ee.MEMORY_LEAK_WATCHER.delete(this._event))}};c.ENABLE_TRACKING=!1;c.MEMORY_LEAK_WATCHER=new Ii;function S(e,t,i,n){return e.addEventListener(t,i,n),{dispose:()=>{e.removeEventListener(t,i,n)}}}var ct=class{constructor(){this._onFired=new c,this._currentFireCount=0,this._queued=!1,this.onEvent=e=>{const t=this._currentFireCount;return this._onFired.event(()=>{this._currentFireCount>t&&e()})}}fire(){this._currentFireCount++,!this._queued&&(this._queued=!0,queueMicrotask(()=>{this._queued=!1,this._onFired.fire()}))}dispose(){this._onFired.dispose()}},W;(function(e){e.NONE={dispose:()=>{}};function t(i){return{dispose:()=>{i()}}}e.from=t})(W||(W={}));var z=class{get isDisposed(){return this._isDisposed}constructor(...e){this._isDisposed=!1,this._disposables=new Set(e)}addDisposables(...e){e.forEach(t=>this._disposables.add(t))}removeDisposable(e){this._disposables.delete(e)}dispose(){this._isDisposed||(this._isDisposed=!0,this._disposables.forEach(e=>e.dispose()),this._disposables.clear())}},B=class{constructor(){this._disposable=W.NONE}set value(e){this._disposable&&this._disposable.dispose(),this._disposable=e}dispose(){this._disposable&&(this._disposable.dispose(),this._disposable=W.NONE)}},Gi=class extends z{constructor(e){super(),this._onDidChange=new c,this.onDidChange=this._onDidChange.event,this._value=null,this.addDisposables(this._onDidChange,Re(e,t=>{const i=t.target.scrollWidth>t.target.clientWidth,n=t.target.scrollHeight>t.target.clientHeight;this._value={hasScrollX:i,hasScrollY:n},this._onDidChange.fire(this._value)}))}};function Re(e,t){const i=new ResizeObserver(n=>{requestAnimationFrame(()=>{const o=n[0];t(o)})});return i.observe(e),{dispose:()=>{i.unobserve(e),i.disconnect()}}}var te=(e,...t)=>{for(const i of t)e.classList.contains(i)&&e.classList.remove(i)},ie=(e,...t)=>{for(const i of t)e.classList.contains(i)||e.classList.add(i)},x=(e,t,i)=>{const n=e.classList.contains(t);i&&!n&&e.classList.add(t),!i&&n&&e.classList.remove(t)};function Fe(e,t){for(;e;){if(e===t)return!0;e=e.parentNode}return!1}function Mt(e){return new Ti(e)}var Ti=class extends z{constructor(e){super(),this._onDidFocus=new c,this.onDidFocus=this._onDidFocus.event,this._onDidBlur=new c,this.onDidBlur=this._onDidBlur.event,this.addDisposables(this._onDidFocus,this._onDidBlur);let t=Fe(document.activeElement,e),i=!1;const n=()=>{i=!1,t||(t=!0,this._onDidFocus.fire())},o=()=>{t&&(i=!0,window.setTimeout(()=>{i&&(i=!1,t=!1,this._onDidBlur.fire())},0))};this._refreshStateHandler=()=>{Fe(document.activeElement,e)!==t&&(t?o():n())},this.addDisposables(S(e,"focus",n,!0)),this.addDisposables(S(e,"blur",o,!0))}refreshState(){this._refreshStateHandler()}},Wt="dv-quasiPreventDefault";function Ri(e){e[Wt]=!0}function vt(e){return e[Wt]}function Li(e,t){const i=Array.from(t);for(const n of i){if(n.href){const r=e.createElement("link");r.href=n.href,r.type=n.type,r.rel="stylesheet",e.head.appendChild(r)}let o=[];try{n.cssRules&&(o=Array.from(n.cssRules).map(r=>r.cssText))}catch{}for(const r of o){const a=e.createElement("style");a.appendChild(e.createTextNode(r)),e.head.appendChild(a)}}}function Be(e){const{left:t,top:i,width:n,height:o}=e.getBoundingClientRect();return{left:t+window.scrollX,top:i+window.scrollY,width:n,height:o}}function Vi(e){let t=e;for(;t?.parentNode;){if(t.parentNode===document)return!0;t.parentNode instanceof DocumentFragment?t=t.parentNode.host:t=t.parentNode}return!1}function Ni(e,t){e.setAttribute("data-testid",t)}function Mi(e){const t=[];function i(n){if(n.nodeType===Node.ELEMENT_NODE){e.includes(n.tagName)&&t.push(n),n.shadowRoot&&i(n.shadowRoot);for(const o of n.children)i(o)}}return i(document.documentElement),t}function Oe(e=document){const t=Mi(["IFRAME","WEBVIEW"]),i=new WeakMap;for(const n of t)i.set(n,n.style.pointerEvents),n.style.pointerEvents="none";return{release:()=>{var n;for(const o of t)o.style.pointerEvents=(n=i.get(o))!==null&&n!==void 0?n:"auto";t.splice(0,t.length)}}}function Wi(e){function t(o){const r=[];for(let a=0;a<o.classList.length;a++)r.push(o.classList.item(a));return r}let i,n=e;for(;n!==null&&(i=t(n).find(o=>o.startsWith("dockview-theme-")),typeof i!="string");)n=n.parentElement;return i}var Le=class{constructor(e){this.element=e,this._classNames=[]}setClassNames(e){for(const t of this._classNames)x(this.element,t,!1);this._classNames=e.split(" ").filter(t=>t.trim().length>0);for(const t of this._classNames)x(this.element,t,!0)}},Ht=100;function Hi(e,t){const i=Be(e),n=Be(t);return!(i.left<n.left||i.left+i.width>n.left+n.width||i.top<n.top||i.top+i.height>n.top+n.height)}function Fi(e){const t=new c;let i=e.screenX,n=e.screenY,o;const r=()=>{if(e.closed)return;const a=e.screenX,s=e.screenY;(a!==i||s!==n)&&(clearTimeout(o),o=setTimeout(()=>{t.fire()},Ht),i=a,n=s),requestAnimationFrame(r)};return r(),t}function Bi(e,t){let i;return new z(S(e,"resize",()=>{clearTimeout(i),i=setTimeout(()=>{t()},Ht)}))}function Ui(e,t,i={buffer:10}){const n=i.buffer,o=e.getBoundingClientRect(),r=t.getBoundingClientRect();let a=0,s=0;const d=o.left-r.left,l=o.top-r.top,h=o.bottom-r.bottom,v=o.right-r.right;d<n?a=n-d:v>n&&(a=-n-v),l<n?s=n-l:h>n&&(s=-h-n),(a!==0||s!==0)&&(e.style.transform=`translate(${a}px, ${s}px)`)}function $i(e){let t=e;for(;t&&(t.style.zIndex==="auto"||t.style.zIndex==="");)t=t.parentElement;return t}function re(e){if(e.length===0)throw new Error("Invalid tail call");return[e.slice(0,e.length-1),e[e.length-1]]}function Ft(e,t){if(e.length!==t.length)return!1;for(let i=0;i<e.length;i++)if(e[i]!==t[i])return!1;return!0}function We(e,t){const i=e.indexOf(t);i>-1&&(e.splice(i,1),e.unshift(t))}function ke(e,t){const i=e.indexOf(t);i>-1&&(e.splice(i,1),e.push(t))}function ji(e,t){for(let i=0;i<e.length;i++){const n=e[i];if(t(n))return i}return-1}function He(e,t){const i=e.findIndex(n=>n===t);return i>-1?(e.splice(i,1),!0):!1}var V=(e,t,i)=>t>i?t:Math.min(i,Math.max(e,t)),tt=()=>{let e=1;return{next:()=>(e++).toString()}},Q=(e,t)=>{const i=[];if(typeof t!="number"&&(t=e,e=0),e<=t)for(let n=e;n<t;n++)i.push(n);else for(let n=e;n>t;n--)i.push(n);return i},Ji=class{set size(e){this._size=e}get size(){return this._size}get cachedVisibleSize(){return this._cachedVisibleSize}get visible(){return typeof this._cachedVisibleSize>"u"}get minimumSize(){return this.visible?this.view.minimumSize:0}get viewMinimumSize(){return this.view.minimumSize}get maximumSize(){return this.visible?this.view.maximumSize:0}get viewMaximumSize(){return this.view.maximumSize}get priority(){return this.view.priority}get snap(){return!!this.view.snap}set enabled(e){this.container.style.pointerEvents=e?"":"none"}constructor(e,t,i,n){this.container=e,this.view=t,this.disposable=n,this._cachedVisibleSize=void 0,typeof i=="number"?(this._size=i,this._cachedVisibleSize=void 0,e.classList.add("visible")):(this._size=0,this._cachedVisibleSize=i.cachedVisibleSize)}setVisible(e,t){var i;e!==this.visible&&(e?(this.size=V((i=this._cachedVisibleSize)!==null&&i!==void 0?i:0,this.viewMinimumSize,this.viewMaximumSize),this._cachedVisibleSize=void 0):(this._cachedVisibleSize=typeof t=="number"?t:this.size,this.size=0),this.container.classList.toggle("visible",e),this.view.setVisible&&this.view.setVisible(e))}dispose(){return this.disposable.dispose(),this.view}},y;(function(e){e.HORIZONTAL="HORIZONTAL",e.VERTICAL="VERTICAL"})(y||(y={}));var X;(function(e){e[e.MAXIMUM=0]="MAXIMUM",e[e.MINIMUM=1]="MINIMUM",e[e.DISABLED=2]="DISABLED",e[e.ENABLED=3]="ENABLED"})(X||(X={}));var F;(function(e){e.Low="low",e.High="high",e.Normal="normal"})(F||(F={}));var K;(function(e){e.Distribute={type:"distribute"};function t(n){return{type:"split",index:n}}e.Split=t;function i(n){return{type:"invisible",cachedVisibleSize:n}}e.Invisible=i})(K||(K={}));var De=class{get contentSize(){return this._contentSize}get size(){return this._size}set size(e){this._size=e}get orthogonalSize(){return this._orthogonalSize}set orthogonalSize(e){this._orthogonalSize=e}get length(){return this.viewItems.length}get proportions(){return this._proportions?[...this._proportions]:void 0}get orientation(){return this._orientation}set orientation(e){this._orientation=e;const t=this.size;this.size=this.orthogonalSize,this.orthogonalSize=t,te(this.element,"dv-horizontal","dv-vertical"),this.element.classList.add(this.orientation==y.HORIZONTAL?"dv-horizontal":"dv-vertical")}get minimumSize(){return this.viewItems.reduce((e,t)=>e+t.minimumSize,0)}get maximumSize(){return this.length===0?Number.POSITIVE_INFINITY:this.viewItems.reduce((e,t)=>e+t.maximumSize,0)}get startSnappingEnabled(){return this._startSnappingEnabled}set startSnappingEnabled(e){this._startSnappingEnabled!==e&&(this._startSnappingEnabled=e,this.updateSashEnablement())}get endSnappingEnabled(){return this._endSnappingEnabled}set endSnappingEnabled(e){this._endSnappingEnabled!==e&&(this._endSnappingEnabled=e,this.updateSashEnablement())}get disabled(){return this._disabled}set disabled(e){this._disabled=e,x(this.element,"dv-splitview-disabled",e)}get margin(){return this._margin}set margin(e){this._margin=e,x(this.element,"dv-splitview-has-margin",e!==0)}constructor(e,t){var i,n;this.container=e,this.viewItems=[],this.sashes=[],this._size=0,this._orthogonalSize=0,this._contentSize=0,this._proportions=void 0,this._startSnappingEnabled=!0,this._endSnappingEnabled=!0,this._disabled=!1,this._margin=0,this._onDidSashEnd=new c,this.onDidSashEnd=this._onDidSashEnd.event,this._onDidAddView=new c,this.onDidAddView=this._onDidAddView.event,this._onDidRemoveView=new c,this.onDidRemoveView=this._onDidRemoveView.event,this.resize=(o,r,a=this.viewItems.map(b=>b.size),s,d,l=Number.NEGATIVE_INFINITY,h=Number.POSITIVE_INFINITY,v,p)=>{if(o<0||o>this.viewItems.length)return 0;const b=Q(o,-1),u=Q(o+1,this.viewItems.length);if(d)for(const f of d)We(b,f),We(u,f);if(s)for(const f of s)ke(b,f),ke(u,f);const g=b.map(f=>this.viewItems[f]),D=b.map(f=>a[f]),A=u.map(f=>this.viewItems[f]),k=u.map(f=>a[f]),_=b.reduce((f,w)=>f+this.viewItems[w].minimumSize-a[w],0),T=b.reduce((f,w)=>f+this.viewItems[w].maximumSize-a[w],0),R=u.length===0?Number.POSITIVE_INFINITY:u.reduce((f,w)=>f+a[w]-this.viewItems[w].minimumSize,0),C=u.length===0?Number.NEGATIVE_INFINITY:u.reduce((f,w)=>f+a[w]-this.viewItems[w].maximumSize,0),O=Math.max(_,C),E=Math.min(R,T);let L=!1;if(v){const f=this.viewItems[v.index],w=r>=v.limitDelta;L=w!==f.visible,f.setVisible(w,v.size)}if(!L&&p){const f=this.viewItems[p.index],w=r<p.limitDelta;L=w!==f.visible,f.setVisible(w,p.size)}if(L)return this.resize(o,r,a,s,d,l,h);const U=V(r,O,E);let j=0,Z=U;for(let f=0;f<g.length;f++){const w=g[f],M=V(D[f]+Z,w.minimumSize,w.maximumSize),I=M-D[f];j+=I,Z-=I,w.size=M}let P=j;for(let f=0;f<A.length;f++){const w=A[f],M=V(k[f]-P,w.minimumSize,w.maximumSize),I=M-k[f];P+=I,w.size=M}return r},this._orientation=(i=t.orientation)!==null&&i!==void 0?i:y.VERTICAL,this.element=this.createContainer(),this.margin=(n=t.margin)!==null&&n!==void 0?n:0,this.proportionalLayout=t.proportionalLayout===void 0?!0:!!t.proportionalLayout,this.viewContainer=this.createViewContainer(),this.sashContainer=this.createSashContainer(),this.element.appendChild(this.sashContainer),this.element.appendChild(this.viewContainer),this.container.appendChild(this.element),this.style(t.styles),t.descriptor&&(this._size=t.descriptor.size,t.descriptor.views.forEach((o,r)=>{const a=o.visible===void 0||o.visible?o.size:{type:"invisible",cachedVisibleSize:o.size},s=o.view;this.addView(s,a,r,!0)}),this._contentSize=this.viewItems.reduce((o,r)=>o+r.size,0),this.saveProportions())}style(e){e?.separatorBorder==="transparent"?(te(this.element,"dv-separator-border"),this.element.style.removeProperty("--dv-separator-border")):(ie(this.element,"dv-separator-border"),e?.separatorBorder&&this.element.style.setProperty("--dv-separator-border",e.separatorBorder))}isViewVisible(e){if(e<0||e>=this.viewItems.length)throw new Error("Index out of bounds");return this.viewItems[e].visible}setViewVisible(e,t){if(e<0||e>=this.viewItems.length)throw new Error("Index out of bounds");const i=this.viewItems[e];i.setVisible(t,i.size),this.distributeEmptySpace(e),this.layoutViews(),this.saveProportions()}getViewSize(e){return e<0||e>=this.viewItems.length?-1:this.viewItems[e].size}resizeView(e,t){if(e<0||e>=this.viewItems.length)return;const i=Q(this.viewItems.length).filter(a=>a!==e),n=[...i.filter(a=>this.viewItems[a].priority===F.Low),e],o=i.filter(a=>this.viewItems[a].priority===F.High),r=this.viewItems[e];t=Math.round(t),t=V(t,r.minimumSize,Math.min(r.maximumSize,this._size)),r.size=t,this.relayout(n,o)}getViews(){return this.viewItems.map(e=>e.view)}onDidChange(e,t){const i=this.viewItems.indexOf(e);if(i<0||i>=this.viewItems.length)return;t=typeof t=="number"?t:e.size,t=V(t,e.minimumSize,e.maximumSize),e.size=t;const n=Q(this.viewItems.length).filter(a=>a!==i),o=[...n.filter(a=>this.viewItems[a].priority===F.Low),i],r=n.filter(a=>this.viewItems[a].priority===F.High);this.relayout([...o,i],r)}addView(e,t={type:"distribute"},i=this.viewItems.length,n){const o=document.createElement("div");o.className="dv-view",o.appendChild(e.element);let r;typeof t=="number"?r=t:t.type==="split"?r=this.getViewSize(t.index)/2:t.type==="invisible"?r={cachedVisibleSize:t.cachedVisibleSize}:r=e.minimumSize;const a=e.onDidChange(d=>this.onDidChange(s,d.size)),s=new Ji(o,e,r,{dispose:()=>{a.dispose(),this.viewContainer.removeChild(o)}});if(i===this.viewItems.length?this.viewContainer.appendChild(o):this.viewContainer.insertBefore(o,this.viewContainer.children.item(i)),this.viewItems.splice(i,0,s),this.viewItems.length>1){const d=document.createElement("div");d.className="dv-sash";const l=v=>{for(const f of this.viewItems)f.enabled=!1;const p=Oe(),b=this._orientation===y.HORIZONTAL?v.clientX:v.clientY,u=ji(this.sashes,f=>f.container===d),g=this.viewItems.map(f=>f.size);let D,A;const k=Q(u,-1),_=Q(u+1,this.viewItems.length),T=k.reduce((f,w)=>f+(this.viewItems[w].minimumSize-g[w]),0),R=k.reduce((f,w)=>f+(this.viewItems[w].viewMaximumSize-g[w]),0),C=_.length===0?Number.POSITIVE_INFINITY:_.reduce((f,w)=>f+(g[w]-this.viewItems[w].minimumSize),0),O=_.length===0?Number.NEGATIVE_INFINITY:_.reduce((f,w)=>f+(g[w]-this.viewItems[w].viewMaximumSize),0),E=Math.max(T,O),L=Math.min(C,R),U=this.findFirstSnapIndex(k),j=this.findFirstSnapIndex(_);if(typeof U=="number"){const f=this.viewItems[U],w=Math.floor(f.viewMinimumSize/2);D={index:U,limitDelta:f.visible?E-w:E+w,size:f.size}}if(typeof j=="number"){const f=this.viewItems[j],w=Math.floor(f.viewMinimumSize/2);A={index:j,limitDelta:f.visible?L+w:L-w,size:f.size}}const Z=f=>{const w=(this._orientation===y.HORIZONTAL?f.clientX:f.clientY)-b;this.resize(u,w,g,void 0,void 0,E,L,D,A),this.distributeEmptySpace(),this.layoutViews()},P=()=>{for(const f of this.viewItems)f.enabled=!0;p.release(),this.saveProportions(),document.removeEventListener("pointermove",Z),document.removeEventListener("pointerup",P),document.removeEventListener("pointercancel",P),document.removeEventListener("contextmenu",P),this._onDidSashEnd.fire(void 0)};document.addEventListener("pointermove",Z),document.addEventListener("pointerup",P),document.addEventListener("pointercancel",P),document.addEventListener("contextmenu",P)};d.addEventListener("pointerdown",l);const h={container:d,disposable:()=>{d.removeEventListener("pointerdown",l),this.sashContainer.removeChild(d)}};this.sashContainer.appendChild(d),this.sashes.push(h)}n||this.relayout([i]),!n&&typeof t!="number"&&t.type==="distribute"&&this.distributeViewSizes(),this._onDidAddView.fire(e)}distributeViewSizes(){const e=[];let t=0;for(const a of this.viewItems)a.maximumSize-a.minimumSize>0&&(e.push(a),t+=a.size);const i=Math.floor(t/e.length);for(const a of e)a.size=V(i,a.minimumSize,a.maximumSize);const n=Q(this.viewItems.length),o=n.filter(a=>this.viewItems[a].priority===F.Low),r=n.filter(a=>this.viewItems[a].priority===F.High);this.relayout(o,r)}removeView(e,t,i=!1){const n=this.viewItems.splice(e,1)[0];if(n.dispose(),this.viewItems.length>=1){const o=Math.max(e-1,0);this.sashes.splice(o,1)[0].disposable()}return i||this.relayout(),t&&t.type==="distribute"&&this.distributeViewSizes(),this._onDidRemoveView.fire(n.view),n.view}getViewCachedVisibleSize(e){if(e<0||e>=this.viewItems.length)throw new Error("Index out of bounds");return this.viewItems[e].cachedVisibleSize}moveView(e,t){const i=this.getViewCachedVisibleSize(e),n=typeof i>"u"?this.getViewSize(e):K.Invisible(i),o=this.removeView(e,void 0,!0);this.addView(o,n,t)}layout(e,t){const i=Math.max(this.size,this._contentSize);if(this.size=e,this.orthogonalSize=t,this.proportions){let n=0;for(let o=0;o<this.viewItems.length;o++){const r=this.viewItems[o],a=this.proportions[o];typeof a=="number"?n+=a:e-=r.size}for(let o=0;o<this.viewItems.length;o++){const r=this.viewItems[o],a=this.proportions[o];typeof a=="number"&&n>0&&(r.size=V(Math.round(a*e/n),r.minimumSize,r.maximumSize))}}else{const n=Q(this.viewItems.length),o=n.filter(a=>this.viewItems[a].priority===F.Low),r=n.filter(a=>this.viewItems[a].priority===F.High);this.resize(this.viewItems.length-1,e-i,void 0,o,r)}this.distributeEmptySpace(),this.layoutViews()}relayout(e,t){const i=this.viewItems.reduce((n,o)=>n+o.size,0);this.resize(this.viewItems.length-1,this._size-i,void 0,e,t),this.distributeEmptySpace(),this.layoutViews(),this.saveProportions()}distributeEmptySpace(e){const t=this.viewItems.reduce((a,s)=>a+s.size,0);let i=this.size-t;const n=Q(this.viewItems.length-1,-1),o=n.filter(a=>this.viewItems[a].priority===F.Low),r=n.filter(a=>this.viewItems[a].priority===F.High);for(const a of r)We(n,a);for(const a of o)ke(n,a);typeof e=="number"&&ke(n,e);for(let a=0;i!==0&&a<n.length;a++){const s=this.viewItems[n[a]],d=V(s.size+i,s.minimumSize,s.maximumSize),l=d-s.size;i-=l,s.size=d}}saveProportions(){this.proportionalLayout&&this._contentSize>0&&(this._proportions=this.viewItems.map(e=>e.visible?e.size/this._contentSize:void 0))}layoutViews(){if(this._contentSize=this.viewItems.reduce((s,d)=>s+d.size,0),this.updateSashEnablement(),this.viewItems.length===0)return;const e=this.viewItems.filter(s=>s.visible),t=Math.max(0,e.length-1),i=this.margin*t/Math.max(1,e.length);let n=0;const o=[],r=4,a=this.viewItems.reduce((s,d,l)=>{const h=d.visible?1:0;return l===0?s.push(h):s.push(s[l-1]+h),s},[]);this.viewItems.forEach((s,d)=>{n+=this.viewItems[d].size,o.push(n);const l=s.visible?s.size-i:0,h=Math.max(0,a[d]-1),v=d===0||h===0?0:o[d-1]+h/t*i;if(d<this.viewItems.length-1){const p=s.visible?v+l-r/2+this.margin/2:v;this._orientation===y.HORIZONTAL&&(this.sashes[d].container.style.left=`${p}px`,this.sashes[d].container.style.top="0px"),this._orientation===y.VERTICAL&&(this.sashes[d].container.style.left="0px",this.sashes[d].container.style.top=`${p}px`)}this._orientation===y.HORIZONTAL&&(s.container.style.width=`${l}px`,s.container.style.left=`${v}px`,s.container.style.top="",s.container.style.height=""),this._orientation===y.VERTICAL&&(s.container.style.height=`${l}px`,s.container.style.top=`${v}px`,s.container.style.width="",s.container.style.left=""),s.view.layout(s.size-i,this._orthogonalSize)})}findFirstSnapIndex(e){for(const t of e){const i=this.viewItems[t];if(i.visible&&i.snap)return t}for(const t of e){const i=this.viewItems[t];if(i.visible&&i.maximumSize-i.minimumSize>0)return;if(!i.visible&&i.snap)return t}}updateSashEnablement(){let e=!1;const t=this.viewItems.map(s=>e=s.size-s.minimumSize>0||e);e=!1;const i=this.viewItems.map(s=>e=s.maximumSize-s.size>0||e),n=[...this.viewItems].reverse();e=!1;const o=n.map(s=>e=s.size-s.minimumSize>0||e).reverse();e=!1;const r=n.map(s=>e=s.maximumSize-s.size>0||e).reverse();let a=0;for(let s=0;s<this.sashes.length;s++){const d=this.sashes[s],l=this.viewItems[s];a+=l.size;const h=!(t[s]&&r[s+1]),v=!(i[s]&&o[s+1]);if(h&&v){const p=Q(s,-1),b=Q(s+1,this.viewItems.length),u=this.findFirstSnapIndex(p),g=this.findFirstSnapIndex(b),D=typeof u=="number"&&!this.viewItems[u].visible,A=typeof g=="number"&&!this.viewItems[g].visible;D&&o[s]&&(a>0||this.startSnappingEnabled)?this.updateSash(d,X.MINIMUM):A&&t[s]&&(a<this._contentSize||this.endSnappingEnabled)?this.updateSash(d,X.MAXIMUM):this.updateSash(d,X.DISABLED)}else h&&!v?this.updateSash(d,X.MINIMUM):!h&&v?this.updateSash(d,X.MAXIMUM):this.updateSash(d,X.ENABLED)}}updateSash(e,t){x(e.container,"dv-disabled",t===X.DISABLED),x(e.container,"dv-enabled",t===X.ENABLED),x(e.container,"dv-maximum",t===X.MAXIMUM),x(e.container,"dv-minimum",t===X.MINIMUM)}createViewContainer(){const e=document.createElement("div");return e.className="dv-view-container",e}createSashContainer(){const e=document.createElement("div");return e.className="dv-sash-container",e}createContainer(){const e=document.createElement("div");return e.className=`dv-split-view-container ${this._orientation===y.HORIZONTAL?"dv-horizontal":"dv-vertical"}`,e}dispose(){this._onDidSashEnd.dispose(),this._onDidAddView.dispose(),this._onDidRemoveView.dispose();for(let e=0;e<this.element.children.length;e++)if(this.element.children.item(e)===this.element){this.element.removeChild(this.element);break}for(const e of this.viewItems)e.dispose();this.element.remove()}},Ue=Object.keys({orientation:void 0,descriptor:void 0,proportionalLayout:void 0,styles:void 0,margin:void 0,disableAutoResizing:void 0,className:void 0}),pt=class extends z{get onDidAddView(){return this.splitview.onDidAddView}get onDidRemoveView(){return this.splitview.onDidRemoveView}get minimumSize(){return this.splitview.minimumSize}get maximumSize(){return this.splitview.maximumSize}get orientation(){return this.splitview.orientation}get size(){return this.splitview.size}get orthogonalSize(){return this.splitview.orthogonalSize}constructor(e,t){var i;super(),this.paneItems=[],this.skipAnimation=!1,this._onDidChange=new c,this.onDidChange=this._onDidChange.event,this._orientation=(i=t.orientation)!==null&&i!==void 0?i:y.VERTICAL,this.element=document.createElement("div"),this.element.className="dv-pane-container",e.appendChild(this.element),this.splitview=new De(this.element,{orientation:this._orientation,proportionalLayout:!1,descriptor:t.descriptor}),this.getPanes().forEach(n=>{const o=new z(n.onDidChangeExpansionState(()=>{this.setupAnimation(),this._onDidChange.fire(void 0)})),r={pane:n,disposable:{dispose:()=>{o.dispose()}}};this.paneItems.push(r),n.orthogonalSize=this.splitview.orthogonalSize}),this.addDisposables(this._onDidChange,this.splitview.onDidSashEnd(()=>{this._onDidChange.fire(void 0)}),this.splitview.onDidAddView(()=>{this._onDidChange.fire()}),this.splitview.onDidRemoveView(()=>{this._onDidChange.fire()}))}setViewVisible(e,t){this.splitview.setViewVisible(e,t)}addPane(e,t,i=this.splitview.length,n=!1){const o=e.onDidChangeExpansionState(()=>{this.setupAnimation(),this._onDidChange.fire(void 0)}),r={pane:e,disposable:{dispose:()=>{o.dispose()}}};this.paneItems.splice(i,0,r),e.orthogonalSize=this.splitview.orthogonalSize,this.splitview.addView(e,t,i,n)}getViewSize(e){return this.splitview.getViewSize(e)}getPanes(){return this.splitview.getViews()}removePane(e,t={skipDispose:!1}){const i=this.paneItems.splice(e,1)[0];return this.splitview.removeView(e),t.skipDispose||(i.disposable.dispose(),i.pane.dispose()),i}moveView(e,t){if(e===t)return;const i=this.removePane(e,{skipDispose:!0});this.skipAnimation=!0;try{this.addPane(i.pane,i.pane.size,t,!1)}finally{this.skipAnimation=!1}}layout(e,t){this.splitview.layout(e,t)}setupAnimation(){this.skipAnimation||(this.animationTimer&&(clearTimeout(this.animationTimer),this.animationTimer=void 0),ie(this.element,"dv-animated"),this.animationTimer=setTimeout(()=>{this.animationTimer=void 0,te(this.element,"dv-animated")},200))}dispose(){super.dispose(),this.animationTimer&&(clearTimeout(this.animationTimer),this.animationTimer=void 0),this.paneItems.forEach(e=>{e.disposable.dispose(),e.pane.dispose()}),this.paneItems=[],this.splitview.dispose(),this.element.remove()}},$=class{get minimumWidth(){return this.view.minimumWidth}get maximumWidth(){return this.view.maximumWidth}get minimumHeight(){return this.view.minimumHeight}get maximumHeight(){return this.view.maximumHeight}get priority(){return this.view.priority}get snap(){return this.view.snap}get minimumSize(){return this.orientation===y.HORIZONTAL?this.minimumHeight:this.minimumWidth}get maximumSize(){return this.orientation===y.HORIZONTAL?this.maximumHeight:this.maximumWidth}get minimumOrthogonalSize(){return this.orientation===y.HORIZONTAL?this.minimumWidth:this.minimumHeight}get maximumOrthogonalSize(){return this.orientation===y.HORIZONTAL?this.maximumWidth:this.maximumHeight}get orthogonalSize(){return this._orthogonalSize}get size(){return this._size}get element(){return this.view.element}get width(){return this.orientation===y.HORIZONTAL?this.orthogonalSize:this.size}get height(){return this.orientation===y.HORIZONTAL?this.size:this.orthogonalSize}constructor(e,t,i,n=0){this.view=e,this.orientation=t,this._onDidChange=new c,this.onDidChange=this._onDidChange.event,this._orthogonalSize=i,this._size=n,this._disposable=this.view.onDidChange(o=>{o?this._onDidChange.fire({size:this.orientation===y.VERTICAL?o.width:o.height,orthogonalSize:this.orientation===y.VERTICAL?o.height:o.width}):this._onDidChange.fire({})})}setVisible(e){this.view.setVisible&&this.view.setVisible(e)}layout(e,t){this._size=e,this._orthogonalSize=t,this.view.layout(this.width,this.height)}dispose(){this._onDidChange.dispose(),this._disposable.dispose()}},H=class $e extends z{get width(){return this.orientation===y.HORIZONTAL?this.size:this.orthogonalSize}get height(){return this.orientation===y.HORIZONTAL?this.orthogonalSize:this.size}get minimumSize(){return this.children.length===0?0:Math.max(...this.children.map((t,i)=>this.splitview.isViewVisible(i)?t.minimumOrthogonalSize:0))}get maximumSize(){return Math.min(...this.children.map((t,i)=>this.splitview.isViewVisible(i)?t.maximumOrthogonalSize:Number.POSITIVE_INFINITY))}get minimumOrthogonalSize(){return this.splitview.minimumSize}get maximumOrthogonalSize(){return this.splitview.maximumSize}get orthogonalSize(){return this._orthogonalSize}get size(){return this._size}get minimumWidth(){return this.orientation===y.HORIZONTAL?this.minimumOrthogonalSize:this.minimumSize}get minimumHeight(){return this.orientation===y.HORIZONTAL?this.minimumSize:this.minimumOrthogonalSize}get maximumWidth(){return this.orientation===y.HORIZONTAL?this.maximumOrthogonalSize:this.maximumSize}get maximumHeight(){return this.orientation===y.HORIZONTAL?this.maximumSize:this.maximumOrthogonalSize}get priority(){if(this.children.length===0)return F.Normal;const t=this.children.map(i=>typeof i.priority>"u"?F.Normal:i.priority);return t.some(i=>i===F.High)?F.High:t.some(i=>i===F.Low)?F.Low:F.Normal}get disabled(){return this.splitview.disabled}set disabled(t){this.splitview.disabled=t}get margin(){return this.splitview.margin}set margin(t){this.splitview.margin=t,this.children.forEach(i=>{i instanceof $e&&(i.margin=t)})}constructor(t,i,n,o,r,a,s,d){if(super(),this.orientation=t,this.proportionalLayout=i,this.styles=n,this._childrenDisposable=W.NONE,this.children=[],this._onDidChange=new c,this.onDidChange=this._onDidChange.event,this._onDidVisibilityChange=new c,this.onDidVisibilityChange=this._onDidVisibilityChange.event,this._orthogonalSize=r,this._size=o,this.element=document.createElement("div"),this.element.className="dv-branch-node",!d)this.splitview=new De(this.element,{orientation:this.orientation,proportionalLayout:i,styles:n,margin:s}),this.splitview.layout(this.size,this.orthogonalSize);else{const l={views:d.map(h=>({view:h.node,size:h.node.size,visible:h.node instanceof $&&h.visible!==void 0?h.visible:!0})),size:this.orthogonalSize};this.children=d.map(h=>h.node),this.splitview=new De(this.element,{orientation:this.orientation,descriptor:l,proportionalLayout:i,styles:n,margin:s})}this.disabled=a,this.addDisposables(this._onDidChange,this._onDidVisibilityChange,this.splitview.onDidSashEnd(()=>{this._onDidChange.fire({})})),this.setupChildrenEvents()}setVisible(t){}isChildVisible(t){if(t<0||t>=this.children.length)throw new Error("Invalid index");return this.splitview.isViewVisible(t)}setChildVisible(t,i){if(t<0||t>=this.children.length)throw new Error("Invalid index");if(this.splitview.isViewVisible(t)===i)return;const n=this.splitview.contentSize===0;this.splitview.setViewVisible(t,i);const o=this.splitview.contentSize===0;(i&&n||!i&&o)&&this._onDidVisibilityChange.fire({visible:i})}moveChild(t,i){if(t===i)return;if(t<0||t>=this.children.length)throw new Error("Invalid from index");t<i&&i--,this.splitview.moveView(t,i);const n=this._removeChild(t);this._addChild(n,i)}getChildSize(t){if(t<0||t>=this.children.length)throw new Error("Invalid index");return this.splitview.getViewSize(t)}resizeChild(t,i){if(t<0||t>=this.children.length)throw new Error("Invalid index");this.splitview.resizeView(t,i)}layout(t,i){this._size=i,this._orthogonalSize=t,this.splitview.layout(i,t)}addChild(t,i,n,o){if(n<0||n>this.children.length)throw new Error("Invalid index");this.splitview.addView(t,i,n,o),this._addChild(t,n)}getChildCachedVisibleSize(t){if(t<0||t>=this.children.length)throw new Error("Invalid index");return this.splitview.getViewCachedVisibleSize(t)}removeChild(t,i){if(t<0||t>=this.children.length)throw new Error("Invalid index");return this.splitview.removeView(t,i),this._removeChild(t)}_addChild(t,i){this.children.splice(i,0,t),this.setupChildrenEvents()}_removeChild(t){const[i]=this.children.splice(t,1);return this.setupChildrenEvents(),i}setupChildrenEvents(){this._childrenDisposable.dispose(),this._childrenDisposable=new z(ce.any(...this.children.map(t=>t.onDidChange))(t=>{this._onDidChange.fire({size:t.orthogonalSize})}),...this.children.map((t,i)=>t instanceof $e?t.onDidVisibilityChange(({visible:n})=>{this.setChildVisible(i,n)}):W.NONE))}dispose(){this._childrenDisposable.dispose(),this.splitview.dispose(),this.children.forEach(t=>t.dispose()),super.dispose()}};function je(e,t){if(e instanceof $)return e;if(e instanceof H)return je(e.children[t?e.children.length-1:0],t);throw new Error("invalid node")}function Bt(e,t,i){if(e instanceof H){const n=new H(e.orientation,e.proportionalLayout,e.styles,t,i,e.disabled,e.margin);for(let o=e.children.length-1;o>=0;o--){const r=e.children[o];n.addChild(Bt(r,r.size,r.orthogonalSize),r.size,0,!0)}return n}else return new $(e.view,e.orientation,i)}function Je(e,t,i){if(e instanceof H){const n=new H(oe(e.orientation),e.proportionalLayout,e.styles,t,i,e.disabled,e.margin);let o=0;for(let r=e.children.length-1;r>=0;r--){const a=e.children[r],s=a instanceof H?a.orthogonalSize:a.size;let d=e.size===0?0:Math.round(t*s/e.size);o+=d,r===0&&(d+=t-o),n.addChild(Je(a,i,d),d,0,!0)}return n}else return new $(e.view,oe(e.orientation),i)}function Yi(e){const t=e.parentElement;if(!t)throw new Error("Invalid grid element");let i=t.firstElementChild,n=0;for(;i!==e&&i!==t.lastElementChild&&i;)i=i.nextElementSibling,n++;return n}function N(e){const t=e.parentElement;if(!t)throw new Error("Invalid grid element");if(/\bdv-grid-view\b/.test(t.className))return[];const i=Yi(t),n=t.parentElement.parentElement.parentElement;return[...N(n),i]}function ne(e,t,i){if(Xi(e,t)===Zi(i)){const[n,o]=re(t);let r=o;return(i==="right"||i==="bottom")&&(r+=1),[...n,r]}else{const n=i==="right"||i==="bottom"?1:0;return[...t,n]}}function Zi(e){return e==="top"||e==="bottom"?y.VERTICAL:y.HORIZONTAL}function Xi(e,t){return t.length%2===0?oe(e):e}var oe=e=>e===y.HORIZONTAL?y.VERTICAL:y.HORIZONTAL;function Ki(e){return!!e.children}var Ye=(e,t)=>{const i=t===y.VERTICAL?e.box.width:e.box.height;return Ki(e)?{type:"branch",data:e.children.map(n=>Ye(n,oe(t))),size:i}:typeof e.cachedVisibleSize=="number"?{type:"leaf",data:e.view.toJSON(),size:e.cachedVisibleSize,visible:!1}:{type:"leaf",data:e.view.toJSON(),size:i}},qi=class{get length(){return this._root?this._root.children.length:0}get orientation(){return this.root.orientation}set orientation(e){if(this.root.orientation===e)return;const{size:t,orthogonalSize:i}=this.root;this.root=Je(this.root,i,t),this.root.layout(t,i)}get width(){return this.root.width}get height(){return this.root.height}get minimumWidth(){return this.root.minimumWidth}get minimumHeight(){return this.root.minimumHeight}get maximumWidth(){return this.root.maximumHeight}get maximumHeight(){return this.root.maximumHeight}get locked(){return this._locked}set locked(e){this._locked=e;const t=[this.root];for(;t.length>0;){const i=t.pop();i instanceof H&&(i.disabled=e,t.push(...i.children))}}get margin(){return this._margin}set margin(e){this._margin=e,this.root.margin=e}maximizedView(){var e;return(e=this._maximizedNode)===null||e===void 0?void 0:e.leaf.view}hasMaximizedView(){return this._maximizedNode!==void 0}maximizeView(e){var t;const i=N(e.element),[n,o]=this.getNode(i);if(!(o instanceof $)||((t=this._maximizedNode)===null||t===void 0?void 0:t.leaf)===o)return;this.hasMaximizedView()&&this.exitMaximizedView(),Ye(this.getView(),this.orientation);const r=[];function a(s,d){for(let l=0;l<s.children.length;l++){const h=s.children[l];h instanceof $?h!==d&&(s.isChildVisible(l)?s.setChildVisible(l,!1):r.push(h)):a(h,d)}}a(this.root,o),this._maximizedNode={leaf:o,hiddenOnMaximize:r},this._onDidMaximizedNodeChange.fire({view:o.view,isMaximized:!0})}exitMaximizedView(){if(!this._maximizedNode)return;const e=this._maximizedNode.hiddenOnMaximize;function t(n){for(let o=n.children.length-1;o>=0;o--){const r=n.children[o];r instanceof $?e.includes(r)||n.setChildVisible(o,!0):t(r)}}t(this.root);const i=this._maximizedNode.leaf;this._maximizedNode=void 0,this._onDidMaximizedNodeChange.fire({view:i.view,isMaximized:!1})}serialize(){const e=this.maximizedView();let t;e&&(t=N(e.element)),this.hasMaximizedView()&&this.exitMaximizedView();const i={root:Ye(this.getView(),this.orientation),width:this.width,height:this.height,orientation:this.orientation};return t&&(i.maximizedNode={location:t}),e&&this.maximizeView(e),i}dispose(){this.disposable.dispose(),this._onDidChange.dispose(),this._onDidMaximizedNodeChange.dispose(),this._onDidViewVisibilityChange.dispose(),this.root.dispose(),this._maximizedNode=void 0,this.element.remove()}clear(){const e=this.root.orientation;this.root=new H(e,this.proportionalLayout,this.styles,this.root.size,this.root.orthogonalSize,this.locked,this.margin)}deserialize(e,t){const i=e.orientation,n=i===y.VERTICAL?e.height:e.width;if(this._deserialize(e.root,i,t,n),this.layout(e.width,e.height),e.maximizedNode){const o=e.maximizedNode.location,[r,a]=this.getNode(o);if(!(a instanceof $))return;this.maximizeView(a.view)}}_deserialize(e,t,i,n){this.root=this._deserializeNode(e,t,i,n)}_deserializeNode(e,t,i,n){var o;let r;if(e.type==="branch"){const a=e.data.map(s=>({node:this._deserializeNode(s,oe(t),i,e.size),visible:s.visible}));r=new H(t,this.proportionalLayout,this.styles,e.size,n,this.locked,this.margin,a)}else{const a=i.fromJSON(e);typeof e.visible=="boolean"&&((o=a.setVisible)===null||o===void 0||o.call(a,e.visible)),r=new $(a,t,n,e.size)}return r}get root(){return this._root}set root(e){const t=this._root;t&&(t.dispose(),this._maximizedNode=void 0,this.element.removeChild(t.element)),this._root=e,this.element.appendChild(this._root.element),this.disposable.value=this._root.onDidChange(i=>{this._onDidChange.fire(i)})}normalize(){if(!this._root||this._root.children.length!==1)return;const e=this.root,t=e.children[0];if(t instanceof $)return;e.element.remove();const i=e.removeChild(0);e.dispose(),i.dispose(),this._root=Bt(t,t.size,t.orthogonalSize),this.element.appendChild(this._root.element),this.disposable.value=this._root.onDidChange(n=>{this._onDidChange.fire(n)})}insertOrthogonalSplitviewAtRoot(){if(!this._root)return;const e=this.root;if(e.element.remove(),this._root=new H(oe(e.orientation),this.proportionalLayout,this.styles,this.root.orthogonalSize,this.root.size,this.locked,this.margin),e.children.length!==0)if(e.children.length===1){const t=e.children[0];e.removeChild(0).dispose(),e.dispose(),this._root.addChild(Je(t,t.orthogonalSize,t.size),K.Distribute,0)}else this._root.addChild(e,K.Distribute,0);this.element.appendChild(this._root.element),this.disposable.value=this._root.onDidChange(t=>{this._onDidChange.fire(t)})}next(e){return this.progmaticSelect(e)}previous(e){return this.progmaticSelect(e,!0)}getView(e){const t=e?this.getNode(e)[1]:this.root;return this._getViews(t,this.orientation)}_getViews(e,t,i){const n={height:e.height,width:e.width};if(e instanceof $)return{box:n,view:e.view,cachedVisibleSize:i};const o=[];for(let r=0;r<e.children.length;r++){const a=e.children[r],s=e.getChildCachedVisibleSize(r);o.push(this._getViews(a,oe(t),s))}return{box:n,children:o}}progmaticSelect(e,t=!1){const[i,n]=this.getNode(e);if(!(n instanceof $))throw new Error("invalid location");for(let o=i.length-1;o>-1;o--){const r=i[o],a=e[o]||0;if(t?a-1>-1:a+1<r.children.length)return je(r.children[t?a-1:a+1],t)}return je(this.root,t)}constructor(e,t,i,n,o){this.proportionalLayout=e,this.styles=t,this._locked=!1,this._margin=0,this._maximizedNode=void 0,this.disposable=new B,this._onDidChange=new c,this.onDidChange=this._onDidChange.event,this._onDidViewVisibilityChange=new c,this.onDidViewVisibilityChange=this._onDidViewVisibilityChange.event,this._onDidMaximizedNodeChange=new c,this.onDidMaximizedNodeChange=this._onDidMaximizedNodeChange.event,this.element=document.createElement("div"),this.element.className="dv-grid-view",this._locked=n??!1,this._margin=o??0,this.root=new H(i,e,t,0,0,this.locked,this.margin)}isViewVisible(e){const[t,i]=re(e),[,n]=this.getNode(t);if(!(n instanceof H))throw new Error("Invalid from location");return n.isChildVisible(i)}setViewVisible(e,t){this.hasMaximizedView()&&this.exitMaximizedView();const[i,n]=re(e),[,o]=this.getNode(i);if(!(o instanceof H))throw new Error("Invalid from location");this._onDidViewVisibilityChange.fire(),o.setChildVisible(n,t)}moveView(e,t,i){this.hasMaximizedView()&&this.exitMaximizedView();const[,n]=this.getNode(e);if(!(n instanceof H))throw new Error("Invalid location");n.moveChild(t,i)}addView(e,t,i){this.hasMaximizedView()&&this.exitMaximizedView();const[n,o]=re(i),[r,a]=this.getNode(n);if(a instanceof H){const s=new $(e,oe(a.orientation),a.orthogonalSize);a.addChild(s,t,o)}else{const[s,...d]=[...r].reverse(),[l,...h]=[...n].reverse();let v=0;const p=s.getChildCachedVisibleSize(l);typeof p=="number"&&(v=K.Invisible(p)),s.removeChild(l).dispose();const b=new H(a.orientation,this.proportionalLayout,this.styles,a.size,a.orthogonalSize,this.locked,this.margin);s.addChild(b,a.size,l);const u=new $(a.view,s.orientation,a.size);b.addChild(u,v,0),typeof t!="number"&&t.type==="split"&&(t={type:"split",index:0});const g=new $(e,s.orientation,a.size);b.addChild(g,t,o)}}remove(e,t){const i=N(e.element);return this.removeView(i,t)}removeView(e,t){this.hasMaximizedView()&&this.exitMaximizedView();const[i,n]=re(e),[o,r]=this.getNode(i);if(!(r instanceof H))throw new Error("Invalid location");const a=r.children[n];if(!(a instanceof $))throw new Error("Invalid location");if(r.removeChild(n,t),a.dispose(),r.children.length!==1)return a.view;const s=r.children[0];if(o.length===0)return s instanceof $||(r.removeChild(0,t),this.root=s),a.view;const[d,...l]=[...o].reverse(),[h,...v]=[...i].reverse(),p=r.isChildVisible(0);r.removeChild(0,t);const b=d.children.map((u,g)=>d.getChildSize(g));if(d.removeChild(h,t).dispose(),s instanceof H){b.splice(h,1,...s.children.map(u=>u.size));for(let u=0;u<s.children.length;u++){const g=s.children[u];d.addChild(g,g.size,h+u)}for(;s.children.length>0;)s.removeChild(0)}else{const u=new $(s.view,oe(s.orientation),s.size),g=p?s.orthogonalSize:K.Invisible(s.orthogonalSize);d.addChild(u,g,h)}s.dispose();for(let u=0;u<b.length;u++)d.resizeChild(u,b[u]);return a.view}layout(e,t){const[i,n]=this.root.orientation===y.HORIZONTAL?[t,e]:[e,t];this.root.layout(i,n)}getNode(e,t=this.root,i=[]){if(e.length===0)return[i,t];if(!(t instanceof H))throw new Error("Invalid location");const[n,...o]=e;if(n<0||n>=t.children.length)throw new Error("Invalid location");const r=t.children[n];return i.push(t),this.getNode(o,r,i)}},Ze=Object.keys({disableAutoResizing:void 0,proportionalLayout:void 0,orientation:void 0,hideBorders:void 0,className:void 0}),it=class extends z{get element(){return this._element}get disableResizing(){return this._disableResizing}set disableResizing(e){this._disableResizing=e}constructor(e,t=!1){super(),this._disableResizing=t,this._element=e,this.addDisposables(Re(this._element,i=>{if(this.isDisposed||this.disableResizing||!this._element.offsetParent||!Vi(this._element))return;const{width:n,height:o}=i.contentRect;this.layout(n,o)}))}},Qi=tt();function Ge(e){switch(e){case"left":return"left";case"right":return"right";case"above":return"top";case"below":return"bottom";default:return"center"}}var Ut=class extends it{get id(){return this._id}get size(){return this._groups.size}get groups(){return Array.from(this._groups.values()).map(e=>e.value)}get width(){return this.gridview.width}get height(){return this.gridview.height}get minimumHeight(){return this.gridview.minimumHeight}get maximumHeight(){return this.gridview.maximumHeight}get minimumWidth(){return this.gridview.minimumWidth}get maximumWidth(){return this.gridview.maximumWidth}get activeGroup(){return this._activeGroup}get locked(){return this.gridview.locked}set locked(e){this.gridview.locked=e}constructor(e,t){var i;super(document.createElement("div"),t.disableAutoResizing),this._id=Qi.next(),this._groups=new Map,this._onDidRemove=new c,this.onDidRemove=this._onDidRemove.event,this._onDidAdd=new c,this.onDidAdd=this._onDidAdd.event,this._onDidMaximizedChange=new c,this.onDidMaximizedChange=this._onDidMaximizedChange.event,this._onDidActiveChange=new c,this.onDidActiveChange=this._onDidActiveChange.event,this._bufferOnDidLayoutChange=new ct,this.onDidLayoutChange=this._bufferOnDidLayoutChange.onEvent,this._onDidViewVisibilityChangeMicroTaskQueue=new ct,this.onDidViewVisibilityChangeMicroTaskQueue=this._onDidViewVisibilityChangeMicroTaskQueue.onEvent,this.element.style.height="100%",this.element.style.width="100%",this._classNames=new Le(this.element),this._classNames.setClassNames((i=t.className)!==null&&i!==void 0?i:""),e.appendChild(this.element),this.gridview=new qi(!!t.proportionalLayout,t.styles,t.orientation,t.locked,t.margin),this.gridview.locked=!!t.locked,this.element.appendChild(this.gridview.element),this.layout(0,0,!0),this.addDisposables(this.gridview.onDidMaximizedNodeChange(n=>{this._onDidMaximizedChange.fire({panel:n.view,isMaximized:n.isMaximized})}),this.gridview.onDidViewVisibilityChange(()=>this._onDidViewVisibilityChangeMicroTaskQueue.fire()),this.onDidViewVisibilityChangeMicroTaskQueue(()=>{this.layout(this.width,this.height,!0)}),W.from(()=>{var n;(n=this.element.parentElement)===null||n===void 0||n.removeChild(this.element)}),this.gridview.onDidChange(()=>{this._bufferOnDidLayoutChange.fire()}),ce.any(this.onDidAdd,this.onDidRemove,this.onDidActiveChange)(()=>{this._bufferOnDidLayoutChange.fire()}),this._onDidMaximizedChange,this._onDidViewVisibilityChangeMicroTaskQueue,this._bufferOnDidLayoutChange)}setVisible(e,t){this.gridview.setViewVisible(N(e.element),t),this._bufferOnDidLayoutChange.fire()}isVisible(e){return this.gridview.isViewVisible(N(e.element))}updateOptions(e){var t,i,n,o;e.proportionalLayout,e.orientation&&(this.gridview.orientation=e.orientation),"disableResizing"in e&&(this.disableResizing=(t=e.disableAutoResizing)!==null&&t!==void 0?t:!1),"locked"in e&&(this.locked=(i=e.locked)!==null&&i!==void 0?i:!1),"margin"in e&&(this.gridview.margin=(n=e.margin)!==null&&n!==void 0?n:0),"className"in e&&this._classNames.setClassNames((o=e.className)!==null&&o!==void 0?o:"")}maximizeGroup(e){this.gridview.maximizeView(e),this.doSetGroupActive(e)}isMaximizedGroup(e){return this.gridview.maximizedView()===e}exitMaximizedGroup(){this.gridview.exitMaximizedView()}hasMaximizedGroup(){return this.gridview.hasMaximizedView()}doAddGroup(e,t=[0],i){this.gridview.addView(e,i??K.Distribute,t),this._onDidAdd.fire(e)}doRemoveGroup(e,t){if(!this._groups.has(e.id))throw new Error("invalid operation");const i=this._groups.get(e.id),n=this.gridview.remove(e,K.Distribute);if(i&&!t?.skipDispose&&(i.disposable.dispose(),i.value.dispose(),this._groups.delete(e.id),this._onDidRemove.fire(e)),!t?.skipActive&&this._activeGroup===e){const o=Array.from(this._groups.values());this.doSetGroupActive(o.length>0?o[0].value:void 0)}return n}getPanel(e){var t;return(t=this._groups.get(e))===null||t===void 0?void 0:t.value}doSetGroupActive(e){this._activeGroup!==e&&(this._activeGroup&&this._activeGroup.setActive(!1),e&&e.setActive(!0),this._activeGroup=e,this._onDidActiveChange.fire(e))}removeGroup(e){this.doRemoveGroup(e)}moveToNext(e){var t;if(e||(e={}),!e.group){if(!this.activeGroup)return;e.group=this.activeGroup}const i=N(e.group.element),n=(t=this.gridview.next(i))===null||t===void 0?void 0:t.view;this.doSetGroupActive(n)}moveToPrevious(e){var t;if(e||(e={}),!e.group){if(!this.activeGroup)return;e.group=this.activeGroup}const i=N(e.group.element),n=(t=this.gridview.previous(i))===null||t===void 0?void 0:t.view;this.doSetGroupActive(n)}layout(e,t,i){(i||e!==this.width||t!==this.height)&&(this.gridview.element.style.height=`${t}px`,this.gridview.element.style.width=`${e}px`,this.gridview.layout(e,t))}dispose(){this._onDidActiveChange.dispose(),this._onDidAdd.dispose(),this._onDidRemove.dispose();for(const e of this.groups)e.dispose();this.gridview.dispose(),super.dispose()}},$t=class{get minimumSize(){return this.component.minimumSize}get maximumSize(){return this.component.maximumSize}get width(){return this.component.width}get height(){return this.component.height}get length(){return this.component.length}get orientation(){return this.component.orientation}get panels(){return this.component.panels}get onDidLayoutFromJSON(){return this.component.onDidLayoutFromJSON}get onDidLayoutChange(){return this.component.onDidLayoutChange}get onDidAddView(){return this.component.onDidAddView}get onDidRemoveView(){return this.component.onDidRemoveView}constructor(e){this.component=e}removePanel(e,t){this.component.removePanel(e,t)}focus(){this.component.focus()}getPanel(e){return this.component.getPanel(e)}layout(e,t){return this.component.layout(e,t)}addPanel(e){return this.component.addPanel(e)}movePanel(e,t){this.component.movePanel(e,t)}fromJSON(e){this.component.fromJSON(e)}toJSON(){return this.component.toJSON()}clear(){this.component.clear()}updateOptions(e){this.component.updateOptions(e)}dispose(){this.component.dispose()}},Ce=class{get minimumSize(){return this.component.minimumSize}get maximumSize(){return this.component.maximumSize}get width(){return this.component.width}get height(){return this.component.height}get panels(){return this.component.panels}get onDidLayoutChange(){return this.component.onDidLayoutChange}get onDidLayoutFromJSON(){return this.component.onDidLayoutFromJSON}get onDidAddView(){return this.component.onDidAddView}get onDidRemoveView(){return this.component.onDidRemoveView}get onDidDrop(){return this.component.onDidDrop}get onUnhandledDragOverEvent(){return this.component.onUnhandledDragOverEvent}constructor(e){this.component=e}removePanel(e){this.component.removePanel(e)}getPanel(e){return this.component.getPanel(e)}movePanel(e,t){this.component.movePanel(e,t)}focus(){this.component.focus()}layout(e,t){this.component.layout(e,t)}addPanel(e){return this.component.addPanel(e)}fromJSON(e){this.component.fromJSON(e)}toJSON(){return this.component.toJSON()}clear(){this.component.clear()}updateOptions(e){this.component.updateOptions(e)}dispose(){this.component.dispose()}},jt=class{get width(){return this.component.width}get height(){return this.component.height}get minimumHeight(){return this.component.minimumHeight}get maximumHeight(){return this.component.maximumHeight}get minimumWidth(){return this.component.minimumWidth}get maximumWidth(){return this.component.maximumWidth}get onDidLayoutChange(){return this.component.onDidLayoutChange}get onDidAddPanel(){return this.component.onDidAddGroup}get onDidRemovePanel(){return this.component.onDidRemoveGroup}get onDidActivePanelChange(){return this.component.onDidActiveGroupChange}get onDidLayoutFromJSON(){return this.component.onDidLayoutFromJSON}get panels(){return this.component.groups}get orientation(){return this.component.orientation}set orientation(e){this.component.updateOptions({orientation:e})}constructor(e){this.component=e}focus(){this.component.focus()}layout(e,t,i=!1){this.component.layout(e,t,i)}addPanel(e){return this.component.addPanel(e)}removePanel(e,t){this.component.removePanel(e,t)}movePanel(e,t){this.component.movePanel(e,t)}getPanel(e){return this.component.getPanel(e)}fromJSON(e){return this.component.fromJSON(e)}toJSON(){return this.component.toJSON()}clear(){this.component.clear()}updateOptions(e){this.component.updateOptions(e)}dispose(){this.component.dispose()}},Te=class{get id(){return this.component.id}get width(){return this.component.width}get height(){return this.component.height}get minimumHeight(){return this.component.minimumHeight}get maximumHeight(){return this.component.maximumHeight}get minimumWidth(){return this.component.minimumWidth}get maximumWidth(){return this.component.maximumWidth}get size(){return this.component.size}get totalPanels(){return this.component.totalPanels}get onDidActiveGroupChange(){return this.component.onDidActiveGroupChange}get onDidAddGroup(){return this.component.onDidAddGroup}get onDidRemoveGroup(){return this.component.onDidRemoveGroup}get onDidActivePanelChange(){return this.component.onDidActivePanelChange}get onDidAddPanel(){return this.component.onDidAddPanel}get onDidRemovePanel(){return this.component.onDidRemovePanel}get onDidMovePanel(){return this.component.onDidMovePanel}get onDidLayoutFromJSON(){return this.component.onDidLayoutFromJSON}get onDidLayoutChange(){return this.component.onDidLayoutChange}get onDidDrop(){return this.component.onDidDrop}get onWillDrop(){return this.component.onWillDrop}get onWillShowOverlay(){return this.component.onWillShowOverlay}get onWillDragGroup(){return this.component.onWillDragGroup}get onWillDragPanel(){return this.component.onWillDragPanel}get onUnhandledDragOverEvent(){return this.component.onUnhandledDragOverEvent}get onDidPopoutGroupSizeChange(){return this.component.onDidPopoutGroupSizeChange}get onDidPopoutGroupPositionChange(){return this.component.onDidPopoutGroupPositionChange}get onDidOpenPopoutWindowFail(){return this.component.onDidOpenPopoutWindowFail}get panels(){return this.component.panels}get groups(){return this.component.groups}get activePanel(){return this.component.activePanel}get activeGroup(){return this.component.activeGroup}constructor(e){this.component=e}focus(){this.component.focus()}getPanel(e){return this.component.getGroupPanel(e)}layout(e,t,i=!1){this.component.layout(e,t,i)}addPanel(e){return this.component.addPanel(e)}removePanel(e){this.component.removePanel(e)}addGroup(e){return this.component.addGroup(e)}closeAllGroups(){return this.component.closeAllGroups()}removeGroup(e){this.component.removeGroup(e)}getGroup(e){return this.component.getPanel(e)}addFloatingGroup(e,t){return this.component.addFloatingGroup(e,t)}fromJSON(e,t){this.component.fromJSON(e,t)}toJSON(){return this.component.toJSON()}clear(){this.component.clear()}moveToNext(e){this.component.moveToNext(e)}moveToPrevious(e){this.component.moveToPrevious(e)}maximizeGroup(e){this.component.maximizeGroup(e.group)}hasMaximizedGroup(){return this.component.hasMaximizedGroup()}exitMaximizedGroup(){this.component.exitMaximizedGroup()}get onDidMaximizedGroupChange(){return this.component.onDidMaximizedGroupChange}addPopoutGroup(e,t){return this.component.addPopoutGroup(e,t)}updateOptions(e){this.component.updateOptions(e)}dispose(){this.component.dispose()}},nt=class extends z{constructor(e,t){super(),this.el=e,this.disabled=t,this.dataDisposable=new B,this.pointerEventsDisposable=new B,this._onDragStart=new c,this.onDragStart=this._onDragStart.event,this.addDisposables(this._onDragStart,this.dataDisposable,this.pointerEventsDisposable),this.configure()}setDisabled(e){this.disabled=e}isCancelled(e){return!1}configure(){this.addDisposables(this._onDragStart,S(this.el,"dragstart",e=>{if(e.defaultPrevented||this.isCancelled(e)||this.disabled){e.preventDefault();return}const t=Oe();this.pointerEventsDisposable.value={dispose:()=>{t.release()}},this.el.classList.add("dv-dragged"),setTimeout(()=>this.el.classList.remove("dv-dragged"),0),this.dataDisposable.value=this.getData(e),this._onDragStart.fire(e),e.dataTransfer&&(e.dataTransfer.effectAllowed="move",e.dataTransfer.items.length>0||e.dataTransfer.setData("text/plain",""))}),S(this.el,"dragend",()=>{this.pointerEventsDisposable.dispose(),setTimeout(()=>{this.dataDisposable.dispose()},0)}))}},Jt=class extends z{constructor(e,t){super(),this.element=e,this.callbacks=t,this.target=null,this.registerListeners()}onDragEnter(e){this.target=e.target,this.callbacks.onDragEnter(e)}onDragOver(e){e.preventDefault(),this.callbacks.onDragOver&&this.callbacks.onDragOver(e)}onDragLeave(e){this.target===e.target&&(this.target=null,this.callbacks.onDragLeave(e))}onDragEnd(e){this.target=null,this.callbacks.onDragEnd(e)}onDrop(e){this.callbacks.onDrop(e)}registerListeners(){this.addDisposables(S(this.element,"dragenter",e=>{this.onDragEnter(e)},!0)),this.addDisposables(S(this.element,"dragover",e=>{this.onDragOver(e)},!0)),this.addDisposables(S(this.element,"dragleave",e=>{this.onDragLeave(e)})),this.addDisposables(S(this.element,"dragend",e=>{this.onDragEnd(e)})),this.addDisposables(S(this.element,"drop",e=>{this.onDrop(e)}))}};function en(e,t){const{top:i,left:n,width:o,height:r}=t,a=`${Math.round(i)}px`,s=`${Math.round(n)}px`,d=`${Math.round(o)}px`,l=`${Math.round(r)}px`;e.style.top=a,e.style.left=s,e.style.width=d,e.style.height=l,e.style.visibility="visible",(!e.style.transform||e.style.transform==="")&&(e.style.transform="translate3d(0, 0, 0)")}function tn(e,t){const{top:i,left:n,width:o,height:r}=t;e.style.top=i,e.style.left=n,e.style.width=o,e.style.height=r,e.style.visibility="visible",(!e.style.transform||e.style.transform==="")&&(e.style.transform="translate3d(0, 0, 0)")}function nn(e,t){const{top:i,left:n,width:o,height:r}=t,a=`${Math.round(i)}px`,s=`${Math.round(n)}px`,d=`${Math.round(o)}px`,l=`${Math.round(r)}px`;return e.style.top!==a||e.style.left!==s||e.style.width!==d||e.style.height!==l}var on=class extends et{get nativeEvent(){return this.options.nativeEvent}get position(){return this.options.position}constructor(e){super(),this.options=e}};function ut(e){switch(e){case"above":return"top";case"below":return"bottom";case"left":return"left";case"right":return"right";case"within":return"center";default:throw new Error(`invalid direction '${e}'`)}}function rn(e){switch(e){case"top":return"above";case"bottom":return"below";case"left":return"left";case"right":return"right";case"center":return"within";default:throw new Error(`invalid position '${e}'`)}}var sn={value:20,type:"percentage"},an={value:50,type:"percentage"},dn=100,ln=100,we=class xe extends z{get disabled(){return this._disabled}set disabled(t){this._disabled=t}get state(){return this._state}constructor(t,i){super(),this.element=t,this.options=i,this._onDrop=new c,this.onDrop=this._onDrop.event,this._onWillShowOverlay=new c,this.onWillShowOverlay=this._onWillShowOverlay.event,this._disabled=!1,this._acceptedTargetZonesSet=new Set(this.options.acceptedTargetZones),this.dnd=new Jt(this.element,{onDragEnter:()=>{var n,o,r;(r=(o=(n=this.options).getOverrideTarget)===null||o===void 0?void 0:o.call(n))===null||r===void 0||r.getElements()},onDragOver:n=>{var o,r,a,s,d,l,h;xe.ACTUAL_TARGET=this;const v=(r=(o=this.options).getOverrideTarget)===null||r===void 0?void 0:r.call(o);if(this._acceptedTargetZonesSet.size===0){if(v)return;this.removeDropTarget();return}const p=(d=(s=(a=this.options).getOverlayOutline)===null||s===void 0?void 0:s.call(a))!==null&&d!==void 0?d:this.element,b=p.offsetWidth,u=p.offsetHeight;if(b===0||u===0)return;const g=n.currentTarget.getBoundingClientRect(),D=((l=n.clientX)!==null&&l!==void 0?l:0)-g.left,A=((h=n.clientY)!==null&&h!==void 0?h:0)-g.top,k=this.calculateQuadrant(this._acceptedTargetZonesSet,D,A,b,u);if(this.isAlreadyUsed(n)||k===null){this.removeDropTarget();return}if(!this.options.canDisplayOverlay(n,k)){if(v)return;this.removeDropTarget();return}const _=new on({nativeEvent:n,position:k});if(this._onWillShowOverlay.fire(_),_.defaultPrevented){this.removeDropTarget();return}this.markAsUsed(n),v||this.targetElement||(this.targetElement=document.createElement("div"),this.targetElement.className="dv-drop-target-dropzone",this.overlayElement=document.createElement("div"),this.overlayElement.className="dv-drop-target-selection",this._state="center",this.targetElement.appendChild(this.overlayElement),p.classList.add("dv-drop-target"),p.append(this.targetElement)),this.toggleClasses(k,b,u),this._state=k},onDragLeave:()=>{var n,o;!((o=(n=this.options).getOverrideTarget)===null||o===void 0)&&o.call(n)||this.removeDropTarget()},onDragEnd:n=>{var o,r;const a=(r=(o=this.options).getOverrideTarget)===null||r===void 0?void 0:r.call(o);a&&xe.ACTUAL_TARGET===this&&this._state&&(n.stopPropagation(),this._onDrop.fire({position:this._state,nativeEvent:n})),this.removeDropTarget(),a?.clear()},onDrop:n=>{var o,r,a;n.preventDefault();const s=this._state;this.removeDropTarget(),(a=(r=(o=this.options).getOverrideTarget)===null||r===void 0?void 0:r.call(o))===null||a===void 0||a.clear(),s&&(n.stopPropagation(),this._onDrop.fire({position:s,nativeEvent:n}))}}),this.addDisposables(this._onDrop,this._onWillShowOverlay,this.dnd)}setTargetZones(t){this._acceptedTargetZonesSet=new Set(t)}setOverlayModel(t){this.options.overlayModel=t}dispose(){this.removeDropTarget(),super.dispose()}markAsUsed(t){t[xe.USED_EVENT_ID]=!0}isAlreadyUsed(t){const i=t[xe.USED_EVENT_ID];return typeof i=="boolean"&&i}toggleClasses(t,i,n){var o,r,a,s,d,l,h;const v=(r=(o=this.options).getOverrideTarget)===null||r===void 0?void 0:r.call(o);if(!v&&!this.overlayElement)return;const p=i<dn,b=n<ln,u=t==="left",g=t==="right",D=t==="top",A=t==="bottom",k=!p&&g,_=!p&&u,T=!b&&D,R=!b&&A;let C=1;const O=(s=(a=this.options.overlayModel)===null||a===void 0?void 0:a.size)!==null&&s!==void 0?s:an;if(O.type==="percentage"?C=V(O.value,0,100)/100:((k||_)&&(C=V(0,O.value,i)/i),(T||R)&&(C=V(0,O.value,n)/n)),v){const L=(h=(l=(d=this.options).getOverlayOutline)===null||l===void 0?void 0:l.call(d))!==null&&h!==void 0?h:this.element,U=L.getBoundingClientRect(),j=v.getElements(void 0,L),Z=j.root,P=j.overlay,f=Z.getBoundingClientRect(),w=U.top-f.top,M=U.left-f.left,I={top:w,left:M,width:i,height:n};if(k?(I.left=M+i*(1-C),I.width=i*C):_?I.width=i*C:T?I.height=n*C:R&&(I.top=w+n*(1-C),I.height=n*C),p&&u&&(I.width=4),p&&g&&(I.left=M+i-4,I.width=4),!nn(P,I))return;en(P,I),P.className=`dv-drop-target-anchor${this.options.className?` ${this.options.className}`:""}`,x(P,"dv-drop-target-left",u),x(P,"dv-drop-target-right",g),x(P,"dv-drop-target-top",D),x(P,"dv-drop-target-bottom",A),x(P,"dv-drop-target-center",t==="center"),j.changed&&(x(P,"dv-drop-target-anchor-container-changed",!0),setTimeout(()=>{x(P,"dv-drop-target-anchor-container-changed",!1)},10));return}if(!this.overlayElement)return;const E={top:"0px",left:"0px",width:"100%",height:"100%"};k?(E.left=`${100*(1-C)}%`,E.width=`${100*C}%`):_?E.width=`${100*C}%`:T?E.height=`${100*C}%`:R&&(E.top=`${100*(1-C)}%`,E.height=`${100*C}%`),tn(this.overlayElement,E),x(this.overlayElement,"dv-drop-target-small-vertical",b),x(this.overlayElement,"dv-drop-target-small-horizontal",p),x(this.overlayElement,"dv-drop-target-left",u),x(this.overlayElement,"dv-drop-target-right",g),x(this.overlayElement,"dv-drop-target-top",D),x(this.overlayElement,"dv-drop-target-bottom",A),x(this.overlayElement,"dv-drop-target-center",t==="center")}calculateQuadrant(t,i,n,o,r){var a,s;const d=(s=(a=this.options.overlayModel)===null||a===void 0?void 0:a.activationSize)!==null&&s!==void 0?s:sn;return d.type==="percentage"?hn(t,i,n,o,r,d.value):cn(t,i,n,o,r,d.value)}removeDropTarget(){var t;this.targetElement&&(this._state=void 0,(t=this.targetElement.parentElement)===null||t===void 0||t.classList.remove("dv-drop-target"),this.targetElement.remove(),this.targetElement=void 0,this.overlayElement=void 0)}};we.USED_EVENT_ID="__dockview_droptarget_event_is_used__";function hn(e,t,i,n,o,r){const a=100*t/n,s=100*i/o;return e.has("left")&&a<r?"left":e.has("right")&&a>100-r?"right":e.has("top")&&s<r?"top":e.has("bottom")&&s>100-r?"bottom":e.has("center")?"center":null}function cn(e,t,i,n,o,r){return e.has("left")&&t<r?"left":e.has("right")&&t>n-r?"right":e.has("top")&&i<r?"top":e.has("bottom")&&i>o-r?"bottom":e.has("center")?"center":null}var Xe=Object.keys({disableAutoResizing:void 0,disableDnd:void 0,className:void 0}),vn=class extends Vt{constructor(e,t,i,n){super(),this.nativeEvent=e,this.position=t,this.getData=i,this.panel=n}},Yt=class extends et{constructor(){super()}},Zt=class extends z{get isFocused(){return this._isFocused}get isActive(){return this._isActive}get isVisible(){return this._isVisible}get width(){return this._width}get height(){return this._height}constructor(e,t){super(),this.id=e,this.component=t,this._isFocused=!1,this._isActive=!1,this._isVisible=!0,this._width=0,this._height=0,this._parameters={},this.panelUpdatesDisposable=new B,this._onDidDimensionChange=new c,this.onDidDimensionsChange=this._onDidDimensionChange.event,this._onDidChangeFocus=new c,this.onDidFocusChange=this._onDidChangeFocus.event,this._onWillFocus=new c,this.onWillFocus=this._onWillFocus.event,this._onDidVisibilityChange=new c,this.onDidVisibilityChange=this._onDidVisibilityChange.event,this._onWillVisibilityChange=new c,this.onWillVisibilityChange=this._onWillVisibilityChange.event,this._onDidActiveChange=new c,this.onDidActiveChange=this._onDidActiveChange.event,this._onActiveChange=new c,this.onActiveChange=this._onActiveChange.event,this._onDidParametersChange=new c,this.onDidParametersChange=this._onDidParametersChange.event,this.addDisposables(this.onDidFocusChange(i=>{this._isFocused=i.isFocused}),this.onDidActiveChange(i=>{this._isActive=i.isActive}),this.onDidVisibilityChange(i=>{this._isVisible=i.isVisible}),this.onDidDimensionsChange(i=>{this._width=i.width,this._height=i.height}),this.panelUpdatesDisposable,this._onDidDimensionChange,this._onDidChangeFocus,this._onDidVisibilityChange,this._onDidActiveChange,this._onWillFocus,this._onActiveChange,this._onWillFocus,this._onWillVisibilityChange,this._onDidParametersChange)}getParameters(){return this._parameters}initialize(e){this.panelUpdatesDisposable.value=this._onDidParametersChange.event(t=>{this._parameters=t,e.update({params:t})})}setVisible(e){this._onWillVisibilityChange.fire({isVisible:e})}setActive(){this._onActiveChange.fire()}updateParameters(e){this._onDidParametersChange.fire(e)}},Xt=class extends Zt{constructor(e,t){super(e,t),this._onDidConstraintsChangeInternal=new c,this.onDidConstraintsChangeInternal=this._onDidConstraintsChangeInternal.event,this._onDidConstraintsChange=new c({replay:!0}),this.onDidConstraintsChange=this._onDidConstraintsChange.event,this._onDidSizeChange=new c,this.onDidSizeChange=this._onDidSizeChange.event,this.addDisposables(this._onDidConstraintsChangeInternal,this._onDidConstraintsChange,this._onDidSizeChange)}setConstraints(e){this._onDidConstraintsChangeInternal.fire(e)}setSize(e){this._onDidSizeChange.fire(e)}},pn=class extends Xt{set pane(e){this._pane=e}constructor(e,t){super(e,t),this._onDidExpansionChange=new c({replay:!0}),this.onDidExpansionChange=this._onDidExpansionChange.event,this._onMouseEnter=new c({}),this.onMouseEnter=this._onMouseEnter.event,this._onMouseLeave=new c({}),this.onMouseLeave=this._onMouseLeave.event,this.addDisposables(this._onDidExpansionChange,this._onMouseEnter,this._onMouseLeave)}setExpanded(e){var t;(t=this._pane)===null||t===void 0||t.setExpanded(e)}get isExpanded(){var e;return!!(!((e=this._pane)===null||e===void 0)&&e.isExpanded())}},ot=class extends z{get element(){return this._element}get width(){return this._width}get height(){return this._height}get params(){var e;return(e=this._params)===null||e===void 0?void 0:e.params}constructor(e,t,i){super(),this.id=e,this.component=t,this.api=i,this._height=0,this._width=0,this._element=document.createElement("div"),this._element.tabIndex=-1,this._element.style.outline="none",this._element.style.height="100%",this._element.style.width="100%",this._element.style.overflow="hidden";const n=Mt(this._element);this.addDisposables(this.api,n.onDidFocus(()=>{this.api._onDidChangeFocus.fire({isFocused:!0})}),n.onDidBlur(()=>{this.api._onDidChangeFocus.fire({isFocused:!1})}),n)}focus(){const e=new Yt;this.api._onWillFocus.fire(e),!e.defaultPrevented&&this._element.focus()}layout(e,t){this._width=e,this._height=t,this.api._onDidDimensionChange.fire({width:e,height:t}),this.part&&this._params&&this.part.update(this._params.params)}init(e){this._params=e,this.part=this.getComponent()}update(e){var t,i;this._params=Object.assign(Object.assign({},this._params),{params:Object.assign(Object.assign({},(t=this._params)===null||t===void 0?void 0:t.params),e.params)});for(const n of Object.keys(e.params))e.params[n]===void 0&&delete this._params.params[n];(i=this.part)===null||i===void 0||i.update({params:this._params.params})}toJSON(){var e,t;const i=(t=(e=this._params)===null||e===void 0?void 0:e.params)!==null&&t!==void 0?t:{};return{id:this.id,component:this.component,params:Object.keys(i).length>0?i:void 0}}dispose(){var e;this.api.dispose(),(e=this.part)===null||e===void 0||e.dispose(),super.dispose()}},un=class extends ot{set orientation(e){this._orientation=e}get orientation(){return this._orientation}get minimumSize(){return this.headerSize+(this.isExpanded()?this._minimumBodySize:0)}get maximumSize(){return this.headerSize+(this.isExpanded()?this._maximumBodySize:0)}get size(){return this._size}get orthogonalSize(){return this._orthogonalSize}set orthogonalSize(e){this._orthogonalSize=e}get minimumBodySize(){return this._minimumBodySize}set minimumBodySize(e){this._minimumBodySize=typeof e=="number"?e:0}get maximumBodySize(){return this._maximumBodySize}set maximumBodySize(e){this._maximumBodySize=typeof e=="number"?e:Number.POSITIVE_INFINITY}get headerVisible(){return this._headerVisible}set headerVisible(e){this._headerVisible=e,this.header.style.display=e?"":"none"}constructor(e){super(e.id,e.component,new pn(e.id,e.component)),this._onDidChangeExpansionState=new c({replay:!0}),this.onDidChangeExpansionState=this._onDidChangeExpansionState.event,this._onDidChange=new c,this.onDidChange=this._onDidChange.event,this._orthogonalSize=0,this._size=0,this._isExpanded=!1,this.api.pane=this,this.api.initialize(this),this.headerSize=e.headerSize,this.headerComponent=e.headerComponent,this._minimumBodySize=e.minimumBodySize,this._maximumBodySize=e.maximumBodySize,this._isExpanded=e.isExpanded,this._headerVisible=e.isHeaderVisible,this._onDidChangeExpansionState.fire(this.isExpanded()),this._orientation=e.orientation,this.element.classList.add("dv-pane"),this.addDisposables(this.api.onWillVisibilityChange(t=>{const{isVisible:i}=t,{accessor:n}=this._params;n.setVisible(this,i)}),this.api.onDidSizeChange(t=>{this._onDidChange.fire({size:t.size})}),S(this.element,"mouseenter",t=>{this.api._onMouseEnter.fire(t)}),S(this.element,"mouseleave",t=>{this.api._onMouseLeave.fire(t)})),this.addDisposables(this._onDidChangeExpansionState,this.onDidChangeExpansionState(t=>{this.api._onDidExpansionChange.fire({isExpanded:t})}),this.api.onDidFocusChange(t=>{this.header&&(t.isFocused?ie(this.header,"focused"):te(this.header,"focused"))})),this.renderOnce()}setVisible(e){this.api._onDidVisibilityChange.fire({isVisible:e})}setActive(e){this.api._onDidActiveChange.fire({isActive:e})}isExpanded(){return this._isExpanded}setExpanded(e){this._isExpanded!==e&&(this._isExpanded=e,e?(this.animationTimer&&clearTimeout(this.animationTimer),this.body&&this.element.appendChild(this.body)):this.animationTimer=setTimeout(()=>{var t;(t=this.body)===null||t===void 0||t.remove()},200),this._onDidChange.fire(e?{size:this.width}:{}),this._onDidChangeExpansionState.fire(e))}layout(e,t){this._size=e,this._orthogonalSize=t;const[i,n]=this.orientation===y.HORIZONTAL?[e,t]:[t,e];super.layout(i,n)}init(e){var t,i;super.init(e),typeof e.minimumBodySize=="number"&&(this.minimumBodySize=e.minimumBodySize),typeof e.maximumBodySize=="number"&&(this.maximumBodySize=e.maximumBodySize),this.bodyPart=this.getBodyComponent(),this.headerPart=this.getHeaderComponent(),this.bodyPart.init(Object.assign(Object.assign({},e),{api:this.api})),this.headerPart.init(Object.assign(Object.assign({},e),{api:this.api})),(t=this.body)===null||t===void 0||t.append(this.bodyPart.element),(i=this.header)===null||i===void 0||i.append(this.headerPart.element),typeof e.isExpanded=="boolean"&&this.setExpanded(e.isExpanded)}toJSON(){const e=this._params;return Object.assign(Object.assign({},super.toJSON()),{headerComponent:this.headerComponent,title:e.title})}renderOnce(){this.header=document.createElement("div"),this.header.tabIndex=0,this.header.className="dv-pane-header",this.header.style.height=`${this.headerSize}px`,this.header.style.lineHeight=`${this.headerSize}px`,this.header.style.minHeight=`${this.headerSize}px`,this.header.style.maxHeight=`${this.headerSize}px`,this.element.appendChild(this.header),this.body=document.createElement("div"),this.body.className="dv-pane-body",this.element.appendChild(this.body)}getComponent(){return{update:e=>{var t,i;(t=this.bodyPart)===null||t===void 0||t.update({params:e}),(i=this.headerPart)===null||i===void 0||i.update({params:e})},dispose:()=>{var e,t;(e=this.bodyPart)===null||e===void 0||e.dispose(),(t=this.headerPart)===null||t===void 0||t.dispose()}}}},mn=class extends un{constructor(e){super({id:e.id,component:e.component,headerComponent:e.headerComponent,orientation:e.orientation,isExpanded:e.isExpanded,isHeaderVisible:!0,headerSize:e.headerSize,minimumBodySize:e.minimumBodySize,maximumBodySize:e.maximumBodySize}),this._onDidDrop=new c,this.onDidDrop=this._onDidDrop.event,this._onUnhandledDragOverEvent=new c,this.onUnhandledDragOverEvent=this._onUnhandledDragOverEvent.event,this.accessor=e.accessor,this.addDisposables(this._onDidDrop,this._onUnhandledDragOverEvent),e.disableDnd||this.initDragFeatures()}initDragFeatures(){if(!this.header)return;const e=this.id,t=this.accessor.id;this.header.draggable=!0,this.handler=new class extends nt{getData(){return de.getInstance().setData([new ye(t,e)],ye.prototype),{dispose:()=>{de.getInstance().clearData(ye.prototype)}}}}(this.header),this.target=new we(this.element,{acceptedTargetZones:["top","bottom"],overlayModel:{activationSize:{type:"percentage",value:50}},canDisplayOverlay:(i,n)=>{const o=_e();if(o&&o.paneId!==this.id&&o.viewId===this.accessor.id)return!0;const r=new vn(i,n,_e,this);return this._onUnhandledDragOverEvent.fire(r),r.isAccepted}}),this.addDisposables(this._onDidDrop,this.handler,this.target,this.target.onDrop(i=>{this.onDrop(i)}))}onDrop(e){const t=_e();if(!t||t.viewId!==this.accessor.id){this._onDidDrop.fire(Object.assign(Object.assign({},e),{panel:this,api:new Ce(this.accessor),getData:_e}));return}const i=this._params.containerApi,n=t.paneId,o=i.getPanel(n);if(!o){this._onDidDrop.fire(Object.assign(Object.assign({},e),{panel:this,getData:_e,api:new Ce(this.accessor)}));return}const r=i.panels,a=r.indexOf(o);let s=i.panels.indexOf(this);(e.position==="left"||e.position==="top")&&(s=Math.max(0,s-1)),(e.position==="right"||e.position==="bottom")&&(a>s&&s++,s=Math.min(r.length-1,s)),i.movePanel(a,s)}},gn=class extends z{get element(){return this._element}constructor(e,t){super(),this.accessor=e,this.group=t,this.disposable=new B,this._onDidFocus=new c,this.onDidFocus=this._onDidFocus.event,this._onDidBlur=new c,this.onDidBlur=this._onDidBlur.event,this._element=document.createElement("div"),this._element.className="dv-content-container",this._element.tabIndex=-1,this.addDisposables(this._onDidFocus,this._onDidBlur);const i=t.dropTargetContainer;this.dropTarget=new we(this.element,{getOverlayOutline:()=>{var n;return((n=e.options.theme)===null||n===void 0?void 0:n.dndPanelOverlay)==="group"?this.element.parentElement:null},className:"dv-drop-target-content",acceptedTargetZones:["top","bottom","left","right","center"],canDisplayOverlay:(n,o)=>{if(this.group.locked==="no-drop-target"||this.group.locked&&o==="center")return!1;const r=J();return!r&&n.shiftKey&&this.group.location.type!=="floating"?!1:r&&r.viewId===this.accessor.id?!0:this.group.canDisplayOverlay(n,o,"content")},getOverrideTarget:i?()=>i.model:void 0}),this.addDisposables(this.dropTarget)}show(){this.element.style.display=""}hide(){this.element.style.display="none"}renderPanel(e,t={asActive:!0}){const i=t.asActive||this.panel&&this.group.isPanelActive(this.panel);this.panel&&this.panel.view.content.element.parentElement===this._element&&this._element.removeChild(this.panel.view.content.element),this.panel=e;let n;switch(e.api.renderer){case"onlyWhenVisible":this.group.renderContainer.detatch(e),this.panel&&i&&this._element.appendChild(this.panel.view.content.element),n=this._element;break;case"always":e.view.content.element.parentElement===this._element&&this._element.removeChild(e.view.content.element),n=this.group.renderContainer.attach({panel:e,referenceContainer:this});break;default:throw new Error(`dockview: invalid renderer type '${e.api.renderer}'`)}if(i){const o=Mt(n);this.focusTracker=o;const r=new z;r.addDisposables(o,o.onDidFocus(()=>this._onDidFocus.fire()),o.onDidBlur(()=>this._onDidBlur.fire())),this.disposable.value=r}}openPanel(e){this.panel!==e&&this.renderPanel(e)}layout(e,t){}closePanel(){var e;this.panel&&this.panel.api.renderer==="onlyWhenVisible"&&((e=this.panel.view.content.element.parentElement)===null||e===void 0||e.removeChild(this.panel.view.content.element)),this.panel=void 0}dispose(){this.disposable.dispose(),super.dispose()}refreshFocusState(){var e;!((e=this.focusTracker)===null||e===void 0)&&e.refreshState&&this.focusTracker.refreshState()}};function Kt(e,t,i){var n,o;ie(t,"dv-dragged"),t.style.top="-9999px",document.body.appendChild(t),e.setDragImage(t,(n=i?.x)!==null&&n!==void 0?n:0,(o=i?.y)!==null&&o!==void 0?o:0),setTimeout(()=>{te(t,"dv-dragged"),t.remove()},0)}var fn=class extends nt{constructor(e,t,i,n,o){super(e,o),this.accessor=t,this.group=i,this.panel=n,this.panelTransfer=de.getInstance()}getData(e){return this.panelTransfer.setData([new ae(this.accessor.id,this.group.id,this.panel.id)],ae.prototype),{dispose:()=>{this.panelTransfer.clearData(ae.prototype)}}}},bn=class extends z{get element(){return this._element}constructor(e,t,i){super(),this.panel=e,this.accessor=t,this.group=i,this.content=void 0,this._onPointDown=new c,this.onPointerDown=this._onPointDown.event,this._onDropped=new c,this.onDrop=this._onDropped.event,this._onDragStart=new c,this.onDragStart=this._onDragStart.event,this._onDragEnd=new c,this.onDragEnd=this._onDragEnd.event,this._element=document.createElement("div"),this._element.className="dv-tab",this._element.tabIndex=0,this._element.draggable=!this.accessor.options.disableDnd,x(this.element,"dv-inactive-tab",!0),this.dragHandler=new fn(this._element,this.accessor,this.group,this.panel,!!this.accessor.options.disableDnd),this.dropTarget=new we(this._element,{acceptedTargetZones:["left","right"],overlayModel:{activationSize:{value:50,type:"percentage"}},canDisplayOverlay:(n,o)=>{if(this.group.locked)return!1;const r=J();return r&&this.accessor.id===r.viewId?!(this.accessor.options.tabAnimation==="smooth"&&r.groupId===this.group.id):this.group.model.canDisplayOverlay(n,o,"tab")},getOverrideTarget:()=>{var n;return(n=i.model.dropTargetContainer)===null||n===void 0?void 0:n.model}}),this.onWillShowOverlay=this.dropTarget.onWillShowOverlay,this.addDisposables(this._onPointDown,this._onDropped,this._onDragStart,this._onDragEnd,this.dragHandler.onDragStart(n=>{if(n.dataTransfer){const o=getComputedStyle(this.element),r=this.element.cloneNode(!0);Array.from(o).forEach(a=>r.style.setProperty(a,o.getPropertyValue(a),o.getPropertyPriority(a))),r.style.position="absolute",Kt(n.dataTransfer,r,{y:-10,x:30})}this._onDragStart.fire(n),this.accessor.options.tabAnimation==="smooth"&&requestAnimationFrame(()=>{x(this.element,"dv-tab--dragging",!0)})}),S(this._element,"dragend",n=>{x(this.element,"dv-tab--dragging",!1),this._onDragEnd.fire(n)}),this.dragHandler,S(this._element,"pointerdown",n=>{this._onPointDown.fire(n)}),this.dropTarget.onDrop(n=>{this._onDropped.fire(n)}),this.dropTarget)}setActive(e){x(this.element,"dv-active-tab",e),x(this.element,"dv-inactive-tab",!e)}setContent(e){this.content&&this._element.removeChild(this.content.element),this.content=e,this._element.appendChild(this.content.element)}updateDragAndDropState(){this._element.draggable=!this.accessor.options.disableDnd,this.dragHandler.setDisabled(!!this.accessor.options.disableDnd)}dispose(){super.dispose()}},Ve=class{get kind(){return this.options.kind}get nativeEvent(){return this.event.nativeEvent}get position(){return this.event.position}get defaultPrevented(){return this.event.defaultPrevented}get panel(){return this.options.panel}get api(){return this.options.api}get group(){return this.options.group}preventDefault(){this.event.preventDefault()}getData(){return this.options.getData()}constructor(e,t){this.event=e,this.options=t}},wn=class extends nt{constructor(e,t,i,n){super(e,n),this.accessor=t,this.group=i,this.panelTransfer=de.getInstance(),this.addDisposables(S(e,"pointerdown",o=>{o.shiftKey&&Ri(o)},!0))}isCancelled(e){return this.group.api.location.type==="floating"&&!e.shiftKey}getData(e){const t=e.dataTransfer;this.panelTransfer.setData([new ae(this.accessor.id,this.group.id,null)],ae.prototype);const i=window.getComputedStyle(this.el),n=i.getPropertyValue("--dv-activegroup-visiblepanel-tab-background-color"),o=i.getPropertyValue("--dv-activegroup-visiblepanel-tab-color");if(t){const r=document.createElement("div");r.style.backgroundColor=n,r.style.color=o,r.style.padding="2px 8px",r.style.height="24px",r.style.fontSize="11px",r.style.lineHeight="20px",r.style.borderRadius="12px",r.style.position="absolute",r.style.pointerEvents="none",r.style.top="-9999px",r.textContent=`Multiple Panels (${this.group.size})`,Kt(t,r,{y:-10,x:30})}return{dispose:()=>{this.panelTransfer.clearData(ae.prototype)}}}},_n=class extends z{get element(){return this._element}constructor(e,t){super(),this.accessor=e,this.group=t,this._onDrop=new c,this.onDrop=this._onDrop.event,this._onDragStart=new c,this.onDragStart=this._onDragStart.event,this._element=document.createElement("div"),this._element.className="dv-void-container",this._element.draggable=!this.accessor.options.disableDnd,x(this._element,"dv-draggable",!this.accessor.options.disableDnd),this.addDisposables(this._onDrop,this._onDragStart,S(this._element,"pointerdown",()=>{this.accessor.doSetGroupActive(this.group)})),this.handler=new wn(this._element,e,t,!!this.accessor.options.disableDnd),this.dropTarget=new we(this._element,{acceptedTargetZones:["center"],canDisplayOverlay:(i,n)=>{const o=J();return o&&this.accessor.id===o.viewId?!0:t.model.canDisplayOverlay(i,n,"header_space")},getOverrideTarget:()=>{var i;return(i=t.model.dropTargetContainer)===null||i===void 0?void 0:i.model}}),this.onWillShowOverlay=this.dropTarget.onWillShowOverlay,this.addDisposables(this.handler,this.handler.onDragStart(i=>{this._onDragStart.fire(i)}),this.dropTarget.onDrop(i=>{this._onDrop.fire(i)}),this.dropTarget)}updateDragAndDropState(){this._element.draggable=!this.accessor.options.disableDnd,x(this._element,"dv-draggable",!this.accessor.options.disableDnd),this.handler.setDisabled(!!this.accessor.options.disableDnd)}},qt=class Qt extends z{get element(){return this._element}get orientation(){return this._orientation}set orientation(t){this._orientation!==t&&(this._scrollOffset=0,this._orientation=t,te(this._scrollbar,"dv-scrollbar-vertical","dv-scrollbar-horizontal"),t==="vertical"?ie(this._scrollbar,"dv-scrollbar-vertical"):ie(this._scrollbar,"dv-scrollbar-horizontal"))}constructor(t){super(),this.scrollableElement=t,this._scrollOffset=0,this._orientation="horizontal",this._element=document.createElement("div"),this._element.className="dv-scrollable",this._scrollbar=document.createElement("div"),this._scrollbar.className="dv-scrollbar dv-scrollbar-horizontal",this.element.appendChild(t),this.element.appendChild(this._scrollbar),this.addDisposables(S(this.element,"wheel",i=>{this._scrollOffset+=i.deltaY*Qt.MouseWheelSpeed,this.calculateScrollbarStyles()}),S(this._scrollbar,"pointerdown",i=>{i.preventDefault(),x(this.element,"dv-scrollable-scrolling",!0);const n=this._orientation==="horizontal"?i.clientX:i.clientY,o=this._scrollOffset,r=s=>{const d=this._orientation==="horizontal"?s.clientX-n:s.clientY-n,l=(this._orientation==="horizontal"?this.element.clientWidth:this.element.clientHeight)/(this._orientation==="horizontal"?this.scrollableElement.scrollWidth:this.scrollableElement.scrollHeight);this._scrollOffset=o+d/l,this.calculateScrollbarStyles()},a=()=>{x(this.element,"dv-scrollable-scrolling",!1),document.removeEventListener("pointermove",r),document.removeEventListener("pointerup",a),document.removeEventListener("pointercancel",a)};document.addEventListener("pointermove",r),document.addEventListener("pointerup",a),document.addEventListener("pointercancel",a)}),S(this.element,"scroll",()=>{this.calculateScrollbarStyles()}),S(this.scrollableElement,"scroll",()=>{this._scrollOffset=this._orientation==="horizontal"?this.scrollableElement.scrollLeft:this.scrollableElement.scrollTop,this.calculateScrollbarStyles()}),Re(this.element,()=>{x(this.element,"dv-scrollable-resizing",!0),this._animationTimer&&clearTimeout(this._animationTimer),this._animationTimer=setTimeout(()=>{clearTimeout(this._animationTimer),x(this.element,"dv-scrollable-resizing",!1)},500),this.calculateScrollbarStyles()}))}calculateScrollbarStyles(){const t=this._orientation==="horizontal"?this.element.clientWidth:this.element.clientHeight,i=this._orientation==="horizontal"?this.scrollableElement.scrollWidth:this.scrollableElement.scrollHeight;if(i>t){const n=t*(t/i);this._orientation==="horizontal"?(this._scrollbar.style.width=`${n}px`,this._scrollbar.style.height=""):(this._scrollbar.style.height=`${n}px`,this._scrollbar.style.width=""),this._scrollOffset=V(this._scrollOffset,0,i-t),this._orientation==="horizontal"?this.scrollableElement.scrollLeft=this._scrollOffset:this.scrollableElement.scrollTop=this._scrollOffset;const o=this._scrollOffset/(i-t);this._orientation==="horizontal"?(this._scrollbar.style.left=`${(t-n)*o}px`,this._scrollbar.style.top=""):(this._scrollbar.style.top=`${(t-n)*o}px`,this._scrollbar.style.left="")}else this._orientation==="horizontal"?(this._scrollbar.style.width="0px",this._scrollbar.style.left="0px"):(this._scrollbar.style.height="0px",this._scrollbar.style.top="0px"),this._scrollOffset=0}};qt.MouseWheelSpeed=1;var xn=class extends z{get showTabsOverflowControl(){return this._showTabsOverflowControl}set showTabsOverflowControl(e){if(this._showTabsOverflowControl!=e&&(this._showTabsOverflowControl=e,e)){const t=new Gi(this._tabsList);this._observerDisposable.value=new z(t,t.onDidChange(i=>{const n=i.hasScrollX||i.hasScrollY;this.toggleDropdown({reset:!n})}),S(this._tabsList,"scroll",()=>{this.toggleDropdown({reset:!1})}))}}get element(){return this._element}get panels(){return this._tabs.map(e=>e.value.panel.id)}get size(){return this._tabs.length}get tabs(){return this._tabs.map(e=>e.value)}get direction(){return this._direction}set direction(e){this._direction!==e&&(this._direction=e,this._scrollbar&&(this._scrollbar.orientation=e),te(this._tabsList,"dv-horizontal","dv-vertical"),e==="vertical"?ie(this._tabsList,"dv-tabs-container-vertical","dv-vertical"):(te(this._tabsList,"dv-tabs-container-vertical"),ie(this._tabsList,"dv-horizontal")))}constructor(e,t,i){super(),this.group=e,this.accessor=t,this._observerDisposable=new B,this._scrollbar=null,this._tabs=[],this.selectedIndex=-1,this._showTabsOverflowControl=!1,this._direction="horizontal",this._animState=null,this._onTabDragStart=new c,this.onTabDragStart=this._onTabDragStart.event,this._onDrop=new c,this.onDrop=this._onDrop.event,this._onWillShowOverlay=new c,this.onWillShowOverlay=this._onWillShowOverlay.event,this._onOverflowTabsChange=new c,this.onOverflowTabsChange=this._onOverflowTabsChange.event,this._tabsList=document.createElement("div"),this._tabsList.className="dv-tabs-container",this.showTabsOverflowControl=i.showTabsOverflowControl,t.options.scrollbars==="native"?this._element=this._tabsList:(this._scrollbar=new qt(this._tabsList),this._scrollbar.orientation=this.direction,this._element=this._scrollbar.element,this.addDisposables(this._scrollbar)),this.addDisposables(this._onOverflowTabsChange,this._observerDisposable,this._onWillShowOverlay,this._onDrop,this._onTabDragStart,S(this.element,"pointerdown",n=>{n.defaultPrevented||n.button===0&&this.accessor.doSetGroupActive(this.group)}),S(this._tabsList,"dragover",n=>{if(!this._animState){if(this.accessor.options.tabAnimation!=="smooth"||this.accessor.options.disableDnd)return;const o=J();if(o&&o.panelId&&o.groupId!==this.group.id)this._animState={sourceTabId:o.panelId,sourceIndex:-1,tabPositions:this.snapshotTabPositions(),currentInsertionIndex:null};else return}this.handleDragOver(n)},!0),S(this._tabsList,"dragleave",n=>{this._animState&&(n.relatedTarget&&this._tabsList.contains(n.relatedTarget)||(this.resetTabTransforms(),this._animState&&(this._animState.sourceIndex===-1?this._animState=null:this._animState.currentInsertionIndex=null)))},!0),S(this._tabsList,"dragend",()=>{this.resetDragAnimation()}),S(this._tabsList,"drop",n=>{if(this.accessor.options.tabAnimation!=="smooth"||!this._animState||this._animState.currentInsertionIndex===null)return;n.stopPropagation(),n.preventDefault();const o=this._animState;this._animState=null;const r=o.currentInsertionIndex,a=o.sourceIndex,s=r-(a!==-1&&a<r?1:0);if(s===a){this.resetTabTransforms();return}const d=this.snapshotTabPositions();this.resetTabTransforms(),this._onDrop.fire({event:n,index:s}),this.runFlipAnimation(d,o.sourceTabId,o.sourceIndex===-1,{from:Math.min(a,s),to:Math.max(a,s)})},!0),W.from(()=>{this.resetDragAnimation();for(const{value:n,disposable:o}of this._tabs)o.dispose(),n.dispose();this._tabs=[]}))}indexOf(e){return this._tabs.findIndex(t=>t.value.panel.id===e)}isActive(e){return this.selectedIndex>-1&&this._tabs[this.selectedIndex].value===e}setActivePanel(e){let t=0;for(const i of this._tabs){const n=e.id===i.value.panel.id;if(i.value.setActive(n),n){const o=i.value.element,r=o.parentElement;(t<r.scrollLeft||t+o.clientWidth>r.scrollLeft+r.clientWidth)&&(r.scrollLeft=t)}t+=i.value.element.clientWidth}}openPanel(e,t=this._tabs.length){if(this._tabs.find(o=>o.value.panel.id===e.id))return;const i=new bn(e,this.accessor,this.group);i.setContent(e.view.tab);const n={value:i,disposable:new z(i.onDragStart(o=>{this._onTabDragStart.fire({nativeEvent:o,panel:e}),this.accessor.options.tabAnimation==="smooth"&&(this._animState={sourceTabId:e.id,sourceIndex:this._tabs.findIndex(r=>r.value===i),tabPositions:this.snapshotTabPositions(),currentInsertionIndex:null})}),i.onPointerDown(o=>{if(o.defaultPrevented)return;const r=!this.accessor.options.disableFloatingGroups,a=this.group.api.location.type==="floating"&&this.size===1;if(r&&!a&&o.shiftKey){o.preventDefault();const s=this.accessor.getGroupPanel(i.panel.id),{top:d,left:l}=i.element.getBoundingClientRect(),{top:h,left:v}=this.accessor.element.getBoundingClientRect();this.accessor.addFloatingGroup(s,{x:l-v,y:d-h,inDragMode:!0});return}o.button===0&&this.group.activePanel!==e&&this.group.model.openPanel(e)}),i.onDrop(o=>{const r=this._animState;this._animState=null;const a=this._tabs.findIndex(s=>s.value===i);if(r){const s=this.snapshotTabPositions();this.resetTabTransforms(),this._onDrop.fire({event:o.nativeEvent,index:a}),this.runFlipAnimation(s,r.sourceTabId,r.sourceIndex===-1,r.sourceIndex!==-1?{from:Math.min(r.sourceIndex,a),to:Math.max(r.sourceIndex,a)}:void 0)}else this._onDrop.fire({event:o.nativeEvent,index:a})}),i.onWillShowOverlay(o=>{this._onWillShowOverlay.fire(new Ve(o,{kind:"tab",panel:this.group.activePanel,api:this.accessor.api,group:this.group,getData:J}))}))};this.addTab(n,t),this._animState&&(this._animState.tabPositions=this.snapshotTabPositions(),this.applyDragOverTransforms())}delete(e){var t;((t=this._animState)===null||t===void 0?void 0:t.sourceTabId)===e&&(this.resetTabTransforms(),this._animState=null);const i=this.indexOf(e),{value:n,disposable:o}=this._tabs.splice(i,1)[0];o.dispose(),n.dispose(),n.element.remove(),this._animState&&(this._animState.tabPositions=this.snapshotTabPositions(),this.applyDragOverTransforms())}addTab(e,t=this._tabs.length){if(t<0||t>this._tabs.length)throw new Error("invalid location");this._tabsList.insertBefore(e.value.element,this._tabsList.children[t]),this._tabs=[...this._tabs.slice(0,t),e,...this._tabs.slice(t)],this.selectedIndex<0&&(this.selectedIndex=t)}toggleDropdown(e){const t=e.reset?[]:this._tabs.filter(i=>!Hi(i.value.element,this._tabsList)).map(i=>i.value.panel.id);this._onOverflowTabsChange.fire({tabs:t,reset:e.reset})}updateDragAndDropState(){for(const e of this._tabs)e.value.updateDragAndDropState()}snapshotTabPositions(){const e=new Map;for(const t of this._tabs)e.set(t.value.panel.id,t.value.element.getBoundingClientRect());return e}getAverageTabWidth(){if(this._tabs.length===0)return 0;let e=0;for(const t of this._tabs)e+=t.value.element.getBoundingClientRect().width;return e/this._tabs.length}handleDragOver(e){if(!this._animState)return;const t=e.clientX;let i=null;for(let n=0;n<this._tabs.length;n++){const o=this._tabs[n].value;if(o.panel.id===this._animState.sourceTabId)continue;const r=o.element.getBoundingClientRect();if(t<r.left+r.width/2){i=n;break}i=n+1}i!==this._animState.currentInsertionIndex&&(this._animState.currentInsertionIndex=i,this.applyDragOverTransforms())}applyDragOverTransforms(){if(!this._animState||this._animState.currentInsertionIndex===null){this.resetTabTransforms();return}const e=this._animState.currentInsertionIndex,t=this._animState.tabPositions.get(this._animState.sourceTabId),i=t?t.width:this.getAverageTabWidth();let n=!1;for(let o=0;o<this._tabs.length;o++){const r=this._tabs[o].value;if(r.panel.id!==this._animState.sourceTabId)if(!n&&o>=e)r.element.style.marginLeft=`${i}px`,x(r.element,"dv-tab--shifting",!0),n=!0;else if(r.element.style.marginLeft){r.element.style.marginLeft="0px",x(r.element,"dv-tab--shifting",!0);const a=()=>{r.element.style.removeProperty("margin-left"),x(r.element,"dv-tab--shifting",!1),r.element.removeEventListener("transitionend",a)};r.element.addEventListener("transitionend",a)}else x(r.element,"dv-tab--shifting",!1)}}resetTabTransforms(){for(const e of this._tabs)e.value.element.style.removeProperty("margin-left"),e.value.element.style.removeProperty("transform"),x(e.value.element,"dv-tab--shifting",!1)}resetDragAnimation(){this.resetTabTransforms(),this._animState=null;for(const e of this._tabs)x(e.value.element,"dv-tab--dragging",!1)}runFlipAnimation(e,t,i=!1,n){let o=!1;for(let r=0;r<this._tabs.length;r++){const a=this._tabs[r],s=a.value.panel.id;if(s===t){if(i){const v=a.value.element.getBoundingClientRect();a.value.element.style.transform=`translateX(${v.width}px)`,x(a.value.element,"dv-tab--shifting",!0),o=!0}continue}if(n!==void 0&&(r<n.from||r>n.to))continue;const d=e.get(s);if(!d)continue;const l=a.value.element.getBoundingClientRect(),h=d.left-l.left;Math.abs(h)<1||(a.value.element.style.transform=`translateX(${h}px)`,x(a.value.element,"dv-tab--shifting",!0),o=!0)}o&&requestAnimationFrame(()=>{for(const a of this._tabs)a.value.element.style.transform&&(a.value.element.style.transform="");const r=a=>{if(a.propertyName==="transform"){this._tabsList.removeEventListener("transitionend",r);for(const s of this._tabs)x(s.value.element,"dv-tab--shifting",!1)}};this._tabsList.addEventListener("transitionend",r)})}},rt=e=>{const t=document.createElementNS("http://www.w3.org/2000/svg","svg");t.setAttributeNS(null,"height",e.height),t.setAttributeNS(null,"width",e.width),t.setAttributeNS(null,"viewBox",e.viewbox),t.setAttributeNS(null,"aria-hidden","false"),t.setAttributeNS(null,"focusable","false"),t.classList.add("dv-svg");const i=document.createElementNS("http://www.w3.org/2000/svg","path");return i.setAttributeNS(null,"d",e.path),t.appendChild(i),t},yn=()=>rt({width:"11",height:"11",viewbox:"0 0 28 28",path:"M2.1 27.3L0 25.2L11.55 13.65L0 2.1L2.1 0L13.65 11.55L25.2 0L27.3 2.1L15.75 13.65L27.3 25.2L25.2 27.3L13.65 15.75L2.1 27.3Z"}),Dn=()=>rt({width:"11",height:"11",viewbox:"0 0 24 15",path:"M12 14.15L0 2.15L2.15 0L12 9.9L21.85 0.0499992L24 2.2L12 14.15Z"}),ei=()=>rt({width:"11",height:"11",viewbox:"0 0 15 25",path:"M2.15 24.1L0 21.95L9.9 12.05L0 2.15L2.15 0L14.2 12.05L2.15 24.1Z"});function Cn(){const e=document.createElement("div");e.className="dv-tabs-overflow-dropdown-default";const t=document.createElement("span");t.textContent="";const i=ei();return e.appendChild(i),e.appendChild(t),{element:e,update:n=>{t.textContent=`${n.tabs}`}}}var zn=class extends z{get onTabDragStart(){return this.tabs.onTabDragStart}get panels(){return this.tabs.panels}get size(){return this.tabs.size}get hidden(){return this._hidden}set hidden(e){this._hidden=e,this.element.style.display=e?"none":""}get direction(){return this._direction}set direction(e){this._direction=e,e==="vertical"?(ie(this._element,"dv-groupview-header-vertical"),ie(this.rightActionsContainer,"dv-right-actions-container-vertical"),this.tabs.direction=e):(te(this._element,"dv-groupview-header-vertical"),te(this.rightActionsContainer,"dv-right-actions-container-vertical"),this.tabs.direction=e)}get element(){return this._element}constructor(e,t){super(),this.accessor=e,this.group=t,this._hidden=!1,this._direction="horizontal",this.dropdownPart=null,this._overflowTabs=[],this._dropdownDisposable=new B,this._onDrop=new c,this.onDrop=this._onDrop.event,this._onGroupDragStart=new c,this.onGroupDragStart=this._onGroupDragStart.event,this._onWillShowOverlay=new c,this.onWillShowOverlay=this._onWillShowOverlay.event,this._element=document.createElement("div"),this._element.className="dv-tabs-and-actions-container",x(this._element,"dv-full-width-single-tab",this.accessor.options.singleTabMode==="fullwidth"),this.rightActionsContainer=document.createElement("div"),this.rightActionsContainer.className="dv-right-actions-container",this.leftActionsContainer=document.createElement("div"),this.leftActionsContainer.className="dv-left-actions-container",this.preActionsContainer=document.createElement("div"),this.preActionsContainer.className="dv-pre-actions-container",this.tabs=new xn(t,e,{showTabsOverflowControl:!e.options.disableTabsOverflowList}),this.voidContainer=new _n(this.accessor,this.group),this._element.appendChild(this.preActionsContainer),this._element.appendChild(this.tabs.element),this._element.appendChild(this.leftActionsContainer),this._element.appendChild(this.voidContainer.element),this._element.appendChild(this.rightActionsContainer),this.addDisposables(this.tabs.onDrop(i=>this._onDrop.fire(i)),this.tabs.onWillShowOverlay(i=>this._onWillShowOverlay.fire(i)),e.onDidOptionsChange(()=>{this.tabs.showTabsOverflowControl=!e.options.disableTabsOverflowList}),this.tabs.onOverflowTabsChange(i=>{this.toggleDropdown(i)}),this.tabs,this._onWillShowOverlay,this._onDrop,this._onGroupDragStart,this.voidContainer,this.voidContainer.onDragStart(i=>{this._onGroupDragStart.fire({nativeEvent:i,group:this.group})}),this.voidContainer.onDrop(i=>{this._onDrop.fire({event:i.nativeEvent,index:this.tabs.size})}),this.voidContainer.onWillShowOverlay(i=>{this._onWillShowOverlay.fire(new Ve(i,{kind:"header_space",panel:this.group.activePanel,api:this.accessor.api,group:this.group,getData:J}))}),S(this.voidContainer.element,"pointerdown",i=>{if(!i.defaultPrevented&&!this.accessor.options.disableFloatingGroups&&i.shiftKey&&this.group.api.location.type!=="floating"){i.preventDefault();const{top:n,left:o}=this.element.getBoundingClientRect(),{top:r,left:a}=this.accessor.element.getBoundingClientRect();this.accessor.addFloatingGroup(this.group,{x:o-a+20,y:n-r+20,inDragMode:!0})}}))}show(){this.hidden||(this.element.style.display="")}hide(){this._element.style.display="none"}setRightActionsElement(e){this.rightActions!==e&&(this.rightActions&&(this.rightActions.remove(),this.rightActions=void 0),e&&(this.rightActionsContainer.appendChild(e),this.rightActions=e))}setLeftActionsElement(e){this.leftActions!==e&&(this.leftActions&&(this.leftActions.remove(),this.leftActions=void 0),e&&(this.leftActionsContainer.appendChild(e),this.leftActions=e))}setPrefixActionsElement(e){this.preActions!==e&&(this.preActions&&(this.preActions.remove(),this.preActions=void 0),e&&(this.preActionsContainer.appendChild(e),this.preActions=e))}isActive(e){return this.tabs.isActive(e)}indexOf(e){return this.tabs.indexOf(e)}setActive(e){}delete(e){this.tabs.delete(e),this.updateClassnames()}setActivePanel(e){this.tabs.setActivePanel(e)}openPanel(e,t=this.tabs.size){this.tabs.openPanel(e,t),this.updateClassnames()}closePanel(e){this.delete(e.id)}updateClassnames(){x(this._element,"dv-single-tab",this.size===1)}toggleDropdown(e){const t=e.reset?[]:e.tabs;if(this._overflowTabs=t,this._overflowTabs.length>0&&this.dropdownPart){this.dropdownPart.update({tabs:t.length});return}if(this._overflowTabs.length===0){this._dropdownDisposable.dispose();return}const i=document.createElement("div");i.className="dv-tabs-overflow-dropdown-root";const n=Cn();n.update({tabs:t.length}),this.dropdownPart=n,i.appendChild(n.element),this.rightActionsContainer.prepend(i),this._dropdownDisposable.value=new z(W.from(()=>{var o,r;i.remove(),(r=(o=this.dropdownPart)===null||o===void 0?void 0:o.dispose)===null||r===void 0||r.call(o),this.dropdownPart=null}),S(i,"pointerdown",o=>{o.preventDefault()},{capture:!0}),S(i,"click",o=>{const r=document.createElement("div");r.style.overflow="auto",r.className="dv-tabs-overflow-container";for(const s of this.tabs.tabs.filter(d=>this._overflowTabs.includes(d.panel.id))){const d=this.group.panels.find(v=>v===s.panel),l=d.view.createTabRenderer("headerOverflow").element,h=document.createElement("div");x(h,"dv-tab",!0),x(h,"dv-active-tab",d.api.isActive),x(h,"dv-inactive-tab",!d.api.isActive),h.addEventListener("click",v=>{this.accessor.popupService.close(),!v.defaultPrevented&&(s.element.scrollIntoView(),s.panel.api.setActive())}),h.appendChild(l),r.appendChild(h)}const a=$i(i);this.accessor.popupService.openPopover(r,{x:o.clientX,y:o.clientY,zIndex:a?.style.zIndex?`calc(${a.style.zIndex} * 2)`:void 0})}))}updateDragAndDropState(){this.tabs.updateDragAndDropState(),this.voidContainer.updateDragAndDropState()}},ti=class extends Vt{constructor(e,t,i,n,o){super(),this.nativeEvent=e,this.target=t,this.position=i,this.getData=n,this.group=o}},Ke=Object.keys({disableAutoResizing:void 0,hideBorders:void 0,singleTabMode:void 0,disableFloatingGroups:void 0,floatingGroupBounds:void 0,popoutUrl:void 0,defaultRenderer:void 0,defaultHeaderPosition:void 0,debug:void 0,rootOverlayModel:void 0,locked:void 0,disableDnd:void 0,className:void 0,noPanelsOverlay:void 0,dndEdges:void 0,theme:void 0,disableTabsOverflowList:void 0,scrollbars:void 0,tabAnimation:void 0});function kn(e){return!!e.referencePanel}function Sn(e){return!!e.referenceGroup}function An(e){return!!e.referencePanel}function Pn(e){return!!e.referenceGroup}var st=class extends et{get nativeEvent(){return this.options.nativeEvent}get position(){return this.options.position}get panel(){return this.options.panel}get group(){return this.options.group}get api(){return this.options.api}constructor(e){super(),this.options=e}getData(){return this.options.getData()}},ii=class extends st{get kind(){return this._kind}constructor(e){super(e),this._kind=e.kind}},En=class extends z{get element(){throw new Error("dockview: not supported")}get activePanel(){return this._activePanel}get locked(){return this._locked}set locked(e){this._locked=e,x(this.container,"dv-locked-groupview",e==="no-drop-target"||e)}get isActive(){return this._isGroupActive}get panels(){return this._panels}get size(){return this._panels.length}get isEmpty(){return this._panels.length===0}get hasWatermark(){return!!(this.watermark&&this.container.contains(this.watermark.element))}get header(){return this.tabsContainer}get isContentFocused(){return document.activeElement?Fe(document.activeElement,this.contentContainer.element):!1}get headerPosition(){var e;return(e=this._headerPosition)!==null&&e!==void 0?e:"top"}set headerPosition(e){var t;this._headerPosition=e,te(this.container,"dv-groupview-header-top","dv-groupview-header-bottom","dv-groupview-header-left","dv-groupview-header-right"),ie(this.container,`dv-groupview-header-${e}`);const i=e==="top"||e==="bottom"?"horizontal":"vertical";this.tabsContainer.direction=i,this.header.direction=i,!((t=this._activePanel)===null||t===void 0)&&t.layout&&this._activePanel.layout(this._width,this._height),(this._leftHeaderActions||this._rightHeaderActions||this._prefixHeaderActions)&&this.updateHeaderActions()}get location(){return this._location}set location(e){switch(this._location=e,x(this.container,"dv-groupview-floating",!1),x(this.container,"dv-groupview-popout",!1),e.type){case"grid":this.contentContainer.dropTarget.setTargetZones(["top","bottom","left","right","center"]);break;case"floating":this.contentContainer.dropTarget.setTargetZones(["center"]),this.contentContainer.dropTarget.setTargetZones(e?["center"]:["top","bottom","left","right","center"]),x(this.container,"dv-groupview-floating",!0);break;case"popout":this.contentContainer.dropTarget.setTargetZones(["center"]),x(this.container,"dv-groupview-popout",!0);break}this.groupPanel.api._onDidLocationChange.fire({location:this.location})}constructor(e,t,i,n,o){var r,a;super(),this.container=e,this.accessor=t,this.id=i,this.options=n,this.groupPanel=o,this._isGroupActive=!1,this._locked=!1,this._rightHeaderActionsDisposable=new B,this._leftHeaderActionsDisposable=new B,this._prefixHeaderActionsDisposable=new B,this._location={type:"grid"},this.mostRecentlyUsed=[],this._overwriteRenderContainer=null,this._overwriteDropTargetContainer=null,this._onDidChange=new c,this.onDidChange=this._onDidChange.event,this._width=0,this._height=0,this._panels=[],this._panelDisposables=new Map,this._onMove=new c,this.onMove=this._onMove.event,this._onDidDrop=new c,this.onDidDrop=this._onDidDrop.event,this._onWillDrop=new c,this.onWillDrop=this._onWillDrop.event,this._onWillShowOverlay=new c,this.onWillShowOverlay=this._onWillShowOverlay.event,this._onTabDragStart=new c,this.onTabDragStart=this._onTabDragStart.event,this._onGroupDragStart=new c,this.onGroupDragStart=this._onGroupDragStart.event,this._onDidAddPanel=new c,this.onDidAddPanel=this._onDidAddPanel.event,this._onDidPanelTitleChange=new c,this.onDidPanelTitleChange=this._onDidPanelTitleChange.event,this._onDidPanelParametersChange=new c,this.onDidPanelParametersChange=this._onDidPanelParametersChange.event,this._onDidRemovePanel=new c,this.onDidRemovePanel=this._onDidRemovePanel.event,this._onDidActivePanelChange=new c,this.onDidActivePanelChange=this._onDidActivePanelChange.event,this._onUnhandledDragOverEvent=new c,this.onUnhandledDragOverEvent=this._onUnhandledDragOverEvent.event,x(this.container,"dv-groupview",!0),this._api=new Te(this.accessor),this.tabsContainer=new zn(this.accessor,this.groupPanel),this.contentContainer=new gn(this.accessor,this),e.append(this.tabsContainer.element,this.contentContainer.element),this.header.hidden=!!n.hideHeader,this.locked=(r=n.locked)!==null&&r!==void 0?r:!1,this.headerPosition=(a=n.headerPosition)!==null&&a!==void 0?a:t.defaultHeaderPosition,this.addDisposables(this._onTabDragStart,this._onGroupDragStart,this._onWillShowOverlay,this._rightHeaderActionsDisposable,this._leftHeaderActionsDisposable,this._prefixHeaderActionsDisposable,this.tabsContainer.onTabDragStart(s=>{this._onTabDragStart.fire(s)}),this.tabsContainer.onGroupDragStart(s=>{this._onGroupDragStart.fire(s)}),this.tabsContainer.onDrop(s=>{this.handleDropEvent("header",s.event,"center",s.index)}),this.contentContainer.onDidFocus(()=>{this.accessor.doSetGroupActive(this.groupPanel)}),this.contentContainer.onDidBlur(()=>{}),this.contentContainer.dropTarget.onDrop(s=>{this.handleDropEvent("content",s.nativeEvent,s.position)}),this.tabsContainer.onWillShowOverlay(s=>{this._onWillShowOverlay.fire(s)}),this.contentContainer.dropTarget.onWillShowOverlay(s=>{this._onWillShowOverlay.fire(new Ve(s,{kind:"content",panel:this.activePanel,api:this._api,group:this.groupPanel,getData:J}))}),this._onMove,this._onDidChange,this._onDidDrop,this._onWillDrop,this._onDidAddPanel,this._onDidRemovePanel,this._onDidActivePanelChange,this._onUnhandledDragOverEvent,this._onDidPanelTitleChange,this._onDidPanelParametersChange)}focusContent(){this.contentContainer.element.focus()}set renderContainer(e){this.panels.forEach(t=>{this.renderContainer.detatch(t)}),this._overwriteRenderContainer=e,this.panels.forEach(t=>{this.rerender(t)})}get renderContainer(){var e;return(e=this._overwriteRenderContainer)!==null&&e!==void 0?e:this.accessor.overlayRenderContainer}set dropTargetContainer(e){this._overwriteDropTargetContainer=e}get dropTargetContainer(){var e;return(e=this._overwriteDropTargetContainer)!==null&&e!==void 0?e:this.accessor.rootDropTargetContainer}initialize(){this.options.panels&&this.options.panels.forEach(e=>{this.doAddPanel(e)}),this.options.activePanel&&this.openPanel(this.options.activePanel),this.setActive(this.isActive,!0),this.updateContainer(),this.updateHeaderActions()}updateHeaderActions(){this.accessor.options.createRightHeaderActionComponent?(this._rightHeaderActions=this.accessor.options.createRightHeaderActionComponent(this.groupPanel),this._rightHeaderActionsDisposable.value=this._rightHeaderActions,this._rightHeaderActions.init({containerApi:this._api,api:this.groupPanel.api,group:this.groupPanel}),this.tabsContainer.setRightActionsElement(this._rightHeaderActions.element)):(this._rightHeaderActions=void 0,this._rightHeaderActionsDisposable.dispose(),this.tabsContainer.setRightActionsElement(void 0)),this.accessor.options.createLeftHeaderActionComponent?(this._leftHeaderActions=this.accessor.options.createLeftHeaderActionComponent(this.groupPanel),this._leftHeaderActionsDisposable.value=this._leftHeaderActions,this._leftHeaderActions.init({containerApi:this._api,api:this.groupPanel.api,group:this.groupPanel}),this.tabsContainer.setLeftActionsElement(this._leftHeaderActions.element)):(this._leftHeaderActions=void 0,this._leftHeaderActionsDisposable.dispose(),this.tabsContainer.setLeftActionsElement(void 0)),this.accessor.options.createPrefixHeaderActionComponent?(this._prefixHeaderActions=this.accessor.options.createPrefixHeaderActionComponent(this.groupPanel),this._prefixHeaderActionsDisposable.value=this._prefixHeaderActions,this._prefixHeaderActions.init({containerApi:this._api,api:this.groupPanel.api,group:this.groupPanel}),this.tabsContainer.setPrefixActionsElement(this._prefixHeaderActions.element)):(this._prefixHeaderActions=void 0,this._prefixHeaderActionsDisposable.dispose(),this.tabsContainer.setPrefixActionsElement(void 0))}rerender(e){this.contentContainer.renderPanel(e,{asActive:!1})}indexOf(e){return this.tabsContainer.indexOf(e.id)}toJSON(){var e;const t={views:this.tabsContainer.panels,activeView:(e=this._activePanel)===null||e===void 0?void 0:e.id,id:this.id};return this.locked!==!1&&(t.locked=this.locked),this.header.hidden&&(t.hideHeader=!0),this.headerPosition!=="top"&&(t.headerPosition=this.headerPosition),t}moveToNext(e){e||(e={}),e.panel||(e.panel=this.activePanel);const t=e.panel?this.panels.indexOf(e.panel):-1;let i;if(t<this.panels.length-1)i=t+1;else if(!e.suppressRoll)i=0;else return;this.openPanel(this.panels[i])}moveToPrevious(e){if(e||(e={}),e.panel||(e.panel=this.activePanel),!e.panel)return;const t=this.panels.indexOf(e.panel);let i;if(t>0)i=t-1;else if(!e.suppressRoll)i=this.panels.length-1;else return;this.openPanel(this.panels[i])}containsPanel(e){return this.panels.includes(e)}init(e){}update(e){}focus(){var e;(e=this._activePanel)===null||e===void 0||e.focus()}openPanel(e,t={}){(typeof t.index!="number"||t.index>this.panels.length)&&(t.index=this.panels.length);const i=!!t.skipSetActive;if(e.updateParentGroup(this.groupPanel,{skipSetActive:t.skipSetActive}),this.doAddPanel(e,t.index,{skipSetActive:i}),this._activePanel===e){this.contentContainer.renderPanel(e,{asActive:!0});return}i||this.doSetActivePanel(e),t.skipSetGroupActive||this.accessor.doSetGroupActive(this.groupPanel),t.skipSetActive||this.updateContainer()}removePanel(e,t={skipSetActive:!1}){const i=typeof e=="string"?e:e.id,n=this._panels.find(o=>o.id===i);if(!n)throw new Error("invalid operation");return this._removePanel(n,t)}closeAllPanels(){if(this.panels.length>0){const e=[...this.panels];for(const t of e)this.doClose(t)}else this.accessor.removeGroup(this.groupPanel)}closePanel(e){this.doClose(e)}doClose(e){const t=this.panels.length===1&&this.accessor.groups.length===1;this.accessor.removePanel(e,t&&this.accessor.options.noPanelsOverlay==="emptyGroup"?{removeEmptyGroup:!1}:void 0)}isPanelActive(e){return this._activePanel===e}updateActions(e){this.tabsContainer.setRightActionsElement(e)}setActive(e,t=!1){!t&&this.isActive===e||(this._isGroupActive=e,x(this.container,"dv-active-group",e),x(this.container,"dv-inactive-group",!e),this.tabsContainer.setActive(this.isActive),!this._activePanel&&this.panels.length>0&&this.doSetActivePanel(this.panels[0]),this.updateContainer())}layout(e,t){var i;this._width=e,this._height=t,this.contentContainer.layout(this._width,this._height),!((i=this._activePanel)===null||i===void 0)&&i.layout&&this._activePanel.layout(this._width,this._height)}_removePanel(e,t){const i=this._activePanel===e;if(this.doRemovePanel(e),i&&this.panels.length>0){const n=this.mostRecentlyUsed[0];this.openPanel(n,{skipSetActive:t.skipSetActive,skipSetGroupActive:t.skipSetActiveGroup})}return this._activePanel&&this.panels.length===0&&this.doSetActivePanel(void 0),t.skipSetActive||this.updateContainer(),e}doRemovePanel(e){const t=this.panels.indexOf(e);if(this._activePanel===e&&this.contentContainer.closePanel(),this.tabsContainer.delete(e.id),this._panels.splice(t,1),this.mostRecentlyUsed.includes(e)){const n=this.mostRecentlyUsed.indexOf(e);this.mostRecentlyUsed.splice(n,1)}const i=this._panelDisposables.get(e.id);i&&(i.dispose(),this._panelDisposables.delete(e.id)),this._onDidRemovePanel.fire({panel:e})}doAddPanel(e,t=this.panels.length,i={skipSetActive:!1}){const n=this._panels.indexOf(e)>-1;this.tabsContainer.show(),this.contentContainer.show(),this.tabsContainer.openPanel(e,t),i.skipSetActive?e.api.renderer==="always"&&this.contentContainer.renderPanel(e,{asActive:!1}):this.contentContainer.openPanel(e),!n&&(this.updateMru(e),this.panels.splice(t,0,e),this._panelDisposables.set(e.id,new z(e.api.onDidTitleChange(o=>this._onDidPanelTitleChange.fire(o)),e.api.onDidParametersChange(o=>this._onDidPanelParametersChange.fire(o)))),this._onDidAddPanel.fire({panel:e}))}doSetActivePanel(e){this._activePanel!==e&&(this._activePanel=e,e&&(this.tabsContainer.setActivePanel(e),this.contentContainer.openPanel(e),e.layout(this._width,this._height),this.updateMru(e),this.contentContainer.refreshFocusState(),this._onDidActivePanelChange.fire({panel:e})))}updateMru(e){this.mostRecentlyUsed.includes(e)&&this.mostRecentlyUsed.splice(this.mostRecentlyUsed.indexOf(e),1),this.mostRecentlyUsed=[e,...this.mostRecentlyUsed]}updateContainer(){var e,t;if(this.panels.forEach(i=>i.runEvents()),this.isEmpty&&!this.watermark){const i=this.accessor.createWatermarkComponent();i.init({containerApi:this._api,group:this.groupPanel}),this.watermark=i,S(this.watermark.element,"pointerdown",()=>{this.isActive||this.accessor.doSetGroupActive(this.groupPanel)}),this.contentContainer.element.appendChild(this.watermark.element)}!this.isEmpty&&this.watermark&&(this.watermark.element.remove(),(t=(e=this.watermark).dispose)===null||t===void 0||t.call(e),this.watermark=void 0)}canDisplayOverlay(e,t,i){const n=new ti(e,i,t,J,this.accessor.getPanel(this.id));return this._onUnhandledDragOverEvent.fire(n),n.isAccepted}handleDropEvent(e,t,i,n){if(this.locked==="no-drop-target")return;function o(){switch(e){case"header":return typeof n=="number"?"tab":"header_space";case"content":return"content"}}const r=typeof n=="number"?this.panels[n]:void 0,a=new ii({nativeEvent:t,position:i,panel:r,getData:()=>J(),kind:o(),group:this.groupPanel,api:this._api});if(this._onWillDrop.fire(a),a.defaultPrevented)return;const s=J();if(s&&s.viewId===this.accessor.id){if(e==="content"&&s.groupId===this.id&&(i==="center"||s.panelId===null)||e==="header"&&s.groupId===this.id&&s.panelId===null)return;if(s.panelId===null){const{groupId:h}=s;this._onMove.fire({target:i,groupId:h,index:n});return}if(this.tabsContainer.indexOf(s.panelId)!==-1&&this.tabsContainer.size===1)return;const{groupId:d,panelId:l}=s;if(this.id===d&&!i&&this.tabsContainer.indexOf(l)===n)return;this._onMove.fire({target:i,groupId:s.groupId,itemId:s.panelId,index:n})}else this._onDidDrop.fire(new st({nativeEvent:t,position:i,panel:r,getData:()=>J(),group:this.groupPanel,api:this._api}))}updateDragAndDropState(){this.tabsContainer.updateDragAndDropState()}dispose(){var e,t,i;super.dispose(),(e=this.watermark)===null||e===void 0||e.element.remove(),(i=(t=this.watermark)===null||t===void 0?void 0:t.dispose)===null||i===void 0||i.call(t),this.watermark=void 0;for(const n of this.panels)n.dispose();this.tabsContainer.dispose(),this.contentContainer.dispose()}},at=class extends Zt{constructor(e,t,i){super(e,t),this._onDidConstraintsChangeInternal=new c,this.onDidConstraintsChangeInternal=this._onDidConstraintsChangeInternal.event,this._onDidConstraintsChange=new c,this.onDidConstraintsChange=this._onDidConstraintsChange.event,this._onDidSizeChange=new c,this.onDidSizeChange=this._onDidSizeChange.event,this.addDisposables(this._onDidConstraintsChangeInternal,this._onDidConstraintsChange,this._onDidSizeChange),i&&this.initialize(i)}setConstraints(e){this._onDidConstraintsChangeInternal.fire(e)}setSize(e){this._onDidSizeChange.fire(e)}},ni=class extends ot{get priority(){return this._priority}get snap(){return this._snap}get minimumWidth(){return this.__minimumWidth()}get minimumHeight(){return this.__minimumHeight()}get maximumHeight(){return this.__maximumHeight()}get maximumWidth(){return this.__maximumWidth()}__minimumWidth(){const e=typeof this._minimumWidth=="function"?this._minimumWidth():this._minimumWidth;return e!==this._evaluatedMinimumWidth&&(this._evaluatedMinimumWidth=e,this.updateConstraints()),e}__maximumWidth(){const e=typeof this._maximumWidth=="function"?this._maximumWidth():this._maximumWidth;return e!==this._evaluatedMaximumWidth&&(this._evaluatedMaximumWidth=e,this.updateConstraints()),e}__minimumHeight(){const e=typeof this._minimumHeight=="function"?this._minimumHeight():this._minimumHeight;return e!==this._evaluatedMinimumHeight&&(this._evaluatedMinimumHeight=e,this.updateConstraints()),e}__maximumHeight(){const e=typeof this._maximumHeight=="function"?this._maximumHeight():this._maximumHeight;return e!==this._evaluatedMaximumHeight&&(this._evaluatedMaximumHeight=e,this.updateConstraints()),e}get isActive(){return this.api.isActive}get isVisible(){return this.api.isVisible}constructor(e,t,i,n){super(e,t,n??new at(e,t)),this._evaluatedMinimumWidth=0,this._evaluatedMaximumWidth=Number.MAX_SAFE_INTEGER,this._evaluatedMinimumHeight=0,this._evaluatedMaximumHeight=Number.MAX_SAFE_INTEGER,this._minimumWidth=0,this._minimumHeight=0,this._maximumWidth=Number.MAX_SAFE_INTEGER,this._maximumHeight=Number.MAX_SAFE_INTEGER,this._snap=!1,this._onDidChange=new c,this.onDidChange=this._onDidChange.event,typeof i?.minimumWidth=="number"&&(this._minimumWidth=i.minimumWidth),typeof i?.maximumWidth=="number"&&(this._maximumWidth=i.maximumWidth),typeof i?.minimumHeight=="number"&&(this._minimumHeight=i.minimumHeight),typeof i?.maximumHeight=="number"&&(this._maximumHeight=i.maximumHeight),this.api.initialize(this),this.addDisposables(this.api.onWillVisibilityChange(o=>{const{isVisible:r}=o,{accessor:a}=this._params;a.setVisible(this,r)}),this.api.onActiveChange(()=>{const{accessor:o}=this._params;o.doSetGroupActive(this)}),this.api.onDidConstraintsChangeInternal(o=>{(typeof o.minimumWidth=="number"||typeof o.minimumWidth=="function")&&(this._minimumWidth=o.minimumWidth),(typeof o.minimumHeight=="number"||typeof o.minimumHeight=="function")&&(this._minimumHeight=o.minimumHeight),(typeof o.maximumWidth=="number"||typeof o.maximumWidth=="function")&&(this._maximumWidth=o.maximumWidth),(typeof o.maximumHeight=="number"||typeof o.maximumHeight=="function")&&(this._maximumHeight=o.maximumHeight)}),this.api.onDidSizeChange(o=>{this._onDidChange.fire({height:o.height,width:o.width})}),this._onDidChange)}setVisible(e){this.api._onDidVisibilityChange.fire({isVisible:e})}setActive(e){this.api._onDidActiveChange.fire({isActive:e})}init(e){e.maximumHeight&&(this._maximumHeight=e.maximumHeight),e.minimumHeight&&(this._minimumHeight=e.minimumHeight),e.maximumWidth&&(this._maximumWidth=e.maximumWidth),e.minimumWidth&&(this._minimumWidth=e.minimumWidth),this._priority=e.priority,this._snap=!!e.snap,super.init(e),typeof e.isVisible=="boolean"&&this.setVisible(e.isVisible)}updateConstraints(){this.api._onDidConstraintsChange.fire({minimumWidth:this._evaluatedMinimumWidth,maximumWidth:this._evaluatedMaximumWidth,minimumHeight:this._evaluatedMinimumHeight,maximumHeight:this._evaluatedMaximumHeight})}toJSON(){const e=super.toJSON(),t=n=>n===Number.MAX_SAFE_INTEGER?void 0:n,i=n=>n<=0?void 0:n;return Object.assign(Object.assign({},e),{minimumHeight:i(this.minimumHeight),maximumHeight:t(this.maximumHeight),minimumWidth:i(this.minimumWidth),maximumWidth:t(this.maximumWidth),snap:this.snap,priority:this.priority})}},le="dockview: DockviewGroupPanelApiImpl not initialized",In=class extends at{get location(){if(!this._group)throw new Error(le);return this._group.model.location}constructor(e,t){super(e,"__dockviewgroup__"),this.accessor=t,this._onDidLocationChange=new c,this.onDidLocationChange=this._onDidLocationChange.event,this._onDidActivePanelChange=new c,this.onDidActivePanelChange=this._onDidActivePanelChange.event,this.addDisposables(this._onDidLocationChange,this._onDidActivePanelChange,this._onDidVisibilityChange.event(i=>{i.isVisible&&this._pendingSize&&(super.setSize(this._pendingSize),this._pendingSize=void 0)}))}setSize(e){this._pendingSize=Object.assign({},e),super.setSize(e)}close(){if(this._group)return this.accessor.removeGroup(this._group)}getWindow(){return this.location.type==="popout"?this.location.getWindow():window}setHeaderPosition(e){if(!this._group)throw new Error(le);this._group.model.headerPosition=e}getHeaderPosition(){if(!this._group)throw new Error(le);return this._group.model.headerPosition}moveTo(e){var t,i,n,o;if(!this._group)throw new Error(le);const r=(t=e.group)!==null&&t!==void 0?t:this.accessor.addGroup({direction:rn((i=e.position)!==null&&i!==void 0?i:"right"),skipSetActive:(n=e.skipSetActive)!==null&&n!==void 0?n:!1});this.accessor.moveGroupOrPanel({from:{groupId:this._group.id},to:{group:r,position:e.group&&(o=e.position)!==null&&o!==void 0?o:"center",index:e.index},skipSetActive:e.skipSetActive})}maximize(){if(!this._group)throw new Error(le);this.location.type==="grid"&&this.accessor.maximizeGroup(this._group)}isMaximized(){if(!this._group)throw new Error(le);return this.accessor.isMaximizedGroup(this._group)}exitMaximized(){if(!this._group)throw new Error(le);this.isMaximized()&&this.accessor.exitMaximizedGroup()}initialize(e){this._group=e}},On=100,Gn=100,mt=class extends ni{get minimumWidth(){var e;if(typeof this._explicitConstraints.minimumWidth=="number")return this._explicitConstraints.minimumWidth;const t=(e=this.activePanel)===null||e===void 0?void 0:e.minimumWidth;return typeof t=="number"?t:super.__minimumWidth()}get minimumHeight(){var e;if(typeof this._explicitConstraints.minimumHeight=="number")return this._explicitConstraints.minimumHeight;const t=(e=this.activePanel)===null||e===void 0?void 0:e.minimumHeight;return typeof t=="number"?t:super.__minimumHeight()}get maximumWidth(){var e;if(typeof this._explicitConstraints.maximumWidth=="number")return this._explicitConstraints.maximumWidth;const t=(e=this.activePanel)===null||e===void 0?void 0:e.maximumWidth;return typeof t=="number"?t:super.__maximumWidth()}get maximumHeight(){var e;if(typeof this._explicitConstraints.maximumHeight=="number")return this._explicitConstraints.maximumHeight;const t=(e=this.activePanel)===null||e===void 0?void 0:e.maximumHeight;return typeof t=="number"?t:super.__maximumHeight()}get panels(){return this._model.panels}get activePanel(){return this._model.activePanel}get size(){return this._model.size}get model(){return this._model}get locked(){return this._model.locked}set locked(e){this._model.locked=e}get header(){return this._model.header}constructor(e,t,i){var n,o,r,a,s,d;super(t,"groupview_default",{minimumHeight:(o=(n=i.constraints)===null||n===void 0?void 0:n.minimumHeight)!==null&&o!==void 0?o:Gn,minimumWidth:(a=(r=i.constraints)===null||r===void 0?void 0:r.minimumWidth)!==null&&a!==void 0?a:On,maximumHeight:(s=i.constraints)===null||s===void 0?void 0:s.maximumHeight,maximumWidth:(d=i.constraints)===null||d===void 0?void 0:d.maximumWidth},new In(t,e)),this._explicitConstraints={},this.api.initialize(this),this._model=new En(this.element,e,t,i,this),this.addDisposables(this.model.onDidActivePanelChange(l=>{this.api._onDidActivePanelChange.fire(l)}),this.api.onDidConstraintsChangeInternal(l=>{l.minimumWidth!==void 0&&(this._explicitConstraints.minimumWidth=typeof l.minimumWidth=="function"?l.minimumWidth():l.minimumWidth),l.minimumHeight!==void 0&&(this._explicitConstraints.minimumHeight=typeof l.minimumHeight=="function"?l.minimumHeight():l.minimumHeight),l.maximumWidth!==void 0&&(this._explicitConstraints.maximumWidth=typeof l.maximumWidth=="function"?l.maximumWidth():l.maximumWidth),l.maximumHeight!==void 0&&(this._explicitConstraints.maximumHeight=typeof l.maximumHeight=="function"?l.maximumHeight():l.maximumHeight)}))}focus(){this.api.isActive||this.api.setActive(),super.focus()}initialize(){this._model.initialize()}setActive(e){super.setActive(e),this.model.setActive(e)}layout(e,t){super.layout(e,t),this.model.layout(e,t)}getComponent(){return this._model}toJSON(){return this.model.toJSON()}},Tn={name:"abyss",className:"dockview-theme-abyss"},Rn=class extends at{get location(){return this.group.api.location}get title(){return this.panel.title}get isGroupActive(){return this.group.isActive}get renderer(){return this.panel.renderer}set group(e){const t=this._group;this._group!==e&&(this._group=e,this._onDidGroupChange.fire({}),this.setupGroupEventListeners(t),this._onDidLocationChange.fire({location:this.group.api.location}))}get group(){return this._group}get tabComponent(){return this._tabComponent}constructor(e,t,i,n,o){super(e.id,n),this.panel=e,this.accessor=i,this._onDidTitleChange=new c,this.onDidTitleChange=this._onDidTitleChange.event,this._onDidActiveGroupChange=new c,this.onDidActiveGroupChange=this._onDidActiveGroupChange.event,this._onDidGroupChange=new c,this.onDidGroupChange=this._onDidGroupChange.event,this._onDidRendererChange=new c,this.onDidRendererChange=this._onDidRendererChange.event,this._onDidLocationChange=new c,this.onDidLocationChange=this._onDidLocationChange.event,this.groupEventsDisposable=new B,this._tabComponent=o,this.initialize(e),this._group=t,this.setupGroupEventListeners(),this.addDisposables(this.groupEventsDisposable,this._onDidRendererChange,this._onDidTitleChange,this._onDidGroupChange,this._onDidActiveGroupChange,this._onDidLocationChange)}getWindow(){return this.group.api.getWindow()}moveTo(e){var t,i;this.accessor.moveGroupOrPanel({from:{groupId:this._group.id,panelId:this.panel.id},to:{group:(t=e.group)!==null&&t!==void 0?t:this._group,position:e.group&&(i=e.position)!==null&&i!==void 0?i:"center",index:e.index},skipSetActive:e.skipSetActive})}setTitle(e){this.panel.setTitle(e)}setRenderer(e){this.panel.setRenderer(e)}close(){this.group.model.closePanel(this.panel)}maximize(){this.group.api.maximize()}isMaximized(){return this.group.api.isMaximized()}exitMaximized(){this.group.api.exitMaximized()}setupGroupEventListeners(e){var t;let i=(t=e?.isActive)!==null&&t!==void 0?t:!1;this.groupEventsDisposable.value=new z(this.group.api.onDidVisibilityChange(n=>{const o=!n.isVisible&&this.isVisible,r=n.isVisible&&!this.isVisible,a=this.group.model.isPanelActive(this.panel);(o||r&&a)&&this._onDidVisibilityChange.fire(n)}),this.group.api.onDidLocationChange(n=>{this.group===this.panel.group&&this._onDidLocationChange.fire(n)}),this.group.api.onDidActiveChange(()=>{this.group===this.panel.group&&i!==this.isGroupActive&&(i=this.isGroupActive,this._onDidActiveGroupChange.fire({isActive:this.isGroupActive}))}))}},fe=class extends z{get params(){return this._params}get title(){return this._title}get group(){return this._group}get renderer(){var e;return(e=this._renderer)!==null&&e!==void 0?e:this.accessor.renderer}get minimumWidth(){return this._minimumWidth}get minimumHeight(){return this._minimumHeight}get maximumWidth(){return this._maximumWidth}get maximumHeight(){return this._maximumHeight}constructor(e,t,i,n,o,r,a,s){super(),this.id=e,this.accessor=n,this.containerApi=o,this.view=a,this._renderer=s.renderer,this._group=r,this._minimumWidth=s.minimumWidth,this._minimumHeight=s.minimumHeight,this._maximumWidth=s.maximumWidth,this._maximumHeight=s.maximumHeight,this.api=new Rn(this,this._group,n,t,i),this.addDisposables(this.api.onActiveChange(()=>{n.setActivePanel(this)}),this.api.onDidSizeChange(d=>{this.group.api.setSize(d)}),this.api.onDidRendererChange(()=>{this.group.model.rerender(this)}))}init(e){this._params=e.params,this.view.init(Object.assign(Object.assign({},e),{api:this.api,containerApi:this.containerApi})),this.setTitle(e.title)}focus(){const e=new Yt;this.api._onWillFocus.fire(e),!e.defaultPrevented&&(this.api.isActive||this.api.setActive())}toJSON(){return{id:this.id,contentComponent:this.view.contentComponent,tabComponent:this.view.tabComponent,params:Object.keys(this._params||{}).length>0?this._params:void 0,title:this.title,renderer:this._renderer,minimumHeight:this._minimumHeight,maximumHeight:this._maximumHeight,minimumWidth:this._minimumWidth,maximumWidth:this._maximumWidth}}setTitle(e){e!==this.title&&(this._title=e,this.api._onDidTitleChange.fire({title:e}))}setRenderer(e){e!==this.renderer&&(this._renderer=e,this.api._onDidRendererChange.fire({renderer:e}))}update(e){var t;this._params=Object.assign(Object.assign({},(t=this._params)!==null&&t!==void 0?t:{}),e.params);for(const i of Object.keys(e.params))e.params[i]===void 0&&delete this._params[i];this.view.update({params:this._params})}updateFromStateModel(e){var t,i,n;this._maximumHeight=e.maximumHeight,this._minimumHeight=e.minimumHeight,this._maximumWidth=e.maximumWidth,this._minimumWidth=e.minimumWidth,this.update({params:(t=e.params)!==null&&t!==void 0?t:{}}),this.setTitle((i=e.title)!==null&&i!==void 0?i:this.id),this.setRenderer((n=e.renderer)!==null&&n!==void 0?n:this.accessor.renderer)}updateParentGroup(e,t){this._group=e,this.api.group=this._group;const i=this._group.model.isPanelActive(this),n=this.group.api.isActive&&i;t?.skipSetActive||this.api.isActive!==n&&this.api._onDidActiveChange.fire({isActive:this.group.api.isActive&&i}),this.api.isVisible!==i&&this.api._onDidVisibilityChange.fire({isVisible:i})}runEvents(){const e=this._group.model.isPanelActive(this),t=this.group.api.isActive&&e;this.api.isActive!==t&&this.api._onDidActiveChange.fire({isActive:this.group.api.isActive&&e}),this.api.isVisible!==e&&this.api._onDidVisibilityChange.fire({isVisible:e})}layout(e,t){this.api._onDidDimensionChange.fire({width:e,height:t}),this.view.layout(e,t)}dispose(){this.api.dispose(),this.view.dispose()}},gt=class extends z{get element(){return this._element}constructor(){super(),this._element=document.createElement("div"),this._element.className="dv-default-tab",this._content=document.createElement("div"),this._content.className="dv-default-tab-content",this.action=document.createElement("div"),this.action.className="dv-default-tab-action",this.action.appendChild(yn()),this._element.appendChild(this._content),this._element.appendChild(this.action),this.render()}init(e){this._title=e.title,this.addDisposables(e.api.onDidTitleChange(t=>{this._title=t.title,this.render()}),S(this.action,"pointerdown",t=>{t.preventDefault()}),S(this.action,"click",t=>{t.defaultPrevented||(t.preventDefault(),e.api.close())})),this.render()}render(){var e;this._content.textContent!==this._title&&(this._content.textContent=(e=this._title)!==null&&e!==void 0?e:"")}},oi=class{get content(){return this._content}get tab(){return this._tab}constructor(e,t,i,n){this.accessor=e,this.id=t,this.contentComponent=i,this.tabComponent=n,this._content=this.createContentComponent(this.id,i),this._tab=this.createTabComponent(this.id,n)}createTabRenderer(e){var t;const i=this.createTabComponent(this.id,this.tabComponent);return this._params&&i.init(Object.assign(Object.assign({},this._params),{tabLocation:e})),this._updateEvent&&((t=i.update)===null||t===void 0||t.call(i,this._updateEvent)),i}init(e){this._params=e,this.content.init(e),this.tab.init(Object.assign(Object.assign({},e),{tabLocation:"header"}))}layout(e,t){var i,n;(n=(i=this.content).layout)===null||n===void 0||n.call(i,e,t)}update(e){var t,i,n,o;this._updateEvent=e,(i=(t=this.content).update)===null||i===void 0||i.call(t,e),(o=(n=this.tab).update)===null||o===void 0||o.call(n,e)}dispose(){var e,t,i,n;(t=(e=this.content).dispose)===null||t===void 0||t.call(e),(n=(i=this.tab).dispose)===null||n===void 0||n.call(i)}createContentComponent(e,t){return this.accessor.options.createComponent({id:e,name:t})}createTabComponent(e,t){const i=t??this.accessor.options.defaultTabComponent;if(i){if(this.accessor.options.createTabComponent){const n=this.accessor.options.createTabComponent({id:e,name:i});return n||new gt}console.warn(`dockview: tabComponent '${t}' was not found. falling back to the default tab.`)}return new gt}},Ln=class{constructor(e){this.accessor=e}fromJSON(e,t){var i,n;const o=e.id,r=e.params,a=e.title,s=e.view,d=s?s.content.id:(i=e.contentComponent)!==null&&i!==void 0?i:"unknown",l=s?(n=s.tab)===null||n===void 0?void 0:n.id:e.tabComponent,h=new oi(this.accessor,o,d,l),v=new fe(o,d,l,this.accessor,new Te(this.accessor),t,h,{renderer:e.renderer,minimumWidth:e.minimumWidth,minimumHeight:e.minimumHeight,maximumWidth:e.maximumWidth,maximumHeight:e.maximumHeight});return v.init({title:a??o,params:r??{}}),v}},Vn=class extends z{get element(){return this._element}constructor(){super(),this._element=document.createElement("div"),this._element.className="dv-watermark"}init(e){}},Nn=class{constructor(){this._orderedList=[]}push(e){this._orderedList=[...this._orderedList.filter(t=>t!==e),e],this.update()}destroy(e){this._orderedList=this._orderedList.filter(t=>t!==e),this.update()}update(){for(let e=0;e<this._orderedList.length;e++)this._orderedList[e].setAttribute("aria-level",`${e}`),this._orderedList[e].style.zIndex=`calc(var(--dv-overlay-z-index, 999) + ${e*2})`}},Se=new Nn,dt=class he extends z{set minimumInViewportWidth(t){this.options.minimumInViewportWidth=t}set minimumInViewportHeight(t){this.options.minimumInViewportHeight=t}get element(){return this._element}get isVisible(){return this._isVisible}constructor(t){super(),this.options=t,this._element=document.createElement("div"),this._onDidChange=new c,this.onDidChange=this._onDidChange.event,this._onDidChangeEnd=new c,this.onDidChangeEnd=this._onDidChangeEnd.event,this.addDisposables(this._onDidChange,this._onDidChangeEnd),this._element.className="dv-resize-container",this._isVisible=!0,this.setupResize("top"),this.setupResize("bottom"),this.setupResize("left"),this.setupResize("right"),this.setupResize("topleft"),this.setupResize("topright"),this.setupResize("bottomleft"),this.setupResize("bottomright"),this._element.appendChild(this.options.content),this.options.container.appendChild(this._element),this.setBounds(Object.assign(Object.assign(Object.assign(Object.assign({height:this.options.height,width:this.options.width},"top"in this.options&&{top:this.options.top}),"bottom"in this.options&&{bottom:this.options.bottom}),"left"in this.options&&{left:this.options.left}),"right"in this.options&&{right:this.options.right})),Se.push(this._element)}setVisible(t){t!==this.isVisible&&(this._isVisible=t,x(this.element,"dv-hidden",!this.isVisible))}bringToFront(){Se.push(this._element)}setBounds(t={}){typeof t.height=="number"&&(this._element.style.height=`${t.height}px`),typeof t.width=="number"&&(this._element.style.width=`${t.width}px`),"top"in t&&typeof t.top=="number"&&(this._element.style.top=`${t.top}px`,this._element.style.bottom="auto",this.verticalAlignment="top"),"bottom"in t&&typeof t.bottom=="number"&&(this._element.style.bottom=`${t.bottom}px`,this._element.style.top="auto",this.verticalAlignment="bottom"),"left"in t&&typeof t.left=="number"&&(this._element.style.left=`${t.left}px`,this._element.style.right="auto",this.horiziontalAlignment="left"),"right"in t&&typeof t.right=="number"&&(this._element.style.right=`${t.right}px`,this._element.style.left="auto",this.horiziontalAlignment="right");const i=this.options.container.getBoundingClientRect(),n=this._element.getBoundingClientRect(),o=Math.max(0,this.getMinimumWidth(n.width)),r=Math.max(0,this.getMinimumHeight(n.height));if(this.verticalAlignment==="top"){const a=V(n.top-i.top,-r,Math.max(0,i.height-n.height+r));this._element.style.top=`${a}px`,this._element.style.bottom="auto"}if(this.verticalAlignment==="bottom"){const a=V(i.bottom-n.bottom,-r,Math.max(0,i.height-n.height+r));this._element.style.bottom=`${a}px`,this._element.style.top="auto"}if(this.horiziontalAlignment==="left"){const a=V(n.left-i.left,-o,Math.max(0,i.width-n.width+o));this._element.style.left=`${a}px`,this._element.style.right="auto"}if(this.horiziontalAlignment==="right"){const a=V(i.right-n.right,-o,Math.max(0,i.width-n.width+o));this._element.style.right=`${a}px`,this._element.style.left="auto"}this._onDidChange.fire()}toJSON(){const t=this.options.container.getBoundingClientRect(),i=this._element.getBoundingClientRect(),n={};return this.verticalAlignment==="top"?n.top=parseFloat(this._element.style.top):this.verticalAlignment==="bottom"?n.bottom=parseFloat(this._element.style.bottom):n.top=i.top-t.top,this.horiziontalAlignment==="left"?n.left=parseFloat(this._element.style.left):this.horiziontalAlignment==="right"?n.right=parseFloat(this._element.style.right):n.left=i.left-t.left,n.width=i.width,n.height=i.height,n}setupDrag(t,i={inDragMode:!1}){const n=new B,o=()=>{let r=null;const a=Oe();n.value=new z({dispose:()=>{a.release()}},S(window,"pointermove",s=>{const d=this.options.container.getBoundingClientRect(),l=s.clientX-d.left,h=s.clientY-d.top;x(this._element,"dv-resize-container-dragging",!0);const v=this._element.getBoundingClientRect();r===null&&(r={x:s.clientX-v.left,y:s.clientY-v.top});const p=Math.max(0,this.getMinimumWidth(v.width)),b=Math.max(0,this.getMinimumHeight(v.height)),u=V(h-r.y,-b,Math.max(0,d.height-v.height+b)),g=V(r.y-h+d.height-v.height,-b,Math.max(0,d.height-v.height+b)),D=V(l-r.x,-p,Math.max(0,d.width-v.width+p)),A=V(r.x-l+d.width-v.width,-p,Math.max(0,d.width-v.width+p)),k={};u<=g?k.top=u:k.bottom=g,D<=A?k.left=D:k.right=A,this.setBounds(k)}),S(window,"pointerup",()=>{x(this._element,"dv-resize-container-dragging",!1),n.dispose(),this._onDidChangeEnd.fire()}))};this.addDisposables(n,S(t,"pointerdown",r=>{if(r.defaultPrevented){r.preventDefault();return}vt(r)||o()}),S(this.options.content,"pointerdown",r=>{r.defaultPrevented||vt(r)||r.shiftKey&&o()}),S(this.options.content,"pointerdown",()=>{Se.push(this._element)},!0)),i.inDragMode&&o()}setupResize(t){const i=document.createElement("div");i.className=`dv-resize-handle-${t}`,this._element.appendChild(i);const n=new B;this.addDisposables(n,S(i,"pointerdown",o=>{o.preventDefault();let r=null;const a=Oe();n.value=new z(S(window,"pointermove",s=>{const d=this.options.container.getBoundingClientRect(),l=this._element.getBoundingClientRect(),h=s.clientY-d.top,v=s.clientX-d.left;r===null&&(r={originalY:h,originalHeight:l.height,originalX:v,originalWidth:l.width});let p,b,u,g,D,A;const k=()=>{p=V(h,0,r.originalY+r.originalHeight>d.height?Math.max(0,d.height-he.MINIMUM_HEIGHT):Math.max(0,r.originalY+r.originalHeight-he.MINIMUM_HEIGHT)),u=r.originalY+r.originalHeight-p,b=d.height-p-u},_=()=>{p=r.originalY-r.originalHeight;const O=p<0&&typeof this.options.minimumInViewportHeight=="number"?-p+this.options.minimumInViewportHeight:he.MINIMUM_HEIGHT,E=d.height-Math.max(0,p);u=V(h-p,O,E),b=d.height-p-u},T=()=>{g=V(v,0,r.originalX+r.originalWidth>d.width?Math.max(0,d.width-he.MINIMUM_WIDTH):Math.max(0,r.originalX+r.originalWidth-he.MINIMUM_WIDTH)),A=r.originalX+r.originalWidth-g,D=d.width-g-A},R=()=>{g=r.originalX-r.originalWidth;const O=g<0&&typeof this.options.minimumInViewportWidth=="number"?-g+this.options.minimumInViewportWidth:he.MINIMUM_WIDTH,E=d.width-Math.max(0,g);A=V(v-g,O,E),D=d.width-g-A};switch(t){case"top":k();break;case"bottom":_();break;case"left":T();break;case"right":R();break;case"topleft":k(),T();break;case"topright":k(),R();break;case"bottomleft":_(),T();break;case"bottomright":_(),R();break}const C={};p<=b?C.top=p:C.bottom=b,g<=D?C.left=g:C.right=D,C.height=u,C.width=A,this.setBounds(C)}),{dispose:()=>{a.release()}},S(window,"pointerup",()=>{n.dispose(),this._onDidChangeEnd.fire()}))}))}getMinimumWidth(t){return typeof this.options.minimumInViewportWidth=="number"?t-this.options.minimumInViewportWidth:0}getMinimumHeight(t){return typeof this.options.minimumInViewportHeight=="number"?t-this.options.minimumInViewportHeight:0}dispose(){Se.destroy(this._element),this._element.remove(),super.dispose()}};dt.MINIMUM_HEIGHT=20;dt.MINIMUM_WIDTH=20;var Mn=class extends z{constructor(e,t){super(),this.group=e,this.overlay=t,this.addDisposables(t)}position(e){this.overlay.setBounds(e)}},Ae=100,se={left:100,top:100,width:300,height:300},Wn=100,Hn=class{constructor(){this.cache=new Map,this.currentFrameId=0,this.rafId=null}getPosition(e){const t=this.cache.get(e);if(t&&t.frameId===this.currentFrameId)return t.rect;this.scheduleFrameUpdate();const i=Be(e);return this.cache.set(e,{rect:i,frameId:this.currentFrameId}),i}invalidate(){this.currentFrameId++}scheduleFrameUpdate(){this.rafId||(this.rafId=requestAnimationFrame(()=>{this.currentFrameId++,this.rafId=null}))}};function Fn(){const e=document.createElement("div");return e.tabIndex=-1,e}var ft=class extends z{constructor(e,t){super(),this.element=e,this.accessor=t,this.map={},this._disposed=!1,this.positionCache=new Hn,this.pendingUpdates=new Set,this.addDisposables(W.from(()=>{for(const i of Object.values(this.map))i.disposable.dispose(),i.destroy.dispose();this._disposed=!0}))}updateAllPositions(){if(!this._disposed){this.positionCache.invalidate();for(const e of Object.values(this.map))e.panel.api.isVisible&&e.resize&&e.resize()}}detatch(e){if(this.map[e.api.id]){const{disposable:t,destroy:i}=this.map[e.api.id];return t.dispose(),i.dispose(),delete this.map[e.api.id],!0}return!1}attach(e){const{panel:t,referenceContainer:i}=e;if(!this.map[t.api.id]){const l=Fn();l.className="dv-render-overlay",l.style.visibility="hidden",this.map[t.api.id]={panel:t,disposable:W.NONE,destroy:W.NONE,element:l}}const n=this.map[t.api.id].element;t.view.content.element.parentElement!==n&&n.appendChild(t.view.content.element),n.parentElement!==this.element&&this.element.appendChild(n);const o=()=>{const l=t.api.id;this.pendingUpdates.has(l)||(this.pendingUpdates.add(l),requestAnimationFrame(()=>{if(this.pendingUpdates.delete(l),this.isDisposed||!this.map[l])return;const h=this.positionCache.getPosition(i.element),v=this.positionCache.getPosition(this.element),p=h.left-v.left,b=h.top-v.top,u=h.width,g=h.height;n.style.left=`${p}px`,n.style.top=`${b}px`,n.style.width=`${u}px`,n.style.height=`${g}px`,n.style.visibility==="hidden"&&(n.style.visibility=""),x(n,"dv-render-overlay-float",t.group.api.location.type==="floating")}))},r=()=>{t.api.isVisible&&(this.positionCache.invalidate(),o()),n.style.display=t.api.isVisible?"":"none"},a=new B,s=()=>{t.api.location.type==="floating"?queueMicrotask(()=>{const l=this.accessor.floatingGroups.find(b=>b.group===t.api.group);if(!l)return;const h=l.overlay.element,v=()=>{const b=Number(h.getAttribute("aria-level"));n.style.zIndex=`calc(var(--dv-overlay-z-index, 999) + ${b*2+1})`},p=new MutationObserver(()=>{v()});a.value=W.from(()=>p.disconnect()),p.observe(h,{attributeFilter:["aria-level"],attributes:!0}),v()}):n.style.zIndex=""},d=new z(a,new Jt(n,{onDragEnd:l=>{i.dropTarget.dnd.onDragEnd(l)},onDragEnter:l=>{i.dropTarget.dnd.onDragEnter(l)},onDragLeave:l=>{i.dropTarget.dnd.onDragLeave(l)},onDrop:l=>{i.dropTarget.dnd.onDrop(l)},onDragOver:l=>{i.dropTarget.dnd.onDragOver(l)}}),t.api.onDidVisibilityChange(()=>{r()}),t.api.onDidDimensionsChange(()=>{t.api.isVisible&&o()}),t.api.onDidLocationChange(()=>{s()}));return this.map[t.api.id].destroy=W.from(()=>{var l;t.view.content.element.parentElement===n&&n.removeChild(t.view.content.element),(l=n.parentElement)===null||l===void 0||l.removeChild(n)}),s(),queueMicrotask(()=>{this.isDisposed||r()}),this.map[t.api.id].disposable.dispose(),this.map[t.api.id].disposable=d,this.map[t.api.id].resize=o,n}};function Bn(e,t,i,n){function o(r){return r instanceof i?r:new i(function(a){a(r)})}return new(i||(i=Promise))(function(r,a){function s(h){try{l(n.next(h))}catch(v){a(v)}}function d(h){try{l(n.throw(h))}catch(v){a(v)}}function l(h){h.done?r(h.value):o(h.value).then(s,d)}l((n=n.apply(e,t||[])).next())})}var Un=class extends z{get window(){var e,t;return(t=(e=this._window)===null||e===void 0?void 0:e.value)!==null&&t!==void 0?t:null}constructor(e,t,i){super(),this.target=e,this.className=t,this.options=i,this._onWillClose=new c,this.onWillClose=this._onWillClose.event,this._onDidClose=new c,this.onDidClose=this._onDidClose.event,this._window=null,this.addDisposables(this._onWillClose,this._onDidClose,{dispose:()=>{this.close()}})}dimensions(){if(!this._window)return null;const e=this._window.value.screenX;return{top:this._window.value.screenY,left:e,width:this._window.value.innerWidth,height:this._window.value.innerHeight}}close(){var e,t;this._window&&(this._onWillClose.fire(),(t=(e=this.options).onWillClose)===null||t===void 0||t.call(e,{id:this.target,window:this._window.value}),this._window.disposable.dispose(),this._window=null,this._onDidClose.fire())}open(){var e,t;return Bn(this,void 0,void 0,function*(){if(this._window)throw new Error("instance of popout window is already open");const i=`${this.options.url}`,n=Object.entries({top:this.options.top,left:this.options.left,width:this.options.width,height:this.options.height}).map(([s,d])=>`${s}=${d}`).join(","),o=window.open(i,this.target,n);if(!o)return null;const r=new z;this._window={value:o,disposable:r},r.addDisposables(W.from(()=>{o.close()}),S(window,"beforeunload",()=>{this.close()}));const a=this.createPopoutWindowContainer();return this.className&&a.classList.add(this.className),(t=(e=this.options).onDidOpen)===null||t===void 0||t.call(e,{id:this.target,window:o}),new Promise((s,d)=>{o.addEventListener("unload",l=>{}),o.addEventListener("load",()=>{try{const l=o.document;l.title=document.title,l.body.appendChild(a),Li(l,window.document.styleSheets),S(o,"beforeunload",()=>{this.close()}),s(a)}catch(l){d(l)}})})})}createPopoutWindowContainer(){const e=document.createElement("div");return e.classList.add("dv-popout-window"),e.id="dv-popout-window",e.style.position="absolute",e.style.width="100%",e.style.height="100%",e.style.top="0px",e.style.left="0px",e}},$n=class extends z{constructor(e){super(),this.accessor=e,this.init()}init(){const e=new Set,t=new Set;this.addDisposables(this.accessor.onDidAddPanel(i=>{if(e.has(i.api.id))throw new Error(`dockview: Invalid event sequence. [onDidAddPanel] called for panel ${i.api.id} but panel already exists`);e.add(i.api.id)}),this.accessor.onDidRemovePanel(i=>{if(e.has(i.api.id))e.delete(i.api.id);else throw new Error(`dockview: Invalid event sequence. [onDidRemovePanel] called for panel ${i.api.id} but panel does not exists`)}),this.accessor.onDidAddGroup(i=>{if(t.has(i.api.id))throw new Error(`dockview: Invalid event sequence. [onDidAddGroup] called for group ${i.api.id} but group already exists`);t.add(i.api.id)}),this.accessor.onDidRemoveGroup(i=>{if(t.has(i.api.id))t.delete(i.api.id);else throw new Error(`dockview: Invalid event sequence. [onDidRemoveGroup] called for group ${i.api.id} but group does not exists`)}))}},jn=class extends z{constructor(e){super(),this.root=e,this._active=null,this._activeDisposable=new B,this._element=document.createElement("div"),this._element.className="dv-popover-anchor",this._element.style.position="relative",this.root.prepend(this._element),this.addDisposables(W.from(()=>{this.close()}),this._activeDisposable)}openPopover(e,t){var i;this.close();const n=document.createElement("div");n.style.position="absolute",n.style.zIndex=(i=t.zIndex)!==null&&i!==void 0?i:"var(--dv-overlay-z-index)",n.appendChild(e);const o=this._element.getBoundingClientRect(),r=o.left,a=o.top;n.style.top=`${t.y-a}px`,n.style.left=`${t.x-r}px`,this._element.appendChild(n),this._active=n,this._activeDisposable.value=new z(S(window,"pointerdown",s=>{var d;const l=s.target;if(!(l instanceof HTMLElement))return;let h=l;for(;h&&h!==n;)h=(d=h?.parentElement)!==null&&d!==void 0?d:null;h||this.close()}),S(window,"resize",()=>{this.close()})),requestAnimationFrame(()=>{Ui(n,this.root)})}close(){this._active&&(this._active.remove(),this._activeDisposable.dispose(),this._active=null)}},bt=class extends z{get disabled(){return this._disabled}set disabled(e){var t;this.disabled!==e&&(this._disabled=e,e&&((t=this.model)===null||t===void 0||t.clear()))}get model(){if(!this.disabled)return{clear:()=>{var e;this._model&&((e=this._model.root.parentElement)===null||e===void 0||e.removeChild(this._model.root)),this._model=void 0},exists:()=>!!this._model,getElements:(e,t)=>{const i=this._outline!==t;if(this._outline=t,this._model)return this._model.changed=i,this._model;const n=this.createContainer(),o=this.createAnchor();if(this._model={root:n,overlay:o,changed:i},n.appendChild(o),this.element.appendChild(n),e?.target instanceof HTMLElement){const r=e.target.getBoundingClientRect(),a=this.element.getBoundingClientRect();o.style.left=`${r.left-a.left}px`,o.style.top=`${r.top-a.top}px`}return this._model}}}constructor(e,t){super(),this.element=e,this._disabled=!1,this._disabled=t.disabled,this.addDisposables(W.from(()=>{var i;(i=this.model)===null||i===void 0||i.clear()}))}createContainer(){const e=document.createElement("div");return e.className="dv-drop-target-container",e}createAnchor(){const e=document.createElement("div");return e.className="dv-drop-target-anchor",e.style.visibility="hidden",e}},wt={activationSize:{type:"pixels",value:10},size:{type:"pixels",value:20}};function Pe(e){const t=e.from.activePanel;[...e.from.panels].map(i=>{const n=e.from.model.removePanel(i);return e.from.model.renderContainer.detatch(i),n}).forEach(i=>{e.to.model.openPanel(i,{skipSetActive:t!==i,skipSetGroupActive:!0})})}var Jn=class extends Ut{get orientation(){return this.gridview.orientation}get totalPanels(){return this.panels.length}get panels(){return this.groups.flatMap(e=>e.panels)}get options(){return this._options}get activePanel(){const e=this.activeGroup;if(e)return e.activePanel}get renderer(){var e;return(e=this.options.defaultRenderer)!==null&&e!==void 0?e:"onlyWhenVisible"}get defaultHeaderPosition(){var e;return(e=this.options.defaultHeaderPosition)!==null&&e!==void 0?e:"top"}get api(){return this._api}get floatingGroups(){return this._floatingGroups}get popoutRestorationPromise(){return this._popoutRestorationPromise}constructor(e,t){var i,n,o;super(e,{proportionalLayout:!0,orientation:y.HORIZONTAL,styles:t.hideBorders?{separatorBorder:"transparent"}:void 0,disableAutoResizing:t.disableAutoResizing,locked:t.locked,margin:(n=(i=t.theme)===null||i===void 0?void 0:i.gap)!==null&&n!==void 0?n:0,className:t.className}),this.nextGroupId=tt(),this._deserializer=new Ln(this),this._watermark=null,this._onWillDragPanel=new c,this.onWillDragPanel=this._onWillDragPanel.event,this._onWillDragGroup=new c,this.onWillDragGroup=this._onWillDragGroup.event,this._onDidDrop=new c,this.onDidDrop=this._onDidDrop.event,this._onWillDrop=new c,this.onWillDrop=this._onWillDrop.event,this._onWillShowOverlay=new c,this.onWillShowOverlay=this._onWillShowOverlay.event,this._onUnhandledDragOverEvent=new c,this.onUnhandledDragOverEvent=this._onUnhandledDragOverEvent.event,this._onDidRemovePanel=new c,this.onDidRemovePanel=this._onDidRemovePanel.event,this._onDidAddPanel=new c,this.onDidAddPanel=this._onDidAddPanel.event,this._onDidPopoutGroupSizeChange=new c,this.onDidPopoutGroupSizeChange=this._onDidPopoutGroupSizeChange.event,this._onDidPopoutGroupPositionChange=new c,this.onDidPopoutGroupPositionChange=this._onDidPopoutGroupPositionChange.event,this._onDidOpenPopoutWindowFail=new c,this.onDidOpenPopoutWindowFail=this._onDidOpenPopoutWindowFail.event,this._onDidLayoutFromJSON=new c,this.onDidLayoutFromJSON=this._onDidLayoutFromJSON.event,this._onDidActivePanelChange=new c({replay:!0}),this.onDidActivePanelChange=this._onDidActivePanelChange.event,this._onDidMovePanel=new c,this.onDidMovePanel=this._onDidMovePanel.event,this._onDidMaximizedGroupChange=new c,this.onDidMaximizedGroupChange=this._onDidMaximizedGroupChange.event,this._floatingGroups=[],this._popoutGroups=[],this._popoutRestorationPromise=Promise.resolve(),this._onDidRemoveGroup=new c,this.onDidRemoveGroup=this._onDidRemoveGroup.event,this._onDidAddGroup=new c,this.onDidAddGroup=this._onDidAddGroup.event,this._onDidOptionsChange=new c,this.onDidOptionsChange=this._onDidOptionsChange.event,this._onDidActiveGroupChange=new c,this.onDidActiveGroupChange=this._onDidActiveGroupChange.event,this._moving=!1,this._options=t,this.popupService=new jn(this.element),this._themeClassnames=new Le(this.element),this._api=new Te(this),this.rootDropTargetContainer=new bt(this.element,{disabled:!0}),this.overlayRenderContainer=new ft(this.gridview.element,this),this._rootDropTarget=new we(this.element,{className:"dv-drop-target-edge",canDisplayOverlay:(r,a)=>{const s=J();if(s)return s.viewId!==this.id?!1:a==="center"?this.gridview.length===0:!0;if(a==="center"&&this.gridview.length!==0)return!1;const d=new ti(r,"edge",a,J);return this._onUnhandledDragOverEvent.fire(d),d.isAccepted},acceptedTargetZones:["top","bottom","left","right","center"],overlayModel:(o=t.rootOverlayModel)!==null&&o!==void 0?o:wt,getOverrideTarget:()=>{var r;return(r=this.rootDropTargetContainer)===null||r===void 0?void 0:r.model}}),this.updateDropTargetModel(t),x(this.gridview.element,"dv-dockview",!0),x(this.element,"dv-debug",!!t.debug),this.updateTheme(),this.updateWatermark(),t.debug&&this.addDisposables(new $n(this)),this.addDisposables(this.rootDropTargetContainer,this.overlayRenderContainer,this._onWillDragPanel,this._onWillDragGroup,this._onWillShowOverlay,this._onDidActivePanelChange,this._onDidAddPanel,this._onDidRemovePanel,this._onDidLayoutFromJSON,this._onDidDrop,this._onWillDrop,this._onDidMovePanel,this._onDidMovePanel.event(()=>{this.debouncedUpdateAllPositions()}),this._onDidAddGroup,this._onDidRemoveGroup,this._onDidActiveGroupChange,this._onUnhandledDragOverEvent,this._onDidMaximizedGroupChange,this._onDidOptionsChange,this._onDidPopoutGroupSizeChange,this._onDidPopoutGroupPositionChange,this._onDidOpenPopoutWindowFail,this.onDidViewVisibilityChangeMicroTaskQueue(()=>{this.updateWatermark()}),this.onDidAdd(r=>{this._moving||this._onDidAddGroup.fire(r)}),this.onDidRemove(r=>{this._moving||this._onDidRemoveGroup.fire(r)}),this.onDidActiveChange(r=>{this._moving||this._onDidActiveGroupChange.fire(r)}),this.onDidMaximizedChange(r=>{this._onDidMaximizedGroupChange.fire({group:r.panel,isMaximized:r.isMaximized})}),ce.any(this.onDidAdd,this.onDidRemove)(()=>{this.updateWatermark()}),ce.any(this.onDidAddPanel,this.onDidRemovePanel,this.onDidAddGroup,this.onDidRemove,this.onDidMovePanel,this.onDidActivePanelChange,this.onDidPopoutGroupPositionChange,this.onDidPopoutGroupSizeChange)(()=>{this._bufferOnDidLayoutChange.fire()}),W.from(()=>{for(const r of[...this._floatingGroups])r.dispose();for(const r of[...this._popoutGroups])r.disposable.dispose()}),this._rootDropTarget,this._rootDropTarget.onWillShowOverlay(r=>{this.gridview.length>0&&r.position==="center"||this._onWillShowOverlay.fire(new Ve(r,{kind:"edge",panel:void 0,api:this._api,group:void 0,getData:J}))}),this._rootDropTarget.onDrop(r=>{var a;const s=new ii({nativeEvent:r.nativeEvent,position:r.position,panel:void 0,api:this._api,group:void 0,getData:J,kind:"edge"});if(this._onWillDrop.fire(s),s.defaultPrevented)return;const d=J();d?this.moveGroupOrPanel({from:{groupId:d.groupId,panelId:(a=d.panelId)!==null&&a!==void 0?a:void 0},to:{group:this.orthogonalize(r.position),position:"center"}}):this._onDidDrop.fire(new st({nativeEvent:r.nativeEvent,position:r.position,panel:void 0,api:this._api,group:void 0,getData:J}))}),this._rootDropTarget)}setVisible(e,t){switch(e.api.location.type){case"grid":super.setVisible(e,t);break;case"floating":{const i=this.floatingGroups.find(n=>n.group===e);i&&(i.overlay.setVisible(t),e.api._onDidVisibilityChange.fire({isVisible:t}));break}case"popout":console.warn("dockview: You cannot hide a group that is in a popout window");break}}addPopoutGroup(e,t){var i,n,o,r,a;if(e instanceof fe&&e.group.size===1)return this.addPopoutGroup(e.group,t);const s=Wi(this.gridview.element),d=this.element;function l(){return t?.position?t.position:e instanceof mt?e.element.getBoundingClientRect():e.group?e.group.element.getBoundingClientRect():d.getBoundingClientRect()}const h=l(),v=(n=(i=t?.overridePopoutGroup)===null||i===void 0?void 0:i.id)!==null&&n!==void 0?n:this.getNextGroupId(),p=new Un(`${this.id}-${v}`,s??"",{url:(a=(o=t?.popoutUrl)!==null&&o!==void 0?o:(r=this.options)===null||r===void 0?void 0:r.popoutUrl)!==null&&a!==void 0?a:"/popout.html",left:window.screenX+h.left,top:window.screenY+h.top,width:h.width,height:h.height,onDidOpen:t?.onDidOpen,onWillClose:t?.onWillClose}),b=new z(p,p.onDidClose(()=>{b.dispose()}));return p.open().then(u=>{var g;if(p.isDisposed)return!1;const D=t?.referenceGroup?t.referenceGroup:e instanceof fe?e.group:e,A=e.api.location.type,k=D.element.parentElement!==null;let _;if(k?t?.overridePopoutGroup?_=t.overridePopoutGroup:(_=this.createGroup({id:v}),u&&this._onDidAddGroup.fire(_)):_=D,u===null)return console.error("dockview: failed to create popout. perhaps you need to allow pop-ups for this website"),b.dispose(),this._onDidOpenPopoutWindowFail.fire(),this.movingLock(()=>Pe({from:_,to:D})),D.api.isVisible||D.api.setVisible(!0),!1;const T=document.createElement("div");T.className="dv-overlay-render-container";const R=new ft(T,this);_.model.renderContainer=R,_.layout(p.window.innerWidth,p.window.innerHeight);let C;if(!t?.overridePopoutGroup&&k)if(e instanceof fe)this.movingLock(()=>{const P=D.model.removePanel(e);_.model.openPanel(P)});else switch(this.movingLock(()=>Pe({from:D,to:_})),A){case"grid":D.api.setVisible(!1);break;case"floating":case"popout":C=(g=this._floatingGroups.find(P=>P.group.api.id===e.api.id))===null||g===void 0?void 0:g.overlay.toJSON(),this.removeGroup(D);break}u.classList.add("dv-dockview"),u.style.overflow="hidden",u.appendChild(T),u.appendChild(_.element);const O=document.createElement("div"),E=new bt(O,{disabled:this.rootDropTargetContainer.disabled});u.appendChild(O),_.model.dropTargetContainer=E,_.model.location={type:"popout",getWindow:()=>p.window,popoutUrl:t?.popoutUrl},k&&e.api.location.type==="grid"&&e.api.setVisible(!1),this.doSetGroupAndPanelActive(_),b.addDisposables(_.api.onDidActiveChange(P=>{var f;P.isActive&&((f=p.window)===null||f===void 0||f.focus())}),_.api.onWillFocus(()=>{var P;(P=p.window)===null||P===void 0||P.focus()}));let L;const U=k&&D&&this.getPanel(D.id),j={window:p,popoutGroup:_,referenceGroup:U?D.id:void 0,disposable:{dispose:()=>(b.dispose(),L)}},Z=Fi(p.window);return b.addDisposables(Z,Bi(p.window,()=>{this._onDidPopoutGroupSizeChange.fire({width:p.window.innerWidth,height:p.window.innerHeight,group:_})}),Z.event(()=>{this._onDidPopoutGroupPositionChange.fire({screenX:p.window.screenX,screenY:p.window.screenX,group:_})}),S(p.window,"resize",()=>{_.layout(p.window.innerWidth,p.window.innerHeight)}),R,W.from(()=>{if(!this.isDisposed){if(k&&this.getPanel(D.id))this.movingLock(()=>Pe({from:_,to:D})),D.api.isVisible||D.api.setVisible(!0),this.getPanel(_.id)&&this.doRemoveGroup(_,{skipPopoutAssociated:!0});else if(this.getPanel(_.id)){if(_.model.renderContainer=this.overlayRenderContainer,_.model.dropTargetContainer=this.rootDropTargetContainer,L=_,!this._popoutGroups.find(P=>P.popoutGroup===_))return;C?this.addFloatingGroup(_,{height:C.height,width:C.width,position:C}):(this.doRemoveGroup(_,{skipDispose:!0,skipActive:!0,skipPopoutReturn:!0}),_.model.location={type:"grid"},this.movingLock(()=>{this.doAddGroup(_,[0])})),this.doSetGroupAndPanelActive(_)}}})),this._popoutGroups.push(j),this.updateWatermark(),!0}).catch(u=>(console.error("dockview: failed to create popout.",u),!1))}addFloatingGroup(e,t){var i,n,o,r,a;let s;if(e instanceof fe)s=this.createGroup(),this._onDidAddGroup.fire(s),this.movingLock(()=>this.removePanel(e,{removeEmptyGroup:!0,skipDispose:!0,skipSetActiveGroup:!0})),this.movingLock(()=>s.model.openPanel(e,{skipSetGroupActive:!0}));else{s=e;const u=(i=this._popoutGroups.find(D=>D.popoutGroup===s))===null||i===void 0?void 0:i.referenceGroup,g=u?this.getPanel(u):void 0;typeof t?.skipRemoveGroup=="boolean"&&t.skipRemoveGroup||(g?(this.movingLock(()=>Pe({from:e,to:g})),this.doRemoveGroup(e,{skipPopoutReturn:!0,skipPopoutAssociated:!0}),this.doRemoveGroup(g,{skipDispose:!0}),s=g):this.doRemoveGroup(e,{skipDispose:!0,skipPopoutReturn:!0,skipPopoutAssociated:!1}))}function d(){if(t?.position){const u={};return"left"in t.position?u.left=Math.max(t.position.left,0):"right"in t.position?u.right=Math.max(t.position.right,0):u.left=se.left,"top"in t.position?u.top=Math.max(t.position.top,0):"bottom"in t.position?u.bottom=Math.max(t.position.bottom,0):u.top=se.top,typeof t.width=="number"?u.width=Math.max(t.width,0):u.width=se.width,typeof t.height=="number"?u.height=Math.max(t.height,0):u.height=se.height,u}return{left:typeof t?.x=="number"?Math.max(t.x,0):se.left,top:typeof t?.y=="number"?Math.max(t.y,0):se.top,width:typeof t?.width=="number"?Math.max(t.width,0):se.width,height:typeof t?.height=="number"?Math.max(t.height,0):se.height}}const l=d(),h=new dt(Object.assign(Object.assign({container:this.gridview.element,content:s.element},l),{minimumInViewportWidth:this.options.floatingGroupBounds==="boundedWithinViewport"?void 0:(o=(n=this.options.floatingGroupBounds)===null||n===void 0?void 0:n.minimumWidthWithinViewport)!==null&&o!==void 0?o:Ae,minimumInViewportHeight:this.options.floatingGroupBounds==="boundedWithinViewport"?void 0:(a=(r=this.options.floatingGroupBounds)===null||r===void 0?void 0:r.minimumHeightWithinViewport)!==null&&a!==void 0?a:Ae})),v=s.element.querySelector(".dv-void-container");if(!v)throw new Error("dockview: failed to find drag handle");h.setupDrag(v,{inDragMode:typeof t?.inDragMode=="boolean"?t.inDragMode:!1});const p=new Mn(s,h),b=new z(s.api.onDidActiveChange(u=>{u.isActive&&h.bringToFront()}),Re(s.element,u=>{const{width:g,height:D}=u.contentRect;s.layout(g,D)}));p.addDisposables(h.onDidChange(()=>{s.layout(s.width,s.height)}),h.onDidChangeEnd(()=>{this._bufferOnDidLayoutChange.fire()}),s.onDidChange(u=>{h.setBounds({height:u?.height,width:u?.width})}),{dispose:()=>{b.dispose(),He(this._floatingGroups,p),s.model.location={type:"grid"},this.updateWatermark()}}),this._floatingGroups.push(p),s.model.location={type:"floating"},t?.skipActiveGroup||this.doSetGroupAndPanelActive(s),this.updateWatermark()}orthogonalize(e,t){switch(this.gridview.normalize(),e){case"top":case"bottom":this.gridview.orientation===y.HORIZONTAL&&this.gridview.insertOrthogonalSplitviewAtRoot();break;case"left":case"right":this.gridview.orientation===y.VERTICAL&&this.gridview.insertOrthogonalSplitviewAtRoot();break}switch(e){case"top":case"left":case"center":return this.createGroupAtLocation([0],void 0,t);case"bottom":case"right":return this.createGroupAtLocation([this.gridview.length],void 0,t);default:throw new Error(`dockview: unsupported position ${e}`)}}updateOptions(e){var t,i;if(super.updateOptions(e),"floatingGroupBounds"in e)for(const o of this._floatingGroups){switch(e.floatingGroupBounds){case"boundedWithinViewport":o.overlay.minimumInViewportHeight=void 0,o.overlay.minimumInViewportWidth=void 0;break;case void 0:o.overlay.minimumInViewportHeight=Ae,o.overlay.minimumInViewportWidth=Ae;break;default:o.overlay.minimumInViewportHeight=(t=e.floatingGroupBounds)===null||t===void 0?void 0:t.minimumHeightWithinViewport,o.overlay.minimumInViewportWidth=(i=e.floatingGroupBounds)===null||i===void 0?void 0:i.minimumWidthWithinViewport}o.overlay.setBounds()}this.updateDropTargetModel(e);const n=this.options.disableDnd;if(this._options=Object.assign(Object.assign({},this.options),e),n!==this.options.disableDnd&&this.updateDragAndDropState(),"theme"in e&&this.updateTheme(),"createRightHeaderActionComponent"in e||"createLeftHeaderActionComponent"in e||"createPrefixHeaderActionComponent"in e)for(const o of this.groups)o.model.updateHeaderActions();this.layout(this.gridview.width,this.gridview.height,!0)}layout(e,t,i){if(super.layout(e,t,i),this._floatingGroups)for(const n of this._floatingGroups)n.overlay.setBounds()}updateDragAndDropState(){for(const e of this.groups)e.model.updateDragAndDropState()}focus(){var e;(e=this.activeGroup)===null||e===void 0||e.focus()}getGroupPanel(e){return this.panels.find(t=>t.id===e)}setActivePanel(e){e.group.model.openPanel(e),this.doSetGroupAndPanelActive(e.group)}moveToNext(e={}){var t;if(!e.group){if(!this.activeGroup)return;e.group=this.activeGroup}if(e.includePanel&&e.group&&e.group.activePanel!==e.group.panels[e.group.panels.length-1]){e.group.model.moveToNext({suppressRoll:!0});return}const i=N(e.group.element),n=(t=this.gridview.next(i))===null||t===void 0?void 0:t.view;this.doSetGroupAndPanelActive(n)}moveToPrevious(e={}){var t;if(!e.group){if(!this.activeGroup)return;e.group=this.activeGroup}if(e.includePanel&&e.group&&e.group.activePanel!==e.group.panels[0]){e.group.model.moveToPrevious({suppressRoll:!0});return}const i=N(e.group.element),n=(t=this.gridview.previous(i))===null||t===void 0?void 0:t.view;n&&this.doSetGroupAndPanelActive(n)}toJSON(){var e;const t=this.gridview.serialize(),i=this.panels.reduce((a,s)=>(a[s.id]=s.toJSON(),a),{}),n=this._floatingGroups.map(a=>({data:a.group.toJSON(),position:a.overlay.toJSON()})),o=this._popoutGroups.map(a=>({data:a.popoutGroup.toJSON(),gridReferenceGroup:a.referenceGroup,position:a.window.dimensions(),url:a.popoutGroup.api.location.type==="popout"?a.popoutGroup.api.location.popoutUrl:void 0})),r={grid:t,panels:i,activeGroup:(e=this.activeGroup)===null||e===void 0?void 0:e.id};return n.length>0&&(r.floatingGroups=n),o.length>0&&(r.popoutGroups=o),r}fromJSON(e,t){var i,n;const o=new Map;let r;if(t?.reuseExistingPanels){r=this.createGroup(),this._groups.delete(r.api.id);const l=Object.keys(e.panels);for(const h of this.panels)l.includes(h.api.id)&&o.set(h.api.id,h);this.movingLock(()=>{Array.from(o.values()).forEach(h=>{this.moveGroupOrPanel({from:{groupId:h.api.group.api.id,panelId:h.api.id},to:{group:r,position:"center"},keepEmptyGroups:!0})})})}if(this.clear(),typeof e!="object"||e===null)throw new Error("dockview: serialized layout must be a non-null object");const{grid:a,panels:s,activeGroup:d}=e;if(a.root.type!=="branch"||!Array.isArray(a.root.data))throw new Error("dockview: root must be of type branch");try{const l=this.width,h=this.height,v=g=>{const{id:D,locked:A,hideHeader:k,headerPosition:_,views:T,activeView:R}=g;if(typeof D!="string")throw new Error("dockview: group id must be of type string");const C=this.createGroup({id:D,locked:!!A,hideHeader:!!k,headerPosition:_});this._onDidAddGroup.fire(C);const O=[];for(const E of T){const L=o.get(E);if(r&&L)this.movingLock(()=>{r.model.removePanel(L)}),O.push(L),L.updateFromStateModel(s[E]);else{const U=this._deserializer.fromJSON(s[E],C);O.push(U)}}for(let E=0;E<T.length;E++){const L=O[E],U=typeof R=="string"&&R===L.id;o.has(L.api.id)?this.movingLock(()=>{C.model.openPanel(L,{skipSetActive:!U,skipSetGroupActive:!0})}):C.model.openPanel(L,{skipSetActive:!U,skipSetGroupActive:!0})}return!C.activePanel&&C.panels.length>0&&C.model.openPanel(C.panels[C.panels.length-1],{skipSetGroupActive:!0}),C};this.gridview.deserialize(a,{fromJSON:g=>v(g.data)}),this.layout(l,h,!0);const p=(i=e.floatingGroups)!==null&&i!==void 0?i:[];for(const g of p){const{data:D,position:A}=g,k=v(D);this.addFloatingGroup(k,{position:A,width:A.width,height:A.height,skipRemoveGroup:!0,inDragMode:!1})}const b=(n=e.popoutGroups)!==null&&n!==void 0?n:[],u=[];b.forEach((g,D)=>{const{data:A,position:k,gridReferenceGroup:_,url:T}=g,R=v(A),C=new Promise(O=>{setTimeout(()=>{this.addPopoutGroup(R,{position:k??void 0,overridePopoutGroup:_?R:void 0,referenceGroup:_?this.getPanel(_):void 0,popoutUrl:T}),O()},D*Wn)});u.push(C)}),this._popoutRestorationPromise=Promise.all(u).then(()=>{});for(const g of this._floatingGroups)g.overlay.setBounds();if(typeof d=="string"){const g=this.getPanel(d);g&&this.doSetGroupAndPanelActive(g)}}catch(l){console.error("dockview: failed to deserialize layout. Reverting changes",l);for(const h of this.groups)for(const v of h.panels)this.removePanel(v,{removeEmptyGroup:!1,skipDispose:!1});for(const h of this.groups)h.dispose(),this._groups.delete(h.id),this._onDidRemoveGroup.fire(h);for(const h of[...this._floatingGroups])h.dispose();throw this.clear(),l}this.updateWatermark(),this.debouncedUpdateAllPositions(),this._onDidLayoutFromJSON.fire()}clear(){const e=Array.from(this._groups.values()).map(i=>i.value),t=!!this.activeGroup;for(const i of e)this.removeGroup(i,{skipActive:!0});t&&this.doSetGroupAndPanelActive(void 0),this.gridview.clear()}closeAllGroups(){for(const e of this._groups.entries()){const[t,i]=e;i.value.model.closeAllPanels()}}addPanel(e){var t,i;if(this.panels.find(s=>s.id===e.id))throw new Error(`dockview: panel with id ${e.id} already exists`);let n;if(e.position&&e.floating)throw new Error("dockview: you can only provide one of: position, floating as arguments to .addPanel(...)");const o={width:e.initialWidth,height:e.initialHeight};let r;if(e.position)if(kn(e.position)){const s=typeof e.position.referencePanel=="string"?this.getGroupPanel(e.position.referencePanel):e.position.referencePanel;if(r=e.position.index,!s)throw new Error(`dockview: referencePanel '${e.position.referencePanel}' does not exist`);n=this.findGroup(s)}else if(Sn(e.position)){if(n=typeof e.position.referenceGroup=="string"?(t=this._groups.get(e.position.referenceGroup))===null||t===void 0?void 0:t.value:e.position.referenceGroup,r=e.position.index,!n)throw new Error(`dockview: referenceGroup '${e.position.referenceGroup}' does not exist`)}else{const s=this.orthogonalize(ut(e.position.direction)),d=this.createPanel(e,s);return s.model.openPanel(d,{skipSetActive:e.inactive,skipSetGroupActive:e.inactive,index:r}),e.inactive||this.doSetGroupAndPanelActive(s),s.api.setSize({height:o?.height,width:o?.width}),d}else n=this.activeGroup;let a;if(n){const s=Ge(((i=e.position)===null||i===void 0?void 0:i.direction)||"within");if(e.floating){const d=this.createGroup();this._onDidAddGroup.fire(d);const l=typeof e.floating=="object"&&e.floating!==null?e.floating:{};this.addFloatingGroup(d,Object.assign(Object.assign({},l),{inDragMode:!1,skipRemoveGroup:!0,skipActiveGroup:!0})),a=this.createPanel(e,d),d.model.openPanel(a,{skipSetActive:e.inactive,skipSetGroupActive:e.inactive,index:r})}else if(n.api.location.type==="floating"||s==="center")a=this.createPanel(e,n),n.model.openPanel(a,{skipSetActive:e.inactive,skipSetGroupActive:e.inactive,index:r}),n.api.setSize({width:o?.width,height:o?.height}),e.inactive||this.doSetGroupAndPanelActive(n);else{const d=N(n.element),l=ne(this.gridview.orientation,d,s),h=this.createGroupAtLocation(l,this.orientationAtLocation(l)===y.VERTICAL?o?.height:o?.width);a=this.createPanel(e,h),h.model.openPanel(a,{skipSetActive:e.inactive,skipSetGroupActive:e.inactive,index:r}),e.inactive||this.doSetGroupAndPanelActive(h)}}else if(e.floating){const s=this.createGroup();this._onDidAddGroup.fire(s);const d=typeof e.floating=="object"&&e.floating!==null?e.floating:{};this.addFloatingGroup(s,Object.assign(Object.assign({},d),{inDragMode:!1,skipRemoveGroup:!0,skipActiveGroup:!0})),a=this.createPanel(e,s),s.model.openPanel(a,{skipSetActive:e.inactive,skipSetGroupActive:e.inactive,index:r})}else{const s=this.createGroupAtLocation([0],this.gridview.orientation===y.VERTICAL?o?.height:o?.width);a=this.createPanel(e,s),s.model.openPanel(a,{skipSetActive:e.inactive,skipSetGroupActive:e.inactive,index:r}),e.inactive||this.doSetGroupAndPanelActive(s)}return a}removePanel(e,t={removeEmptyGroup:!0}){const i=e.group;if(!i)throw new Error(`dockview: cannot remove panel ${e.id}. it's missing a group.`);i.model.removePanel(e,{skipSetActiveGroup:t.skipSetActiveGroup}),t.skipDispose||(e.group.model.renderContainer.detatch(e),e.dispose()),i.size===0&&t.removeEmptyGroup&&this.removeGroup(i,{skipActive:t.skipSetActiveGroup})}createWatermarkComponent(){return this.options.createWatermarkComponent?this.options.createWatermarkComponent():new Vn}updateWatermark(){var e,t;if(this.groups.filter(i=>i.api.location.type==="grid"&&i.api.isVisible).length===0){if(!this._watermark){this._watermark=this.createWatermarkComponent(),this._watermark.init({containerApi:new Te(this)});const i=document.createElement("div");i.className="dv-watermark-container",Ni(i,"watermark-component"),i.appendChild(this._watermark.element),this.gridview.element.appendChild(i)}}else this._watermark&&(this._watermark.element.parentElement.remove(),(t=(e=this._watermark).dispose)===null||t===void 0||t.call(e),this._watermark=null)}addGroup(e){var t;if(e){let i;if(An(e)){const d=typeof e.referencePanel=="string"?this.panels.find(l=>l.id===e.referencePanel):e.referencePanel;if(!d)throw new Error(`dockview: reference panel ${e.referencePanel} does not exist`);if(i=this.findGroup(d),!i)throw new Error(`dockview: reference group for reference panel ${e.referencePanel} does not exist`)}else if(Pn(e)){if(i=typeof e.referenceGroup=="string"?(t=this._groups.get(e.referenceGroup))===null||t===void 0?void 0:t.value:e.referenceGroup,!i)throw new Error(`dockview: reference group ${e.referenceGroup} does not exist`)}else{const d=this.orthogonalize(ut(e.direction),e);return e.skipSetActive||this.doSetGroupAndPanelActive(d),d}const n=Ge(e.direction||"within"),o=N(i.element),r=ne(this.gridview.orientation,o,n),a=this.createGroup(e),s=this.getLocationOrientation(r)===y.VERTICAL?e.initialHeight:e.initialWidth;return this.doAddGroup(a,r,s),e.skipSetActive||this.doSetGroupAndPanelActive(a),a}else{const i=this.createGroup(e);return this.doAddGroup(i),this.doSetGroupAndPanelActive(i),i}}getLocationOrientation(e){return e.length%2==0&&this.gridview.orientation===y.HORIZONTAL?y.HORIZONTAL:y.VERTICAL}removeGroup(e,t){this.doRemoveGroup(e,t)}doRemoveGroup(e,t){var i;const n=[...e.panels];if(!t?.skipDispose)for(const a of n)this.removePanel(a,{removeEmptyGroup:!1,skipDispose:(i=t?.skipDispose)!==null&&i!==void 0?i:!1});const o=this.activePanel;if(e.api.location.type==="floating"){const a=this._floatingGroups.find(s=>s.group===e);if(a){if(t?.skipDispose||(a.group.dispose(),this._groups.delete(e.id),this._onDidRemoveGroup.fire(e)),He(this._floatingGroups,a),a.dispose(),!t?.skipActive&&this._activeGroup===e){const s=Array.from(this._groups.values());this.doSetGroupAndPanelActive(s.length>0?s[0].value:void 0)}return a.group}throw new Error("dockview: failed to find floating group")}if(e.api.location.type==="popout"){const a=this._popoutGroups.find(s=>s.popoutGroup===e);if(a){if(!t?.skipDispose){if(!t?.skipPopoutAssociated){const d=a.referenceGroup?this.getPanel(a.referenceGroup):void 0;d&&d.panels.length===0&&this.removeGroup(d)}a.popoutGroup.dispose(),this._groups.delete(e.id),this._onDidRemoveGroup.fire(e)}He(this._popoutGroups,a);const s=a.disposable.dispose();if(!t?.skipPopoutReturn&&s&&(this.doAddGroup(s,[0]),this.doSetGroupAndPanelActive(s)),!t?.skipActive&&this._activeGroup===e){const d=Array.from(this._groups.values());this.doSetGroupAndPanelActive(d.length>0?d[0].value:void 0)}return this.updateWatermark(),a.popoutGroup}throw new Error("dockview: failed to find popout group")}const r=super.doRemoveGroup(e,t);return t?.skipActive||this.activePanel!==o&&this._onDidActivePanelChange.fire(this.activePanel),r}debouncedUpdateAllPositions(){this._updatePositionsFrameId!==void 0&&cancelAnimationFrame(this._updatePositionsFrameId),this._updatePositionsFrameId=requestAnimationFrame(()=>{this._updatePositionsFrameId=void 0,this.overlayRenderContainer.updateAllPositions()})}movingLock(e){const t=this._moving;try{return this._moving=!0,e()}finally{this._moving=t}}moveGroupOrPanel(e){var t;const i=e.to.group,n=e.from.groupId,o=e.from.panelId,r=e.to.position,a=e.to.index,s=n?(t=this._groups.get(n))===null||t===void 0?void 0:t.value:void 0;if(!s)throw new Error(`dockview: Failed to find group id ${n}`);if(o===void 0){this.moveGroup({from:{group:s},to:{group:i,position:r},skipSetActive:e.skipSetActive});return}if(!r||r==="center"){const d=this.movingLock(()=>s.model.removePanel(o,{skipSetActive:!1,skipSetActiveGroup:!0}));if(!d)throw new Error(`dockview: No panel with id ${o}`);!e.keepEmptyGroups&&s.model.size===0&&this.doRemoveGroup(s,{skipActive:!0});const l=i.model.size===0;this.movingLock(()=>{var h;return i.model.openPanel(d,{index:a,skipSetActive:((h=e.skipSetActive)!==null&&h!==void 0?h:!1)&&!l,skipSetGroupActive:!0})}),e.skipSetActive||this.doSetGroupAndPanelActive(i),this._onDidMovePanel.fire({panel:d,from:s})}else{const d=N(i.element),l=ne(this.gridview.orientation,d,r);if(s.size<2){const[h,v]=re(l);if(s.api.location.type==="grid"){const[g,D]=re(N(s.element));if(Ft(g,h)){this.gridview.moveView(g,D,v),this._onDidMovePanel.fire({panel:this.getGroupPanel(o),from:s});return}}if(s.api.location.type==="popout"){const g=this._popoutGroups.find(k=>k.popoutGroup===s),D=this.movingLock(()=>g.popoutGroup.model.removePanel(g.popoutGroup.panels[0],{skipSetActive:!0,skipSetActiveGroup:!0}));this.doRemoveGroup(s,{skipActive:!0});const A=this.createGroupAtLocation(l);this.movingLock(()=>A.model.openPanel(D,{skipSetActive:!0})),this.doSetGroupAndPanelActive(A),this._onDidMovePanel.fire({panel:this.getGroupPanel(o),from:s});return}const p=this.movingLock(()=>this.doRemoveGroup(s,{skipActive:!0,skipDispose:!0})),b=N(i.element),u=ne(this.gridview.orientation,b,r);this.movingLock(()=>this.doAddGroup(p,u)),this.doSetGroupAndPanelActive(p),this._onDidMovePanel.fire({panel:this.getGroupPanel(o),from:s})}else{const h=this.movingLock(()=>s.model.removePanel(o,{skipSetActive:!1,skipSetActiveGroup:!0}));if(!h)throw new Error(`dockview: No panel with id ${o}`);const v=ne(this.gridview.orientation,d,r),p=this.createGroupAtLocation(v);this.movingLock(()=>p.model.openPanel(h,{skipSetGroupActive:!0})),this.doSetGroupAndPanelActive(p),this._onDidMovePanel.fire({panel:h,from:s})}}}moveGroup(e){const t=e.from.group,i=e.to.group,n=e.to.position;if(n==="center"){const o=t.activePanel,r=this.movingLock(()=>[...t.panels].map(a=>t.model.removePanel(a.id,{skipSetActive:!0})));t?.model.size===0&&this.doRemoveGroup(t,{skipActive:!0}),this.movingLock(()=>{for(const a of r)i.model.openPanel(a,{skipSetActive:a!==o,skipSetGroupActive:!0})}),e.skipSetActive!==!0?this.doSetGroupAndPanelActive(i):this.activePanel||this.doSetGroupAndPanelActive(i)}else{switch(t.api.location.type){case"grid":this.gridview.removeView(N(t.element));break;case"floating":{const o=this._floatingGroups.find(r=>r.group===t);if(!o)throw new Error("dockview: failed to find floating group");o.dispose();break}case"popout":{const o=this._popoutGroups.find(a=>a.popoutGroup===t);if(!o)throw new Error("dockview: failed to find popout group");const r=this._popoutGroups.indexOf(o);if(r>=0&&this._popoutGroups.splice(r,1),o.referenceGroup){const a=this.getPanel(o.referenceGroup);a&&!a.api.isVisible&&this.doRemoveGroup(a,{skipActive:!0})}o.window.dispose(),i.api.location.type==="grid"?(t.model.renderContainer=this.overlayRenderContainer,t.model.dropTargetContainer=this.rootDropTargetContainer,t.model.location={type:"grid"}):i.api.location.type==="floating"&&(t.model.renderContainer=this.overlayRenderContainer,t.model.dropTargetContainer=this.rootDropTargetContainer,t.model.location={type:"floating"});break}}if(i.api.location.type==="grid"){const o=N(i.element),r=ne(this.gridview.orientation,o,n);let a;switch(this.gridview.orientation){case y.VERTICAL:a=o.length%2==0?t.api.width:t.api.height;break;case y.HORIZONTAL:a=o.length%2==0?t.api.height:t.api.width;break}this.gridview.addView(t,a,r)}else if(i.api.location.type==="floating"){const o=this._floatingGroups.find(r=>r.group===i);if(o){const r=o.overlay.toJSON();let a,s;"left"in r?a=r.left+50:"right"in r?a=Math.max(0,r.right-r.width-50):a=50,"top"in r?s=r.top+50:"bottom"in r?s=Math.max(0,r.bottom-r.height-50):s=50,this.addFloatingGroup(t,{height:r.height,width:r.width,position:{left:a,top:s}})}}}if(t.panels.forEach(o=>{this._onDidMovePanel.fire({panel:o,from:t})}),this.debouncedUpdateAllPositions(),e.skipSetActive===!1){const o=i??t;this.doSetGroupAndPanelActive(o)}}doSetGroupActive(e){super.doSetGroupActive(e);const t=this.activePanel;!this._moving&&t!==this._onDidActivePanelChange.value&&this._onDidActivePanelChange.fire(t)}doSetGroupAndPanelActive(e){super.doSetGroupActive(e);const t=this.activePanel;e&&this.hasMaximizedGroup()&&!this.isMaximizedGroup(e)&&this.exitMaximizedGroup(),!this._moving&&t!==this._onDidActivePanelChange.value&&this._onDidActivePanelChange.fire(t)}getNextGroupId(){let e=this.nextGroupId.next();for(;this._groups.has(e);)e=this.nextGroupId.next();return e}createGroup(e){e||(e={});let t=e?.id;if(t&&this._groups.has(e.id)&&(console.warn(`dockview: Duplicate group id ${e?.id}. reassigning group id to avoid errors`),t=void 0),!t)for(t=this.nextGroupId.next();this._groups.has(t);)t=this.nextGroupId.next();const i=new mt(this,t,e);if(i.init({params:{},accessor:this}),!this._groups.has(i.id)){const n=new z(i.model.onTabDragStart(o=>{this._onWillDragPanel.fire(o)}),i.model.onGroupDragStart(o=>{this._onWillDragGroup.fire(o)}),i.model.onMove(o=>{const{groupId:r,itemId:a,target:s,index:d}=o;this.moveGroupOrPanel({from:{groupId:r,panelId:a},to:{group:i,position:s,index:d}})}),i.model.onDidDrop(o=>{this._onDidDrop.fire(o)}),i.model.onWillDrop(o=>{this._onWillDrop.fire(o)}),i.model.onWillShowOverlay(o=>{if(this.options.disableDnd){o.preventDefault();return}this._onWillShowOverlay.fire(o)}),i.model.onUnhandledDragOverEvent(o=>{this._onUnhandledDragOverEvent.fire(o)}),i.model.onDidAddPanel(o=>{this._moving||this._onDidAddPanel.fire(o.panel)}),i.model.onDidRemovePanel(o=>{this._moving||this._onDidRemovePanel.fire(o.panel)}),i.model.onDidActivePanelChange(o=>{this._moving||o.panel===this.activePanel&&this._onDidActivePanelChange.value!==o.panel&&this._onDidActivePanelChange.fire(o.panel)}),ce.any(i.model.onDidPanelTitleChange,i.model.onDidPanelParametersChange)(()=>{this._bufferOnDidLayoutChange.fire()}));this._groups.set(i.id,{value:i,disposable:n})}return i.initialize(),i}createPanel(e,t){var i,n,o;const r=e.component,a=(i=e.tabComponent)!==null&&i!==void 0?i:this.options.defaultTabComponent,s=new oi(this,e.id,r,a),d=new fe(e.id,r,a,this,this._api,t,s,{renderer:e.renderer,minimumWidth:e.minimumWidth,minimumHeight:e.minimumHeight,maximumWidth:e.maximumWidth,maximumHeight:e.maximumHeight});return d.init({title:(n=e.title)!==null&&n!==void 0?n:e.id,params:(o=e?.params)!==null&&o!==void 0?o:{}}),d}createGroupAtLocation(e,t,i){const n=this.createGroup(i);return this.doAddGroup(n,e,t),n}findGroup(e){var t;return(t=Array.from(this._groups.values()).find(i=>i.value.model.containsPanel(e)))===null||t===void 0?void 0:t.value}orientationAtLocation(e){const t=this.gridview.orientation;return e.length%2==1?t:oe(t)}updateDropTargetModel(e){"dndEdges"in e&&(this._rootDropTarget.disabled=typeof e.dndEdges=="boolean"&&e.dndEdges===!1,typeof e.dndEdges=="object"&&e.dndEdges!==null?this._rootDropTarget.setOverlayModel(e.dndEdges):this._rootDropTarget.setOverlayModel(wt)),"rootOverlayModel"in e&&this.updateDropTargetModel({dndEdges:e.dndEdges})}updateTheme(){var e,t;const i=(e=this._options.theme)!==null&&e!==void 0?e:Tn;this._themeClassnames.setClassNames(i.className),this.gridview.margin=(t=i.gap)!==null&&t!==void 0?t:0,i.dndOverlayMounting==="absolute"?this.rootDropTargetContainer.disabled=!1:this.rootDropTargetContainer.disabled=!0}},Yn=class extends Ut{get orientation(){return this.gridview.orientation}set orientation(e){this.gridview.orientation=e}get options(){return this._options}get deserializer(){return this._deserializer}set deserializer(e){this._deserializer=e}constructor(e,t){var i;super(e,{proportionalLayout:(i=t.proportionalLayout)!==null&&i!==void 0?i:!0,orientation:t.orientation,styles:t.hideBorders?{separatorBorder:"transparent"}:void 0,disableAutoResizing:t.disableAutoResizing,className:t.className}),this._onDidLayoutfromJSON=new c,this.onDidLayoutFromJSON=this._onDidLayoutfromJSON.event,this._onDidRemoveGroup=new c,this.onDidRemoveGroup=this._onDidRemoveGroup.event,this._onDidAddGroup=new c,this.onDidAddGroup=this._onDidAddGroup.event,this._onDidActiveGroupChange=new c,this.onDidActiveGroupChange=this._onDidActiveGroupChange.event,this._options=t,this.addDisposables(this._onDidAddGroup,this._onDidRemoveGroup,this._onDidActiveGroupChange,this.onDidAdd(n=>{this._onDidAddGroup.fire(n)}),this.onDidRemove(n=>{this._onDidRemoveGroup.fire(n)}),this.onDidActiveChange(n=>{this._onDidActiveGroupChange.fire(n)}))}updateOptions(e){super.updateOptions(e);const t=typeof e.orientation=="string"&&this.gridview.orientation!==e.orientation;this._options=Object.assign(Object.assign({},this.options),e),t&&(this.gridview.orientation=e.orientation),this.layout(this.gridview.width,this.gridview.height,!0)}removePanel(e){this.removeGroup(e)}toJSON(){var e;return{grid:this.gridview.serialize(),activePanel:(e=this.activeGroup)===null||e===void 0?void 0:e.id}}setVisible(e,t){this.gridview.setViewVisible(N(e.element),t)}setActive(e){this._groups.forEach((t,i)=>{t.value.setActive(e===t.value)})}focus(){var e;(e=this.activeGroup)===null||e===void 0||e.focus()}fromJSON(e){this.clear();const{grid:t,activePanel:i}=e;try{const n=[],o=this.width,r=this.height;if(this.gridview.deserialize(t,{fromJSON:a=>{const{data:s}=a,d=this.options.createComponent({id:s.id,name:s.component});return n.push(()=>d.init({params:s.params,minimumWidth:s.minimumWidth,maximumWidth:s.maximumWidth,minimumHeight:s.minimumHeight,maximumHeight:s.maximumHeight,priority:s.priority,snap:!!s.snap,accessor:this,isVisible:a.visible})),this._onDidAddGroup.fire(d),this.registerPanel(d),d}}),this.layout(o,r,!0),n.forEach(a=>a()),typeof i=="string"){const a=this.getPanel(i);a&&this.doSetGroupActive(a)}}catch(n){for(const o of this.groups)o.dispose(),this._groups.delete(o.id),this._onDidRemoveGroup.fire(o);throw this.clear(),n}this._onDidLayoutfromJSON.fire()}clear(){const e=this.activeGroup,t=Array.from(this._groups.values());for(const i of t)i.disposable.dispose(),this.doRemoveGroup(i.value,{skipActive:!0});e&&this.doSetGroupActive(void 0),this.gridview.clear()}movePanel(e,t){var i;let n;const o=this.gridview.remove(e),r=(i=this._groups.get(t.reference))===null||i===void 0?void 0:i.value;if(!r)throw new Error(`reference group ${t.reference} does not exist`);const a=Ge(t.direction);if(a==="center")throw new Error(`${a} not supported as an option`);{const s=N(r.element);n=ne(this.gridview.orientation,s,a)}this.doAddGroup(o,n,t.size)}addPanel(e){var t,i,n,o;let r=(t=e.location)!==null&&t!==void 0?t:[0];if(!((i=e.position)===null||i===void 0)&&i.referencePanel){const s=(n=this._groups.get(e.position.referencePanel))===null||n===void 0?void 0:n.value;if(!s)throw new Error(`reference group ${e.position.referencePanel} does not exist`);const d=Ge(e.position.direction);if(d==="center")throw new Error(`${d} not supported as an option`);{const l=N(s.element);r=ne(this.gridview.orientation,l,d)}}const a=this.options.createComponent({id:e.id,name:e.component});return a.init({params:(o=e.params)!==null&&o!==void 0?o:{},minimumWidth:e.minimumWidth,maximumWidth:e.maximumWidth,minimumHeight:e.minimumHeight,maximumHeight:e.maximumHeight,priority:e.priority,snap:!!e.snap,accessor:this,isVisible:!0}),this.doAddGroup(a,r,e.size),this.registerPanel(a),this.doSetGroupActive(a),a}registerPanel(e){const t=new z(e.api.onDidFocusChange(i=>{i.isFocused&&this._groups.forEach(n=>{const o=n.value;o!==e?o.setActive(!1):o.setActive(!0)})}));this._groups.set(e.id,{value:e,disposable:t})}moveGroup(e,t,i){const n=this.getPanel(t);if(!n)throw new Error("invalid operation");const o=N(e.element),[r,a]=re(ne(this.gridview.orientation,o,i)),[s,d]=re(N(n.element));if(Ft(s,r)){this.gridview.moveView(s,d,a);return}const l=this.doRemoveGroup(n,{skipActive:!0,skipDispose:!0}),h=N(e.element),v=ne(this.gridview.orientation,h,i);this.doAddGroup(l,v)}removeGroup(e){super.removeGroup(e)}dispose(){super.dispose(),this._onDidLayoutfromJSON.dispose()}},Zn=class extends it{get panels(){return this.splitview.getViews()}get options(){return this._options}get length(){return this._panels.size}get orientation(){return this.splitview.orientation}get splitview(){return this._splitview}set splitview(e){this._splitview&&this._splitview.dispose(),this._splitview=e,this._splitviewChangeDisposable.value=new z(this._splitview.onDidSashEnd(()=>{this._onDidLayoutChange.fire(void 0)}),this._splitview.onDidAddView(t=>this._onDidAddView.fire(t)),this._splitview.onDidRemoveView(t=>this._onDidRemoveView.fire(t)))}get minimumSize(){return this.splitview.minimumSize}get maximumSize(){return this.splitview.maximumSize}get height(){return this.splitview.orientation===y.HORIZONTAL?this.splitview.orthogonalSize:this.splitview.size}get width(){return this.splitview.orientation===y.HORIZONTAL?this.splitview.size:this.splitview.orthogonalSize}constructor(e,t){var i;super(document.createElement("div"),t.disableAutoResizing),this._splitviewChangeDisposable=new B,this._panels=new Map,this._onDidLayoutfromJSON=new c,this.onDidLayoutFromJSON=this._onDidLayoutfromJSON.event,this._onDidAddView=new c,this.onDidAddView=this._onDidAddView.event,this._onDidRemoveView=new c,this.onDidRemoveView=this._onDidRemoveView.event,this._onDidLayoutChange=new c,this.onDidLayoutChange=this._onDidLayoutChange.event,this.element.style.height="100%",this.element.style.width="100%",this._classNames=new Le(this.element),this._classNames.setClassNames((i=t.className)!==null&&i!==void 0?i:""),e.appendChild(this.element),this._options=t,this.splitview=new De(this.element,t),this.addDisposables(this._onDidAddView,this._onDidLayoutfromJSON,this._onDidRemoveView,this._onDidLayoutChange)}updateOptions(e){var t,i;"className"in e&&this._classNames.setClassNames((t=e.className)!==null&&t!==void 0?t:""),"disableResizing"in e&&(this.disableResizing=(i=e.disableAutoResizing)!==null&&i!==void 0?i:!1),typeof e.orientation=="string"&&(this.splitview.orientation=e.orientation),this._options=Object.assign(Object.assign({},this.options),e),this.splitview.layout(this.splitview.size,this.splitview.orthogonalSize)}focus(){var e;(e=this._activePanel)===null||e===void 0||e.focus()}movePanel(e,t){this.splitview.moveView(e,t)}setVisible(e,t){const i=this.panels.indexOf(e);this.splitview.setViewVisible(i,t)}setActive(e,t){this._activePanel=e,this.panels.filter(i=>i!==e).forEach(i=>{i.api._onDidActiveChange.fire({isActive:!1}),t||i.focus()}),e.api._onDidActiveChange.fire({isActive:!0}),t||e.focus()}removePanel(e,t){const i=this._panels.get(e.id);if(!i)throw new Error(`unknown splitview panel ${e.id}`);i.dispose(),this._panels.delete(e.id);const n=this.panels.findIndex(r=>r===e);this.splitview.removeView(n,t).dispose();const o=this.panels;o.length>0&&this.setActive(o[o.length-1])}getPanel(e){return this.panels.find(t=>t.id===e)}addPanel(e){var t;if(this._panels.has(e.id))throw new Error(`panel ${e.id} already exists`);const i=this.options.createComponent({id:e.id,name:e.component});i.orientation=this.splitview.orientation,i.init({params:(t=e.params)!==null&&t!==void 0?t:{},minimumSize:e.minimumSize,maximumSize:e.maximumSize,snap:e.snap,priority:e.priority,accessor:this});const n=typeof e.size=="number"?e.size:K.Distribute,o=typeof e.index=="number"?e.index:void 0;return this.splitview.addView(i,n,o),this.doAddView(i),this.setActive(i),i}layout(e,t){const[i,n]=this.splitview.orientation===y.HORIZONTAL?[e,t]:[t,e];this.splitview.layout(i,n)}doAddView(e){const t=e.api.onDidFocusChange(i=>{i.isFocused&&this.setActive(e,!0)});this._panels.set(e.id,t)}toJSON(){var e;return{views:this.splitview.getViews().map((t,i)=>({size:this.splitview.getViewSize(i),data:t.toJSON(),snap:!!t.snap,priority:t.priority})),activeView:(e=this._activePanel)===null||e===void 0?void 0:e.id,size:this.splitview.size,orientation:this.splitview.orientation}}fromJSON(e){this.clear();const{views:t,orientation:i,size:n,activeView:o}=e,r=[],a=this.width,s=this.height;if(this.splitview=new De(this.element,{orientation:i,proportionalLayout:this.options.proportionalLayout,descriptor:{size:n,views:t.map(d=>{const l=d.data;if(this._panels.has(l.id))throw new Error(`panel ${l.id} already exists`);const h=this.options.createComponent({id:l.id,name:l.component});return r.push(()=>{var v;h.init({params:(v=l.params)!==null&&v!==void 0?v:{},minimumSize:l.minimumSize,maximumSize:l.maximumSize,snap:d.snap,priority:d.priority,accessor:this})}),h.orientation=i,this.doAddView(h),setTimeout(()=>{this._onDidAddView.fire(h)},0),{size:d.size,view:h}})}}),this.layout(a,s),r.forEach(d=>d()),typeof o=="string"){const d=this.getPanel(o);d&&this.setActive(d)}this._onDidLayoutfromJSON.fire()}clear(){for(const e of this._panels.values())e.dispose();for(this._panels.clear();this.splitview.length>0;)this.splitview.removeView(0,K.Distribute,!0).dispose()}dispose(){for(const t of this._panels.values())t.dispose();this._panels.clear();const e=this.splitview.getViews();this._splitviewChangeDisposable.dispose(),this.splitview.dispose();for(const t of e)t.dispose();this.element.remove(),super.dispose()}},_t=class extends z{get element(){return this._element}constructor(){super(),this._expandedIcon=Dn(),this._collapsedIcon=ei(),this.disposable=new B,this.apiRef={api:null},this._element=document.createElement("div"),this.element.className="dv-default-header",this._content=document.createElement("span"),this._expander=document.createElement("div"),this._expander.className="dv-pane-header-icon",this.element.appendChild(this._expander),this.element.appendChild(this._content),this.addDisposables(S(this._element,"click",()=>{var e;(e=this.apiRef.api)===null||e===void 0||e.setExpanded(!this.apiRef.api.isExpanded)}))}init(e){this.apiRef.api=e.api,this._content.textContent=e.title,this.updateIcon(),this.disposable.value=e.api.onDidExpansionChange(()=>{this.updateIcon()})}updateIcon(){var e;const t=!!(!((e=this.apiRef.api)===null||e===void 0)&&e.isExpanded);x(this._expander,"collapsed",!t),t?(this._expander.contains(this._collapsedIcon)&&this._collapsedIcon.remove(),this._expander.contains(this._expandedIcon)||this._expander.appendChild(this._expandedIcon)):(this._expander.contains(this._expandedIcon)&&this._expandedIcon.remove(),this._expander.contains(this._collapsedIcon)||this._expander.appendChild(this._collapsedIcon))}update(e){}dispose(){this.disposable.dispose(),super.dispose()}},Xn=tt(),xt=22,yt=0,Dt=Number.MAX_SAFE_INTEGER,Ct=class extends mn{constructor(e){super({accessor:e.accessor,id:e.id,component:e.component,headerComponent:e.headerComponent,orientation:e.orientation,isExpanded:e.isExpanded,disableDnd:e.disableDnd,headerSize:e.headerSize,minimumBodySize:e.minimumBodySize,maximumBodySize:e.maximumBodySize}),this.options=e}getBodyComponent(){return this.options.body}getHeaderComponent(){return this.options.header}},Kn=class extends it{get id(){return this._id}get panels(){return this.paneview.getPanes()}set paneview(e){this._paneview=e,this._disposable.value=new z(this._paneview.onDidChange(()=>{this._onDidLayoutChange.fire(void 0)}),this._paneview.onDidAddView(t=>this._onDidAddView.fire(t)),this._paneview.onDidRemoveView(t=>this._onDidRemoveView.fire(t)))}get paneview(){return this._paneview}get minimumSize(){return this.paneview.minimumSize}get maximumSize(){return this.paneview.maximumSize}get height(){return this.paneview.orientation===y.HORIZONTAL?this.paneview.orthogonalSize:this.paneview.size}get width(){return this.paneview.orientation===y.HORIZONTAL?this.paneview.size:this.paneview.orthogonalSize}get options(){return this._options}constructor(e,t){var i;super(document.createElement("div"),t.disableAutoResizing),this._id=Xn.next(),this._disposable=new B,this._viewDisposables=new Map,this._onDidLayoutfromJSON=new c,this.onDidLayoutFromJSON=this._onDidLayoutfromJSON.event,this._onDidLayoutChange=new c,this.onDidLayoutChange=this._onDidLayoutChange.event,this._onDidDrop=new c,this.onDidDrop=this._onDidDrop.event,this._onDidAddView=new c,this.onDidAddView=this._onDidAddView.event,this._onDidRemoveView=new c,this.onDidRemoveView=this._onDidRemoveView.event,this._onUnhandledDragOverEvent=new c,this.onUnhandledDragOverEvent=this._onUnhandledDragOverEvent.event,this.element.style.height="100%",this.element.style.width="100%",this.addDisposables(this._onDidLayoutChange,this._onDidLayoutfromJSON,this._onDidDrop,this._onDidAddView,this._onDidRemoveView,this._onUnhandledDragOverEvent),this._classNames=new Le(this.element),this._classNames.setClassNames((i=t.className)!==null&&i!==void 0?i:""),e.appendChild(this.element),this._options=t,this.paneview=new pt(this.element,{orientation:y.VERTICAL}),this.addDisposables(this._disposable)}setVisible(e,t){const i=this.panels.indexOf(e);this.paneview.setViewVisible(i,t)}focus(){}updateOptions(e){var t,i;"className"in e&&this._classNames.setClassNames((t=e.className)!==null&&t!==void 0?t:""),"disableResizing"in e&&(this.disableResizing=(i=e.disableAutoResizing)!==null&&i!==void 0?i:!1),this._options=Object.assign(Object.assign({},this.options),e)}addPanel(e){var t,i;const n=this.options.createComponent({id:e.id,name:e.component});let o;e.headerComponent&&this.options.createHeaderComponent&&(o=this.options.createHeaderComponent({id:e.id,name:e.headerComponent})),o||(o=new _t);const r=new Ct({id:e.id,component:e.component,headerComponent:e.headerComponent,header:o,body:n,orientation:y.VERTICAL,isExpanded:!!e.isExpanded,disableDnd:!!this.options.disableDnd,accessor:this,headerSize:(t=e.headerSize)!==null&&t!==void 0?t:xt,minimumBodySize:yt,maximumBodySize:Dt});this.doAddPanel(r);const a=typeof e.size=="number"?e.size:K.Distribute,s=typeof e.index=="number"?e.index:void 0;return r.init({params:(i=e.params)!==null&&i!==void 0?i:{},minimumBodySize:e.minimumBodySize,maximumBodySize:e.maximumBodySize,isExpanded:e.isExpanded,title:e.title,containerApi:new Ce(this),accessor:this}),this.paneview.addPane(r,a,s),r.orientation=this.paneview.orientation,r}removePanel(e){const t=this.panels.findIndex(i=>i===e);this.paneview.removePane(t),this.doRemovePanel(e)}movePanel(e,t){this.paneview.moveView(e,t)}getPanel(e){return this.panels.find(t=>t.id===e)}layout(e,t){const[i,n]=this.paneview.orientation===y.HORIZONTAL?[e,t]:[t,e];this.paneview.layout(i,n)}toJSON(){const e=i=>i===Number.MAX_SAFE_INTEGER||i===Number.POSITIVE_INFINITY?void 0:i,t=i=>i<=0?void 0:i;return{views:this.paneview.getPanes().map((i,n)=>({size:this.paneview.getViewSize(n),data:i.toJSON(),minimumSize:t(i.minimumBodySize),maximumSize:e(i.maximumBodySize),headerSize:i.headerSize,expanded:i.isExpanded()})),size:this.paneview.size}}fromJSON(e){this.clear();const{views:t,size:i}=e,n=[],o=this.width,r=this.height;this.paneview=new pt(this.element,{orientation:y.VERTICAL,descriptor:{size:i,views:t.map(a=>{var s,d,l;const h=a.data,v=this.options.createComponent({id:h.id,name:h.component});let p;h.headerComponent&&this.options.createHeaderComponent&&(p=this.options.createHeaderComponent({id:h.id,name:h.headerComponent})),p||(p=new _t);const b=new Ct({id:h.id,component:h.component,headerComponent:h.headerComponent,header:p,body:v,orientation:y.VERTICAL,isExpanded:!!a.expanded,disableDnd:!!this.options.disableDnd,accessor:this,headerSize:(s=a.headerSize)!==null&&s!==void 0?s:xt,minimumBodySize:(d=a.minimumSize)!==null&&d!==void 0?d:yt,maximumBodySize:(l=a.maximumSize)!==null&&l!==void 0?l:Dt});return this.doAddPanel(b),n.push(()=>{var u;b.init({params:(u=h.params)!==null&&u!==void 0?u:{},minimumBodySize:a.minimumSize,maximumBodySize:a.maximumSize,title:h.title,isExpanded:!!a.expanded,containerApi:new Ce(this),accessor:this}),b.orientation=this.paneview.orientation}),setTimeout(()=>{this._onDidAddView.fire(b)},0),{size:a.size,view:b}})}}),this.layout(o,r),n.forEach(a=>a()),this._onDidLayoutfromJSON.fire()}clear(){for(const[e,t]of this._viewDisposables.entries())t.dispose();this._viewDisposables.clear(),this.paneview.dispose()}doAddPanel(e){const t=new z(e.onDidDrop(i=>{this._onDidDrop.fire(i)}),e.onUnhandledDragOverEvent(i=>{this._onUnhandledDragOverEvent.fire(i)}));this._viewDisposables.set(e.id,t)}doRemovePanel(e){const t=this._viewDisposables.get(e.id);t&&(t.dispose(),this._viewDisposables.delete(e.id))}dispose(){super.dispose();for(const[e,t]of this._viewDisposables.entries())t.dispose();this._viewDisposables.clear(),this.element.remove(),this.paneview.dispose()}},qn=class extends ot{get priority(){return this._priority}set orientation(e){this._orientation=e}get orientation(){return this._orientation}get minimumSize(){const e=typeof this._minimumSize=="function"?this._minimumSize():this._minimumSize;return e!==this._evaluatedMinimumSize&&(this._evaluatedMinimumSize=e,this.updateConstraints()),e}get maximumSize(){const e=typeof this._maximumSize=="function"?this._maximumSize():this._maximumSize;return e!==this._evaluatedMaximumSize&&(this._evaluatedMaximumSize=e,this.updateConstraints()),e}get snap(){return this._snap}constructor(e,t){super(e,t,new Xt(e,t)),this._evaluatedMinimumSize=0,this._evaluatedMaximumSize=Number.POSITIVE_INFINITY,this._minimumSize=0,this._maximumSize=Number.POSITIVE_INFINITY,this._snap=!1,this._onDidChange=new c,this.onDidChange=this._onDidChange.event,this.api.initialize(this),this.addDisposables(this._onDidChange,this.api.onWillVisibilityChange(i=>{const{isVisible:n}=i,{accessor:o}=this._params;o.setVisible(this,n)}),this.api.onActiveChange(()=>{const{accessor:i}=this._params;i.setActive(this)}),this.api.onDidConstraintsChangeInternal(i=>{(typeof i.minimumSize=="number"||typeof i.minimumSize=="function")&&(this._minimumSize=i.minimumSize),(typeof i.maximumSize=="number"||typeof i.maximumSize=="function")&&(this._maximumSize=i.maximumSize),this.updateConstraints()}),this.api.onDidSizeChange(i=>{this._onDidChange.fire({size:i.size})}))}setVisible(e){this.api._onDidVisibilityChange.fire({isVisible:e})}setActive(e){this.api._onDidActiveChange.fire({isActive:e})}layout(e,t){const[i,n]=this.orientation===y.HORIZONTAL?[e,t]:[t,e];super.layout(i,n)}init(e){super.init(e),this._priority=e.priority,e.minimumSize&&(this._minimumSize=e.minimumSize),e.maximumSize&&(this._maximumSize=e.maximumSize),e.snap&&(this._snap=e.snap)}toJSON(){const e=i=>i===Number.MAX_SAFE_INTEGER||i===Number.POSITIVE_INFINITY?void 0:i,t=i=>i<=0?void 0:i;return Object.assign(Object.assign({},super.toJSON()),{minimumSize:t(this.minimumSize),maximumSize:e(this.maximumSize)})}updateConstraints(){this.api._onDidConstraintsChange.fire({maximumSize:this._evaluatedMaximumSize,minimumSize:this._evaluatedMinimumSize})}};function Qn(e,t){return new Jn(e,t).api}function eo(e,t){return new $t(new Zn(e,t))}function to(e,t){return new jt(new Yn(e,t))}function io(e,t){return new Ce(new Kn(e,t))}var no=Tt(xi(),1);function oo(e,t){t===void 0&&(t={});var i=t.insertAt;if(!(!e||typeof document>"u")){var n=document.head||document.getElementsByTagName("head")[0],o=document.createElement("style");o.type="text/css",i==="top"&&n.firstChild?n.insertBefore(o,n.firstChild):n.appendChild(o),o.styleSheet?o.styleSheet.cssText=e:o.appendChild(document.createTextNode(e))}}oo(`.dv-scrollable {
  position: relative;
  overflow: hidden;
}
.dv-scrollable .dv-scrollbar {
  position: absolute;
  border-radius: 2px;
  background-color: transparent;
  /* GPU optimizations */
  will-change: background-color, transform;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  transition-property: background-color;
  transition-timing-function: ease-in-out;
  transition-duration: 1s;
  transition-delay: 0s;
}
.dv-scrollable .dv-scrollbar-horizontal {
  bottom: 0px;
  left: 0px;
  height: 4px;
}
.dv-scrollable .dv-scrollbar-vertical {
  right: 0px;
  top: 0px;
  width: 4px;
}
.dv-scrollable:hover .dv-scrollbar, .dv-scrollable.dv-scrollable-resizing .dv-scrollbar, .dv-scrollable.dv-scrollable-scrolling .dv-scrollbar {
  background-color: var(--dv-scrollbar-background-color, rgba(255, 255, 255, 0.25));
}
.dv-svg {
  display: inline-block;
  fill: currentcolor;
  line-height: 1;
  stroke: currentcolor;
  stroke-width: 0;
}
.dockview-theme-dark {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-group-view-background-color: #1e1e1e;
  --dv-tabs-and-actions-container-background-color: #252526;
  --dv-activegroup-visiblepanel-tab-background-color: #1e1e1e;
  --dv-activegroup-hiddenpanel-tab-background-color: #2d2d2d;
  --dv-inactivegroup-visiblepanel-tab-background-color: #1e1e1e;
  --dv-inactivegroup-hiddenpanel-tab-background-color: #2d2d2d;
  --dv-tab-divider-color: #1e1e1e;
  --dv-activegroup-visiblepanel-tab-color: white;
  --dv-activegroup-hiddenpanel-tab-color: #969696;
  --dv-inactivegroup-visiblepanel-tab-color: #8f8f8f;
  --dv-inactivegroup-hiddenpanel-tab-color: #626262;
  --dv-separator-border: rgb(68, 68, 68);
  --dv-paneview-header-border-color: rgba(204, 204, 204, 0.2);
}
.dockview-theme-dark .dv-drop-target-container .dv-drop-target-anchor.dv-drop-target-anchor-container-changed {
  opacity: 0;
  transition: none;
}

.dockview-theme-light {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-group-view-background-color: white;
  --dv-tabs-and-actions-container-background-color: #f3f3f3;
  --dv-activegroup-visiblepanel-tab-background-color: white;
  --dv-activegroup-hiddenpanel-tab-background-color: #ececec;
  --dv-inactivegroup-visiblepanel-tab-background-color: white;
  --dv-inactivegroup-hiddenpanel-tab-background-color: #ececec;
  --dv-tab-divider-color: white;
  --dv-activegroup-visiblepanel-tab-color: rgb(51, 51, 51);
  --dv-activegroup-hiddenpanel-tab-color: rgba(51, 51, 51, 0.7);
  --dv-inactivegroup-visiblepanel-tab-color: rgba(51, 51, 51, 0.7);
  --dv-inactivegroup-hiddenpanel-tab-color: rgba(51, 51, 51, 0.35);
  --dv-separator-border: rgba(128, 128, 128, 0.35);
  --dv-paneview-header-border-color: rgb(51, 51, 51);
  --dv-scrollbar-background-color: rgba(0, 0, 0, 0.25);
}
.dockview-theme-light .dv-drop-target-container .dv-drop-target-anchor.dv-drop-target-anchor-container-changed {
  opacity: 0;
  transition: none;
}

.dockview-theme-vs {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-group-view-background-color: #1e1e1e;
  --dv-tabs-and-actions-container-background-color: #252526;
  --dv-activegroup-visiblepanel-tab-background-color: #1e1e1e;
  --dv-activegroup-hiddenpanel-tab-background-color: #2d2d2d;
  --dv-inactivegroup-visiblepanel-tab-background-color: #1e1e1e;
  --dv-inactivegroup-hiddenpanel-tab-background-color: #2d2d2d;
  --dv-tab-divider-color: #1e1e1e;
  --dv-activegroup-visiblepanel-tab-color: white;
  --dv-activegroup-hiddenpanel-tab-color: #969696;
  --dv-inactivegroup-visiblepanel-tab-color: #8f8f8f;
  --dv-inactivegroup-hiddenpanel-tab-color: #626262;
  --dv-separator-border: rgb(68, 68, 68);
  --dv-paneview-header-border-color: rgba(204, 204, 204, 0.2);
  --dv-tabs-and-actions-container-background-color: #2d2d30;
  --dv-tabs-and-actions-container-height: 20px;
  --dv-tabs-and-actions-container-font-size: 11px;
  --dv-activegroup-visiblepanel-tab-background-color: #007acc;
  --dv-inactivegroup-visiblepanel-tab-background-color: #3f3f46;
  --dv-activegroup-visiblepanel-tab-color: white;
  --dv-activegroup-hiddenpanel-tab-color: white;
  --dv-inactivegroup-visiblepanel-tab-color: white;
  --dv-inactivegroup-hiddenpanel-tab-color: white;
}
.dockview-theme-vs .dv-drop-target-container .dv-drop-target-anchor.dv-drop-target-anchor-container-changed {
  opacity: 0;
  transition: none;
}
.dockview-theme-vs .dv-groupview.dv-active-group > .dv-tabs-and-actions-container {
  box-sizing: content-box;
  border-bottom: 2px solid var(--dv-activegroup-visiblepanel-tab-background-color);
}
.dockview-theme-vs .dv-groupview.dv-active-group > .dv-tabs-and-actions-container .dv-tab.dv-active-tab {
  border-top: 2px solid var(--dv-activegroup-visiblepanel-tab-background-color);
}
.dockview-theme-vs .dv-groupview.dv-active-group > .dv-tabs-and-actions-container .dv-tab.dv-inactive-tab {
  border-top: 2px solid var(--dv-activegroup-hiddenpanel-tab-background-color);
}
.dockview-theme-vs .dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container {
  box-sizing: content-box;
  border-bottom: 2px solid var(--dv-inactivegroup-visiblepanel-tab-background-color);
}
.dockview-theme-vs .dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container .dv-tab.dv-active-tab {
  border-top: 2px solid var(--dv-inactivegroup-visiblepanel-tab-background-color);
}
.dockview-theme-vs .dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container .dv-tab.dv-inactive-tab {
  border-top: 2px solid var(--dv-inactivegroup-hiddenpanel-tab-background-color);
}

.dockview-theme-abyss {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-color-abyss-dark: #000c18;
  --dv-color-abyss: #10192c;
  --dv-color-abyss-light: #1c1c2a;
  --dv-color-abyss-lighter: #2b2b4a;
  --dv-color-abyss-accent: rgb(91, 30, 207);
  --dv-color-abyss-primary-text: white;
  --dv-color-abyss-secondary-text: rgb(148, 151, 169);
  --dv-group-view-background-color: var(--dv-color-abyss-dark);
  --dv-tabs-and-actions-container-background-color: var(
      --dv-color-abyss-light
  );
  --dv-activegroup-visiblepanel-tab-background-color: var(
      --dv-color-abyss-dark
  );
  --dv-activegroup-hiddenpanel-tab-background-color: var(--dv-color-abyss);
  --dv-inactivegroup-visiblepanel-tab-background-color: var(
      --dv-color-abyss-dark
  );
  --dv-inactivegroup-hiddenpanel-tab-background-color: var(--dv-color-abyss);
  --dv-tab-divider-color: var(--dv-color-abyss-lighter);
  --dv-activegroup-visiblepanel-tab-color: white;
  --dv-activegroup-hiddenpanel-tab-color: rgba(255, 255, 255, 0.5);
  --dv-inactivegroup-visiblepanel-tab-color: rgba(255, 255, 255, 0.5);
  --dv-inactivegroup-hiddenpanel-tab-color: rgba(255, 255, 255, 0.25);
  --dv-separator-border: var(--dv-color-abyss-lighter);
  --dv-paneview-header-border-color: var(--dv-color-abyss-lighter);
  --dv-paneview-active-outline-color: #596f99;
}
.dockview-theme-abyss .dv-drop-target-container .dv-drop-target-anchor.dv-drop-target-anchor-container-changed {
  opacity: 0;
  transition: none;
}

.dockview-theme-dracula {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-group-view-background-color: #282a36;
  --dv-tabs-and-actions-container-background-color: #191a21;
  --dv-activegroup-visiblepanel-tab-background-color: #282a36;
  --dv-activegroup-hiddenpanel-tab-background-color: #21222c;
  --dv-inactivegroup-visiblepanel-tab-background-color: #282a36;
  --dv-inactivegroup-hiddenpanel-tab-background-color: #21222c;
  --dv-tab-divider-color: #191a21;
  --dv-activegroup-visiblepanel-tab-color: rgb(248, 248, 242);
  --dv-activegroup-hiddenpanel-tab-color: rgb(98, 114, 164);
  --dv-inactivegroup-visiblepanel-tab-color: rgba(248, 248, 242, 0.5);
  --dv-inactivegroup-hiddenpanel-tab-color: rgba(98, 114, 164, 0.5);
  --dv-separator-border: #bd93f9;
  --dv-paneview-header-border-color: #bd93f9;
  --dv-paneview-active-outline-color: #6272a4;
}
.dockview-theme-dracula .dv-drop-target-container .dv-drop-target-anchor.dv-drop-target-anchor-container-changed {
  opacity: 0;
  transition: none;
}
.dockview-theme-dracula .dv-groupview.dv-active-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-active-tab {
  position: relative;
}
.dockview-theme-dracula .dv-groupview.dv-active-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-active-tab::after {
  position: absolute;
  left: 0px;
  top: 0px;
  content: "";
  width: 100%;
  height: 1px;
  background-color: #94527e;
  z-index: 999;
}
.dockview-theme-dracula .dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-active-tab {
  position: relative;
}
.dockview-theme-dracula .dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-active-tab::after {
  position: absolute;
  left: 0px;
  bottom: 0px;
  content: "";
  width: 100%;
  height: 1px;
  background-color: #5e3d5a;
  z-index: 999;
}

.dockview-theme-replit {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  box-sizing: border-box;
  padding: 10px;
  background-color: #ebeced;
  --dv-group-view-background-color: #ebeced;
  --dv-tabs-and-actions-container-background-color: #fcfcfc;
  --dv-activegroup-visiblepanel-tab-background-color: #f0f1f2;
  --dv-activegroup-hiddenpanel-tab-background-color: #fcfcfc;
  --dv-inactivegroup-visiblepanel-tab-background-color: #f0f1f2;
  --dv-inactivegroup-hiddenpanel-tab-background-color: #fcfcfc;
  --dv-tab-divider-color: transparent;
  --dv-activegroup-visiblepanel-tab-color: rgb(51, 51, 51);
  --dv-activegroup-hiddenpanel-tab-color: rgb(51, 51, 51);
  --dv-inactivegroup-visiblepanel-tab-color: rgb(51, 51, 51);
  --dv-inactivegroup-hiddenpanel-tab-color: rgb(51, 51, 51);
  --dv-separator-border: transparent;
  --dv-paneview-header-border-color: rgb(51, 51, 51);
  --dv-sash-color: #cfd1d3;
  --dv-active-sash-color: #babbbb;
}
.dockview-theme-replit .dv-drop-target-container .dv-drop-target-anchor.dv-drop-target-anchor-container-changed {
  opacity: 0;
  transition: none;
}
.dockview-theme-replit .dv-resize-container:has(> .dv-groupview) {
  border-radius: 8px;
}
.dockview-theme-replit .dv-resize-container {
  border-radius: 10px !important;
  border: none;
}
.dockview-theme-replit .dv-groupview {
  overflow: hidden;
  border-radius: 10px;
}
.dockview-theme-replit .dv-groupview .dv-tabs-and-actions-container {
  border-bottom: 1px solid rgba(128, 128, 128, 0.35);
}
.dockview-theme-replit .dv-groupview .dv-tabs-and-actions-container .dv-tab {
  margin: 4px;
  border-radius: 8px;
}
.dockview-theme-replit .dv-groupview .dv-tabs-and-actions-container .dv-tab .dv-svg {
  height: 8px;
  width: 8px;
}
.dockview-theme-replit .dv-groupview .dv-tabs-and-actions-container .dv-tab:hover {
  background-color: #e4e5e6 !important;
}
.dockview-theme-replit .dv-groupview .dv-content-container {
  background-color: #fcfcfc;
}
.dockview-theme-replit .dv-groupview.dv-active-group {
  border: 1px solid rgba(128, 128, 128, 0.35);
}
.dockview-theme-replit .dv-groupview.dv-inactive-group {
  border: 1px solid transparent;
}
.dockview-theme-replit .dv-vertical > .dv-sash-container > .dv-sash {
  background-color: transparent;
}
.dockview-theme-replit .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled)::after {
  content: "";
  height: 4px;
  width: 40px;
  border-radius: 2px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: var(--dv-sash-color);
  position: absolute;
}
.dockview-theme-replit .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled):hover, .dockview-theme-replit .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled):active {
  background-color: transparent;
}
.dockview-theme-replit .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled):hover::after, .dockview-theme-replit .dv-vertical > .dv-sash-container > .dv-sash:not(.disabled):active::after {
  background-color: var(--dv-active-sash-color);
}
.dockview-theme-replit .dv-horizontal > .dv-sash-container > .dv-sash {
  background-color: transparent;
}
.dockview-theme-replit .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled)::after {
  content: "";
  height: 40px;
  width: 4px;
  border-radius: 2px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: var(--dv-sash-color);
  position: absolute;
}
.dockview-theme-replit .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled):hover, .dockview-theme-replit .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled):active {
  background-color: transparent;
}
.dockview-theme-replit .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled):hover::after, .dockview-theme-replit .dv-horizontal > .dv-sash-container > .dv-sash:not(.disabled):active::after {
  background-color: var(--dv-active-sash-color);
}

.dockview-theme-abyss-spaced {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-tab-font-size: 12px;
  --dv-border-radius: 20px;
  --dv-tab-margin: 0.5rem 0.25rem;
  --dv-tabs-and-actions-container-height: 44px;
  --dv-border-radius: 20px;
  box-sizing: border-box;
  --dv-color-abyss-dark: rgb(11, 6, 17);
  --dv-color-abyss: #16121f;
  --dv-color-abyss-light: #201d2b;
  --dv-color-abyss-lighter: #2a2837;
  --dv-color-abyss-accent: rgb(91, 30, 207);
  --dv-color-abyss-primary-text: white;
  --dv-color-abyss-secondary-text: rgb(148, 151, 169);
  --dv-drag-over-border: 2px solid var(--dv-color-abyss-accent);
  --dv-drag-over-background-color: "";
  --dv-group-view-background-color: var(--dv-color-abyss-dark);
  --dv-tabs-and-actions-container-background-color: var(--dv-color-abyss);
  --dv-activegroup-visiblepanel-tab-background-color: var(
      --dv-color-abyss-lighter
  );
  --dv-activegroup-hiddenpanel-tab-background-color: var(
      --dv-color-abyss-light
  );
  --dv-inactivegroup-visiblepanel-tab-background-color: var(
      --dv-color-abyss-lighter
  );
  --dv-inactivegroup-hiddenpanel-tab-background-color: var(
      --dv-color-abyss-light
  );
  --dv-tab-divider-color: transparent;
  --dv-activegroup-visiblepanel-tab-color: var(--dv-color-abyss-primary-text);
  --dv-activegroup-hiddenpanel-tab-color: var(
      --dv-color-abyss-secondary-text
  );
  --dv-inactivegroup-visiblepanel-tab-color: var(
      --dv-color-abyss-primary-text
  );
  --dv-inactivegroup-hiddenpanel-tab-color: var(
      --dv-color-abyss-secondary-text
  );
  --dv-separator-border: transparent;
  --dv-paneview-header-border-color: rgb(51, 51, 51);
  --dv-active-sash-color: var(--dv-color-abyss-accent);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(0, 0, 0, 0.5);
  padding: 10px;
  background-color: var(--dv-color-abyss-dark);
}
.dockview-theme-abyss-spaced .dv-resize-container:has(> .dv-groupview) {
  border-radius: 8px;
}
.dockview-theme-abyss-spaced .dv-sash {
  border-radius: 4px;
}
.dockview-theme-abyss-spaced .dv-drop-target-anchor {
  border-radius: calc(var(--dv-border-radius) / 4);
}
.dockview-theme-abyss-spaced .dv-drop-target-anchor.dv-drop-target-content {
  border-radius: var(--dv-border-radius);
}
.dockview-theme-abyss-spaced .dv-resize-container {
  border-radius: var(--dv-border-radius) !important;
  border: none;
}
.dockview-theme-abyss-spaced .dv-tabs-overflow-container,
.dockview-theme-abyss-spaced .dv-tabs-overflow-dropdown-default {
  border-radius: 8px;
  height: unset !important;
}
.dockview-theme-abyss-spaced .dv-tab {
  border-radius: 8px;
}
.dockview-theme-abyss-spaced .dv-tab .dv-svg {
  height: 8px;
  width: 8px;
}
.dockview-theme-abyss-spaced .dv-groupview {
  border-radius: var(--dv-border-radius);
}
.dockview-theme-abyss-spaced .dv-groupview .dv-tabs-and-actions-container {
  padding: 0px calc(var(--dv-border-radius) / 2);
}
.dockview-theme-abyss-spaced .dv-groupview .dv-content-container {
  background-color: var(--dv-tabs-and-actions-container-background-color);
}
.dockview-theme-abyss-spaced .dv-resize-container .dv-groupview {
  border: 2px solid var(--dv-color-abyss-dark);
}

.dockview-theme-light-spaced {
  --dv-paneview-active-outline-color: dodgerblue;
  --dv-tabs-and-actions-container-font-size: 13px;
  --dv-tabs-and-actions-container-height: 35px;
  --dv-drag-over-background-color: rgba(83, 89, 93, 0.5);
  --dv-drag-over-border-color: transparent;
  --dv-tabs-container-scrollbar-color: #888;
  --dv-icon-hover-background-color: rgba(90, 93, 94, 0.31);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(83, 89, 93, 0.5);
  --dv-overlay-z-index: 999;
  --dv-tab-font-size: inherit;
  --dv-border-radius: 0px;
  --dv-tab-margin: 0;
  --dv-sash-color: transparent;
  --dv-active-sash-color: transparent;
  --dv-active-sash-transition-duration: 0.1s;
  --dv-active-sash-transition-delay: 0.5s;
  --dv-tab-font-size: 12px;
  --dv-border-radius: 20px;
  --dv-tab-margin: 0.5rem 0.25rem;
  --dv-tabs-and-actions-container-height: 44px;
  --dv-border-radius: 20px;
  box-sizing: border-box;
  --dv-drag-over-border: 2px solid rgb(91, 30, 207);
  --dv-drag-over-background-color: "";
  --dv-group-view-background-color: #f6f5f9;
  --dv-tabs-and-actions-container-background-color: white;
  --dv-activegroup-visiblepanel-tab-background-color: #ededf0;
  --dv-activegroup-hiddenpanel-tab-background-color: #f9f9fa;
  --dv-inactivegroup-visiblepanel-tab-background-color: #ededf0;
  --dv-inactivegroup-hiddenpanel-tab-background-color: #f9f9fa;
  --dv-tab-divider-color: transparent;
  --dv-activegroup-visiblepanel-tab-color: rgb(104, 107, 130);
  --dv-activegroup-hiddenpanel-tab-color: rgb(148, 151, 169);
  --dv-inactivegroup-visiblepanel-tab-color: rgb(104, 107, 130);
  --dv-inactivegroup-hiddenpanel-tab-color: rgb(148, 151, 169);
  --dv-separator-border: transparent;
  --dv-paneview-header-border-color: rgb(51, 51, 51);
  --dv-active-sash-color: rgb(91, 30, 207);
  --dv-floating-box-shadow: 8px 8px 8px 0px rgba(0, 0, 0, 0.1);
  padding: 10px;
  background-color: #f6f5f9;
  --dv-scrollbar-background-color: rgba(0, 0, 0, 0.25);
}
.dockview-theme-light-spaced .dv-resize-container:has(> .dv-groupview) {
  border-radius: 8px;
}
.dockview-theme-light-spaced .dv-sash {
  border-radius: 4px;
}
.dockview-theme-light-spaced .dv-drop-target-anchor {
  border-radius: calc(var(--dv-border-radius) / 4);
}
.dockview-theme-light-spaced .dv-drop-target-anchor.dv-drop-target-content {
  border-radius: var(--dv-border-radius);
}
.dockview-theme-light-spaced .dv-resize-container {
  border-radius: var(--dv-border-radius) !important;
  border: none;
}
.dockview-theme-light-spaced .dv-tabs-overflow-container,
.dockview-theme-light-spaced .dv-tabs-overflow-dropdown-default {
  border-radius: 8px;
  height: unset !important;
}
.dockview-theme-light-spaced .dv-tab {
  border-radius: 8px;
}
.dockview-theme-light-spaced .dv-tab .dv-svg {
  height: 8px;
  width: 8px;
}
.dockview-theme-light-spaced .dv-groupview {
  border-radius: var(--dv-border-radius);
}
.dockview-theme-light-spaced .dv-groupview .dv-tabs-and-actions-container {
  padding: 0px calc(var(--dv-border-radius) / 2);
}
.dockview-theme-light-spaced .dv-groupview .dv-content-container {
  background-color: var(--dv-tabs-and-actions-container-background-color);
}
.dockview-theme-light-spaced .dv-resize-container .dv-groupview {
  border: 2px solid rgba(255, 255, 255, 0.1);
}
.dv-drop-target-container {
  position: absolute;
  z-index: 9999;
  top: 0px;
  left: 0px;
  height: 100%;
  width: 100%;
  pointer-events: none;
  overflow: hidden;
  --dv-transition-duration: 300ms;
}
.dv-drop-target-container .dv-drop-target-anchor {
  position: relative;
  border: var(--dv-drag-over-border);
  background-color: var(--dv-drag-over-background-color);
  opacity: 1;
  /* GPU optimizations */
  will-change: transform, opacity;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  contain: layout paint;
  transition: opacity var(--dv-transition-duration) ease-in, top var(--dv-transition-duration) ease-out, left var(--dv-transition-duration) ease-out, width var(--dv-transition-duration) ease-out, height var(--dv-transition-duration) ease-out;
}
.dv-drop-target {
  position: relative;
  --dv-transition-duration: 70ms;
}
.dv-drop-target > .dv-drop-target-dropzone {
  position: absolute;
  left: 0px;
  top: 0px;
  height: 100%;
  width: 100%;
  z-index: 1000;
  pointer-events: none;
}
.dv-drop-target > .dv-drop-target-dropzone > .dv-drop-target-selection {
  position: relative;
  box-sizing: border-box;
  height: 100%;
  width: 100%;
  border: var(--dv-drag-over-border);
  background-color: var(--dv-drag-over-background-color);
  transition: top var(--dv-transition-duration) ease-out, left var(--dv-transition-duration) ease-out, width var(--dv-transition-duration) ease-out, height var(--dv-transition-duration) ease-out, opacity var(--dv-transition-duration) ease-out;
  will-change: transform;
  pointer-events: none;
}
.dv-drop-target > .dv-drop-target-dropzone > .dv-drop-target-selection.dv-drop-target-top.dv-drop-target-small-vertical {
  border-top: 1px solid var(--dv-drag-over-border-color);
}
.dv-drop-target > .dv-drop-target-dropzone > .dv-drop-target-selection.dv-drop-target-bottom.dv-drop-target-small-vertical {
  border-bottom: 1px solid var(--dv-drag-over-border-color);
}
.dv-drop-target > .dv-drop-target-dropzone > .dv-drop-target-selection.dv-drop-target-left.dv-drop-target-small-horizontal {
  border-left: 1px solid var(--dv-drag-over-border-color);
}
.dv-drop-target > .dv-drop-target-dropzone > .dv-drop-target-selection.dv-drop-target-right.dv-drop-target-small-horizontal {
  border-right: 1px solid var(--dv-drag-over-border-color);
}
.dv-dockview {
  position: relative;
  background-color: var(--dv-group-view-background-color);
  contain: layout;
}
.dv-dockview .dv-watermark-container {
  position: absolute;
  top: 0px;
  left: 0px;
  height: 100%;
  width: 100%;
  z-index: 1;
}
.dv-dockview .dv-overlay-render-container {
  position: relative;
}

.dv-groupview.dv-active-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-active-tab {
  background-color: var(--dv-activegroup-visiblepanel-tab-background-color);
  color: var(--dv-activegroup-visiblepanel-tab-color);
}
.dv-groupview.dv-active-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-inactive-tab {
  background-color: var(--dv-activegroup-hiddenpanel-tab-background-color);
  color: var(--dv-activegroup-hiddenpanel-tab-color);
}
.dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-active-tab {
  background-color: var(--dv-inactivegroup-visiblepanel-tab-background-color);
  color: var(--dv-inactivegroup-visiblepanel-tab-color);
}
.dv-groupview.dv-inactive-group > .dv-tabs-and-actions-container .dv-tabs-container > .dv-tab.dv-inactive-tab {
  background-color: var(--dv-inactivegroup-hiddenpanel-tab-background-color);
  color: var(--dv-inactivegroup-hiddenpanel-tab-color);
}

/**
 * when a tab is dragged we lose the above stylings because they are conditional on parent elements
 * therefore we also set some stylings for the dragging event
 **/
.dv-tab.dv-tab-dragging {
  background-color: var(--dv-activegroup-visiblepanel-tab-background-color);
  color: var(--dv-activegroup-visiblepanel-tab-color);
}
.dv-groupview {
  display: flex;
  height: 100%;
  background-color: var(--dv-group-view-background-color);
  overflow: hidden;
  flex-direction: column;
}
.dv-groupview:focus {
  outline: none;
}
.dv-groupview > .dv-content-container {
  flex-grow: 1;
  min-height: 0;
  outline: none;
}
.dv-groupview.dv-groupview-header-bottom {
  flex-direction: column-reverse;
}
.dv-groupview.dv-groupview-header-left {
  flex-direction: row;
}
.dv-groupview.dv-groupview-header-right {
  flex-direction: row-reverse;
}
.dv-root-wrapper {
  height: 100%;
  width: 100%;
}
.dv-grid-view,
.dv-branch-node {
  height: 100%;
  width: 100%;
}
.dv-debug .dv-resize-container .dv-resize-handle-top {
  background-color: red;
}
.dv-debug .dv-resize-container .dv-resize-handle-bottom {
  background-color: green;
}
.dv-debug .dv-resize-container .dv-resize-handle-left {
  background-color: yellow;
}
.dv-debug .dv-resize-container .dv-resize-handle-right {
  background-color: blue;
}
.dv-debug .dv-resize-container .dv-resize-handle-topleft,
.dv-debug .dv-resize-container .dv-resize-handle-topright,
.dv-debug .dv-resize-container .dv-resize-handle-bottomleft,
.dv-debug .dv-resize-container .dv-resize-handle-bottomright {
  background-color: cyan;
}

.dv-resize-container {
  --dv-overlay-z-index: var(--dv-overlay-z-index, 999);
  position: absolute;
  z-index: calc(var(--dv-overlay-z-index) - 2);
  border: 1px solid var(--dv-tab-divider-color);
  box-shadow: var(--dv-floating-box-shadow);
  /* GPU optimizations for floating group movement */
  will-change: transform, opacity;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
}
.dv-resize-container.dv-hidden {
  display: none;
}
.dv-resize-container.dv-resize-container-dragging {
  opacity: 0.5;
  /* Enhanced GPU acceleration during drag */
  will-change: transform, opacity;
}
.dv-resize-container .dv-resize-handle-top {
  height: 4px;
  width: calc(100% - 8px);
  left: 4px;
  top: -2px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: ns-resize;
}
.dv-resize-container .dv-resize-handle-bottom {
  height: 4px;
  width: calc(100% - 8px);
  left: 4px;
  bottom: -2px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: ns-resize;
}
.dv-resize-container .dv-resize-handle-left {
  height: calc(100% - 8px);
  width: 4px;
  left: -2px;
  top: 4px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: ew-resize;
}
.dv-resize-container .dv-resize-handle-right {
  height: calc(100% - 8px);
  width: 4px;
  right: -2px;
  top: 4px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: ew-resize;
}
.dv-resize-container .dv-resize-handle-topleft {
  height: 4px;
  width: 4px;
  top: -2px;
  left: -2px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: nw-resize;
}
.dv-resize-container .dv-resize-handle-topright {
  height: 4px;
  width: 4px;
  right: -2px;
  top: -2px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: ne-resize;
}
.dv-resize-container .dv-resize-handle-bottomleft {
  height: 4px;
  width: 4px;
  left: -2px;
  bottom: -2px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: sw-resize;
}
.dv-resize-container .dv-resize-handle-bottomright {
  height: 4px;
  width: 4px;
  right: -2px;
  bottom: -2px;
  z-index: var(--dv-overlay-z-index);
  position: absolute;
  cursor: se-resize;
}
.dv-render-overlay {
  --dv-overlay-z-index: var(--dv-overlay-z-index, 999);
  position: absolute;
  z-index: 1;
  width: 100%;
  height: 100%;
  contain: layout paint;
  isolation: isolate;
  /* GPU optimizations */
  will-change: transform;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
}
.dv-render-overlay.dv-render-overlay-float {
  z-index: calc(var(--dv-overlay-z-index) - 1);
}

.dv-debug .dv-render-overlay {
  outline: 1px solid red;
  outline-offset: -1;
}
.dv-pane-container {
  height: 100%;
  width: 100%;
}
.dv-pane-container.dv-animated .dv-view {
  /* GPU optimizations for smooth pane animations */
  will-change: transform;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  transition: transform 0.15s ease-out;
}
.dv-pane-container .dv-view {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 0px !important;
}
.dv-pane-container .dv-view:not(:first-child)::before {
  background-color: transparent !important;
}
.dv-pane-container .dv-view:not(:first-child) .dv-pane > .dv-pane-header {
  border-top: 1px solid var(--dv-paneview-header-border-color);
}
.dv-pane-container .dv-view .dv-default-header {
  background-color: var(--dv-group-view-background-color);
  color: var(--dv-activegroup-visiblepanel-tab-color);
  display: flex;
  padding: 0px 8px;
  cursor: pointer;
}
.dv-pane-container .dv-view .dv-default-header .dv-pane-header-icon {
  display: flex;
  justify-content: center;
  align-items: center;
}
.dv-pane-container .dv-view .dv-default-header > span {
  padding-left: 8px;
  flex-grow: 1;
}
.dv-pane-container:first-of-type > .dv-pane > .dv-pane-header {
  border-top: none !important;
}
.dv-pane-container .dv-pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}
.dv-pane-container .dv-pane .dv-pane-header {
  box-sizing: border-box;
  user-select: none;
  position: relative;
  outline: none;
}
.dv-pane-container .dv-pane .dv-pane-header.dv-pane-draggable {
  cursor: pointer;
}
.dv-pane-container .dv-pane .dv-pane-header:focus:before, .dv-pane-container .dv-pane .dv-pane-header:focus-within:before {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 5;
  content: "";
  pointer-events: none;
  outline: 1px solid;
  outline-width: -1px;
  outline-style: solid;
  outline-offset: -1px;
  outline-color: var(--dv-paneview-active-outline-color);
}
.dv-pane-container .dv-pane .dv-pane-body {
  overflow-y: auto;
  overflow-x: hidden;
  flex-grow: 1;
  position: relative;
  outline: none;
}
.dv-pane-container .dv-pane .dv-pane-body:focus:before, .dv-pane-container .dv-pane .dv-pane-body:focus-within:before {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 5;
  content: "";
  pointer-events: none;
  outline: 1px solid;
  outline-width: -1px;
  outline-style: solid;
  outline-offset: -1px;
  outline-color: var(--dv-paneview-active-outline-color);
}
.dv-debug .dv-split-view-container .dv-sash-container .dv-sash.dv-enabled {
  background-color: black;
}
.dv-debug .dv-split-view-container .dv-sash-container .dv-sash.dv-disabled {
  background-color: orange;
}
.dv-debug .dv-split-view-container .dv-sash-container .dv-sash.dv-maximum {
  background-color: green;
}
.dv-debug .dv-split-view-container .dv-sash-container .dv-sash.dv-minimum {
  background-color: red;
}

.dv-split-view-container {
  position: relative;
  overflow: hidden;
  height: 100%;
  width: 100%;
}
.dv-split-view-container.dv-splitview-disabled > .dv-sash-container > .dv-sash {
  pointer-events: none;
}
.dv-split-view-container.dv-animation .dv-view,
.dv-split-view-container.dv-animation .dv-sash {
  /* GPU optimizations for smooth animations */
  will-change: transform;
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  transition: transform 0.15s ease-out;
}
.dv-split-view-container.dv-horizontal {
  height: 100%;
}
.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash {
  height: 100%;
  width: 4px;
}
.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash.dv-enabled {
  cursor: ew-resize;
}
.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash.dv-disabled {
  cursor: default;
}
.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash.dv-maximum {
  cursor: w-resize;
}
.dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash.dv-minimum {
  cursor: e-resize;
}
.dv-split-view-container.dv-horizontal > .dv-view-container > .dv-view:not(:first-child)::before {
  height: 100%;
  width: 1px;
}
.dv-split-view-container.dv-vertical {
  width: 100%;
}
.dv-split-view-container.dv-vertical > .dv-sash-container > .dv-sash {
  width: 100%;
  height: 4px;
}
.dv-split-view-container.dv-vertical > .dv-sash-container > .dv-sash.dv-enabled {
  cursor: ns-resize;
}
.dv-split-view-container.dv-vertical > .dv-sash-container > .dv-sash.dv-disabled {
  cursor: default;
}
.dv-split-view-container.dv-vertical > .dv-sash-container > .dv-sash.dv-maximum {
  cursor: n-resize;
}
.dv-split-view-container.dv-vertical > .dv-sash-container > .dv-sash.dv-minimum {
  cursor: s-resize;
}
.dv-split-view-container.dv-vertical > .dv-view-container > .dv-view {
  width: 100%;
}
.dv-split-view-container.dv-vertical > .dv-view-container > .dv-view:not(:first-child)::before {
  height: 1px;
  width: 100%;
}
.dv-split-view-container .dv-sash-container {
  height: 100%;
  width: 100%;
  position: absolute;
}
.dv-split-view-container .dv-sash-container .dv-sash {
  position: absolute;
  z-index: 99;
  outline: none;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  touch-action: none;
  background-color: var(--dv-sash-color, transparent);
}
.dv-split-view-container .dv-sash-container .dv-sash:not(.disabled):active, .dv-split-view-container .dv-sash-container .dv-sash:not(.disabled):hover {
  background-color: var(--dv-active-sash-color, transparent);
  transition-property: background-color;
  transition-timing-function: ease-in-out;
  transition-duration: var(--dv-active-sash-transition-duration, 0.1s);
  transition-delay: var(--dv-active-sash-transition-delay, 0.5s);
}
.dv-split-view-container .dv-view-container {
  position: relative;
  height: 100%;
  width: 100%;
}
.dv-split-view-container .dv-view-container .dv-view {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  position: absolute;
}
.dv-split-view-container.dv-separator-border .dv-view:not(:first-child)::before {
  content: " ";
  position: absolute;
  top: 0;
  left: 0;
  z-index: 5;
  pointer-events: none;
  background-color: var(--dv-separator-border);
}
.dv-dragged {
  transform: translate3d(0px, 0px, 0px); /* forces tab to be drawn on a separate layer (see https://github.com/microsoft/vscode/issues/18733) */
}

.dv-tab {
  flex-shrink: 0;
}
.dv-tab:focus-within, .dv-tab:focus {
  position: relative;
}
.dv-tab:focus-within::after, .dv-tab:focus::after {
  position: absolute;
  content: "";
  height: 100%;
  width: 100%;
  top: 0px;
  left: 0px;
  pointer-events: none;
  outline: 1px solid var(--dv-tab-divider-color) !important;
  outline-offset: -1px;
  z-index: 5;
}
.dv-tab.dv-tab-dragging .dv-default-tab-action {
  background-color: var(--dv-activegroup-visiblepanel-tab-color);
}
.dv-tab.dv-active-tab .dv-default-tab .dv-default-tab-action {
  visibility: visible;
}
.dv-tab.dv-inactive-tab .dv-default-tab .dv-default-tab-action {
  visibility: hidden;
}
.dv-tab.dv-inactive-tab .dv-default-tab:hover .dv-default-tab-action {
  visibility: visible;
}
.dv-tab .dv-default-tab {
  position: relative;
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dv-tab .dv-default-tab .dv-default-tab-content {
  flex-grow: 1;
  margin-right: 4px;
}
.dv-tab .dv-default-tab .dv-default-tab-action {
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
.dv-tab .dv-default-tab .dv-default-tab-action:hover {
  border-radius: 2px;
  background-color: var(--dv-icon-hover-background-color);
}
.dv-tabs-overflow-dropdown-default {
  height: 100%;
  color: var(--dv-activegroup-hiddenpanel-tab-color);
  margin: var(--dv-tab-margin);
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
}
.dv-tabs-overflow-dropdown-default > span {
  padding-left: 0.25rem;
}
.dv-tabs-overflow-dropdown-default > svg {
  transform: rotate(90deg);
}
.dv-tabs-overflow-dropdown-default:hover {
  border-radius: 2px;
  background-color: var(--dv-icon-hover-background-color);
}
.dv-tabs-container {
  display: flex;
  height: 100%;
  overflow: auto;
  scrollbar-width: thin;
  /* GPU optimizations for smooth scrolling */
  will-change: scroll-position;
  transform: translate3d(0, 0, 0);
  /* Track */
  /* Handle */
}
.dv-tabs-container.dv-tabs-container-vertical {
  width: 100%;
  height: fit-content;
  max-height: 100%;
  writing-mode: vertical-rl;
}
.dv-tabs-container.dv-horizontal .dv-tab:not(:first-child)::before, .dv-tabs-container.dv-vertical .dv-tab:not(:first-child)::before {
  content: " ";
  position: absolute;
  top: 0;
  left: 0;
  z-index: 5;
  pointer-events: none;
  background-color: var(--dv-tab-divider-color);
}
.dv-tabs-container.dv-horizontal .dv-tab:not(:first-child)::before {
  width: 1px;
  height: 100%;
}
.dv-tabs-container.dv-vertical .dv-tab:not(:first-child)::before {
  width: 100%;
  height: 1px;
}
.dv-tabs-container::-webkit-scrollbar {
  height: 3px;
}
.dv-tabs-container::-webkit-scrollbar-track {
  background: transparent;
}
.dv-tabs-container::-webkit-scrollbar-thumb {
  background: var(--dv-tabs-container-scrollbar-color);
}

.dv-scrollable > .dv-tabs-container {
  overflow: hidden;
}

.dv-tab {
  -webkit-user-drag: element;
  outline: none;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  position: relative;
  box-sizing: border-box;
  font-size: var(--dv-tab-font-size);
  margin: var(--dv-tab-margin);
}
.dv-tab.dv-tab--shifting {
  will-change: margin-left;
  transition: transform var(--dv-transition-duration, 200ms) ease-out, margin-left var(--dv-transition-duration, 200ms) ease-out;
}
.dv-tab.dv-tab--dragging {
  width: 0 !important;
  min-width: 0 !important;
  padding: 0 !important;
  margin: 0 !important;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transition: width var(--dv-transition-duration, 200ms) ease-out, padding var(--dv-transition-duration, 200ms) ease-out, margin var(--dv-transition-duration, 200ms) ease-out, opacity var(--dv-transition-duration, 200ms) ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .dv-tab {
    transition: none !important;
  }
}
.dv-tabs-container-vertical .dv-tab {
  padding: 0.5rem 0.25rem;
}

.dv-tabs-overflow-container {
  flex-direction: column;
  height: unset;
  font-size: var(--dv-tabs-and-actions-container-font-size);
  max-height: min(50vh, 400px);
  overflow-y: auto;
  border: 1px solid var(--dv-tab-divider-color);
  background-color: var(--dv-group-view-background-color);
  /* Scrollbar styling for webkit browsers */
  /* Firefox scrollbar */
  scrollbar-width: thin;
}
.dv-tabs-overflow-container::-webkit-scrollbar {
  width: 6px;
}
.dv-tabs-overflow-container::-webkit-scrollbar-track {
  background: transparent;
}
.dv-tabs-overflow-container::-webkit-scrollbar-thumb {
  background: var(--dv-tabs-container-scrollbar-color);
  border-radius: 3px;
}
.dv-tabs-overflow-container .dv-tab:not(:last-child) {
  border-bottom: 1px solid var(--dv-tab-divider-color);
}
.dv-tabs-overflow-container .dv-active-tab {
  background-color: var(--dv-activegroup-visiblepanel-tab-background-color);
  color: var(--dv-activegroup-visiblepanel-tab-color);
}
.dv-tabs-overflow-container .dv-inactive-tab {
  background-color: var(--dv-activegroup-hiddenpanel-tab-background-color);
  color: var(--dv-activegroup-hiddenpanel-tab-color);
}
.dv-tabs-and-actions-container {
  display: flex;
  background-color: var(--dv-tabs-and-actions-container-background-color);
  flex-shrink: 0;
  box-sizing: border-box;
  height: var(--dv-tabs-and-actions-container-height);
  font-size: var(--dv-tabs-and-actions-container-font-size);
}
.dv-tabs-and-actions-container.dv-single-tab.dv-full-width-single-tab .dv-scrollable {
  flex-grow: 1;
}
.dv-tabs-and-actions-container.dv-single-tab.dv-full-width-single-tab .dv-tabs-container {
  flex-grow: 1;
}
.dv-tabs-and-actions-container.dv-single-tab.dv-full-width-single-tab .dv-tabs-container .dv-tab {
  flex-grow: 1;
  padding: 0px;
}
.dv-tabs-and-actions-container.dv-single-tab.dv-full-width-single-tab .dv-void-container {
  flex-grow: 0;
}
.dv-tabs-and-actions-container .dv-void-container {
  display: flex;
  flex-grow: 1;
}
.dv-tabs-and-actions-container .dv-void-container.dv-draggable {
  cursor: grab;
}
.dv-tabs-and-actions-container .dv-right-actions-container {
  display: flex;
}
.dv-tabs-and-actions-container .dv-right-actions-container.dv-right-actions-container-vertical {
  flex-direction: column;
}
.dv-tabs-and-actions-container.dv-groupview-header-vertical {
  flex-direction: column;
  height: auto;
  width: var(--dv-tabs-and-actions-container-height);
}
.dv-watermark {
  display: flex;
  height: 100%;
}`);var ri=(e,t)=>{const[i,n]=m.useState(),o=m.useRef(e.componentProps);return m.useImperativeHandle(t,()=>({update:r=>{o.current=Object.assign(Object.assign({},o.current),r),n(Date.now())}}),[]),m.createElement(e.component,o.current)};ri.displayName="DockviewReactJsBridge";var ro=(()=>{let e=1;return{next:()=>`dockview_react_portal_key_${(e++).toString()}`}})(),so=m.createContext({}),ue=class{constructor(e,t,i,n,o){this.parent=e,this.portalStore=t,this.component=i,this.parameters=n,this.context=o,this._initialProps={},this.disposed=!1,this.createPortal()}update(e){if(this.disposed)throw new Error("invalid operation: resource is already disposed");this.componentInstance?this.componentInstance.update(e):this._initialProps=Object.assign(Object.assign({},this._initialProps),e)}createPortal(){if(this.disposed)throw new Error("invalid operation: resource is already disposed");if(!ao(this.component))throw new Error("Dockview: Only React.memo(...), React.ForwardRef(...) and functional components are accepted as components");const e=m.createElement(m.forwardRef(ri),{component:this.component,componentProps:this.parameters,ref:n=>{this.componentInstance=n,Object.keys(this._initialProps).length>0&&(this.componentInstance.update(this._initialProps),this._initialProps={})}}),t=this.context?m.createElement(so.Provider,{value:this.context},e):e,i=no.createPortal(t,this.parent,ro.next());this.ref={portal:i,disposable:this.portalStore.addPortal(i)}}dispose(){var e;(e=this.ref)===null||e===void 0||e.disposable.dispose(),this.disposed=!0}},Ne=()=>{const[e,t]=m.useState([]);return m.useDebugValue(`Portal count: ${e.length}`),[e,m.useCallback(i=>{t(o=>[...o,i]);let n=!1;return W.from(()=>{if(n)throw new Error("invalid operation: resource already disposed");n=!0,t(o=>o.filter(r=>r!==i))})},[])]};function ao(e){return typeof e=="function"||!!e?.$$typeof}var zt=class{get element(){return this._element}constructor(e,t,i){this.id=e,this.component=t,this.reactPortalStore=i,this._onDidFocus=new c,this.onDidFocus=this._onDidFocus.event,this._onDidBlur=new c,this.onDidBlur=this._onDidBlur.event,this._element=document.createElement("div"),this._element.className="dv-react-part",this._element.style.height="100%",this._element.style.width="100%"}focus(){}init(e){this.part=new ue(this.element,this.reactPortalStore,this.component,{params:e.params,api:e.api,containerApi:e.containerApi})}update(e){var t;(t=this.part)===null||t===void 0||t.update({params:e.params})}layout(e,t){}dispose(){var e;this._onDidFocus.dispose(),this._onDidBlur.dispose(),(e=this.part)===null||e===void 0||e.dispose()}},kt=class{get element(){return this._element}constructor(e,t,i){this.id=e,this.component=t,this.reactPortalStore=i,this._element=document.createElement("div"),this._element.className="dv-react-part",this._element.style.height="100%",this._element.style.width="100%"}focus(){}init(e){this.part=new ue(this.element,this.reactPortalStore,this.component,{params:e.params,api:e.api,containerApi:e.containerApi,tabLocation:e.tabLocation})}update(e){var t;(t=this.part)===null||t===void 0||t.update({params:e.params})}layout(e,t){}dispose(){var e;(e=this.part)===null||e===void 0||e.dispose()}},St=class{get element(){return this._element}constructor(e,t,i){this.id=e,this.component=t,this.reactPortalStore=i,this._element=document.createElement("div"),this._element.className="dv-react-part",this._element.style.height="100%",this._element.style.width="100%"}init(e){this.part=new ue(this.element,this.reactPortalStore,this.component,{group:e.group,containerApi:e.containerApi})}focus(){}update(e){var t,i,n;this.parameters&&(this.parameters.params=e.params),(t=this.part)===null||t===void 0||t.update({params:(n=(i=this.parameters)===null||i===void 0?void 0:i.params)!==null&&n!==void 0?n:{}})}layout(e,t){}dispose(){var e;(e=this.part)===null||e===void 0||e.dispose()}},lo=class{get element(){return this._element}get part(){return this._part}constructor(e,t,i){this.component=e,this.reactPortalStore=t,this._group=i,this.mutableDisposable=new B,this._element=document.createElement("div"),this._element.className="dv-react-part",this._element.style.height="100%",this._element.style.width="100%"}init(e){this.mutableDisposable.value=new z(this._group.model.onDidAddPanel(()=>{this.updatePanels()}),this._group.model.onDidRemovePanel(()=>{this.updatePanels()}),this._group.model.onDidActivePanelChange(()=>{this.updateActivePanel()}),e.api.onDidActiveChange(()=>{this.updateGroupActive()})),this._part=new ue(this.element,this.reactPortalStore,this.component,{api:e.api,containerApi:e.containerApi,panels:this._group.model.panels,activePanel:this._group.model.activePanel,isGroupActive:this._group.api.isActive,group:this._group,headerPosition:this._group.model.headerPosition})}dispose(){var e;this.mutableDisposable.dispose(),(e=this._part)===null||e===void 0||e.dispose()}update(e){var t;(t=this._part)===null||t===void 0||t.update(e.params)}updatePanels(){this.update({params:{panels:this._group.model.panels}})}updateActivePanel(){this.update({params:{activePanel:this._group.model.activePanel}})}updateGroupActive(){this.update({params:{isGroupActive:this._group.api.isActive}})}};function me(e,t){return e?i=>new lo(e,t,i):void 0}var Ee="props.defaultTabComponent";function ho(e){return Ke.reduce((t,i)=>(i in e&&(t[i]=e[i]),t),{})}var si=m.forwardRef((e,t)=>{const i=m.useRef(null),n=m.useRef(),[o,r]=Ne();m.useImperativeHandle(t,()=>i.current,[]);const a=m.useRef({});return m.useEffect(()=>{const s={};Ke.forEach(d=>{const l=d,h=e[l];l in e&&h!==a.current[l]&&(s[l]=h)}),n.current&&n.current.updateOptions(s),a.current=e},Ke.map(s=>e[s])),m.useEffect(()=>{var s;if(!i.current)return;const d=(s=e.tabComponents)!==null&&s!==void 0?s:{};e.defaultTabComponent&&(d[Ee]=e.defaultTabComponent);const l={createLeftHeaderActionComponent:me(e.leftHeaderActionsComponent,{addPortal:r}),createRightHeaderActionComponent:me(e.rightHeaderActionsComponent,{addPortal:r}),createPrefixHeaderActionComponent:me(e.prefixHeaderActionsComponent,{addPortal:r}),createComponent:b=>new zt(b.id,e.components[b.name],{addPortal:r}),createTabComponent(b){return new kt(b.id,d[b.name],{addPortal:r})},createWatermarkComponent:e.watermarkComponent?()=>new St("watermark",e.watermarkComponent,{addPortal:r}):void 0,defaultTabComponent:e.defaultTabComponent?Ee:void 0},h=Qn(i.current,Object.assign(Object.assign({},ho(e)),l)),{clientWidth:v,clientHeight:p}=i.current;return h.layout(v,p),e.onReady&&e.onReady({api:h}),n.current=h,()=>{n.current=void 0,h.dispose()}},[]),m.useEffect(()=>{if(!n.current)return()=>{};const s=n.current.onDidDrop(d=>{e.onDidDrop&&e.onDidDrop(d)});return()=>{s.dispose()}},[e.onDidDrop]),m.useEffect(()=>{if(!n.current)return()=>{};const s=n.current.onWillDrop(d=>{e.onWillDrop&&e.onWillDrop(d)});return()=>{s.dispose()}},[e.onWillDrop]),m.useEffect(()=>{n.current&&n.current.updateOptions({createComponent:s=>new zt(s.id,e.components[s.name],{addPortal:r})})},[e.components]),m.useEffect(()=>{var s;if(!n.current)return;const d=(s=e.tabComponents)!==null&&s!==void 0?s:{};e.defaultTabComponent&&(d[Ee]=e.defaultTabComponent),n.current.updateOptions({defaultTabComponent:e.defaultTabComponent?Ee:void 0,createTabComponent(l){return new kt(l.id,d[l.name],{addPortal:r})}})},[e.tabComponents,e.defaultTabComponent]),m.useEffect(()=>{n.current&&n.current.updateOptions({createWatermarkComponent:e.watermarkComponent?()=>new St("watermark",e.watermarkComponent,{addPortal:r}):void 0})},[e.watermarkComponent]),m.useEffect(()=>{n.current&&n.current.updateOptions({createRightHeaderActionComponent:me(e.rightHeaderActionsComponent,{addPortal:r})})},[e.rightHeaderActionsComponent]),m.useEffect(()=>{n.current&&n.current.updateOptions({createLeftHeaderActionComponent:me(e.leftHeaderActionsComponent,{addPortal:r})})},[e.leftHeaderActionsComponent]),m.useEffect(()=>{n.current&&n.current.updateOptions({createPrefixHeaderActionComponent:me(e.prefixHeaderActionsComponent,{addPortal:r})})},[e.prefixHeaderActionsComponent]),m.createElement("div",{style:{height:"100%",width:"100%"},ref:i},o)});si.displayName="DockviewComponent";var At=class extends qn{constructor(e,t,i,n){super(e,t),this.reactComponent=i,this.reactPortalStore=n}getComponent(){var e,t;return new ue(this.element,this.reactPortalStore,this.reactComponent,{params:(t=(e=this._params)===null||e===void 0?void 0:e.params)!==null&&t!==void 0?t:{},api:this.api,containerApi:new $t(this._params.accessor)})}};function co(e){return Ue.reduce((t,i)=>(i in e&&(t[i]=e[i]),t),{})}var vo=m.forwardRef((e,t)=>{const i=m.useRef(null),n=m.useRef(),[o,r]=Ne();m.useImperativeHandle(t,()=>i.current,[]);const a=m.useRef({});return m.useEffect(()=>{const s={};Ue.forEach(d=>{const l=d,h=e[l];l in e&&h!==a.current[l]&&(s[l]=h)}),n.current&&n.current.updateOptions(s),a.current=e},Ue.map(s=>e[s])),m.useEffect(()=>{if(!i.current)return()=>{};const s=eo(i.current,Object.assign(Object.assign({},co(e)),{createComponent:h=>new At(h.id,h.name,e.components[h.name],{addPortal:r})})),{clientWidth:d,clientHeight:l}=i.current;return s.layout(d,l),e.onReady&&e.onReady({api:s}),n.current=s,()=>{n.current=void 0,s.dispose()}},[]),m.useEffect(()=>{n.current&&n.current.updateOptions({createComponent:s=>new At(s.id,s.name,e.components[s.name],{addPortal:r})})},[e.components]),m.createElement("div",{style:{height:"100%",width:"100%"},ref:i},o)});vo.displayName="SplitviewComponent";var Pt=class extends ni{constructor(e,t,i,n){super(e,t),this.reactComponent=i,this.reactPortalStore=n}getComponent(){var e,t;return new ue(this.element,this.reactPortalStore,this.reactComponent,{params:(t=(e=this._params)===null||e===void 0?void 0:e.params)!==null&&t!==void 0?t:{},api:this.api,containerApi:new jt(this._params.accessor)})}};function po(e){return Ze.reduce((t,i)=>(i in e&&(t[i]=e[i]),t),{})}var uo=m.forwardRef((e,t)=>{const i=m.useRef(null),n=m.useRef(),[o,r]=Ne();m.useImperativeHandle(t,()=>i.current,[]);const a=m.useRef({});return m.useEffect(()=>{const s={};Ze.forEach(d=>{const l=d,h=e[l];l in e&&h!==a.current[l]&&(s[l]=h)}),n.current&&n.current.updateOptions(s),a.current=e},Ze.map(s=>e[s])),m.useEffect(()=>{if(!i.current)return()=>{};const s=to(i.current,Object.assign(Object.assign({},po(e)),{createComponent:h=>new Pt(h.id,h.name,e.components[h.name],{addPortal:r})})),{clientWidth:d,clientHeight:l}=i.current;return s.layout(d,l),e.onReady&&e.onReady({api:s}),n.current=s,()=>{n.current=void 0,s.dispose()}},[]),m.useEffect(()=>{n.current&&n.current.updateOptions({createComponent:s=>new Pt(s.id,s.name,e.components[s.name],{addPortal:r})})},[e.components]),m.createElement("div",{style:{height:"100%",width:"100%"},ref:i},o)});uo.displayName="GridviewComponent";var Ie=class{get element(){return this._element}constructor(e,t,i){this.id=e,this.component=t,this.reactPortalStore=i,this._element=document.createElement("div"),this._element.style.height="100%",this._element.style.width="100%"}init(e){this.part=new ue(this.element,this.reactPortalStore,this.component,{params:e.params,api:e.api,title:e.title,containerApi:e.containerApi})}toJSON(){return{id:this.id}}update(e){var t;(t=this.part)===null||t===void 0||t.update(e.params)}dispose(){var e;(e=this.part)===null||e===void 0||e.dispose()}};function mo(e){return Xe.reduce((t,i)=>(i in e&&(t[i]=e[i]),t),{})}var go=m.forwardRef((e,t)=>{const i=m.useRef(null),n=m.useRef(),[o,r]=Ne();m.useImperativeHandle(t,()=>i.current,[]);const a=m.useRef({});return m.useEffect(()=>{const s={};Xe.forEach(d=>{const l=d,h=e[l];l in e&&h!==a.current[l]&&(s[l]=h)}),n.current&&n.current.updateOptions(s),a.current=e},Xe.map(s=>e[s])),m.useEffect(()=>{var s;if(!i.current)return()=>{};const d=(s=e.headerComponents)!==null&&s!==void 0?s:{},l=io(i.current,Object.assign(Object.assign({},mo(e)),{createComponent:p=>new Ie(p.id,e.components[p.name],{addPortal:r}),createHeaderComponent:p=>new Ie(p.id,d[p.name],{addPortal:r})})),{clientWidth:h,clientHeight:v}=i.current;return l.layout(h,v),e.onReady&&e.onReady({api:l}),n.current=l,()=>{n.current=void 0,l.dispose()}},[]),m.useEffect(()=>{n.current&&n.current.updateOptions({createComponent:s=>new Ie(s.id,e.components[s.name],{addPortal:r})})},[e.components]),m.useEffect(()=>{var s;if(!n.current)return;const d=(s=e.headerComponents)!==null&&s!==void 0?s:{};n.current.updateOptions({createHeaderComponent:l=>new Ie(l.id,d[l.name],{addPortal:r})})},[e.headerComponents]),m.useEffect(()=>{if(!n.current)return()=>{};const s=n.current.onDidDrop(d=>{e.onDidDrop&&e.onDidDrop(d)});return()=>{s.dispose()}},[e.onDidDrop]),m.createElement("div",{style:{height:"100%",width:"100%"},ref:i},o)});go.displayName="PaneviewComponent";var q=class extends Error{constructor(e){super(`LayoutValidationError: ${e}`),this.name="LayoutValidationError"}};function fo(e){if(!e||typeof e!="object")throw new q("layout must be an object");if(e.schemaVersion===0)return;const t=e;if(t.schemaVersion!==1)throw new q(`unsupported schemaVersion ${t.schemaVersion} (expected 1 or 0)`);if(!t.root||typeof t.root!="object")throw new q("layout.root required");if(ai(t.root),t.floating!==void 0){if(!Array.isArray(t.floating))throw new q("layout.floating must be array");for(const i of t.floating)bo(i)}}function Et(e){if(!e||typeof e!="object"||e.schemaVersion!==1)return!1;try{return fo(e),!0}catch{return!1}}function ai(e){if(e.kind==="group"){if(!Array.isArray(e.children))throw new q(`group ${e.id} missing children`);for(const t of e.children)ai(t)}else if(e.kind==="tabs"){if(!Array.isArray(e.panels))throw new q(`tabs ${e.id} missing panels`);if(e.panels.length>0&&!new Set(e.panels.map(t=>t.id)).has(e.activePanelId))throw new q(`tabs ${e.id} activePanelId ${e.activePanelId} not in panels`);for(const t of e.panels)di(t)}else throw new q("unknown node kind")}function di(e){if(!e.id||typeof e.id!="string")throw new q("panel missing id");if(!e.type||typeof e.type!="string")throw new q(`panel ${e.id} missing type`)}function bo(e){if(typeof e.x!="number"||typeof e.y!="number")throw new q(`floating ${e.id} bad x/y`);if(typeof e.width!="number"||typeof e.height!="number")throw new q(`floating ${e.id} bad w/h`);for(const t of e.panels)di(t)}function wo(e){const t={};function i(a){for(const s of a.panels)t[s.id]=It(s);return{type:"leaf",data:{views:a.panels.map(s=>s.id),activeView:a.activePanelId,id:a.id},size:a.size}}function n(a){return a?a.kind==="tabs"?i(a):{type:"branch",data:(a.children??[]).map(n),size:a.size}:{type:"branch",data:[]}}const o=e.root?.kind==="group"?e.root.direction??"row":"row",r=(e.floating??[]).map(a=>{const s={type:"leaf",data:{views:a.panels.map(d=>d.id),activeView:a.activePanelId,id:a.id}};for(const d of a.panels)t[d.id]=It(d);return{data:s,position:{left:a.x,top:a.y,width:a.width,height:a.height}}});return{grid:{root:n(e.root),orientation:o==="col"?"VERTICAL":"HORIZONTAL",height:0,width:0},panels:t,floatingGroups:r.length>0?r:void 0}}function It(e){return{id:e.id,contentComponent:e.type,title:e.title,params:e.params}}function _o(e){const t=e.grid.orientation==="VERTICAL"?"col":"row",i=li(e.grid.root,e.panels,t),n=(e.floatingGroups??[]).map(o=>({id:o.data.data.id,x:o.position.left,y:o.position.top,width:o.position.width,height:o.position.height,panels:o.data.data.views.map(r=>hi(r,e.panels[r])),activePanelId:o.data.data.activeView??o.data.data.views[0]??""}));return{schemaVersion:1,root:i,floating:n.length>0?n:void 0}}function li(e,t,i){if(e.type==="leaf")return{kind:"tabs",id:e.data.id,activePanelId:e.data.activeView??e.data.views[0]??"",panels:e.data.views.map(o=>hi(o,t[o])),size:e.size};const n=i==="row"?"col":"row";return{kind:"group",id:xo("g"),direction:i,children:e.data.map(o=>li(o,t,n)),size:e.size}}function hi(e,t){return t?{id:t.id,type:t.contentComponent,title:t.title,params:t.params}:{id:e,type:"__missing__",params:{__orphan:!0}}}function xo(e){try{if(typeof crypto<"u"&&"randomUUID"in crypto)return`${e}-${crypto.randomUUID().slice(0,8)}`}catch{}return`${e}-${Math.random().toString(36).slice(2,10)}`}var yo=class{map=new Map;listeners=new Set;register(e,t,i={}){this.map.set(e,{type:e,component:t,meta:i}),this.notify()}unregister(e){const t=this.map.delete(e);return t&&this.notify(),t}get(e){return this.map.get(e)}has(e){return this.map.has(e)}list(){return Array.from(this.map.keys()).sort()}subscribe(e){return this.listeners.add(e),()=>{this.listeners.delete(e)}}_reset(){this.map.clear(),this.listeners.clear()}notify(){for(const e of this.listeners)try{e()}catch(t){console.error("[panel-registry] listener threw:",t)}}};function Do(){return new yo}var ve=Do(),ci=class extends Error{conflict=!0;constructor(e){super(`409 conflict for ${e}`),this.name="DockLayoutConflictError"}};function Co(e="/api/dock-layouts"){const t=i=>`${e.replace(/\/$/,"")}/${encodeURIComponent(i)}`;return{async load(i){const n=await fetch(t(i));if(!n.ok){const o=await n.text().catch(()=>"");throw new Error(`GET ${t(i)} → ${n.status}: ${o}`)}return Ot(await n.json())},async save(i,n,o={}){const r={"content-type":"application/json"};!o.force&&typeof o.expectedUpdatedTs=="number"&&(r["if-match"]=String(o.expectedUpdatedTs));const a=await fetch(t(i),{method:"PUT",headers:r,body:JSON.stringify({layout:n})});if(a.status===409)throw new ci(i);if(!a.ok){const s=await a.text().catch(()=>"");throw new Error(`PUT ${t(i)} → ${a.status}: ${s}`)}return Ot(await a.json())},async reset(i){const n=await fetch(t(i),{method:"DELETE"});if(!n.ok&&n.status!==204){const o=await n.text().catch(()=>"");throw new Error(`DELETE ${t(i)} → ${n.status}: ${o}`)}return this.load(i)}}}function Ot(e){const t=e;return typeof t.layoutJson=="string"&&(t.layoutJson=JSON.parse(t.layoutJson)),t}var zo=[150,400,900],ko=e=>new Promise(t=>setTimeout(t,e));function So(e){if(e instanceof TypeError)return!0;const t=e instanceof Error?e.message:String(e??"");return/→\s*\d{3}\b/.test(t)?!1:/failed to fetch|load failed|networkerror|network request failed/i.test(t)}async function Ao(e,t,i=ko){let n;for(let o=0;o<=t.length;o++)try{return await e()}catch(r){if(n=r,o<t.length&&So(r))await i(t[o]);else break}throw n instanceof Error?n:new Error("layout load failed")}function Po(e,t,i){const[n,o]=(0,m.useState)({status:"loading",row:null,error:null}),r=(0,m.useRef)(null),a=i?.retryDelaysMs??zo,s=(0,m.useRef)(a);s.current=a;const d=(0,m.useCallback)(async()=>{const h=await t.load(e);return r.current=h,h},[e,t]);(0,m.useEffect)(()=>{let h=!1;return o({status:"loading",row:null,error:null}),Ao(d,s.current).then(v=>{h||o({status:"ready",row:v,error:null})}).catch(v=>{h||o({status:"error",row:null,error:v})}),()=>{h=!0}},[d]);const l=(0,m.useCallback)(async()=>{const h=await d();return o({status:"ready",row:h,error:null}),h},[d]);return{state:n,save:(0,m.useCallback)(async(h,v={})=>{const p=await t.save(e,h,{force:v.force,expectedUpdatedTs:r.current?.updatedTs});return r.current=p,o({status:"ready",row:p,error:null}),p},[e,t]),reset:(0,m.useCallback)(async()=>{const h=await t.reset(e);return r.current=h,o({status:"ready",row:h,error:null}),h},[e,t]),refresh:l}}var G=_i();function Eo({panelType:e}){return(0,G.jsxs)("div",{style:{padding:12,color:"var(--fg-mute, #888)",font:"12px system-ui, sans-serif"},children:["Missing panel: ",(0,G.jsx)("code",{children:e})]})}function Io(e,t,i,n){function o(r){const{api:a,params:s}=r,d=(0,m.useMemo)(()=>({panelId:a.id,panelType:e,params:s??{},api:{setParams:l=>a.updateParameters(l),setTitle:l=>a.setTitle(l),close:()=>{Promise.resolve(n?n(a.id):!0).then(l=>{l&&a.close()})}}}),[a,s]);return(0,G.jsx)(t.get(e)?.component??i,{...d})}return o.displayName=`PanelBridge(${e})`,o}function Oo(e,t){function i(n){if(n)if(n.kind==="tabs")for(const o of n.panels??[])t.add(o.type);else for(const o of n.children??[])i(o)}i(e.root);for(const n of e.floating??[])for(const o of n.panels??[])t.add(o.type)}function Go(e,t,i,n){const[o,r]=(0,m.useState)(0);return(0,m.useEffect)(()=>t.subscribe(()=>r(a=>a+1)),[t]),(0,m.useMemo)(()=>{const a=new Set;e&&Oo(e,a);for(const d of t.list())a.add(d);a.add("__missing__");const s={};for(const d of a)s[d]=Io(d,t,i,n);return s},[e,t,o,i,n])}function To({layoutName:e,store:t,registry:i=ve,className:n,resetEventName:o,loadEventName:r,missingComponent:a=Eo,canClosePanel:s,onApiReady:d,onApiDispose:l,onPanelRemoved:h,onSaveError:v,renderError:p}){const[b,u]=(0,m.useState)(e);(0,m.useEffect)(()=>u(e),[e]);const{state:g,save:D,reset:A,refresh:k}=Po(b,t),_=(0,m.useRef)(null),T=(0,m.useRef)(!1),R=(0,m.useRef)(null),C=g.status==="ready"&&g.row.schemaVersion===1?g.row.layoutJson:null,O=Et(C)?C:null,E=C!==null&&O===null,L=Go(O,i,a,s),U=(0,m.useRef)(null);(0,m.useEffect)(()=>{if(!E||g.status!=="ready")return;const w=g.row.updatedTs;if(U.current===w)return;U.current=w;const M=setTimeout(()=>{k()},300);return()=>clearTimeout(M)},[E,g,k]),(0,m.useEffect)(()=>{if(!T.current&&!(!_.current||!O))try{_.current.fromJSON(wo(O)),T.current=!0}catch(w){console.error("[DockWorkspace] hydrate failed:",w)}},[O]);const j=(0,m.useCallback)(()=>{_.current&&(R.current&&clearTimeout(R.current),R.current=setTimeout(()=>{const w=_.current?.toJSON();if(!w)return;const M=_o(w);Et(M)&&D(M).catch(I=>{I instanceof ci||I.conflict||(v?.(I),v||console.warn("[DockWorkspace] save failed:",I.message))})},800))},[D,v]),[Z,P]=(0,m.useState)(!1),f=(0,m.useCallback)(w=>{_.current=w.api,d?.(w.api),P(!0)},[d]);if((0,m.useEffect)(()=>{if(!Z||!_.current)return;const w=_.current,M=[w.onDidLayoutChange(j),w.onDidAddPanel(j),w.onDidRemovePanel(I=>{j(),h?.(I.id)})];return()=>{for(const I of M)I.dispose()}},[Z,j,h]),(0,m.useEffect)(()=>()=>{R.current&&clearTimeout(R.current),l?.()},[l]),(0,m.useEffect)(()=>{if(!o&&!r)return;const w=()=>{T.current=!1,A().catch(I=>console.error("[DockWorkspace] reset failed:",I))},M=I=>{const Me=I.detail;Me?.name&&typeof Me.name=="string"&&(T.current=!1,u(Me.name))};return o&&window.addEventListener(o,w),r&&window.addEventListener(r,M),()=>{o&&window.removeEventListener(o,w),r&&window.removeEventListener(r,M)}},[A,o,r]),g.status==="error"){const w=()=>{k()},M=()=>{T.current=!1,A()};return p?p(g.error,{retry:w,reset:M}):(0,G.jsxs)("div",{style:{padding:24,display:"flex",flexDirection:"column",gap:12,alignItems:"flex-start",fontSize:13},children:[(0,G.jsxs)("div",{style:{color:"var(--bad, #f85149)"},children:["Failed to load layout ",(0,G.jsx)("code",{children:b}),": ",g.error.message]}),(0,G.jsxs)("div",{style:{display:"flex",gap:8},children:[(0,G.jsx)("button",{type:"button",onClick:w,children:"Retry"}),(0,G.jsx)("button",{type:"button",onClick:M,children:"Reset to default"})]})]})}return(0,G.jsx)(si,{onReady:f,components:L,className:n??"dockview-theme-dark"})}var ze=null,qe=new Set;function Gt(e){ze=e;for(const t of qe)t(e)}function vi(e){return qe.add(e),ze&&e(ze),()=>{qe.delete(e)}}function pe(){if(!ze)throw new Error("dock not mounted: no DockviewApi bound");return ze}function _r(e){const t=e.id??Lo("p"),i=ve.get(e.type)?.meta.keepAlive?"always":void 0,n={id:t,component:e.type,title:e.title,params:e.params,...i?{renderer:i}:{}};return e.group&&(n.position={referenceGroup:e.group}),e.floating&&(n.floating={x:e.floating.x??80,y:e.floating.y??80,width:e.floating.width??480,height:e.floating.height??360}),pe().addPanel(n),t}function xr(e){const t=pe().getPanel(e);return t?(t.api.setActive(),!0):!1}function yr(e){const t=pe().getPanel(e);return t?(pe().removePanel(t),!0):!1}function Dr(e,t){const i=pe().getPanel(e);return i?(i.api.updateParameters(t),!0):!1}function Cr(e,t){const i=pe().getPanel(e);return i?(i.api.setTitle(t),!0):!1}function zr(){typeof window>"u"||window.dispatchEvent(new CustomEvent("papercusp:dock-reset-layout"))}function Ro(e){const t=e;if(t.view?.contentComponent)return t.view.contentComponent;if(t.contentComponent)return t.contentComponent;if(t.component)return t.component;try{const i=t.toJSON?.();if(i?.contentComponent)return i.contentComponent}catch{}return"unknown"}function kr(){return pe().panels.map(e=>{const t=e.params??{},i=e.group?.activePanel?.id===e.id;return{id:e.id,type:Ro(e),title:e.title,params:t,isActive:i}})}function Lo(e){try{if(typeof crypto<"u"&&"randomUUID"in crypto)return`${e}-${crypto.randomUUID().slice(0,8)}`}catch{}return`${e}-${Math.random().toString(36).slice(2,10)}`}var Vo=1e4;function No(e){const{panelType:t,api:i}=e,[n,o]=(0,m.useState)(0),[r,a]=(0,m.useState)(!1);(0,m.useEffect)(()=>ve.subscribe(()=>o(d=>d+1)),[]),(0,m.useEffect)(()=>{const d=setTimeout(()=>a(!0),Vo);return()=>clearTimeout(d)},[]);const s=ve.get(t);if(s){const d=s.component;return(0,G.jsx)(d,{...e})}return r?(0,G.jsxs)("div",{style:{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:12,color:"var(--fg-mute)",fontSize:13,padding:16,textAlign:"center"},children:[(0,G.jsxs)("div",{children:["Panel type ",(0,G.jsx)("code",{style:{color:"var(--fg)"},children:t})," is not installed."]}),(0,G.jsx)("button",{type:"button",onClick:()=>i.close(),style:{padding:"6px 12px",fontSize:12,background:"var(--bg-2)",color:"var(--fg)",border:"1px solid var(--border, #333)",borderRadius:4,cursor:"pointer"},children:"Remove panel"})]}):(0,G.jsxs)("div",{style:{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"var(--fg-mute)",fontSize:13},children:["Loading ",t,"…"]})}var Mo=new Map,pi=async()=>!1;function Wo(e){e.confirm&&(pi=e.confirm)}async function Ho(e){const t=Mo.get(e);if(!t)return!0;let i;try{i=await t()}catch{i=!0}if(i)return!0;try{return await pi(e)}catch{return!1}}var Fo=new Map;function Bo(e){return Fo.get(e)}var Y={stack:[],cursor:-1},ui=null,mi=!1,Uo=new Set;function $o(){for(const e of Uo)e()}function gi(e){Y=e,$o()}function jo(){if(Y.cursor<=0)return;const e=Y.cursor-1,t=Y.stack[e],i=ui;if(i&&t){const n=i.getPanel(t);n&&(mi=!0,n.api.setActive())}gi({...Y,cursor:e})}function Jo(){if(Y.cursor<0||Y.cursor>=Y.stack.length-1)return;const e=Y.cursor+1,t=Y.stack[e],i=ui;if(i&&t){const n=i.getPanel(t);n&&(mi=!0,n.api.setActive())}gi({...Y,cursor:e})}function Yo(){return{canBack:Y.cursor>0,canForward:Y.cursor>=0&&Y.cursor<Y.stack.length-1,back:jo,forward:Jo}}function Zo(){(0,m.useEffect)(()=>{let e=null,t=null;const i=o=>{if(!(o.metaKey||o.ctrlKey)||o.key!=="["&&o.key!=="]")return;const r=o.target,a=r?.tagName?.toLowerCase();if(a==="input"||a==="textarea"||r?.isContentEditable)return;if(e){const d=Bo(e);if(d){if(o.key==="["&&d.canBack){o.preventDefault(),d.back();return}if(o.key==="]"&&d.canForward){o.preventDefault(),d.forward();return}}}const s=Yo();o.key==="["&&s.canBack?(o.preventDefault(),s.back()):o.key==="]"&&s.canForward&&(o.preventDefault(),s.forward())},n=vi(o=>{if(t&&(t.dispose(),t=null),!o){e=null;return}e=o.activeGroup?.activePanel?.id??null,t=o.onDidActivePanelChange(()=>{e=o.activeGroup?.activePanel?.id??null})});return window.addEventListener("keydown",i),()=>{window.removeEventListener("keydown",i),t&&t.dispose(),n()}},[])}var Xo=1e3;function Ko(e){const t=(0,m.useRef)(e);(0,m.useEffect)(()=>{t.current=e},[e]),(0,m.useEffect)(()=>{let i=null,n=!1;const o=s=>s.key==="Escape"&&s.shiftKey&&!s.metaKey&&!s.ctrlKey&&!s.altKey,r=s=>{o(s)&&(n||(n=!0,i=setTimeout(()=>{t.current(),i=null},Xo)))},a=s=>{(s.key==="Escape"||s.key==="Shift")&&(n=!1,i&&(clearTimeout(i),i=null))};return window.addEventListener("keydown",r),window.addEventListener("keyup",a),()=>{window.removeEventListener("keydown",r),window.removeEventListener("keyup",a),i&&clearTimeout(i)}},[])}var be=new Map,ge=null;function Qe(){if(!ge){if(typeof document>"u")throw new Error("iframe-host requires browser environment");ge=document.createElement("div"),ge.id="papercusp-iframe-host",ge.style.cssText="position:absolute;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;",document.body.appendChild(ge)}return ge}function qo(e,t){let i=be.get(e);return i||(i=document.createElement("iframe"),i.dataset.iframeHostId=e,i.src=t.src,t.sandbox&&i.setAttribute("sandbox",t.sandbox),t.allow&&i.setAttribute("allow",t.allow),t.title&&(i.title=t.title),i.style.cssText="width:100%;height:100%;border:0;display:block;",Qe().appendChild(i),be.set(e,i),i)}function Qo(e,t){const i=be.get(e);!i||i.parentElement===t||t.appendChild(i)}function er(e){const t=be.get(e);t&&t.parentElement!==Qe()&&Qe().appendChild(t)}function tr(e){const t=be.get(e);t&&(t.remove(),be.delete(e))}function ir(e){const t=(0,m.useRef)(null),i=e.params??{},n=i.src;if(!n)return(0,G.jsx)("div",{style:{padding:16,color:"#f99",fontSize:13},children:"IframePanel missing required `params.src`"});const o=e.panelId;return(0,m.useEffect)(()=>{if(t.current)return qo(o,{src:n,sandbox:i.sandbox,allow:i.allow,title:i.title??e.panelType}),Qo(o,t.current),()=>{er(o)}},[o]),(0,G.jsx)("div",{ref:t,style:{width:"100%",height:"100%",display:"flex"},"aria-label":i.title??`${e.panelType} content`})}bi();var nr={"@papercusp/papercusp-shared::PiTerminalsDock":async()=>{const e=await wi(()=>import("./PiTerminalsDock-BuImwvoF.js"),__vite__mapDeps([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45])),t=e.default??e.PiTerminalsDock;if(typeof t!="function")throw new Error("PiTerminalsDock export not found");const i=n=>(0,G.jsx)(t,{slug:n.params.harnessSlug||n.params.slug||"",initialLaneId:n.params.initialLaneId||void 0});return i.displayName="PiTerminalsDockWrap",{default:i}}};function or(e){(0,m.useEffect)(()=>{if(!e)return;let t=!1;return fetch(`/api/plugins/${encodeURIComponent(e)}/contributions`).then(i=>i.ok?i.json():null).then(i=>{if(!(t||!i?.panels))for(const n of i.panels)if(n.type==="iframe"&&n.src){const o=r=>{const a=r.params;return(0,G.jsx)(ir,{...r,params:{...r.params,src:a.src??n.src}})};o.displayName=`PluginIframePanel(${n.fullType})`,ve.register(n.fullType,o,{title:n.title,keepAlive:n.keepAlive??!0,defaultGroup:n.defaultGroup})}else{const o=nr[`${n.componentRoot??""}::${n.componentId??""}`];if(o){const r=Pi(o,{ssr:!1,loading:()=>(0,G.jsxs)("div",{style:{padding:16,fontSize:12,color:"var(--fg-mute)"},children:["Loading ",n.title,"…"]})});ve.register(n.fullType,r,{title:n.title,keepAlive:n.keepAlive??!0,defaultGroup:n.defaultGroup})}else{const r=()=>(0,G.jsxs)("div",{style:{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",padding:16,textAlign:"center",color:"var(--fg-mute)",fontSize:12},children:["Plugin"," ",(0,G.jsxs)("code",{style:{color:"var(--fg)"},children:[n.pluginName,":",n.id]})," ","is an external React-typed panel; the dock doesn't have a loader for"," ",(0,G.jsxs)("code",{children:[n.componentRoot??"?","::",n.componentId??"?"]})," ","yet. Add it to KNOWN_REACT_PANELS in useRegisterPluginPanels.tsx."]});r.displayName=`PluginReactPanelNotYet(${n.fullType})`,ve.register(n.fullType,r,{title:n.title,keepAlive:!1,defaultGroup:n.defaultGroup})}}}).catch(()=>{}),()=>{t=!0}},[e])}function rr(){const[,e]=Ci("focusSlug",Di.withDefault(""));(0,m.useEffect)(()=>vi(t=>{if(!t)return;const i=()=>{const n=t.activeGroup?.activePanel;if(!n)return;const o=n.params?.harnessSlug;typeof o=="string"&&o.length>0&&e(o,{history:"replace"})};i(),t.onDidActivePanelChange(i)}),[e])}var sr=Co("/api/dock-layouts");function Sr({layoutName:e,className:t,slug:i}){const n=zi(),o=(0,m.useMemo)(()=>({...sr,async load(h){const v=await yi({queryName:"dockLayouts.byName",args:{workspaceId:n,name:h},staleTime:3e4});if(!v[0])throw new Error(`layout ${h} not found`);return v[0]}}),[n]),{confirm:r,element:a}=ki();(0,m.useEffect)(()=>{Si(lt.harnessDockOpen)},[]),(0,m.useEffect)(()=>{Wo({confirm:()=>r({title:"Discard unsaved changes?",body:"This panel has unsaved changes. Close it anyway?",confirmLabel:"Close panel",destructive:!0})})},[r]),Zo(),Ko(()=>{window.dispatchEvent(new CustomEvent("papercusp:dock-reset-layout"))}),or(i??""),rr();const s=(0,m.useCallback)(h=>{Gt(h),Ai(lt.harnessDockOpen)},[]),d=(0,m.useCallback)(()=>{Gt(null)},[]),l=(0,m.useCallback)(h=>{try{tr(h)}catch{}},[]);return(0,G.jsxs)(G.Fragment,{children:[a,(0,G.jsx)(To,{layoutName:e,store:o,className:t??"dockview-theme-dark",missingComponent:No,canClosePanel:Ho,onApiReady:s,onApiDispose:d,onPanelRemoved:l,resetEventName:"papercusp:dock-reset-layout",loadEventName:"papercusp:dock-load-layout"})]})}export{kr as a,zr as c,ve as d,xr as i,Dr as l,ir as n,vi as o,yr as r,_r as s,Sr as t,Cr as u};
