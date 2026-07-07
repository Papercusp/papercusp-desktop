import{o as e}from"./chunk-CMxvf4Kt.js";import{t}from"./react-C1Wm8aMI.js";import{t as n}from"./jsx-runtime-sLPvdpSW.js";import{n as r}from"./navigation-C0a2biyu.js";import{t as i}from"./link-hBfuc1y1.js";var a=e(t(),1);function o(e,t,n){return Math.max(t,Math.min(e,n))}function s(e,t){return t===`rtl`?(1-e)*100:(-1+e)*100}function c(e,t,n){if(typeof t==`string`)n!==void 0&&(e.style[t]=n);else for(let n in t)if(t.hasOwnProperty(n)){let r=t[n];r!==void 0&&(e.style[n]=r)}}function l(e,t){e.classList.add(t)}function u(e,t){e.classList.remove(t)}function d(e){e&&e.parentNode&&e.parentNode.removeChild(e)}var f={minimum:.08,maximum:1,template:`<div class="bar"><div class="peg"></div></div>
             <div class="spinner"><div class="spinner-icon"></div></div>
             <div class="indeterminate"><div class="inc"></div><div class="dec"></div></div>`,easing:`linear`,positionUsing:``,speed:200,trickle:!0,trickleSpeed:200,showSpinner:!0,indeterminate:!1,indeterminateSelector:`.indeterminate`,barSelector:`.bar`,spinnerSelector:`.spinner`,parent:`body`,direction:`ltr`},p=class{static settings=f;static status=null;static pending=[];static isPaused=!1;static reset(){return this.status=null,this.isPaused=!1,this.pending=[],this.settings=f,this}static configure(e){return Object.assign(this.settings,e),this}static isStarted(){return typeof this.status==`number`}static set(e){if(this.isPaused)return this;let t=this.isStarted();e=o(e,this.settings.minimum,this.settings.maximum),this.status=e===this.settings.maximum?null:e;let n=this.render(!t),r=this.settings.speed,i=this.settings.easing;return n.forEach(e=>e.offsetWidth),this.queue(t=>{n.forEach(t=>{this.settings.indeterminate||c(t.querySelector(this.settings.barSelector),this.barPositionCSS({n:e,speed:r,ease:i}))}),e===this.settings.maximum?(n.forEach(e=>{c(e,{transition:`none`,opacity:`1`}),e.offsetWidth}),setTimeout(()=>{n.forEach(e=>{c(e,{transition:`all ${r}ms ${i}`,opacity:`0`})}),setTimeout(()=>{n.forEach(e=>{this.remove(e),this.settings.template===null&&c(e,{transition:`none`,opacity:`1`})}),t()},r)},r)):setTimeout(t,r)}),this}static start(){this.status||this.set(0);let e=()=>{this.isPaused||setTimeout(()=>{this.status&&(this.trickle(),e())},this.settings.trickleSpeed)};return this.settings.trickle&&e(),this}static done(e){return!e&&!this.status?this:this.inc(.3+.5*Math.random()).set(1)}static inc(e){if(this.isPaused||this.settings.indeterminate)return this;let t=this.status;return t?t>1?this:(typeof e!=`number`&&(e=t>=0&&t<.2?.1:t>=.2&&t<.5?.04:t>=.5&&t<.8?.02:t>=.8&&t<.99?.005:0),t=o(t+e,0,.994),this.set(t)):this.start()}static dec(e){if(this.isPaused||this.settings.indeterminate)return this;let t=this.status;return typeof t==`number`?(typeof e!=`number`&&(e=t>.8?.1:t>.5?.05:t>.2?.02:.01),t=o(t-e,0,.994),this.set(t)):this}static trickle(){return this.isPaused||this.settings.indeterminate?this:this.inc()}static promise(e){if(!e||e.state()===`resolved`)return this;let t=0,n=0;return n===0&&this.start(),t++,n++,e.always(()=>{n--,n===0?(t=0,this.done()):this.set((t-n)/t)}),this}static render(e=!1){let t=typeof this.settings.parent==`string`?document.querySelector(this.settings.parent):this.settings.parent,n=t?Array.from(t.querySelectorAll(`.bprogress`)):[];if(this.settings.template!==null&&n.length===0){l(document.documentElement,`bprogress-busy`);let e=document.createElement(`div`);l(e,`bprogress`),e.innerHTML=this.settings.template,t!==document.body&&l(t,`bprogress-custom-parent`),t.appendChild(e),n.push(e)}return n.forEach(n=>{if(this.settings.template===null&&(n.style.display=``),l(document.documentElement,`bprogress-busy`),t!==document.body&&l(t,`bprogress-custom-parent`),this.settings.indeterminate){let e=n.querySelector(this.settings.barSelector);e&&(e.style.display=`none`);let t=n.querySelector(this.settings.indeterminateSelector);t&&(t.style.display=``)}else{let t=n.querySelector(this.settings.barSelector),r=s(e?0:this.status||0,this.settings.direction);c(t,this.barPositionCSS({n:this.status||0,speed:this.settings.speed,ease:this.settings.easing,perc:r}));let i=n.querySelector(this.settings.indeterminateSelector);i&&(i.style.display=`none`)}if(this.settings.template===null){let e=n.querySelector(this.settings.spinnerSelector);e&&(e.style.display=this.settings.showSpinner?`block`:`none`)}else if(!this.settings.showSpinner){let e=n.querySelector(this.settings.spinnerSelector);e&&d(e)}}),n}static remove(e){e?this.settings.template===null?e.style.display=`none`:d(e):(u(document.documentElement,`bprogress-busy`),(typeof this.settings.parent==`string`?document.querySelectorAll(this.settings.parent):[this.settings.parent]).forEach(e=>{u(e,`bprogress-custom-parent`)}),document.querySelectorAll(`.bprogress`).forEach(e=>{let t=e;this.settings.template===null?t.style.display=`none`:d(t)}))}static pause(){return!this.isStarted()||this.settings.indeterminate||(this.isPaused=!0),this}static resume(){if(!this.isStarted()||this.settings.indeterminate)return this;if(this.isPaused=!1,this.settings.trickle){let e=()=>{this.isPaused||setTimeout(()=>{this.status&&(this.trickle(),e())},this.settings.trickleSpeed)};e()}return this}static isRendered(){return document.querySelectorAll(`.bprogress`).length>0}static getPositioningCSS(){let e=document.body.style,t=`WebkitTransform`in e?`Webkit`:`MozTransform`in e?`Moz`:`msTransform`in e?`ms`:`OTransform`in e?`O`:``;return`${t}Perspective`in e?`translate3d`:`${t}Transform`in e?`translate`:`margin`}static queue(e){this.pending.push(e),this.pending.length===1&&this.next()}static next(){let e=this.pending.shift();e&&e(this.next.bind(this))}static initPositionUsing(){this.settings.positionUsing===``&&(this.settings.positionUsing=this.getPositioningCSS())}static barPositionCSS({n:e,speed:t,ease:n,perc:r}){this.initPositionUsing();let i={},a=r??s(e,this.settings.direction);return this.settings.positionUsing===`translate3d`?i={transform:`translate3d(${a}%,0,0)`}:this.settings.positionUsing===`translate`?i={transform:`translate(${a}%,0)`}:this.settings.positionUsing===`width`?i={width:`${this.settings.direction===`rtl`?100-a:a+100}%`,...this.settings.direction===`rtl`?{right:`0`,left:`auto`}:{}}:this.settings.positionUsing===`margin`&&(i=this.settings.direction===`rtl`?{"margin-left":`${-a}%`}:{"margin-right":`${-a}%`}),i.transition=`all ${t}ms ${n}`,i}},m=({color:e=`#29d`,height:t=`2px`,spinnerPosition:n=`top-right`})=>`
:root {
  --bprogress-color: ${e};
  --bprogress-height: ${t};
  --bprogress-spinner-size: 18px;
  --bprogress-spinner-animation-duration: 400ms;
  --bprogress-spinner-border-size: 2px;
  --bprogress-box-shadow: 0 0 10px ${e}, 0 0 5px ${e};
  --bprogress-z-index: 99999;
  --bprogress-spinner-top: ${n===`top-right`||n===`top-left`?`15px`:`auto`};
  --bprogress-spinner-bottom: ${n===`bottom-right`||n===`bottom-left`?`15px`:`auto`};
  --bprogress-spinner-right: ${n===`top-right`||n===`bottom-right`?`15px`:`auto`};
  --bprogress-spinner-left: ${n===`top-left`||n===`bottom-left`?`15px`:`auto`};
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
`;function h(e,t,n){return t in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function g(e){for(var t=1;t<arguments.length;t++){var n=arguments[t]==null?{}:arguments[t],r=Object.keys(n);typeof Object.getOwnPropertySymbols==`function`&&(r=r.concat(Object.getOwnPropertySymbols(n).filter(function(e){return Object.getOwnPropertyDescriptor(n,e).enumerable}))),r.forEach(function(t){h(e,t,n[t])})}return e}function _(e,t){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);t&&(r=r.filter(function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable})),n.push.apply(n,r)}return n}function v(e,t){return t??={},Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(t)):_(Object(t)).forEach(function(n){Object.defineProperty(e,n,Object.getOwnPropertyDescriptor(t,n))}),e}function y(e,t){if(e==null)return{};var n=b(e,t),r,i;if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);for(i=0;i<a.length;i++)r=a[i],!(t.indexOf(r)>=0)&&Object.prototype.propertyIsEnumerable.call(e,r)&&(n[r]=e[r])}return n}function b(e,t){if(e==null)return{};var n={},r=Object.keys(e),i,a;for(a=0;a<r.length;a++)i=r[a],!(t.indexOf(i)>=0)&&(n[i]=e[i]);return n}var x=(0,a.createContext)(void 0),S=function(){var e=(0,a.useContext)(x);if(!e)throw Error(`useProgress must be used within a ProgressProvider`);return e},C=function(e){var t=e.children,n=e.color,r=n===void 0?`#0A2FFF`:n,i=e.height,o=i===void 0?`2px`:i,s=e.options,c=e.spinnerPosition,l=c===void 0?`top-right`:c,u=e.style,d=e.disableStyle,f=d===void 0?!1:d,h=e.nonce,_=e.shallowRouting,v=_===void 0?!1:_,y=e.disableSameURL,b=y===void 0?!0:y,S=e.startPosition,C=S===void 0?0:S,w=e.delay,T=w===void 0?0:w,E=e.stopDelay,D=E===void 0?0:E,O=(0,a.useRef)(null),k=(0,a.useRef)(!1),A=(0,a.useCallback)(function(){return k.current=!0},[]),j=(0,a.useCallback)(function(){return k.current=!1},[]),M=(0,a.useCallback)(function(){var e=arguments.length>0&&arguments[0]!==void 0?arguments[0]:0,t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:0;arguments.length>2&&arguments[2]!==void 0&&arguments[2]&&A(),O.current=setTimeout(function(){e>0&&p.set(e),p.start()},t)},[A]),N=(0,a.useCallback)(function(){var e=arguments.length>0&&arguments[0]!==void 0?arguments[0]:0,t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:0;setTimeout(function(){O.current&&clearTimeout(O.current),O.current=setTimeout(function(){p.isStarted()&&(p.done(),k.current&&j())},e)},t)},[j]),P=(0,a.useCallback)(function(e){return p.inc(e)},[]),F=(0,a.useCallback)(function(e){return p.dec(e)},[]),I=(0,a.useCallback)(function(e){return p.set(e)},[]),L=(0,a.useCallback)(function(){return p.pause()},[]),R=(0,a.useCallback)(function(){return p.resume()},[]),z=(0,a.useCallback)(function(){return p.settings},[]),B=(0,a.useCallback)(function(e){var t=z(),n=g({},t,typeof e==`function`?e(t):e);p.configure(n)},[z]),V=(0,a.useMemo)(function(){return a.createElement(`style`,{nonce:h},u||m({color:r,height:o,spinnerPosition:l}))},[r,o,h,l,u]);return p.configure(s||{}),a.createElement(x.Provider,{value:{start:M,stop:N,inc:P,dec:F,set:I,pause:L,resume:R,setOptions:B,getOptions:z,isAutoStopDisabled:k,disableAutoStop:A,enableAutoStop:j,shallowRouting:v,disableSameURL:b,startPosition:C,delay:T,stopDelay:D}},f?null:V,t)};function w(){return[...arguments].filter(Boolean).join(` `)}function T(e,t){var n=e.as,r=e.children,i=e.className,o=e.classSelector,s=o===void 0?`bar`:o,c=y(e,[`as`,`children`,`className`,`classSelector`]),l=n??`div`;return a.createElement(l,g({ref:t,className:w(s,i)},c),r)}var E=a.forwardRef(T);function D(e,t){var n=e.as,r=e.children,i=e.className,o=e.classSelector,s=o===void 0?`peg`:o,c=y(e,[`as`,`children`,`className`,`classSelector`]),l=n??`div`;return a.createElement(l,g({ref:t,className:w(s,i)},c),r)}var O=a.forwardRef(D);function k(e,t){var n=e.as,r=e.children,i=e.className,o=e.classSelector,s=o===void 0?`spinner`:o,c=y(e,[`as`,`children`,`className`,`classSelector`]),l=n??`div`;return a.createElement(l,g({ref:t,className:w(s,i)},c),r)}var A=a.forwardRef(k);function j(e,t){var n=e.as,r=e.children,i=e.className,o=e.classSelector,s=o===void 0?`spinner-icon`:o,c=y(e,[`as`,`children`,`className`,`classSelector`]),l=n??`div`;return a.createElement(l,g({ref:t,className:w(s,i)},c),r)}var M=a.forwardRef(j);function N(e,t){var n=e.as,r=e.children,i=e.className,o=e.style,s=y(e,[`as`,`children`,`className`,`style`]),c=n??`div`;return a.createElement(c,g({ref:t,className:w(`bprogress`,i),style:v(g({},o),{display:`none`})},s),r||a.createElement(a.Fragment,null,a.createElement(E,null,a.createElement(O,null)),a.createElement(A,null,a.createElement(M,null))))}a.forwardRef(N);function P(e,t){var n=e.as,r=e.className,i=e.classSelector,o=i===void 0?`indeterminate`:i,s=y(e,[`as`,`className`,`classSelector`]),c=n??`div`;return a.createElement(c,g({ref:t,className:w(o,r)},s),a.createElement(`div`,{className:`inc`}),a.createElement(`div`,{className:`dec`}))}a.forwardRef(P);var F=1500,I=0,L=360,R=null,z=0,B=null,V=new Set;function H(){V.forEach(e=>e())}function U(e){if(!e){document.documentElement.removeAttribute(`data-route-pending`),document.documentElement.removeAttribute(`data-route-pending-target`);return}document.documentElement.setAttribute(`data-route-pending`,`true`),document.documentElement.setAttribute(`data-route-pending-target`,J(e))}function W(e){return J(e)===`harness`?L:I}function G(e){return V.add(e),()=>V.delete(e)}function K(){return R}function q(e){try{let t=new URL(e,`http://papercusp.local`);return`${t.pathname.length>1?t.pathname.replace(/\/+$/,``):t.pathname}${t.search}${t.hash}`}catch{return e}}function J(e){let t=q(e);return t===`/harness`||t.startsWith(`/harness/`)?`harness`:`generic`}function Y(e){if(typeof e==`string`)return q(e);if(e&&typeof e==`object`&&`pathname`in e&&typeof e.pathname==`string`){let t=`search`in e&&typeof e.search==`string`?e.search:``,n=`hash`in e&&typeof e.hash==`string`?e.hash:``;return q(`${e.pathname}${t}${n}`)}return null}function X(e){B!==null&&(window.clearTimeout(B),B=null),R=q(e),z=performance.now(),U(R),H()}function Z(){R=null,B!==null&&(window.clearTimeout(B),B=null),U(null),H()}function Q(){if(!R||B!==null)return;let e=Math.max(0,W(R)-(performance.now()-z));B=window.setTimeout(Z,e)}function $(e){if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.download||e.targetBlank||e.disableProgress||e.targetBlocksProgress)return!1;let t=new URL(e.targetHref,e.currentHref),n=new URL(e.currentHref);return!(t.origin!==n.origin||t.pathname===n.pathname&&t.search===n.search)}var ee=n();function te(e){let t=e.currentTarget,n=e.target;return $({defaultPrevented:e.defaultPrevented,button:e.button,metaKey:e.metaKey,ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,altKey:e.altKey,download:t.hasAttribute(`download`),targetBlank:t.target===`_blank`,disableProgress:t.getAttribute(`data-disable-progress`)===`true`,targetBlocksProgress:n instanceof Element&&!!(n.closest(`[data-prevent-progress="true"]`)||n.closest(`[data-disable-progress="true"]`)),currentHref:window.location.href,targetHref:t.href})}function ne({className:e,onClickCapture:t,...n}){let o=S(),s=r(),c=(0,a.useSyncExternalStore)(G,K,K),l=Y(n.href),u=l!==null&&c===l;(0,a.useEffect)(()=>{Q()},[s]);function d(e){if(t?.(e),!te(e))return;let n=new URL(e.currentTarget.href);X(`${n.pathname}${n.search}${n.hash}`),o.set(.08),o.start(.08,0,!0),window.setTimeout(()=>{o.stop(120),Q()},F)}let f=[e,u?`is-route-pending`:null].filter(Boolean).join(` `);return(0,ee.jsx)(i,{...n,"aria-busy":u||void 0,className:f||void 0,"data-route-pending":u?`true`:void 0,onClickCapture:d})}export{C as n,S as r,ne as t};