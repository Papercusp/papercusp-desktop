const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/dist-BVjTcFDG.css","assets/dist-HOgP-yBV.js","assets/chunk-ChpBd9eV.js"])))=>i.map(i=>d[i]);
import{o as A}from"./chunk-ChpBd9eV.js";import{t as H}from"./react-DqHYuLt-.js";import{n as N,t as T}from"./preload-helper-CcgcQsTF.js";import{t as $}from"./jsx-runtime-BmDUFisN.js";var i=A(H());function W(){if(typeof window>"u")return;const t=window;if(typeof t.__papercuspOriginalReload=="function")try{t.__papercuspOriginalReload();return}catch{}try{const n=new URL(window.location.href);n.searchParams.set("_r",String(Date.now())),window.location.href=n.toString();return}catch{}window.location.reload()}var B="language-plantuml-neutralized";function D(t){return t.replace(/language-plantuml(?![\w-])/g,B)}var e=$();N();function F({style:t,className:n,raw:d}){const o=typeof d=="string"&&d.trim().length>0;return(0,e.jsxs)("div",{className:n,style:{display:"flex",flexDirection:"column",minHeight:120,fontSize:13,color:"var(--fg-mute, #7f9bb4)",...t},children:[(0,e.jsxs)("div",{style:{display:"flex",alignItems:"center",justifyContent:"center",gap:12,flexWrap:"wrap",padding:o?"8px 12px":16,textAlign:"center",borderBottom:o?"1px solid var(--border, rgba(125,211,252,0.18))":void 0},children:[(0,e.jsxs)("span",{children:["Couldn’t load the markdown renderer",o?" — showing raw text. ":". ",(0,e.jsx)("span",{style:{fontSize:12},children:"The app was likely updated underneath this page."})]}),(0,e.jsx)("button",{type:"button",onClick:()=>W(),style:{padding:"4px 14px",fontSize:12,fontWeight:600,color:"#06121b",background:"var(--accent, #57d7ff)",border:0,borderRadius:6,cursor:"pointer",flexShrink:0},children:"Reload"})]}),o&&(0,e.jsx)("pre",{style:{flex:1,minHeight:0,margin:0,padding:16,overflow:"auto",whiteSpace:"pre-wrap",wordBreak:"break-word",fontSize:13,lineHeight:1.6,color:"var(--fg, #e6e6e6)",background:"#19232A",fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"},children:d})]})}var O="/vditor",P=null;function C(){return P||(P=T(()=>Promise.resolve({}),__vite__mapDeps([0]))),P}var E=null;function Q(){return E||(E=(async()=>{try{await C();const t=(await T(async()=>{const{default:d}=await import("./dist-HOgP-yBV.js").then(o=>A(o.default));return{default:d}},__vite__mapDeps([1,2]))).default,n=document.createElement("div");await t.preview(n,"warm",{cdn:O,transform:D,mode:"dark",lang:"en_US"})}catch{E=null}})(),E)}function X(t){return(t??"").replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,(n,d,o)=>{const c=d.trim();let v=c,r=null;const a=c.indexOf("/");a>0&&(r=c.slice(0,a),v=c.slice(a+1));const f=(o??c).trim(),m=new URLSearchParams({target:v});return r&&m.set("harness",r),`[${f}](/wiki?${m.toString()})`})}function ee({value:t,outline:n=!1,className:d,style:o,renderers:c,onParsed:v}){const r=(0,i.useRef)(null),a=(0,i.useRef)(null),f=(0,i.useRef)(c);f.current=c;const m=(0,i.useRef)(v);m.current=v;const[V,y]=(0,i.useState)(!1);if((0,i.useEffect)(()=>{if(!r.current)return;let l=!1;return y(!1),(async()=>{await C();const s=(await T(async()=>{const{default:g}=await import("./dist-HOgP-yBV.js").then(w=>A(w.default));return{default:g}},__vite__mapDeps([1,2]))).default;if(l||!r.current)return;const _={cdn:O,transform:D,mode:"dark",theme:{current:"dark"},math:{engine:"KaTeX"},anchor:1,lang:"en_US"};if(f.current&&(_.renderers=f.current),await s.preview(r.current,X(t??""),_),!(l||!r.current)){try{m.current?.(r.current)}catch{}if(n&&a.current&&r.current){a.current.innerHTML="",s.outlineRender(r.current,a.current);const g=w=>{let u=w.target;for(;u&&u!==a.current;){const k=u.getAttribute?.("data-target-id");if(k){const j=r.current?.querySelector(`#${CSS.escape(k)}`);j&&(w.preventDefault(),w.stopPropagation(),j.scrollIntoView({block:"start",behavior:"smooth"}));return}u=u.parentElement}};a.current.addEventListener("click",g,!0)}}})().catch(s=>{l||(y(!0),console.error("[MarkdownPreview] vditor failed to load:",s))}),()=>{l=!0}},[t,n]),V)return(0,e.jsx)(F,{className:d,style:o,raw:t});if(n){const l=n==="right"?"right":"left";return(0,e.jsxs)("div",{className:d,style:{display:"flex",flex:"1 1 auto",minHeight:0,gap:16,background:"#19232A",...o},children:[l==="left"&&(0,e.jsx)("div",{ref:a,className:"pc-md-outline",style:z}),(0,e.jsx)("div",{ref:r,className:"vditor-reset pc-md-preview",style:{flex:1,background:"#19232A",color:"#e6e6e6",minWidth:0,minHeight:0}}),l==="right"&&(0,e.jsx)("div",{ref:a,className:"pc-md-outline",style:z}),(0,e.jsx)("style",{children:`
          .pc-md-outline ul { list-style: none; padding-left: 12px; margin: 0; }
          .pc-md-outline > ul { padding-left: 0; }
          .pc-md-outline li { margin: 2px 0; }
          .pc-md-outline a { color: #aaa; text-decoration: none; font-size: 12px; line-height: 1.5; display: block; padding: 1px 4px; border-radius: 2px; }
          .pc-md-outline a:hover { color: #fff; background: #232E37; }
          .pc-md-preview, .pc-md-preview pre, .pc-md-preview code { background-color: #19232A !important; }
          ${q}
        `})]})}return(0,e.jsxs)(e.Fragment,{children:[(0,e.jsx)("div",{ref:r,className:`vditor-reset pc-md-preview ${d??""}`,style:{background:"#19232A",color:"#e6e6e6",...o}}),(0,e.jsx)("style",{children:q})]})}var q=`
  .pc-md-preview :is(pre, pre code) {
    background: color-mix(in srgb, var(--bg-popover, #0d1829), transparent 6%) !important;
    color: var(--fg, #e7f7ff) !important;
  }
  .pc-md-preview pre {
    border: 1px solid var(--border-strong, rgba(125, 211, 252, 0.32)) !important;
    border-radius: 12px !important;
  }
  .pc-md-preview :is(code.language-yaml, code.language-yml, code.language-frontmatter, pre code:first-child) {
    color: var(--fg, #e7f7ff) !important;
  }
  .pc-md-preview :is(.hljs-attr, .hljs-attribute, .hljs-keyword, .hljs-meta) {
    color: var(--accent-strong, #7dd3fc) !important;
  }
  .pc-md-preview :is(.hljs-string, .hljs-literal, .hljs-number) {
    color: var(--fg-dim, #b9d4e8) !important;
  }
`,z={display:"block",width:220,flexShrink:0,position:"sticky",top:0,alignSelf:"flex-start",maxHeight:"calc(100vh - 100px)",overflowY:"auto",padding:"8px 4px",borderRight:"1px solid var(--border, #2a2a2a)"},K=["headings","bold","italic","strike","|","list","ordered-list","check","quote","|","code","inline-code","link","table","|","edit-mode","preview","outline","export"];function te({value:t,onChange:n,mode:d="ir",readOnly:o=!1,height:c="100%",minHeight:v=200,toolbar:r=K,outline:a=!1,className:f,style:m,placeholder:V,onInstance:y}){const l=(0,i.useRef)(null),s=(0,i.useRef)(null),_=(0,i.useRef)(n);_.current=n;const g=(0,i.useRef)(y);g.current=y;const w=(0,i.useRef)(t),[u,k]=(0,i.useState)(!1),[j,U]=(0,i.useState)(!1);return(0,i.useEffect)(()=>{let x=!1;return U(!1),(async()=>{await C();const R=(await T(async()=>{const{default:p}=await import("./dist-HOgP-yBV.js").then(h=>A(h.default));return{default:p}},__vite__mapDeps([1,2]))).default;if(x||!l.current)return;const b=new R(l.current,{cdn:O,mode:d,theme:"dark",lang:"en_US",cache:{enable:!1},undoDelay:0,minHeight:v,placeholder:V,toolbar:r,outline:a?{enable:!0,position:a}:{enable:!1,position:"left"},preview:{theme:{current:"dark"},math:{engine:"KaTeX"},transform:D},input:p=>_.current?.(p),after:()=>{if(!x){if(s.current=b,b.setValue(w.current??""),o?b.disabled():b.enable(),a){const p=()=>{const h=l.current?.querySelector(".vditor-outline");h&&(h.style.display="block",!h.dataset.pcOutlineWired&&(h.dataset.pcOutlineWired="1",h.addEventListener("click",L=>{let S=L.target;for(;S&&S!==h;){const I=S.getAttribute?.("data-target-id");if(I){const M=l.current?.querySelector(`#${CSS.escape(I)}`);M&&(L.preventDefault(),L.stopPropagation(),M.scrollIntoView({block:"start",behavior:"smooth"}));return}S=S.parentElement}},!0)))};requestAnimationFrame(()=>requestAnimationFrame(p)),setTimeout(p,100),setTimeout(p,400)}k(!0);try{g.current?.(b)}catch{}}}})})().catch(R=>{x||(U(!0),console.error("[MarkdownEditor] vditor failed to load:",R))}),()=>{x=!0;try{g.current?.(null)}catch{}try{s.current?.destroy()}catch{}s.current=null,k(!1)}},[d,JSON.stringify(r)]),(0,i.useEffect)(()=>{if(!u||!s.current)return;const x=s.current;if(x.getValue()===t)return;const R=window.scrollX,b=window.scrollY,p=!!l.current?.contains(document.activeElement);x.setValue(t??""),p||requestAnimationFrame(()=>window.scrollTo(R,b))},[t,u]),(0,i.useEffect)(()=>{!u||!s.current||(o?s.current.disabled():s.current.enable())},[o,u]),j?(0,e.jsx)(F,{className:f,style:{height:c,...m},raw:t}):(0,e.jsxs)(e.Fragment,{children:[(0,e.jsx)("style",{children:`
        /* Vditor mounts INTO the container element and adds .vditor class names
         * to it. To get internal scrolling instead of vertical-overflow, we
         * override Vditor's inline height with !important. The .vditor-ir
         * element is the scroll container — Vditor's outline click handler
         * does \`vditor.ir.element.scrollTop = …\`, so .vditor-ir MUST be the
         * overflow:auto layer (not its inner <pre>) for outline links to work. */
        /* Use the darker blue-tinted gray (#19232A) that the user identified
         * from the screenshot as the preferred tone. Vditor's default dark
         * theme bleeds the lighter greenish-gray (#26-282E ~ #262D32) into
         * scrolled regions. Apply uniformly so scroll never reveals a delta. */
        .pc-md-editor-host.vditor--dark {
          --panel-background-color: #19232A !important;
          --toolbar-background-color: #19232A !important;
          --textarea-background-color: #19232A !important;
          background-color: #19232A !important;
        }
        .pc-md-editor-host.vditor--dark .vditor-content,
        .pc-md-editor-host.vditor--dark .vditor-ir,
        .pc-md-editor-host.vditor--dark .vditor-wysiwyg,
        .pc-md-editor-host.vditor--dark .vditor-sv,
        .pc-md-editor-host.vditor--dark .vditor-reset,
        .pc-md-editor-host.vditor--dark .vditor-outline,
        .pc-md-editor-host.vditor--dark .vditor-toolbar {
          background-color: #19232A !important;
        }
        .pc-md-editor-host.vditor { display: flex !important; flex-direction: column !important; height: 100% !important; min-height: 0; }
        .pc-md-editor-host.vditor > .vditor-toolbar { flex: 0 0 auto; }
        .pc-md-editor-host.vditor > .vditor-content { flex: 1 1 0 !important; min-height: 0 !important; display: flex !important; overflow: hidden !important; }
        .pc-md-editor-host.vditor > .vditor-content > .vditor-outline { flex: 0 0 auto; max-width: 240px; overflow: auto; }
        .pc-md-editor-host.vditor > .vditor-content > .vditor-ir,
        .pc-md-editor-host.vditor > .vditor-content > .vditor-wysiwyg,
        .pc-md-editor-host.vditor > .vditor-content > .vditor-sv { flex: 1 1 0 !important; min-height: 0 !important; overflow: auto !important; background-color: var(--bg-2) !important; }
        .pc-md-editor-host.vditor > .vditor-content > .vditor-ir > pre,
        .pc-md-editor-host.vditor > .vditor-content > .vditor-wysiwyg > pre,
        .pc-md-editor-host.vditor > .vditor-content > .vditor-sv > pre { overflow: visible !important; min-height: 100%; box-sizing: border-box; }
      `}),(0,e.jsx)("div",{ref:l,className:`pc-md-editor-host ${f??""}`,style:{height:c,width:"100%",minHeight:0,...m}})]})}export{W as i,ee as n,Q as r,te as t};
