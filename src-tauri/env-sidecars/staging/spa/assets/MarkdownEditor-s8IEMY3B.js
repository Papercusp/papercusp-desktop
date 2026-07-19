const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/dist-BVjTcFDG.css","assets/dist-HOgP-yBV.js","assets/chunk-ChpBd9eV.js"])))=>i.map(i=>d[i]);
import{o as V}from"./chunk-ChpBd9eV.js";import{t as I}from"./react-DqHYuLt-.js";import{n as U,t as L}from"./preload-helper-CcgcQsTF.js";import{t as $}from"./jsx-runtime-BmDUFisN.js";import{t as z}from"./hard-reload-AgDnxTOL.js";var r=V(I()),e=$();U();function M({style:a,className:c,raw:s}){const i=typeof s=="string"&&s.trim().length>0;return(0,e.jsxs)("div",{className:c,style:{display:"flex",flexDirection:"column",minHeight:120,fontSize:13,color:"var(--fg-mute, #7f9bb4)",...a},children:[(0,e.jsxs)("div",{style:{display:"flex",alignItems:"center",justifyContent:"center",gap:12,flexWrap:"wrap",padding:i?"8px 12px":16,textAlign:"center",borderBottom:i?"1px solid var(--border, rgba(125,211,252,0.18))":void 0},children:[(0,e.jsxs)("span",{children:["Couldn’t load the markdown renderer",i?" — showing raw text. ":". ",(0,e.jsx)("span",{style:{fontSize:12},children:"The app was likely updated underneath this page."})]}),(0,e.jsx)("button",{type:"button",onClick:()=>z(),style:{padding:"4px 14px",fontSize:12,fontWeight:600,color:"#06121b",background:"var(--accent, #57d7ff)",border:0,borderRadius:6,cursor:"pointer",flexShrink:0},children:"Reload"})]}),i&&(0,e.jsx)("pre",{style:{flex:1,minHeight:0,margin:0,padding:16,overflow:"auto",whiteSpace:"pre-wrap",wordBreak:"break-word",fontSize:13,lineHeight:1.6,color:"var(--fg, #e6e6e6)",background:"#19232A",fontFamily:"ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"},children:s})]})}var T=null;function F(){return T||(T=L(()=>Promise.resolve({}),__vite__mapDeps([0]))),T}function H(a){return(a??"").replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,(c,s,i)=>{const l=s.trim();let v=l,t=null;const o=l.indexOf("/");o>0&&(t=l.slice(0,o),v=l.slice(o+1));const f=(i??l).trim(),m=new URLSearchParams({target:v});return t&&m.set("harness",t),`[${f}](/wiki?${m.toString()})`})}function J({value:a,outline:c=!1,className:s,style:i,renderers:l,onParsed:v}){const t=(0,r.useRef)(null),o=(0,r.useRef)(null),f=(0,r.useRef)(l);f.current=l;const m=(0,r.useRef)(v);m.current=v;const[E,k]=(0,r.useState)(!1);if((0,r.useEffect)(()=>{if(!t.current)return;let n=!1;return k(!1),(async()=>{await F();const d=(await L(async()=>{const{default:g}=await import("./dist-HOgP-yBV.js").then(w=>V(w.default));return{default:g}},__vite__mapDeps([1,2]))).default;if(n||!t.current)return;const y={mode:"dark",theme:{current:"dark"},math:{engine:"KaTeX"},anchor:1,lang:"en_US"};if(f.current&&(y.renderers=f.current),await d.preview(t.current,H(a??""),y),!(n||!t.current)){try{m.current?.(t.current)}catch{}if(c&&o.current&&t.current){o.current.innerHTML="",d.outlineRender(t.current,o.current);const g=w=>{let u=w.target;for(;u&&u!==o.current;){const _=u.getAttribute?.("data-target-id");if(_){const S=t.current?.querySelector(`#${CSS.escape(_)}`);S&&(w.preventDefault(),w.stopPropagation(),S.scrollIntoView({block:"start",behavior:"smooth"}));return}u=u.parentElement}};o.current.addEventListener("click",g,!0)}}})().catch(d=>{n||(k(!0),console.error("[MarkdownPreview] vditor failed to load:",d))}),()=>{n=!0}},[a,c]),E)return(0,e.jsx)(M,{className:s,style:i,raw:a});if(c){const n=c==="right"?"right":"left";return(0,e.jsxs)("div",{className:s,style:{display:"flex",gap:16,background:"#19232A",...i},children:[n==="left"&&(0,e.jsx)("div",{ref:o,className:"pc-md-outline",style:D}),(0,e.jsx)("div",{ref:t,className:"vditor-reset pc-md-preview",style:{flex:1,background:"#19232A",color:"#e6e6e6",minWidth:0}}),n==="right"&&(0,e.jsx)("div",{ref:o,className:"pc-md-outline",style:D}),(0,e.jsx)("style",{children:`
          .pc-md-outline ul { list-style: none; padding-left: 12px; margin: 0; }
          .pc-md-outline > ul { padding-left: 0; }
          .pc-md-outline li { margin: 2px 0; }
          .pc-md-outline a { color: #aaa; text-decoration: none; font-size: 12px; line-height: 1.5; display: block; padding: 1px 4px; border-radius: 2px; }
          .pc-md-outline a:hover { color: #fff; background: #232E37; }
          .pc-md-preview, .pc-md-preview pre, .pc-md-preview code { background-color: #19232A !important; }
          ${q}
        `})]})}return(0,e.jsxs)(e.Fragment,{children:[(0,e.jsx)("div",{ref:t,className:`vditor-reset pc-md-preview ${s??""}`,style:{background:"#19232A",color:"#e6e6e6",...i}}),(0,e.jsx)("style",{children:q})]})}var q=`
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
`,D={display:"block",width:220,flexShrink:0,position:"sticky",top:0,alignSelf:"flex-start",maxHeight:"calc(100vh - 100px)",overflowY:"auto",padding:"8px 4px",borderRight:"1px solid var(--border, #2a2a2a)"},W=["headings","bold","italic","strike","|","list","ordered-list","check","quote","|","code","inline-code","link","table","|","edit-mode","preview","outline","export"];function G({value:a,onChange:c,mode:s="ir",readOnly:i=!1,height:l="100%",minHeight:v=200,toolbar:t=W,outline:o=!1,className:f,style:m,placeholder:E,onInstance:k}){const n=(0,r.useRef)(null),d=(0,r.useRef)(null),y=(0,r.useRef)(c);y.current=c;const g=(0,r.useRef)(k);g.current=k;const w=(0,r.useRef)(a),[u,_]=(0,r.useState)(!1),[S,P]=(0,r.useState)(!1);return(0,r.useEffect)(()=>{let x=!1;return P(!1),(async()=>{await F();const R=(await L(async()=>{const{default:p}=await import("./dist-HOgP-yBV.js").then(h=>V(h.default));return{default:p}},__vite__mapDeps([1,2]))).default;if(x||!n.current)return;const b=new R(n.current,{mode:s,theme:"dark",lang:"en_US",cache:{enable:!1},undoDelay:0,minHeight:v,placeholder:E,toolbar:t,outline:o?{enable:!0,position:o}:{enable:!1,position:"left"},preview:{theme:{current:"dark"},math:{engine:"KaTeX"}},input:p=>y.current?.(p),after:()=>{if(!x){if(d.current=b,b.setValue(w.current??""),i?b.disabled():b.enable(),o){const p=()=>{const h=n.current?.querySelector(".vditor-outline");h&&(h.style.display="block",!h.dataset.pcOutlineWired&&(h.dataset.pcOutlineWired="1",h.addEventListener("click",A=>{let j=A.target;for(;j&&j!==h;){const C=j.getAttribute?.("data-target-id");if(C){const O=n.current?.querySelector(`#${CSS.escape(C)}`);O&&(A.preventDefault(),A.stopPropagation(),O.scrollIntoView({block:"start",behavior:"smooth"}));return}j=j.parentElement}},!0)))};requestAnimationFrame(()=>requestAnimationFrame(p)),setTimeout(p,100),setTimeout(p,400)}_(!0);try{g.current?.(b)}catch{}}}})})().catch(R=>{x||(P(!0),console.error("[MarkdownEditor] vditor failed to load:",R))}),()=>{x=!0;try{g.current?.(null)}catch{}try{d.current?.destroy()}catch{}d.current=null,_(!1)}},[s,JSON.stringify(t)]),(0,r.useEffect)(()=>{if(!u||!d.current)return;const x=d.current;if(x.getValue()===a)return;const R=window.scrollX,b=window.scrollY,p=!!n.current?.contains(document.activeElement);x.setValue(a??""),p||requestAnimationFrame(()=>window.scrollTo(R,b))},[a,u]),(0,r.useEffect)(()=>{!u||!d.current||(i?d.current.disabled():d.current.enable())},[i,u]),S?(0,e.jsx)(M,{className:f,style:{height:l,...m},raw:a}):(0,e.jsxs)(e.Fragment,{children:[(0,e.jsx)("style",{children:`
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
      `}),(0,e.jsx)("div",{ref:n,className:`pc-md-editor-host ${f??""}`,style:{height:l,width:"100%",minHeight:0,...m}})]})}export{J as n,G as t};
