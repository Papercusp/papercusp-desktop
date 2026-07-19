import{o as ue}from"./chunk-ChpBd9eV.js";import{t as de}from"./react-DqHYuLt-.js";import{t as fe}from"./jsx-runtime-BmDUFisN.js";import{t as ge}from"./link-SGnF5yRY.js";import{n as he}from"./navigation-BWlRNEIQ.js";var o=ue(de(),1),K=fe();function pe({href:e,prefetch:t,legacyBehavior:r,passHref:s,as:n,...i}){return(0,K.jsx)(ge,{to:e,...i})}function _(e,t,r){return Math.max(t,Math.min(e,r))}function N(e,t){return t==="rtl"?(1-e)*100:(-1+e)*100}function S(e,t,r){if(typeof t=="string")r!==void 0&&(e.style[t]=r);else for(const s in t)if(t.hasOwnProperty(s)){const n=t[s];n!==void 0&&(e.style[s]=n)}}function P(e,t){e.classList.add(t)}function q(e,t){e.classList.remove(t)}function $(e){e&&e.parentNode&&e.parentNode.removeChild(e)}var B={minimum:.08,maximum:1,template:`<div class="bar"><div class="peg"></div></div>
             <div class="spinner"><div class="spinner-icon"></div></div>
             <div class="indeterminate"><div class="inc"></div><div class="dec"></div></div>`,easing:"linear",positionUsing:"",speed:200,trickle:!0,trickleSpeed:200,showSpinner:!0,indeterminate:!1,indeterminateSelector:".indeterminate",barSelector:".bar",spinnerSelector:".spinner",parent:"body",direction:"ltr"},d=class{static settings=B;static status=null;static pending=[];static isPaused=!1;static reset(){return this.status=null,this.isPaused=!1,this.pending=[],this.settings=B,this}static configure(e){return Object.assign(this.settings,e),this}static isStarted(){return typeof this.status=="number"}static set(e){if(this.isPaused)return this;const t=this.isStarted();e=_(e,this.settings.minimum,this.settings.maximum),this.status=e===this.settings.maximum?null:e;const r=this.render(!t),s=this.settings.speed,n=this.settings.easing;return r.forEach(i=>i.offsetWidth),this.queue(i=>{r.forEach(a=>{this.settings.indeterminate||S(a.querySelector(this.settings.barSelector),this.barPositionCSS({n:e,speed:s,ease:n}))}),e===this.settings.maximum?(r.forEach(a=>{S(a,{transition:"none",opacity:"1"}),a.offsetWidth}),setTimeout(()=>{r.forEach(a=>{S(a,{transition:`all ${s}ms ${n}`,opacity:"0"})}),setTimeout(()=>{r.forEach(a=>{this.remove(a),this.settings.template===null&&S(a,{transition:"none",opacity:"1"})}),i()},s)},s)):setTimeout(i,s)}),this}static start(){this.status||this.set(0);const e=()=>{this.isPaused||setTimeout(()=>{this.status&&(this.trickle(),e())},this.settings.trickleSpeed)};return this.settings.trickle&&e(),this}static done(e){return!e&&!this.status?this:this.inc(.3+.5*Math.random()).set(1)}static inc(e){if(this.isPaused||this.settings.indeterminate)return this;let t=this.status;return t?t>1?this:(typeof e!="number"&&(t>=0&&t<.2?e=.1:t>=.2&&t<.5?e=.04:t>=.5&&t<.8?e=.02:t>=.8&&t<.99?e=.005:e=0),t=_(t+e,0,.994),this.set(t)):this.start()}static dec(e){if(this.isPaused||this.settings.indeterminate)return this;let t=this.status;return typeof t!="number"?this:(typeof e!="number"&&(t>.8?e=.1:t>.5?e=.05:t>.2?e=.02:e=.01),t=_(t-e,0,.994),this.set(t))}static trickle(){return this.isPaused||this.settings.indeterminate?this:this.inc()}static promise(e){if(!e||e.state()==="resolved")return this;let t=0,r=0;return r===0&&this.start(),t++,r++,e.always(()=>{r--,r===0?(t=0,this.done()):this.set((t-r)/t)}),this}static render(e=!1){const t=typeof this.settings.parent=="string"?document.querySelector(this.settings.parent):this.settings.parent,r=t?Array.from(t.querySelectorAll(".bprogress")):[];if(this.settings.template!==null&&r.length===0){P(document.documentElement,"bprogress-busy");const s=document.createElement("div");P(s,"bprogress"),s.innerHTML=this.settings.template,t!==document.body&&P(t,"bprogress-custom-parent"),t.appendChild(s),r.push(s)}return r.forEach(s=>{if(this.settings.template===null&&(s.style.display=""),P(document.documentElement,"bprogress-busy"),t!==document.body&&P(t,"bprogress-custom-parent"),this.settings.indeterminate){const n=s.querySelector(this.settings.barSelector);n&&(n.style.display="none");const i=s.querySelector(this.settings.indeterminateSelector);i&&(i.style.display="")}else{const n=s.querySelector(this.settings.barSelector),i=e?N(0,this.settings.direction):N(this.status||0,this.settings.direction);S(n,this.barPositionCSS({n:this.status||0,speed:this.settings.speed,ease:this.settings.easing,perc:i}));const a=s.querySelector(this.settings.indeterminateSelector);a&&(a.style.display="none")}if(this.settings.template===null){const n=s.querySelector(this.settings.spinnerSelector);n&&(n.style.display=this.settings.showSpinner?"block":"none")}else if(!this.settings.showSpinner){const n=s.querySelector(this.settings.spinnerSelector);n&&$(n)}}),r}static remove(e){e?this.settings.template===null?e.style.display="none":$(e):(q(document.documentElement,"bprogress-busy"),(typeof this.settings.parent=="string"?document.querySelectorAll(this.settings.parent):[this.settings.parent]).forEach(t=>{q(t,"bprogress-custom-parent")}),document.querySelectorAll(".bprogress").forEach(t=>{const r=t;this.settings.template===null?r.style.display="none":$(r)}))}static pause(){return!this.isStarted()||this.settings.indeterminate?this:(this.isPaused=!0,this)}static resume(){if(!this.isStarted()||this.settings.indeterminate)return this;if(this.isPaused=!1,this.settings.trickle){const e=()=>{this.isPaused||setTimeout(()=>{this.status&&(this.trickle(),e())},this.settings.trickleSpeed)};e()}return this}static isRendered(){return document.querySelectorAll(".bprogress").length>0}static getPositioningCSS(){const e=document.body.style,t="WebkitTransform"in e?"Webkit":"MozTransform"in e?"Moz":"msTransform"in e?"ms":"OTransform"in e?"O":"";return`${t}Perspective`in e?"translate3d":`${t}Transform`in e?"translate":"margin"}static queue(e){this.pending.push(e),this.pending.length===1&&this.next()}static next(){const e=this.pending.shift();e&&e(this.next.bind(this))}static initPositionUsing(){this.settings.positionUsing===""&&(this.settings.positionUsing=this.getPositioningCSS())}static barPositionCSS({n:e,speed:t,ease:r,perc:s}){this.initPositionUsing();let n={};const i=s??N(e,this.settings.direction);return this.settings.positionUsing==="translate3d"?n={transform:`translate3d(${i}%,0,0)`}:this.settings.positionUsing==="translate"?n={transform:`translate(${i}%,0)`}:this.settings.positionUsing==="width"?n={width:`${this.settings.direction==="rtl"?100-i:i+100}%`,...this.settings.direction==="rtl"?{right:"0",left:"auto"}:{}}:this.settings.positionUsing==="margin"&&(n=this.settings.direction==="rtl"?{"margin-left":`${-i}%`}:{"margin-right":`${-i}%`}),n.transition=`all ${t}ms ${r}`,n}},me=({color:e="#29d",height:t="2px",spinnerPosition:r="top-right"})=>`
:root {
  --bprogress-color: ${e};
  --bprogress-height: ${t};
  --bprogress-spinner-size: 18px;
  --bprogress-spinner-animation-duration: 400ms;
  --bprogress-spinner-border-size: 2px;
  --bprogress-box-shadow: 0 0 10px ${e}, 0 0 5px ${e};
  --bprogress-z-index: 99999;
  --bprogress-spinner-top: ${r==="top-right"||r==="top-left"?"15px":"auto"};
  --bprogress-spinner-bottom: ${r==="bottom-right"||r==="bottom-left"?"15px":"auto"};
  --bprogress-spinner-right: ${r==="top-right"||r==="bottom-right"?"15px":"auto"};
  --bprogress-spinner-left: ${r==="top-left"||r==="bottom-left"?"15px":"auto"};
}

.bprogress {
  width: 0;
  height: 0;
  pointer-events: none;
  z-index: var(--bprogress-z-index);
}

.bprogress .bar {
  background: var(--bprogress-color);
  position: fixed;
  z-index: var(--bprogress-z-index);
  top: 0;
  left: 0;
  width: 100%;
  height: var(--bprogress-height);
}

/* Fancy blur effect */
.bprogress .peg {
  display: block;
  position: absolute;
  right: 0;
  width: 100px;
  height: 100%;
  box-shadow: var(--bprogress-box-shadow);
  opacity: 1.0;
  transform: rotate(3deg) translate(0px, -4px);
}

/* Remove these to get rid of the spinner */
.bprogress .spinner {
  display: block;
  position: fixed;
  z-index: var(--bprogress-z-index);
  top: var(--bprogress-spinner-top);
  bottom: var(--bprogress-spinner-bottom);
  right: var(--bprogress-spinner-right);
  left: var(--bprogress-spinner-left);
}

.bprogress .spinner-icon {
  width: var(--bprogress-spinner-size);
  height: var(--bprogress-spinner-size);
  box-sizing: border-box;
  border: solid var(--bprogress-spinner-border-size) transparent;
  border-top-color: var(--bprogress-color);
  border-left-color: var(--bprogress-color);
  border-radius: 50%;
  -webkit-animation: bprogress-spinner var(--bprogress-spinner-animation-duration) linear infinite;
  animation: bprogress-spinner var(--bprogress-spinner-animation-duration) linear infinite;
}

.bprogress-custom-parent {
  overflow: hidden;
  position: relative;
}

.bprogress-custom-parent .bprogress .spinner,
.bprogress-custom-parent .bprogress .bar {
  position: absolute;
}

.bprogress .indeterminate {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: var(--bprogress-height);
  overflow: hidden;
}

.bprogress .indeterminate .inc,
.bprogress .indeterminate .dec {
  position: absolute;
  top: 0;
  height: 100%;
  background-color: var(--bprogress-color);
}

.bprogress .indeterminate .inc {
  animation: bprogress-indeterminate-increase 2s infinite;
}

.bprogress .indeterminate .dec {
  animation: bprogress-indeterminate-decrease 2s 0.5s infinite;
}

@-webkit-keyframes bprogress-spinner {
  0%   { -webkit-transform: rotate(0deg); transform: rotate(0deg); }
  100% { -webkit-transform: rotate(360deg); transform: rotate(360deg); }
}

@keyframes bprogress-spinner {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes bprogress-indeterminate-increase {
  from { left: -5%; width: 5%; }
  to { left: 130%; width: 100%; }
}

@keyframes bprogress-indeterminate-decrease {
  from { left: -80%; width: 80%; }
  to { left: 110%; width: 10%; }
}
`;function be(e,t,r){return t in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function g(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]!=null?arguments[t]:{},s=Object.keys(r);typeof Object.getOwnPropertySymbols=="function"&&(s=s.concat(Object.getOwnPropertySymbols(r).filter(function(n){return Object.getOwnPropertyDescriptor(r,n).enumerable}))),s.forEach(function(n){be(e,n,r[n])})}return e}function ve(e,t){var r=Object.keys(e);if(Object.getOwnPropertySymbols){var s=Object.getOwnPropertySymbols(e);t&&(s=s.filter(function(n){return Object.getOwnPropertyDescriptor(e,n).enumerable})),r.push.apply(r,s)}return r}function ye(e,t){return t=t??{},Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(t)):ve(Object(t)).forEach(function(r){Object.defineProperty(e,r,Object.getOwnPropertyDescriptor(t,r))}),e}function b(e,t){if(e==null)return{};var r=Se(e,t),s,n;if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e);for(n=0;n<i.length;n++)s=i[n],!(t.indexOf(s)>=0)&&Object.prototype.propertyIsEnumerable.call(e,s)&&(r[s]=e[s])}return r}function Se(e,t){if(e==null)return{};var r={},s=Object.keys(e),n,i;for(i=0;i<s.length;i++)n=s[i],!(t.indexOf(n)>=0)&&(r[n]=e[n]);return r}var D=(0,o.createContext)(void 0),Pe=function(){var e=(0,o.useContext)(D);if(!e)throw new Error("useProgress must be used within a ProgressProvider");return e},Ge=function(e){var t=e.children,r=e.color,s=r===void 0?"#0A2FFF":r,n=e.height,i=n===void 0?"2px":n,a=e.options,l=e.spinnerPosition,u=l===void 0?"top-right":l,w=e.style,h=e.disableStyle,y=h===void 0?!1:h,T=e.nonce,U=e.shallowRouting,J=U===void 0?!1:U,A=e.disableSameURL,Q=A===void 0?!0:A,I=e.startPosition,X=I===void 0?0:I,L=e.delay,Y=L===void 0?0:L,z=e.stopDelay,Z=z===void 0?0:z,E=(0,o.useRef)(null),x=(0,o.useRef)(!1),O=(0,o.useCallback)(function(){return x.current=!0},[]),R=(0,o.useCallback)(function(){return x.current=!1},[]),ee=(0,o.useCallback)(function(){var c=arguments.length>0&&arguments[0]!==void 0?arguments[0]:0,p=arguments.length>1&&arguments[1]!==void 0?arguments[1]:0;arguments.length>2&&arguments[2]!==void 0&&arguments[2]&&O(),E.current=setTimeout(function(){c>0&&d.set(c),d.start()},p)},[O]),te=(0,o.useCallback)(function(){var c=arguments.length>0&&arguments[0]!==void 0?arguments[0]:0,p=arguments.length>1&&arguments[1]!==void 0?arguments[1]:0;setTimeout(function(){E.current&&clearTimeout(E.current),E.current=setTimeout(function(){d.isStarted()&&(d.done(),x.current&&R())},c)},p)},[R]),re=(0,o.useCallback)(function(c){return d.inc(c)},[]),se=(0,o.useCallback)(function(c){return d.dec(c)},[]),ne=(0,o.useCallback)(function(c){return d.set(c)},[]),ie=(0,o.useCallback)(function(){return d.pause()},[]),oe=(0,o.useCallback)(function(){return d.resume()},[]),C=(0,o.useCallback)(function(){return d.settings},[]),ae=(0,o.useCallback)(function(c){var p=C(),ce=g({},p,typeof c=="function"?c(p):c);d.configure(ce)},[C]),le=(0,o.useMemo)(function(){return o.createElement("style",{nonce:T},w||me({color:s,height:i,spinnerPosition:u}))},[s,i,T,u,w]);return d.configure(a||{}),o.createElement(D.Provider,{value:{start:ee,stop:te,inc:re,dec:se,set:ne,pause:ie,resume:oe,setOptions:ae,getOptions:C,isAutoStopDisabled:x,disableAutoStop:O,enableAutoStop:R,shallowRouting:J,disableSameURL:Q,startPosition:X,delay:Y,stopDelay:Z}},y?null:le,t)};function v(){for(var e=arguments.length,t=new Array(e),r=0;r<e;r++)t[r]=arguments[r];return t.filter(Boolean).join(" ")}function we(e,t){var r=e.as,s=e.children,n=e.className,i=e.classSelector,a=i===void 0?"bar":i,l=b(e,["as","children","className","classSelector"]),u=r??"div";return o.createElement(u,g({ref:t,className:v(a,n)},l),s)}var Ee=o.forwardRef(we);function xe(e,t){var r=e.as,s=e.children,n=e.className,i=e.classSelector,a=i===void 0?"peg":i,l=b(e,["as","children","className","classSelector"]),u=r??"div";return o.createElement(u,g({ref:t,className:v(a,n)},l),s)}var ke=o.forwardRef(xe);function Oe(e,t){var r=e.as,s=e.children,n=e.className,i=e.classSelector,a=i===void 0?"spinner":i,l=b(e,["as","children","className","classSelector"]),u=r??"div";return o.createElement(u,g({ref:t,className:v(a,n)},l),s)}var Re=o.forwardRef(Oe);function Ce(e,t){var r=e.as,s=e.children,n=e.className,i=e.classSelector,a=i===void 0?"spinner-icon":i,l=b(e,["as","children","className","classSelector"]),u=r??"div";return o.createElement(u,g({ref:t,className:v(a,n)},l),s)}var _e=o.forwardRef(Ce);function Ne(e,t){var r=e.as,s=e.children,n=e.className,i=e.style,a=b(e,["as","children","className","style"]),l=r??"div";return o.createElement(l,g({ref:t,className:v("bprogress",n),style:ye(g({},i),{display:"none"})},a),s||o.createElement(o.Fragment,null,o.createElement(Ee,null,o.createElement(ke,null)),o.createElement(Re,null,o.createElement(_e,null))))}var Ve=o.forwardRef(Ne);function $e(e,t){var r=e.as,s=e.className,n=e.classSelector,i=n===void 0?"indeterminate":n,a=b(e,["as","className","classSelector"]),l=r??"div";return o.createElement(l,g({ref:t,className:v(i,s)},a),o.createElement("div",{className:"inc"}),o.createElement("div",{className:"dec"}))}var Je=o.forwardRef($e),je=1500,Te=0,Ue=360,m=null,F=0,f=null,j=new Set;function W(){j.forEach(e=>e())}function G(e){if(!e){document.documentElement.removeAttribute("data-route-pending"),document.documentElement.removeAttribute("data-route-pending-target");return}document.documentElement.setAttribute("data-route-pending","true"),document.documentElement.setAttribute("data-route-pending-target",V(e))}function Ae(e){return V(e)==="harness"?Ue:Te}function Ie(e){return j.add(e),()=>j.delete(e)}function H(){return m}function k(e){try{const t=new URL(e,"http://papercusp.local");return`${t.pathname.length>1?t.pathname.replace(/\/+$/,""):t.pathname}${t.search}${t.hash}`}catch{return e}}function V(e){const t=k(e);return t==="/harness"||t.startsWith("/harness/")?"harness":"generic"}function Le(e){if(typeof e=="string")return k(e);if(e&&typeof e=="object"&&"pathname"in e&&typeof e.pathname=="string"){const t="search"in e&&typeof e.search=="string"?e.search:"",r="hash"in e&&typeof e.hash=="string"?e.hash:"";return k(`${e.pathname}${t}${r}`)}return null}function ze(e){f!==null&&(window.clearTimeout(f),f=null),m=k(e),F=performance.now(),G(m),W()}function qe(){m=null,f!==null&&(window.clearTimeout(f),f=null),G(null),W()}function M(){if(!m||f!==null)return;const e=Math.max(0,Ae(m)-(performance.now()-F));f=window.setTimeout(qe,e)}function Be(e){if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.download||e.targetBlank||e.disableProgress||e.targetBlocksProgress)return!1;const t=new URL(e.targetHref,e.currentHref),r=new URL(e.currentHref);return!(t.origin!==r.origin||t.pathname===r.pathname&&t.search===r.search)}function He(e){const t=e.currentTarget,r=e.target;return Be({defaultPrevented:e.defaultPrevented,button:e.button,metaKey:e.metaKey,ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,altKey:e.altKey,download:t.hasAttribute("download"),targetBlank:t.target==="_blank",disableProgress:t.getAttribute("data-disable-progress")==="true",targetBlocksProgress:r instanceof Element&&!!(r.closest('[data-prevent-progress="true"]')||r.closest('[data-disable-progress="true"]')),currentHref:window.location.href,targetHref:t.href})}function Qe({className:e,onClickCapture:t,...r}){const s=Pe(),n=he(),i=(0,o.useSyncExternalStore)(Ie,H,H),a=Le(r.href),l=a!==null&&i===a;(0,o.useEffect)(()=>{M()},[n]);function u(h){if(t?.(h),!He(h))return;const y=new URL(h.currentTarget.href);ze(`${y.pathname}${y.search}${y.hash}`),s.set(.08),s.start(.08,0,!0),window.setTimeout(()=>{s.stop(120),M()},je)}const w=[e,l?"is-route-pending":null].filter(Boolean).join(" ");return(0,K.jsx)(pe,{...r,"aria-busy":l||void 0,className:w||void 0,"data-route-pending":l?"true":void 0,onClickCapture:u})}export{Ge as n,Pe as r,Qe as t};
