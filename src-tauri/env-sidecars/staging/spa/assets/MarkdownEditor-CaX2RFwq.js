const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/dist-BVjTcFDG.css","assets/dist-HOgP-yBV.js","assets/chunk-ChpBd9eV.js"])))=>i.map(i=>d[i]);
import{o as A}from"./chunk-ChpBd9eV.js";import{t as I}from"./react-DqHYuLt-.js";import{n as U,t as V}from"./preload-helper-CcgcQsTF.js";import{t as $}from"./jsx-runtime-BmDUFisN.js";import{t as z}from"./hard-reload-AgDnxTOL.js";var o=A(I()),e=$();U();function H({style:i,className:s,raw:a}){const r=typeof a=="string"&&a.trim().length>0;return(0,e.jsxs)("div",{className:s,style:{display:"flex",flexDirection:"column",minHeight:120,fontSize:13,color:"var(--fg-mute, #7f9bb4)",...i},children:[(0,e.jsxs)("div",{style:{display:"flex",alignItems:"center",justifyContent:"center",gap:12,flexWrap:"wrap",padding:r?"8px 12px":16,textAlign:"center",borderBottom:r?"1px solid var(--border, rgba(125,211,252,0.18))":void 0},children:[(0,e.jsxs)("span",{children:["Couldn’t load the markdown renderer",r?" — showing raw text. ":". ",(0,e.jsx)("span",{style:{fontSize:12},children:"The app was likely updated underneath this page."})]}),(0,e.jsx)("button",{type:"button",onClick:()=>z(),style:{padding:"4px 14px",fontSize:12,fontWeight:600,color:"#06121b",background:"var(--accent, #57d7ff)",border:0,borderRadius:6,cursor:"pointer",flexShrink:0},children:"Reload"})]}),r&&(0,e.jsx)("pre",{style:{flex:1,minHeight:0,margin:0,padding:16,overflow:"auto",whiteSpace:"pre-wrap",wordBreak:"break-word",fontSize:13,lineHeight:1.6,color:"var(--fg, #e6e6e6)",background:"#19232A",fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"},children:a})]})}var L=null;function C(){return L||(L=V(()=>Promise.resolve({}),__vite__mapDeps([0]))),L}var E=null;function G(){return E||(E=(async()=>{try{await C();const i=(await V(async()=>{const{default:a}=await import("./dist-HOgP-yBV.js").then(r=>A(r.default));return{default:a}},__vite__mapDeps([1,2]))).default,s=document.createElement("div");await i.preview(s,"warm",{mode:"dark",lang:"en_US"})}catch{E=null}})(),E)}function W(i){return(i??"").replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,(s,a,r)=>{const c=a.trim();let v=c,t=null;const n=c.indexOf("/");n>0&&(t=c.slice(0,n),v=c.slice(n+1));const f=(r??c).trim(),m=new URLSearchParams({target:v});return t&&m.set("harness",t),`[${f}](/wiki?${m.toString()})`})}function Q({value:i,outline:s=!1,className:a,style:r,renderers:c,onParsed:v}){const t=(0,o.useRef)(null),n=(0,o.useRef)(null),f=(0,o.useRef)(c);f.current=c;const m=(0,o.useRef)(v);m.current=v;const[T,y]=(0,o.useState)(!1);if((0,o.useEffect)(()=>{if(!t.current)return;let d=!1;return y(!1),(async()=>{await C();const l=(await V(async()=>{const{default:g}=await import("./dist-HOgP-yBV.js").then(w=>A(w.default));return{default:g}},__vite__mapDeps([1,2]))).default;if(d||!t.current)return;const k={mode:"dark",theme:{current:"dark"},math:{engine:"KaTeX"},anchor:1,lang:"en_US"};if(f.current&&(k.renderers=f.current),await l.preview(t.current,W(i??""),k),!(d||!t.current)){try{m.current?.(t.current)}catch{}if(s&&n.current&&t.current){n.current.innerHTML="",l.outlineRender(t.current,n.current);const g=w=>{let u=w.target;for(;u&&u!==n.current;){const _=u.getAttribute?.("data-target-id");if(_){const S=t.current?.querySelector(`#${CSS.escape(_)}`);S&&(w.preventDefault(),w.stopPropagation(),S.scrollIntoView({block:"start",behavior:"smooth"}));return}u=u.parentElement}};n.current.addEventListener("click",g,!0)}}})().catch(l=>{d||(y(!0),console.error("[MarkdownPreview] vditor failed to load:",l))}),()=>{d=!0}},[i,s]),T)return(0,e.jsx)(H,{className:a,style:r,raw:i});if(s){const d=s==="right"?"right":"left";return(0,e.jsxs)("div",{className:a,style:{display:"flex",flex:"1 1 auto",minHeight:0,gap:16,background:"#19232A",...r},children:[d==="left"&&(0,e.jsx)("div",{ref:n,className:"pc-md-outline",style:F}),(0,e.jsx)("div",{ref:t,className:"vditor-reset pc-md-preview",style:{flex:1,background:"#19232A",color:"#e6e6e6",minWidth:0,minHeight:0}}),d==="right"&&(0,e.jsx)("div",{ref:n,className:"pc-md-outline",style:F}),(0,e.jsx)("style",{children:`
          .pc-md-outline ul { list-style: none; padding-left: 12px; margin: 0; }
          .pc-md-outline > ul { padding-left: 0; }
          .pc-md-outline li { margin: 2px 0; }
          .pc-md-outline a { color: #aaa; text-decoration: none; font-size: 12px; line-height: 1.5; display: block; padding: 1px 4px; border-radius: 2px; }
          .pc-md-outline a:hover { color: #fff; background: #232E37; }
          .pc-md-preview, .pc-md-preview pre, .pc-md-preview code { background-color: #19232A !important; }
          ${M}
        `})]})}return(0,e.jsxs)(e.Fragment,{children:[(0,e.jsx)("div",{ref:t,className:`vditor-reset pc-md-preview ${a??""}`,style:{background:"#19232A",color:"#e6e6e6",...r}}),(0,e.jsx)("style",{children:M})]})}var M=`
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
`,F={display:"block",width:220,flexShrink:0,position:"sticky",top:0,alignSelf:"flex-start",maxHeight:"calc(100vh - 100px)",overflowY:"auto",padding:"8px 4px",borderRight:"1px solid var(--border, #2a2a2a)"},N=["headings","bold","italic","strike","|","list","ordered-list","check","quote","|","code","inline-code","link","table","|","edit-mode","preview","outline","export"];function Z({value:i,onChange:s,mode:a="ir",readOnly:r=!1,height:c="100%",minHeight:v=200,toolbar:t=N,outline:n=!1,className:f,style:m,placeholder:T,onInstance:y}){const d=(0,o.useRef)(null),l=(0,o.useRef)(null),k=(0,o.useRef)(s);k.current=s;const g=(0,o.useRef)(y);g.current=y;const w=(0,o.useRef)(i),[u,_]=(0,o.useState)(!1),[S,O]=(0,o.useState)(!1);return(0,o.useEffect)(()=>{let x=!1;return O(!1),(async()=>{await C();const R=(await V(async()=>{const{default:p}=await import("./dist-HOgP-yBV.js").then(h=>A(h.default));return{default:p}},__vite__mapDeps([1,2]))).default;if(x||!d.current)return;const b=new R(d.current,{mode:a,theme:"dark",lang:"en_US",cache:{enable:!1},undoDelay:0,minHeight:v,placeholder:T,toolbar:t,outline:n?{enable:!0,position:n}:{enable:!1,position:"left"},preview:{theme:{current:"dark"},math:{engine:"KaTeX"}},input:p=>k.current?.(p),after:()=>{if(!x){if(l.current=b,b.setValue(w.current??""),r?b.disabled():b.enable(),n){const p=()=>{const h=d.current?.querySelector(".vditor-outline");h&&(h.style.display="block",!h.dataset.pcOutlineWired&&(h.dataset.pcOutlineWired="1",h.addEventListener("click",P=>{let j=P.target;for(;j&&j!==h;){const D=j.getAttribute?.("data-target-id");if(D){const q=d.current?.querySelector(`#${CSS.escape(D)}`);q&&(P.preventDefault(),P.stopPropagation(),q.scrollIntoView({block:"start",behavior:"smooth"}));return}j=j.parentElement}},!0)))};requestAnimationFrame(()=>requestAnimationFrame(p)),setTimeout(p,100),setTimeout(p,400)}_(!0);try{g.current?.(b)}catch{}}}})})().catch(R=>{x||(O(!0),console.error("[MarkdownEditor] vditor failed to load:",R))}),()=>{x=!0;try{g.current?.(null)}catch{}try{l.current?.destroy()}catch{}l.current=null,_(!1)}},[a,JSON.stringify(t)]),(0,o.useEffect)(()=>{if(!u||!l.current)return;const x=l.current;if(x.getValue()===i)return;const R=window.scrollX,b=window.scrollY,p=!!d.current?.contains(document.activeElement);x.setValue(i??""),p||requestAnimationFrame(()=>window.scrollTo(R,b))},[i,u]),(0,o.useEffect)(()=>{!u||!l.current||(r?l.current.disabled():l.current.enable())},[r,u]),S?(0,e.jsx)(H,{className:f,style:{height:c,...m},raw:i}):(0,e.jsxs)(e.Fragment,{children:[(0,e.jsx)("style",{children:`
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
      `}),(0,e.jsx)("div",{ref:d,className:`pc-md-editor-host ${f??""}`,style:{height:c,width:"100%",minHeight:0,...m}})]})}export{Q as n,G as r,Z as t};
